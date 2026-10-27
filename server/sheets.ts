import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { dbEngine, isMemberIdDeleted, ClanMemberRecord } from "./db";
import { syncManager } from "./sync";

const spreadsheetConfigFile = path.resolve(process.cwd(), "data/spreadsheet_config.json");

let lastSheetSyncSignature = "";

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

export function mapRowToClanMember(raw: Record<string, any>, index: number): Record<string, any> | null {
  if (!raw || typeof raw !== "object") return null;

  const id = extractRawField(raw, ["Member ID", "id", "recordId", "memberId", "Record ID"]);
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
  const hasName = Boolean(firstName || middleName || lastName);
  if (!hasName) {
    return null;
  }

  const rawDeceased = extractRawField(raw, ["Life Status", "deceased", "status", "Status"]);
  const isDeceased = String(rawDeceased).trim().toLowerCase() === "deceased" || rawDeceased === "true" || rawDeceased === "1";

  let siblingIds: any = raw["Sibling Profiles"] || raw.siblingIds || raw.siblings || raw["Siblings"] || [];
  if (typeof siblingIds === "string") {
    siblingIds = siblingIds.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean);
  } else if (!Array.isArray(siblingIds)) {
    siblingIds = [];
  }

  const resolvedId = (id && !id.startsWith("sheet_") && !id.includes(" ")) ? id : (clanMemberNumber ? `rec-clan-${clanMemberNumber}` : `rec_${(firstName || "member").toLowerCase()}_${(lastName || "single").toLowerCase()}_${index}`.replace(/[^a-z0-9_]/g, "_"));

  function extractRelationId(val: any): string {
    if (!val) return "";
    const s = String(val).trim();
    const match = s.match(/\[([^\]]+)\]/);
    if (match && match[1]) return match[1].trim();
    return s;
  }

  return {
    id: resolvedId,
    recordId: resolvedId,
    clanMemberNumber: clanMemberNumber,
    firstName: firstName,
    middleName: middleName,
    lastName: lastName,
    sex: extractRawField(raw, ["Sex", "sex", "gender", "Gender"]) || "Not Recorded",
    branchType: extractRawField(raw, ["Family Clan", "branchType", "clan", "branch", "Branch", "Clan"]) || "heritage",
    honorific: extractRawField(raw, ["Title / Honorific", "honorific", "title", "Title"]),
    dob: extractRawField(raw, ["Date of Birth", "dob", "birthDate", "born", "Birth Date"]),
    birthPeriod: extractRawField(raw, ["Historical Age", "birthPeriod", "period", "Age Category"]),
    placeOfBirth: extractRawField(raw, ["Place of Birth", "placeOfBirth", "birthPlace"]),
    deceased: isDeceased,
    dod: extractRawField(raw, ["Date of Death", "dod", "deathDate"]),
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

export async function serverSyncSheetToApp() {
  try {
    let url = "https://script.google.com/macros/s/AKfycbyLlYZ3pw4-5ENtn_wf6tInqNRAPmHCdDmzJx40g2hUPNVyK3XOcleP9_MaGqktg6V2/exec";
    if (fs.existsSync(spreadsheetConfigFile)) {
      try {
        const config = JSON.parse(fs.readFileSync(spreadsheetConfigFile, "utf-8"));
        url = config.webAppUrl || config.spreadsheetId || url;
      } catch (e) {}
    }
    if (!url) return;

    let rawRecords: Record<string, any>[] = [];

    if (url.includes("script.google.com/macros/s/")) {
      // Direct Google Apps Script Web App JSON Endpoint
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      try {
        const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) return;
        const json: any = await resp.json();
        if (Array.isArray(json)) {
          rawRecords = json;
        } else if (json && Array.isArray(json.members)) {
          rawRecords = json.members;
        } else if (json && Array.isArray(json.data)) {
          rawRecords = json.data;
        }
      } catch (e) {
        clearTimeout(timeout);
        return;
      }
    } else if (url.includes("docs.google.com/spreadsheets")) {
      // Google Sheets GViz or CSV export endpoint
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

    if (!Array.isArray(rawRecords) || rawRecords.length === 0) return;

    // Filter and normalize members, excluding deleted ones
    const validMembers: Record<string, any>[] = [];
    rawRecords.forEach((row, idx) => {
      const mapped = mapRowToClanMember(row, idx);
      if (mapped) {
        if (!isMemberIdDeleted(mapped.id, mapped.clanMemberNumber, mapped.email, mapped.firstName, mapped.lastName)) {
          validMembers.push(mapped);
        }
      }
    });

    if (validMembers.length === 0) return;

    // Hash check: Only sync if data has actually changed to save bandwidth and prevent UI jitter
    const hash = crypto.createHash("sha256").update(JSON.stringify(validMembers)).digest("hex");
    if (hash === lastSheetSyncSignature) {
      return; // No changes detected
    }

    // 1. Detect members removed/deleted from the Google Sheet
    const currentActiveMembers = await dbEngine.getMembers(false);
    if (currentActiveMembers.length > 0 && validMembers.length > 0) {
      const sheetIdentSet = new Set<string>();
      validMembers.forEach((m) => {
        if (m.id) sheetIdentSet.add(String(m.id).toLowerCase().trim());
        if (m.recordId) sheetIdentSet.add(String(m.recordId).toLowerCase().trim());
        if (m.clanMemberNumber) sheetIdentSet.add(String(m.clanMemberNumber).toLowerCase().trim());
        if (m.email) sheetIdentSet.add(String(m.email).toLowerCase().trim());
        if (m.firstName) {
          const fn = String(m.firstName).toLowerCase().trim();
          const mn = String(m.middleName || "").toLowerCase().trim();
          const ln = String(m.lastName || "").toLowerCase().trim();
          if (fn && ln) sheetIdentSet.add(`name:${fn}_${ln}`);
          if (fn && mn && ln) sheetIdentSet.add(`name:${fn}_${mn}_${ln}`);
          if (fn && !mn && !ln) sheetIdentSet.add(`only_fn:${fn}`);
        }
      });

      const deletedFromSheet: ClanMemberRecord[] = [];
      const now = Date.now();
      currentActiveMembers.forEach((dbm) => {
        const dbId = String(dbm.id || dbm.recordId || "").toLowerCase().trim();
        const dbClan = String(dbm.clanMemberNumber || "").toLowerCase().trim();
        const dbEmail = String(dbm.email || "").toLowerCase().trim();
        const dbFn = String(dbm.firstName || "").toLowerCase().trim();
        const dbMn = String(dbm.middleName || "").toLowerCase().trim();
        const dbLn = String(dbm.lastName || "").toLowerCase().trim();
        const dbName1 = (dbFn && dbLn) ? `name:${dbFn}_${dbLn}` : "";
        const dbName2 = (dbFn && dbMn && dbLn) ? `name:${dbFn}_${dbMn}_${dbLn}` : "";
        const dbOnlyFn = (dbFn && !dbMn && !dbLn) ? `only_fn:${dbFn}` : "";

        const inSheet = (dbId && sheetIdentSet.has(dbId)) ||
                        (dbClan && sheetIdentSet.has(dbClan)) ||
                        (dbEmail && sheetIdentSet.has(dbEmail)) ||
                        (dbName1 && sheetIdentSet.has(dbName1)) ||
                        (dbName2 && sheetIdentSet.has(dbName2)) ||
                        (dbOnlyFn && sheetIdentSet.has(dbOnlyFn));

        if (!inSheet) {
          deletedFromSheet.push(dbm);
        }
      });

      // Safeguard: auto-purge if removed count is <= 40% of database to protect against corrupted partial fetches
      if (deletedFromSheet.length > 0 && deletedFromSheet.length <= currentActiveMembers.length * 0.4) {
        console.log(`[ServerSync] Detected ${deletedFromSheet.length} member(s) deleted from Google Sheets. Purging from DB and broadcasting to all browsers...`);
        const deletedIds = deletedFromSheet.map((m) => m.id);
        for (const dm of deletedFromSheet) {
          await dbEngine.permanentDeleteMember(dm.id, "google_sheets_sync");
        }

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

    const result = await dbEngine.importMembersBatch(validMembers, "server_autosync");
    lastSheetSyncSignature = hash;

    // Broadcast updated active records to all connected browsers
    const allActiveNow = await dbEngine.getMembers(false);
    syncManager.broadcast("doc_change", {
      action: "SET",
      collection: "members",
      records: allActiveNow,
      timestamp: new Date().toISOString(),
    });

    console.log(`[ServerSync] Synced ${result.added} new, ${result.updated} updated. Total active members: ${allActiveNow.length}.`);
  } catch (e) {
    console.warn("[ServerSync] Background sync notice:", (e as any)?.message || e);
  }
}

// Continuous 3-second background sync loop to detect Google Sheets additions, edits, and deletions
let isServerSheetSyncActive = false;
setInterval(async () => {
  if (isServerSheetSyncActive) return;
  isServerSheetSyncActive = true;
  try {
    await serverSyncSheetToApp();
  } catch (err) {
    // quiet catch
  } finally {
    isServerSheetSyncActive = false;
  }
}, 3000);
