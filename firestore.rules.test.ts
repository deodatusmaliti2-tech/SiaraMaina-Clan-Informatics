/**
 * Firestore Security Rules Adversarial Specification Tests
 * Validates the "Dirty Dozen" security invariants against firestore.rules.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid?: string; email?: string; email_verified?: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated read on /users/{userId}',
    collection: 'users/user_1',
    operation: 'get',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unauthenticated list on /users',
    collection: 'users',
    operation: 'list',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Non-admin reading another user PII document',
    collection: 'users/other_uid',
    operation: 'get',
    auth: { uid: 'viewer_uid', email: 'viewer@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Self-registration privilege escalation (role: admin)',
    collection: 'users/attacker_uid',
    operation: 'create',
    auth: { uid: 'attacker_uid', email: 'attacker@example.com', email_verified: true },
    payload: { uid: 'attacker_uid', email: 'attacker@example.com', displayName: 'Attacker', role: 'admin', approved: true, active: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Owner self-update escalating role to admin',
    collection: 'users/viewer_uid',
    operation: 'update',
    auth: { uid: 'viewer_uid', email: 'viewer@example.com', email_verified: true },
    payload: { role: 'admin', approved: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Shadow update injecting ghost field on /users/{uid}',
    collection: 'users/viewer_uid',
    operation: 'update',
    auth: { uid: 'viewer_uid', email: 'viewer@example.com', email_verified: true },
    payload: { displayName: 'Viewer', isVerifiedAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Unverified admin email spoof attack',
    collection: 'users/viewer_uid',
    operation: 'get',
    auth: { uid: 'spoof_uid', email: 'deodatusmaliti2@gmail.com', email_verified: false },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Viewer attempting write to /members/{memberId}',
    collection: 'members/rec_1',
    operation: 'create',
    auth: { uid: 'viewer_uid', email: 'viewer@example.com', email_verified: true },
    payload: { id: 'rec_1', firstName: 'Test', lastName: 'Member' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Invalid oversized ID on /members/{memberId}',
    collection: `members/${'a'.repeat(130)}`,
    operation: 'create',
    auth: { uid: 'admin_uid', email: 'deodatusmaliti2@gmail.com', email_verified: true },
    payload: { id: 'a'.repeat(130), firstName: 'Test', lastName: 'Member' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Unbounded siblingIds array on /members/{memberId}',
    collection: 'members/rec_1',
    operation: 'create',
    auth: { uid: 'admin_uid', email: 'deodatusmaliti2@gmail.com', email_verified: true },
    payload: { id: 'rec_1', firstName: 'Test', lastName: 'Member', siblingIds: Array.from({ length: 60 }, (_, i) => `s_${i}`) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Attempt to mutate immutable ActivityLogs document',
    collection: 'ActivityLogs/log_1',
    operation: 'update',
    auth: { uid: 'admin_uid', email: 'deodatusmaliti2@gmail.com', email_verified: true },
    payload: { action: 'Tampered' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Spoofed actorUid when creating ActivityLogs document',
    collection: 'ActivityLogs/log_2',
    operation: 'create',
    auth: { uid: 'viewer_uid', email: 'viewer@example.com', email_verified: true },
    payload: { eventType: 'AUTH_LOGIN', actorUid: 'admin_uid', actorEmail: 'deodatusmaliti2@gmail.com', timestamp: '2026-11-24T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
];
