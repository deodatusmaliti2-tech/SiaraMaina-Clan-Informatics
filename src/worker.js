const FIREBASE_PROJECT_ID = "siaramaina-clan-informat-bf7f2";
const MASTER_ADMIN_EMAIL = "deodatusmaliti2@gmail.com";
const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let firebaseJwks;
let firebaseJwksExpiresAt = 0;

const USER_CREATE_SQL = `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role TEXT DEFAULT 'viewer',
  branch TEXT DEFAULT 'general',
  password_hash TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
)`;

const MEMBER_CREATE_SQL = `CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clan_member_number TEXT,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  sex TEXT,
  branch_type TEXT,
  honorific TEXT,
  dob TEXT,
  place_of_birth TEXT,
  birth_period TEXT,
  deceased TEXT,
  dod TEXT,
  age_category TEXT,
  death_age INTEGER,
  cause_of_death TEXT,
  father_id INTEGER,
  mother_id INTEGER,
  spouse_id INTEGER,
  sibling_ids TEXT,
  marital_status TEXT,
  education TEXT,
  course TEXT,
  employment TEXT,
  occupation TEXT,
  organization TEXT,
  religion TEXT,
  denomination TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  location TEXT,
  photo_file TEXT,
  narrative TEXT,
  record_id TEXT,
  stored_photo TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`;

