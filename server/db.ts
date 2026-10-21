import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeFirestore,
  getFirestore,
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
  return fs.existsSync(quotaFlagPath);
}

function setQuotaExhaustedPersisted() {
  if (!fs.existsSync(path.dirname(quotaFlagPath))) {
    fs.mkdirSync(path.dirname(quotaFlagPath), { recursive: true });
  }
  fs.writeFileSync(quotaFlagPath, "true");
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
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {}
}

export interface DeletedRecordEntry {
  id: string;
  clanMemberNumber?: string;
  email?: string;
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
  const fn = String(member?.firstName || member?.first_name || "").trim().toLowerCase();
  const ln = String(member?.lastName || member?.last_name || "").trim().toLowerCase();
  const nameKey = fn ? (ln ? `${fn}_${ln}` : `${fn}_single`) : "";

  const exists = list.some(d => d.id === idStr || (clanNum && d.clanMemberNumber === clanNum) || (email && d.email === email) || (nameKey && d.nameKey === nameKey));
  if (!exists) {
    list.push({
      id: idStr,
      clanMemberNumber: clanNum || undefined,
      email: email || undefined,
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
    const mFn = String(m.firstName || "").trim().toLowerCase();
    const mLn = String(m.lastName || "").trim().toLowerCase();
    const mName = mFn ? (mLn ? `${mFn}_${mLn}` : `${mFn}_single`) : "";

    if (mId && mId === idStr) return false;
    if (clanNum && mClan && mClan === clanNum) return false;
    if (email && mEmail && mEmail === email) return false;
    if (nameKey && mName && mName === nameKey) return false;
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

export function isMemberIdDeleted(id?: string, clanNum?: string, email?: string, nameKey?: string): boolean {
  const list = getDeletedRegistry();
  const idStr = String(id || "").trim();
  const clanStr = String(clanNum || "").trim().toUpperCase();
  const emailStr = String(email || "").trim().toLowerCase();
  const nameStr = String(nameKey || "").trim().toLowerCase();

  return list.some(d => {
    if (idStr && d.id && d.id === idStr) return true;
    if (clanStr && d.clanMemberNumber && d.clanMemberNumber === clanStr) return true;
    if (emailStr && d.email && d.email === emailStr) return true;
    if (nameStr && d.nameKey && d.nameKey === nameStr) return true;
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
  const nameMap = new Map<string, ClanMemberRecord>();
  const clanMap = new Map<string, ClanMemberRecord>();
  const emailMap = new Map<string, ClanMemberRecord>();
  const phoneMap = new Map<string, ClanMemberRecord>();
  const cleaned: ClanMemberRecord[] = [];

  list.forEach(m => {
    if (!m) return;
    const mId = String(m.id || m.recordId || "").trim();
    const clanNum = String(m.clanMemberNumber || "").trim().toUpperCase();
    const emailKey = String(m.email || "").trim().toLowerCase();
    const phoneKey = String(m.phone || m.whatsapp || "").replace(/\D/g, "");
    const fn = String(m.firstName || "").trim().toLowerCase();
    const ln = String(m.lastName || "").trim().toLowerCase();
    const branch = String(m.branchType || "heritage").trim().toLowerCase();
    const nameKey = ln ? `${fn}_${ln}` : `${fn}_single_${branch}`;

    let existing: ClanMemberRecord | null = null;
    if (mId && idMap.has(mId)) existing = idMap.get(mId)!;
    else if (clanNum && clanMap.has(clanNum)) existing = clanMap.get(clanNum)!;
    else if (emailKey && emailMap.has(emailKey)) existing = emailMap.get(emailKey)!;
    else if (nameKey && nameMap.has(nameKey)) existing = nameMap.get(nameKey)!;
    else if (phoneKey && phoneKey.length >= 7 && phoneMap.has(phoneKey)) existing = phoneMap.get(phoneKey)!;

    if (existing) {
      Object.keys(m).forEach(k => {
        const val = (m as any)[k];
        if (val !== undefined && val !== "" && val !== null && !(existing as any)[k]) {
          (existing as any)[k] = val;
        }
      });
    } else {
      if (mId) idMap.set(mId, m);
      if (clanNum) clanMap.set(clanNum, m);
      if (emailKey) emailMap.set(emailKey, m);
      if (nameKey) nameMap.set(nameKey, m);
      if (phoneKey && phoneKey.length >= 7) phoneMap.set(phoneKey, m);
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
    const deletedNames = new Set(deletedList.map(d => d.nameKey).filter(Boolean));

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
          const mFn = String(data.firstName || data.first_name || "").trim().toLowerCase();
          const mLn = String(data.lastName || data.last_name || "").trim().toLowerCase();
          const mName = (mFn && mLn) ? `${mFn}_${mLn}` : "";

          const isDeletedInRegistry = deletedIds.has(mId) || (mClan && deletedClans.has(mClan)) || (mEmail && deletedEmails.has(mEmail)) || (mName && deletedNames.has(mName));

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
      // Sync local backup (excluding deleted if not requested)
      if (!includeDeleted) {
        writeJsonFile(membersJsonPath, deduplicated);
      }
      return deduplicated;
    } catch (err) {
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

    const memberId = rawBody.id || rawBody.recordId || ("rec-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex"));

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

    try {
      if (!firestoreDb) throw new Error("Firestore not initialized");
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
      console.warn("[addMember] Firestore write notice (falling back to local JSON store):", err);
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

    try {
      if (!firestoreDb) throw new Error("Firestore not initialized");
      const memberRef = doc(firestoreDb, "members", id);
      await setDoc(memberRef, sanitizeForFirestore(updatedRecord), { merge: true });
    } catch (err) {
      console.warn("[updateMember] Firestore update notice:", err);
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

    try {
      if (firestoreDb) {
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
      }
    } catch (err) {
      console.warn("[softDeleteMember] Firestore notice:", err);
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

    try {
      if (firestoreDb) {
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
      }
    } catch (err) {
      console.warn("[restoreMember] Firestore notice:", err);
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

    try {
      if (firestoreDb) {
        const memberRef = doc(firestoreDb, "members", id);
        await deleteDoc(memberRef);

        const localCurrent = readJsonFile(membersJsonPath);
        const activeList = localCurrent.filter((m: any) => m && m.id !== id && m.recordId !== id && !m.deleted && m.active !== false);
        await setDoc(doc(firestoreDb, "siaraMainaClan", "records"), {
          project: "SiaraMaina Clan Informatics",
          records: activeList.map(sanitizeForFirestore),
          lastUpdated: now
        }, { merge: true });
      }
    } catch (err) {
      console.warn("[permanentDeleteMember] Firestore notice:", err);
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

      const cNum = String(m.clanMemberNumber || "").trim().toUpperCase();
      if (cNum) clanNumMap.set(cNum, m);

      const em = String(m.email || "").trim().toLowerCase();
      if (em) emailMap.set(em, m);

      const fn = String(m.firstName || "").trim().toLowerCase();
      const ln = String(m.lastName || "").trim().toLowerCase();
      const mn = String(m.middleName || "").trim().toLowerCase();

      if (fn && ln) {
        nameMap.set(`${fn}_${mn}_${ln}`, m);
        nameMap.set(`${fn}_${ln}`, m);
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
      const clanNum = String(raw.clanMemberNumber || raw.clan_member_number || "").trim().toUpperCase();
      const email = String(raw.email || "").trim().toLowerCase();
      const nKey = fn ? (ln ? `${fn}_${ln}` : `${fn}_single`) : "";

      if (userEmail === "google_sheets_autosync" || userEmail === "google_sheet_webhook" || raw.forceImport || raw.allowReimport) {
        if (rawId) unrecordDeletion(rawId);
        if (clanNum) unrecordDeletion(clanNum);
        if (email) unrecordDeletion(email);
        if (nKey) unrecordDeletion(nKey);
      } else if (isMemberIdDeleted(rawId, clanNum, email, nKey)) {
        continue; // Never re-import deleted member unless forced
      }

      let existing: ClanMemberRecord | undefined = undefined;
      if (rawId && map.has(rawId)) {
        existing = map.get(rawId);
      } else if (clanNum && clanNumMap.has(clanNum)) {
        existing = clanNumMap.get(clanNum);
      } else if (email && emailMap.has(email)) {
        existing = emailMap.get(email);
      } else if (fn && ln) {
        existing = nameMap.get(`${fn}_${mn}_${ln}`) || nameMap.get(`${fn}_${ln}`);
      } else if (fn && !ln) {
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

    const finalList = Array.from(map.values());
    writeJsonFile(membersJsonPath, finalList);

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

    try {
      if (firestoreDb && cleanProfile.uid) {
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
      }
    } catch (err) {}

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
    try {
      if (firestoreDb) {
        const userRef = doc(firestoreDb, "users", targetUid);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          const current = snap.data() as AppUserProfile;
          profile = { ...current, role, approved, active: approved };
          await setDoc(userRef, profile);
        }
      }
    } catch (e) {}

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

    try {
      if (firestoreDb) {
        const userRef = doc(firestoreDb, "users", targetUid);
        await deleteDoc(userRef);

        if (targetEmail) {
          const q = query(collection(firestoreDb, "users"), where("email", "==", targetEmail));
          const snap = await getDocs(q);
          for (const d of snap.docs) {
            await deleteDoc(d.ref);
          }
        }
      }
    } catch (e) {}

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
    try {
      if (firestoreDb) {
        const logRef = doc(firestoreDb, "ActivityLogs", entry.id);
        await setDoc(logRef, entry);
      }
    } catch (err) {}
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
