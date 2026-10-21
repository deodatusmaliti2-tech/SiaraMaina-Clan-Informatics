import { logActivity, EVENT_TYPES } from './activityLogger.js';

/**
 * Service providing high-level helper functions to automatically record 
 * user actions to the Firestore 'ActivityLogs' collection.
 */
export const AutoAuditService = {
  /**
   * Capture User Login Action
   */
  async logUserLogin(user, provider = 'password') {
    return await logActivity(
      EVENT_TYPES.AUTH_LOGIN,
      `User signed in: ${user.email}`,
      {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || 'N/A',
        authProvider: provider
      },
      user.uid
    );
  },

  /**
   * Capture User Registration / Sign-Up Action
   */
  async logUserSignUp(user, initialRole = 'viewer') {
    return await logActivity(
      EVENT_TYPES.AUTH_SIGNUP,
      `New user account registered: ${user.email}`,
      {
        uid: user.uid,
        email: user.email,
        assignedRole: initialRole
      },
      user.uid
    );
  },

  /**
   * Capture User Logout Action
   */
  async logUserLogout(user) {
    return await logActivity(
      EVENT_TYPES.AUTH_LOGOUT,
      `User signed out: ${user?.email || 'Active User'}`,
      {
        uid: user?.uid || '',
        email: user?.email || ''
      },
      user?.uid || ''
    );
  },

  /**
   * Capture Administrative Role Change Action
   */
  async logRoleChange(targetUid, targetEmail, previousRole, newRole, updatedByEmail) {
    return await logActivity(
      EVENT_TYPES.ROLE_CHANGE,
      `Role updated for ${targetEmail}: ${previousRole} → ${newRole}`,
      {
        targetUid,
        targetEmail,
        previousRole,
        newRole,
        updatedBy: updatedByEmail
      },
      targetUid
    );
  },

  /**
   * Capture Clan Genealogy Creation
   */
  async logGenealogyDataCreated(memberId, memberName, details = {}) {
    return await logActivity(
      EVENT_TYPES.GENEALOGY_CREATE,
      `Clan member record created: ${memberName}`,
      { memberId, memberName, ...details },
      memberId
    );
  },

  /**
   * Capture Clan Genealogy Modification
   */
  async logGenealogyDataUpdated(memberId, memberName, changedFields = {}) {
    return await logActivity(
      EVENT_TYPES.GENEALOGY_UPDATE,
      `Clan member record modified: ${memberName}`,
      { memberId, memberName, changedFields },
      memberId
    );
  },

  /**
   * Capture Clan Genealogy Deletion
   */
  async logGenealogyDataDeleted(memberId, memberName) {
    return await logActivity(
      EVENT_TYPES.GENEALOGY_DELETE,
      `Clan member record deleted: ${memberName}`,
      { memberId, memberName },
      memberId
    );
  }
};

export default AutoAuditService;
