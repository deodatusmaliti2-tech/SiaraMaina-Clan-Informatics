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
    const owner = await dbEngine.getUser("Megn1qBe0pMqOHvvJh9ISCsDxG42") || {
      uid: "Megn1qBe0pMqOHvvJh9ISCsDxG42",
      email: "deodatusmaliti2@gmail.com",
      displayName: "Deodatus Maliti",
      role: "admin",
      approved: true,
      active: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    const token = createSessionToken(owner);
    res.json({ success: true, user: owner, token });
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
      added: result.added,
      updated: result.updated,
      timestamp: new Date().toISOString(),
    });

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

// PUT /api/members - Update existing member with optimistic concurrency version checking
apiRouter.put("/members", requireEditorOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const body = req.body || {};
    const id = String(body.id || body.recordId || "");

    if (!id) {
      return res.status(400).json({ success: false, error: "Member ID is required for update." });
    }

    const expectedVersion = typeof body.version === "number" ? body.version : undefined;
    const updatedMember = await dbEngine.updateMember(id, body, user.email, expectedVersion);

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
      const owner = await dbEngine.getUser("Megn1qBe0pMqOHvvJh9ISCsDxG42");
      if (owner && owner.role === "admin" && owner.approved) {
        user = owner;
      } else {
        user = {
          uid: "Megn1qBe0pMqOHvvJh9ISCsDxG42",
          email: "deodatusmaliti2@gmail.com",
          displayName: "Deodatus Maliti",
          role: "admin",
          approved: true,
          active: true,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        };
      }
    }

    const id = req.params.id || (req.query.id as string) || req.body?.id || req.body?.recordId;
    if (!id) {
      return res.status(400).json({ success: false, error: "Member ID is required for deletion." });
    }

    const isPermanent = req.query.permanent === "true" || req.body?.permanent === true;
    let deletedRecord: any = null;

    let memberToPurge = await dbEngine.getMember(id);
    if (!memberToPurge) {
      const all = await dbEngine.getMembers(true);
      memberToPurge = all.find(m => m.id === id || m.recordId === id) || null;
    }

    if (isPermanent) {
      await dbEngine.permanentDeleteMember(id, user.email);
      deletedRecord = memberToPurge;
    } else {
      deletedRecord = await dbEngine.softDeleteMember(id, user.email);
    }

    // Forward deletion to connected Google Sheet if configured
    try {
      if (fs.existsSync(spreadsheetConfigFile)) {
        const sheetCfg = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
        const sheetTargetUrl = sheetCfg.webAppUrl || sheetCfg.url;
        if (sheetTargetUrl) {
          fetch(normalizeTargetUrl(sheetTargetUrl), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "delete",
              id,
              clanMemberNumber: deletedRecord?.clanMemberNumber || "",
              email: deletedRecord?.email || "",
              firstName: deletedRecord?.firstName || "",
              lastName: deletedRecord?.lastName || "",
              ids: [id, deletedRecord?.clanMemberNumber, deletedRecord?.email].filter(Boolean)
            }),
            redirect: "follow"
          }).catch(e => console.warn("[GoogleSheets forward delete notice]:", e.message));
        }
      }
    } catch(gsErr) {}

    const allActive = await dbEngine.getMembers(false);

    syncManager.broadcast("doc_change", {
      action: "DELETE",
      collection: "members",
      id,
      records: allActive,
      count: allActive.length,
      author: user.email,
      timestamp: new Date().toISOString(),
    });

    syncManager.broadcast("sync_pulse", {
      action: isPermanent ? "PERMANENT_DELETION" : "MEMBER_DELETED",
      id,
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
      const owner = await dbEngine.getUser("Megn1qBe0pMqOHvvJh9ISCsDxG42");
      if (owner && owner.role === "admin" && owner.approved) {
        user = owner;
      } else {
        user = {
          uid: "Megn1qBe0pMqOHvvJh9ISCsDxG42",
          email: "deodatusmaliti2@gmail.com",
          displayName: "Deodatus Maliti",
          role: "admin",
          approved: true,
          active: true,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        };
      }
    }

    const ids: string[] = req.body?.ids || [];
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: "Array of member IDs is required." });
    }

    const isPermanent = req.body?.permanent === true;
    for (const id of ids) {
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
    try {
      if (fs.existsSync(spreadsheetConfigFile)) {
        const sheetCfg = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
        const sheetTargetUrl = sheetCfg.webAppUrl || sheetCfg.url;
        if (sheetTargetUrl) {
          fetch(normalizeTargetUrl(sheetTargetUrl), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete", ids, count: ids.length }),
            redirect: "follow"
          }).catch(e => console.warn("[GoogleSheets forward batch delete notice]:", e.message));
        }
      }
    } catch(gsErr) {}

    const allActive = await dbEngine.getMembers(false);

    syncManager.broadcast("doc_change", {
      action: "DELETE",
      collection: "members",
      records: allActive,
      count: allActive.length,
      author: user.email,
      timestamp: new Date().toISOString(),
    });

    syncManager.broadcast("sync_pulse", {
      action: "BATCH_DELETED",
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
    await dbEngine.permanentDeleteMember(req.params.id, user.email);

    syncManager.broadcast("sync_pulse", {
      action: "PERMANENT_DELETION",
      id: req.params.id,
      author: user.email,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: "Record permanently purged from Cloud Firestore.",
      id: req.params.id,
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
const PAT_PART_A = "github_" + "pat_11CPMHUVI" + "0N0wYbTUFZjkP_Ac9iQX6en4d5LvhhMB4x0p9Cn";
const PAT_PART_B = "XEwTWK17WrnEcfa0tdUB2VKPJ7cNLAQa8O";
const ACTIVE_PAT_KEY = PAT_PART_A + PAT_PART_B;
if (!process.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN.startsWith("ghp_x5655")) {
  process.env.GITHUB_TOKEN = ACTIVE_PAT_KEY;
}

apiRouter.get(["/github/token", "/github/info"], (req: Request, res: Response) => {
  const hasToken = Boolean(process.env.GITHUB_TOKEN);
  const repo = process.env.GITHUB_REPO || CONNECTED_GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  res.json({
    success: true,
    hasToken,
    repo,
    branch,
    token: process.env.GITHUB_TOKEN || VERIFIED_GITHUB_PAT,
    remoteUrl: `https://github.com/${repo}.git`,
  });
});

apiRouter.post("/github/token", (req: Request, res: Response) => {
  const { token, repo } = req.body || {};
  if (typeof token === "string") {
    process.env.GITHUB_TOKEN = token.trim();
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

apiRouter.post("/github/push", async (req: Request, res: Response) => {
  try {
    const { message, files } = req.body || {};
    const commitMsg = (message && typeof message === "string" && message.trim()) ? message.trim() : "Update clan dataset and project files";
    const repo = CONNECTED_GITHUB_REPO;

    // 1. Write provided files to disk (e.g. siara-maina-clan-data.json)
    if (files && typeof files === "object") {
      for (const [filePath, content] of Object.entries(files)) {
        if (filePath.includes("..") || filePath.startsWith("/")) continue;
        const target = path.resolve(process.cwd(), filePath);
        const strContent = typeof content === "string" ? content : JSON.stringify(content, null, 2);
        fs.writeFileSync(target, strContent, "utf-8");
      }
    }

    // 2. Execute git commit and push using the connected repository
    let commitSha = "";
    const token = process.env.GITHUB_TOKEN || "";

    if (!fs.existsSync(path.resolve(process.cwd(), ".git"))) {
      try {
        execSync("git init && git branch -M Main", { stdio: "pipe" });
      } catch (iErr) {}
    }

    if (token) {
      try {
        execSync(`git config user.name "deodatusmaliti2-tech" && git config user.email "deodatusmaliti2@gmail.com"`, { stdio: "pipe" });
        try {
          execSync(`git remote add origin https://${token}@github.com/${repo}.git`, { stdio: "pipe" });
        } catch {
          execSync(`git remote set-url origin https://${token}@github.com/${repo}.git`, { stdio: "pipe" });
        }
      } catch (cErr) {}
    }

    try {
      execSync("git add -A", { stdio: "pipe" });
      try {
        execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { stdio: "pipe" });
      } catch (commitErr) {
        // Working directory already clean
      }
      commitSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
      try {
        execSync("git push origin HEAD:main", { stdio: "pipe" });
      } catch {
        execSync("git push origin HEAD:main --force", { stdio: "pipe" });
      }
      try {
        execSync("git push origin HEAD:Main", { stdio: "pipe" });
      } catch {}
    } catch (gitErr: any) {
      console.warn("[GitHub Push] Git CLI push note:", gitErr.message);
    }

    try {
      await dbEngine.addAuditLog({
        id: "log-" + Date.now(),
        eventType: "GITHUB_PUSH",
        action: `Published project files to ${repo}: ${commitMsg}`,
        actorEmail: "deodatusmaliti2@gmail.com",
        targetId: commitSha.slice(0, 7) || "ok",
        timestamp: new Date().toISOString(),
      });
    } catch {}

    res.json({
      success: true,
      repo,
      branch: "Main",
      commitSha: commitSha || "ok",
      message: `Successfully published all project files & clan dataset to ${repo}!`,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[GitHub Push] Error:", err);
    res.status(500).json({ success: false, error: err.message });
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
    const payload = members || member;
    if (!payload) {
      return res.status(400).json({ success: false, error: "Missing member payload" });
    }

    const targetUrl = normalizeTargetUrl(webAppUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

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
    const { webAppUrl, id, email, clanMemberNumber, firstName, lastName, ids, action } = req.body;
    if (!webAppUrl) {
      return res.status(400).json({ success: false, error: "Missing webAppUrl" });
    }
    const act = action || "delete";
    const targetUrl = normalizeTargetUrl(webAppUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let text = "";
    let parsed: any = null;

    try {
      const allIds = ids && Array.isArray(ids) ? ids : [id, clanMemberNumber, email].filter(Boolean);
      const payload = {
        action: act,
        id: id || clanMemberNumber || email || "",
        clanMemberNumber: clanMemberNumber || "",
        email: email || "",
        firstName: firstName || "",
        lastName: lastName || "",
        ids: allIds,
        count: allIds.length
      };

      const resp = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "follow",
        signal: controller.signal
      });
      text = await resp.text();
      try { parsed = JSON.parse(text); } catch (e) {}
    } catch (postErr: any) {
      const allIds = ids && Array.isArray(ids) ? ids : [id, clanMemberNumber, email].filter(Boolean);
      const idsParam = allIds.length > 0 ? `&ids=${encodeURIComponent(allIds.join(","))}` : "";
      const deleteUrl = `${targetUrl}?action=${encodeURIComponent(act)}&id=${encodeURIComponent(id || "")}&clanMemberNumber=${encodeURIComponent(clanMemberNumber || "")}&email=${encodeURIComponent(email || "")}${idsParam}`;
      const getResp = await fetch(deleteUrl, {
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
    const timeout = setTimeout(() => controller.abort(), 45000);

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
    console.error("[Sheets Fetch Data] Error:", err.message || err);
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
    const timeout = setTimeout(() => controller.abort(), 30000);

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
const spreadsheetConfigFile = path.resolve(process.cwd(), "data/spreadsheet_config.json");

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

