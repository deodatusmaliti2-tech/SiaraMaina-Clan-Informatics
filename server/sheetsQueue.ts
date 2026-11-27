import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const DEFAULT_SHEETS_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbyLlYZ3pw4-5ENtn_wf6tInqNRAPmHCdDmzJx40g2hUPNVyK3XOcleP9_MaGqktg6V2/exec";

const spreadsheetConfigFile = path.resolve(process.cwd(), "data/spreadsheet_config.json");

export function getConfiguredSheetsWebAppUrl(): string {
  let sheetTargetUrl = DEFAULT_SHEETS_WEB_APP_URL;
  if (fs.existsSync(spreadsheetConfigFile)) {
    try {
      const sheetCfg = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
      sheetTargetUrl = sheetCfg.webAppUrl || sheetCfg.url || sheetCfg.spreadsheetId || sheetTargetUrl;
    } catch (e) {}
  }
  return sheetTargetUrl;
}

export function normalizeTargetUrl(url: string): string {
  const trimmed = String(url || "").trim();
  if (trimmed.startsWith("/")) {
    return `http://localhost:3000${trimmed}`;
  }
  return trimmed;
}

export function generateMemberId(prefix = "rec"): string {
  const rand = crypto.randomBytes(3).toString("hex").slice(0, 5);
  return `${prefix}-${Date.now()}-${rand}`;
}

