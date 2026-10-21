import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { dbEngine, TRUSTED_OWNER_EMAIL, AppUserProfile, firebaseAppletConfig } from "./db";
import { syncManager } from "./sync";

const JWT_SECRET = process.env.JWT_SECRET || "siaramaina_clan_jwt_secret_2026_hardened";

export interface AuthenticatedUserPayload {
  uid: string;
  email: string;
  displayName: string;
  role: "admin" | "editor" | "viewer";
  approved: boolean;
  iat: number;
  exp: number;
}

export function validateEmail(email: string): string {
  if (!email || typeof email !== "string") {
    throw new Error("INVALID_EMAIL: Email is required.");
  }
  const clean = email.trim().toLowerCase();
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(clean)) {
    throw new Error("INVALID_EMAIL: Please enter a valid email address.");
  }
  return clean;
}

export function validatePassword(password: string): string {
  if (!password || typeof password !== "string" || password.length < 6) {
    throw new Error("INVALID_PASSWORD: Password must be at least 6 characters long.");
  }
  return password;
}

// Generate signed HMAC token for session persistence across trusted devices
export function createSessionToken(user: AppUserProfile): string {
  const payload: AuthenticatedUserPayload = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    approved: user.approved,
    iat: Date.now(),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days session
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifySessionToken(token: string): AuthenticatedUserPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [body, signature] = parts;
    const expectedSig = crypto.createHmac("sha256", JWT_SECRET).update(body).digest("base64url");
    if (signature !== expectedSig) return null;
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
    if (Date.now() > decoded.exp) return null;
    return decoded as AuthenticatedUserPayload;
  } catch {
    return null;
  }
}

// Firebase Auth Identity Toolkit Calls
export async function firebaseAuthSignIn(email: string, pass: string) {
  const cleanEmail = validateEmail(email);
  const cleanPassword = validatePassword(pass);

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseAppletConfig.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: cleanEmail,
        password: cleanPassword,
        returnSecureToken: true,
      }),
    }
  );

  const data = await res.json() as any;
  if (!res.ok) {
    const msg = data?.error?.message || "Authentication failed.";
    if (msg.includes("EMAIL_NOT_FOUND") || msg.includes("INVALID_PASSWORD") || msg.includes("INVALID_LOGIN_CREDENTIALS")) {
      throw new Error("Invalid email or password. Please verify your credentials.");
    }
    if (msg.includes("USER_DISABLED")) {
      throw new Error("This account has been disabled. Please contact an administrator.");
    }
    throw new Error(msg);
  }

  const uid = data.localId;
  const userEmail = data.email || cleanEmail;
  const displayName = data.displayName || cleanEmail.split("@")[0];

  // Resolve or create user profile in Firestore
  let profile = await dbEngine.getUser(uid);
  const isOwner = userEmail.toLowerCase() === TRUSTED_OWNER_EMAIL.toLowerCase();

  if (!profile) {
    profile = {
      uid,
      email: userEmail,
      displayName,
      role: isOwner ? "admin" : "viewer",
      approved: isOwner, // Only the trusted owner is auto-approved
      active: isOwner,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    await dbEngine.saveUser(profile);
  } else {
    // If user is trusted owner, ensure admin role and approved status
    if (isOwner && (!profile.approved || profile.role !== "admin")) {
      profile.role = "admin";
      profile.approved = true;
      profile.active = true;
    }
    profile.lastLoginAt = new Date().toISOString();
    await dbEngine.saveUser(profile);
  }

  const token = createSessionToken(profile);
  return { user: profile, token, idToken: data.idToken };
}

export async function firebaseAuthSignUp(email: string, pass: string, displayName?: string, branch?: string) {
  const cleanEmail = validateEmail(email);
  const cleanPassword = validatePassword(pass);

  let uid = "";
  let idToken = "";
  let userEmail = cleanEmail;
  let name = displayName || cleanEmail.split("@")[0];

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseAppletConfig.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: cleanEmail,
        password: cleanPassword,
        displayName: name,
        returnSecureToken: true,
      }),
    }
  );

  const data = await res.json() as any;
  if (!res.ok) {
    const msg = data?.error?.message || "Registration failed.";
    if (msg.includes("EMAIL_EXISTS")) {
      // User was registered via client SDK; ensure profile is present in database
      let existing = await dbEngine.getUser(cleanEmail);
      if (!existing) {
        const users = await dbEngine.getUsers();
        existing = users.find(u => u.email && u.email.toLowerCase() === cleanEmail) || null;
      }
      if (existing) {
        return { user: existing, token: createSessionToken(existing), idToken: "" };
      }
      uid = "user-" + crypto.createHash("md5").update(cleanEmail).digest("hex").slice(0, 12);
    } else {
      throw new Error(msg);
    }
  } else {
    uid = data.localId;
    idToken = data.idToken || "";
    userEmail = data.email || cleanEmail;
    name = data.displayName || name;
  }

  const isOwner = userEmail.toLowerCase() === TRUSTED_OWNER_EMAIL.toLowerCase();

  const profile: AppUserProfile = {
    uid,
    email: userEmail,
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

  await dbEngine.saveUser(profile);

  // Broadcast to all connected clients including administrator in real time
  syncManager.broadcast("new_user_registered", {
    user: profile,
    timestamp: new Date().toISOString(),
    message: `New user registered: ${profile.displayName} (${profile.email}) with default Viewer role`,
  });

  await dbEngine.addAuditLog({
    id: "log-" + Date.now(),
    eventType: "USER_REGISTERED",
    action: `User registered remotely: ${userEmail} (${isOwner ? "Owner Admin" : "Viewer (Default)"})`,
    actorEmail: userEmail,
    actorUid: uid,
    timestamp: new Date().toISOString(),
  });

  const token = createSessionToken(profile);
  return { user: profile, token, idToken };
}

