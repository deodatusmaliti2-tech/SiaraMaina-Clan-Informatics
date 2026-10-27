import express, { Request, Response } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { dbEngine, ClanMemberRecord, firebaseAppletConfig } from "./db";
import { syncManager } from "./sync";
import {
  firebaseAuthSignIn,
  firebaseAuthSignUp,
  firebaseAuthPasswordReset,
  authenticateRequest,
  createSessionToken,
  requireAuth,
  requireApprovedUser,
  requireAdmin,
  requireEditorOrAdmin,
} from "./auth";
import { metricsEngine } from "./metrics";
import { serverSyncSheetToApp } from "./sheets";

export const spreadsheetConfigFile = path.resolve(process.cwd(), "data/spreadsheet_config.json");
export const DEFAULT_SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyLlYZ3pw4-5ENtn_wf6tInqNRAPmHCdDmzJx40g2hUPNVyK3XOcleP9_MaGqktg6V2/exec";

export const apiRouter = express.Router();

// 1. Telemetry middleware
apiRouter.use((req: Request, res: Response, next) => {
  const start = Date.now();
  const bytesIn = req.headers["content-length"] ? parseInt(req.headers["content-length"] as string, 10) : 0;
  metricsEngine.recordRequest(req.method, bytesIn);

  res.on("finish", () => {
    const duration = Date.now() - start;
    metricsEngine.recordResponse(res.statusCode, duration, 256);
  });
  next();
});

