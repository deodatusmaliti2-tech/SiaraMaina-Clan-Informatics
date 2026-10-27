import { collection, addDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db, auth } from '../firebase.js';

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

/**
 * Log an activity or security event to the ActivityLogs collection in Firestore
 * 
 * @param {string} eventType - The classification of the event (from EVENT_TYPES)
 * @param {string} action - Human-readable description
 * @param {Object} [details] - Additional contextual data or metadata
 * @param {string} [targetId] - Target member ID or document ID
 */
export async function logActivity(eventType, action, details = {}, targetId = null) {
  try {
    const currentUser = auth.currentUser;
    const actorUid = currentUser ? currentUser.uid : 'anonymous_or_system';
    const actorEmail = currentUser ? currentUser.email : 'system@siaramaina.org';

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
    console.log(`[ActivityLogger] Event logged successfully: ${eventType} (ID: ${docRef.id})`);
    return docRef.id;
  } catch (error) {
    console.error('[ActivityLogger] Error recording activity log:', error);
    // Non-blocking fallback to local console
    return null;
  }
}

/**
 * Fetch recent activity logs (Restricted to Admins)
 * @param {number} maxLogs 
 */
export async function fetchRecentActivityLogs(maxLogs = 50) {
  try {
    const logsRef = collection(db, 'ActivityLogs');
    const q = query(logsRef, orderBy('timestamp', 'desc'), limit(maxLogs));
    const snapshot = await getDocs(q);
    
    const logs = [];
    snapshot.forEach((doc) => {
      logs.push({ id: doc.id, ...doc.data() });
    });
    return logs;
  } catch (error) {
    console.error('[ActivityLogger] Error fetching activity logs:', error);
    throw error;
  }
}