export function formatMemberForSheets(m: any) {
  if (!m || typeof m !== "object") return m;
  const copy = { ...m };

  // Ensure automatic member/user ID is assigned and written for Google Sheets Column 1 ("Member ID")
  const resolvedId =
    String(
      copy.id ||
        copy.recordId ||
        copy["Member ID"] ||
        copy["MemberID"] ||
        copy["Record ID"] ||
        copy.clanMemberNumber ||
        ""
    ).trim() || generateMemberId("rec");

  copy.id = resolvedId;
  copy.recordId = resolvedId;
  copy["Member ID"] = resolvedId;
  copy["MemberID"] = resolvedId;
  copy["Record ID"] = resolvedId;
  copy["memberId"] = resolvedId;

  // Ensure name aliases are populated consistently
  const fn = String(copy.firstName || copy["First Name"] || "").trim();
  const mn = String(copy.middleName || copy["Middle Name"] || "").trim();
  const ln = String(copy.lastName || copy["Last Name"] || "").trim();
  copy.firstName = fn;
  copy.middleName = mn;
  copy.lastName = ln;
  copy["First Name"] = fn;
  copy["Middle Name"] = mn;
  copy["Last Name"] = ln;

  // Resolve raw photo string from all potential fields
  let rawPhoto = String(
    copy.photo ||
      copy.storedPhoto ||
      copy.photoUrl ||
      copy.photoFile ||
      copy["Photo"] ||
      copy["Photo URL"] ||
      copy["Passport-Style Image"] ||
      ""
  ).trim();

  // If photo is a local relative URL or filename, map it through driveCache to get the Google Drive URL
  if (rawPhoto && !rawPhoto.startsWith("http://") && !rawPhoto.startsWith("https://")) {
    const driveCacheFile = path.resolve(process.cwd(), "data", "migrated_photos_cache.json");
    if (fs.existsSync(driveCacheFile)) {
      try {
        const driveCache = JSON.parse(fs.readFileSync(driveCacheFile, "utf-8"));
        const cleanName = path.basename(rawPhoto);
        const cachedUrl =
          driveCache[cleanName] ||
          driveCache[rawPhoto] ||
          driveCache[`/uploads/${cleanName}`] ||
          driveCache[`uploads/${cleanName}`];
        if (cachedUrl) {
          rawPhoto = cachedUrl;
        }
      } catch (e) {}
    }
  }

  // Prevent Google Sheets 50,000-character cell limit error if an un-uploaded inline base64 photo is oversized
  if (rawPhoto.startsWith("data:image/") && rawPhoto.length > 45000) {
    rawPhoto = "";
  }

  // Set all expected header alias keys so Google Apps Script finds the photo URL regardless of header naming
  copy.photo = rawPhoto;
  copy.storedPhoto = rawPhoto;
  copy.photoUrl = rawPhoto;
  copy.photoFile = rawPhoto;
  copy["Photo"] = rawPhoto;
  copy["Photo URL"] = rawPhoto;
  copy["Passport-Style Image"] = rawPhoto;

  // Ensure siblingIds / Sibling Profiles are cleanly serialized for Apps Script
  if (Array.isArray(copy.siblingIds)) {
    const cleanSibs = copy.siblingIds.map((s: any) => String(s || "").trim()).filter(Boolean);
    copy.siblingIds = cleanSibs;
    copy["Sibling Profiles"] = cleanSibs.join("; ");
  }

  // Normalize branchType to consistent display label for Family Clan column while preserving canonical fields
  const branchDisplayMap: Record<string, string> = {
    heritage: "Foundational Ancestry",
    siara: "Siara Branch",
    maina: "Maina Branch",
    maliti: "Maliti Family",
  };
  const rawBranch = String(copy.branchType || copy.familyClan || copy["Family Clan"] || "").trim();
  const branchDisplay = branchDisplayMap[rawBranch.toLowerCase()] || rawBranch;
  copy.branchType = branchDisplay;
  copy.familyClan = branchDisplay;
  copy["Family Clan"] = branchDisplay;

  // Synchronize every editable profile field with both its camelCase key, legacy alias, and Sheet column header
  const syncField = (canonical: string, sheetHeader: string, legacyAliases: string[] = []) => {
    let val: any = copy[canonical];
    if (val === undefined || val === null) {
      for (const alias of [sheetHeader, ...legacyAliases]) {
        if (copy[alias] !== undefined && copy[alias] !== null) {
          val = copy[alias];
          break;
        }
      }
    }
    if (val === undefined || val === null) val = "";
    const strVal = String(val);
    copy[canonical] = strVal;
    copy[sheetHeader] = strVal;
    for (const alias of legacyAliases) {
      copy[alias] = strVal;
    }
  };

  syncField("clanMemberNumber", "Clan Member Number");
  syncField("sex", "Sex");
  syncField("honorific", "Title / Honorific");
  syncField("dob", "Date of Birth");
  syncField("birthPeriod", "Historical Age");
  syncField("placeOfBirth", "Place of Birth", ["pob"]);
  syncField("dod", "Date of Death");
  syncField("deathAge", "Age at Death");
  syncField("causeOfDeath", "Cause of Death");
  syncField("fatherId", "Father Profile");
  syncField("motherId", "Mother Profile");
  syncField("spouseId", "Spouse Profile");
  syncField("maritalStatus", "Marital Status");
  syncField("education", "Education Level");
  syncField("course", "Course / Area of Study", ["courseOfStudy"]);
  syncField("employment", "Employment Status", ["employmentStatus"]);
  syncField("occupation", "Occupation / Profession");
  syncField("organization", "Organisation / Employer", ["employer"]);
  syncField("religion", "Religious Affiliation");
  syncField("denomination", "Denomination / Tradition");
  syncField("phone", "Telephone");
  syncField("whatsapp", "WhatsApp");
  syncField("email", "Email Address");
  syncField("location", "Current Location", ["residence"]);
  syncField("narrative", "Historical Location", ["historicalLocation", "biography"]);

  const isDeceased =
    copy.deceased === true ||
    copy.deceased === "true" ||
    String(copy.deceased || "").trim().toLowerCase() === "deceased";
  copy.deceased = isDeceased;
  copy["Life Status"] = isDeceased ? "Deceased" : "Living";

  return copy;
}

