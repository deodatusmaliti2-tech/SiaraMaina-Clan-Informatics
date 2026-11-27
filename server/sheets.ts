import fetch from "node-fetch";
import crypto from "crypto";
import { dbEngine, isMemberIdDeleted, markDeletionConfirmedOnSheet, ClanMemberRecord } from "./db";
import { syncManager } from "./sync";
import {
  getConfiguredSheetsWebAppUrl,
  normalizeTargetUrl,
  hasPendingGoogleSheetsSync,
  syncMemberToGoogleSheets,
  generateMemberId,
} from "./sheetsQueue";

let lastSheetSyncSignature = "";
const recentlyWrittenBackKeyMap = new Map<string, number>();
let initialSheetSyncPromise: Promise<any> | null = null;
let initialSheetSyncCompleted = false;

function normalizeCanonicalIdKey(val: string): string {
  return String(val || "").trim().replace(/\s+/g, "-").toLowerCase();
}

export function triggerInitialSheetSync(): Promise<any> {
  if (!initialSheetSyncPromise) {
    initialSheetSyncPromise = serverSyncSheetToApp({ force: true })
      .catch((err) => ({ skipped: true, error: String(err?.message || err) }))
      .finally(() => {
        initialSheetSyncCompleted = true;
      });
  }
  return initialSheetSyncPromise;
}

export async function ensureInitialSheetSync(maxWaitMs = 4500): Promise<void> {
  if (initialSheetSyncCompleted) return;
  const syncPromise = triggerInitialSheetSync();
  try {
    await Promise.race([
      syncPromise,
      new Promise((resolve) => setTimeout(resolve, maxWaitMs)),
    ]);
  } catch (e) {}
}

function extractRawField(raw: Record<string, any>, possibleKeys: string[]): string {
  if (!raw || typeof raw !== "object") return "";
  for (const k of possibleKeys) {
    if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== "") {
      return String(raw[k]).trim();
    }
  }
  const keys = Object.keys(raw);
  for (const pk of possibleKeys) {
    const cleanPk = pk.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const rk of keys) {
      const cleanRk = rk.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (cleanRk === cleanPk) {
        const val = raw[rk];
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          return String(val).trim();
        }
      }
    }
  }
  return "";
}

function isEphemeralSheetId(id: string): boolean {
  const s = String(id || "").trim();
  if (!s) return true;
  // Legacy doGet fabricated "sheet_<name>_<row>" without saving back to the sheet cell.
  // Valid permanent IDs (including spaced CLAN IDs like "CLAN 000047") must NEVER be treated as ephemeral.
  if (/^sheet_/i.test(s)) return true;
  return false;
}

