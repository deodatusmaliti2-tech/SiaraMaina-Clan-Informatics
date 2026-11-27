import fs from 'fs';
import path from 'path';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

console.log("=== Testing Firestore Write Member Operation ===");

const config = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8'));

const app = initializeApp({
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId
}, 'WriteTestApp');

const db = getFirestore(app, config.firestoreDatabaseId);

const testId = "test-member-" + Date.now();
const testRef = doc(db, "members", testId);

console.log(`Writing test member profile to Firestore path: members/${testId}...`);

await setDoc(testRef, {
  id: testId,
  firstName: "TestFirst",
  lastName: "TestLast",
  clanMemberNumber: "SMC-TEST-001",
  branchType: "siara",
  createdAt: new Date().toISOString()
});

console.log("✓ Write operation succeeded!");

console.log("Reading back written member from Firestore...");
const snap = await getDoc(testRef);

if (snap.exists()) {
  console.log("✓ Read-after-write verified! Data:", snap.data());
  // Cleanup test document
  await deleteDoc(testRef);
  console.log("✓ Cleanup completed.");
  console.log("=== FIRESTORE MEMBER WRITE TEST PASSED 100% ===");
} else {
  console.error("❌ Read-after-write failed: document not found.");
  process.exit(1);
}
