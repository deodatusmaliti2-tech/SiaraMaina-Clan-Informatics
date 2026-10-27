import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeFirestore,
  getFirestore,
  setLogLevel,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  writeBatch
} from "firebase/firestore";
import fs from "fs";
import path from "path";
import crypto from "crypto";

try { setLogLevel("silent"); } catch (e) {}

// 1. Load centralized configuration from firebase-applet-config.json
const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
const rawConfig = fs.readFileSync(configPath, "utf-8");
export const firebaseAppletConfig = JSON.parse(rawConfig);

const firebaseApp = getApps().length === 0 ? initializeApp({
  apiKey: firebaseAppletConfig.apiKey,
  authDomain: firebaseAppletConfig.authDomain,
  projectId: firebaseAppletConfig.projectId,
  storageBucket: firebaseAppletConfig.storageBucket,
  messagingSenderId: firebaseAppletConfig.messagingSenderId,
  appId: firebaseAppletConfig.appId,
}, "SiaraMainaServerApp") : getApp("SiaraMainaServerApp");

let dbInstance = null;
try {
  dbInstance = initializeFirestore(
    firebaseApp,
    { experimentalForceLongPolling: true },
    firebaseAppletConfig.firestoreDatabaseId || "(default)"
  );
} catch (e) {
  try {
    dbInstance = getFirestore(firebaseApp);
  } catch (e2) {
    dbInstance = null;
  }
}
export const firestoreDb = dbInstance;

const quotaFlagPath = path.resolve(process.cwd(), "server/data/firestore_quota.flag");