export function mapRowToClanMember(
  raw: Record<string, any>,
  index: number,
  existingMembersLookup?: {
    byNormId?: Map<string, ClanMemberRecord>;
    byClan: Map<string, ClanMemberRecord>;
    byEmail: Map<string, ClanMemberRecord>;
    byFullName: Map<string, ClanMemberRecord>;
    bySingleName: Map<string, ClanMemberRecord>;
  }
): Record<string, any> | null {
  if (!raw || typeof raw !== "object") return null;

  const rawId = extractRawField(raw, ["Member ID", "id", "recordId", "memberId", "Record ID"]);
  let firstName = extractRawField(raw, ["First Name", "firstName", "fname", "first_name", "Given Name", "givenName"]);
  let middleName = extractRawField(raw, ["Middle Name", "middleName", "mname", "middle_name"]);
  let lastName = extractRawField(raw, ["Last Name", "lastName", "lname", "last_name", "Surname", "surname"]);
  const fullName = extractRawField(raw, ["Full Name", "fullName", "Member Name", "Name", "Profile Name", "Clan Member Name"]);

  if (!firstName && !middleName && !lastName && fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      firstName = parts[0];
    } else if (parts.length === 2) {
      firstName = parts[0];
      lastName = parts[1];
    } else if (parts.length >= 3) {
      firstName = parts[0];
      middleName = parts.slice(1, -1).join(" ");
      lastName = parts[parts.length - 1];
    }
  }

  const clanMemberNumber = extractRawField(raw, ["Clan Member Number", "clanMemberNumber", "clanMemberNo", "Clan Member No", "Clan No", "clanNo"]);
  const email = extractRawField(raw, ["Email Address", "email", "e-mail", "Email", "E-mail Address"]);

  if (firstName.toUpperCase() === "BY" && !lastName && !clanMemberNumber && !email) {
    return null;
  }

  // A new or existing member MUST have at least one name (first, middle, or last name) to be created or imported into the app.
  const cleanFirstName = String(firstName || "").trim();
  const cleanMiddleName = String(middleName || "").trim();
  const cleanLastName = String(lastName || "").trim();
  const hasName = Boolean(cleanFirstName || cleanMiddleName || cleanLastName);
  if (!hasName) {
    return null;
  }

  const rawDeceased = extractRawField(raw, ["Life Status", "deceased", "status", "Status"]);
  const isDeceased = String(rawDeceased).trim().toLowerCase() === "deceased" || rawDeceased === "true" || rawDeceased === "1";

  let rawSiblingIds: any = raw["Sibling Profiles"] || raw.siblingIds || raw.siblings || raw["Siblings"] || [];
  if (typeof rawSiblingIds === "string") {
    rawSiblingIds = rawSiblingIds.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean);
  } else if (!Array.isArray(rawSiblingIds)) {
    rawSiblingIds = [];
  }
  const siblingIds: string[] = Array.from(
    new Set(
      rawSiblingIds
        .map((s: any) => {
          const str = String(s || "").trim();
          const m = str.match(/\[([^\]]+)\]/);
          return (m && m[1] ? m[1] : str).trim();
        })
        .filter(Boolean)
    )
  );

  // Determine whether this row lacks a permanent Member ID on the Google Sheet
  const rawHadBlankId = isEphemeralSheetId(rawId);
  let resolvedId = !rawHadBlankId ? rawId : "";

  if (!resolvedId && existingMembersLookup) {
    const normRawId = normalizeCanonicalIdKey(rawId);
    const cleanClan = clanMemberNumber.toUpperCase();
    const cleanEmail = email.toLowerCase();
    const fnL = cleanFirstName.toLowerCase();
    const mnL = cleanMiddleName.toLowerCase();
    const lnL = cleanLastName.toLowerCase();

    const matched =
      (normRawId && existingMembersLookup.byNormId && existingMembersLookup.byNormId.get(normRawId)) ||
      (cleanClan && existingMembersLookup.byClan.get(cleanClan)) ||
      (cleanEmail && existingMembersLookup.byEmail.get(cleanEmail)) ||
      (fnL && mnL && lnL && existingMembersLookup.byFullName.get(`${fnL}_${mnL}_${lnL}`)) ||
      (fnL && lnL && existingMembersLookup.byFullName.get(`${fnL}_${lnL}`)) ||
      (fnL && !mnL && !lnL && existingMembersLookup.bySingleName.get(fnL)) ||
      null;

    if (matched && matched.id) {
      resolvedId = matched.id;
    }
  }

  if (!resolvedId) {
    const safeClanSlug = clanMemberNumber.replace(/[^a-zA-Z0-9_\-]+/g, "-").replace(/^-+|-+$/g, "");
    resolvedId = safeClanSlug
      ? `rec-clan-${safeClanSlug}`
      : generateMemberId("rec");
  }

  function extractRelationId(val: any): string {
    if (!val) return "";
    const s = String(val).trim();
    const match = s.match(/\[([^\]]+)\]/);
    if (match && match[1]) return match[1].trim();
    return s;
  }

  function cleanSheetDate(val: string): string {
    const s = String(val || "").trim();
    if (!s || /^#+$/.test(s)) return "";
    // Plain YYYY-MM-DD date string — keep exact calendar date
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Full ISO timestamp from Google Sheets Date cell (e.g. 2024-11-20T21:00:00.000Z = midnight UTC+3 = 2024-11-21)
    // Adding 12 hours before reading UTC YYYY-MM-DD recovers the exact local calendar date for UTC-11..UTC+12 with zero day-drift.
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const parsedMs = Date.parse(s);
      if (!Number.isNaN(parsedMs)) {
        return new Date(parsedMs + 12 * 3600 * 1000).toISOString().slice(0, 10);
      }
      return s.slice(0, 10);
    }
    return s;
  }

  return {
    id: resolvedId,
    recordId: resolvedId,
    _rawHadBlankId: rawHadBlankId,
    _needsIdWriteback: rawHadBlankId,
    _sheetRowHint: typeof raw._rowIndex === "number" ? raw._rowIndex : index + 2,
    clanMemberNumber: clanMemberNumber,
    firstName: cleanFirstName,
    middleName: cleanMiddleName,
    lastName: cleanLastName,
    sex: extractRawField(raw, ["Sex", "sex", "gender", "Gender"]) || "Not Recorded",
    branchType: extractRawField(raw, ["Family Clan", "branchType", "clan", "branch", "Branch", "Clan"]) || "heritage",
    honorific: extractRawField(raw, ["Title / Honorific", "honorific", "title", "Title"]),
    dob: cleanSheetDate(extractRawField(raw, ["Date of Birth", "dob", "birthDate", "born", "Birth Date"])),
    birthPeriod: extractRawField(raw, ["Historical Age", "birthPeriod", "period", "Age Category"]),
    placeOfBirth: extractRawField(raw, ["Place of Birth", "placeOfBirth", "birthPlace"]),
    deceased: isDeceased,
    dod: cleanSheetDate(extractRawField(raw, ["Date of Death", "dod", "deathDate"])),
    deathAge: extractRawField(raw, ["Age at Death", "deathAge", "ageAtDeath"]),
    causeOfDeath: extractRawField(raw, ["Cause of Death", "causeOfDeath"]),
    fatherId: extractRelationId(extractRawField(raw, ["Father Profile", "fatherId", "father", "Father"])),
    motherId: extractRelationId(extractRawField(raw, ["Mother Profile", "motherId", "mother", "Mother"])),
    spouseId: extractRelationId(extractRawField(raw, ["Spouse Profile", "spouseId", "spouse", "Spouse"])),
    siblingIds: siblingIds,
    maritalStatus: extractRawField(raw, ["Marital Status", "maritalStatus"]),
    education: extractRawField(raw, ["Education Level", "education"]),
    course: extractRawField(raw, ["Course / Area of Study", "course"]),
    employment: extractRawField(raw, ["Employment Status", "employment"]),
    occupation: extractRawField(raw, ["Occupation / Profession", "occupation", "profession", "job"]),
    organization: extractRawField(raw, ["Organisation / Employer", "organization", "employer", "company"]),
    religion: extractRawField(raw, ["Religious Affiliation", "religion"]),
    denomination: extractRawField(raw, ["Denomination / Tradition", "denomination"]),
    phone: extractRawField(raw, ["Telephone", "phone", "mobile", "tel", "Phone"]),
    whatsapp: extractRawField(raw, ["WhatsApp", "whatsapp"]),
    email: email,
    location: extractRawField(raw, ["Current Location", "location", "address"]),
    narrative: extractRawField(raw, ["Historical Location", "narrative", "bio", "notes"]),
    photo: extractRawField(raw, ["Passport-Style Image", "Photo", "Photo URL", "Profile Picture", "photo", "storedPhoto", "photoUrl", "photoFile", "imageUrl"]),
    storedPhoto: extractRawField(raw, ["Passport-Style Image", "Photo", "Photo URL", "Profile Picture", "storedPhoto", "photo", "photoUrl", "photoFile", "imageUrl"]),
    photoUrl: extractRawField(raw, ["Passport-Style Image", "Photo", "Photo URL", "Profile Picture", "photoUrl", "photo", "storedPhoto", "photoFile", "imageUrl"]),
  };
}

