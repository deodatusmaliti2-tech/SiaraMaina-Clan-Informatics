import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore, setLogLevel, terminate } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

try {
  setLogLevel('error');
} catch (e) {}

const databaseId = firebaseConfig.firestoreDatabaseId;

// Initialize Firebase App using provisioned config
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firestore targeting the dedicated clan database instance with resilient long polling
let dbInstance;
try {
  dbInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
  }, databaseId);
} catch (e) {
  try {
    dbInstance = getFirestore(app, databaseId);
  } catch (e2) {
    dbInstance = getFirestore(app);
  }
}
const db = dbInstance;

async function terminateFirestore() {
  if (dbInstance) {
    try {
      await terminate(dbInstance);
    } catch (err) {}
  }
}

const auth = getAuth(app);
const storage = getStorage(app);

export { app, db, auth, storage, firebaseConfig, databaseId, terminateFirestore };
export default app;
