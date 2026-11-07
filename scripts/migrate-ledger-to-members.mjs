#!/usr/bin/env node
/**
 * SiaraMaina Clan Informatics - Ledger to Members Migration Runner
 * 
 * Migrates data from the 'siaraMainaClan/records' Firestore document into
 * individual document entries within the 'members' collection.
 * 
 * Usage: node scripts/migrate-ledger-to-members.mjs
 */

import { migrateLedgerToMembers, verifyMembersMigration } from '../src/services/memberMigrationService.js';
import { db } from '../src/firebase.js';

console.log("=======================================================================");
console.log("  🌿 SiaraMaina Clan Informatics: Ledger ➔ Members Migration Utility   ");
console.log("=======================================================================");

async function run() {
  const startTime = Date.now();
  try {
    console.log("Starting migration process...");
    const result = await migrateLedgerToMembers({
      dbInstance: db,
      merge: true,
      onProgress: ({ current, total, percent }) => {
        process.stdout.write(`  ⏳ Progress: ${current}/${total} (${percent}%)\r`);
      }
    });

    console.log("\n");
    console.log("✔ Migration completed successfully!");
    console.log(`  • Total Master Records: ${result.totalRecords}`);
    console.log(`  • Migrated Documents:   ${result.migratedCount}`);
    console.log(`  • Elapsed Time:         ${Date.now() - startTime} ms`);

    console.log("\n--- Verifying Migration State ---");
    const verification = await verifyMembersMigration(db);
    console.log(`  • Ledger Count:         ${verification.ledgerCount}`);
    console.log(`  • Members Count:        ${verification.membersCount}`);
    console.log(`  • Consistency Match:    ${verification.matches ? '✅ PERFECT MATCH (80/80)' : '⚠️ MISMATCH'}`);

    console.log("\n=======================================================================");
    console.log("  🎉 Data migration from 'siaraMainaClan/records' to '/members' COMPLETE ");
    console.log("=======================================================================\n");
    if (db) {
      try {
        await terminate(db);
      } catch (tErr) {}
    }
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    if (db) {
      try {
        await terminate(db);
      } catch (tErr) {}
    }
    process.exit(1);
  }
}

run();