// Global serialized Google Sheets request chain to prevent Apps Script LockService.getScriptLock() contention
let googleSheetsSerialChain: Promise<any> = Promise.resolve();
const pendingGoogleSheetsBatch = new Map<string, any>();
let pendingGoogleSheetsFlushTimer: ReturnType<typeof setTimeout> | null = null;
let activeSheetWriteTasks = 0;
let lastSheetWriteCompletedAt = 0;

// Grace window after any App -> Sheet write/delete completes before Sheet -> App background sync reads again
const SHEET_WRITE_COOLDOWN_MS = 25000;

export function markSheetWriteActivity() {
  lastSheetWriteCompletedAt = Date.now();
}

export function hasPendingGoogleSheetsSync(): boolean {
  if (activeSheetWriteTasks > 0) return true;
  if (pendingGoogleSheetsBatch.size > 0) return true;
  if (pendingGoogleSheetsFlushTimer !== null) return true;
  if (lastSheetWriteCompletedAt > 0 && Date.now() - lastSheetWriteCompletedAt < SHEET_WRITE_COOLDOWN_MS) {
    return true;
  }
  return false;
}

export function runSerializedGoogleSheetsTask<T>(task: () => Promise<T>): Promise<T> {
  activeSheetWriteTasks++;
  const wrappedTask = async () => {
    try {
      return await task();
    } finally {
      activeSheetWriteTasks = Math.max(0, activeSheetWriteTasks - 1);
      lastSheetWriteCompletedAt = Date.now();
    }
  };
  const next = googleSheetsSerialChain.then(wrappedTask, wrappedTask);
  googleSheetsSerialChain = next.catch(() => {});
  return next;
}

function isRetryableSheetError(status: number, errMsg: string): boolean {
  if (status === 429 || status >= 500) return true;
  const lower = String(errMsg || "").toLowerCase();
  return (
    lower.includes("lock timeout") ||
    lower.includes("server busy") ||
    lower.includes("too many") ||
    lower.includes("service invoked too many") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("rate limit") ||
    lower.includes("exceeded") ||
    lower.includes("timed out") ||
    lower.includes("abort")
  );
}

