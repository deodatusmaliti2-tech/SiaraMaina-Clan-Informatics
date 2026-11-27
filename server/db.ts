import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  getRequestFirebaseIdToken,
  fsRestGetDoc,
  fsRestListCollection,
  fsRestSetDoc,
  fsRestDeleteDoc,
  fsRestQueryEq,
} from "./firestoreRest";

// 1. Load centralized configuration from firebase-applet-config.json
const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
const rawConfig = fs.readFileSync(configPath, "utf-8");
export const firebaseAppletConfig = JSON.parse(rawConfig);

export const firestoreDb: any = null;
const FS_PROJECT_ID: string = firebaseAppletConfig.projectId || "";
const FS_DATABASE_ID: string = firebaseAppletConfig.firestoreDatabaseId || "(default)";

const quotaFlagPath = path.resolve(process.cwd(), "server/data/firestore_quota.flag");

function isQuotaExhaustedPersisted(): boolean {
  if (fs.existsSync(quotaFlagPath)) {
    try {
      const content = fs.readFileSync(quotaFlagPath, "utf-8").trim();
      const today = new Date().toISOString().slice(0, 10);
      if (content === today) {
        return true;
      } else {
        try { fs.unlinkSync(quotaFlagPath); } catch (e) {}
        return false;
      }
    } catch (e) {
      return false;
    }
  }
  return false;
}

function setQuotaExhaustedPersisted() {
  try {
    if (!fs.existsSync(path.dirname(quotaFlagPath))) {
      fs.mkdirSync(path.dirname(quotaFlagPath), { recursive: true });
    }
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(quotaFlagPath, today, "utf-8");
  } catch (e) {}
}

let serverFirestoreQuotaExhausted = isQuotaExhaustedPersisted();

export function handleServerFirestoreError(err: any, context: string) {
  if (!err) return;
  const msg = String(err.message || err || "").toLowerCase();
  const code = String(err.code || "").toLowerCase();
  if (
    code.includes("resource-exhausted") ||
    code.includes("8") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("resource-exhausted") ||
    msg.includes("exceeded") ||
    msg.includes("rst_stream")
  ) {
    if (!serverFirestoreQuotaExhausted) {
      serverFirestoreQuotaExhausted = true;
      setQuotaExhaustedPersisted();
      console.warn(`[${context}] Firestore daily free quota reached. Server seamlessly operating in local JSON database mode.`);
    }
  } else if (code.includes("permission-denied") || msg.includes("permission")) {
    // Expected when the current caller lacks Firestore rule privilege for this collection; local JSON fallback remains authoritative.
  } else {
    console.warn(`[${context}] Firestore notice:`, err?.message || err);
  }
}

export function isServerFirestoreAvailable(): boolean {
  return Boolean(FS_PROJECT_ID && getRequestFirebaseIdToken() && !serverFirestoreQuotaExhausted);
}

export const TRUSTED_OWNER_EMAIL = "deodatusmaliti2@gmail.com";

// Local JSON fallback stores for offline/unprovisioned Firestore state
const membersJsonPath = path.resolve(process.cwd(), "server/data/members.json");
const usersJsonPath = path.resolve(process.cwd(), "server/data/users.json");
const submissionsJsonPath = path.resolve(process.cwd(), "server/data/submissions.json");
const logsJsonPath = path.resolve(process.cwd(), "server/data/logs.json");
const deletedIdsJsonPath = path.resolve(process.cwd(), "server/data/deleted_ids.json");
const rootDeletedIdsJsonPath = path.resolve(process.cwd(), "data/deleted_ids.json");

const clanDataJsonPath = path.resolve(process.cwd(), "siara-maina-clan-data.json");
const rootMembersJsonPath = path.resolve(process.cwd(), "data/members.json");

function readJsonFile(filePath: string): any[] {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (e) {}
  return [];
}

function writeJsonFile(filePath: string, data: any) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {}
}

export function syncClanDataFiles(membersList: any[]) {
  const activeOnly = Array.isArray(membersList) ? membersList.filter(m => m && !m.deleted && m.active !== false) : [];
  try {
    writeJsonFile(membersJsonPath, activeOnly);
    writeJsonFile(rootMembersJsonPath, activeOnly);
    writeJsonFile(clanDataJsonPath, activeOnly);
  } catch (e) {}
}

export interface DeletedRecordEntry {
  id: string;
  clanMemberNumber?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  nameKey?: string;
  deletedAt: string;
  deletedBy?: string;
  sheetConfirmedDeletedAt?: string;
}

export function getDeletedRegistry(): DeletedRecordEntry[] {
  const fromServer = readJsonFile(deletedIdsJsonPath);
  const fromRoot = readJsonFile(rootDeletedIdsJsonPath);
  const map = new Map<string, DeletedRecordEntry>();
  [...fromServer, ...fromRoot].forEach(entry => {
    if (entry && entry.id) {
      map.set(String(entry.id).trim(), entry);
    }
  });
  return Array.from(map.values());
}

export function recordDeletion(id: string, member?: any, deletedBy: string = "system") {
  if (!id) return;
  const list = getDeletedRegistry();
  const idStr = String(id).trim();
  const clanNum = String(member?.clanMemberNumber || member?.clan_member_number || "").trim().toUpperCase();
  const email = String(member?.email || "").trim().toLowerCase();
  const firstName = String(member?.firstName || member?.first_name || "").trim();
  const lastName = String(member?.lastName || member?.last_name || "").trim();
  const fnLower = firstName.toLowerCase();
  const lnLower = lastName.toLowerCase();
  const nameKey = (fnLower && lnLower) ? `${fnLower}_${lnLower}` : "";

  const exists = list.some(d => d.id === idStr || (clanNum && d.clanMemberNumber === clanNum) || (email && d.email === email) || (nameKey && d.nameKey === nameKey));
  if (!exists) {
    list.push({
      id: idStr,
      clanMemberNumber: clanNum || undefined,
      email: email || undefined,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      nameKey: nameKey || undefined,
      deletedAt: new Date().toISOString(),
      deletedBy
    });
    writeJsonFile(deletedIdsJsonPath, list);
    writeJsonFile(rootDeletedIdsJsonPath, list);
  }

  // Also purge from members.json immediately
  const members = readJsonFile(membersJsonPath);
  const filtered = members.filter((m: any) => {
    if (!m) return false;
    const mId = String(m.id || m.recordId || "").trim();
    const mClan = String(m.clanMemberNumber || "").trim().toUpperCase();
    const mEmail = String(m.email || "").trim().toLowerCase();
    const mFn = String(m.firstName || m.first_name || "").trim().toLowerCase();
    const mLn = String(m.lastName || m.last_name || "").trim().toLowerCase();

    if (mId && mId === idStr) return false;
    if (clanNum && mClan && mClan === clanNum) return false;
    if (email && mEmail && mEmail === email) return false;
    if (nameKey && mFn && mLn && `${mFn}_${mLn}` === nameKey) return false;
    return true;
  });
  writeJsonFile(membersJsonPath, filtered);
}

export function markDeletionConfirmedOnSheet(ids: string[]) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const idSet = new Set(ids.map((s) => String(s || "").trim()).filter(Boolean));
  if (idSet.size === 0) return;
  const list = getDeletedRegistry();
  const nowIso = new Date().toISOString();
  let modified = false;
  list.forEach((d) => {
    if (d && d.id && idSet.has(String(d.id).trim())) {
      d.sheetConfirmedDeletedAt = nowIso;
      modified = true;
    }
  });
  if (modified) {
    writeJsonFile(deletedIdsJsonPath, list);
    writeJsonFile(rootDeletedIdsJsonPath, list);
  }
}

export function unrecordDeletion(id: string, member?: any) {
  if (!id && !member) return;
  const list = getDeletedRegistry();
  const idStr = String(id || "").trim();
  const clanStr = String(member?.clanMemberNumber || member?.clan_member_number || "").trim().toUpperCase();
  const emailStr = String(member?.email || "").trim().toLowerCase();
  const fnLower = String(member?.firstName || member?.first_name || "").trim().toLowerCase();
  const lnLower = String(member?.lastName || member?.last_name || "").trim().toLowerCase();
  const nameKey = fnLower && lnLower ? `${fnLower}_${lnLower}` : "";

  const filtered = list.filter((d) => {
    if (!d) return false;
    if (idStr && (d.id === idStr || d.clanMemberNumber === idStr)) return false;
    if (clanStr && d.clanMemberNumber && d.clanMemberNumber.toUpperCase() === clanStr) return false;
    if (emailStr && d.email && d.email.toLowerCase() === emailStr) return false;
    if (nameKey && d.nameKey && d.nameKey === nameKey) return false;
    return true;
  });
  if (filtered.length !== list.length) {
    writeJsonFile(deletedIdsJsonPath, filtered);
    writeJsonFile(rootDeletedIdsJsonPath, filtered);
  }
}

export function isMemberIdDeleted(
  id?: string,
  clanNum?: string,
  email?: string,
  _firstName?: string,
  _lastName?: string
): boolean {
  const list = getDeletedRegistry();
  const idStr = String(id || "").trim();
  const rawClan = String(clanNum || "").trim().toUpperCase();
  const clanStr =
    /^CLAN/i.test(rawClan) || (/^[0-9]+$/.test(rawClan) && !rawClan.includes("MALITI")) ? rawClan : "";
  const emailStr = String(email || "").trim().toLowerCase();
  const now = Date.now();

  return list.some((d) => {
    if (!d) return false;
    const deletedMs = d.deletedAt ? new Date(d.deletedAt).getTime() : 0;
    const confirmedMs = d.sheetConfirmedDeletedAt ? new Date(d.sheetConfirmedDeletedAt).getTime() : 0;

    // Once Google Sheets has confirmed row removal and the 20s stale-read grace window has elapsed,
    // allow the user to intentionally re-add the person on Google Sheets (or Ctrl+Z undo) without permanent blocking.
    if (confirmedMs > 0 && now - confirmedMs > 20000) {
      return false;
    }

    const idMatches = Boolean(idStr && d.id && String(d.id).trim() === idStr);
    const dClan = String(d.clanMemberNumber || "").trim().toUpperCase();
    const clanMatches = Boolean(clanStr && dClan && dClan === clanStr);
    const emailMatches = Boolean(emailStr && d.email && String(d.email).trim().toLowerCase() === emailStr);

    if (idMatches || clanMatches || emailMatches) {
      // Block re-import of deleted members for 24 hours to prevent background sync resurrection/duplication
      return !deletedMs || now - deletedMs < 24 * 60 * 60 * 1000;
    }
    return false;
  });
}

