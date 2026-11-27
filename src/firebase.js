import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import {
  initializeFirestore,
  getFirestore,
  setLogLevel,
  terminate,
  doc,
  getDocFromServer
} from 'firebase/firestore';
import appletConfig from '../firebase-applet-config.json';

export const firebaseConfig = {
  apiKey: appletConfig.apiKey,
  authDomain: appletConfig.authDomain,
  projectId: appletConfig.projectId,
  storageBucket: appletConfig.storageBucket,
  messagingSenderId: appletConfig.messagingSenderId,
  appId: appletConfig.appId,
  measurementId: appletConfig.measurementId || ''
};

export const databaseId = appletConfig.firestoreDatabaseId || '(default)';

// Initialize Firebase App
export const app = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApp();

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Initialize Firebase Storage
export const storage = getStorage(app);

// Suppress transient internal gRPC stream reset warnings in Node.js/browsers
try {
  setLogLevel('error');
} catch (e) {
  // Ignore if unsupported in environment
}

let quotaExhausted = false;
try {
  if (
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('siara_firestore_quota_v2_date') === new Date().toISOString().slice(0, 10)
  ) {
    quotaExhausted = true;
  }
} catch (e) {}

// Initialize Firestore targeting the dedicated clan database instance with resilient fallback
let firestoreInstance = null;
if (!quotaExhausted) {
  try {
    firestoreInstance = initializeFirestore(app, {
      experimentalForceLongPolling: true,
    }, databaseId);
  } catch (e) {
    try {
      firestoreInstance = getFirestore(app, databaseId);
    } catch (e2) {
      try {
        firestoreInstance = getFirestore(app);
      } catch (e3) {
        firestoreInstance = null;
      }
    }
  }
}

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  if (!firestoreInstance || typeof window === 'undefined') return;
  try {
    await getDocFromServer(doc(firestoreInstance, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

async function handleQuotaExhaustion() {
  quotaExhausted = true;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('siara_firestore_quota_v2_date', new Date().toISOString().slice(0, 10));
    }
  } catch (e2) {}
  if (firestoreInstance) {
    try {
      await terminate(firestoreInstance);
    } catch (e) {
      console.warn('[Firestore Quota] Error terminating Firestore instance:', e);
    }
  }
  firestoreInstance = null;
  console.warn('[Firestore Quota] Daily free tier quota reached. Firestore terminated. Application gracefully utilizing local resilient storage.');
}

// Export Firestore instance directly so modular SDK functions (collection, doc, getDocs, etc.) work reliably
export const db = firestoreInstance || getFirestore(app, databaseId);

export { handleQuotaExhaustion };

/**
 * Gracefully terminates the Firestore instance, closing active gRPC/WebChannel streams.
 */
export async function terminateFirestore() {
  if (firestoreInstance) {
    try {
      await terminate(firestoreInstance);
    } catch (err) {
      // Ignore termination error on process teardown
    }
  }
}

export default app;