export async function postToGoogleSheetsWithRetry(
  targetUrl: string,
  payload: any,
  maxAttempts = 3
): Promise<{ ok: boolean; status: number; text: string; parsed: any; errorMessage?: string }> {
  let lastResult: { ok: boolean; status: number; text: string; parsed: any; errorMessage?: string } = {
    ok: false,
    status: 0,
    text: "",
    parsed: null,
    errorMessage: "Unknown error",
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const resp = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const text = await resp.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch (e) {}

      const remoteFailed = Boolean(parsed && (parsed.result === "error" || parsed.error));
      const detail = parsed
        ? String(parsed.error || parsed.message || parsed.details || parsed.result || "").trim()
        : resp.ok
          ? ""
          : `HTTP ${resp.status}`;

      if (resp.ok && !remoteFailed) {
        return { ok: true, status: resp.status, text, parsed };
      }

      lastResult = { ok: false, status: resp.status, text, parsed, errorMessage: detail || `HTTP ${resp.status}` };

      if (attempt < maxAttempts && isRetryableSheetError(resp.status, detail)) {
        const delayMs = 2500 * attempt;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return lastResult;
    } catch (err: any) {
      clearTimeout(timeout);
      const errMsg = err?.message || String(err);
      lastResult = { ok: false, status: 0, text: "", parsed: null, errorMessage: errMsg };
      if (attempt < maxAttempts) {
        const delayMs = 2500 * attempt;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return lastResult;
    }
  }

  return lastResult;
}

async function flushPendingGoogleSheetsBatch() {
  pendingGoogleSheetsFlushTimer = null;
  if (pendingGoogleSheetsBatch.size === 0) return;

  const batchItems = Array.from(pendingGoogleSheetsBatch.values());
  pendingGoogleSheetsBatch.clear();

  const targetUrl = normalizeTargetUrl(getConfiguredSheetsWebAppUrl());
  if (!targetUrl) return;

  const payload = batchItems.length === 1 ? batchItems[0] : batchItems;

  await runSerializedGoogleSheetsTask(async () => {
    const outcome = await postToGoogleSheetsWithRetry(targetUrl, payload, 3);
    if (!outcome.ok) {
      console.warn(
        `[GoogleSheets Forward Push Notice]: Remote sheet reported: ${outcome.errorMessage || "unknown error"}`
      );
    } else {
      // Apps Script v5.0 can assign a temporary CLAN-series ID on initial appendRow;
      // a follow-up update pass locks the exact canonical Member ID into Column A.
      if (Number(outcome.parsed?.added || 0) > 0) {
        await postToGoogleSheetsWithRetry(targetUrl, payload, 2);
      }
      console.log(
        `[GoogleSheets Forward Push] Synced ${batchItems.length} member(s) cleanly (status: ${outcome.status})`
      );
    }
  });
}

export async function syncMemberToGoogleSheets(members: any | any[]) {
  if (!members) return;
  try {
    const list = Array.isArray(members) ? members : [members];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const formatted = formatMemberForSheets(item);
      const key = String(formatted.id || formatted.recordId || Math.random());
      pendingGoogleSheetsBatch.set(key, formatted);
    }

    if (pendingGoogleSheetsBatch.size === 0) return;

    // Coalesce bursts of saves (e.g. bidirectional sibling updates or ID write-backs) into a single serialized batch request
    if (pendingGoogleSheetsFlushTimer) {
      clearTimeout(pendingGoogleSheetsFlushTimer);
    }
    pendingGoogleSheetsFlushTimer = setTimeout(() => {
      flushPendingGoogleSheetsBatch().catch((err) => {
        console.warn(`[syncMemberToGoogleSheets] Flush notice:`, err?.message || err);
      });
    }, 350);
  } catch (err: any) {
    console.warn(`[syncMemberToGoogleSheets] Notice:`, err.message || err);
  }
}

export async function flushGoogleSheetsQueueNow() {
  if (pendingGoogleSheetsFlushTimer) {
    clearTimeout(pendingGoogleSheetsFlushTimer);
    pendingGoogleSheetsFlushTimer = null;
  }
  await flushPendingGoogleSheetsBatch();
}