export interface ClanMemberRecord {
  id: string;
  recordId: string;
  clanMemberNumber?: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  sex?: string;
  branchType?: string;
  honorific?: string;
  dob?: string;
  placeOfBirth?: string;
  birthPeriod?: string;
  deceased: boolean;
  dod?: string;
  ageCategory?: string;
  deathAge?: string;
  causeOfDeath?: string;
  fatherId?: string;
  motherId?: string;
  spouseId?: string;
  siblingIds?: string[];
  maritalStatus?: string;
  education?: string;
  course?: string;
  employment?: string;
  occupation?: string;
  organization?: string;
  religion?: string;
  denomination?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  location?: string;
  photoFile?: string;
  narrative?: string;
  photo?: string;
  storedPhoto?: string;
  version: number;
  active: boolean;
  deleted: boolean;
  deletedAt?: string | null;
  createdBy: string;
  lastModifiedBy: string;
  createdAt: string;
  updatedAt: string;
  submissionId?: string;
}

export interface AppUserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: "admin" | "editor" | "viewer";
  branch?: string;
  approved: boolean;
  active: boolean;
  pendingRoleAssignment?: boolean;
  registeredRemotely?: boolean;
  createdAt: string;
  lastLoginAt: string;
}

export interface ActivityLogEntry {
  id: string;
  eventType: string;
  action: string;
  actorEmail: string;
  actorUid?: string;
  actorRole?: string;
  targetId?: string;
  details?: string;
  timestamp: string;
}

const SHEET_ALIAS_KEYS_TO_STRIP = new Set([
  "Member ID",
  "MemberID",
  "Record ID",
  "Clan Member Number",
  "First Name",
  "Middle Name",
  "Last Name",
  "Photo",
  "Photo URL",
  "Passport-Style Image",
  "Sibling Profiles",
  "_sheetRowHint",
  "_needsIdWriteback",
  "_rawHadBlankId",
]);

const OPTIONAL_STRING_FIELDS = new Set([
  "recordId",
  "clanMemberNumber",
  "firstName",
  "middleName",
  "lastName",
  "sex",
  "branchType",
  "honorific",
  "dob",
  "placeOfBirth",
  "birthPeriod",
  "dod",
  "ageCategory",
  "deathAge",
  "causeOfDeath",
  "fatherId",
  "motherId",
  "spouseId",
  "maritalStatus",
  "education",
  "course",
  "employment",
  "occupation",
  "organization",
  "religion",
  "denomination",
  "phone",
  "whatsapp",
  "email",
  "location",
  "photoFile",
  "narrative",
  "photo",
  "storedPhoto",
  "photoUrl",
  "createdBy",
  "createdByEmail",
  "addedBy",
  "lastModifiedBy",
  "createdAt",
  "updatedAt",
  "submissionId",
]);

export function sanitizeMemberId(rawId: string): string {
  const cleaned = String(rawId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_\-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned;
}

export function sanitizeForFirestore(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  const clean: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (SHEET_ALIAS_KEYS_TO_STRIP.has(k) || k.startsWith("_")) continue;
    if (OPTIONAL_STRING_FIELDS.has(k)) {
      if (v === null) {
        clean[k] = "";
      } else {
        clean[k] = String(v);
      }
      continue;
    }
    if (k === "deceased" || k === "active" || k === "deleted") {
      clean[k] = Boolean(v);
      continue;
    }
    if (k === "siblingIds") {
      clean[k] = Array.isArray(v) ? v.map((s) => String(s || "").trim()).filter(Boolean) : [];
      continue;
    }
    clean[k] = (v && typeof v === "object" && !Array.isArray(v)) ? sanitizeForFirestore(v) : v;
  }
  return clean;
}

export function generateStableMemberId(raw: any): string {
  if (raw.id && String(raw.id).trim()) return String(raw.id).trim();
  if (raw.recordId && String(raw.recordId).trim()) return String(raw.recordId).trim();
  const fn = String(raw.firstName || raw.first_name || "").trim().toLowerCase();
  const mn = String(raw.middleName || raw.middle_name || "").trim().toLowerCase();
  const ln = String(raw.lastName || raw.last_name || "").trim().toLowerCase();
  const branch = String(raw.branchType || raw.branch || "heritage").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const phone = String(raw.phone || raw.mobile || "").replace(/\D/g, "");
  const dob = String(raw.dob || "").trim().replace(/[^a-z0-9]/gi, "");

  const parts = [fn, mn, ln, branch, phone, dob].filter(Boolean);
  const slug = parts.join("-").replace(/[^a-z0-9\-]/g, "").slice(0, 40);
  return `rec_${slug || "member_" + Date.now()}`;
}

export function deduplicateMembersList(list: ClanMemberRecord[]): ClanMemberRecord[] {
  if (!Array.isArray(list)) return [];
  const idMap = new Map<string, ClanMemberRecord>();
  const clanMap = new Map<string, ClanMemberRecord>();
  const emailMap = new Map<string, ClanMemberRecord>();
  const cleaned: ClanMemberRecord[] = [];

  list.forEach(m => {
    if (!m) return;
    const mId = String(m.id || m.recordId || "").trim();
    const rawClan = String(m.clanMemberNumber || "").trim().toUpperCase();
    const isExplicitClanNum = /^CLAN/i.test(rawClan) || (/^[0-9]+$/.test(rawClan) && !rawClan.includes("MALITI") && !rawClan.includes("SIARA"));
    const clanNum = isExplicitClanNum ? rawClan : "";
    const emailKey = String(m.email || "").trim().toLowerCase();

    let existing: ClanMemberRecord | null = null;
    if (mId && idMap.has(mId)) existing = idMap.get(mId)!;
    else if (clanNum && clanMap.has(clanNum)) existing = clanMap.get(clanNum)!;
    else if (emailKey && emailMap.has(emailKey)) existing = emailMap.get(emailKey)!;

    if (existing) {
      Object.keys(m).forEach(k => {
        const val = (m as any)[k];
        if (val !== undefined && val !== "" && val !== null && val !== "Not Recorded") {
          if (!(existing as any)[k] || (existing as any)[k] === "Not Recorded") {
            (existing as any)[k] = val;
          }
        }
      });
    } else {
      if (mId) idMap.set(mId, m);
      if (clanNum) clanMap.set(clanNum, m);
      if (emailKey) emailMap.set(emailKey, m);
      cleaned.push(m);
    }
  });

  return cleaned;
}

function normalizeCanonicalIdKey(val: any): string {
  return String(val || "").trim().replace(/\s+/g, "-").toLowerCase();
}

function parseRecordTimestampMs(rec: any): number {
  if (!rec) return 0;
  const raw = rec.updatedAt || rec.lastModified || rec.createdAt || "";
  if (!raw) return 0;
  const ms = Date.parse(String(raw));
  return Number.isNaN(ms) ? 0 : ms;
}

function pickNewerMemberRecord(
  localRec: ClanMemberRecord | null | undefined,
  remoteRec: ClanMemberRecord | null | undefined
): ClanMemberRecord {
  if (!localRec) return remoteRec as ClanMemberRecord;
  if (!remoteRec) return localRec;

  const localMs = parseRecordTimestampMs(localRec);
  const remoteMs = parseRecordTimestampMs(remoteRec);

  // Strictly newer timestamp always wins so stale Firestore docs never revert fresh local/Sheet edits
  if (localMs > remoteMs) return localRec;
  if (remoteMs > localMs) return remoteRec;

  const localVer = Number(localRec.version || 0);
  const remoteVer = Number(remoteRec.version || 0);
  if (remoteVer > localVer) return remoteRec;
  return localRec;
}

function normalizeBranchDisplayLabel(val: any): string {
  const s = String(val || "").trim();
  const map: Record<string, string> = {
    heritage: "Foundational Ancestry",
    siara: "Siara Branch",
    maina: "Maina Branch",
    maliti: "Maliti Family",
  };
  return map[s.toLowerCase()] || s;
}

