import { collection, addDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase.js';

export const EVENT_TYPES = {
  AUTH_LOGIN: 'AUTH_LOGIN',
  AUTH_SIGNUP: 'AUTH_SIGNUP',
  AUTH_LOGOUT: 'AUTH_LOGOUT',
  AUTH_PASSWORD_RESET: 'AUTH_PASSWORD_RESET',
  GENEALOGY_CREATE: 'GENEALOGY_CREATE',
  GENEALOGY_UPDATE: 'GENEALOGY_UPDATE',
  GENEALOGY_DELETE: 'GENEALOGY_DELETE',
  ROLE_CHANGE: 'ROLE_CHANGE',
  SECURITY_ALERT: 'SECURITY_ALERT'
};

export async function logActivity(eventType, action, details = {}, targetId = null) {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    const actorUid = currentUser.uid;
    const actorEmail = currentUser.email || 'unknown@siaramaina.org';

    const logEntry = {
      eventType,
      action,
      actorUid,
      actorEmail,
      targetId: targetId || '',
      details: typeof details === 'string' ? details : JSON.stringify(details),
      timestamp: new Date().toISOString()
    };

    const logsRef = collection(db, 'ActivityLogs');
    const docRef = await addDoc(logsRef, logEntry);
    return docRef.id;
  } catch (error) {
    console.warn('[ActivityLogger] Error recording activity log:', error?.message || error);
    return null;
  }
}

export async function fetchRecentActivityLogs(maxLogs = 50) {
  const path = 'ActivityLogs';
  try {
    const logsRef = collection(db, path);
    const q = query(logsRef, orderBy('timestamp', 'desc'), limit(maxLogs));
    const snapshot = await getDocs(q);

    const logs = [];
    snapshot.forEach((doc) => {
      logs.push({ id: doc.id, ...doc.data() });
    });
    return logs;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}