export async function syncMemberToGoogleSheetsImmediate(
  members: any | any[]
): Promise<{ ok: boolean; status: number; errorMessage?: string; parsed?: any; count: number }> {
  if (!members) {
    return { ok: false, status: 0, errorMessage: "No member payload supplied", count: 0 };
  }
  try {
    const rawList = Array.isArray(members) ? members : [members];
    const formattedList: any[] = [];
    const seenKeys = new Set<string>();

    for (const item of rawList) {
      if (!item || typeof item !== "object") continue;
      const formatted = formatMemberForSheets(item);
      const key = String(formatted.id || formatted.recordId || "").trim();
      if (key) {
        // Remove any stale queued copy so we don't double-push
        pendingGoogleSheetsBatch.delete(key);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
      }
      formattedList.push(formatted);
    }

    if (formattedList.length === 0) {
      return { ok: false, status: 0, errorMessage: "No valid member records to sync", count: 0 };
    }

    const targetUrl = normalizeTargetUrl(getConfiguredSheetsWebAppUrl());
    if (!targetUrl) {
      return { ok: false, status: 0, errorMessage: "No Google Sheets Web App URL configured", count: 0 };
    }

    const payload = formattedList.length === 1 ? formattedList[0] : formattedList;
    markSheetWriteActivity();

    const outcome = await runSerializedGoogleSheetsTask(async () => {
      const res = await postToGoogleSheetsWithRetry(targetUrl, payload, 3);
      if (!res.ok) {
        console.warn(
          `[GoogleSheets Immediate Sync Notice]: Remote sheet reported: ${res.errorMessage || "unknown error"}`
        );
      } else {
        // Apps Script v5.0 can assign a temporary CLAN-series ID on initial appendRow;
        // an immediate follow-up update pass locks our exact canonical Member ID into Column A.
        if (Number(res.parsed?.added || 0) > 0) {
          await postToGoogleSheetsWithRetry(targetUrl, payload, 2);
        }
        console.log(
          `[GoogleSheets Immediate Sync] Persisted ${formattedList.length} member(s) immediately (status: ${res.status})`
        );
      }
      return res;
    });

    return {
      ok: outcome.ok,
      status: outcome.status,
      errorMessage: outcome.errorMessage,
      parsed: outcome.parsed,
      count: formattedList.length,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.warn(`[syncMemberToGoogleSheetsImmediate] Error:`, msg);
    return { ok: false, status: 0, errorMessage: msg, count: 0 };
  }
}

export function buildPerMemberDeletePayloads(deletedMembers: any[]): {
  perMemberPayloads: any[];
  uniqueIds: string[];
  allNames: string[];
  confirmedRecordIds: string[];
} {
  const perMemberPayloads: any[] = [];
  const allIdsToDelete: string[] = [];
  const allNamesToDelete: string[] = [];
  const confirmedRecordIds: string[] = [];

  for (const record of deletedMembers) {
    if (!record) continue;
    const memberId = String(record.id || record.recordId || record["Member ID"] || "").trim();
    const recordId = String(record.recordId || record.id || record["Member ID"] || "").trim();
    const cnum = String(
      record.clanMemberNumber || record.clan_member_number || record["Clan Member Number"] || ""
    ).trim();
    const email = String(record.email || record["Email Address"] || "").trim();
    const firstName = String(record.firstName || record.first_name || record["First Name"] || "").trim();
    const middleName = String(record.middleName || record.middle_name || record["Middle Name"] || "").trim();
    const lastName = String(record.lastName || record.last_name || record["Last Name"] || "").trim();
    const fullName = `${firstName} ${middleName} ${lastName}`.replace(/\s+/g, " ").trim();
    const simpleFullName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();

    const itemIds: string[] = [];
    // IMPORTANT: Keep ALL valid memberId/recordId values including rec_ and rec- IDs!
    if (memberId) {
      itemIds.push(memberId);
      allIdsToDelete.push(memberId);
      confirmedRecordIds.push(memberId);
    }
    if (recordId && recordId !== memberId) {
      itemIds.push(recordId);
      allIdsToDelete.push(recordId);
    }
    if (cnum) {
      itemIds.push(cnum);
      allIdsToDelete.push(cnum);
    }
    if (email) {
      itemIds.push(email);
      allIdsToDelete.push(email);
    }
    if (fullName && fullName.length > 1) {
      itemIds.push(fullName);
      allIdsToDelete.push(fullName);
      allNamesToDelete.push(fullName);
    }
    if (simpleFullName && simpleFullName.length > 1 && simpleFullName !== fullName) {
      itemIds.push(simpleFullName);
      allIdsToDelete.push(simpleFullName);
      allNamesToDelete.push(simpleFullName);
    }
    if (firstName && lastName) {
      const snake = `${firstName.toLowerCase()}_${lastName.toLowerCase()}`;
      itemIds.push(snake);
      allIdsToDelete.push(snake);
    }
    if (firstName && !lastName && !middleName) {
      itemIds.push(firstName);
      allIdsToDelete.push(firstName);
      allNamesToDelete.push(firstName);
    }

    const dedupItemIds = Array.from(new Set(itemIds)).filter(Boolean);
    if (dedupItemIds.length === 0) continue;

    // Remove any pending queued upsert for this member so we never re-push a deleted member!
    if (memberId) pendingGoogleSheetsBatch.delete(memberId);
    if (recordId) pendingGoogleSheetsBatch.delete(recordId);

    perMemberPayloads.push({
      action: "delete",
      id: memberId || recordId || cnum || email || fullName || firstName,
      recordId: recordId || memberId,
      clanMemberNumber: cnum,
      email,
      firstName,
      middleName,
      lastName,
      name: fullName || simpleFullName || firstName,
      ids: dedupItemIds,
      names: Array.from(new Set([fullName, simpleFullName, firstName && !lastName ? firstName : ""].filter(Boolean))),
      timestamp: new Date().toISOString(),
    });
  }

  return {
    perMemberPayloads,
    uniqueIds: Array.from(new Set(allIdsToDelete)).filter(Boolean),
    allNames: Array.from(new Set(allNamesToDelete)).filter(Boolean),
    confirmedRecordIds: Array.from(new Set(confirmedRecordIds)).filter(Boolean),
  };
}

export async function syncDeletionToGoogleSheets(
  deletedMembers: any[],
  onConfirmed?: (confirmedIds: string[]) => void
): Promise<{ ok: boolean; deletedCount?: number; errorMessage?: string }> {
  if (!Array.isArray(deletedMembers) || deletedMembers.length === 0) {
    return { ok: true, deletedCount: 0 };
  }
  try {
    const targetUrl = normalizeTargetUrl(getConfiguredSheetsWebAppUrl());
    if (!targetUrl) return { ok: false, errorMessage: "No webAppUrl configured" };

    const { perMemberPayloads, uniqueIds, confirmedRecordIds } = buildPerMemberDeletePayloads(deletedMembers);
    if (perMemberPayloads.length === 0) return { ok: true, deletedCount: 0 };

    return await runSerializedGoogleSheetsTask(async () => {
      // Send array of per-member delete objects so Apps Script doPost matches every member by ID, Clan No, Email, AND First/Last/Single Name
      const postBody = perMemberPayloads.length === 1 ? perMemberPayloads[0] : perMemberPayloads;
      const postOutcome = await postToGoogleSheetsWithRetry(targetUrl, postBody, 3);

      if (postOutcome.ok) {
        const deletedNum = Number(postOutcome.parsed?.deleted ?? postOutcome.parsed?.count ?? 0);
        console.log(
          `[GoogleSheets Forward Delete] Completed cleanly for ${perMemberPayloads.length} member(s) (sheet deleted=${deletedNum})`
        );
        if (onConfirmed && confirmedRecordIds.length > 0) {
          try {
            onConfirmed(confirmedRecordIds);
          } catch (e) {}
        }
        return { ok: true, deletedCount: deletedNum };
      }

      // Fallback GET delete if POST was rejected
      console.warn(
        `[GoogleSheets Forward Delete POST Notice]: ${postOutcome.errorMessage || "POST failed"}, attempting serialized GET fallback...`
      );
      const firstItem = perMemberPayloads[0];
      const params = new URLSearchParams();
      params.set("action", "delete");
      params.set("ids", uniqueIds.join(","));
      params.set("id", uniqueIds.join(","));
      if (firstItem.firstName) params.set("firstName", firstItem.firstName);
      if (firstItem.lastName) params.set("lastName", firstItem.lastName);
      if (firstItem.email) params.set("email", firstItem.email);
      if (firstItem.clanMemberNumber) params.set("clanMemberNumber", firstItem.clanMemberNumber);

      const sep = targetUrl.includes("?") ? "&" : "?";
      const getUrl = `${targetUrl}${sep}${params.toString()}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      try {
        const getResp = await fetch(getUrl, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const getTxt = await getResp.text();
        let parsedGet: any = null;
        try {
          parsedGet = JSON.parse(getTxt);
        } catch (e) {}
        const getFailed = Boolean(parsedGet && (parsedGet.result === "error" || parsedGet.error));
        if (getResp.ok && !getFailed) {
          console.log(`[GoogleSheets Forward Delete GET Fallback] Completed cleanly`);
          if (onConfirmed && confirmedRecordIds.length > 0) {
            try {
              onConfirmed(confirmedRecordIds);
            } catch (e) {}
          }
          return { ok: true, deletedCount: Number(parsedGet?.deleted ?? parsedGet?.count ?? 0) };
        }
        return {
          ok: false,
          errorMessage: parsedGet?.error || parsedGet?.result || `HTTP ${getResp.status}`,
        };
      } catch (getErr: any) {
        clearTimeout(timeout);
        console.warn(`[GoogleSheets Forward Delete GET Fallback Notice]:`, getErr?.message || getErr);
        return { ok: false, errorMessage: getErr?.message || String(getErr) };
      }
    });
  } catch (err: any) {
    console.warn(`[syncDeletionToGoogleSheets] Notice:`, err?.message || err);
    return { ok: false, errorMessage: err?.message || String(err) };
  }
}

export async function executeDirectSheetsDelete(
  webAppUrl: string,
  params: {
    id?: string;
    email?: string;
    clanMemberNumber?: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    name?: string;
    names?: string[];
    ids?: string[];
    action?: string;
  }
) {
  const targetUrl = normalizeTargetUrl(webAppUrl);
  const act = params.action || "delete";
  const allIds = Array.isArray(params.ids) && params.ids.length > 0
    ? params.ids.map((s) => String(s || "").trim()).filter(Boolean)
    : [params.id, params.clanMemberNumber, params.email, params.name, params.firstName, params.lastName]
        .map((s) => String(s || "").trim())
        .filter(Boolean);

  if (params.id && !allIds.includes(String(params.id).trim())) {
    allIds.unshift(String(params.id).trim());
  }

  const joinedIds = Array.from(new Set(allIds)).join(",");
  const payload = {
    action: act,
    id: String(params.id || joinedIds || params.name || params.firstName || params.clanMemberNumber || params.email || "").trim(),
    clanMemberNumber: String(params.clanMemberNumber || "").trim(),
    email: String(params.email || "").trim(),
    firstName: String(params.firstName || "").trim(),
    middleName: String(params.middleName || "").trim(),
    lastName: String(params.lastName || "").trim(),
    name: String(params.name || `${params.firstName || ""} ${params.lastName || ""}`.trim()).trim(),
    names: Array.isArray(params.names) ? params.names : params.name ? [params.name] : [],
    ids: Array.from(new Set(allIds)),
    count: allIds.length,
  };

  return await runSerializedGoogleSheetsTask(async () => {
    const postOutcome = await postToGoogleSheetsWithRetry(targetUrl, payload, 3);
    if (postOutcome.ok) {
      return { ok: true, text: postOutcome.text, parsed: postOutcome.parsed };
    }

    // Serialized GET fallback
    const qs = new URLSearchParams();
    qs.set("action", act);
    if (joinedIds) {
      qs.set("id", joinedIds);
      qs.set("ids", joinedIds);
    }
    if (payload.clanMemberNumber) qs.set("clanMemberNumber", payload.clanMemberNumber);
    if (payload.email) qs.set("email", payload.email);
    if (payload.firstName) qs.set("firstName", payload.firstName);
    if (payload.lastName) qs.set("lastName", payload.lastName);
    if (payload.name) qs.set("name", payload.name);

    const sep = targetUrl.includes("?") ? "&" : "?";
    const getUrl = `${targetUrl}${sep}${qs.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const getResp = await fetch(getUrl, { method: "GET", redirect: "follow", signal: controller.signal });
      clearTimeout(timeout);
      const text = await getResp.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch (e) {}
      const remoteFailed = Boolean(parsed && (parsed.result === "error" || parsed.error));
      return {
        ok: getResp.ok && !remoteFailed,
        text,
        parsed,
        errorMessage: remoteFailed ? parsed.error || parsed.result : postOutcome.errorMessage,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      return { ok: false, text: "", parsed: null, errorMessage: err?.message || postOutcome.errorMessage };
    }
  });
}