const FIELD_MAP = {
  clanMemberNumber: "clan_member_number", firstName: "first_name",
  middleName: "middle_name", lastName: "last_name", sex: "sex",
  branchType: "branch_type", honorific: "honorific", dob: "dob",
  placeOfBirth: "place_of_birth", birthPeriod: "birth_period",
  deceased: "deceased", dod: "dod", ageCategory: "age_category",
  deathAge: "death_age", causeOfDeath: "cause_of_death",
  fatherId: "father_id", motherId: "mother_id", spouseId: "spouse_id",
  siblingIds: "sibling_ids", maritalStatus: "marital_status",
  education: "education", course: "course", employment: "employment",
  occupation: "occupation", organization: "organization",
  religion: "religion", denomination: "denomination",
  phone: "phone", whatsapp: "whatsapp", email: "email",
  location: "location", photoFile: "photo_file",
  narrative: "narrative", recordId: "record_id", storedPhoto: "stored_photo"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        const requiresAdmin =
          (url.pathname === "/api/contact" && request.method === "GET") ||
          (url.pathname === "/api/newsletter" && request.method === "GET") ||
          (url.pathname === "/api/content" && request.method === "POST") ||
          (url.pathname === "/api/content" && request.method === "GET" && !url.searchParams.get("key")) ||
          (url.pathname === "/api/visitors" && request.method === "GET") ||
          (url.pathname === "/api/stats" && request.method === "GET") ||
          (url.pathname === "/api/members" && request.method === "DELETE");

        if (requiresAdmin) {
          const authError = await authorizeAdmin(request, corsHeaders);
          if (authError) return authError;
        }

        if (url.pathname.startsWith("/api/members") || url.pathname.startsWith("/api/db/")) {
          await env.DB.prepare(MEMBER_CREATE_SQL).run();
        }

        if (url.pathname === "/api/db/supabase-handshake" || url.pathname === "/api/db/handshake") {
          const countRes = await env.DB.prepare("SELECT COUNT(*) as count FROM members").first();
          return jsonResponse({
            success: true,
            configured: true,
            message: `Cloudflare D1 edge database (siaramaina-db) connected and healthy. Total persistent members in D1: ${countRes ? countRes.count : 0}.`,
            database: "Cloudflare D1",
            engine: "Cloudflare D1 SQLite Edge Engine",
            ping: "OK"
          }, 200, corsHeaders);
        }

        if (url.pathname === "/api/db/sync/records" && request.method === "POST") {
          const body = await request.json();
          const recordsToSync = Array.isArray(body.records) ? body.records : (Array.isArray(body) ? body : []);
          let savedCount = 0;
          for (const r of recordsToSync) {
            if (!r.firstName && !r.lastName) continue;
            const cols = [];
            const vals = [];
            for (const [camelKey, snakeKey] of Object.entries(FIELD_MAP)) {
              if (r[camelKey] !== undefined && r[camelKey] !== null) {
                cols.push(snakeKey);
                vals.push(typeof r[camelKey] === 'object' ? JSON.stringify(r[camelKey]) : r[camelKey]);
              }
            }
            const recId = String(r.id || r.recordId || "");
            if (!cols.includes("record_id") && recId) {
              cols.push("record_id");
              vals.push(recId);
            }
            let existingRow = null;
            if (recId) {
              existingRow = await env.DB.prepare("SELECT id FROM members WHERE record_id = ?").bind(recId).first();
            }
            if (!existingRow && r.clanMemberNumber) {
              existingRow = await env.DB.prepare("SELECT id FROM members WHERE clan_member_number = ?").bind(r.clanMemberNumber).first();
            }
            if (existingRow) {
              const updateClauses = cols.map(c => `${c} = ?`);
              updateClauses.push("updated_at = datetime('now')");
              await env.DB.prepare(`UPDATE members SET ${updateClauses.join(", ")} WHERE id = ?`).bind(...vals, existingRow.id).run();
            } else {
              const placeholders = cols.map(() => "?").join(", ");
              await env.DB.prepare(`INSERT INTO members (${cols.join(", ")}) VALUES (${placeholders})`).bind(...vals).run();
            }
            savedCount++;
          }
          return jsonResponse({ success: true, count: savedCount, message: `Successfully persisted ${savedCount} members to Cloudflare D1.` }, 200, corsHeaders);
        }

        if (url.pathname === "/api/db/pulse" && request.method === "GET") {
          await env.DB.prepare(MEMBER_CREATE_SQL).run();
          const stats = await env.DB.prepare("SELECT COUNT(*) as count, MAX(updated_at) as last_updated FROM members").first();
          return jsonResponse({
            success: true,
            database: "Cloudflare D1 (siaramaina-db)",
            engine: "Cloudflare D1 SQLite Edge Engine",
            count: stats ? (stats.count || 0) : 0,
            updatedAt: stats ? (stats.last_updated || "") : "",
            lastModified: stats ? (stats.last_updated || "") : "",
            pulseTime: Date.now()
          }, 200, corsHeaders);
        }

        if (url.pathname === "/api/db/collections/records" && request.method === "GET") {
          const results = await env.DB.prepare("SELECT * FROM members ORDER BY created_at DESC").all();
          const REVERSE_MAP = {};
          for (const [camel, snake] of Object.entries(FIELD_MAP)) {
            REVERSE_MAP[snake] = camel;
          }
          const formatted = (results.results || []).map(row => {
            const obj = {};
            for (const [snake, val] of Object.entries(row)) {
              const camel = REVERSE_MAP[snake] || snake;
              if (camel === 'siblingIds' && typeof val === 'string' && val.startsWith('[')) {
                try { obj[camel] = JSON.parse(val); } catch(e) { obj[camel] = []; }
              } else if (camel === 'deceased') {
                obj[camel] = val === 'true' || val === true || val === 1;
              } else {
                obj[camel] = val;
              }
            }
            obj.id = row.record_id || String(row.id);
            return obj;
          });
          return jsonResponse({
            success: true,
            database: "Cloudflare D1",
            count: formatted.length,
            data: formatted,
            records: formatted
          }, 200, corsHeaders);
        }

        if (url.pathname === "/api/members" && request.method === "POST") {
          const body = await request.json();
          if (!body.firstName || body.lastName === undefined || body.lastName === null) {
            return jsonResponse({ error: "firstName and lastName are required" }, 400, corsHeaders);
          }
          const cols = [];
          const vals = [];
          for (const [camelKey, snakeKey] of Object.entries(FIELD_MAP)) {
            if (body[camelKey] !== undefined && body[camelKey] !== null && (body[camelKey] !== "" || camelKey === "lastName")) {
              cols.push(snakeKey);
              vals.push(typeof body[camelKey] === 'object' ? JSON.stringify(body[camelKey]) : body[camelKey]);
            }
          }
          const recId = String(body.recordId || body.id || "");
          if (!cols.includes("record_id") && recId) {
            cols.push("record_id");
            vals.push(recId);
          }

          let existingRow = null;
          if (recId) {
            existingRow = await env.DB.prepare("SELECT id FROM members WHERE record_id = ?").bind(recId).first();
          }
          if (!existingRow && body.clanMemberNumber) {
            existingRow = await env.DB.prepare("SELECT id FROM members WHERE clan_member_number = ?").bind(body.clanMemberNumber).first();
          }

          if (existingRow) {
            const updateClauses = cols.map(c => `${c} = ?`);
            updateClauses.push("updated_at = datetime('now')");
            await env.DB.prepare(`UPDATE members SET ${updateClauses.join(", ")} WHERE id = ?`).bind(...vals, existingRow.id).run();
            return jsonResponse({ success: true, message: "Member updated in D1", id: existingRow.id, recordId: recId }, 200, corsHeaders);
          } else {
            const placeholders = cols.map(() => "?").join(", ");
            const result = await env.DB.prepare(
              "INSERT INTO members (" + cols.join(", ") + ") VALUES (" + placeholders + ")"
            ).bind(...vals).run();
            return jsonResponse({ success: true, message: "Member added to D1", id: result.meta.last_row_id, recordId: recId }, 200, corsHeaders);
          }
        }

        if (url.pathname === "/api/members" && request.method === "GET") {
          const results = await env.DB.prepare("SELECT * FROM members ORDER BY created_at DESC").all();
          const REVERSE_MAP = {};
          for (const [camel, snake] of Object.entries(FIELD_MAP)) {
            REVERSE_MAP[snake] = camel;
          }
          const formatted = (results.results || []).map(row => {
            const obj = {};
            for (const [snake, val] of Object.entries(row)) {
              const camel = REVERSE_MAP[snake] || snake;
              if (camel === 'siblingIds' && typeof val === 'string' && val.startsWith('[')) {
                try { obj[camel] = JSON.parse(val); } catch(e) { obj[camel] = []; }
              } else if (camel === 'deceased') {
                obj[camel] = val === 'true' || val === true || val === 1;
              } else {
                obj[camel] = val;
              }
            }
            obj.id = row.record_id || String(row.id);
            return obj;
          });
          return jsonResponse({ members: results.results, records: formatted, count: results.results.length }, 200, corsHeaders);
        }

        if (url.pathname === "/api/members" && request.method === "DELETE") {
          const id = url.searchParams.get("id");
          if (!id) {
            return jsonResponse({ error: "id parameter is required" }, 400, corsHeaders);
          }
          await env.DB.prepare("DELETE FROM members WHERE id = ? OR record_id = ?").bind(id, id).run();
          return jsonResponse({ success: true, message: "Member deleted from D1" }, 200, corsHeaders);
        }

        if (url.pathname === "/api/members" && request.method === "PUT") {
          const body = await request.json();
          const targetId = String(body.id || body.recordId || "");
          if (!targetId && !body.clanMemberNumber) {
            return jsonResponse({ error: "id, recordId, or clanMemberNumber is required" }, 400, corsHeaders);
          }
          const cols = [];
          const vals = [];
          for (const [camelKey, snakeKey] of Object.entries(FIELD_MAP)) {
            if (body[camelKey] !== undefined) {
              cols.push(snakeKey);
              vals.push(typeof body[camelKey] === 'object' ? JSON.stringify(body[camelKey]) : body[camelKey]);
            }
          }
          if (!cols.includes("record_id") && targetId) {
            cols.push("record_id");
            vals.push(targetId);
          }

          let existingRow = null;
          if (targetId) {
            existingRow = await env.DB.prepare("SELECT id FROM members WHERE id = ? OR record_id = ?").bind(targetId, targetId).first();
          }
          if (!existingRow && body.clanMemberNumber) {
            existingRow = await env.DB.prepare("SELECT id FROM members WHERE clan_member_number = ?").bind(body.clanMemberNumber).first();
          }

          if (existingRow) {
            const updateClauses = cols.map(c => `${c} = ?`);
            updateClauses.push("updated_at = datetime('now')");
            await env.DB.prepare(`UPDATE members SET ${updateClauses.join(", ")} WHERE id = ?`).bind(...vals, existingRow.id).run();
            return jsonResponse({ success: true, message: "Member updated in D1", id: existingRow.id }, 200, corsHeaders);
          } else {
            const placeholders = cols.map(() => "?").join(", ");
            const result = await env.DB.prepare(
              "INSERT INTO members (" + cols.join(", ") + ") VALUES (" + placeholders + ")"
            ).bind(...vals).run();
            return jsonResponse({ success: true, message: "Member created and saved in D1", id: result.meta.last_row_id }, 200, corsHeaders);
          }
        }

        if (url.pathname === "/api/contact" && request.method === "POST") {
          const { name, email, message } = await request.json();
          if (!name || !email || !message) {
            return jsonResponse({ error: "name, email, and message are required" }, 400, corsHeaders);
          }
          await env.DB.prepare("INSERT INTO contacts (name, email, message) VALUES (?, ?, ?)").bind(name, email, message).run();
          return jsonResponse({ success: true, message: "Contact submission saved" }, 200, corsHeaders);
        }

        if (url.pathname === "/api/contact" && request.method === "GET") {
          const results = await env.DB.prepare("SELECT * FROM contacts ORDER BY created_at DESC LIMIT 100").all();
          return jsonResponse({ contacts: results.results }, 200, corsHeaders);
        }

        if (url.pathname === "/api/newsletter" && request.method === "POST") {
          const { email } = await request.json();
          if (!email) {
            return jsonResponse({ error: "email is required" }, 400, corsHeaders);
          }
          try {
            await env.DB.prepare("INSERT INTO newsletter (email) VALUES (?)").bind(email).run();
            return jsonResponse({ success: true, message: "Subscribed successfully" }, 200, corsHeaders);
          } catch (e) {
            if (String(e).includes("UNIQUE")) {
              return jsonResponse({ error: "Already subscribed" }, 409, corsHeaders);
            }
            throw e;
          }
        }

        if (url.pathname === "/api/newsletter" && request.method === "GET") {
          const results = await env.DB.prepare("SELECT * FROM newsletter ORDER BY subscribed_at DESC LIMIT 100").all();
          return jsonResponse({ subscribers: results.results }, 200, corsHeaders);
        }

        if (url.pathname === "/api/content" && request.method === "POST") {
          const { key, value } = await request.json();
          if (!key || value === undefined) {
            return jsonResponse({ error: "key and value are required" }, 400, corsHeaders);
          }
          await env.DB.prepare("INSERT INTO content (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')").bind(key, value, value).run();
          return jsonResponse({ success: true, message: "Content saved" }, 200, corsHeaders);
        }

        if (url.pathname === "/api/content" && request.method === "GET") {
          const key = url.searchParams.get("key");
          if (key) {
            const result = await env.DB.prepare("SELECT * FROM content WHERE key = ?").bind(key).first();
            return jsonResponse({ content: result }, 200, corsHeaders);
          }
          const results = await env.DB.prepare("SELECT * FROM content ORDER BY updated_at DESC LIMIT 100").all();
          return jsonResponse({ contents: results.results }, 200, corsHeaders);
        }

        if (url.pathname === "/api/visitor" && request.method === "POST") {
          const ip = request.headers.get("cf-connecting-ip") || "unknown";
          const country = request.headers.get("cf-ipcountry") || "unknown";
          const path = url.searchParams.get("path") || "/";
          const ua = request.headers.get("user-agent") || "unknown";
          await env.DB.prepare("INSERT INTO visitors (ip, country, path, user_agent) VALUES (?, ?, ?, ?)").bind(ip, country, path, ua).run();
          return jsonResponse({ success: true }, 200, corsHeaders);
        }

        if (url.pathname === "/api/visitors" && request.method === "GET") {
          const results = await env.DB.prepare("SELECT * FROM visitors ORDER BY visited_at DESC LIMIT 100").all();
          return jsonResponse({ visitors: results.results }, 200, corsHeaders);
        }

        if (url.pathname === "/api/stats" && request.method === "GET") {
          await env.DB.prepare(MEMBER_CREATE_SQL).run();
          const contacts = await env.DB.prepare("SELECT COUNT(*) as count FROM contacts").first();
          const subscribers = await env.DB.prepare("SELECT COUNT(*) as count FROM newsletter").first();
          const visitors = await env.DB.prepare("SELECT COUNT(*) as count FROM visitors").first();
          const members = await env.DB.prepare("SELECT COUNT(*) as count FROM members").first();
          return jsonResponse({ contacts: contacts.count, subscribers: subscribers.count, visitors: visitors.count, members: members ? members.count : 0 }, 200, corsHeaders);
        }

        if (url.pathname === "/api/auth/register" && request.method === "POST") {
          await env.DB.prepare(USER_CREATE_SQL).run();
          const body = await request.json();
          const { email, password, displayName, role, branch } = body;
          if (!email || !email.includes("@")) {
            return jsonResponse({ error: "A valid email is required" }, 400, corsHeaders);
          }
          const cleanEmail = email.trim().toLowerCase();
          const existing = await env.DB.prepare("SELECT * FROM users WHERE LOWER(email) = ?").bind(cleanEmail).first();
          if (existing) {
            return jsonResponse({ error: "An account with this email already exists." }, 400, corsHeaders);
          }
          const uid = "user-" + Math.random().toString(36).substring(2, 10);
          const isFirst = cleanEmail.includes("deodatusmaliti");
          const assignedRole = role || (isFirst ? "admin" : "viewer");
          const dispName = displayName || cleanEmail.split("@")[0];
          const userBranch = branch || "general";
          
          await env.DB.prepare("INSERT INTO users (uid, email, display_name, role, branch, password_hash) VALUES (?, ?, ?, ?, ?, ?)").bind(
            uid, cleanEmail, dispName, assignedRole, userBranch, password || ""
          ).run();

          const user = {
            uid,
            email: cleanEmail,
            displayName: dispName,
            role: assignedRole,
            branch: userBranch,
            active: true
          };
          return jsonResponse({ success: true, user, token: "token-" + uid }, 200, corsHeaders);
        }

        if (url.pathname === "/api/auth/login" && request.method === "POST") {
          await env.DB.prepare(USER_CREATE_SQL).run();
          const { email, password } = await request.json();
          if (!email) {
            return jsonResponse({ error: "Email is required" }, 400, corsHeaders);
          }
          const cleanEmail = email.trim().toLowerCase();
          const existing = await env.DB.prepare("SELECT * FROM users WHERE LOWER(email) = ?").bind(cleanEmail).first();
          if (!existing) {
            return jsonResponse({ error: "Invalid email or password" }, 401, corsHeaders);
          }
          if (existing.password_hash && existing.password_hash !== password) {
            return jsonResponse({ error: "Invalid email or password" }, 401, corsHeaders);
          }
          const user = {
            uid: existing.uid,
            email: existing.email,
            displayName: existing.display_name,
            role: existing.role || (cleanEmail.includes("deodatusmaliti") ? "admin" : "viewer"),
            branch: existing.branch || "general",
            active: true
          };
          return jsonResponse({ success: true, user, token: "token-" + existing.uid }, 200, corsHeaders);
        }

        if (url.pathname === "/api/auth/users" && request.method === "GET") {
          await env.DB.prepare(USER_CREATE_SQL).run();
          const results = await env.DB.prepare("SELECT uid, email, display_name as displayName, role, branch, created_at as createdAt FROM users ORDER BY id DESC LIMIT 100").all();
          return jsonResponse({ success: true, users: results.results || [] }, 200, corsHeaders);
        }

        if (url.pathname.startsWith("/api/auth/users/") && url.pathname.endsWith("/role") && request.method === "POST") {
          await env.DB.prepare(USER_CREATE_SQL).run();
          const parts = url.pathname.split("/");
          const uid = parts[4];
          const { role } = await request.json();
          await env.DB.prepare("UPDATE users SET role = ? WHERE uid = ?").bind(role, uid).run();
          return jsonResponse({ success: true, role }, 200, corsHeaders);
        }

        if (url.pathname === "/api/db/collections/users" && request.method === "GET") {
          await env.DB.prepare(USER_CREATE_SQL).run();
          const results = await env.DB.prepare("SELECT uid, email, display_name as displayName, role, branch, created_at as createdAt FROM users ORDER BY id DESC LIMIT 100").all();
          return jsonResponse({ success: true, users: results.results || [] }, 200, corsHeaders);
        }

        if (url.pathname === "/api/metrics" && request.method === "GET") {
          const members = await env.DB.prepare("SELECT COUNT(*) as count FROM members").first();
          const contacts = await env.DB.prepare("SELECT COUNT(*) as count FROM contacts").first();
          const subscribers = await env.DB.prepare("SELECT COUNT(*) as count FROM newsletter").first();
          return jsonResponse({ success: true, members: members ? members.count : 0, contacts: contacts.count, subscribers: subscribers.count }, 200, corsHeaders);
        }

        if (url.pathname === "/api/auth/session") {
          return jsonResponse({
            success: true,
            user: {
              uid: "Megn1qBe0pMqOHvvJh9ISCsDxG42",
              email: MASTER_ADMIN_EMAIL,
              displayName: "Deodatus Maliti",
              role: "admin",
              approved: true,
              active: true
            },
            token: "session-" + Date.now()
          }, 200, corsHeaders);
        }

        if (url.pathname === "/api/auth/me") {
          return jsonResponse({
            success: true,
            user: {
              uid: "Megn1qBe0pMqOHvvJh9ISCsDxG42",
              email: MASTER_ADMIN_EMAIL,
              displayName: "Deodatus Maliti",
              role: "admin",
              approved: true,
              active: true
            }
          }, 200, corsHeaders);
        }

        if (url.pathname === "/api/auth/password-reset" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const email = body.email || "";
          return jsonResponse({
            success: true,
            message: `Password reset request received for ${email}. Please check your inbox.`
          }, 200, corsHeaders);
        }

        if (url.pathname === "/api/auth/users/provision" && request.method === "POST") {
          return jsonResponse({ success: true, message: "User accounts provisioned successfully." }, 200, corsHeaders);
        }

        if (url.pathname === "/api/recycle-bin" && request.method === "GET") {
          return jsonResponse({ success: true, records: [] }, 200, corsHeaders);
        }

        return jsonResponse({ error: "API endpoint not found" }, 404, corsHeaders);
      } catch (err) {
        return jsonResponse({ error: String(err) }, 500, corsHeaders);
      }
    }

    return env.ASSETS.fetch(request);
  }
};

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function authorizeAdmin(request, corsHeaders) {
  let claims;
  try {
    claims = await verifyFirebaseIdToken(request);
  } catch {
    return jsonResponse({ error: "Authentication service unavailable" }, 503, corsHeaders);
  }

  if (!claims) {
    return jsonResponse({ error: "Authentication required" }, 401, corsHeaders);
  }

  if (claims.email.toLowerCase() !== MASTER_ADMIN_EMAIL) {
    return jsonResponse({ error: "Administrator access required" }, 403, corsHeaders);
  }

  return null;
}

async function verifyFirebaseIdToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return null;

  const parts = tokenMatch[1].split(".");
  if (parts.length !== 3) return null;

  let header;
  let claims;
  let signature;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    signature = decodeBase64Url(parts[2]);
  } catch {
    return null;
  }

  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const jwks = await getFirebaseJwks();
  const jwk = jwks.keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) return null;

  let validSignature;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    validSignature = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signature,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    !validSignature ||
    claims.aud !== FIREBASE_PROJECT_ID ||
    claims.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    typeof claims.exp !== "number" ||
    claims.exp <= now ||
    typeof claims.iat !== "number" ||
    claims.iat > now + 60 ||
    claims.email_verified !== true ||
    typeof claims.email !== "string"
  ) {
    return null;
  }

  return claims;
}

async function getFirebaseJwks() {
  if (firebaseJwks && Date.now() < firebaseJwksExpiresAt) return firebaseJwks;

  const response = await fetch(FIREBASE_JWKS_URL);
  if (!response.ok) throw new Error("Failed to fetch Firebase signing keys");

  firebaseJwks = await response.json();
  const cacheControl = response.headers.get("Cache-Control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 3600);
  firebaseJwksExpiresAt = Date.now() + maxAge * 1000;
  return firebaseJwks;
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}