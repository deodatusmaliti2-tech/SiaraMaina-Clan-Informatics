import { onAuthStateChanged } from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  limit 
} from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { logActivity, EVENT_TYPES } from './activityLogger.js';

let authUnsubscribe = null;
let collectionsUnsubscribes = [];
let previousUserState = null;
let initialCollectionsLoaded = {};

/**
 * Initializes real-time listener for Authentication state changes.
 */
export function initAuthAuditListener() {
  if (authUnsubscribe) return; // Already listening

  authUnsubscribe = onAuthStateChanged(auth, async (user) => {
    try {
      if (user && (!previousUserState || previousUserState.uid !== user.uid)) {
        await logActivity(
          EVENT_TYPES.AUTH_LOGIN,
          `User session authenticated: ${user.email}`,
          {
            uid: user.uid,
            email: user.email,
            providerId: user.providerData?.[0]?.providerId || 'password'
          },
          user.uid
        );
      } else if (!user && previousUserState) {
        await logActivity(
          EVENT_TYPES.AUTH_LOGOUT,
          `User session signed out: ${previousUserState.email}`,
          {
            uid: previousUserState.uid,
            email: previousUserState.email
          },
          previousUserState.uid
        );
      }
      previousUserState = user ? { uid: user.uid, email: user.email } : null;
    } catch (err) {
      console.error('Error in Auth Audit Listener:', err);
    }
  });
}

/**
 * Listens for real-time changes on specified Firestore collection.
 * Ignores initial load snapshot to only log live document changes.
 * 
 * @param {string} collectionName - e.g. 'users', 'clanMembers', 'genealogy'
 */
export function listenCollectionChanges(collectionName) {
  try {
    const colRef = collection(db, collectionName);
    initialCollectionsLoaded[collectionName] = false;

    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      // Skip initial snapshot fill
      if (!initialCollectionsLoaded[collectionName]) {
        initialCollectionsLoaded[collectionName] = true;
        return;
      }


      // Audit logging disabled to prevent quota exhaustion
      // snapshot.docChanges().forEach(async (change) => {
      //   const docData = change.doc.data();
      //   const docId = change.doc.id;
      //   const currentActor = auth.currentUser;
      //
      //   if (change.type === 'added') {
      //     await logActivity(
      //       `DOC_CREATED_${collectionName.toUpperCase()}`,
      //       `New document added in ${collectionName}: ${docId}`,
      //       { collection: collectionName, docId, summary: docData.name || docData.email || 'Document Created' },
      //       docId
      //     );
      //   } else if (change.type === 'modified') {
      //     await logActivity(
      //       `DOC_UPDATED_${collectionName.toUpperCase()}`,
      //       `Document modified in ${collectionName}: ${docId}`,
      //       { collection: collectionName, docId, updatedFields: Object.keys(docData) },
      //       docId
      //     );
      //   } else if (change.type === 'removed') {
      //     await logActivity(
      //       `DOC_DELETED_${collectionName.toUpperCase()}`,
      //       `Document deleted from ${collectionName}: ${docId}`,
      //       { collection: collectionName, docId },
      //       docId
      //     );
      //   }
      // });

    }, (error) => {
      const msg = error?.message || String(error || '');
      if (error?.code === 'unavailable' || error?.code === 14 || msg.includes('ECONNRESET') || msg.includes('UNAVAILABLE')) {
        console.warn(`[AuditListener] Transient stream reset on '${collectionName}' (auto-reconnecting):`, msg);
      } else {
        console.warn(`Audit listener notice on collection '${collectionName}':`, error);
      }
    });

    collectionsUnsubscribes.push(unsubscribe);
    return unsubscribe;
  } catch (err) {
    console.error(`Failed to register audit listener for collection '${collectionName}':`, err);
  }
}

/**
 * Initializes full audit monitoring across Auth and key Firestore collections.
 */
export function startAuditMonitoring(monitoredCollections = ['users', 'clanMembers', 'genealogy']) {
  initAuthAuditListener();
  monitoredCollections.forEach(colName => listenCollectionChanges(colName));
  console.log('🛡️ Real-time Activity Audit Monitoring active.');
}

/**
 * Stops all active audit listeners.
 */
export function stopAuditMonitoring() {
  if (authUnsubscribe) {
    authUnsubscribe();
    authUnsubscribe = null;
  }
  collectionsUnsubscribes.forEach(unsub => unsub());
  collectionsUnsubscribes = [];
  initialCollectionsLoaded = {};
  console.log('⏹️ Activity Audit Monitoring stopped.');
}