export function resetSheetSyncSignature() {
  lastSheetSyncSignature = "";
}

export async function serverSyncSheetToApp(options?: { force?: boolean; targetUrlOverride?: string }) {
  const force = Boolean(options?.force);
  try {
    // Prevent Sheet -> App background sync from racing with an active or recently completed App -> Sheet push/delete
    if (!force && hasPendingGoogleSheetsSync()) {
      return { skipped: true, reason: "pending_outbound_sync" };
    }

    const rawUrl = options?.targetUrlOverride || getConfiguredSheetsWebAppUrl();
    const url = normalizeTargetUrl(rawUrl);
    if (!url) return { skipped: true, reason: "no_url" };

    let rawRecords: Record<string, any>[] = [];
    let remoteSupportsSingleNameWriteback = url.includes("localhost") || url.includes("127.0.0.1");

    if (url.includes("script.google.com/macros/s/") || url.includes("/api/sheets/mock-echo")) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      try {
        const fetchUrl = url.includes("script.google.com/macros/s/")
          ? `${url}${url.includes("?") ? "&" : "?"}action=read&_t=${Date.now()}`
          : url;
        const resp = await fetch(fetchUrl, {
          headers: { Accept: "application/json", "Cache-Control": "no-cache" },
          redirect: "follow",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!resp.ok) return { skipped: true, reason: `http_${resp.status}` };
        const json: any = await resp.json();
        if (Array.isArray(json)) {
          rawRecords = json;
          if (json.length > 0 && json[0] && (json[0]._scriptVersion === "4.0" || json[0].autoIdSupported === true)) {
            remoteSupportsSingleNameWriteback = true;
          }
        } else if (json && Array.isArray(json.members)) {
          rawRecords = json.members;
          if (json.scriptVersion === "4.0" || json.autoIdSupported === true) {
            remoteSupportsSingleNameWriteback = true;
          }
        } else if (json && Array.isArray(json.data)) {
          rawRecords = json.data;
          if (json.scriptVersion === "4.0" || json.autoIdSupported === true) {
            remoteSupportsSingleNameWriteback = true;
          }
        }
      } catch (e) {
        clearTimeout(timeout);
        return { skipped: true, reason: "fetch_failed" };
      }
    } else if (url.includes("docs.google.com/spreadsheets")) {
      const gvizUrl = url.replace(/\/edit.*$/, "").replace(/\/view.*$/, "") + "/gviz/tq?tqx=out:json";
      const resp = await fetch(gvizUrl);
      if (resp.ok) {
        const text = await resp.text();
        const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\((.*)\);/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[1]);
          if (data && data.table && Array.isArray(data.table.rows)) {
            const cols = (data.table.cols || []).map((c: any) => (c && c.label ? c.label : ""));
            rawRecords = data.table.rows.map((row: any) => {
              const obj: Record<string, any> = {};
              (row.c || []).forEach((cell: any, i: number) => {
                const colName = cols[i];
                if (colName) obj[colName] = cell ? (cell.v !== undefined ? cell.v : cell.f || "") : "";
              });
              return obj;
            });
          }
        }
      }
    }

    if (!Array.isArray(rawRecords)) return { skipped: true, reason: "invalid_payload" };

    // Build lookup of current active members BEFORE mapping so blank-ID rows reuse existing IDs cleanly (zero duplicates)
    const currentActiveMembers = await dbEngine.getMembers(false);
    const existingLookup = {
      byNormId: new Map<string, ClanMemberRecord>(),
      byClan: new Map<string, ClanMemberRecord>(),
      byEmail: new Map<string, ClanMemberRecord>(),
      byFullName: new Map<string, ClanMemberRecord>(),
      bySingleName: new Map<string, ClanMemberRecord>(),
    };
    currentActiveMembers.forEach((m) => {
      const nid = normalizeCanonicalIdKey(m.id || m.recordId || "");
      const c = String(m.clanMemberNumber || "").trim().toUpperCase();
      const e = String(m.email || "").trim().toLowerCase();
      const fn = String(m.firstName || "").trim().toLowerCase();
      const mn = String(m.middleName || "").trim().toLowerCase();
      const ln = String(m.lastName || "").trim().toLowerCase();
      if (nid) existingLookup.byNormId.set(nid, m);
      if (c) existingLookup.byClan.set(c, m);
      if (e) existingLookup.byEmail.set(e, m);
      if (fn && mn && ln) existingLookup.byFullName.set(`${fn}_${mn}_${ln}`, m);
      if (fn && ln) existingLookup.byFullName.set(`${fn}_${ln}`, m);
      if (fn && !mn && !ln) existingLookup.bySingleName.set(fn, m);
    });

    const validMembers: Record<string, any>[] = [];
    const blankIdNameKeys = new Set<string>();
    const rowsNeedingIdWriteback: Record<string, any>[] = [];
    const nowMs = Date.now();

    rawRecords.forEach((row, idx) => {
      const mapped = mapRowToClanMember(row, idx, existingLookup);
      if (!mapped) return;
      if (isMemberIdDeleted(mapped.id, mapped.clanMemberNumber, mapped.email, mapped.firstName, mapped.lastName)) {
        return;
      }

      if (mapped._rawHadBlankId) {
        const fn = String(mapped.firstName || "").toLowerCase().trim();
        const mn = String(mapped.middleName || "").toLowerCase().trim();
        const ln = String(mapped.lastName || "").toLowerCase().trim();
        if (fn && ln) blankIdNameKeys.add(`name:${fn}_${ln}`);
        if (fn && mn && ln) blankIdNameKeys.add(`name:${fn}_${mn}_${ln}`);
        if (fn && !mn && !ln) blankIdNameKeys.add(`only_fn:${fn}`);
        if (!fn && !mn && ln) blankIdNameKeys.add(`only_ln:${ln}`);
      }

      if (mapped._needsIdWriteback) {
        const hasFullName = Boolean(mapped.firstName && mapped.lastName);
        const canWriteBackSafely = hasFullName || remoteSupportsSingleNameWriteback;
        const wbKey = `${mapped.firstName.toLowerCase()}|${mapped.middleName.toLowerCase()}|${mapped.lastName.toLowerCase()}|${mapped.email.toLowerCase()}`;
        const lastAttempt = recentlyWrittenBackKeyMap.get(wbKey) || 0;
        if (canWriteBackSafely && nowMs - lastAttempt > 60000) {
          recentlyWrittenBackKeyMap.set(wbKey, nowMs);
          rowsNeedingIdWriteback.push(mapped);
        }
      }

      // Strip internal helper props before hashing / importing
      const cleanMapped = { ...mapped };
      delete cleanMapped._rawHadBlankId;
      delete cleanMapped._needsIdWriteback;
      delete cleanMapped._sheetRowHint;
      validMembers.push(cleanMapped);
    });

    if (validMembers.length === 0 && rawRecords.length > 0) {
      return { skipped: true, reason: "no_valid_named_rows" };
    }

    // Re-check outbound queue right before mutating local DB in case an App save/delete started during our GET
    if (!force && hasPendingGoogleSheetsSync()) {
      return { skipped: true, reason: "outbound_started_during_fetch" };
    }

    // Signature check: skip redundant writes when nothing changed AND no IDs need write-back
    const hash = crypto.createHash("sha256").update(JSON.stringify(validMembers)).digest("hex");
    if (!force && hash === lastSheetSyncSignature && rowsNeedingIdWriteback.length === 0) {
      return { skipped: true, reason: "unchanged" };
    }

    // 1. Detect members removed/deleted from the Google Sheet (with 60-second grace period for freshly added/edited App members!)
    let deletedFromSheetCount = 0;
    const deletedFromSheet: ClanMemberRecord[] = [];
    const NEW_MEMBER_GRACE_MS = 60000;

    if (currentActiveMembers.length > 0 && validMembers.length > 0) {
      const sheetIdentSet = new Set<string>();
      validMembers.forEach((m) => {
        if (m.id) {
          sheetIdentSet.add(String(m.id).toLowerCase().trim());
          sheetIdentSet.add(normalizeCanonicalIdKey(m.id));
        }
        if (m.recordId) {
          sheetIdentSet.add(String(m.recordId).toLowerCase().trim());
          sheetIdentSet.add(normalizeCanonicalIdKey(m.recordId));
        }
        if (m.clanMemberNumber) sheetIdentSet.add(String(m.clanMemberNumber).toLowerCase().trim());
        if (m.email) sheetIdentSet.add(String(m.email).toLowerCase().trim());
      });

      currentActiveMembers.forEach((dbm) => {
        // Protect freshly created or freshly edited App members from being purged before their forward push settles
        const createdMs = dbm.createdAt ? new Date(dbm.createdAt).getTime() : 0;
        const updatedMs = dbm.updatedAt ? new Date(dbm.updatedAt).getTime() : 0;
        const newestTouchMs = Math.max(createdMs || 0, updatedMs || 0);
        if (!force && newestTouchMs > 0 && nowMs - newestTouchMs < NEW_MEMBER_GRACE_MS) {
          return;
        }

        const dbId = String(dbm.id || dbm.recordId || "").toLowerCase().trim();
        const dbNormId = normalizeCanonicalIdKey(dbm.id || dbm.recordId || "");
        const dbClan = String(dbm.clanMemberNumber || "").toLowerCase().trim();
        const dbEmail = String(dbm.email || "").toLowerCase().trim();
        const dbFn = String(dbm.firstName || "").toLowerCase().trim();
        const dbMn = String(dbm.middleName || "").toLowerCase().trim();
        const dbLn = String(dbm.lastName || "").toLowerCase().trim();
        const dbName1 = dbFn && dbLn ? `name:${dbFn}_${dbLn}` : "";
        const dbName2 = dbFn && dbMn && dbLn ? `name:${dbFn}_${dbMn}_${dbLn}` : "";
        const dbOnlyFn = dbFn && !dbMn && !dbLn ? `only_fn:${dbFn}` : "";
        const dbOnlyLn = !dbFn && !dbMn && dbLn ? `only_ln:${dbLn}` : "";

        const matchedByUniqueId =
          (dbId && sheetIdentSet.has(dbId)) ||
          (dbNormId && sheetIdentSet.has(dbNormId)) ||
          (dbClan && sheetIdentSet.has(dbClan)) ||
          (dbEmail && sheetIdentSet.has(dbEmail));

        const matchedByBlankIdRowName =
          blankIdNameKeys.size > 0 &&
          ((dbName1 && blankIdNameKeys.has(dbName1)) ||
            (dbName2 && blankIdNameKeys.has(dbName2)) ||
            (dbOnlyFn && blankIdNameKeys.has(dbOnlyFn)) ||
            (dbOnlyLn && blankIdNameKeys.has(dbOnlyLn)));

        const inSheet = Boolean(matchedByUniqueId || matchedByBlankIdRowName);

        if (!inSheet) {
          deletedFromSheet.push(dbm);
        }
      });

      // Safeguard: auto-purge if removed count is <= 40% of database (or small DB <= 5) to protect against transient partial fetches
      const maxSafePurge = currentActiveMembers.length <= 5 ? currentActiveMembers.length : Math.floor(currentActiveMembers.length * 0.4);
      if (deletedFromSheet.length > 0 && deletedFromSheet.length <= maxSafePurge) {
        console.log(
          `[ServerSync] Detected ${deletedFromSheet.length} member(s) deleted from Google Sheets. Purging from DB and broadcasting to all browsers...`
        );
        const deletedIds = deletedFromSheet.map((m) => m.id);
        for (const dm of deletedFromSheet) {
          await dbEngine.permanentDeleteMember(dm.id, "google_sheets_sync");
        }
        // Mark sheet-confirmed immediately so if the user undoes the deletion in Google Sheets later, it can re-sync cleanly
        markDeletionConfirmedOnSheet(deletedIds);
        deletedFromSheetCount = deletedFromSheet.length;

        const remainingActive = await dbEngine.getMembers(false);

        syncManager.broadcast("doc_change", {
          action: "DELETE",
          collection: "members",
          ids: deletedIds,
          deletedIds: deletedIds,
          records: remainingActive,
          count: remainingActive.length,
          author: "google_sheets_sync",
          timestamp: new Date().toISOString(),
        });

        syncManager.broadcast("sync_pulse", {
          action: "BATCH_DELETED",
          ids: deletedIds,
          deletedIds: deletedIds,
          count: remainingActive.length,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // 2. Import additions & updates from Google Sheet into local DB
    const result = validMembers.length > 0
      ? await dbEngine.importMembersBatch(validMembers, "server_autosync")
      : { added: 0, updated: 0, members: currentActiveMembers };

    lastSheetSyncSignature = hash;

    // 3. Automatically write back generated Member IDs to the Google Sheet so blank-ID rows get permanent IDs on the Sheet
    if (rowsNeedingIdWriteback.length > 0) {
      const writeBackClean = rowsNeedingIdWriteback.map((m) => {
        const copy = { ...m };
        delete copy._rawHadBlankId;
        delete copy._needsIdWriteback;
        return copy;
      });
      console.log(
        `[ServerSync] Auto-writing back permanent Member ID(s) to Google Sheet for ${writeBackClean.length} newly added row(s)...`
      );
      if (options?.targetUrlOverride) {
        // Direct write-back when testing against an explicit target URL override
        const { postToGoogleSheetsWithRetry, formatMemberForSheets, runSerializedGoogleSheetsTask } = await import("./sheetsQueue");
        const payload = writeBackClean.length === 1
          ? formatMemberForSheets(writeBackClean[0])
          : writeBackClean.map(formatMemberForSheets);
        await runSerializedGoogleSheetsTask(() => postToGoogleSheetsWithRetry(url, payload, 2));
      } else {
        await syncMemberToGoogleSheets(writeBackClean);
      }
    }

    // 4. Broadcast updated active records to all connected browsers if anything changed
    const hasMutations = result.added > 0 || result.updated > 0 || deletedFromSheetCount > 0;
    if (hasMutations) {
      const allActiveNow = await dbEngine.getMembers(false);
      syncManager.broadcast("doc_change", {
        action: "SET",
        collection: "members",
        records: allActiveNow,
        timestamp: new Date().toISOString(),
      });
      console.log(
        `[ServerSync] Synced ${result.added} new, ${result.updated} updated, ${deletedFromSheetCount} deleted. Total active members: ${allActiveNow.length}.`
      );
    }

    return {
      skipped: false,
      added: result.added,
      updated: result.updated,
      deleted: deletedFromSheetCount,
      idsWrittenBack: rowsNeedingIdWriteback.length,
    };
  } catch (e) {
    console.warn("[ServerSync] Background sync notice:", (e as any)?.message || e);
    return { skipped: true, error: (e as any)?.message || String(e) };
  }
}

// Continuous 15-second background sync loop for responsive two-way Google Sheets sync
let isServerSheetSyncActive = false;
const sheetSyncTimer = setInterval(async () => {
  if (isServerSheetSyncActive) return;
  isServerSheetSyncActive = true;
  try {
    await serverSyncSheetToApp();
  } catch (err) {
    // quiet catch
  } finally {
    isServerSheetSyncActive = false;
  }
}, 15000);
if (typeof sheetSyncTimer.unref === "function") {
  sheetSyncTimer.unref();
}
