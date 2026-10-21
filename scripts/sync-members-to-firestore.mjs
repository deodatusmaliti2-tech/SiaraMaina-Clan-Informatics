#!/usr/bin/env node
/**
 * SiaraMaina Clan Informatics - Member Collection Synchronizer
 * 
 * Synchronizes all 80 clan records from siara-maina-clan-data.json
 * into individual documents in the Firestore '/members' collection.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, setDoc, writeBatch, collection, getDocs, terminate, setLogLevel } from 'firebase/firestore';

try {
  setLogLevel('error');
} catch (e) {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const configPath = path.join(rootDir, 'firebase-applet-config.json');
const clanDataPath = path.join(rootDir, 'siara-maina-clan-data.json');

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const clanData = JSON.parse(fs.readFileSync(clanDataPath, 'utf8'));
const records = clanData.records || [];

const databaseId = config.firestoreDatabaseId || 'ai-studio-siaramainaclanin-460807ca-5792-43ae-aa12-303da9af9152';

console.log("=======================================================================");
console.log("  🌿 SiaraMaina Clan Informatics: Member Synchronizer                 ");
console.log("=======================================================================");
console.log(`Database ID: ${databaseId}`);
console.log(`Project ID:  ${config.projectId}`);
console.log(`Total Clan Records to Sync: ${records.length}`);

const existingApps = getApps();
const app = existingApps.length > 0 ? existingApps[0] : initializeApp({
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId
}, 'MembersSyncApp_' + Date.now());

const db = getFirestore(app, databaseId);

async function syncMembers() {
  console.log("\nStarting batch commit to '/members' collection...");
  const startTime = Date.now();

  // Firestore batches have a limit of 500 operations. We have 80 records.
  const batchSize = 100;
  let batch = writeBatch(db);
  let batchCount = 0;
  let totalCommitted = 0;

  for (let i = 0; i < records.length; i++) {
    const member = records[i];
    if (!member || !member.id) continue;

    const memberDocRef = doc(db, 'members', member.id);
    
    // Clean data record with standard metadata
    const memberData = {
      ...member,
      id: member.id,
      fullName: member.fullName || `${member.firstName || ''} ${member.lastName || ''}`.trim(),
      syncedAt: new Date().toISOString(),
      syncSource: 'siara-maina-clan-data.json'
    };

    batch.set(memberDocRef, memberData, { merge: true });
    batchCount++;

    if (batchCount >= batchSize) {
      await batch.commit();
      totalCommitted += batchCount;
      console.log(`  ✔ Committed batch of ${batchCount} documents (Total: ${totalCommitted})`);
      batch = writeBatch(db);
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    totalCommitted += batchCount;
    console.log(`  ✔ Committed final batch of ${batchCount} documents (Total: ${totalCommitted})`);
  }

  const duration = Date.now() - startTime;
  console.log(`\n🎉 Synchronized ${totalCommitted} documents to '/members' in ${duration}ms!`);

  // Verification step
  console.log("\n--- Verifying '/members' Collection Count ---");
  const membersRef = collection(db, 'members');
  const snap = await getDocs(membersRef);
  console.log(`✔ Verification count: ${snap.size} documents found in '/members'.`);

  if (snap.size >= 80) {
    console.log("✅ All 80 clan members successfully populated in '/members' collection!");
  } else {
    console.warn(`⚠️ Count mismatch: expected at least 80, found ${snap.size}`);
  }

  if (db) {
    try {
      await terminate(db);
    } catch (e) {}
  }
}

syncMembers().catch(async (err) => {
  console.error("❌ Synchronization failed:", err);
  if (db) {
    try {
      await terminate(db);
    } catch (e) {}
  }
  process.exit(1);
});
