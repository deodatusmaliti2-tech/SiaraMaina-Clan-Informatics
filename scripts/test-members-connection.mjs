#!/usr/bin/env node

/**
 * ============================================================================
 * Firestore Connection & 'members' Collection Read Test
 * ============================================================================
 * Explicitly tests connection to the Firestore database using firebase-applet-config.json,
 * attempts to read from the 'members' collection, and logs all success or authentication/
 * permission errors to the console with detailed diagnostic information.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  getDocsFromServer,
  query,
  limit,
  doc,
  getDocFromServer,
  setLogLevel,
  terminate
} from 'firebase/firestore';

try {
  setLogLevel('error');
} catch (e) {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Terminal color helpers
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

console.log(`${colors.bold}${colors.cyan}====================================================================${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}  🔍 FIRESTORE CONNECTION & 'members' COLLECTION READ TEST          ${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}====================================================================${colors.reset}\n`);

// 1. Read and parse configuration from firebase-applet-config.json
const configPath = path.join(rootDir, 'firebase-applet-config.json');

if (!fs.existsSync(configPath)) {
  console.error(`${colors.red}❌ Error: Configuration file not found at: ${configPath}${colors.reset}`);
  process.exit(1);
}

let firebaseConfig;
try {
  const raw = fs.readFileSync(configPath, 'utf8');
  firebaseConfig = JSON.parse(raw);
  console.log(`${colors.green}✔ Successfully loaded configuration from firebase-applet-config.json${colors.reset}`);
  console.log(`  • Project ID:            ${colors.bold}${firebaseConfig.projectId}${colors.reset}`);
  console.log(`  • Firestore Database ID: ${colors.bold}${firebaseConfig.firestoreDatabaseId || '(default)'}${colors.reset}`);
  console.log(`  • Auth Domain:           ${firebaseConfig.authDomain}`);
  console.log(`  • API Key (Masked):      ${firebaseConfig.apiKey?.slice(0, 8)}...${firebaseConfig.apiKey?.slice(-4)}`);
} catch (err) {
  console.error(`${colors.red}❌ Error parsing firebase-applet-config.json: ${err.message}${colors.reset}`);
  process.exit(1);
}

// 2. Initialize Firebase App
let app;
try {
  const existingApps = getApps();
  app = existingApps.length > 0 ? existingApps[0] : initializeApp({
    apiKey: firebaseConfig.apiKey,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId
  }, 'MembersTestRunner');
  console.log(`\n${colors.green}✔ Firebase App initialized successfully.${colors.reset}`);
} catch (err) {
  console.error(`${colors.red}❌ Failed to initialize Firebase App: ${err.message}${colors.reset}`);
  process.exit(1);
}

// 3. Initialize Auth and Firestore
const auth = getAuth(app);
const databaseId = firebaseConfig.firestoreDatabaseId || 'ai-studio-siaramainaclanin-460807ca-5792-43ae-aa12-303da9af9152';

let db;
try {
  db = getFirestore(app, databaseId);
  console.log(`${colors.green}✔ Firestore instance created with database ID: ${colors.bold}${databaseId}${colors.reset}\n`);
} catch (err) {
  console.error(`${colors.red}❌ Failed to initialize Firestore with database ID '${databaseId}': ${err.message}${colors.reset}`);
  process.exit(1);
}

// 4. Log current authentication state
console.log(`${colors.bold}--- Authentication State ---${colors.reset}`);
if (auth.currentUser) {
  console.log(`  • User Status:   ${colors.green}Authenticated${colors.reset}`);
  console.log(`  • User UID:      ${auth.currentUser.uid}`);
  console.log(`  • Email:         ${auth.currentUser.email}`);
  console.log(`  • Email Verified:${auth.currentUser.emailVerified}`);
} else {
  console.log(`  • User Status:   ${colors.yellow}Unauthenticated (Anonymous / Guest)${colors.reset}`);
  console.log(`  • Note:          Reads on collections with 'allow read: if true;' succeed without signing in.`);
  console.log(`                   Collections requiring 'isSignedIn()' or specific roles will return PERMISSION_DENIED.`);
}

// 5. Explicit Test: Read from 'members' collection
console.log(`\n${colors.bold}--- Testing Read Operation: Collection 'members' ---${colors.reset}`);
const targetCollection = 'members';
const membersRef = collection(db, targetCollection);

async function runMembersReadTest() {
  const startTime = Date.now();
  
  try {
    console.log(`Attempting getDocsFromServer query on '${targetCollection}'...`);
    const q = query(membersRef, limit(20));
    
    // Explicitly query the server to test direct cloud connection
    const snapshot = await getDocsFromServer(q);
    const latency = Date.now() - startTime;

    console.log(`\n${colors.green}${colors.bold}====================================================================${colors.reset}`);
    console.log(`${colors.green}${colors.bold}  ✔ FIRESTORE READ SUCCESSFUL                                      ${colors.reset}`);
    console.log(`${colors.green}${colors.bold}====================================================================${colors.reset}`);
    console.log(`  • Target Collection:      ${colors.bold}${targetCollection}${colors.reset}`);
    console.log(`  • Database ID:            ${colors.bold}${databaseId}${colors.reset}`);
    console.log(`  • Round-trip Latency:     ${colors.bold}${latency} ms${colors.reset}`);
    console.log(`  • Documents Retrieved:    ${colors.bold}${snapshot.size}${colors.reset}`);
    console.log(`  • Is Empty:               ${snapshot.empty}`);

    if (!snapshot.empty) {
      console.log(`\n  ${colors.cyan}Retrieved Document Samples:${colors.reset}`);
      snapshot.docs.forEach((docSnap, index) => {
        const d = docSnap.data();
        const memberName = d.fullName || `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'No Name';
        console.log(`    [${index + 1}] ID: ${colors.bold}${docSnap.id}${colors.reset} | Name: ${memberName} | Branch: ${d.branchType || 'N/A'}`);
      });
    } else {
      console.log(`  • Detail:                 The 'members' collection exists and is accessible, but currently contains 0 individual documents.`);
      console.log(`                            (Note: The master genealogical ledger is maintained in 'siaraMainaClan/records')`);
    }

    // Also verify siaraMainaClan/records for complete diagnostic context
    console.log(`\n${colors.bold}--- Cross-Verification: Master Ledger 'siaraMainaClan/records' ---${colors.reset}`);
    const ledgerStart = Date.now();
    const ledgerDocRef = doc(db, 'siaraMainaClan', 'records');
    const ledgerSnap = await getDocFromServer(ledgerDocRef);
    const ledgerLatency = Date.now() - ledgerStart;

    if (ledgerSnap.exists()) {
      const data = ledgerSnap.data();
      const count = Array.isArray(data.records) ? data.records.length : 0;
      console.log(`${colors.green}✔ Master ledger 'siaraMainaClan/records' read verified (${ledgerLatency} ms)${colors.reset}`);
      console.log(`  • Total Clan Members in Cloud Ledger: ${colors.bold}${count}${colors.reset}`);
      console.log(`  • Last Updated: ${data.lastUpdated || data.exportedAt || 'N/A'}`);
    } else {
      console.log(`${colors.yellow}⚠ Master ledger 'siaraMainaClan/records' does not exist yet.${colors.reset}`);
    }

    console.log(`\n${colors.green}${colors.bold}✔ ALL FIRESTORE CONNECTION TESTS PASSED.${colors.reset}\n`);
    if (db) {
      try {
        await terminate(db);
      } catch (tErr) {}
    }
    process.exit(0);

  } catch (error) {
    const latency = Date.now() - startTime;
    const errorCode = error.code || 'unknown';
    const errorMessage = error.message || String(error);

    console.error(`\n${colors.red}${colors.bold}====================================================================${colors.reset}`);
    console.error(`${colors.red}${colors.bold}  ✖ FIRESTORE READ OPERATION FAILED                                 ${colors.reset}`);
    console.error(`${colors.red}${colors.bold}====================================================================${colors.reset}`);
    console.error(`  • Target Collection:      ${targetCollection}`);
    console.error(`  • Database ID:            ${databaseId}`);
    console.error(`  • Elapsed Time:           ${latency} ms`);
    console.error(`  • Error Code:             ${colors.bold}${errorCode}${colors.reset}`);
    console.error(`  • Error Message:          ${colors.red}${errorMessage}${colors.reset}`);

    // Contextual debugging advice based on error type
    console.log(`\n${colors.bold}--- Diagnostic Analysis & Troubleshooting ---${colors.reset}`);
    
    if (errorCode === 'permission-denied') {
      console.log(`${colors.yellow}Authentication / Permission Error Detected:${colors.reset}`);
      console.log(`  1. The security rule for 'match /members/{memberId}' may require authentication.`);
      console.log(`  2. Current request was made without an authenticated user.`);
      console.log(`  3. Check firestore.rules: Ensure 'allow read: if true;' is configured if public read is desired.`);
    } else if (errorMessage.includes('the client is offline') || errorCode === 'unavailable') {
      console.log(`${colors.yellow}Network / Connectivity Error Detected:${colors.reset}`);
      console.log(`  1. Check network connectivity or firewall rules to firestore.googleapis.com.`);
      console.log(`  2. Verify that the database '${databaseId}' exists in Firebase project '${firebaseConfig.projectId}'.`);
    } else if (errorCode === 'not-found') {
      console.log(`${colors.yellow}Database Not Found Error:${colors.reset}`);
      console.log(`  1. The database ID '${databaseId}' was not found in project '${firebaseConfig.projectId}'.`);
      console.log(`  2. Verify the firestoreDatabaseId in firebase-applet-config.json.`);
    } else {
      console.log(`  Stack trace:`);
      console.log(error.stack);
    }

    // Output standardized FirestoreErrorInfo JSON
    const firestoreErrorInfo = {
      error: errorMessage,
      errorCode: errorCode,
      operationType: 'list',
      path: targetCollection,
      databaseId: databaseId,
      projectId: firebaseConfig.projectId,
      authInfo: {
        userId: auth.currentUser?.uid || null,
        email: auth.currentUser?.email || null,
        emailVerified: auth.currentUser?.emailVerified || null,
        isAnonymous: auth.currentUser?.isAnonymous || null
      }
    };
    
    console.log(`\n${colors.dim}Structured Debug Payload:${colors.reset}`);
    console.log(JSON.stringify(firestoreErrorInfo, null, 2));

    process.exit(1);
  }
}

runMembersReadTest();