function isQuotaExhaustedPersisted(): boolean {
  if (fs.existsSync(quotaFlagPath)) {
    try {
      const content = fs.readFileSync(quotaFlagPath, "utf-8").trim();
      const today = new Date().toISOString().slice(0, 10);
      if (content === today || content === "true") {
        return true;
      } else {
        try { fs.unlinkSync(quotaFlagPath); } catch (e) {}
        return false;
      }
    } catch (e) {
      return true;
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
  } else {
    console.warn(`[${context}] Firestore notice:`, err?.message || err);
  }
}

export function isServerFirestoreAvailable(): boolean {
  return !!firestoreDb && !serverFirestoreQuotaExhausted;
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

export function unrecordDeletion(id: string) {
  if (!id) return;
  const list = getDeletedRegistry();
  const idStr = String(id).trim();
  const filtered = list.filter(d => d.id !== idStr && d.clanMemberNumber !== idStr);
  writeJsonFile(deletedIdsJsonPath, filtered);
  writeJsonFile(rootDeletedIdsJsonPath, filtered);
}

export function isMemberIdDeleted(id?: string, clanNum?: string, email?: string): boolean {
  const list = getDeletedRegistry();
  const idStr = String(id || "").trim();
  const rawClan = String(clanNum || "").trim().toUpperCase();
  const clanStr = (/^CLAN/i.test(rawClan) || (/^[0-9]+$/.test(rawClan) && !rawClan.includes("MALITI"))) ? rawClan : "";
  const emailStr = String(email || "").trim().toLowerCase();

  return list.some(d => {
    if (idStr && d.id && String(d.id).trim() === idStr) return true;
    if (clanStr && d.clanMemberNumber && String(d.clanMemberNumber).trim().toUpperCase() === clanStr) return true;
    if (emailStr && d.email && String(d.email).trim().toLowerCase() === emailStr) return true;
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

export function sanitizeForFirestore(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  const clean: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = (v && typeof v === "object" && !Array.isArray(v)) ? sanitizeForFirestore(v) : v;
    }
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

export const dbEngine = {
  // Fetch members with soft-delete filter and resilient JSON fallback
  getMembers: async (includeDeleted = false): Promise<ClanMemberRecord[]> => {
    const deletedList = getDeletedRegistry();
    const deletedIds = new Set(deletedList.map(d => d.id).filter(Boolean));
    const deletedClans = new Set(deletedList.map(d => d.clanMemberNumber).filter(Boolean));
    const deletedEmails = new Set(deletedList.map(d => d.email).filter(Boolean));

    if (!isServerFirestoreAvailable()) {
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
    }

    try {
      if (!firestoreDb) throw new Error("Firestore not initialized");
      const colRef = collection(firestoreDb, "members");
      const snap = await getDocs(colRef);
      const list: ClanMemberRecord[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        if (data && d.id !== "test-connection-check") {
          const mId = d.id;
          const mClan = String(data.clanMemberNumber || data.clan_member_number || "").trim().toUpperCase();
          const mEmail = String(data.email || "").trim().toLowerCase();
          const fn = String(data.firstName || data.first_name || "").trim().toLowerCase();
          const ln = String(data.lastName || data.last_name || "").trim().toLowerCase();
          if (fn === "by" && !ln && !mClan && !mEmail) return;

          const isDeletedInRegistry = deletedIds.has(mId) || (mClan && deletedClans.has(mClan)) || (mEmail && deletedEmails.has(mEmail));

          const item: ClanMemberRecord = {
            ...data,
            id: d.id,
            recordId: data.recordId || d.id,
            version: typeof data.version === "number" ? data.version : 1,
            active: data.active !== false && !data.deleted && !isDeletedInRegistry,
            deleted: data.deleted === true || isDeletedInRegistry,
            deceased: Boolean(data.deceased),
          };
          if (includeDeleted || !item.deleted) {
            list.push(item);
          }
        }
      });
      const deduplicated = deduplicateMembersList(list);
      // Merge with local records to ensure no unpersisted records are dropped
      const local = readJsonFile(membersJsonPath);
      const fsIds = new Set(deduplicated.map(m => m.id));
      local.forEach((m: any) => {
        if (!m) return;
        const fn = String(m.firstName || "").trim().toLowerCase();
        const ln = String(m.lastName || "").trim().toLowerCase();
        if (fn === "by" && !ln && !m.clanMemberNumber && !m.email) return;
        if (m.deleted || m.active === false) return;
        if (isMemberIdDeleted(m.id || m.recordId, m.clanMemberNumber, m.email, m.firstName, m.lastName)) return;
        if (m.id && !fsIds.has(m.id)) {
          deduplicated.push(m);
        }
      });
      const finalDeduplicated = deduplicateMembersList(deduplicated);
      if (!includeDeleted) {
        writeJsonFile(membersJsonPath, finalDeduplicated);
      }
      return finalDeduplicated;
    } catch (err) {
      handleServerFirestoreError(err, "getMembers");
      const local = readJsonFile(membersJsonPath);
      const filtered = local.filter((m: any) => {
        if (!m) return false;
        if (!includeDeleted) {
          if (m.deleted || m.active === false) return false;
          const mId = m.id || m.recordId;
          const mClan = m.clanMemberNumber;
          const mEmail = m.email;
          const fn = String(m.firstName || "").trim().toLowerCase();
          const ln = String(m.lastName || "").trim().toLowerCase();
          const nameKey = (fn && ln) ? `${fn}_${ln}` : "";
          if (isMemberIdDeleted(mId, mClan, mEmail, nameKey)) return false;
        }
        return true;
      });
      return deduplicateMembersList(filtered);
    }
  },

  getMember: async (id: string): Promise<ClanMemberRecord | null> => {
    if (!id) return null;
    try {
      if (!firestoreDb) throw new Error("Firestore not initialized");
      const ref = doc(firestoreDb, "members", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const local = readJsonFile(membersJsonPath);
        return local.find((m: any) => m.id === id || m.recordId === id) || null;
      }
      const data = snap.data() as any;
      return {
        ...data,
        id: snap.id,
        recordId: data.recordId || snap.id,
        version: typeof data.version === "number" ? data.version : 1,
        active: data.active !== false && !data.deleted,
        deleted: data.deleted === true,
        deceased: Boolean(data.deceased),
      };
    } catch (err) {
      const local = readJsonFile(membersJsonPath);
      return local.find((m: any) => m.id === id || m.recordId === id) || null;
    }
  },

  // Reliable member addition with submissionId idempotency and resilient local JSON fallback
  addMember: async (
    rawBody: any,
    userEmail: string,
    submissionId?: string
  ): Promise<{ member: ClanMemberRecord; isDuplicateRetry: boolean }> => {
    const now = new Date().toISOString();
    const subId = submissionId || rawBody.submissionId || null;

    const memberId = rawBody["Member ID"] || rawBody["MemberID"] || rawBody["Record ID"] || rawBody.id || rawBody.recordId || ("rec-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex"));

    // Normalize sibling array
    let siblingIds = rawBody.siblingIds;
    if (typeof siblingIds === "string") {
      try { siblingIds = JSON.parse(siblingIds); } catch { siblingIds = siblingIds ? [siblingIds.trim()] : []; }
    } else if (!Array.isArray(siblingIds)) {
      siblingIds = [];
    }

    const newRecord: ClanMemberRecord = {
      id: memberId,
      recordId: memberId,
      clanMemberNumber: String(rawBody.clanMemberNumber || rawBody.clan_member_number || "").trim(),
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
      organization: String(rawBody.organization || "").trim(),
      religion: String(rawBody.religion || "").trim(),
      denomination: String(rawBody.denomination || "").trim(),
      phone: String(rawBody.phone || rawBody.mobile || "").trim(),
      whatsapp: String(rawBody.whatsapp || "").trim(),
      email: String(rawBody.email || "").trim(),
      location: String(rawBody.location || rawBody.address || "").trim(),
      photoFile: String(rawBody.photoFile || "").trim(),
      narrative: String(rawBody.narrative || rawBody.bio || "").trim(),
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

    if (isServerFirestoreAvailable() && firestoreDb) {
      try {
        const memberRef = doc(firestoreDb, "members", memberId);
        await setDoc(memberRef, sanitizeForFirestore(newRecord));
        if (subId) {
          await setDoc(doc(firestoreDb, "submissions", subId), {
            memberId,
            createdAt: now,
            createdBy: userEmail,
          });
        }
      } catch (err) {
        handleServerFirestoreError(err, "addMember");
      }
    }

    // Always persist to local JSON store as resilient backup
    const local = readJsonFile(membersJsonPath);
    const idx = local.findIndex((m: any) => m.id === memberId || m.recordId === memberId);
    if (idx >= 0) {
      local[idx] = newRecord;
    } else {
      local.unshift(newRecord);
    }
    writeJsonFile(membersJsonPath, local);
    syncClanDataFiles(local);

    return { member: newRecord, isDuplicateRetry: false };
  },

  // Optimistic concurrency version check before update
  updateMember: async (
    id: string,
    updates: any,
    userEmail: string,
    expectedVersion?: number
  ): Promise<ClanMemberRecord> => {
    const now = new Date().toISOString();
    let existing: ClanMemberRecord | null = null;
    try {
      existing = await dbEngine.getMember(id);
    } catch (e) {}

    if (!existing) {
      throw new Error(`Member with ID "${id}" was not found in the database.`);
    }

    const updatedRecord: ClanMemberRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      recordId: existing.recordId || existing.id,
      version: (existing.version || 1) + 1,
      lastModifiedBy: userEmail || "system",
      updatedAt: now,
    };

    if (isServerFirestoreAvailable() && firestoreDb) {
      try {
        const memberRef = doc(firestoreDb, "members", id);
        await setDoc(memberRef, sanitizeForFirestore(updatedRecord), { merge: true });
      } catch (err) {
        handleServerFirestoreError(err, "updateMember");
      }
    }

    const local = readJsonFile(membersJsonPath);
    const idx = local.findIndex((m: any) => m.id === id || m.recordId === id);
    if (idx >= 0) {
      local[idx] = updatedRecord;
      writeJsonFile(membersJsonPath, local);
    }

    return updatedRecord;
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

    if (isServerFirestoreAvailable() && firestoreDb) {
      try {
        const memberRef = doc(firestoreDb, "members", id);
        await setDoc(memberRef, sanitizeForFirestore(updatedRecord), { merge: true });

        // Synchronize master ledger siaraMainaClan/records
        const localCurrent = readJsonFile(membersJsonPath);
        const activeList = localCurrent.filter((m: any) => m && m.id !== id && m.recordId !== id && !m.deleted && m.active !== false);
        await setDoc(doc(firestoreDb, "siaraMainaClan", "records"), {
          project: "SiaraMaina Clan Informatics",
          records: activeList.map(sanitizeForFirestore),
          lastUpdated: now
        }, { merge: true });
      } catch (err) {
        handleServerFirestoreError(err, "softDeleteMember");
      }
    }

    const local = readJsonFile(membersJsonPath);
    const filteredLocal = local.filter((m: any) => m && m.id !== id && m.recordId !== id);
    writeJsonFile(membersJsonPath, filteredLocal);

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

    unrecordDeletion(id);

    const restoredRecord: ClanMemberRecord = {
      ...existing,
      deleted: false,
      active: true,
      deletedAt: null,
      lastModifiedBy: userEmail || "system",
      updatedAt: now,
    };

    if (isServerFirestoreAvailable() && firestoreDb) {
      try {
        const memberRef = doc(firestoreDb, "members", id);
        await setDoc(memberRef, sanitizeForFirestore(restoredRecord), { merge: true });

        const localCurrent = readJsonFile(membersJsonPath);
        const activeList = localCurrent.filter((m: any) => m && m.id !== id && m.recordId !== id && !m.deleted && m.active !== false);
        activeList.push(restoredRecord);
        await setDoc(doc(firestoreDb, "siaraMainaClan", "records"), {
          project: "SiaraMaina Clan Informatics",
          records: activeList.map(sanitizeForFirestore),
          lastUpdated: now
        }, { merge: true });
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

    if (isServerFirestoreAvailable() && firestoreDb) {
      try {
        const memberRef = doc(firestoreDb, "members", id);
        await deleteDoc(memberRef);

        const localCurrent = readJsonFile(membersJsonPath);
        const activeList = localCurrent.filter((m: any) => m && m.id !== id && m.recordId !== id && !m.deleted && m.active !== false);
        await setDoc(doc(firestoreDb, "siaraMainaClan", "records"), {
          project: "SiaraMaina Clan Informatics",
          records: activeList.map(sanitizeForFirestore),
          lastUpdated: now
        }, { merge: true });
      } catch (err) {
        handleServerFirestoreError(err, "permanentDeleteMember");
      }
    }

    const local = readJsonFile(membersJsonPath);
    const filtered = local.filter((m: any) => m.id !== id && m.recordId !== id);
    writeJsonFile(membersJsonPath, filtered);
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
    const clanNumMap = new Map<string, ClanMemberRecord>();
    const emailMap = new Map<string, ClanMemberRecord>();
    const nameMap = new Map<string, ClanMemberRecord>();
    const singleNameMap = new Map<string, ClanMemberRecord>();

    function registerMemberInMaps(m: ClanMemberRecord) {
      const idKey = m.id || m.recordId;
      if (idKey) map.set(idKey, m);

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

      const isAutoSyncCall = userEmail === "google_sheets_sync" || userEmail === "google_sheets_autosync" || raw.isAutoSync === true;
      if (!isAutoSyncCall && (raw.forceImport === true || raw.allowReimport === true)) {
        if (rawId) unrecordDeletion(rawId);
        if (clanNum) unrecordDeletion(clanNum);
        if (email) unrecordDeletion(email);
        if (nKey) unrecordDeletion(nKey);
      } else if (isMemberIdDeleted(rawId, clanNum, email, fn, ln)) {
        continue; // Never re-import deleted member during background sync
      }

      let existing: ClanMemberRecord | undefined = undefined;
      if (rawId && map.has(rawId)) {
        existing = map.get(rawId);
      } else if (clanNum && clanNumMap.has(clanNum)) {
        existing = clanNumMap.get(clanNum);
      } else if (email && emailMap.has(email)) {
        existing = emailMap.get(email);
      } else if (!rawId && !clanNum && !email && fn && ln) {
        existing = nameMap.get(`${fn}_${mn}_${ln}`) || nameMap.get(`${fn}_${ln}`);
      } else if (!rawId && !clanNum && !email && fn && !ln) {
        existing = singleNameMap.get(fn);
      }

      const targetRecord = existing || {
        id: rawId || (clanNum ? `rec-clan-${clanNum}` : (fn ? `rec_${fn}_${ln || 'single'}_${String(raw.branchType || 'heritage').toLowerCase()}`.replace(/[^a-z0-9_]/gi, '_') : ("rec-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)))),
        recordId: "",
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

        Object.keys(raw).forEach((k) => {
          if (k !== "id" && k !== "recordId" && raw[k] !== undefined && raw[k] !== null && raw[k] !== "") {
            if ((existing as any)[k] !== raw[k]) {
              (existing as any)[k] = raw[k];
              isChanged = true;
            }
          }
        });
        if (isChanged) {
          updated++;
          existing.updatedAt = new Date().toISOString();
          existing.lastModifiedBy = userEmail;
          registerMemberInMaps(existing);
        }
      } else {
        added++;
        const targetId = targetRecord.id;
        targetRecord.recordId = targetId;
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

    if (firestoreDb && isServerFirestoreAvailable()) {
      try {
        const batch = writeBatch(firestoreDb);
        finalList.forEach((m) => {
          const ref = doc(firestoreDb, "members", m.id);
          batch.set(ref, sanitizeForFirestore(m), { merge: true });
        });
        await batch.commit();

        const activeList = finalList.filter((m: any) => m && !m.deleted && m.active !== false);
        await setDoc(doc(firestoreDb, "siaraMainaClan", "records"), {
          project: "SiaraMaina Clan Informatics",
          records: activeList.map(sanitizeForFirestore),
          lastUpdated: new Date().toISOString()
        }, { merge: true });
      } catch (err: any) {
        handleServerFirestoreError(err, "importMembersBatch");
      }
    }

    return { added, updated, members: finalList };
  },

  // Deduplicate users list by email
  deduplicateUsersList: (list: AppUserProfile[]): AppUserProfile[] => {
    if (!Array.isArray(list)) return [];
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
        }

        const merged: AppUserProfile = {
          ...existing,
          ...u,
          uid: preferredUid,
          email: emailKey,
          displayName: u.displayName || existing.displayName || (emailKey.split("@")[0] || "Clan Member"),
          role: (existing.role === "admin" || u.role === "admin") ? "admin" : (existing.role === "editor" || u.role === "editor") ? "editor" : "viewer",
          branch: u.branch || existing.branch || "general",
          approved: Boolean(existing.approved || u.approved),
          active: existing.active !== false && u.active !== false,
          createdAt: existing.createdAt || u.createdAt || new Date().toISOString(),
          lastLoginAt: u.lastLoginAt || existing.lastLoginAt || new Date().toISOString()
        };
        map.set(emailKey, merged);
      }
    });
    return Array.from(map.values());
  },

  getUser: async (uid: string): Promise<AppUserProfile | null> => {
    try {
      if (firestoreDb && uid) {
        const snap = await getDoc(doc(firestoreDb, "users", uid));
        if (snap.exists()) {
          const d = snap.data() as any;
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
    } catch (e) {}
    const local = readJsonFile(usersJsonPath) || [];
    return local.find((u: any) => u.uid === uid || (u.email && u.email.toLowerCase().trim() === uid.toLowerCase().trim())) || null;
  },

  getUsers: async (): Promise<AppUserProfile[]> => {
    let list: AppUserProfile[] = [];
    let firestoreFetched = false;

    try {
      if (firestoreDb) {
        const snap = await getDocs(collection(firestoreDb, "users"));
        snap.forEach((d) => {
          const dat = d.data() as any;
          list.push({
            uid: d.id,
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
      console.warn("[getUsers] Firestore notice:", err);
    }

    if (!firestoreFetched || list.length === 0) {
      const local = readJsonFile(usersJsonPath) || [];
      list = [...local];
    }

    const merged = dbEngine.deduplicateUsersList(list);
    writeJsonFile(usersJsonPath, merged);
    return merged;
  },

  upsertUser: async (profile: AppUserProfile): Promise<AppUserProfile> => {
    const cleanEmail = (profile.email || "").toLowerCase().trim();
    const cleanProfile = { ...profile, email: cleanEmail };

    if (isServerFirestoreAvailable() && firestoreDb && cleanProfile.uid) {
      try {
        const ref = doc(firestoreDb, "users", cleanProfile.uid);
        await setDoc(ref, sanitizeForFirestore(cleanProfile), { merge: true });

        // Clean up any existing duplicate documents in Firestore with the same email
        if (cleanEmail) {
          const q = query(collection(firestoreDb, "users"), where("email", "==", cleanEmail));
          const snap = await getDocs(q);
          for (const d of snap.docs) {
            if (d.id !== cleanProfile.uid && d.id.startsWith("user-")) {
              await deleteDoc(d.ref);
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
    const deduplicated = deduplicateUsersList(list);
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
    if (isServerFirestoreAvailable() && firestoreDb) {
      try {
        const userRef = doc(firestoreDb, "users", targetUid);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          const current = snap.data() as AppUserProfile;
          profile = { ...current, role, approved, active: approved };
          await setDoc(userRef, profile);
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
        list[idx].active = approved;
        profile = list[idx];
        writeJsonFile(usersJsonPath, deduplicateUsersList(list));
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
      timestamp: new Date().toISOString(),
    });

    return profile;
  },

  deleteUser: async (targetUid: string, adminEmail: string): Promise<void> => {
    let targetEmail = "";
    const list = readJsonFile(usersJsonPath);
    const found = list.find((u: any) => u.uid === targetUid || u.id === targetUid || (u.email && u.email.toLowerCase().trim() === targetUid.toLowerCase().trim()));
    if (found && found.email) targetEmail = found.email.toLowerCase().trim();

    if (isServerFirestoreAvailable() && firestoreDb) {
      try {
        const userRef = doc(firestoreDb, "users", targetUid);
        await deleteDoc(userRef);

        if (targetEmail) {
          const q = query(collection(firestoreDb, "users"), where("email", "==", targetEmail));
          const snap = await getDocs(q);
          for (const d of snap.docs) {
            await deleteDoc(d.ref);
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
    writeJsonFile(usersJsonPath, deduplicateUsersList(filtered));

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
    if (isServerFirestoreAvailable() && firestoreDb) {
      try {
        const logRef = doc(firestoreDb, "ActivityLogs", entry.id);
        await setDoc(logRef, entry);
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
      if (firestoreDb) {
        const q = query(collection(firestoreDb, "ActivityLogs"), limit(maxCount));
        const snap = await getDocs(q);
        const list: ActivityLogEntry[] = [];
        snap.forEach((d) => list.push(d.data() as ActivityLogEntry));
        list.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
        if (list.length > 0) return list;
      }
    } catch (e) {}
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
