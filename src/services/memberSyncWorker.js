/**
 * SiaraMaina Clan Informatics - Member Sync Periodic Worker & Verifier
 * 
 * Periodically verifies that all records within 'siaraMainaClan/records' master document
 * are accurately represented as individual documents in the 'members' collection.
 * 
 * Features:
 * 1. Checks total counts and individual member IDs.
 * 2. Detects any missing or orphaned records.
 * 3. Auto-heals by running batched writes if disparity is detected.
 * 4. Broadcasts custom events ('clan-members-verified') and saves timestamp to localStorage.
 */

import { doc, getDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { db, auth } from '../firebase.js';
import { migrateLedgerToMembers } from './memberMigrationService.js';

export const VERIFICATION_STORAGE_KEY = 'siaramaina_last_members_verification';

class MemberSyncVerifier {
  constructor() {
    this.intervalId = null;
    this.intervalMs = 3 * 60 * 1000; // default 3 minutes
    this.isRunning = false;
    this.lastVerification = null;
    this.listeners = new Set();
  }

  /**
   * Run an explicit verification check comparing 'siaraMainaClan/records' with '/members'
   * @param {Object} [options]
   * @param {boolean} [options.autoHeal=true] - Automatically provision missing records if found
   * @param {import('firebase/firestore').Firestore} [options.dbInstance]
   */
  async verifySync(options = {}) {
    const firestore = options.dbInstance || db;
    const autoHeal = options.autoHeal !== false;
    const startTime = Date.now();

    console.log('[MemberSyncVerifier] 🔍 Running periodic members consistency verification...');

    try {
      // 1. Fetch master ledger from siaraMainaClan/records
      const ledgerDocRef = doc(firestore, 'siaraMainaClan', 'records');
      const ledgerSnap = await getDoc(ledgerDocRef);

      if (!ledgerSnap.exists()) {
        console.warn("[MemberSyncVerifier] ⚠ Master ledger 'siaraMainaClan/records' does not exist yet.");
        const result = {
          success: false,
          inSync: false,
          reason: 'Master ledger not found',
          ledgerCount: 0,
          membersCount: 0,
          missingIds: [],
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString()
        };
        this.broadcastResult(result);
        return result;
      }

      const ledgerRecords = Array.isArray(ledgerSnap.data().records) ? ledgerSnap.data().records : [];
      const ledgerIds = new Set(ledgerRecords.map(r => String(r.id)).filter(Boolean));

      // 2. Fetch individual documents from /members collection
      const membersColRef = collection(firestore, 'members');
      const membersSnap = await getDocs(membersColRef);
      const membersDocIds = new Set(membersSnap.docs.map(d => String(d.id)));

      // 3. Compare sets to identify any discrepancies
      const missingFromMembers = [];
      ledgerIds.forEach(id => {
        if (!membersDocIds.has(id)) {
          missingFromMembers.push(id);
        }
      });

      const inSync = missingFromMembers.length === 0 && ledgerIds.size === membersDocIds.size;
      const durationMs = Date.now() - startTime;

      let healedCount = 0;
      let healed = false;

      // 4. Auto-healing: If disparity found and autoHeal is enabled, migrate missing records
      if (!inSync && missingFromMembers.length > 0 && autoHeal) {
        console.warn(`[MemberSyncVerifier] ⚡ Disparity detected! ${missingFromMembers.length} records missing from '/members'. Auto-healing...`);
        const healBatch = writeBatch(firestore);
        const nowIso = new Date().toISOString();

        ledgerRecords.forEach(r => {
          if (r && r.id && missingFromMembers.includes(String(r.id))) {
            const mRef = doc(firestore, 'members', String(r.id));
            const fullName = r.fullName || `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Clan Member';
            healBatch.set(mRef, {
              ...r,
              id: String(r.id),
              fullName,
              migratedAt: nowIso,
              migratedFrom: 'siaraMainaClan/records',
              autoHealedByVerifier: true,
              updatedAt: nowIso,
              lastModifiedByUid: auth.currentUser ? auth.currentUser.uid : 'sync_verifier'
            }, { merge: true });
            healedCount++;
          }
        });

        await healBatch.commit();
        healed = true;
        console.log(`[MemberSyncVerifier] ✅ Auto-healed: Provisioned ${healedCount} missing member documents into '/members'!`);
      }

      const verificationResult = {
        success: true,
        inSync: inSync || healed,
        originallyInSync: inSync,
        healed,
        healedCount,
        ledgerCount: ledgerIds.size,
        membersCount: inSync ? membersDocIds.size : (membersDocIds.size + healedCount),
        missingIds: inSync ? [] : missingFromMembers,
        durationMs,
        timestamp: new Date().toISOString()
      };

      this.lastVerification = verificationResult;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(VERIFICATION_STORAGE_KEY, JSON.stringify(verificationResult));
        }
      } catch (e) {}

      console.log(`[MemberSyncVerifier] Verification completed in ${durationMs}ms:`, {
        ledgerCount: verificationResult.ledgerCount,
        membersCount: verificationResult.membersCount,
        inSync: verificationResult.inSync
      });

      this.broadcastResult(verificationResult);
      return verificationResult;
    } catch (err) {
      console.error('[MemberSyncVerifier] Verification check failed:', err);
      const failResult = {
        success: false,
        inSync: false,
        error: err.message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      this.broadcastResult(failResult);
      return failResult;
    }
  }

  /**
   * Start recurring background verification
   * @param {number} [intervalMs=180000] 
   * @param {Object} [options]
   */
  start(intervalMs = 3 * 60 * 1000, options = {}) {
    if (this.isRunning) return;
    this.intervalMs = intervalMs;
    this.isRunning = true;

    console.log(`[MemberSyncVerifier] 🚀 Started periodic members verification (Every ${Math.round(intervalMs / 1000)}s)`);

    // Initial check shortly after startup
    setTimeout(() => {
      this.verifySync(options);
    }, 2500);

    this.intervalId = setInterval(() => {
      this.verifySync(options);
    }, this.intervalMs);

    // Also verify when user returns to the tab
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          // If more than 60s has passed since last check, verify now
          const lastTs = this.lastVerification ? new Date(this.lastVerification.timestamp).getTime() : 0;
          if (Date.now() - lastTs > 60000) {
            console.log('[MemberSyncVerifier] Tab regained focus - refreshing sync verification');
            this.verifySync(options);
          }
        }
      });
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[MemberSyncVerifier] Stopped periodic members verification.');
  }

  addListener(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  broadcastResult(result) {
    this.listeners.forEach(fn => {
      try { fn(result); } catch (e) { console.error(e); }
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('clan-members-verified', { detail: result }));
      // Notify service worker if active
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'MEMBERS_SYNC_REPORT',
          payload: result
        });
      }
    }
  }
}

export const memberSyncVerifier = new MemberSyncVerifier();
export default memberSyncVerifier;