export const dbEngine = {
  // Fetch members with soft-delete filter and resilient JSON fallback
  getMembers: async (includeDeleted = false): Promise<ClanMemberRecord[]> => {
    const deletedList = getDeletedRegistry();
    const deletedIds = new Set(deletedList.map(d => d.id).filter(Boolean));
    const deletedClans = new Set(deletedList.map(d => d.clanMemberNumber).filter(Boolean));
    const deletedEmails = new Set(deletedList.map(d => d.email).filter(Boolean));

    const readActiveLocal = (): ClanMemberRecord[] => {
      const local = readJsonFile(membersJsonPath);
      const filtered = local.filter((m: any) => {
        if (!m) return false;
        const fn = String(m.firstName || "").trim().toLowerCase();
        const ln = String(m.lastName || "").trim().toLowerCase();
        const mClan = m.clanMemberNumber;
        const mEmail = m.email;
        if (fn === "by" && !ln && !mClan && !mEmail) return false;
        if (!includeDeleted) {
          if (m.deleted || m.active === false) return false;
          const mId = m.id || m.recordId;
          if (isMemberIdDeleted(mId, mClan, mEmail)) return false;
        }
        return true;
      });
      return deduplicateMembersList(filtered);
    };

    if (!isServerFirestoreAvailable()) {
      return readActiveLocal();
    }

    try {
      const idToken = getRequestFirebaseIdToken();
      if (!idToken) throw new Error("No authenticated Firebase token for request");
      const docs = await fsRestListCollection(FS_PROJECT_ID, FS_DATABASE_ID, "members", idToken);
      const localList = readActiveLocal();
      const mergedByNormId = new Map<string, ClanMemberRecord>();

      localList.forEach((m) => {
        const key = normalizeCanonicalIdKey(m.id || m.recordId);
        if (key) mergedByNormId.set(key, m);
      });

      docs.forEach(({ id: docId, data }) => {
        if (data && docId !== "test-connection-check") {
          const mId = docId;
          const mClan = String(data.clanMemberNumber || data.clan_member_number || "").trim().toUpperCase();
          const mEmail = String(data.email || "").trim().toLowerCase();
          const fn = String(data.firstName || data.first_name || "").trim().toLowerCase();
          const ln = String(data.lastName || data.last_name || "").trim().toLowerCase();
          if (fn === "by" && !ln && !mClan && !mEmail) return;

          const isDeletedInRegistry = deletedIds.has(mId) || (mClan && deletedClans.has(mClan)) || (mEmail && deletedEmails.has(mEmail));

          const item: ClanMemberRecord = {
            ...(data as any),
            id: docId,
            recordId: data.recordId || docId,
            version: typeof data.version === "number" ? data.version : 1,
            active: data.active !== false && !data.deleted && !isDeletedInRegistry,
            deleted: data.deleted === true || isDeletedInRegistry,
            deceased: Boolean(data.deceased),
          };
          if (includeDeleted || !item.deleted) {
            const key = normalizeCanonicalIdKey(mId);
            if (key) {
              const existingLocal = mergedByNormId.get(key);
              mergedByNormId.set(key, pickNewerMemberRecord(existingLocal, item));
            }
          }
        }
      });

      const finalDeduplicated = deduplicateMembersList(Array.from(mergedByNormId.values()));
      if (!includeDeleted) {
        writeJsonFile(membersJsonPath, finalDeduplicated);
      }
      return finalDeduplicated;
    } catch (err) {
      handleServerFirestoreError(err, "getMembers");
      return readActiveLocal();
    }
  },

  getMember: async (id: string, clanMemberNumber?: string): Promise<ClanMemberRecord | null> => {
    const cleanId = String(id || "").trim();
    const normCleanId = normalizeCanonicalIdKey(cleanId);
    const cleanClan = String(clanMemberNumber || "").trim().toUpperCase();
    if (!cleanId && !cleanClan) return null;

    const local = readJsonFile(membersJsonPath);
    let localMatch: ClanMemberRecord | null = null;
    if (cleanId) {
      localMatch =
        local.find(
          (m: any) =>
            m &&
            (m.id === cleanId ||
              m.recordId === cleanId ||
              (normCleanId &&
                (normalizeCanonicalIdKey(m.id) === normCleanId ||
                  normalizeCanonicalIdKey(m.recordId) === normCleanId)))
        ) || null;
    }
    if (!localMatch && cleanClan) {
      localMatch =
        local.find(
          (m: any) => m && String(m.clanMemberNumber || "").trim().toUpperCase() === cleanClan
        ) || null;
    }

    let remoteMatch: ClanMemberRecord | null = null;
    try {
      const idToken = getRequestFirebaseIdToken();
      if (cleanId && isServerFirestoreAvailable() && idToken) {
        const data = await fsRestGetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "members", cleanId, idToken);
        if (data) {
          remoteMatch = {
            ...(data as any),
            id: cleanId,
            recordId: data.recordId || cleanId,
            version: typeof data.version === "number" ? data.version : 1,
            active: data.active !== false && !data.deleted,
            deleted: data.deleted === true,
            deceased: Boolean(data.deceased),
          };
        }
      }
    } catch (err) {
      handleServerFirestoreError(err, "getMember");
    }

    if (localMatch && remoteMatch) {
      return pickNewerMemberRecord(localMatch, remoteMatch);
    }
    return localMatch || remoteMatch;
  },

  // Helper: extract clean member ID from raw string or "Name [ID]" format
  extractMemberRefId: (val: any): string => {
    if (!val) return "";
    const s = String(val).trim();
    const match = s.match(/\[([^\]]+)\]/);
    if (match && match[1]) return match[1].trim();
    return s;
  },

  // Helper: normalize siblingIds input into a clean, deduplicated array of member IDs (excluding self)
  normalizeSiblingIds: (raw: any, selfId?: string): string[] => {
    let list: any[] = [];
    if (Array.isArray(raw)) {
      list = raw;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed) {
        if (trimmed.startsWith("[")) {
          try {
            const parsed = JSON.parse(trimmed);
            list = Array.isArray(parsed) ? parsed : [trimmed];
          } catch {
            list = trimmed.split(/[;,]/);
          }
        } else {
          list = trimmed.split(/[;,]/);
        }
      }
    }

    const cleanSelf = selfId ? dbEngine.extractMemberRefId(selfId) : "";
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of list) {
      const cleanId = dbEngine.extractMemberRefId(item);
      if (!cleanId) continue;
      if (cleanSelf && cleanId === cleanSelf) continue;
      if (!seen.has(cleanId)) {
        seen.add(cleanId);
        result.push(cleanId);
      }
    }
    return result;
  },

  // Authoritative bidirectional synchronization of sibling links across Firestore and local JSON mirrors
  syncBidirectionalSiblingLinks: async (
    memberId: string,
    desiredSiblingIds: string[],
    userEmail: string
  ): Promise<ClanMemberRecord[]> => {
    const cleanMemberId = dbEngine.extractMemberRefId(memberId);
    if (!cleanMemberId) return [];

    const now = new Date().toISOString();
    const desiredSet = new Set(dbEngine.normalizeSiblingIds(desiredSiblingIds, cleanMemberId));

    // Read all active local records (and merge with Firestore if available)
    const localList = readJsonFile(membersJsonPath);
    const allMembersMap = new Map<string, ClanMemberRecord>();

    if (Array.isArray(localList)) {
      for (const m of localList) {
        if (m && (m.id || m.recordId)) {
          const idKey = String(m.id || m.recordId).trim();
          allMembersMap.set(idKey, m);
        }
      }
    }

    const idToken = getRequestFirebaseIdToken();
    if (isServerFirestoreAvailable() && idToken) {
      try {
        const docs = await fsRestListCollection(FS_PROJECT_ID, FS_DATABASE_ID, "members", idToken);
        docs.forEach(({ id: docId, data }) => {
          if (!data || data.deleted || data.active === false) return;
          const idKey = String(docId || data.id || data.recordId || "").trim();
          if (idKey) {
            const normKey = normalizeCanonicalIdKey(idKey);
            let matchedKey = idKey;
            let existingLocal = allMembersMap.get(idKey);
            if (!existingLocal && normKey) {
              for (const [k, v] of allMembersMap.entries()) {
                if (normalizeCanonicalIdKey(k) === normKey) {
                  matchedKey = k;
                  existingLocal = v;
                  break;
                }
              }
            }
            const fsCandidate: ClanMemberRecord = { ...(data as any), id: idKey, recordId: idKey };
            allMembersMap.set(matchedKey, pickNewerMemberRecord(existingLocal, fsCandidate));
          }
        });
      } catch (err) {
        handleServerFirestoreError(err, "syncBidirectionalSiblingLinks:read");
      }
    }

    const affectedSiblings: ClanMemberRecord[] = [];
    const updatedAllMembers: ClanMemberRecord[] = [];

    for (const [otherId, otherRecord] of allMembersMap.entries()) {
      if (!otherRecord) continue;

      if (otherId === cleanMemberId || otherRecord.id === cleanMemberId) {
        updatedAllMembers.push(otherRecord);
        continue;
      }

      if (otherRecord.deleted || otherRecord.active === false) {
        updatedAllMembers.push(otherRecord);
        continue;
      }

      const currentCleanSiblings = dbEngine.normalizeSiblingIds(otherRecord.siblingIds, otherId);
      const currentlyLinksMember = currentCleanSiblings.includes(cleanMemberId);
      const shouldLinkMember = desiredSet.has(otherId);

      if (shouldLinkMember && !currentlyLinksMember) {
        const nextSiblings = [...currentCleanSiblings, cleanMemberId];
        const updatedOther: ClanMemberRecord = {
          ...otherRecord,
          id: otherRecord.id || otherId,
          recordId: otherRecord.recordId || otherRecord.id || otherId,
          siblingIds: nextSiblings,
          version: (Number(otherRecord.version) || 1) + 1,
          lastModifiedBy: userEmail || "system",
          updatedAt: now,
        };
        affectedSiblings.push(updatedOther);
        updatedAllMembers.push(updatedOther);
      } else if (!shouldLinkMember && currentlyLinksMember) {
        const nextSiblings = currentCleanSiblings.filter((sid) => sid !== cleanMemberId);
        const updatedOther: ClanMemberRecord = {
          ...otherRecord,
          id: otherRecord.id || otherId,
          recordId: otherRecord.recordId || otherRecord.id || otherId,
          siblingIds: nextSiblings,
          version: (Number(otherRecord.version) || 1) + 1,
          lastModifiedBy: userEmail || "system",
          updatedAt: now,
        };
        affectedSiblings.push(updatedOther);
        updatedAllMembers.push(updatedOther);
      } else {
        updatedAllMembers.push(otherRecord);
      }
    }

    if (affectedSiblings.length > 0) {
      // Persist updated sibling records to Firestore when caller token is present
      const idToken = getRequestFirebaseIdToken();
      if (isServerFirestoreAvailable() && idToken) {
        try {
          for (const sib of affectedSiblings) {
            await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "members", sib.id, sanitizeForFirestore(sib), idToken, true);
          }
        } catch (err) {
          handleServerFirestoreError(err, "syncBidirectionalSiblingLinks:write");
        }
      }

      // Persist to all local JSON mirrors
      syncClanDataFiles(updatedAllMembers);
    }

    return affectedSiblings;
  },

  // Reliable member addition with submissionId idempotency and resilient local JSON fallback
  addMember: async (
    rawBody: any,
    userEmail: string,
    submissionId?: string
  ): Promise<{
    member: ClanMemberRecord;
    isDuplicateRetry: boolean;
    affectedSiblings: ClanMemberRecord[];
    updatedSpouse: ClanMemberRecord | null;
    firestoreSynced: boolean;
    firestoreError?: string;
  }> => {
    const now = new Date().toISOString();
    const subId = submissionId || rawBody.submissionId || null;

    const cleanCNum = String(rawBody.clanMemberNumber || rawBody.clan_member_number || "").trim();
    const explicitId = rawBody["Member ID"] || rawBody["MemberID"] || rawBody["Record ID"] || rawBody.id || rawBody.recordId || "";
    const safeExplicit = explicitId && !String(explicitId).startsWith("sheet_") ? sanitizeMemberId(String(explicitId)) : "";
    const safeClanSlug = cleanCNum ? sanitizeMemberId(cleanCNum) : "";
    const memberId = safeExplicit
      ? safeExplicit
      : (safeClanSlug ? `rec-clan-${safeClanSlug}` : ("rec-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex")));

    // Normalize sibling array (clean IDs, no self-reference, deduplicated)
    const siblingIds = dbEngine.normalizeSiblingIds(rawBody.siblingIds, memberId);

    const newRecord: ClanMemberRecord = {
      id: memberId,
      recordId: memberId,
      clanMemberNumber: cleanCNum,
      firstName: String(rawBody.firstName || rawBody.first_name || "").trim(),
      middleName: String(rawBody.middleName || rawBody.middle_name || "").trim(),
      lastName: String(rawBody.lastName || rawBody.last_name || "").trim(),
      sex: String(rawBody.sex || rawBody.gender || "").trim(),
      branchType: String(rawBody.branchType || rawBody.branch_type || "").trim(),
      honorific: String(rawBody.honorific || "").trim(),
      dob: String(rawBody.dob || rawBody.date_of_birth || "").trim(),
      placeOfBirth: String(rawBody.placeOfBirth || rawBody.place_of_birth || "").trim(),
      birthPeriod: String(rawBody.birthPeriod || rawBody.birth_period || "").trim(),
      deceased: rawBody.deceased === true || rawBody.deceased === "true" || rawBody.deceased === 1,
      dod: String(rawBody.dod || rawBody.date_of_death || "").trim(),
      ageCategory: String(rawBody.ageCategory || rawBody.age_category || "").trim(),
      deathAge: rawBody.deathAge != null ? String(rawBody.deathAge) : "",
      causeOfDeath: String(rawBody.causeOfDeath || rawBody.cause_of_death || "").trim(),
      fatherId: String(rawBody.fatherId || rawBody.father_id || "").trim(),
      motherId: String(rawBody.motherId || rawBody.mother_id || "").trim(),
      spouseId: String(rawBody.spouseId || rawBody.spouse_id || "").trim(),
      siblingIds,
      maritalStatus: String(rawBody.maritalStatus || rawBody.marital_status || "").trim(),
      education: String(rawBody.education || "").trim(),
      course: String(rawBody.course || "").trim(),
      employment: String(rawBody.employment || "").trim(),
      occupation: String(rawBody.occupation || "").trim(),
      organization: String(rawBody.organization ?? rawBody.employer ?? "").trim(),
      religion: String(rawBody.religion || "").trim(),
      denomination: String(rawBody.denomination || "").trim(),
      phone: String(rawBody.phone || rawBody.mobile || "").trim(),
      whatsapp: String(rawBody.whatsapp || "").trim(),
      email: String(rawBody.email || "").trim(),
      location: String(rawBody.location ?? rawBody.residence ?? rawBody.address ?? "").trim(),
      photoFile: String(rawBody.photoFile || "").trim(),
      narrative: String(rawBody.narrative ?? rawBody.biography ?? rawBody.historicalLocation ?? rawBody.bio ?? "").trim(),
      photo: String(rawBody.storedPhoto || rawBody.photo || rawBody.photoFile || "").trim(),
      storedPhoto: String(rawBody.storedPhoto || rawBody.photo || "").trim(),
      version: 1,
      active: true,
      deleted: false,
      deletedAt: null,
      createdBy: userEmail || "system",
      lastModifiedBy: userEmail || "system",
      createdAt: now,
      updatedAt: now,
      submissionId: subId || "",
    };
    // Keep legacy display aliases aligned in local JSON
    (newRecord as any).employer = newRecord.organization || "";
    (newRecord as any).residence = newRecord.location || "";
    (newRecord as any).historicalLocation = newRecord.narrative || "";
    (newRecord as any).biography = newRecord.narrative || "";
    (newRecord as any).courseOfStudy = newRecord.course || "";
    (newRecord as any).employmentStatus = newRecord.employment || "";
    (newRecord as any).pob = newRecord.placeOfBirth || "";
    (newRecord as any).familyClan = newRecord.branchType || "";

    // Clear any prior deletion tombstone if this member is being intentionally added/re-added
    unrecordDeletion(memberId, newRecord);

    let firestoreSynced = false;
    let firestoreError: string | undefined;
    const idToken = getRequestFirebaseIdToken();
    if (isServerFirestoreAvailable() && idToken) {
      try {
        await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "members", memberId, sanitizeForFirestore(newRecord), idToken, false);
        firestoreSynced = true;
        if (subId) {
          await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "submissions", subId, {
            memberId,
            createdAt: now,
            createdBy: userEmail,
          }, idToken, true);
        }
      } catch (err: any) {
        firestoreError = err?.message || String(err);
        handleServerFirestoreError(err, "addMember");
      }
    }

    // Always persist to local JSON store as resilient backup
    const local = readJsonFile(membersJsonPath);
    const idx = local.findIndex((m: any) => m && (m.id === memberId || m.recordId === memberId));
    if (idx >= 0) {
      local[idx] = newRecord;
    } else {
      local.unshift(newRecord);
    }

    // Bidirectional spouse link on add
    let updatedSpouse: ClanMemberRecord | null = null;
    if (newRecord.spouseId) {
      const spouseRefId = dbEngine.extractMemberRefId(newRecord.spouseId);
      const spIdx = local.findIndex((m: any) => m && (m.id === spouseRefId || m.recordId === spouseRefId));
      if (spIdx >= 0 && local[spIdx].spouseId !== memberId) {
        local[spIdx] = {
          ...local[spIdx],
          spouseId: memberId,
          version: (Number(local[spIdx].version) || 1) + 1,
          lastModifiedBy: userEmail || "system",
          updatedAt: now,
        };
        updatedSpouse = local[spIdx];
        if (isServerFirestoreAvailable() && idToken) {
          try {
            await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "members", updatedSpouse.id, sanitizeForFirestore(updatedSpouse), idToken, true);
          } catch (err) {
            handleServerFirestoreError(err, "addMember:spouseSync");
          }
        }
      }
    }

    writeJsonFile(membersJsonPath, local);
    syncClanDataFiles(local);

    // Enforce bidirectional sibling links across all selected siblings
    const affectedSiblings = siblingIds.length > 0
      ? await dbEngine.syncBidirectionalSiblingLinks(memberId, siblingIds, userEmail)
      : [];

    return { member: newRecord, isDuplicateRetry: false, affectedSiblings, updatedSpouse, firestoreSynced, firestoreError };
  },

  // Detailed update with Firestore status, bidirectional spouse & sibling sync, and resilient upsert
  updateMemberDetailed: async (
    id: string,
    updates: any,
    userEmail: string,
    _expectedVersion?: number
  ): Promise<{
    member: ClanMemberRecord;
    firestoreSynced: boolean;
    firestoreError?: string;
    updatedSpouse: ClanMemberRecord | null;
    affectedSiblings: ClanMemberRecord[];
  }> => {
    const now = new Date().toISOString();
    const incomingClan = String(updates?.clanMemberNumber || updates?.clan_member_number || "").trim();
    let existing: ClanMemberRecord | null = null;
    try {
      existing = await dbEngine.getMember(id, incomingClan);
    } catch (e) {}

    const canonicalId = existing?.id || sanitizeMemberId(id) || ("rec-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex"));

    const hasSiblingUpdate = Boolean(updates && Object.prototype.hasOwnProperty.call(updates, "siblingIds"));
    const normalizedUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates || {})) {
      if (v === undefined) continue;
      if (SHEET_ALIAS_KEYS_TO_STRIP.has(k) || k.startsWith("_")) continue;
      normalizedUpdates[k] = v;
    }

    if (hasSiblingUpdate) {
      normalizedUpdates.siblingIds = dbEngine.normalizeSiblingIds(updates.siblingIds, canonicalId);
    }

    // Preserve existing clanMemberNumber if incoming is blank or placeholder
    const rawIncomingClan = String(normalizedUpdates.clanMemberNumber || "").trim();
    if ((!rawIncomingClan || rawIncomingClan === "Assigned when saved" || rawIncomingClan.startsWith("Assigned")) && existing?.clanMemberNumber) {
      normalizedUpdates.clanMemberNumber = existing.clanMemberNumber;
    }

    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "deceased")) {
      normalizedUpdates.deceased =
        normalizedUpdates.deceased === true ||
        normalizedUpdates.deceased === "true" ||
        normalizedUpdates.deceased === 1;
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "deathAge")) {
      normalizedUpdates.deathAge = normalizedUpdates.deathAge != null ? String(normalizedUpdates.deathAge) : "";
    }

    // Keep photo aliases aligned when photo is updated
    if (
      Object.prototype.hasOwnProperty.call(normalizedUpdates, "photo") ||
      Object.prototype.hasOwnProperty.call(normalizedUpdates, "storedPhoto") ||
      Object.prototype.hasOwnProperty.call(normalizedUpdates, "photoUrl")
    ) {
      const resolvedPhoto = String(
        normalizedUpdates.photo ?? normalizedUpdates.storedPhoto ?? normalizedUpdates.photoUrl ?? ""
      ).trim();
      normalizedUpdates.photo = resolvedPhoto;
      normalizedUpdates.storedPhoto = resolvedPhoto;
      normalizedUpdates.photoUrl = resolvedPhoto;
    }

    const baseRecord: ClanMemberRecord = existing || {
      id: canonicalId,
      recordId: canonicalId,
      firstName: String(normalizedUpdates.firstName || "").trim(),
      lastName: String(normalizedUpdates.lastName || "").trim(),
      deceased: Boolean(normalizedUpdates.deceased),
      version: 0,
      active: true,
      deleted: false,
      deletedAt: null,
      createdBy: String(normalizedUpdates.createdBy || userEmail || "system"),
      lastModifiedBy: userEmail || "system",
      createdAt: String(normalizedUpdates.createdAt || now),
      updatedAt: now,
    };

    // Keep legacy display aliases aligned whenever canonical fields are edited
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "organization")) {
      normalizedUpdates.employer = String(normalizedUpdates.organization ?? "");
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "location")) {
      normalizedUpdates.residence = String(normalizedUpdates.location ?? "");
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "narrative")) {
      normalizedUpdates.historicalLocation = String(normalizedUpdates.narrative ?? "");
      normalizedUpdates.biography = String(normalizedUpdates.narrative ?? "");
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "course")) {
      normalizedUpdates.courseOfStudy = String(normalizedUpdates.course ?? "");
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "employment")) {
      normalizedUpdates.employmentStatus = String(normalizedUpdates.employment ?? "");
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "placeOfBirth")) {
      normalizedUpdates.pob = String(normalizedUpdates.placeOfBirth ?? "");
    }
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "branchType")) {
      normalizedUpdates.familyClan = normalizeBranchDisplayLabel(normalizedUpdates.branchType ?? "");
    }

    const updatedRecord: ClanMemberRecord = {
      ...baseRecord,
      ...normalizedUpdates,
      id: canonicalId,
      recordId: canonicalId,
      createdAt: baseRecord.createdAt || now,
      createdBy: baseRecord.createdBy || userEmail || "system",
      active: true,
      deleted: false,
      version: (Number(baseRecord.version) || 0) + 1,
      lastModifiedBy: userEmail || "system",
      updatedAt: now,
    };

    // Ensure edited member is never shadowed by a stale tombstone
    unrecordDeletion(canonicalId, updatedRecord);

    let firestoreSynced = false;
    let firestoreError: string | undefined;
    const idToken = getRequestFirebaseIdToken();
    if (isServerFirestoreAvailable() && idToken) {
      try {
        await fsRestSetDoc(
          FS_PROJECT_ID,
          FS_DATABASE_ID,
          "members",
          canonicalId,
          sanitizeForFirestore(updatedRecord),
          idToken,
          true
        );
        firestoreSynced = true;
      } catch (err: any) {
        firestoreError = err?.message || String(err);
        handleServerFirestoreError(err, "updateMember");
      }
    }

    const local = readJsonFile(membersJsonPath);
    const idx = local.findIndex(
      (m: any) =>
        m &&
        (m.id === canonicalId ||
          m.recordId === canonicalId ||
          (id && (m.id === id || m.recordId === id)) ||
          (updatedRecord.clanMemberNumber &&
            String(m.clanMemberNumber || "").trim().toUpperCase() ===
              String(updatedRecord.clanMemberNumber).trim().toUpperCase()))
    );
    if (idx >= 0) {
      local[idx] = updatedRecord;
    } else {
      local.unshift(updatedRecord);
    }

    // Bidirectional spouse link synchronization
    let updatedSpouse: ClanMemberRecord | null = null;
    if (updatedRecord.spouseId) {
      const spouseRefId = dbEngine.extractMemberRefId(updatedRecord.spouseId);
      if (spouseRefId && spouseRefId !== canonicalId) {
        const spIdx = local.findIndex((m: any) => m && (m.id === spouseRefId || m.recordId === spouseRefId));
        if (spIdx >= 0 && local[spIdx].spouseId !== canonicalId) {
          local[spIdx] = {
            ...local[spIdx],
            spouseId: canonicalId,
            version: (Number(local[spIdx].version) || 1) + 1,
            lastModifiedBy: userEmail || "system",
            updatedAt: now,
          };
          updatedSpouse = local[spIdx];
          if (isServerFirestoreAvailable() && idToken) {
            try {
              await fsRestSetDoc(
                FS_PROJECT_ID,
                FS_DATABASE_ID,
                "members",
                updatedSpouse.id,
                sanitizeForFirestore(updatedSpouse),
                idToken,
                true
              );
            } catch (err) {
              handleServerFirestoreError(err, "updateMember:spouseSync");
            }
          }
        }
      }
    }

    writeJsonFile(membersJsonPath, local);
    syncClanDataFiles(local);

    // Enforce bidirectional sibling links whenever siblingIds is included in the update
    let affectedSiblings: ClanMemberRecord[] = [];
    if (hasSiblingUpdate) {
      affectedSiblings = await dbEngine.syncBidirectionalSiblingLinks(
        canonicalId,
        updatedRecord.siblingIds || [],
        userEmail
      );
    }

    return { member: updatedRecord, firestoreSynced, firestoreError, updatedSpouse, affectedSiblings };
  },

  // Backward-compatible updateMember wrapper
  updateMember: async (
    id: string,
    updates: any,
    userEmail: string,
    expectedVersion?: number
  ): Promise<ClanMemberRecord> => {
    const result = await dbEngine.updateMemberDetailed(id, updates, userEmail, expectedVersion);
    return result.member;
  },

  softDeleteMember: async (id: string, userEmail: string): Promise<ClanMemberRecord> => {
    const now = new Date().toISOString();
    let existing: ClanMemberRecord | null = null;
    try {
      existing = await dbEngine.getMember(id);
    } catch (e) {}

    recordDeletion(id, existing, userEmail);

    const updatedRecord: ClanMemberRecord = existing ? {
      ...existing,
      deleted: true,
      active: false,
      deletedAt: now,
      lastModifiedBy: userEmail || "system",
      updatedAt: now,
    } : {
      id: id,
      recordId: id,
      firstName: "Deleted",
      lastName: "Member",
      deleted: true,
      active: false,
      deletedAt: now,
      lastModifiedBy: userEmail || "system",
      updatedAt: now,
      createdAt: now,
      version: 1,
      deceased: false,
    };

    const idToken = getRequestFirebaseIdToken();
    if (isServerFirestoreAvailable() && idToken) {
      try {
        await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "members", id, sanitizeForFirestore(updatedRecord), idToken, true);

        const localCurrent = readJsonFile(membersJsonPath);
        const activeList = localCurrent.filter((m: any) => m && m.id !== id && m.recordId !== id && !m.deleted && m.active !== false);
        await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "siaraMainaClan", "records", {
          project: "SiaraMaina Clan Informatics",
          records: activeList.map(sanitizeForFirestore),
          lastUpdated: now
        }, idToken, true);
      } catch (err) {
        handleServerFirestoreError(err, "softDeleteMember");
      }
    }

    const local = readJsonFile(membersJsonPath);
    const filteredLocal = local.filter((m: any) => m && m.id !== id && m.recordId !== id);
    writeJsonFile(membersJsonPath, filteredLocal);
    syncClanDataFiles(filteredLocal);

    // Clean up bidirectional sibling pointers to the deleted member
    await dbEngine.syncBidirectionalSiblingLinks(id, [], userEmail);

    return updatedRecord;
  },

  restoreMember: async (id: string, userEmail: string): Promise<ClanMemberRecord> => {
    const now = new Date().toISOString();
    let existing: ClanMemberRecord | null = null;
    try {
      existing = await dbEngine.getMember(id);
    } catch (e) {}

    if (!existing) {
      throw new Error(`Member with ID "${id}" was not found.`);
    }

    unrecordDeletion(id, existing);

    const restoredRecord: ClanMemberRecord = {
      ...existing,
      deleted: false,
      active: true,
      deletedAt: null,
      lastModifiedBy: userEmail || "system",
      updatedAt: now,
    };

    const idToken = getRequestFirebaseIdToken();
    if (isServerFirestoreAvailable() && idToken) {
      try {
        await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "members", id, sanitizeForFirestore(restoredRecord), idToken, true);

        const localCurrent = readJsonFile(membersJsonPath);
        const activeList = localCurrent.filter((m: any) => m && m.id !== id && m.recordId !== id && !m.deleted && m.active !== false);
        activeList.push(restoredRecord);
        await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "siaraMainaClan", "records", {
          project: "SiaraMaina Clan Informatics",
          records: activeList.map(sanitizeForFirestore),
          lastUpdated: now
        }, idToken, true);
      } catch (err) {
        handleServerFirestoreError(err, "restoreMember");
      }
    }

    const local = readJsonFile(membersJsonPath);
    const idx = local.findIndex((m: any) => m.id === id || m.recordId === id);
    if (idx >= 0) {
      local[idx] = restoredRecord;
    } else {
      local.push(restoredRecord);
    }
    writeJsonFile(membersJsonPath, local);
    syncClanDataFiles(local);

    if (Array.isArray(restoredRecord.siblingIds) && restoredRecord.siblingIds.length > 0) {
      await dbEngine.syncBidirectionalSiblingLinks(id, restoredRecord.siblingIds, userEmail);
    }

    return restoredRecord;
  },

  permanentDeleteMember: async (id: string, userEmail: string): Promise<void> => {
    const now = new Date().toISOString();
    let memberToPurge = await dbEngine.getMember(id);
    if (!memberToPurge) {
      const all = await dbEngine.getMembers(true);
      memberToPurge = all.find(m => m.id === id || m.recordId === id) || null;
    }
    recordDeletion(id, memberToPurge, userEmail);

    const idToken = getRequestFirebaseIdToken();
    if (isServerFirestoreAvailable() && idToken) {
      try {
        await fsRestDeleteDoc(FS_PROJECT_ID, FS_DATABASE_ID, "members", id, idToken);

        const localCurrent = readJsonFile(membersJsonPath);
        const activeList = localCurrent.filter((m: any) => m && m.id !== id && m.recordId !== id && !m.deleted && m.active !== false);
        await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "siaraMainaClan", "records", {
          project: "SiaraMaina Clan Informatics",
          records: activeList.map(sanitizeForFirestore),
          lastUpdated: now
        }, idToken, true);
      } catch (err) {
        handleServerFirestoreError(err, "permanentDeleteMember");
      }
    }

    const local = readJsonFile(membersJsonPath);
    const filtered = local.filter((m: any) => m.id !== id && m.recordId !== id);
    writeJsonFile(membersJsonPath, filtered);
    syncClanDataFiles(filtered);

    // Clean up bidirectional sibling pointers to the permanently deleted member
    await dbEngine.syncBidirectionalSiblingLinks(id, [], userEmail);
  },

  deleteMember: async (id: string, userEmail: string): Promise<void> => {
    await dbEngine.softDeleteMember(id, userEmail);
  },

  importMembersBatch: async (
    incomingList: any[],
    userEmail: string
  ): Promise<{ added: number; updated: number; members: ClanMemberRecord[] }> => {
    let added = 0;
    let updated = 0;
    const currentList = await dbEngine.getMembers(true);

    const map = new Map<string, ClanMemberRecord>();
    const normIdMap = new Map<string, ClanMemberRecord>();
    const clanNumMap = new Map<string, ClanMemberRecord>();
    const emailMap = new Map<string, ClanMemberRecord>();
    const nameMap = new Map<string, ClanMemberRecord>();
    const singleNameMap = new Map<string, ClanMemberRecord>();

    function registerMemberInMaps(m: ClanMemberRecord) {
      const idKey = m.id || m.recordId;
      if (idKey) {
        map.set(idKey, m);
        const normKey = normalizeCanonicalIdKey(idKey);
        if (normKey) normIdMap.set(normKey, m);
      }

      const rawClan = String(m.clanMemberNumber || "").trim().toUpperCase();
      const isExplicitClanNum = /^CLAN/i.test(rawClan) || (/^[0-9]+$/.test(rawClan) && !rawClan.includes("MALITI") && !rawClan.includes("SIARA") && !rawClan.includes("MAINA"));
      const cNum = isExplicitClanNum ? rawClan : "";
      if (cNum) clanNumMap.set(cNum, m);

      const em = String(m.email || "").trim().toLowerCase();
      if (em) emailMap.set(em, m);

      const fn = String(m.firstName || "").trim().toLowerCase();
      const ln = String(m.lastName || "").trim().toLowerCase();
      const mn = String(m.middleName || "").trim().toLowerCase();

      if (fn && ln) {
        if (mn) nameMap.set(`${fn}_${mn}_${ln}`, m);
        else nameMap.set(`${fn}_${ln}`, m);
      } else if (fn) {
        singleNameMap.set(fn, m);
      }
    }

    currentList.forEach((m) => registerMemberInMaps(m));

    for (const raw of incomingList) {
      const rawId = String(raw.id || raw.recordId || "").trim();
      const normRawId = normalizeCanonicalIdKey(rawId);
      const fn = String(raw.firstName || raw.first_name || "").trim().toLowerCase();
      const ln = String(raw.lastName || raw.last_name || "").trim().toLowerCase();
      const mn = String(raw.middleName || raw.middle_name || "").trim().toLowerCase();
      const rawClan = String(raw.clanMemberNumber || raw.clan_member_number || "").trim().toUpperCase();
      const isExplicitClanNum = /^CLAN/i.test(rawClan) || (/^[0-9]+$/.test(rawClan) && !rawClan.includes("MALITI") && !rawClan.includes("SIARA") && !rawClan.includes("MAINA"));
      const clanNum = isExplicitClanNum ? rawClan : "";
      const email = String(raw.email || "").trim().toLowerCase();
      const nKey = fn ? (mn ? `${fn}_${mn}_${ln}` : `${fn}_${ln}`) : "";

      // Strict filter: a member record MUST have at least one name (first, middle, or last) to be created or reported as a new member
      if (!fn && !mn && !ln) {
        continue;
      }
      if (fn === "by" && !ln && !clanNum && !email) {
        continue;
      }

      const isAutoSyncCall =
        userEmail === "server_autosync" ||
        userEmail === "google_sheets_sync" ||
        userEmail === "google_sheets_autosync" ||
        raw.isAutoSync === true;
      if (!isAutoSyncCall && (raw.forceImport === true || raw.allowReimport === true)) {
        if (rawId) unrecordDeletion(rawId);
        if (clanNum) unrecordDeletion(clanNum);
        if (email) unrecordDeletion(email);
        if (nKey) unrecordDeletion(nKey);
      } else if (isMemberIdDeleted(rawId, clanNum, email, fn, ln)) {
        continue; // Never re-import deleted member during active deletion propagation
      }

      let existing: ClanMemberRecord | undefined = undefined;
      if (rawId && map.has(rawId)) {
        existing = map.get(rawId);
      } else if (normRawId && normIdMap.has(normRawId)) {
        existing = normIdMap.get(normRawId);
      } else if (clanNum && clanNumMap.has(clanNum)) {
        existing = clanNumMap.get(clanNum);
      } else if (email && emailMap.has(email)) {
        existing = emailMap.get(email);
      } else if (fn && ln) {
        const byFullName = (mn ? nameMap.get(`${fn}_${mn}_${ln}`) : undefined) || nameMap.get(`${fn}_${ln}`);
        if (byFullName && (!rawId || (!map.has(rawId) && !normIdMap.has(normRawId)))) {
          existing = byFullName;
        }
      } else if (!rawId && !clanNum && !email && fn && !ln) {
        existing = singleNameMap.get(fn);
      }

      const safeClanSlug = clanNum ? sanitizeMemberId(clanNum) : "";
      const resolvedTargetId =
        rawId && !rawId.startsWith("sheet_")
          ? sanitizeMemberId(rawId) || rawId
          : (safeClanSlug ? `rec-clan-${safeClanSlug}` : ("rec-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex").slice(0, 5)));
      const targetRecord = existing || {
        id: resolvedTargetId,
        recordId: resolvedTargetId,
        clanMemberNumber: String(raw.clanMemberNumber || "").trim(),
        firstName: String(raw.firstName || "").trim(),
        middleName: String(raw.middleName || "").trim(),
        lastName: String(raw.lastName || "").trim(),
        sex: String(raw.sex || "Not Recorded").trim(),
        branchType: String(raw.branchType || "heritage").trim(),
        honorific: String(raw.honorific || "").trim(),
        dob: String(raw.dob || "").trim(),
        placeOfBirth: String(raw.placeOfBirth || "").trim(),
        birthPeriod: String(raw.birthPeriod || "").trim(),
        deceased: Boolean(raw.deceased),
        dod: String(raw.dod || "").trim(),
        ageCategory: String(raw.ageCategory || "").trim(),
        deathAge: raw.deathAge != null ? String(raw.deathAge) : "",
        causeOfDeath: String(raw.causeOfDeath || "").trim(),
        fatherId: String(raw.fatherId || "").trim(),
        motherId: String(raw.motherId || "").trim(),
        spouseId: String(raw.spouseId || "").trim(),
        siblingIds: Array.isArray(raw.siblingIds) ? raw.siblingIds : [],
        maritalStatus: String(raw.maritalStatus || "").trim(),
        education: String(raw.education || "").trim(),
        course: String(raw.course || "").trim(),
        employment: String(raw.employment || "").trim(),
        occupation: String(raw.occupation || "").trim(),
        organization: String(raw.organization || "").trim(),
        religion: String(raw.religion || "").trim(),
        denomination: String(raw.denomination || "").trim(),
        phone: String(raw.phone || "").trim(),
        whatsapp: String(raw.whatsapp || "").trim(),
        email: String(raw.email || "").trim(),
        location: String(raw.location || "").trim(),
        photoFile: String(raw.photoFile || "").trim(),
        narrative: String(raw.narrative || "").trim(),
        photo: String(raw.photo || "").trim(),
        storedPhoto: String(raw.storedPhoto || "").trim(),
        version: 1,
        active: true,
        deleted: false,
        deletedAt: null,
        createdBy: userEmail,
        lastModifiedBy: userEmail,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (existing) {
        // Protect recently edited profiles from being overwritten by a stale background Sheet read
        if (isAutoSyncCall && existing.updatedAt) {
          const modifiedBy = String(existing.lastModifiedBy || "").toLowerCase();
          const isRecentAppEdit =
            modifiedBy !== "server_autosync" &&
            modifiedBy !== "google_sheets_sync" &&
            modifiedBy !== "google_sheets_autosync";
          const updatedAgeMs = Date.now() - new Date(existing.updatedAt).getTime();
          if (isRecentAppEdit && updatedAgeMs >= 0 && updatedAgeMs < 90000) {
            continue;
          }
        }
        let isChanged = false;

        // Photo preservation safeguard: if incoming sheet row has no photo data, preserve existing photo
        const rawHasPhoto = Boolean(
          (raw.photo && String(raw.photo).trim()) ||
          (raw.storedPhoto && String(raw.storedPhoto).trim()) ||
          (raw.photoUrl && String(raw.photoUrl).trim()) ||
          (raw.photoFile && String(raw.photoFile).trim())
        );
        const existingHasPhoto = Boolean(
          (existing.photo && String(existing.photo).trim()) ||
          (existing.storedPhoto && String(existing.storedPhoto).trim()) ||
          (existing.photoUrl && String(existing.photoUrl).trim()) ||
          (existing.photoFile && String(existing.photoFile).trim())
        );

        if (!rawHasPhoto && existingHasPhoto) {
          raw.photo = existing.photo || existing.storedPhoto || existing.photoUrl || "";
          raw.storedPhoto = existing.storedPhoto || existing.photo || "";
          raw.photoUrl = existing.photoUrl || existing.photo || "";
          raw.photoFile = existing.photoFile || "";
        }

        const photoKeys = new Set(["photo", "storedPhoto", "photoUrl", "photoFile"]);
        const metaKeys = new Set([
          "id",
          "recordId",
          "createdAt",
          "updatedAt",
          "createdBy",
          "lastModifiedBy",
          "version",
          "active",
          "deleted",
          "deletedAt",
          "isAutoSync",
          "forceImport",
          "allowReimport",
          "_needsIdWriteback",
          "_rawHadBlankId",
        ]);

        Object.keys(raw).forEach((k) => {
          if (metaKeys.has(k) || k.startsWith("_")) return;
          const incomingVal = raw[k];
          if (incomingVal === undefined || incomingVal === null) return;

          if (Array.isArray(incomingVal)) {
            const cleanIncoming = Array.from(new Set(incomingVal.map((v: any) => String(v || "").trim()).filter(Boolean))).sort();
            const existingArr = Array.isArray((existing as any)[k])
              ? Array.from(new Set((existing as any)[k].map((v: any) => String(v || "").trim()).filter(Boolean))).sort()
              : [];
            if (JSON.stringify(cleanIncoming) !== JSON.stringify(existingArr)) {
              // On autosync, only overwrite siblingIds if sheet actually specifies them or existing was empty
              if (cleanIncoming.length > 0 || !isAutoSyncCall) {
                (existing as any)[k] = cleanIncoming;
                isChanged = true;
              }
            }
            return;
          }

          // Allow clearing editable non-photo fields when explicitly updated on Google Sheets,
          // while never wiping photos or non-autosync empty fields.
          if (incomingVal === "") {
            if (isAutoSyncCall && !photoKeys.has(k) && typeof (existing as any)[k] === "string" && (existing as any)[k] !== "") {
              // Only clear explicitly editable contact/bio/name/relation fields when cleared on Google Sheets
              const clearableSheetFields = new Set([
                "middleName",
                "lastName",
                "honorific",
                "dob",
                "birthPeriod",
                "placeOfBirth",
                "dod",
                "deathAge",
                "causeOfDeath",
                "fatherId",
                "motherId",
                "spouseId",
                "maritalStatus",
                "education",
                "course",
                "employment",
                "occupation",
                "organization",
                "religion",
                "denomination",
                "phone",
                "whatsapp",
                "email",
                "location",
                "narrative",
              ]);
              if (clearableSheetFields.has(k)) {
                (existing as any)[k] = "";
                isChanged = true;
              }
            }
            return;
          }

          if ((existing as any)[k] !== incomingVal) {
            (existing as any)[k] = incomingVal;
            isChanged = true;
          }
        });
        if (isChanged) {
          // Keep legacy display aliases aligned with canonical fields
          (existing as any).employer = String(existing.organization ?? "");
          (existing as any).residence = String(existing.location ?? "");
          (existing as any).pob = String(existing.placeOfBirth ?? "");
          (existing as any).courseOfStudy = String(existing.course ?? "");
          (existing as any).employmentStatus = String(existing.employment ?? "");
          (existing as any).historicalLocation = String(existing.narrative ?? "");
          (existing as any).biography = String(existing.narrative ?? "");
          (existing as any).familyClan = normalizeBranchDisplayLabel(existing.branchType ?? "");
          updated++;
          existing.version = (Number(existing.version) || 1) + 1;
          existing.updatedAt = new Date().toISOString();
          existing.lastModifiedBy = userEmail;
          registerMemberInMaps(existing);
        }
      } else {
        added++;
        const targetId = targetRecord.id;
        targetRecord.recordId = targetId;
        const tIdKey = targetRecord.id || targetRecord.recordId;
        if (tIdKey) map.set(tIdKey, targetRecord as ClanMemberRecord);
        registerMemberInMaps(targetRecord as ClanMemberRecord);
      }
    }

    // server_autosync record pruning disabled to prevent accidental deletion of newly added members
    if (false && userEmail === "server_autosync") {
      const incomingIds = new Set(incomingList.map(r => String(r.id || r.recordId || "").trim()).filter(Boolean));
      const incomingClans = new Set(incomingList.map(r => String(r.clanMemberNumber || "").trim().toUpperCase()).filter(Boolean));
      const incomingEmails = new Set(incomingList.map(r => String(r.email || "").trim().toLowerCase()).filter(Boolean));
      const incomingNames = new Set(incomingList.map(r => {
        const fn = String(r.firstName || "").trim().toLowerCase();
        const ln = String(r.lastName || "").trim().toLowerCase();
        const mn = String(r.middleName || "").trim().toLowerCase();
        return fn && ln ? (mn ? `${fn}_${mn}_${ln}` : `${fn}_${ln}`) : "";
      }).filter(Boolean));

      if (incomingList.length >= 1) {
        currentList.forEach(m => {
          const mFn = String(m.firstName || "").trim().toLowerCase();
          const mLn = String(m.lastName || "").trim().toLowerCase();
          const mMn = String(m.middleName || "").trim().toLowerCase();
          const mNameKey = mFn && mLn ? (mMn ? `${mFn}_${mMn}_${mLn}` : `${mFn}_${mLn}`) : "";

          const inIncoming = (m.id && incomingIds.has(m.id)) ||
                             (m.clanMemberNumber && incomingClans.has(m.clanMemberNumber.toUpperCase())) ||
                             (m.email && incomingEmails.has(m.email.toLowerCase())) ||
                             (mNameKey && incomingNames.has(mNameKey));
          if (!inIncoming && !m.deleted) {
            m.deleted = true;
            m.active = false;
            m.deletedAt = new Date().toISOString();
            recordDeletion(m.id, m, "google_sheets_sync");
            registerMemberInMaps(m);
          }
        });
      }
    }

    const finalList = Array.from(map.values());
    writeJsonFile(membersJsonPath, finalList);
    syncClanDataFiles(finalList);

    const idToken = getRequestFirebaseIdToken();
    if (idToken && isServerFirestoreAvailable()) {
      try {
        for (const m of finalList) {
          await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "members", m.id, sanitizeForFirestore(m), idToken, true);
        }

        const activeList = finalList.filter((m: any) => m && !m.deleted && m.active !== false);
        await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "siaraMainaClan", "records", {
          project: "SiaraMaina Clan Informatics",
          records: activeList.map(sanitizeForFirestore),
          lastUpdated: new Date().toISOString()
        }, idToken, true);
      } catch (err: any) {
        handleServerFirestoreError(err, "importMembersBatch");
      }
    }

    return { added, updated, members: finalList };
  },

  // Deduplicate users list by email
  deduplicateUsersList: (list: AppUserProfile[]): AppUserProfile[] => {
    if (!Array.isArray(list)) return [];
    const parseTs = (v?: string) => {
      if (!v) return 0;
      const t = new Date(v).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    const map = new Map<string, AppUserProfile>();
    list.forEach(u => {
      if (!u || !u.email) return;
      const emailKey = String(u.email).toLowerCase().trim();
      if (!emailKey) return;

      if (!map.has(emailKey)) {
        map.set(emailKey, { ...u, email: emailKey });
      } else {
        const existing = map.get(emailKey)!;
        const existingIsLegacy = String(existing.uid || "").startsWith("user-");
        const newIsLegacy = String(u.uid || "").startsWith("user-");
        let preferredUid = existing.uid || u.uid;
        if (existingIsLegacy && !newIsLegacy && u.uid) {
          preferredUid = u.uid;
        } else if (!existingIsLegacy && newIsLegacy && existing.uid) {
          preferredUid = existing.uid;
        }

        const exTs = parseTs((existing as any).updatedAt || existing.lastLoginAt || existing.createdAt);
        const newTs = parseTs((u as any).updatedAt || u.lastLoginAt || u.createdAt);
        const incomingWins = (newTs > exTs) || (newTs === exTs && (!newIsLegacy || existingIsLegacy));
        const primary: any = incomingWins ? u : existing;
        const secondary: any = incomingWins ? existing : u;

        const isMaster = emailKey === TRUSTED_OWNER_EMAIL.toLowerCase();
        const merged: AppUserProfile = {
          ...secondary,
          ...primary,
          uid: preferredUid,
          email: emailKey,
          displayName: primary.displayName || secondary.displayName || (emailKey.split("@")[0] || "Clan Member"),
          role: isMaster ? "admin" : (primary.role || secondary.role || "viewer"),
          branch: primary.branch || secondary.branch || "general",
          approved: isMaster ? true : (primary.approved !== undefined ? Boolean(primary.approved) : Boolean(secondary.approved)),
          active: isMaster ? true : (primary.active !== undefined ? (primary.active !== false) : (secondary.active !== false)),
          createdAt: existing.createdAt || u.createdAt || new Date().toISOString(),
          lastLoginAt: (parseTs(u.lastLoginAt) >= parseTs(existing.lastLoginAt) ? u.lastLoginAt : existing.lastLoginAt) || new Date().toISOString(),
        };
        map.set(emailKey, merged);
      }
    });
    return Array.from(map.values());
  },

  getUser: async (uid: string): Promise<AppUserProfile | null> => {
    try {
      const idToken = getRequestFirebaseIdToken();
      if (isServerFirestoreAvailable() && idToken && uid) {
        const d = await fsRestGetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "users", uid, idToken);
        if (d) {
          return {
            uid,
            email: (d.email || "").toLowerCase().trim(),
            displayName: d.displayName || d.email || "Member",
            role: (d.role === "admin" || d.role === "editor") ? d.role : "viewer",
            branch: d.branch || "general",
            approved: d.approved !== false,
            active: d.active !== false,
            createdAt: d.createdAt || new Date().toISOString(),
            lastLoginAt: d.lastLoginAt || new Date().toISOString(),
          };
        }
      }
    } catch (e) {
      handleServerFirestoreError(e, "getUser");
    }
    const local = readJsonFile(usersJsonPath) || [];
    return local.find((u: any) => u.uid === uid || (u.email && u.email.toLowerCase().trim() === uid.toLowerCase().trim())) || null;
  },

  getUsers: async (): Promise<AppUserProfile[]> => {
    let list: AppUserProfile[] = [];
    let firestoreFetched = false;

    try {
      const idToken = getRequestFirebaseIdToken();
      if (isServerFirestoreAvailable() && idToken) {
        const docs = await fsRestListCollection(FS_PROJECT_ID, FS_DATABASE_ID, "users", idToken);
        docs.forEach(({ id: docId, data: dat }) => {
          list.push({
            uid: docId,
            email: (dat.email || "").toLowerCase().trim(),
            displayName: dat.displayName || dat.email || "Member",
            role: (dat.role === "admin" || dat.role === "editor") ? dat.role : "viewer",
            branch: dat.branch || "general",
            approved: dat.approved !== false,
            active: dat.active !== false,
            pendingRoleAssignment: dat.pendingRoleAssignment,
            registeredRemotely: dat.registeredRemotely,
            createdAt: dat.createdAt || new Date().toISOString(),
            lastLoginAt: dat.lastLoginAt || new Date().toISOString(),
          });
        });
        firestoreFetched = true;
      }
    } catch (err) {
      handleServerFirestoreError(err, "getUsers");
    }

    const local = readJsonFile(usersJsonPath) || [];
    if (!firestoreFetched || list.length === 0) {
      list = [...local];
    } else if (Array.isArray(local) && local.length > 0) {
      const fsEmails = new Set(list.map((u) => String(u.email || "").toLowerCase().trim()).filter(Boolean));
      const fsUids = new Set(list.map((u) => String(u.uid || "").trim()).filter(Boolean));
      const extras = local.filter((u: any) => {
        if (!u) return false;
        const em = String(u.email || "").toLowerCase().trim();
        const uid = String(u.uid || "").trim();
        if (em && fsEmails.has(em)) return false;
        if (uid && fsUids.has(uid)) return false;
        return Boolean(em || uid);
      });
      if (extras.length > 0) {
        list = [...list, ...extras];
      }
    }

    const merged = dbEngine.deduplicateUsersList(list);
    writeJsonFile(usersJsonPath, merged);
    return merged;
  },

  saveUser: async (profile: AppUserProfile): Promise<AppUserProfile> => {
    return dbEngine.upsertUser(profile);
  },

  upsertUser: async (profile: AppUserProfile): Promise<AppUserProfile> => {
    const cleanEmail = (profile.email || "").toLowerCase().trim();
    const nowIso = new Date().toISOString();
    const allowedUserKeys = new Set([
      "uid", "id", "email", "displayName", "role", "branch", "institution",
      "approved", "active", "status", "provider", "phone", "location",
      "bio", "photoURL", "pendingRoleAssignment", "registeredRemotely",
      "createdAt", "lastLoginAt", "lastLogin", "updatedAt", "updatedBy"
    ]);
    const rawCombined: Record<string, any> = { ...profile, email: cleanEmail, updatedAt: (profile as any).updatedAt || nowIso };
    const cleanFirestoreDoc: Record<string, any> = {};
    Object.keys(rawCombined).forEach((k) => {
      if (allowedUserKeys.has(k) && rawCombined[k] !== undefined && rawCombined[k] !== null) {
        cleanFirestoreDoc[k] = rawCombined[k];
      }
    });
    const cleanProfile = rawCombined as AppUserProfile;

    const idToken = getRequestFirebaseIdToken();
    if (isServerFirestoreAvailable() && idToken && cleanProfile.uid) {
      try {
        await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "users", cleanProfile.uid, sanitizeForFirestore(cleanFirestoreDoc), idToken, true);

        // Clean up any existing duplicate legacy documents in Firestore with the same email
        if (cleanEmail && !cleanProfile.uid.startsWith("user-")) {
          const matches = await fsRestQueryEq(FS_PROJECT_ID, FS_DATABASE_ID, "users", "email", cleanEmail, idToken);
          for (const d of matches) {
            if (d.id !== cleanProfile.uid && d.id.startsWith("user-")) {
              await fsRestDeleteDoc(FS_PROJECT_ID, FS_DATABASE_ID, "users", d.id, idToken);
            }
          }
        }
      } catch (err) {
        handleServerFirestoreError(err, "upsertUser");
      }
    }

    const list = readJsonFile(usersJsonPath);
    const idx = list.findIndex((u: any) => u.uid === cleanProfile.uid || (cleanEmail && u.email && u.email.toLowerCase().trim() === cleanEmail));
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...cleanProfile };
    } else {
      list.push(cleanProfile);
    }
    const deduplicated = dbEngine.deduplicateUsersList(list);
    writeJsonFile(usersJsonPath, deduplicated);
    return cleanProfile;
  },

  updateUserApprovalAndRole: async (
    targetUid: string,
    role: "admin" | "editor" | "viewer",
    approved: boolean,
    adminEmail: string
  ): Promise<AppUserProfile> => {
    let profile: AppUserProfile | null = null;
    const nowIso = new Date().toISOString();
    const idToken = getRequestFirebaseIdToken();
    if (isServerFirestoreAvailable() && idToken) {
      try {
        const current = await fsRestGetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "users", targetUid, idToken);
        if (current) {
          profile = {
            ...(current as AppUserProfile),
            uid: targetUid,
            role,
            approved,
            active: current.active !== false,
            pendingRoleAssignment: false,
            updatedAt: nowIso,
            updatedBy: adminEmail,
          } as any;
          await dbEngine.upsertUser(profile as AppUserProfile);
        }
      } catch (err) {
        handleServerFirestoreError(err, "updateUserApprovalAndRole");
      }
    }

    if (!profile) {
      const list = readJsonFile(usersJsonPath);
      const idx = list.findIndex((u: any) => u.uid === targetUid || (u.email && u.email.toLowerCase().trim() === targetUid.toLowerCase().trim()));
      if (idx >= 0) {
        list[idx].role = role;
        list[idx].approved = approved;
        list[idx].pendingRoleAssignment = false;
        list[idx].updatedAt = nowIso;
        list[idx].updatedBy = adminEmail;
        profile = list[idx];
        writeJsonFile(usersJsonPath, dbEngine.deduplicateUsersList(list));
      }
    }

    if (!profile) {
      throw new Error(`User profile not found for UID "${targetUid}"`);
    }

    await dbEngine.addAuditLog({
      id: "log-" + Date.now(),
      eventType: "USER_PERMISSION_CHANGE",
      action: `Administrator ${adminEmail} updated user ${profile.email}: role=${role}, approved=${approved}`,
      actorEmail: adminEmail,
      targetId: targetUid,
      timestamp: nowIso,
    });

    return profile;
  },

  updateUserStatus: async (
    targetUid: string,
    active: boolean,
    adminEmail: string
  ): Promise<AppUserProfile> => {
    let profile: AppUserProfile | null = null;
    const nowIso = new Date().toISOString();
    const idToken = getRequestFirebaseIdToken();
    if (isServerFirestoreAvailable() && idToken) {
      try {
        const current = await fsRestGetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "users", targetUid, idToken);
        if (current) {
          profile = {
            ...(current as AppUserProfile),
            uid: targetUid,
            active,
            updatedAt: nowIso,
            updatedBy: adminEmail,
          } as any;
          await dbEngine.upsertUser(profile as AppUserProfile);
        }
      } catch (err) {
        handleServerFirestoreError(err, "updateUserStatus");
      }
    }

    if (!profile) {
      const list = readJsonFile(usersJsonPath);
      const idx = list.findIndex((u: any) => u.uid === targetUid || (u.email && u.email.toLowerCase().trim() === targetUid.toLowerCase().trim()));
      if (idx >= 0) {
        list[idx].active = active;
        list[idx].updatedAt = nowIso;
        list[idx].updatedBy = adminEmail;
        profile = list[idx];
        writeJsonFile(usersJsonPath, dbEngine.deduplicateUsersList(list));
      }
    }

    if (!profile) {
      throw new Error(`User profile not found for UID "${targetUid}"`);
    }

    await dbEngine.addAuditLog({
      id: "log-" + Date.now(),
      eventType: "USER_STATUS_CHANGE",
      action: `Administrator ${adminEmail} set user ${profile.email} active=${active}`,
      actorEmail: adminEmail,
      targetId: targetUid,
      timestamp: nowIso,
    });

    return profile;
  },

  deleteUser: async (targetUid: string, adminEmail: string): Promise<void> => {
    let targetEmail = "";
    const list = readJsonFile(usersJsonPath);
    const found = list.find((u: any) => u.uid === targetUid || u.id === targetUid || (u.email && u.email.toLowerCase().trim() === targetUid.toLowerCase().trim()));
    if (found && found.email) targetEmail = found.email.toLowerCase().trim();

    const idToken = getRequestFirebaseIdToken();
    if (isServerFirestoreAvailable() && idToken) {
      try {
        await fsRestDeleteDoc(FS_PROJECT_ID, FS_DATABASE_ID, "users", targetUid, idToken);

        if (targetEmail) {
          const matches = await fsRestQueryEq(FS_PROJECT_ID, FS_DATABASE_ID, "users", "email", targetEmail, idToken);
          for (const d of matches) {
            await fsRestDeleteDoc(FS_PROJECT_ID, FS_DATABASE_ID, "users", d.id, idToken);
          }
        }
      } catch (err) {
        handleServerFirestoreError(err, "deleteUser");
      }
    }

    const filtered = list.filter((u: any) => 
      u.uid !== targetUid && 
      u.id !== targetUid && 
      (!targetEmail || (u.email || "").toLowerCase().trim() !== targetEmail)
    );
    writeJsonFile(usersJsonPath, dbEngine.deduplicateUsersList(filtered));

    await dbEngine.addAuditLog({
      id: "log-" + Date.now(),
      eventType: "USER_DELETED",
      action: `Administrator ${adminEmail} deleted user ${targetUid}${targetEmail ? " (" + targetEmail + ")" : ""}`,
      actorEmail: adminEmail,
      targetId: targetUid,
      timestamp: new Date().toISOString(),
    });
  },


  // Immutable Activity Logs
  addAuditLog: async (entry: ActivityLogEntry): Promise<void> => {
    const idToken = getRequestFirebaseIdToken();
    if (isServerFirestoreAvailable() && idToken) {
      try {
        await fsRestSetDoc(FS_PROJECT_ID, FS_DATABASE_ID, "ActivityLogs", entry.id, sanitizeForFirestore(entry), idToken, false);
      } catch (err) {
        handleServerFirestoreError(err, "addAuditLog");
      }
    }
    const logs = readJsonFile(logsJsonPath);
    logs.unshift(entry);
    if (logs.length > 200) logs.pop();
    writeJsonFile(logsJsonPath, logs);
  },

  getAuditLogs: async (maxCount = 50): Promise<ActivityLogEntry[]> => {
    try {
      const idToken = getRequestFirebaseIdToken();
      if (isServerFirestoreAvailable() && idToken) {
        const docs = await fsRestListCollection(FS_PROJECT_ID, FS_DATABASE_ID, "ActivityLogs", idToken, maxCount);
        const list: ActivityLogEntry[] = docs.map((d) => d.data as ActivityLogEntry);
        list.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
        if (list.length > 0) return list.slice(0, maxCount);
      }
    } catch (e) {
      handleServerFirestoreError(e, "getAuditLogs");
    }
    const logs = readJsonFile(logsJsonPath);
    return logs.slice(0, maxCount);
  },

  // Operational metrics
  getStats: async () => {
    const members = await dbEngine.getMembers(true);
    const active = deduplicateMembersList(members.filter((m) => !m.deleted));
    const recycle = members.filter((m) => m.deleted);
    const users = await dbEngine.getUsers();

    return {
      totalRecords: active.length,
      recycleBinCount: recycle.length,
      totalUsers: users.length,
      approvedUsers: users.filter((u) => u.approved).length,
      database: "Cloud Firestore Enterprise (Verified Native Project)",
      databaseId: firebaseAppletConfig.firestoreDatabaseId,
      projectId: firebaseAppletConfig.projectId,
      timestamp: new Date().toISOString(),
    };
  },
};
