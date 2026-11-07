import { 
  doc, 
  getDoc, 
  writeBatch, 
  collection, 
  getDocs,
  query,
  limit
} from 'firebase/firestore';
import { db, auth } from '../firebase.js';
import { logActivity, EVENT_TYPES } from './activityLogger.js';

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

/**
 * Standardized Firestore error handler adhering to skill specification
 */
export function handleFirestoreError(error, operationType, path, authInstance = auth) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    errorCode: error?.code || 'unknown',
    operationType,
    path,
    authInfo: {
      userId: authInstance?.currentUser?.uid || null,
      email: authInstance?.currentUser?.email || null,
      emailVerified: authInstance?.currentUser?.emailVerified || null,
      isAnonymous: authInstance?.currentUser?.isAnonymous || null
    }
  };
  console.error('[Firestore Migration Error]:', JSON.stringify(errInfo, null, 2));
  const wrapped = new Error(JSON.stringify(errInfo));
  wrapped.code = error?.code;
  wrapped.originalError = error;
  throw wrapped;
}

/**
 * Migrates data from the 'siaraMainaClan/records' document into individual
 * document entries within the 'members' collection.
 * 
 * @param {Object} [options]
 * @param {import('firebase/firestore').Firestore} [options.dbInstance] - Optional Firestore instance
 * @param {boolean} [options.merge=true] - Whether to merge with existing member data
 * @param {function} [options.onProgress] - Optional progress callback ({ current, total, percent })
 * @returns {Promise<{ success: boolean, totalRecords: number, migratedCount: number, error?: string }>}
 */
export async function migrateLedgerToMembers(options = {}) {
  const firestore = options.dbInstance || db;
  const shouldMerge = options.merge !== false;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

  const ledgerPath = 'siaraMainaClan/records';
  const membersPath = 'members';

  console.log(`[Migration] Starting data migration from '${ledgerPath}' to '/${membersPath}' collection...`);

  // 1. Fetch master ledger document
  let ledgerSnapshot;
  try {
    const ledgerDocRef = doc(firestore, 'siaraMainaClan', 'records');
    ledgerSnapshot = await getDoc(ledgerDocRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, ledgerPath);
  }

  if (!ledgerSnapshot || !ledgerSnapshot.exists()) {
    const notFoundError = new Error(`Master ledger document at '${ledgerPath}' was not found in Firestore.`);
    handleFirestoreError(notFoundError, OperationType.GET, ledgerPath);
  }

  const ledgerData = ledgerSnapshot.data();
  const rawRecords = Array.isArray(ledgerData.records) ? ledgerData.records : [];

  if (rawRecords.length === 0) {
    console.warn(`[Migration] Master ledger '${ledgerPath}' has 0 records to migrate.`);
    return {
      success: true,
      totalRecords: 0,
      migratedCount: 0,
      message: 'Master ledger has no records to migrate.'
    };
  }

  console.log(`[Migration] Found ${rawRecords.length} records in master ledger. Preparing batch writes to '/${membersPath}'...`);

  // 2. Perform batched writes (Firestore limits batches to 500 writes per batch)
  const BATCH_SIZE = 400; // conservative batch ceiling
  const nowTimestamp = new Date().toISOString();
  let migratedCount = 0;

  for (let i = 0; i < rawRecords.length; i += BATCH_SIZE) {
    const chunk = rawRecords.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(firestore);

    for (const record of chunk) {
      if (!record || !record.id) {
        console.warn(`[Migration] Skipping invalid record lacking 'id':`, record);
        continue;
      }

      const memberDocRef = doc(firestore, membersPath, String(record.id));
      
      // Calculate normalized full name if missing
      const fullName = record.fullName || 
        `${record.firstName || ''} ${record.middleName || ''} ${record.lastName || ''}`.replace(/\s+/g, ' ').trim() ||
        'Unnamed Member';

      const memberPayload = {
        ...record,
        id: String(record.id),
        fullName: fullName,
        migratedAt: nowTimestamp,
        migratedFrom: ledgerPath,
        updatedAt: nowTimestamp,
        lastModifiedByUid: auth.currentUser ? auth.currentUser.uid : 'system_migration'
      };

      batch.set(memberDocRef, memberPayload, { merge: shouldMerge });
      migratedCount++;
    }

    try {
      await batch.commit();
      onProgress({
        current: Math.min(i + BATCH_SIZE, rawRecords.length),
        total: rawRecords.length,
        percent: Math.round((Math.min(i + BATCH_SIZE, rawRecords.length) / rawRecords.length) * 100)
      });
      console.log(`[Migration] Successfully committed batch: ${migratedCount} / ${rawRecords.length} members.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, membersPath);
    }
  }

  // 3. Log administrative activity for audit trail
  try {
    await logActivity(
      EVENT_TYPES.GENEALOGY_UPDATE,
      `Migrated ${migratedCount} members from '${ledgerPath}' into '/${membersPath}' individual documents.`,
      { totalRecords: rawRecords.length, migratedCount, timestamp: nowTimestamp }
    );
  } catch (logErr) {
    console.warn('[Migration] Non-fatal notice: Failed to record audit log entry:', logErr);
  }

  console.log(`[Migration] 🎉 Successfully migrated all ${migratedCount} members into individual documents in '/${membersPath}'!`);

  return {
    success: true,
    totalRecords: rawRecords.length,
    migratedCount,
    timestamp: nowTimestamp
  };
}

/**
 * Validates and verifies that the 'members' collection reflects the data in 'siaraMainaClan/records'.
 * 
 * @param {import('firebase/firestore').Firestore} [dbInstance]
 * @returns {Promise<{ matches: boolean, ledgerCount: number, membersCount: number }>}
 */
export async function verifyMembersMigration(dbInstance = db) {
  try {
    // 1. Check ledger
    const ledgerDocRef = doc(dbInstance, 'siaraMainaClan', 'records');
    const ledgerSnap = await getDoc(ledgerDocRef);
    const ledgerCount = ledgerSnap.exists() && Array.isArray(ledgerSnap.data().records) 
      ? ledgerSnap.data().records.length 
      : 0;

    // 2. Check members collection
    const membersColRef = collection(dbInstance, 'members');
    const membersSnap = await getDocs(membersColRef);
    const membersCount = membersSnap.size;

    return {
      matches: ledgerCount > 0 && ledgerCount === membersCount,
      ledgerCount,
      membersCount,
      delta: Math.abs(ledgerCount - membersCount)
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'members');
  }
}