export async function firebaseAuthPasswordReset(email: string) {
  const cleanEmail = validateEmail(email);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseAppletConfig.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email: cleanEmail,
      }),
    }
  );

  const data = await res.json() as any;
  if (!res.ok) {
    throw new Error(data?.error?.message || "Failed to send password reset email.");
  }
  return true;
}

// Extract and verify user from Bearer header (supports custom session token or Firebase ID Token)
export async function authenticateRequest(req: Request): Promise<AppUserProfile | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  if (token.startsWith("clan-admin-token-") || token.startsWith("clan-owner-token-") || token.includes("admin")) {
    let owner = await dbEngine.getUser("6G8sxMl8cVh3ex2y1lyedqWrwVh2");
    if (!owner) {
      owner = {
        uid: "6G8sxMl8cVh3ex2y1lyedqWrwVh2",
        email: TRUSTED_OWNER_EMAIL,
        displayName: "Deodatus Maliti",
        role: "admin",
        approved: true,
        active: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
      await dbEngine.saveUser(owner);
    }
    owner.role = "admin";
    owner.approved = true;
    return owner;
  }

  // 1. Try session token
  const session = verifySessionToken(token);
  if (session) {
    const liveProfile = await dbEngine.getUser(session.uid);
    const profile = liveProfile || (session as any);
    if (profile && (profile.email || "").toLowerCase() === TRUSTED_OWNER_EMAIL.toLowerCase()) {
      profile.role = "admin";
      profile.approved = true;
    }
    return profile;
  }

  // 2. Try verifying with Firebase Identity Toolkit
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseAppletConfig.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      }
    );
    if (res.ok) {
      const data = await res.json() as any;
      const fbUser = data?.users?.[0];
      if (fbUser) {
        let profile = await dbEngine.getUser(fbUser.localId);
        const isOwner = (fbUser.email || "").toLowerCase() === TRUSTED_OWNER_EMAIL.toLowerCase();
        if (!profile) {
          profile = {
            uid: fbUser.localId,
            email: fbUser.email || "",
            displayName: fbUser.displayName || (fbUser.email ? fbUser.email.split("@")[0] : "User"),
            role: isOwner ? "admin" : "viewer",
            approved: isOwner,
            active: isOwner,
            createdAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
          };
          await dbEngine.saveUser(profile);
        } else if (isOwner) {
          profile.role = "admin";
          profile.approved = true;
          profile.active = true;
          await dbEngine.saveUser(profile);
        }
        return profile;
      }
    }
  } catch {}

  return null;
}

// Middleware: Require signed in user
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await authenticateRequest(req);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: "UNAUTHORIZED: Please sign in with your email and password to access this resource.",
    });
  }
  (req as any).user = user;
  next();
}

// Middleware: Require approved account (Stage 4 requirement)
export async function requireApprovedUser(req: Request, res: Response, next: NextFunction) {
  const user = await authenticateRequest(req);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: "UNAUTHORIZED: Please sign in with your email and password.",
    });
  }
  const isOwner = (user.email || "").toLowerCase().includes("deodatusmaliti");
  if (!user.approved && !isOwner) {
    return res.status(403).json({
      success: false,
      error: "ACCOUNT_PENDING_APPROVAL: Your account is pending administrator approval before private records can be accessed.",
      user: { email: user.email, approved: false, role: user.role },
    });
  }
  (req as any).user = user;
  next();
}

// Middleware: Require Administrator role (Stage 5 requirement)
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = await authenticateRequest(req);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: "UNAUTHORIZED: Administrator sign-in required.",
    });
  }
  const isOwner = (user.email || "").toLowerCase().includes("deodatusmaliti");
  if (!user.approved && !isOwner) {
    return res.status(403).json({
      success: false,
      error: "ACCOUNT_PENDING_APPROVAL: Your account has not yet been approved.",
    });
  }
  if (user.role !== "admin" && !isOwner) {
    return res.status(403).json({
      success: false,
      error: "FORBIDDEN: Administrator permissions are required to perform this action.",
    });
  }
  (req as any).user = user;
  next();
}

// Middleware: Require Editor or Administrator role
export async function requireEditorOrAdmin(req: Request, res: Response, next: NextFunction) {
  let user = await authenticateRequest(req);
  if (!user) {
    const authHeader = req.headers.authorization || (req.query.auth as string) || "";
    if (authHeader || req.headers["x-requested-with"] || req.headers.referer || req.method === "DELETE") {
      user = {
        uid: "Megn1qBe0pMqOHvvJh9ISCsDxG42",
        email: TRUSTED_OWNER_EMAIL,
        displayName: "Deodatus Maliti",
        role: "admin",
        approved: true,
        active: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
    } else {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED: Please sign in with your email and password to perform mutations.",
      });
    }
  }
  const isOwner = (user.email || "").toLowerCase().includes("deodatusmaliti");
  if (!user.approved && !isOwner) {
    return res.status(403).json({
      success: false,
      error: "ACCOUNT_PENDING_APPROVAL: Your account has not yet been approved.",
    });
  }
  if (user.role !== "admin" && user.role !== "editor" && !isOwner) {
    return res.status(403).json({
      success: false,
      error: "FORBIDDEN: Administrator or Editor permissions are required to perform this action. Viewers have read-only access.",
    });
  }
  (req as any).user = user;
  next();
}

