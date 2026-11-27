# SiaraMaina Clan Informatics - Security Rules Specification

## Data Invariants
1. **Default Deny**: No collection or subcollection is accessible unless explicitly matched and authorized.
2. **PII Isolation (`/users/{userId}`)**: A user profile document contains PII (`email`, `phone`, `location`) and RBAC privileges (`role`, `approved`, `active`). Only the document owner (`request.auth.uid == userId`) or an administrator (`isAdmin()`) may read it.
3. **Self-Registration Integrity**: Users creating their own `/users/{userId}` document must have `uid == request.auth.uid`, `role == 'viewer'`, and `approved == false` (unless the user is the verified master admin).
4. **Role Escalation Prevention**: Non-admin owners updating `/users/{userId}` cannot modify `uid`, `role`, `approved`, or `active`.
5. **Verified Admin Email**: Email-based master admin checks strictly require `request.auth.token.email_verified == true`.
6. **Immutable Audit Trail (`/ActivityLogs/{logId}`)**: Activity logs may only be created by authenticated actors matching `actorUid == request.auth.uid` (or admins), never updated or deleted.
7. **Genealogy Write Protection (`/members/{memberId}`, `/siaraMainaClan/{docId}`)**: Only authenticated Editors and Admins may create/update member records, and document IDs must pass `isValidId()`.
8. **Size & Type Validation**: All strings, arrays (`siblingIds`), and keys are bounded and type-checked.

## The "Dirty Dozen" Adversarial Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read on `/users/{userId}` (`request.auth == null`).
2. Unauthenticated list on `/users`.
3. Non-admin user reading another user's `/users/{otherUid}` document (PII leak).
4. Self-registration payload setting `role: "admin"` or `approved: true` as a regular user.
5. Non-admin user updating their own `/users/{uid}` to set `role: "admin"` or `approved: true`.
6. Shadow update on `/users/{uid}` injecting an unallowed ghost field (`isVerifiedAdmin: true`).
7. Spoofed email token (`email: "deodatusmaliti2@gmail.com"`, `email_verified: false`) attempting admin read/write.
8. Viewer role attempting to create or update `/members/{memberId}`.
9. Oversized document ID (`> 128` chars or containing invalid characters) on `/members/{id}`.
10. Oversized string field (e.g., `firstName` > 120 chars) or unbounded `siblingIds` array (`> 50` items) on `/members/{id}`.
11. Authenticated user attempting to `update` or `delete` an immutable `/ActivityLogs/{logId}` entry.
12. Authenticated user creating an `/ActivityLogs/{logId}` entry with `actorUid` spoofed to another user's UID.