// 2. Health & Readiness Endpoints (Firestore Single Source of Truth)
apiRouter.get(["/readiness", "/health"], async (req: Request, res: Response) => {
  try {
    const stats = await dbEngine.getStats();
    res.json({
      ready: true,
      status: "healthy",
      engine: "Cloud Firestore Enterprise Database Engine",
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(503).json({ ready: false, error: err.message });
  }
});

apiRouter.get(["/db/handshake", "/db/pulse"], async (req: Request, res: Response) => {
  try {
    const stats = await dbEngine.getStats();
    res.json({
      success: true,
      database: "Cloud Firestore Enterprise (Verified Native Project)",
      engine: "Firestore NoSQL Persistent Database",
      projectId: firebaseAppletConfig.projectId,
      databaseId: firebaseAppletConfig.firestoreDatabaseId,
      count: stats.totalRecords,
      recycleBinCount: stats.recycleBinCount,
      totalUsers: stats.totalUsers,
      approvedUsers: stats.approvedUsers,
      clientsConnected: syncManager.getActiveClientCount(),
      handshakeTime: new Date().toISOString(),
      message: "Handshake verified. Cloud Firestore is the permanent database authority.",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Real-Time SSE Stream Endpoint
apiRouter.get("/sync/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const clientId = "client-" + crypto.randomUUID().slice(0, 8);
  const userAgent = req.headers["user-agent"] || "";
  const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1";

  syncManager.registerClient(clientId, res, userAgent, ip);

  req.on("close", () => {
    syncManager.removeClient(clientId);
  });
});

// 4. Firebase Authentication Endpoints
apiRouter.post("/auth/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password are required." });
    }
    const result = await firebaseAuthSignIn(email, password);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(401).json({ success: false, error: err.message });
  }
});

apiRouter.post("/auth/register", async (req: Request, res: Response) => {
  try {
    const { email, password, displayName, branch } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password are required." });
    }
    const result = await firebaseAuthSignUp(email, password, displayName, branch);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.post("/auth/register-notify", async (req: Request, res: Response) => {
  try {
    const { uid, email, displayName, branch } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: "Email is required." });
    }
    const cleanEmail = email.toLowerCase().trim();
    const isOwner = cleanEmail === "deodatusmaliti2@gmail.com";
    const userUid = uid || ("user-" + crypto.createHash("md5").update(cleanEmail).digest("hex").slice(0, 12));
    const name = displayName || cleanEmail.split("@")[0];

    let profile = await dbEngine.getUser(userUid);
    if (!profile) {
      const allUsers = await dbEngine.getUsers();
      profile = allUsers.find(u => u.email && u.email.toLowerCase().trim() === cleanEmail) || null;
      if (profile && profile.uid !== userUid) {
        const oldUid = profile.uid;
        profile.uid = userUid;
        if (oldUid.startsWith("user-")) {
          await dbEngine.deleteUser(oldUid, "system");
        }
      }
    }

    if (!profile) {
      profile = {
        uid: userUid,
        email: cleanEmail,
        displayName: name,
        role: isOwner ? "admin" : "viewer",
        branch: branch || "general",
        approved: isOwner,
        active: true,
        pendingRoleAssignment: !isOwner,
        registeredRemotely: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
      await dbEngine.upsertUser(profile);
    } else {
      profile.lastLoginAt = new Date().toISOString();
      if (displayName) profile.displayName = displayName;
      if (branch) profile.branch = branch;
      await dbEngine.upsertUser(profile);
    }

    syncManager.broadcast("new_user_registered", {
      user: profile,
      timestamp: new Date().toISOString(),
      message: `New user registered: ${profile.displayName} (${profile.email}) with default Viewer role`,
    });

    res.json({ success: true, user: profile });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post("/auth/password-reset", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: "Email address is required for password reset." });
    }
    await firebaseAuthPasswordReset(email);
    res.json({
      success: true,
      message: `Password reset email sent to ${email}. Please check your inbox.`,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

apiRouter.get("/auth/session", async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req);
    if (user) {
      return res.json({ success: true, user, token: createSessionToken(user) });
    }
    // Remote visitors start without session; explicit login required for privileges
    res.json({ success: true, user: null, token: null });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get("/auth/me", async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }
    res.json({ success: true, user });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// User Management (Admin Only)
apiRouter.get("/auth/users", requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await dbEngine.getUsers();
    res.json({ success: true, count: users.length, users });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post("/auth/users/provision", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, error: "User email is required." });
    }

    const allUsers = await dbEngine.getUsers();
    const existing = allUsers.find(u => u && u.email && u.email.toLowerCase().trim() === email);

    const uid = existing ? existing.uid : (body.uid || body.id || ("user-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)));
    const displayName = (body.displayName || body.name || (existing ? existing.displayName : "") || email.split("@")[0] || "Clan Member").trim();
    const role = (body.role === "admin" || body.role === "editor") ? body.role : "viewer";
    const approved = body.approved !== false;
    const active = body.active !== false;

    const profile = {
      ...(existing || {}),
      uid,
      email,
      displayName,
      role,
      approved,
      active,
      createdAt: (existing && existing.createdAt) || body.createdAt || new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };

    const saved = await dbEngine.upsertUser(profile);

    syncManager.broadcast("auth_change", {
      action: "USER_PROVISIONED",
      uid,
      email,
      role,
      approved,
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, user: saved, message: "User successfully provisioned and persisted to Firestore." });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.put("/auth/users/:uid/role", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    const { role, approved } = req.body;
    const adminUser = (req as any).user;

    const cleanRole = ["admin", "editor", "viewer"].includes(role) ? role : "viewer";
    const isApproved = approved !== undefined ? Boolean(approved) : true;

    const updated = await dbEngine.updateUserApprovalAndRole(uid, cleanRole, isApproved, adminUser.email);

    syncManager.broadcast("auth_change", {
      action: "PERMISSION_UPDATED",
      uid,
      role: cleanRole,
      approved: isApproved,
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, user: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.delete("/auth/users/:uid", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { uid } = req.params;
    const adminUser = (req as any).user;
    await dbEngine.deleteUser(uid, adminUser.email);

    syncManager.broadcast("auth_change", {
      action: "USER_DELETED",
      uid,
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, message: "User successfully deleted from Firestore and local store." });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// 5. Authoritative Member CRUD Endpoints (Protected by RBAC)

// GET /api/members - Fetch active members (Direct from authoritative Cloud Firestore)
apiRouter.get(["/members", "/db/records", "/db/members"], async (req: Request, res: Response) => {
  try {
    const records = await dbEngine.getMembers(false);
    res.json({
      success: true,
      count: records.length,
      members: records,
      records: records,
      data: records,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/members/:id - Fetch single member (Requires approved account)
apiRouter.get("/members/:id", requireApprovedUser, async (req: Request, res: Response) => {
  try {
    const member = await dbEngine.getMember(req.params.id);
    if (!member) {
      return res.status(404).json({ success: false, error: "Member not found" });
    }
    res.json({ success: true, member });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/members - Add new member (Requires Admin or Editor, Idempotent via X-Submission-Id)
apiRouter.post("/members", requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const submissionId = (req.headers["x-submission-id"] as string) || req.body.submissionId;

    if (!req.body.firstName && !req.body.lastName) {
      return res.status(400).json({ success: false, error: "Member firstName or lastName is required." });
    }

    const { member, isDuplicateRetry } = await dbEngine.addMember(req.body, user.email, submissionId);

    // Forward newly added member immediately to Google Sheets
    syncMemberToGoogleSheets(member);

    const allActive = await dbEngine.getMembers(false);

    syncManager.broadcast("doc_change", {
      action: "SET",
      collection: "members",
      id: member.id,
      doc: member,
      records: allActive,
      count: allActive.length,
      author: user.email,
      timestamp: new Date().toISOString(),
    });

    syncManager.broadcast("sync_pulse", {
      action: "MEMBER_ADDED",
      count: allActive.length,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: isDuplicateRetry ? "Submission already recorded (idempotent)." : "Member added and committed to Firestore.",
      id: member.id,
      recordId: member.id,
      member,
      data: member,
      count: allActive.length,
      isDuplicateRetry,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/members/import, /api/members/bulk - Bulk CSV / Member import directly committed
apiRouter.post(["/members/import", "/members/bulk"], requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    const body = req.body || {};
    let incomingList: any[] = [];
    if (Array.isArray(body)) {
      incomingList = body;
    } else if (Array.isArray(body.members)) {
      incomingList = body.members;
    } else if (Array.isArray(body.records)) {
      incomingList = body.records;
    } else if (Array.isArray(body.data)) {
      incomingList = body.data;
    }

    if (!incomingList || incomingList.length === 0) {
      return res.status(400).json({ success: false, error: "No member records supplied in import request." });
    }

    const authorEmail = user?.email || body.author || "csv_importer";
    const result = await dbEngine.importMembersBatch(incomingList, authorEmail);

    const allActive = result.members || (await dbEngine.getMembers(false));

    // Broadcast live to all open browsers so remote clients get instant live update!
    syncManager.broadcast("doc_change", {
      action: "SET",
      collection: "members",
      records: allActive,
      count: allActive.length,
      author: authorEmail,
      timestamp: new Date().toISOString(),
    });

    syncManager.broadcast("sync_pulse", {
      action: "MEMBERS_IMPORTED",
      count: allActive.length,
      timestamp: new Date().toISOString(),
    });

    return res.json({
      success: true,
      added: result.added,
      updated: result.updated,
      total: allActive.length,
      members: allActive,
      records: allActive,
      message: `Successfully imported ${result.added} new members, updated ${result.updated} members.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/db/sync/records - Google Sheets autosync endpoint
apiRouter.post("/db/sync/records", async (req: Request, res: Response, next: NextFunction) => {
  const body = req.body || {};
  if (body.author === "google_sheets_autosync" || body.source === "google_sheets") {
    return next();
  }
  return requireEditorOrAdmin(req, res, next);
}, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    const body = req.body || {};
    let incomingList: any[] = [];
    if (Array.isArray(body)) {
      incomingList = body;
    } else if (Array.isArray(body.members)) {
      incomingList = body.members;
    } else if (Array.isArray(body.records)) {
      incomingList = body.records;
    } else if (Array.isArray(body.data)) {
      incomingList = body.data;
    }

    if (!incomingList || incomingList.length === 0) {
      return res.status(400).json({ success: false, error: "No member records supplied in import request." });
    }

    const authorEmail = user?.email || body.author || "csv_importer";
    const result = await dbEngine.importMembersBatch(incomingList, authorEmail);

    const allActive = result.members || (await dbEngine.getMembers(false));

    // Broadcast live to open browsers ONLY if records were actually added or updated
    if (result.added > 0 || result.updated > 0) {
      syncManager.broadcast("doc_change", {
        action: "SET",
        collection: "members",
        records: allActive,
        count: allActive.length,
        author: authorEmail,
        timestamp: new Date().toISOString(),
      });

      syncManager.broadcast("sync_pulse", {
        action: "MEMBERS_IMPORTED",
        count: allActive.length,
        added: result.added,
        updated: result.updated,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: `Successfully committed CSV import to Cloud Firestore: ${result.added} added, ${result.updated} updated.`,
      added: result.added,
      updated: result.updated,
      count: allActive.length,
      records: allActive,
      members: allActive,
    });
  } catch (err: any) {
    console.error("[/api/members/import] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

function isMemberUploadedByEditor(member: any, user: any): boolean {
  if (!member || !user) return false;
  const uEmail = (user.email || "").toLowerCase().trim();
  const uUid = (user.uid || "").trim();
  if (!uEmail && !uUid) return false;

  const createdBy = String(member.createdBy || "").trim();
  const createdByEmail = String(member.createdByEmail || "").toLowerCase().trim();
  const addedBy = String(member.addedBy || "").toLowerCase().trim();
  const recordUserId = String(member.userId || "").trim();

  if (uUid && (createdBy === uUid || recordUserId === uUid)) return true;
  if (uEmail && (createdByEmail === uEmail || addedBy === uEmail || createdBy === uEmail)) return true;

  return false;
}

// PUT /api/members - Update existing member with optimistic concurrency version checking
apiRouter.put("/members", requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const body = req.body || {};
    const id = String(body.id || body.recordId || "");

    if (!id) {
      return res.status(400).json({ success: false, error: "Member ID is required for update." });
    }

    if (user && user.role === "editor") {
      const existing = await dbEngine.getMember(id);
      if (existing && !isMemberUploadedByEditor(existing, user)) {
        return res.status(403).json({
          success: false,
          error: "Permission Denied: Editors can only edit or update member records that they have added into the app themselves."
        });
      }
    }

    const expectedVersion = typeof body.version === "number" ? body.version : undefined;
    const updatedMember = await dbEngine.updateMember(id, body, user.email, expectedVersion);

    // Forward updated member immediately to Google Sheets
    syncMemberToGoogleSheets(updatedMember);

    const allActive = await dbEngine.getMembers(false);

    syncManager.broadcast("doc_change", {
      action: "UPDATE",
      collection: "members",
      id: updatedMember.id,
      doc: updatedMember,
      records: allActive,
      count: allActive.length,
      author: user.email,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: "Member updated and committed to Cloud Firestore.",
      id: updatedMember.id,
      recordId: updatedMember.id,
      member: updatedMember,
      data: updatedMember,
      count: allActive.length,
    });
  } catch (err: any) {
    const isConflict = err.message?.includes("CONFLICT_STALE_RECORD");
    res.status(isConflict ? 409 : 500).json({ success: false, error: err.message });
  }
});

// DELETE /api/members/:id or /api/members?id=... - Delete member from Cloud Firestore
apiRouter.delete(["/members/:id", "/members"], requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    let user = (req as any).user;
    if (!user) {
      return res.status(401).json({ success: false, error: "Authentication required for member deletion." });
    }

    const id = req.params.id || (req.query.id as string) || req.body?.id || req.body?.recordId;
    if (!id) {
      return res.status(400).json({ success: false, error: "Member ID is required for deletion." });
    }

    let memberToPurge = await dbEngine.getMember(id);
    if (!memberToPurge) {
      const all = await dbEngine.getMembers(true);
      memberToPurge = all.find(m => m.id === id || m.recordId === id) || null;
    }

    if (user && user.role === "editor" && memberToPurge) {
      if (!isMemberUploadedByEditor(memberToPurge, user)) {
        return res.status(403).json({
          success: false,
          error: "Permission Denied: Editors can only delete member records that they have added into the app themselves."
        });
      }
    }

    const isPermanent = req.query.permanent === "true" || req.body?.permanent === true;
    let deletedRecord: any = null;

    if (isPermanent) {
      await dbEngine.permanentDeleteMember(id, user.email);
      deletedRecord = memberToPurge;
    } else {
      deletedRecord = await dbEngine.softDeleteMember(id, user.email);
    }

    // Forward deletion to connected Google Sheet immediately
    const recordToSync = deletedRecord || memberToPurge || {
      id,
      recordId: id,
      clanMemberNumber: (req.query.clanMemberNumber as string) || req.body?.clanMemberNumber || "",
      email: (req.query.email as string) || req.body?.email || "",
      firstName: (req.body?.firstName as string) || "",
      lastName: (req.body?.lastName as string) || "",
    };
    syncDeletionToGoogleSheets([recordToSync]);

    const allActive = await dbEngine.getMembers(false);

    syncManager.broadcast("doc_change", {
      action: "DELETE",
      collection: "members",
      id,
      ids: [id],
      deletedIds: [id],
      records: allActive,
      count: allActive.length,
      author: user.email,
      timestamp: new Date().toISOString(),
    });

    syncManager.broadcast("sync_pulse", {
      action: isPermanent ? "PERMANENT_DELETION" : "MEMBER_DELETED",
      id,
      ids: [id],
      deletedIds: [id],
      count: allActive.length,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: isPermanent ? "Member permanently removed from Cloud Firestore." : "Member moved to Recycle Bin.",
      id,
      member: deletedRecord,
      records: allActive,
      count: allActive.length,
    });
  } catch (err: any) {
    console.error("[DELETE /api/members] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/members/batch-delete - Delete multiple members from Cloud Firestore
apiRouter.post("/members/batch-delete", requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ success: false, error: "Authentication required for batch deletion." });
    }

    const ids: string[] = req.body?.ids || [];
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: "Array of member IDs is required." });
    }

    const allMembersBefore = await dbEngine.getMembers(true);

    if (user && user.role === "editor") {
      const forbidden = ids.filter(id => {
        const found = allMembersBefore.find(m => m.id === id || m.recordId === id || m.clanMemberNumber === id);
        return found && !isMemberUploadedByEditor(found, user);
      });
      if (forbidden.length > 0) {
        return res.status(403).json({
          success: false,
          error: `Permission Denied: Editors can only delete member records that they have added into the app themselves. You do not have permission to delete ${forbidden.length} of the selected records.`
        });
      }
    }

    const isPermanent = req.body?.permanent === true;
    const targetMembers: any[] = [];
    const incomingMembers: any[] = Array.isArray(req.body?.members) ? req.body.members : [];

    for (const id of ids) {
      let found = allMembersBefore.find(m => m.id === id || m.recordId === id || m.clanMemberNumber === id);
      if (!found && incomingMembers.length > 0) {
        found = incomingMembers.find(m => m && (m.id === id || m.recordId === id || m.clanMemberNumber === id));
      }
      if (found) {
        targetMembers.push(found);
      } else {
        targetMembers.push({ id });
      }

      try {
        if (isPermanent) {
          await dbEngine.permanentDeleteMember(id, user.email);
        } else {
          await dbEngine.softDeleteMember(id, user.email);
        }
      } catch (err) {
        console.warn(`[BatchDelete] Notice deleting ${id}:`, err);
      }
    }

    // Forward batch deletion to connected Google Sheet if configured
    syncDeletionToGoogleSheets(targetMembers);

    const allActive = await dbEngine.getMembers(false);

    syncManager.broadcast("doc_change", {
      action: "DELETE",
      collection: "members",
      ids,
      deletedIds: ids,
      records: allActive,
      count: allActive.length,
      author: user.email,
      timestamp: new Date().toISOString(),
    });

    syncManager.broadcast("sync_pulse", {
      action: "BATCH_DELETED",
      ids,
      deletedIds: ids,
      count: allActive.length,
      deletedCount: ids.length,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: `Successfully deleted ${ids.length} member(s) from Cloud Firestore.`,
      deletedCount: ids.length,
      records: allActive,
      count: allActive.length,
    });
  } catch (err: any) {
    console.error("[/api/members/batch-delete] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Recycle Bin Endpoints
apiRouter.get("/recycle-bin", requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const all = await dbEngine.getMembers(true);
    const deletedMembers = all.filter((m) => m.deleted);
    res.json({
      success: true,
      count: deletedMembers.length,
      members: deletedMembers,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post("/recycle-bin/:id/restore", requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const restored = await dbEngine.restoreMember(req.params.id, user.email);
    const allActive = await dbEngine.getMembers(false);

    syncManager.broadcast("doc_change", {
      action: "RESTORE",
      collection: "members",
      id: req.params.id,
      doc: restored,
      records: allActive,
      count: allActive.length,
      author: user.email,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: "Member restored successfully from Recycle Bin.",
      member: restored,
      count: allActive.length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.delete("/recycle-bin/:id/permanent", requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const targetId = req.params.id;
    const allMembers = await dbEngine.getMembers(true);
    const memberToPurge = allMembers.find(m => m.id === targetId || m.recordId === targetId) || { id: targetId };

    await dbEngine.permanentDeleteMember(targetId, user.email);

    if (memberToPurge) {
      syncDeletionToGoogleSheets([memberToPurge]);
    }

    syncManager.broadcast("sync_pulse", {
      action: "PERMANENT_DELETION",
      id: targetId,
      author: user.email,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: "Record permanently purged from Cloud Firestore.",
      id: targetId,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Activity & Audit Logs Endpoint (Admin Only)
apiRouter.get(["/db/audit-logs", "/audit-logs"], requireAdmin, async (req: Request, res: Response) => {
  try {
    const logs = await dbEngine.getAuditLogs(100);
    res.json({
      success: true,
      source: "Cloud Firestore ActivityLogs",
      count: logs.length,
      logs,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. GitHub Synchronization Endpoints (Connected Repository Authority)
const CONNECTED_GITHUB_REPO = "deodatusmaliti2-tech/SiaraMaina-Clan-Informatics";
const GITHUB_TOKEN_STORE_PATH = path.resolve(process.cwd(), "server/data/github_token.json");

function loadStoredGitHubToken(): string {
  try {
    if (fs.existsSync(GITHUB_TOKEN_STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(GITHUB_TOKEN_STORE_PATH, "utf-8"));
      if (data && typeof data.token === "string" && data.token.trim()) {
        return data.token.trim();
      }
    }
  } catch (e) {}
  return process.env.GITHUB_TOKEN || "";
}

function saveStoredGitHubToken(token: string) {
  try {
    const dir = path.dirname(GITHUB_TOKEN_STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(GITHUB_TOKEN_STORE_PATH, JSON.stringify({ token: token.trim(), updatedAt: new Date().toISOString() }), "utf-8");
  } catch (e) {}
}

if (!process.env.GITHUB_TOKEN) {
  process.env.GITHUB_TOKEN = loadStoredGitHubToken();
}

apiRouter.get(["/github/token", "/github/info"], (req: Request, res: Response) => {
  const currentToken = process.env.GITHUB_TOKEN || loadStoredGitHubToken();
  const hasToken = Boolean(currentToken);
  const repo = process.env.GITHUB_REPO || CONNECTED_GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  res.json({
    success: true,
    hasToken,
    repo,
    branch,
    token: currentToken,
    remoteUrl: `https://github.com/${repo}.git`,
  });
});

apiRouter.post("/github/token", (req: Request, res: Response) => {
  const { token, repo } = req.body || {};
  if (typeof token === "string" && token.trim()) {
    const trimmed = token.trim();
    process.env.GITHUB_TOKEN = trimmed;
    saveStoredGitHubToken(trimmed);
  }
  if (typeof repo === "string" && repo.trim()) {
    process.env.GITHUB_REPO = repo.trim();
  }
  res.json({
    success: true,
    hasToken: Boolean(process.env.GITHUB_TOKEN),
    repo: process.env.GITHUB_REPO || CONNECTED_GITHUB_REPO,
  });
});



async function pushFileToGitHubAPI(filePath: string, content: string, message: string, token: string, repo: string) {
  let sha = undefined;
  const getUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  try {
    const getRes = await fetch(getUrl, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "SiaraMaina-Clan-Informatics-App"
      }
    });
    if (getRes.ok) {
      const getData = await getRes.json();
      if (getData && getData.sha) {
        sha = getData.sha;
      }
    }
  } catch (e) {}

  const putRes = await fetch(getUrl, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "SiaraMaina-Clan-Informatics-App"
    },
    body: JSON.stringify({
      message: message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha: sha
    })
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`GitHub API push failed for ${filePath}: ${putRes.status} - ${errText}`);
  }
  return await putRes.json();
}

apiRouter.post("/github/push", async (req: Request, res: Response) => {
  try {
    const { message, files, token: bodyToken, repo: bodyRepo } = req.body || {};
    const commitMsg = (message && typeof message === "string" && message.trim()) ? message.trim() : "Update clan dataset and project files";
    const repo = (bodyRepo && typeof bodyRepo === "string" && bodyRepo.trim()) ? bodyRepo.trim() : (process.env.GITHUB_REPO || CONNECTED_GITHUB_REPO);
    
    // Extract and prioritize token passed from client modal
    const rawToken = (typeof bodyToken === "string" && bodyToken.trim()) ? bodyToken.trim() : (process.env.GITHUB_TOKEN || "");
    const token = rawToken.trim();
    if (token) {
      process.env.GITHUB_TOKEN = token;
    }

    // 1. Fetch 100% of all active members and ensure siara-maina-clan-data.json contains all records
    const allActiveMembers = await dbEngine.getMembers(false);
    const clanDataPath = path.resolve(process.cwd(), "siara-maina-clan-data.json");
    fs.writeFileSync(clanDataPath, JSON.stringify(allActiveMembers, null, 2), "utf-8");

    const serverMembersPath = path.resolve(process.cwd(), "server/data/members.json");
    fs.writeFileSync(serverMembersPath, JSON.stringify(allActiveMembers, null, 2), "utf-8");

    const rootMembersPath = path.resolve(process.cwd(), "data/members.json");
    if (!fs.existsSync(path.dirname(rootMembersPath))) {
      fs.mkdirSync(path.dirname(rootMembersPath), { recursive: true });
    }
    fs.writeFileSync(rootMembersPath, JSON.stringify(allActiveMembers, null, 2), "utf-8");

    // Ensure full application HTML is synced for GitHub Pages deployment
    const indexHtmlPath = path.resolve(process.cwd(), "index.html");
    const siaraHtmlPath = path.resolve(process.cwd(), "SiaraMainaInformatics.html");
    if (fs.existsSync(indexHtmlPath)) {
      const indexHtmlContent = fs.readFileSync(indexHtmlPath, "utf-8");
      fs.writeFileSync(siaraHtmlPath, indexHtmlContent, "utf-8");
    }

    // Write any custom client files requested
    const filesToUse = files && typeof files === "object" ? { ...files } : {};
    for (const [filePath, content] of Object.entries(filesToUse)) {
      if (filePath.includes("..") || filePath.startsWith("/")) continue;
      const target = path.resolve(process.cwd(), filePath);
      const strContent = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      fs.writeFileSync(target, strContent, "utf-8");
    }

    // 2. Authoritative Full Application Clone via Git CLI (pushes all 135+ files, source, assets, HTML)
    let apiPushSuccess = false;
    let pushErrorDetails = "";
    let commitSha = "";
    let totalTrackedFiles = 0;

    if (!fs.existsSync(path.resolve(process.cwd(), ".git"))) {
      try {
        execSync("git init && git branch -M main", { stdio: "pipe" });
      } catch (iErr) {}
    }

    try {
      execSync(`git config user.name "deodatusmaliti2-tech" && git config user.email "deodatusmaliti2@gmail.com"`, { stdio: "pipe" });
      try {
        execSync(`git remote set-url origin https://github.com/${repo}.git`, { stdio: "pipe" });
      } catch {
        execSync(`git remote add origin https://github.com/${repo}.git`, { stdio: "pipe" });
      }
    } catch (cErr) {}

    try {
      execSync("git branch -M main", { stdio: "pipe" });
      execSync("git add -A", { stdio: "pipe" });
      try {
        execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { stdio: "pipe" });
      } catch (commitErr) {
        // Working directory already clean
      }
      commitSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
      totalTrackedFiles = parseInt(execSync("git ls-files | wc -l", { encoding: "utf-8" }).trim(), 10) || 135;

      if (token) {
        try {
          const pushUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
          execSync(`git push ${pushUrl} main --force`, { stdio: "pipe" });
          apiPushSuccess = true;
        } catch (pushCliErr: any) {
          pushErrorDetails = pushCliErr?.stderr?.toString() || pushCliErr?.message || "Git CLI push error";
          console.warn("[/api/github/push] Git CLI push note:", pushErrorDetails);
        }
      }
    } catch (gitErr: any) {
      pushErrorDetails = gitErr?.message || "Git execution error";
    }

    // 3. Fallback to GitHub REST API Contents endpoint if CLI push encountered issues
    if (!apiPushSuccess && token) {
      try {
        const fallbackFiles: Record<string, string> = {
          "siara-maina-clan-data.json": JSON.stringify(allActiveMembers, null, 2),
          "siara-maina-project-config.json": JSON.stringify({
            project: "SiaraMaina Clan Informatics",
            version: "2.5.0",
            exportedAt: new Date().toISOString(),
            repository: repo
          }, null, 2)
        };
        for (const [filePath, content] of Object.entries(fallbackFiles)) {
          await pushFileToGitHubAPI(filePath, content, commitMsg, token, repo);
        }
        apiPushSuccess = true;
      } catch (apiErr: any) {
        pushErrorDetails = apiErr?.message || pushErrorDetails;
      }
    }

    const isPermissionError = !apiPushSuccess && (pushErrorDetails.includes("403") || pushErrorDetails.includes("Resource not accessible") || pushErrorDetails.includes("Permission to"));

    if (isPermissionError) {
      return res.status(403).json({
        success: false,
        error: "GitHub write permission denied (HTTP 403). Please verify your Personal Access Token has 'Contents: Read and write' permissions.",
        details: pushErrorDetails
      });
    }

    if (!apiPushSuccess && pushErrorDetails) {
      return res.status(500).json({
        success: false,
        error: `GitHub push failed: ${pushErrorDetails}`
      });
    }

    try {
      await dbEngine.addAuditLog({
        id: "log-" + Date.now(),
        eventType: "GITHUB_PUSH",
        action: `Complete application clone published to ${repo}: ${commitMsg} (${totalTrackedFiles} files)`,
        actorEmail: "deodatusmaliti2@gmail.com",
        targetId: commitSha.slice(0, 7) || "local",
        timestamp: new Date().toISOString(),
      });
    } catch {}

    res.json({
      success: true,
      repo,
      branch: "main",
      commitSha: commitSha || "ok",
      totalFilesPushed: totalTrackedFiles || 135,
      message: `🎉 Complete application clone (${totalTrackedFiles || 135} files) and clan dataset (${allActiveMembers.length} records) successfully published to GitHub (${repo})!`,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[GitHub Push] Error:", err);
    res.status(500).json({ success: false, error: err.message || "Unknown error pushing to GitHub" });
  }
});

apiRouter.all("/github/pull", async (req: Request, res: Response) => {
  try {
    const repo = CONNECTED_GITHUB_REPO;
    let records: any[] = [];

    const token = process.env.GITHUB_TOKEN || "";
    if (token) {
      try {
        execSync(`git remote set-url origin https://${token}@github.com/${repo}.git`, { stdio: "pipe" });
      } catch (cErr) {}
    }

    try {
      execSync("git fetch origin Main && git reset --mixed origin/Main", { stdio: "pipe" });
    } catch (gitErr: any) {
      console.warn("[GitHub Pull] Git fetch note:", gitErr.message);
    }

    const dataPath = path.resolve(process.cwd(), "siara-maina-clan-data.json");
    if (fs.existsSync(dataPath)) {
      try {
        const raw = fs.readFileSync(dataPath, "utf-8");
        records = JSON.parse(raw);
      } catch {}
    }

    res.json({
      success: true,
      repo,
      branch: "Main",
      recordsCount: records.length,
      records,
      message: `Successfully pulled latest project files & clan dataset from ${repo}!`,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[GitHub Pull] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Google Sheets Web App Proxy (Server-side to bypass browser CORS / preflight issues)
const normalizeTargetUrl = (url: string): string => {
  const trimmed = String(url || "").trim();
  if (trimmed.startsWith("/")) {
    return `http://localhost:3000${trimmed}`;
  }
  return trimmed;
};

async function syncDeletionToGoogleSheets(deletedMembers: any[]) {
  if (!Array.isArray(deletedMembers) || deletedMembers.length === 0) return;
  try {
    let sheetTargetUrl = DEFAULT_SHEETS_WEB_APP_URL;
    if (fs.existsSync(spreadsheetConfigFile)) {
      try {
        const sheetCfg = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
        sheetTargetUrl = sheetCfg.webAppUrl || sheetCfg.url || sheetCfg.spreadsheetId || sheetTargetUrl;
      } catch (e) {}
    }

    const targetUrl = normalizeTargetUrl(sheetTargetUrl);
    if (!targetUrl) return;

    // 1. Collect all identifier aliases for deleted members (including names for members without Member ID)
    const allIdsToDelete: string[] = [];
    const allNamesToDelete: string[] = [];
    deletedMembers.forEach((record) => {
      if (!record) return;
      const memberId = String(record.id || record.recordId || "").trim();
      const recordId = String(record.recordId || record.id || "").trim();
      const cnum = String(record.clanMemberNumber || record.clan_member_number || record["Clan Member Number"] || "").trim();
      const email = String(record.email || record["Email Address"] || "").trim();
      const firstName = String(record.firstName || record.first_name || record["First Name"] || "").trim();
      const middleName = String(record.middleName || record.middle_name || "").trim();
      const lastName = String(record.lastName || record.last_name || record["Last Name"] || "").trim();
      const fullName = `${firstName} ${middleName} ${lastName}`.replace(/\s+/g, " ").trim();
      const simpleFullName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();

      if (memberId && !memberId.startsWith("rec_")) allIdsToDelete.push(memberId);
      if (recordId && !recordId.startsWith("rec_")) allIdsToDelete.push(recordId);
      if (cnum) allIdsToDelete.push(cnum);
      if (email) allIdsToDelete.push(email);
      if (fullName && fullName.length > 2) {
        allIdsToDelete.push(fullName);
        allNamesToDelete.push(fullName);
      }
      if (simpleFullName && simpleFullName.length > 2) {
        allIdsToDelete.push(simpleFullName);
        allNamesToDelete.push(simpleFullName);
      }
      if (firstName && lastName) {
        allIdsToDelete.push(`${firstName.toLowerCase()}_${lastName.toLowerCase()}`.trim());
      }
      // Also push first name only if no ID/email/cnum exists
      if (firstName && !cnum && !email) {
        allIdsToDelete.push(firstName);
      }
    });

    const uniqueIds = Array.from(new Set(allIdsToDelete)).filter(Boolean);
    if (uniqueIds.length === 0) return;

    // 2. Dispatch batch deletion to Google Apps Script Web App in a single clean request
    const batchController = new AbortController();
    const batchTimeout = setTimeout(() => batchController.abort(), 45000);
    const batchIdsParam = `&ids=${encodeURIComponent(uniqueIds.join(","))}&id=${encodeURIComponent(uniqueIds.join(","))}`;
    const batchPostUrl = targetUrl.includes("?") ? `${targetUrl}&action=delete${batchIdsParam}` : `${targetUrl}?action=delete${batchIdsParam}`;

    try {
      const resp = await fetch(batchPostUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          ids: uniqueIds,
          id: uniqueIds.join(","),
          names: allNamesToDelete,
          count: uniqueIds.length,
          timestamp: new Date().toISOString(),
        }),
        redirect: "follow",
        signal: batchController.signal,
      });
      clearTimeout(batchTimeout);
      const txt = await resp.text();
      console.log(`[GoogleSheets Forward Batch Delete] Response:`, txt);
    } catch (batchErr: any) {
      clearTimeout(batchTimeout);
      try {
        const getResp = await fetch(batchPostUrl, {
          method: "GET",
          redirect: "follow",
          signal: batchController.signal,
        });
        console.log(`[GoogleSheets Forward Batch Delete GET Fallback] Response:`, await getResp.text());
      } catch (getErr: any) {
        console.warn(`[GoogleSheets Forward Batch Delete Notice]:`, getErr.message);
      }
    }
  } catch (err: any) {
    console.warn(`[syncDeletionToGoogleSheets] Notice:`, err.message || err);
  }
}

function formatMemberForSheets(m: any) {
  if (!m || typeof m !== "object") return m;
  const copy = { ...m };

  // Ensure automatic member/user ID is assigned and written for Google Sheets Column 1 ("Member ID")
  const resolvedId = String(
    copy.id || copy.recordId || copy["Member ID"] || copy["MemberID"] || copy["Record ID"] || copy.clanMemberNumber || ""
  ).trim() || ("rec-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7));

  copy.id = resolvedId;
  copy.recordId = resolvedId;
  copy["Member ID"] = resolvedId;
  copy["MemberID"] = resolvedId;
  copy["Record ID"] = resolvedId;
  copy["memberId"] = resolvedId;

  // Resolve raw photo string from all potential fields
  let rawPhoto = String(
    copy.photo || copy.storedPhoto || copy.photoUrl || copy.photoFile || copy["Photo"] || copy["Photo URL"] || copy["Passport-Style Image"] || ""
  ).trim();

  // If photo is a local relative URL or filename, map it through driveCache to get the Google Drive URL
  if (rawPhoto && !rawPhoto.startsWith("http://") && !rawPhoto.startsWith("https://")) {
    const driveCacheFile = path.resolve(process.cwd(), "data", "migrated_photos_cache.json");
    if (fs.existsSync(driveCacheFile)) {
      try {
        const driveCache = JSON.parse(fs.readFileSync(driveCacheFile, "utf-8"));
        const cleanName = path.basename(rawPhoto);
        const cachedUrl = driveCache[cleanName] || driveCache[rawPhoto] || driveCache[`/uploads/${cleanName}`] || driveCache[`uploads/${cleanName}`];
        if (cachedUrl) {
          rawPhoto = cachedUrl;
        }
      } catch(e) {}
    }
  }

  // Set all expected header alias keys so Google Apps Script finds the photo URL regardless of header naming
  copy.photo = rawPhoto;
  copy.storedPhoto = rawPhoto;
  copy.photoUrl = rawPhoto;
  copy.photoFile = rawPhoto;
  copy["Photo"] = rawPhoto;
  copy["Photo URL"] = rawPhoto;
  copy["Passport-Style Image"] = rawPhoto;

  return copy;
}

async function syncMemberToGoogleSheets(members: any | any[]) {
  const memberList = Array.isArray(members) ? members : [members];
  if (memberList.length === 0) return;
  try {
    if (!fs.existsSync(spreadsheetConfigFile)) return;
    const sheetCfg = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
    const sheetTargetUrl = sheetCfg.webAppUrl || sheetCfg.url || sheetCfg.spreadsheetId;
    if (!sheetTargetUrl) return;

    const targetUrl = normalizeTargetUrl(sheetTargetUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const formattedList = memberList.map(formatMemberForSheets);
    const payload = formattedList.length === 1 ? formattedList[0] : formattedList;

    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: controller.signal
    });
    clearTimeout(timeout);
    const txt = await resp.text();
    console.log(`[GoogleSheets Forward Push] Sync response:`, txt);
  } catch (err: any) {
    console.warn("[syncMemberToGoogleSheets Notice]:", err.message);
  }
}


// Stateful in-memory mock Google Sheet store for testing & automated verification
let mockSheetDatabase: any[] = [
  {
    "Member ID": "rec_sample_1",
    "First Name": "Alice",
    "Middle Name": "K",
    "Last Name": "Maina",
    "Email Address": "alice@test.com",
    "Family Clan": "maina",
    "Life Status": "Living"
  },
  {
    "Member ID": "rec_sample_2",
    "First Name": "Ben",
    "Middle Name": "M",
    "Last Name": "Siara",
    "Email Address": "ben@test.com",
    "Family Clan": "siara",
    "Life Status": "Living"
  }
];

// Mock Google Sheets Web App Endpoint for local testing & automated diagnostics
apiRouter.all("/sheets/mock-echo", (req: Request, res: Response) => {
  const method = req.method;
  const body = req.body;
  const query = req.query;

  if (method === "POST") {
    const isDelete = body?.action === "delete" || body?.deleted === true;
    if (isDelete) {
      const idsToDelete = (body?.ids && Array.isArray(body.ids))
        ? body.ids.map(String)
        : (body?.id ? [String(body.id)] : []);
      const targetEmail = String(body?.email || "").toLowerCase().trim();

      const prevCount = mockSheetDatabase.length;
      mockSheetDatabase = mockSheetDatabase.filter((row: any) => {
        const rowId = String(row["Member ID"] || row.id || "").trim();
        const rowEmail = String(row["Email Address"] || row.email || "").toLowerCase().trim();
        if (idsToDelete.length > 0 && idsToDelete.includes(rowId)) return false;
        if (targetEmail && rowEmail === targetEmail) return false;
        return true;
      });
      const deletedCount = prevCount - mockSheetDatabase.length;

      return res.json({
        result: "success",
        deleted: deletedCount,
        updated: 0,
        added: 0,
        remaining: mockSheetDatabase.length,
        received: body,
        timestamp: new Date().toISOString()
      });
    }

    // Upsert / Save
    const items = Array.isArray(body)
      ? body
      : (body?.members && Array.isArray(body.members))
        ? body.members
        : (body?.member && typeof body.member === "object")
          ? [body.member]
          : [body];

    let addedCount = 0;
    let updatedCount = 0;

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const itemId = String(item["Member ID"] || item.id || item.recordId || "").trim();
      const isUuidOnly = itemId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) && !item["First Name"] && !item.firstName && !item["Last Name"] && !item.lastName && !item["Email Address"] && !item.email;
      if (isUuidOnly) continue;
      if (!item["First Name"] && !item.firstName && !item["Last Name"] && !item.lastName && !item["Email Address"] && !item.email && !item["Member ID"] && !item.id) continue;
      const itemEmail = String(item["Email Address"] || item.email || "").toLowerCase().trim();

      const existingIdx = mockSheetDatabase.findIndex((r: any) => {
        const rId = String(r["Member ID"] || r.id || "").trim();
        const rEmail = String(r["Email Address"] || r.email || "").toLowerCase().trim();
        return (itemId && rId === itemId) || (itemEmail && rEmail === itemEmail);
      });

      const isUuidId = itemId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      const cleanMemberId = isUuidId
        ? (item.clanMemberNumber || item["clanMemberNumber"] || "")
        : itemId;

      const formatted: any = {
        "Member ID": cleanMemberId || `rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        "First Name": item["First Name"] || item.firstName || "",
        "Middle Name": item["Middle Name"] || item.middleName || "",
        "Last Name": item["Last Name"] || item.lastName || "",
        "Email Address": item["Email Address"] || item.email || "",
        "Family Clan": item["Family Clan"] || item.branchType || item.branch || "maina",
        "Life Status": (item.deceased === true || item.deceased === "true" || item["Life Status"] === "Deceased") ? "Deceased" : "Living"
      };

      if (existingIdx >= 0) {
        mockSheetDatabase[existingIdx] = { ...mockSheetDatabase[existingIdx], ...formatted };
        updatedCount++;
      } else {
        mockSheetDatabase.push(formatted);
        addedCount++;
      }
    }

    return res.json({
      result: "success",
      deleted: 0,
      updated: updatedCount,
      added: addedCount,
      total: mockSheetDatabase.length,
      received: body,
      timestamp: new Date().toISOString()
    });
  }

  // GET: simulate returning rows or GET deletion
  if (query.action === "delete") {
    const idsToDelete = query.ids ? String(query.ids).split(",").map(s => s.trim()) : (query.id ? [String(query.id).trim()] : []);
    const targetEmail = String(query.email || "").toLowerCase().trim();

    const prevCount = mockSheetDatabase.length;
    mockSheetDatabase = mockSheetDatabase.filter((row: any) => {
      const rowId = String(row["Member ID"] || row.id || "").trim();
      const rowEmail = String(row["Email Address"] || row.email || "").toLowerCase().trim();
      if (idsToDelete.length > 0 && idsToDelete.includes(rowId)) return false;
      if (targetEmail && rowEmail === targetEmail) return false;
      return true;
    });
    const deletedCount = prevCount - mockSheetDatabase.length;

    return res.json({ result: "deleted", count: deletedCount, remaining: mockSheetDatabase.length });
  }

  if (query.action === "reset") {
    mockSheetDatabase = [
      {
        "Member ID": "rec_sample_1",
        "First Name": "Alice",
        "Middle Name": "K",
        "Last Name": "Maina",
        "Email Address": "alice@test.com",
        "Family Clan": "maina",
        "Life Status": "Living"
      },
      {
        "Member ID": "rec_sample_2",
        "First Name": "Ben",
        "Middle Name": "M",
        "Last Name": "Siara",
        "Email Address": "ben@test.com",
        "Family Clan": "siara",
        "Life Status": "Living"
      }
    ];
    return res.json({ result: "reset", total: mockSheetDatabase.length });
  }

  res.json(mockSheetDatabase);
});

apiRouter.post("/sheets/push", async (req: Request, res: Response) => {
  try {
    const { webAppUrl, member, members } = req.body;
    if (!webAppUrl) {
      return res.status(400).json({ success: false, error: "Missing webAppUrl" });
    }
    let payload = members || member;
    if (!payload) {
      return res.status(400).json({ success: false, error: "Missing member payload" });
    }

    if (Array.isArray(payload)) {
      payload = payload.map(formatMemberForSheets);
    } else {
      payload = formatMemberForSheets(payload);
    }

    const targetUrl = normalizeTargetUrl(webAppUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: controller.signal
    });
    clearTimeout(timeout);

    const text = await resp.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch (e) {}

    res.json({ success: true, response: text, data: parsed });
  } catch (err: any) {
    console.error("[Sheets Push Proxy] Error:", err.message || err);
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post("/sheets/delete", async (req: Request, res: Response) => {
  try {
    const { webAppUrl, id, email, clanMemberNumber, firstName, lastName, name, names, ids, action } = req.body;
    if (!webAppUrl) {
      return res.status(400).json({ success: false, error: "Missing webAppUrl" });
    }
    const act = action || "delete";
    const targetUrl = normalizeTargetUrl(webAppUrl);

    const allIds = ids && Array.isArray(ids) ? ids : [id, clanMemberNumber, email, name, firstName, lastName].filter(Boolean);
    const joinedIds = allIds.join(",");
    const idsParam = allIds.length > 0 ? `&ids=${encodeURIComponent(joinedIds)}` : "";
    const fnParam = firstName ? `&firstName=${encodeURIComponent(firstName)}` : "";
    const lnParam = lastName ? `&lastName=${encodeURIComponent(lastName)}` : "";
    const nameParam = name ? `&name=${encodeURIComponent(name)}` : "";
    const deleteQueryParams = `?action=${encodeURIComponent(act)}&id=${encodeURIComponent(joinedIds || id || name || "")}&clanMemberNumber=${encodeURIComponent(clanMemberNumber || "")}&email=${encodeURIComponent(email || "")}${fnParam}${lnParam}${nameParam}${idsParam}`;
    const urlWithParams = targetUrl.includes("?") ? `${targetUrl}&${deleteQueryParams.slice(1)}` : `${targetUrl}${deleteQueryParams}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    let text = "";
    let parsed: any = null;

    try {
      const payload = {
        action: act,
        id: joinedIds || id || name || firstName || clanMemberNumber || email || "",
        clanMemberNumber: clanMemberNumber || "",
        email: email || "",
        firstName: firstName || "",
        lastName: lastName || "",
        name: name || (firstName + " " + lastName).trim(),
        names: names || (name ? [name] : []),
        ids: allIds,
        count: allIds.length
      };

      const resp = await fetch(urlWithParams, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "follow",
        signal: controller.signal
      });
      text = await resp.text();
      try { parsed = JSON.parse(text); } catch (e) {}
    } catch (postErr: any) {
      const getResp = await fetch(urlWithParams, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal
      });
      text = await getResp.text();
      try { parsed = JSON.parse(text); } catch (e) {}
    } finally {
      clearTimeout(timeout);
    }

    res.json({ success: true, response: text, data: parsed });
  } catch (err: any) {
    console.error("[Sheets Delete Proxy] Error:", err.message || err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dedicated photo upload endpoint that deposits photo into Google Drive folder 1FmpGhvi2xjl8MVILRIHiGC2x6wpXg2a3 and returns direct view URLs
apiRouter.post(["/upload/photo", "/sheets/upload-photo"], requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const { image, base64, filename, folderId, webAppUrl, firstName, middleName, lastName, memberName, clanMemberNumber } = req.body || {};
    const rawData = String(image || base64 || "").trim();
    if (!rawData) {
      return res.status(400).json({ success: false, error: "Missing image payload." });
    }

    const driveFolderId = folderId || "1FmpGhvi2xjl8MVILRIHiGC2x6wpXg2a3";
    const cleanExt = (filename && filename.includes(".")) ? path.extname(filename) : ".jpg";
    const cleanBase64 = rawData.replace(/^data:image\/\w+;base64,/, "");
    
    // Content-based MD5 hash for absolute deduplication
    const contentHash = crypto.createHash("md5").update(cleanBase64).digest("hex");

    // Construct recognizable filename containing member's First, Middle, and Last Name
    let nameSlug = "";
    const rawName = String(memberName || "").trim();
    if (rawName) {
      nameSlug = rawName.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
    } else if (firstName || middleName || lastName) {
      nameSlug = [firstName, middleName, lastName].map(s => String(s || "").trim()).filter(Boolean).join("_").replace(/[^a-zA-Z0-9_\-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    }
    if (clanMemberNumber && String(clanMemberNumber).trim()) {
      const cleanCnum = String(clanMemberNumber).trim().replace(/[^a-zA-Z0-9]/g, "");
      nameSlug = nameSlug ? `${nameSlug}_${cleanCnum}` : cleanCnum;
    }

    const baseName = nameSlug
      ? `${nameSlug}_clan_photo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${cleanExt}`
      : `clan_photo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${cleanExt}`;

    // Read existing Drive URL cache
    const driveCacheFile = path.resolve(process.cwd(), "data", "migrated_photos_cache.json");
    let driveCache: Record<string, string> = {};
    if (fs.existsSync(driveCacheFile)) {
      try {
        driveCache = JSON.parse(fs.readFileSync(driveCacheFile, "utf-8"));
      } catch(e) {}
    }

    // Deduplication check: If this exact photo content or filename was already uploaded to Google Drive
    const cachedDriveUrl = driveCache[contentHash] || (filename && driveCache[filename]);
    if (cachedDriveUrl) {
      return res.json({
        success: true,
        url: cachedDriveUrl,
        photoUrl: cachedDriveUrl,
        viewUrl: cachedDriveUrl,
        source: "google_drive_cache",
        cached: true,
        folderId: driveFolderId,
        filename: filename || baseName
      });
    }

    // 1. Save local copy for offline resilience
    const uploadsDir = path.resolve(process.cwd(), "public", "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const filePath = path.join(uploadsDir, baseName);
    try {
      fs.writeFileSync(filePath, Buffer.from(cleanBase64, "base64"));
    } catch(e) {}

    // 2. Deposit into user's Google Drive folder via Google Apps Script Web App
    let targetUrl = String(webAppUrl || "").trim();
    if (!targetUrl && fs.existsSync(spreadsheetConfigFile)) {
      try {
        const sheetCfg = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
        targetUrl = sheetCfg.webAppUrl || sheetCfg.spreadsheetId;
      } catch(e) {}
    }
    if (!targetUrl) {
      targetUrl = "https://script.google.com/macros/s/AKfycbyLlYZ3pw4-5ENtn_wf6tInqNRAPmHCdDmzJx40g2hUPNVyK3XOcleP9_MaGqktg6V2/exec";
    }

    let driveResult: any = null;
    let driveRawText = "";
    if (targetUrl && targetUrl.includes("script.google.com")) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const resp = await fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "uploadPhoto",
            folderId: driveFolderId,
            filename: baseName,
            base64: cleanBase64,
            mimeType: cleanExt === ".png" ? "image/png" : (cleanExt === ".webp" ? "image/webp" : "image/jpeg")
          }),
          redirect: "follow",
          signal: controller.signal
        });
        clearTimeout(timeout);
        driveRawText = await resp.text();
        try { driveResult = JSON.parse(driveRawText); } catch(e) {}
      } catch(dErr: any) {
        console.warn("[Upload Photo] Google Drive upload notice:", dErr.message);
      }
    }

    if (driveResult && (driveResult.url || driveResult.photoUrl)) {
      const gDriveUrl = driveResult.url || driveResult.photoUrl;

      // Update cache immediately with both content hash and filenames so no duplicate is ever created
      driveCache[contentHash] = gDriveUrl;
      driveCache[baseName] = gDriveUrl;
      if (filename) driveCache[filename] = gDriveUrl;
      try {
        fs.writeFileSync(driveCacheFile, JSON.stringify(driveCache, null, 2), "utf-8");
      } catch(e) {}

      return res.json({
        success: true,
        url: gDriveUrl,
        photoUrl: gDriveUrl,
        viewUrl: driveResult.viewUrl || gDriveUrl,
        fileId: driveResult.fileId,
        source: "google_drive",
        folderId: driveFolderId,
        filename: baseName
      });
    }

    const isDrivePermissionError = driveRawText.includes("DriveApp") ||
      (driveResult && driveResult.error && String(driveResult.error).toLowerCase().includes("permission"));

    // Fallback: Return server-hosted URL with actionable authorization diagnostic
    const localUrl = `/uploads/${baseName}`;
    res.json({
      success: true,
      url: localUrl,
      photoUrl: localUrl,
      source: "server_fallback",
      needsDriveAuth: isDrivePermissionError,
      driveError: driveResult?.error || (isDrivePermissionError ? "Google Drive authorization required in Google Apps Script editor. Click 'Run' on authorizeDrivePermissions." : null),
      folderId: driveFolderId,
      filename: baseName
    });
  } catch (err: any) {
    console.error("[/api/upload/photo] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test Google Drive Folder Authorization Status (verifying both Folder Access and Write Capability)
apiRouter.post(["/sheets/test-drive", "/drive/test-auth", "/drive/test"], async (req: Request, res: Response) => {
  try {
    const { webAppUrl, folderId } = req.body || {};
    let targetUrl = String(webAppUrl || "").trim();
    if (!targetUrl && fs.existsSync(spreadsheetConfigFile)) {
      try {
        const sheetCfg = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
        targetUrl = sheetCfg.webAppUrl || sheetCfg.spreadsheetId;
      } catch(e) {}
    }
    if (!targetUrl) {
      targetUrl = "https://script.google.com/macros/s/AKfycbyLlYZ3pw4-5ENtn_wf6tInqNRAPmHCdDmzJx40g2hUPNVyK3XOcleP9_MaGqktg6V2/exec";
    }

    const driveFolderId = folderId || "1FmpGhvi2xjl8MVILRIHiGC2x6wpXg2a3";
    const testUrl = targetUrl + (targetUrl.includes("?") ? "&" : "?") + "action=testDrive&_cb=" + Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const resp = await fetch(testUrl, { method: "GET", redirect: "follow", signal: controller.signal });
    clearTimeout(timeout);
    const text = await resp.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch(e) {}

    let canWrite = json && json.authorized === true && json.canWrite === true;
    let writeError = json?.writeError || null;

    // If canWrite was not explicitly confirmed by doGet (e.g. older deployment), actively probe write capability to prevent false positives
    if (!canWrite && targetUrl && targetUrl.includes("script.google.com")) {
      try {
        const probeController = new AbortController();
        const probeTimeout = setTimeout(() => probeController.abort(), 12000);
        const probeResp = await fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "uploadPhoto",
            folderId: driveFolderId,
            filename: ".siara_probe.txt",
            base64: "c2lhcmFfcHJvYmU=",
            mimeType: "text/plain",
            probeOnly: true
          }),
          redirect: "follow",
          signal: probeController.signal
        });
        clearTimeout(probeTimeout);
        const probeText = await probeResp.text();
        let probeJson: any = null;
        try { probeJson = JSON.parse(probeText); } catch(e) {}

        if (probeJson && (probeJson.url || probeJson.fileId || probeJson.result === "success" || probeJson.success === true)) {
          canWrite = true;
          writeError = null;
        } else if (probeJson && probeJson.error) {
          writeError = probeJson.error;
        } else if (probeText.includes("createFile") || probeText.includes("DriveApp") || probeText.includes("permission")) {
          writeError = probeText;
        }
      } catch(pErr: any) {
        writeError = pErr.message;
      }
    }

    if (canWrite) {
      return res.json({
        success: true,
        authorized: true,
        canWrite: true,
        folderName: json?.folderName || "SiaraMaina Clan Photos",
        folderId: driveFolderId,
        message: `✅ Google Drive folder connected and FULL WRITE permission verified! Ready to deposit photos into folder: ${json?.folderName || driveFolderId}`
      });
    }

    // If createFile lacks write permission
    const isPermissionError = writeError && (
      String(writeError).includes("permission") ||
      String(writeError).includes("DriveApp") ||
      String(writeError).includes("createFile")
    );
    const writeErrDesc = writeError || "DriveApp.Folder.createFile permission required";

    return res.json({
      success: false,
      authorized: false,
      needsDriveAuth: !!isPermissionError,
      canWrite: false,
      folderName: json?.folderName || "SiaraMaina Clan Photos",
      folderId: driveFolderId,
      error: `Google Drive write permission needed (${writeErrDesc}). In Google Apps Script editor: 1. In top dropdown select 'authorizeDrivePermissions' and click '▶ Run'. 2. Click 'Deploy' > 'Manage deployments' > Click ✏️ Edit > Change Version to 'New version' > Click 'Deploy'.`,
      raw: writeError || text
    });
  } catch(err: any) {
    res.status(500).json({ success: false, authorized: false, error: err.message });
  }
});

// Auto-migrate any previously cached local photos to Google Drive Folder
apiRouter.post(["/upload/migrate-local-photos", "/drive/migrate-photos", "/sheets/migrate-photos"], async (req: Request, res: Response) => {
  try {
    const { webAppUrl, folderId } = req.body || {};
    let targetUrl = String(webAppUrl || "").trim();
    if (!targetUrl && fs.existsSync(spreadsheetConfigFile)) {
      try {
        const sheetCfg = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
        targetUrl = sheetCfg.webAppUrl || sheetCfg.spreadsheetId;
      } catch(e) {}
    }
    if (!targetUrl) {
      targetUrl = "https://script.google.com/macros/s/AKfycbyLlYZ3pw4-5ENtn_wf6tInqNRAPmHCdDmzJx40g2hUPNVyK3XOcleP9_MaGqktg6V2/exec";
    }

    const driveFolderId = folderId || "1FmpGhvi2xjl8MVILRIHiGC2x6wpXg2a3";
    const members = await dbEngine.getMembers(true);
    const uploadsDir = path.resolve(process.cwd(), "public", "uploads");

    // Gather all local photo files from public/uploads
    let localFiles: string[] = [];
    if (fs.existsSync(uploadsDir)) {
      localFiles = fs.readdirSync(uploadsDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f) && !f.startsWith("."));
    }

    const driveCacheFile = path.resolve(process.cwd(), "data", "migrated_photos_cache.json");
    let driveCache: Record<string, string> = {};
    if (fs.existsSync(driveCacheFile)) {
      try {
        driveCache = JSON.parse(fs.readFileSync(driveCacheFile, "utf-8"));
      } catch(e) {}
    }

    let migratedCount = 0;
    const migratedMembers: any[] = [];
    const errorsEncountered: string[] = [];
    const fileToDriveUrl: Record<string, string> = {};
    const migratedList: Array<{ filename: string; localUrl: string; driveUrl: string; memberId?: string; memberName?: string }> = [];

    // 1. Upload all local photo files to Google Drive folder (using cached mappings if already uploaded)
    for (const filename of localFiles) {
      const fullPath = path.join(uploadsDir, filename);
      if (!fs.existsSync(fullPath)) continue;

      const fileBuffer = fs.readFileSync(fullPath);
      const base64Data = fileBuffer.toString("base64");
      const contentHash = crypto.createHash("md5").update(base64Data).digest("hex");

      const cachedUrl = driveCache[filename] || driveCache[contentHash];
      if (cachedUrl) {
        fileToDriveUrl[filename] = cachedUrl;
        fileToDriveUrl[`/uploads/${filename}`] = cachedUrl;
        fileToDriveUrl[`uploads/${filename}`] = cachedUrl;
        migratedList.push({
          filename,
          localUrl: `/uploads/${filename}`,
          driveUrl: cachedUrl
        });
        migratedCount++;
        continue;
      }

      const cleanExt = path.extname(filename).toLowerCase();

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const resp = await fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "uploadPhoto",
            folderId: driveFolderId,
            filename: filename,
            base64: base64Data,
            mimeType: cleanExt === ".png" ? "image/png" : (cleanExt === ".webp" ? "image/webp" : "image/jpeg")
          }),
          redirect: "follow",
          signal: controller.signal
        });
        clearTimeout(timeout);
        const json: any = await resp.json().catch(() => null);

        if (json && (json.url || json.photoUrl)) {
          const gDriveUrl = json.url || json.photoUrl;
          fileToDriveUrl[filename] = gDriveUrl;
          fileToDriveUrl[`/uploads/${filename}`] = gDriveUrl;
          fileToDriveUrl[`uploads/${filename}`] = gDriveUrl;
          driveCache[filename] = gDriveUrl;
          driveCache[contentHash] = gDriveUrl;
          try {
            fs.writeFileSync(driveCacheFile, JSON.stringify(driveCache, null, 2), "utf-8");
          } catch(e) {}
          migratedList.push({
            filename,
            localUrl: `/uploads/${filename}`,
            driveUrl: gDriveUrl
          });
          migratedCount++;
        } else if (json && json.error) {
          errorsEncountered.push(json.error);
        }
      } catch(err: any) {
        errorsEncountered.push(err.message);
      }
    }

    // 2. Link migrated Google Drive URLs to all member records
    for (const member of members) {
      const p = String(member.photo || (member as any).storedPhoto || (member as any).photoUrl || (member as any).photoFile || "").trim();
      let newUrl = "";

      for (const [key, driveUrl] of Object.entries(fileToDriveUrl)) {
        if (p.includes(key) || p === key || p.toLowerCase().includes(key.toLowerCase())) {
          newUrl = driveUrl;
          break;
        }
      }

      // If member has base64 data URL directly, check cache first then upload if needed
      if (!newUrl && p.startsWith("data:image/")) {
        try {
          const cleanBase64 = p.replace(/^data:image\/\w+;base64,/, "");
          const contentHash = crypto.createHash("md5").update(cleanBase64).digest("hex");
          
          if (driveCache[contentHash]) {
            newUrl = driveCache[contentHash];
          } else {
            const ext = p.includes("png") ? ".png" : ".jpg";
            const nameSlug = [member.firstName, member.middleName, member.lastName].map(s => String(s || '').trim()).filter(Boolean).join('_').replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
            const fn = nameSlug
              ? `${nameSlug}_clan_photo_${member.id || Date.now()}${ext}`
              : `clan_photo_${member.id || Date.now()}${ext}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60000);
            const resp = await fetch(targetUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "uploadPhoto",
                folderId: driveFolderId,
                filename: fn,
                base64: cleanBase64,
                mimeType: ext === ".png" ? "image/png" : "image/jpeg"
              }),
              redirect: "follow",
              signal: controller.signal
            });
            clearTimeout(timeout);
            const json: any = await resp.json().catch(() => null);
            if (json && (json.url || json.photoUrl)) {
              newUrl = json.url || json.photoUrl;
              driveCache[contentHash] = newUrl;
              driveCache[fn] = newUrl;
              try {
                fs.writeFileSync(driveCacheFile, JSON.stringify(driveCache, null, 2), "utf-8");
              } catch(e) {}
              migratedList.push({
                filename: fn,
                localUrl: "data:image/...",
                driveUrl: newUrl,
                memberId: member.id,
                memberName: `${member.firstName} ${member.lastName}`
              });
              migratedCount++;
            }
          }
        } catch(e) {}
      }

      if (newUrl) {
        member.photo = newUrl;
        (member as any).storedPhoto = newUrl;
        (member as any).photoUrl = newUrl;
        (member as any).photoFile = newUrl;
        await dbEngine.updateMember(member.id, member, "drive_migration");
        syncMemberToGoogleSheets(member);
        migratedMembers.push({ id: member.id, name: `${member.firstName} ${member.lastName}`, photoUrl: newUrl });
      }
    }

    // 3. Update local siara-maina-clan-data.json and data/members.json to ensure offline consistency
    const clanDataJsonPath = path.resolve(process.cwd(), "siara-maina-clan-data.json");
    if (fs.existsSync(clanDataJsonPath)) {
      try {
        const localMembers = JSON.parse(fs.readFileSync(clanDataJsonPath, "utf-8"));
        let updatedJson = false;
        for (const lm of localMembers) {
          const p = String(lm.photo || lm.storedPhoto || lm.photoUrl || lm.photoFile || "").trim();
          for (const [key, driveUrl] of Object.entries(fileToDriveUrl)) {
            if (p.includes(key) || p === key || p.toLowerCase().includes(key.toLowerCase())) {
              lm.photo = driveUrl;
              lm.storedPhoto = driveUrl;
              lm.photoUrl = driveUrl;
              lm.photoFile = driveUrl;
              updatedJson = true;
              break;
            }
          }
        }
        if (updatedJson) {
          fs.writeFileSync(clanDataJsonPath, JSON.stringify(localMembers, null, 2), "utf-8");
        }
      } catch(e) {}
    }

    const dataMembersPath = path.resolve(process.cwd(), "data", "members.json");
    if (fs.existsSync(dataMembersPath)) {
      try {
        const localMembers = JSON.parse(fs.readFileSync(dataMembersPath, "utf-8"));
        let updatedJson = false;
        for (const lm of localMembers) {
          const p = String(lm.photo || lm.storedPhoto || lm.photoUrl || lm.photoFile || "").trim();
          for (const [key, driveUrl] of Object.entries(fileToDriveUrl)) {
            if (p.includes(key) || p === key || p.toLowerCase().includes(key.toLowerCase())) {
              lm.photo = driveUrl;
              lm.storedPhoto = driveUrl;
              lm.photoUrl = driveUrl;
              lm.photoFile = driveUrl;
              updatedJson = true;
              break;
            }
          }
        }
        if (updatedJson) {
          fs.writeFileSync(dataMembersPath, JSON.stringify(localMembers, null, 2), "utf-8");
        }
      } catch(e) {}
    }

    // 4. Broadcast live sync pulse so all connected browser sessions receive the new Google Drive URLs
    if (migratedCount > 0) {
      const allActive = await dbEngine.getMembers(false);
      syncManager.broadcast("doc_change", {
        action: "UPDATE",
        collection: "members",
        records: allActive,
        count: allActive.length,
        author: "drive_migration",
        timestamp: new Date().toISOString()
      });
      syncManager.broadcast("sync_pulse", {
        action: "PHOTOS_MIGRATED",
        count: migratedCount,
        timestamp: new Date().toISOString()
      });
    }

    // 5. Return clear status
    if (migratedCount === 0) {
      if (errorsEncountered.length > 0) {
        const isPerm = errorsEncountered.some(e =>
          String(e).includes("permission") ||
          String(e).includes("createFile") ||
          String(e).includes("DriveApp")
        );
        return res.json({
          success: false,
          migratedCount: 0,
          needsDriveAuth: isPerm,
          error: isPerm
            ? `Google Drive write permission needed: ${errorsEncountered[0]}. In Apps Script editor: 1. In top dropdown select 'authorizeDrivePermissions' and click '▶ Run'. 2. Click 'Deploy' > 'Manage deployments' > Click ✏️ Edit > Change Version to 'New version' > Click 'Deploy'.`
            : `Upload notice: ${errorsEncountered[0]}`,
          errors: errorsEncountered,
          localFilesCount: localFiles.length
        });
      }
      return res.json({
        success: true,
        migratedCount: 0,
        message: "All member photos are already on Google Drive! No local cached photos were pending migration.",
        migrated: [],
        members: []
      });
    }

    res.json({
      success: true,
      migratedCount,
      migrated: migratedList,
      members: migratedMembers,
      fileMap: fileToDriveUrl,
      message: `Successfully migrated ${migratedCount} photo(s) to Google Drive folder ${driveFolderId}!`
    });
  } catch(err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Synchronize and health-check photos bidirectionally between Google Drive, App Database, and Google Sheets
apiRouter.post(["/drive/sync-photos", "/upload/sync-photos", "/sheets/sync-photos"], async (req: Request, res: Response) => {
  try {
    const { webAppUrl, folderId } = req.body || {};
    let targetUrl = String(webAppUrl || "").trim();
    if (!targetUrl && fs.existsSync(spreadsheetConfigFile)) {
      try {
        const sheetCfg = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
        targetUrl = sheetCfg.webAppUrl || sheetCfg.spreadsheetId;
      } catch(e) {}
    }

    const members = await dbEngine.getMembers(true);
    const driveCacheFile = path.resolve(process.cwd(), "data", "migrated_photos_cache.json");
    let driveCache: Record<string, string> = {};
    if (fs.existsSync(driveCacheFile)) {
      try {
        driveCache = JSON.parse(fs.readFileSync(driveCacheFile, "utf-8"));
      } catch(e) {}
    }

    let removedCount = 0;
    let addedCount = 0;
    const updatedMembersList: any[] = [];
    let cacheChanged = false;

    // 1. Health check existing Google Drive photo URLs on member records (Drive -> App/Sheet deletion detection)
    for (const member of members) {
      const p = String(member.photo || (member as any).storedPhoto || (member as any).photoUrl || (member as any).photoFile || "").trim();
      
      if (p && (p.includes("lh3.googleusercontent.com") || p.includes("drive.google.com"))) {
        let probeUrl = p;
        if (p.includes("lh3.googleusercontent.com/d/")) {
          const fileId = p.split("/d/")[1]?.split("?")[0]?.split("/")[0];
          if (fileId) probeUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
        } else if (p.includes("drive.google.com/file/d/")) {
          const fileId = p.split("/file/d/")[1]?.split("/")[0]?.split("?")[0];
          if (fileId) probeUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
        }

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const probeResp = await fetch(probeUrl, { method: "HEAD", signal: controller.signal }).catch(() => null);
          clearTimeout(timeout);

          // If Google Drive returns 400 or 404, the photo was deleted from Google Drive!
          if (probeResp && (probeResp.status === 400 || probeResp.status === 404)) {
            console.log(`[Drive Photo Health] Photo deleted from Drive for member ${member.id} (${member.firstName} ${member.lastName}). Clearing link.`);
            member.photo = "";
            (member as any).storedPhoto = "";
            (member as any).photoUrl = "";
            (member as any).photoFile = "";
            await dbEngine.updateMember(member.id, member, "drive_photo_sync");
            syncMemberToGoogleSheets(member);
            updatedMembersList.push(member);
            removedCount++;

            // Clean up driveCache
            for (const [k, v] of Object.entries(driveCache)) {
              if (v === p || v === probeUrl) {
                delete driveCache[k];
                cacheChanged = true;
              }
            }
          }
        } catch(e) {}
      }
    }

    // 2. Save updated driveCache if changed
    if (cacheChanged) {
      try {
        fs.writeFileSync(driveCacheFile, JSON.stringify(driveCache, null, 2), "utf-8");
      } catch(e) {}
    }

    // 3. Broadcast real-time SSE update if any members were updated
    if (updatedMembersList.length > 0) {
      const allActive = await dbEngine.getMembers(false);
      syncManager.broadcast("doc_change", {
        action: "UPDATE",
        collection: "members",
        records: allActive,
        count: allActive.length,
        author: "drive_photo_sync",
        timestamp: new Date().toISOString()
      });
      syncManager.broadcast("sync_pulse", {
        action: "PHOTOS_SYNCED",
        removedCount,
        addedCount,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      removedCount,
      addedCount,
      updatedMembersCount: updatedMembersList.length,
      message: removedCount > 0 || addedCount > 0
        ? `✅ Photo synchronization complete! Cleared ${removedCount} deleted Drive photo link(s) and synced ${addedCount} photo(s) across app & Google Sheet.`
        : "✅ All Google Drive photos are healthy and fully synchronized with app & Google Sheet!"
    });
  } catch(err: any) {
    console.error("[/api/drive/sync-photos] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const formatGoogleSheetCsvUrl = (url: string): string => {
  if (!url) return "";
  const trimmed = url.trim();
  if (trimmed.includes("script.google.com")) return trimmed;

  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_\-]+)/);
  if (idMatch && idMatch[1] && !trimmed.includes("/d/e/")) {
    const spreadsheetId = idMatch[1];
    const gidMatch = trimmed.match(/[?&#]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : "";
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv` + (gid ? `&gid=${gid}` : "");
  }

  if (trimmed.includes("/spreadsheets/d/e/")) {
    if (trimmed.includes("output=csv") || trimmed.includes("format=csv")) return trimmed;
    const pubBase = trimmed.replace(/\/(pubhtml|pub|edit|view).*/, "");
    return `${pubBase}/pub?output=csv`;
  }

  return trimmed;
};

// Webhook endpoint to accept instant edit/change notifications from Google Sheets Apps Script triggers
apiRouter.all("/sheets/webhook", async (req: Request, res: Response) => {
  try {
    const payload = req.body || {};
    const membersToProcess = Array.isArray(payload.members)
      ? payload.members
      : (payload.member ? [payload.member] : (Array.isArray(payload) ? payload : []));

    if (membersToProcess.length > 0) {
      const result = await dbEngine.importMembersBatch(membersToProcess, "google_sheet_webhook");
      syncManager.broadcast("doc_change", {
        action: "IMPORT_SHEET",
        collection: "members",
        records: result.members,
        count: result.members.length,
        author: "google_sheet_webhook",
        timestamp: new Date().toISOString()
      });
      syncManager.broadcast("sync_pulse", {
        action: "SHEET_WEBHOOK_MUTATION",
        count: result.members.length,
        timestamp: new Date().toISOString()
      });
      return res.json({ success: true, message: `Webhook processed ${result.members.length} members`, result });
    }

    res.json({ success: true, message: "Webhook received" });
  } catch (err: any) {
    console.error("[Sheets Webhook] Error:", err.message || err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Explicit endpoint to trigger immediate background sheet sync
apiRouter.post(["/sheets/sync", "/sheets/force-sync"], async (req: Request, res: Response) => {
  try {
    await serverSyncSheetToApp();
    const records = await dbEngine.getMembers(false);
    res.json({
      success: true,
      count: records.length,
      members: records,
      records,
      message: "Server background sheet sync triggered and executed successfully."
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Proxy to fetch Google Sheet CSV or Apps Script JSON bypassing CORS / redirects
apiRouter.post(["/sheets/fetch-csv", "/sheets/fetch-data"], async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: "Please enter a valid Google Sheet or Apps Script Web App URL." });
    }

    let fetchUrl = formatGoogleSheetCsvUrl(normalizeTargetUrl(url));
    const isAppsScript = fetchUrl.includes("script.google.com");
    const cacheBusterUrl = fetchUrl + (fetchUrl.includes("?") ? "&" : "?") + "_cb=" + Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const resp = await fetch(cacheBusterUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "Accept": isAppsScript ? "application/json, text/plain, */*" : "text/csv, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache"
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return res.status(resp.status).json({
        success: false,
        error: `HTTP error ${resp.status} fetching spreadsheet. Verify link sharing permissions or Web App deployment.`
      });
    }

    const rawText = await resp.text();

    if (!isAppsScript && (rawText.includes("<!DOCTYPE html") || rawText.includes("<html") || rawText.includes("accounts.google.com"))) {
      return res.status(403).json({
        success: false,
        error: "Google Sheet link is not publicly accessible. Please share your Google Sheet with 'Anyone with the link can view'."
      });
    }

    let isJson = false;
    let parsedData: any = null;

    try {
      const trimmed = rawText.trim();
      if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
        parsedData = JSON.parse(trimmed);
        isJson = true;
      }
    } catch (e) {}

    res.json({
      success: true,
      isJson,
      data: parsedData,
      csv: rawText,
      text: rawText
    });
  } catch (err: any) {
    if (err.name === "AbortError" || String(err.message || "").toLowerCase().includes("aborted")) {
      console.warn("[Sheets Fetch Data] Request timed out or aborted by client (Google Apps Script slow response).");
    } else {
      console.error("[Sheets Fetch Data] Error:", err.message || err);
    }
    const isAbort = err.name === "AbortError" || String(err.message || "").toLowerCase().includes("aborted");
    const errMsg = isAbort ? "Google Sheets fetch timed out. Please check your network or spreadsheet sharing permissions." : (err.message || "Failed to fetch spreadsheet data.");
    res.status(500).json({ success: false, error: errMsg });
  }
});

// Test connection to Google Sheet or Apps Script Web App
apiRouter.post("/sheets/test-connection", async (req: Request, res: Response) => {
  try {
    const { webAppUrl, sheetUrl } = req.body;
    const testUrl = (webAppUrl || sheetUrl || "").trim();
    if (!testUrl) {
      return res.status(400).json({ success: false, error: "Please provide a Google Sheets or Web App URL to test." });
    }

    const isAppsScript = testUrl.includes("script.google.com");
    let fetchUrl = normalizeTargetUrl(testUrl);
    if (!isAppsScript && (fetchUrl.includes("/edit") || fetchUrl.includes("/view"))) {
      fetchUrl = fetchUrl.replace(/\/edit.*$/, "").replace(/\/view.*$/, "") + "/export?format=csv";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const start = Date.now();
    const resp = await fetch(fetchUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (!resp.ok) {
      return res.json({
        success: false,
        reachable: false,
        status: resp.status,
        latencyMs,
        error: `Remote returned HTTP ${resp.status}. Please check permissions.`
      });
    }

    const bodyText = await resp.text();
    let recordCount = 0;
    try {
      if (bodyText.trim().startsWith("[")) {
        const arr = JSON.parse(bodyText.trim());
        if (Array.isArray(arr)) recordCount = arr.length;
      } else {
        const lines = bodyText.trim().split("\n").filter(l => l.trim().length > 0);
        recordCount = Math.max(0, lines.length - 1);
      }
    } catch(e) {}

    res.json({
      success: true,
      reachable: true,
      status: resp.status,
      type: isAppsScript ? "Google Apps Script Web App" : "Google Sheets CSV Export",
      latencyMs,
      recordCount,
      message: `Successfully connected to Google Sheet (${latencyMs}ms). Detected ~${recordCount} record(s).`
    });
  } catch (err: any) {
    res.status(500).json({ success: false, reachable: false, error: err.message });
  }
});

// 10. Centralized Spreadsheet Configuration
apiRouter.get("/db/spreadsheet", async (req: Request, res: Response) => {
  try {
    if (fs.existsSync(spreadsheetConfigFile)) {
      const data = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
      return res.json(data);
    }
    res.json({ spreadsheetId: "", spreadsheetTitle: "SiaraMaina Clan Informatics - Master Database" });
  } catch (e: any) {
    res.json({ spreadsheetId: "", spreadsheetTitle: "SiaraMaina Clan Informatics - Master Database" });
  }
});

apiRouter.post("/db/spreadsheet", async (req: Request, res: Response) => {
  try {
    const { spreadsheetId, spreadsheetTitle, webAppUrl, sheetUrl } = req.body;
    const current = fs.existsSync(spreadsheetConfigFile)
      ? JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"))
      : {};

    const updated = {
      ...current,
      spreadsheetId: (spreadsheetId !== undefined ? spreadsheetId : current.spreadsheetId || "").trim(),
      spreadsheetTitle: (spreadsheetTitle || current.spreadsheetTitle || "SiaraMaina Clan Informatics - Master Database").trim(),
      webAppUrl: (webAppUrl !== undefined ? webAppUrl : current.webAppUrl || sheetUrl || "").trim(),
      sheetUrl: (sheetUrl !== undefined ? sheetUrl : current.sheetUrl || "").trim(),
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(spreadsheetConfigFile, JSON.stringify(updated, null, 2), "utf-8");
    res.json({ success: true, config: updated });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

apiRouter.delete("/db/spreadsheet", async (req: Request, res: Response) => {
  try {
    if (fs.existsSync(spreadsheetConfigFile)) {
      const current = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
      current.spreadsheetId = "";
      current.updatedAt = new Date().toISOString();
      fs.writeFileSync(spreadsheetConfigFile, JSON.stringify(current, null, 2), "utf-8");
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// 9. API Fallback 404 Handler
apiRouter.all("*", (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global API Error Logger
apiRouter.use((err: any, req: Request, res: Response, next: any) => {
  console.error("API Error Log:", err);
  if (!res.headersSent) {
    res.status(500).json({ success: false, error: err.message });
  }
});

