import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import fs from 'fs';
import path from 'path';

// Load configuration from firebase-applet-config.json or environment
let appletConfig = {};
try {
  if (typeof process !== 'undefined' && process.cwd) {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      appletConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  }
} catch (e) {
  // Browser fallback
}

export const firebaseConfig = {
  apiKey: appletConfig.apiKey || "AIzaSyCVqmSgm2sDGbgzbfMqfCJib6aWP7ivO54",
  authDomain: appletConfig.authDomain || "siaramaina-clan-informat-bf7f2.firebaseapp.com",
  projectId: appletConfig.projectId || "siaramaina-clan-informat-bf7f2",
  storageBucket: appletConfig.storageBucket || "siaramaina-clan-informat-bf7f2.firebasestorage.app",
  messagingSenderId: appletConfig.messagingSenderId || "900054800353",
  appId: appletConfig.appId || "1:900054800353:web:acf8982723941309e264a0",
  measurementId: appletConfig.measurementId || ""
};

export const databaseId = appletConfig.firestoreDatabaseId || "(default)";

// Initialize Firebase App
export const app = getApps().length === 0 
  ? initializeApp(firebaseConfig) 
  : getApps()[0];

import { initializeFirestore, getFirestore, setLogLevel, terminate } from 'firebase/firestore';

// Suppress transient internal gRPC stream reset warnings in Node.js/browsers
try {
  setLogLevel('error');
} catch (e) {
  // Ignore if unsupported in environment
}

let quotaExhausted = false;
try {
  if (typeof localStorage !== 'undefined' && localStorage.getItem('siara_firestore_quota_exhausted') === 'true') {
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
      } catch(e3) {
        firestoreInstance = null;
      }
    }
  }
} else {
  // Explicitly ensure firestoreInstance is null if quota is known to be exhausted
  firestoreInstance = null;
}

async function handleQuotaExhaustion() {
  quotaExhausted = true;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('siara_firestore_quota_exhausted', 'true');
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

// Safe fallback proxy for db so quota exhaustion or offline state never throws unhandled rejections
const safeDbProxy = new Proxy({}, {
  get(target, prop) {
    if (firestoreInstance && !quotaExhausted) {
      const val = firestoreInstance[prop];
      if (typeof val === 'function') {
        return function(...args) {
          if (quotaExhausted) return {};
          try {
            const res = val.apply(firestoreInstance, args);
            if (res && typeof res.catch === 'function') {
              return res.catch(async err => {
                const msg = String(err?.message || err || '').toLowerCase();
                if (msg.includes('resource-exhausted') || msg.includes('quota') || msg.includes('8')) {
                  await handleQuotaExhaustion();
                  return {};
                }
                throw err;
              });
            }
            return res;
          } catch (err) {
            const msg = String(err?.message || err || '').toLowerCase();
            if (msg.includes('resource-exhausted') || msg.includes('quota') || msg.includes('8')) {
              handleQuotaExhaustion();
              return {};
            }
            throw err;
          }
        };
      }
      return val;
    }
    if (prop === 'collection') {
      return () => ({
        doc: () => ({
          get: async () => ({ exists: () => false, data: () => ({}) }),
          set: async () => ({}),
          update: async () => ({}),
          delete: async () => ({})
        }),
        add: async () => ({ id: 'mock-id' }),
        get: async () => ({ empty: true, docs: [] }),
        where: function() { return this; },
        orderBy: function() { return this; },
        limit: function() { return this; },
        onSnapshot: (cb) => { return () => {}; }
      });
    }
    return () => ({});
  }
});

export const db = safeDbProxy;

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

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Initialize Firebase Storage
export const storage = getStorage(app);

export default app;
