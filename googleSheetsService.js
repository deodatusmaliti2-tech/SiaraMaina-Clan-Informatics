/**
 * Google Sheets Database Engine for SiaraMaina Clan Informatics
 * 
 * Implements Google Sheets as the authoritative cloud database backend,
 * powered by Firebase Google Auth / OAuth 2.0 access token delegation,
 * with graceful public sheet reading fallback and robust error reporting.
 * 
 * Scopes:
 * - https://www.googleapis.com/auth/spreadsheets
 * - https://www.googleapis.com/auth/drive.file
 */

(function(global) {
  'use strict';

  // In-memory token cache (NEVER persisted to localStorage/sessionStorage per Workspace security guidelines)
  var cachedAccessToken = null;
  var SPREADSHEET_ID_STORAGE_KEY = 'siara_google_sheets_db_id';
  var SPREADSHEET_TITLE_STORAGE_KEY = 'siara_google_sheets_db_title';
  var AUTO_SYNC_STORAGE_KEY = 'siara_google_sheets_auto_sync';

  // Standard Column Schema for Clan Records in Google Sheets
  var CLAN_SHEET_HEADERS = [
    'id',
    'clanMemberNumber',
    'firstName',
    'middleName',
    'lastName',
    'sex',
    'branchType',
    'honorific',
    'dob',
    'birthPeriod',
    'placeOfBirth',
    'deceased',
    'dod',
    'deathAge',
    'causeOfDeath',
    'fatherId',
    'motherId',
    'spouseId',
    'siblingIds',
    'maritalStatus',
    'education',
    'course',
    'employment',
    'occupation',
    'organization',
    'religion',
    'denomination',
    'phone',
    'whatsapp',
    'email',
    'location',
    'photo',
    'narrative',
    'updatedAt',
    'updatedBy'
  ];

  var GoogleSheetsDB = {
    HEADERS: CLAN_SHEET_HEADERS,

    // Token Management (In-Memory Only)
    setAccessToken: function(token) {
      cachedAccessToken = token ? String(token).trim() : null;
      if (typeof window !== 'undefined') {
        window.cachedGoogleAccessToken = cachedAccessToken;
        try {
          window.dispatchEvent(new CustomEvent('google-sheets-token-changed', {
            detail: { hasToken: !!cachedAccessToken }
          }));
        } catch (e) {}
      }
    },

    getAccessToken: function() {
      if (cachedAccessToken) return cachedAccessToken;
      if (typeof window !== 'undefined' && window.cachedGoogleAccessToken) {
        return window.cachedGoogleAccessToken;
      }
      return "";
    },

    clearAccessToken: function() {
      cachedAccessToken = null;
      if (typeof window !== 'undefined') {
        window.cachedGoogleAccessToken = null;
      }
    },

    hasAccessToken: function() {
      return !!this.getAccessToken();
    },

    // Spreadsheet Identifier Persistence (Safe non-secret identifier)
    getConnectedSheetId: function() {
      try {
        var id = localStorage.getItem(SPREADSHEET_ID_STORAGE_KEY) || '';
        if (id === "1SiaraMainaClanInformaticsMasterDatabase2026") return '';
        return id;
      } catch (e) {
        return '';
      }
    },

    setConnectedSheetId: function(id, title) {
      try {
        if (id && id.trim() !== "1SiaraMainaClanInformaticsMasterDatabase2026") {
          localStorage.setItem(SPREADSHEET_ID_STORAGE_KEY, id.trim());
          if (title) localStorage.setItem(SPREADSHEET_TITLE_STORAGE_KEY, title.trim());
          try {
            fetch("/api/db/spreadsheet", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ spreadsheetId: id.trim(), spreadsheetTitle: (title || "").trim() })
            }).catch(function() {});
          } catch(e) {}
        } else {
          localStorage.removeItem(SPREADSHEET_ID_STORAGE_KEY);
          localStorage.removeItem(SPREADSHEET_TITLE_STORAGE_KEY);
        }
      } catch (e) {}
    },

    getConnectedSheetTitle: function() {
      try {
        return localStorage.getItem(SPREADSHEET_TITLE_STORAGE_KEY) || 'SiaraMaina Clan Database';
      } catch (e) {
        return 'SiaraMaina Clan Database';
      }
    },

    isAutoSyncEnabled: function() {
      try {
        return localStorage.getItem(AUTO_SYNC_STORAGE_KEY) === 'true';
      } catch (e) {
        return false;
      }
    },

    setAutoSyncEnabled: function(enabled) {
      try {
        localStorage.setItem(AUTO_SYNC_STORAGE_KEY, enabled ? 'true' : 'false');
      } catch (e) {}
    },

    isConnected: function() {
      return !!this.getConnectedSheetId();
    },

    // Google Sheets API Request Helper
    fetchApi: async function(url, options) {
      var token = this.getAccessToken();
      if (!token) {
        throw new Error('AUTH_REQUIRED: Please sign in with Google to access your Google Sheets database.');
      }

      options = options || {};
      options.headers = options.headers || {};
      options.headers['Authorization'] = 'Bearer ' + token;
      options.headers['Accept'] = 'application/json';

      var response = await fetch(url, options);

      if (response.status === 401) {
        this.clearAccessToken();
        throw new Error('TOKEN_EXPIRED: Your Google session has expired. Please click "Sign In with Google" again.');
      }

      if (!response.ok) {
        var errBody = null;
        try {
          errBody = await response.json();
        } catch (e) {
          try { errBody = await response.text(); } catch (e2) {}
        }
        var msg = (errBody && errBody.error && errBody.error.message) || ('HTTP ' + response.status + ' Error');
        throw new Error('Google Sheets API Error: ' + msg);
      }

      return await response.json();
    },

    // 1. Fetch Spreadsheet Metadata (Title, Available Tabs)
    getSpreadsheetMetadata: async function(spreadsheetId) {
      var id = spreadsheetId || this.getConnectedSheetId();
      if (!id) throw new Error('No Google Spreadsheet connected.');

      var token = this.getAccessToken();
      if (token) {
        try {
          var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id) + '?fields=spreadsheetId,properties.title,sheets.properties';
          return await this.fetchApi(url);
        } catch (authErr) {
          // If token failed or expired, fall back to public probe
          console.warn('OAuth metadata query failed, attempting public check:', authErr);
        }
      }

      // Public probe fallback
      try {
        var probeUrl = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id) + '/gviz/tq?tqx=out:json';
        var resp = await fetch(probeUrl);
        if (resp.ok) {
          var txt = await resp.text();
          var jsonStr = txt.replace(/^\/\*[\s\S]*?\*\/\s*/, '').replace(/^[a-zA-Z0-9_.]+\(/, '').replace(/\);?\s*$/, '');
          var parsed = JSON.parse(jsonStr);
          return {
            spreadsheetId: id,
            properties: { title: this.getConnectedSheetTitle() || ('Google Sheet (' + id.slice(0, 8) + '...)') },
            sheets: [{ properties: { title: 'Members' } }]
          };
        }
      } catch (probeErr) {}

      // If we already have stored title, return mock metadata structure
      return {
        spreadsheetId: id,
        properties: { title: this.getConnectedSheetTitle() || 'Connected Google Sheet' },
        sheets: [{ properties: { title: 'Members' } }]
      };
    },

    // 2. Discover or Verify "Members" Sheet Tab
    getMembersTabName: async function(spreadsheetId) {
      try {
        var meta = await this.getSpreadsheetMetadata(spreadsheetId);
        var sheets = (meta && meta.sheets) || [];
        if (!sheets.length) return 'Members';

        // Look for a tab named "Members" or "Records" or "ClanMembers"
        for (var i = 0; i < sheets.length; i++) {
          var t = sheets[i].properties && sheets[i].properties.title;
          if (t && (t.toLowerCase() === 'members' || t.toLowerCase() === 'clan members' || t.toLowerCase() === 'records')) {
            return t;
          }
        }
        return sheets[0].properties.title || 'Members';
      } catch (e) {
        return 'Members';
      }
    },

    // 3. Create a Brand New Database Spreadsheet in User's Google Drive
    createClanSpreadsheet: async function(title, initialRecords) {
      // Prevent duplicate sheets across browsers: Check if server already has a shared Master Spreadsheet ID
      try {
        var resp = await fetch("/api/db/spreadsheet");
        if (resp.ok) {
          var serverData = await resp.json();
          if (serverData && serverData.spreadsheetId && serverData.spreadsheetId !== "1SiaraMainaClanInformaticsMasterDatabase2026" && !serverData.spreadsheetId.includes("MasterDatabase")) {
            var existingId = serverData.spreadsheetId.trim();
            var existingTitle = serverData.spreadsheetTitle || "SiaraMaina Clan Informatics - Master Database";
            this.setConnectedSheetId(existingId, existingTitle);
            return {
              spreadsheetId: existingId,
              title: existingTitle,
              url: "https://docs.google.com/spreadsheets/d/" + existingId + "/edit",
              recordsCount: 0,
              isExisting: true
            };
          }
        }
      } catch (e) {}

      var docTitle = title || ('SiaraMaina Clan Informatics - Master Database (' + new Date().getFullYear() + ')');
      var url = 'https://sheets.googleapis.com/v4/spreadsheets';
      
      var createPayload = {
        properties: {
          title: docTitle
        },
        sheets: [
          {
            properties: {
              title: 'Members',
              gridProperties: {
                frozenRowCount: 1
              }
            }
          },
          {
            properties: {
              title: 'AuditLogs',
              gridProperties: {
                frozenRowCount: 1
              }
            }
          },
          {
            properties: {
              title: 'DatabaseMetadata'
            }
          }
        ]
      };

      var sheetResult = await this.fetchApi(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload)
      });

      var newId = sheetResult.spreadsheetId;
      var newTitle = (sheetResult.properties && sheetResult.properties.title) || docTitle;

      this.setConnectedSheetId(newId, newTitle);

      // Write headers to AuditLogs tab
      try {
        var auditUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(newId) + '/values/AuditLogs!A1?valueInputOption=USER_ENTERED';
        await this.fetchApi(auditUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            range: 'AuditLogs!A1',
            majorDimension: 'ROWS',
            values: [['Timestamp', 'Action', 'Details', 'ActorEmail', 'ActorUID']]
          })
        });
      } catch (e) {
        console.warn('AuditLogs tab header init notice:', e);
      }

      // Populate Members tab with headers + initialRecords if provided
      var recordsToWrite = Array.isArray(initialRecords) ? initialRecords : [];
      await this.writeAllMembers(newId, 'Members', recordsToWrite, false);

      return {
        spreadsheetId: newId,
        title: newTitle,
        url: 'https://docs.google.com/spreadsheets/d/' + newId + '/edit',
        recordsCount: recordsToWrite.length
      };
    },

    // 4. Read All Members from Google Sheet (supports both authenticated API & public sheet queries)
    readAllMembers: async function(spreadsheetId) {
      var id = spreadsheetId || this.getConnectedSheetId();

      function normalizeSheetRow(raw, index) {
        if (!raw) return null;
        var fn = String(raw["First Name"] || raw.firstName || raw["Given Name"] || raw.fname || "").trim();
        var ln = String(raw["Last Name"] || raw.lastName || raw["Surname"] || raw["Family Name"] || raw.lname || "").trim();
        var cNum = String(raw["Clan Member Number"] || raw.clanMemberNumber || raw["Member Number"] || raw["Reg No"] || "").trim();
        var em = String(raw["Email Address"] || raw.email || raw["E-mail"] || raw["Mail"] || "").trim();
        var mId = String(raw["Member ID"] || raw.id || raw.recordId || "").trim();
        var ph = String(raw["Telephone"] || raw.phone || raw["Mobile"] || raw["Cell"] || "").trim();

        if (fn.toUpperCase() === "BY" && !ln && !cNum && !em) return null;
        if (!mId && !fn && !ln && !cNum && !em && !ph) return null;

        var isDec = String(raw["Life Status"] || raw.deceased || raw.status || "").toLowerCase() === "deceased" || raw.deceased === true || raw.deceased === "TRUE";
        var resolvedId = mId || (cNum ? "rec-clan-" + cNum : ("rec_" + (fn || "member") + "_" + (ln || "single") + "_" + (index || Date.now())).toLowerCase().replace(/[^a-z0-9_]/g, "_"));

        return {
          id: resolvedId,
          recordId: resolvedId,
          clanMemberNumber: cNum,
          firstName: fn,
          middleName: String(raw["Middle Name"] || raw.middleName || raw["Other Names"] || "").trim(),
          lastName: ln,
          sex: String(raw["Sex"] || raw.sex || raw["Gender"] || "Not Recorded").trim(),
          branchType: String(raw["Family Clan"] || raw.branchType || raw["Branch"] || raw["Clan Branch"] || "heritage").trim().toLowerCase(),
          honorific: String(raw["Title / Honorific"] || raw.honorific || raw["Title"] || "").trim(),
          dob: String(raw["Date of Birth"] || raw.dob || raw["Birth Date"] || "").trim(),
          birthPeriod: String(raw["Historical Age"] || raw.birthPeriod || "").trim(),
          placeOfBirth: String(raw["Place of Birth"] || raw.placeOfBirth || "").trim(),
          deceased: isDec,
          dod: String(raw["Date of Death"] || raw.dod || "").trim(),
          deathAge: String(raw["Age at Death"] || raw.deathAge || "").trim(),
          fatherId: (function(v) { var m = String(v || "").match(/\[([^\]]+)\]/); return m ? m[1].trim() : String(v || "").trim(); })(raw["Father Profile"] || raw.fatherId || raw.father),
          motherId: (function(v) { var m = String(v || "").match(/\[([^\]]+)\]/); return m ? m[1].trim() : String(v || "").trim(); })(raw["Mother Profile"] || raw.motherId || raw.mother),
          spouseId: (function(v) { var m = String(v || "").match(/\[([^\]]+)\]/); return m ? m[1].trim() : String(v || "").trim(); })(raw["Spouse Profile"] || raw.spouseId || raw.spouse),
          maritalStatus: String(raw["Marital Status"] || raw.maritalStatus || "").trim(),
          education: String(raw["Education Level"] || raw.education || "").trim(),
          course: String(raw["Course / Area of Study"] || raw.course || "").trim(),
          employment: String(raw["Employment Status"] || raw.employment || "").trim(),
          occupation: String(raw["Occupation / Profession"] || raw.occupation || "").trim(),
          organization: String(raw["Organisation / Employer"] || raw.organization || "").trim(),
          religion: String(raw["Religious Affiliation"] || raw.religion || "").trim(),
          denomination: String(raw["Denomination / Tradition"] || raw.denomination || "").trim(),
          phone: ph,
          whatsapp: String(raw["WhatsApp"] || raw.whatsapp || "").trim(),
          email: em,
          location: String(raw["Current Location"] || raw.location || raw["Address"] || "").trim(),
          narrative: String(raw["Historical Location"] || raw.narrative || raw["Notes"] || "").trim(),
          photo: String(raw["Photo"] || raw["Photo URL"] || raw["Image"] || raw.photo || raw.photoUrl || raw.photoFile || raw.image || "").trim()
        };
      }

      // 0. Direct Google Apps Script Web App Endpoint Support
      var webAppUrl = (id && id.includes('script.google.com')) ? id : this.getWebAppUrl();
      if (webAppUrl) {
        try {
          var resp = await fetch(webAppUrl);
          if (resp.ok) {
            var raw = await resp.json();
            var list = Array.isArray(raw) ? raw : (raw.members || raw.data || []);
            if (Array.isArray(list) && list.length > 0) {
              var membersFromWebApp = [];
              for (var wi = 0; wi < list.length; wi++) {
                var normalized = normalizeSheetRow(list[wi], wi);
                if (normalized) membersFromWebApp.push(normalized);
              }
              if (membersFromWebApp.length > 0) {
                return membersFromWebApp;
              }
            }
          }
        } catch(webAppErr) {
          console.warn("Direct Apps Script fetch notice:", webAppErr);
        }
      }

      if (!id) throw new Error('No Google Spreadsheet connected.');

      var token = this.getAccessToken();

      // If token is available, prefer official authenticated v4 API
      if (token) {
        try {
          var tabName = await this.getMembersTabName(id);
          var range = encodeURIComponent(tabName) + '!A1:AZ5000';
          var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id) + '/values/' + range;
          
          var data = await this.fetchApi(url);
          var rows = data.values || [];

          if (rows.length < 2) {
            return [];
          }

          var headerRow = rows[0].map(function(h) { return String(h || '').trim(); });
          var memberRecords = [];

          for (var r = 1; r < rows.length; r++) {
            var row = rows[r];
            if (!row || !row.length) continue;

            var rec = {};
            for (var c = 0; c < headerRow.length; c++) {
              var key = headerRow[c];
              if (!key) continue;
              rec[key] = row[c] !== undefined && row[c] !== null ? String(row[c]).trim() : '';
            }

            var normalizedRec = normalizeSheetRow(rec, r);
            if (normalizedRec) {
              if (rec.siblingIds) {
                try {
                  if (typeof rec.siblingIds === 'string' && rec.siblingIds.startsWith('[')) {
                    normalizedRec.siblingIds = JSON.parse(rec.siblingIds);
                  }
                } catch (e) {}
              }
              memberRecords.push(normalizedRec);
            }
          }

          if (memberRecords.length > 0) {
            return memberRecords;
          }
        } catch (apiErr) {
          console.warn('Authenticated Sheets API read notice:', apiErr && apiErr.message);
        }
      }

      // Public / GViz endpoint fallback for public spreadsheets
      try {
        var gvizUrl = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id) + '/gviz/tq?tqx=out:json';
        var gvizResp = await fetch(gvizUrl);
        if (gvizResp.ok) {
          var rawText = await gvizResp.text();
          var cleanJson = rawText.replace(/^\/\*[\s\S]*?\*\/\s*/, '').replace(/^[a-zA-Z0-9_.]+\(/, '').replace(/\);?\s*$/, '');
          var gvizData = JSON.parse(cleanJson);
          
          if (gvizData && gvizData.table && Array.isArray(gvizData.table.rows)) {
            var cols = gvizData.table.cols.map(function(c, idx) {
              return (c && c.label) ? String(c.label).trim() : (CLAN_SHEET_HEADERS[idx] || ('col_' + idx));
            });

            var publicRecords = [];
            var gRows = gvizData.table.rows;
            for (var i = 0; i < gRows.length; i++) {
              var cells = gRows[i].c || [];
              var mRec = {};
              for (var ci = 0; ci < cols.length; ci++) {
                var cell = cells[ci];
                var val = cell ? (cell.v !== undefined ? cell.v : cell.f) : '';
                mRec[cols[ci]] = val !== null && val !== undefined ? String(val).trim() : '';
              }
              var normPublic = normalizeSheetRow(mRec, i);
              if (normPublic) {
                publicRecords.push(normPublic);
              }
            }
            if (publicRecords.length > 0) {
              return publicRecords;
            }
          }
        }
      } catch (publicErr) {
        console.warn('Public gviz read notice:', publicErr);
      }

      try {
        var serverResp = await fetch("/api/db/records");
        if (serverResp.ok) {
          var serverData = await serverResp.json();
          var sRecords = Array.isArray(serverData.records) ? serverData.records : (Array.isArray(serverData.members) ? serverData.members : []);
          if (sRecords.length > 0) return sRecords;
        }
      } catch (sErr) {}
      return [];
    },

    // 5. Serialize Members to 2D Array
    recordsToRows: function(recordsList) {
      var rows = [CLAN_SHEET_HEADERS.slice()]; // Header row

      for (var i = 0; i < recordsList.length; i++) {
        var rec = recordsList[i];
        if (!rec) continue;

        var row = [];
        for (var c = 0; c < CLAN_SHEET_HEADERS.length; c++) {
          var key = CLAN_SHEET_HEADERS[c];
          var val = rec[key];
          if (key === 'photo') {
            val = rec.photo || rec.storedPhoto || rec.photoFile || rec.photoUrl || '';
          }

          if (key === 'id') {
            var rawVal = String(rec['Member ID'] || rec['MemberID'] || rec['Record ID'] || rec.id || rec.recordId || val || '').trim();
            var isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawVal) || (rawVal.includes('-') && rawVal.length > 20);
            if (isUuid || !rawVal) {
              val = rec.clanMemberNumber || rec.clan_member_number || (rec.firstName ? (String(rec.firstName).toLowerCase() + (rec.lastName ? '_' + String(rec.lastName).toLowerCase() : '')) : 'member');
            } else {
              val = rawVal;
            }
          }

          if (val === undefined || val === null) {
            val = '';
          } else if (Array.isArray(val) || typeof val === 'object') {
            val = JSON.stringify(val);
          } else if (typeof val === 'boolean') {
            val = val ? 'true' : 'false';
          } else {
            val = String(val);
          }
          row.push(val);
        }
        rows.push(row);
      }
      return rows;
    },

    // 6. Write All Members to Google Sheet
    writeAllMembers: async function(spreadsheetId, tabName, recordsList, clearFirst) {
      var id = spreadsheetId || this.getConnectedSheetId();
      if (!id) throw new Error('No Google Spreadsheet connected.');

      var tab = tabName || (await this.getMembersTabName(id));
      var rows = this.recordsToRows(recordsList || []);

      if (clearFirst !== false) {
        // Clear previous rows to prevent orphaned rows
        try {
          var clearUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id) + '/values/' + encodeURIComponent(tab) + '!A1:AZ5000:clear';
          await this.fetchApi(clearUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
        } catch (clearErr) {
          console.warn('Clear sheet notice (continuing with update):', clearErr);
        }
      }

      // Update range with headers and rows
      var updateUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id) + '/values/' + encodeURIComponent(tab) + '!A1?valueInputOption=USER_ENTERED';
      return await this.fetchApi(updateUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          range: tab + '!A1',
          majorDimension: 'ROWS',
          values: rows
        })
      });
    },

    // 7. Append Single Member to Google Sheet
    appendMember: async function(member) {
      var id = this.getConnectedSheetId();
      if (!id) return null;

      var tab = await this.getMembersTabName(id);
      var rows = this.recordsToRows([member]).slice(1); // Exclude header row

      var appendUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id) + '/values/' + encodeURIComponent(tab) + '!A:AZ:append?valueInputOption=USER_ENTERED';
      return await this.fetchApi(appendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          range: tab + '!A:AZ',
          majorDimension: 'ROWS',
          values: rows
        })
      });
    },

    // 8. Log Audit Event to Google Sheet
    logAuditToSheet: async function(action, details, actorEmail, actorUid) {
      var id = this.getConnectedSheetId();
      if (!id || !this.hasAccessToken()) return;

      try {
        var appendUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id) + '/values/AuditLogs!A:E:append?valueInputOption=USER_ENTERED';
        await this.fetchApi(appendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            range: 'AuditLogs!A:E',
            majorDimension: 'ROWS',
            values: [[
              new Date().toISOString(),
              action || 'SYSTEM',
              typeof details === 'object' ? JSON.stringify(details) : String(details || ''),
              actorEmail || '',
              actorUid || ''
            ]]
          })
        });
      } catch (e) {
        // Non-blocking
      }
    },

    // 9. Web App URL Settings
    getWebAppUrl: function() {
      try {
        var url = localStorage.getItem('siara_google_webapp_url') || '';
        if (!url) {
          var sheetUrl = localStorage.getItem('siara_google_sheet_url') || '';
          if (sheetUrl && sheetUrl.includes('script.google.com')) url = sheetUrl;
        }
        return url;
      } catch (e) {
        return '';
      }
    },

    setWebAppUrl: function(url) {
      try {
        if (url) localStorage.setItem('siara_google_webapp_url', String(url).trim());
        else localStorage.removeItem('siara_google_webapp_url');
      } catch (e) {}
    },

    // 10. Delete Member from Google Sheet (Authoritative 2-way sync)
    deleteMember: async function(id, email) {
      var webAppUrl = this.getWebAppUrl();
      if (webAppUrl) {
        try {
          var host = typeof window !== 'undefined' && window.location ? window.location.hostname : '';
          var isStaticHost = host && host.includes('github.io');
          if (!isStaticHost && typeof fetch !== 'undefined') {
            await fetch('/api/sheets/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ webAppUrl: webAppUrl, id: id, email: email, ids: [id, email].filter(Boolean), action: 'delete' })
            });
          } else {
            var url = webAppUrl + '?action=delete&id=' + encodeURIComponent(id || '') + '&email=' + encodeURIComponent(email || '');
            await fetch(url, { method: 'GET', mode: 'no-cors' });
          }
        } catch (e) {
          console.warn('[GoogleSheetsDB] deleteMember proxy notice:', e);
        }
      }

      var sheetId = this.getConnectedSheetId();
      if (sheetId && this.hasAccessToken()) {
        try {
          var allMembers = await this.readAllMembers(sheetId);
          var targetId = String(id || '').trim().toLowerCase();
          var targetEmail = String(email || '').trim().toLowerCase();
          var filtered = allMembers.filter(function(m) {
            var mId = String(m.id || m.recordId || '').trim().toLowerCase();
            var mCnum = String(m.clanMemberNumber || m['Clan Member Number'] || '').trim().toLowerCase();
            var mEmail = String(m.email || '').trim().toLowerCase();

            if (targetId && (mId === targetId || mCnum === targetId)) return false;
            if (targetEmail && mEmail === targetEmail) return false;
            return true;
          });
          if (filtered.length !== allMembers.length) {
            await this.writeAllMembers(sheetId, null, filtered, true);
          }
        } catch (e2) {
          console.warn('[GoogleSheetsDB] deleteMember REST notice:', e2);
        }
      }

      return { success: true, deletedId: id };
    },

    // 11. Bulk Delete Members from Google Sheet
    batchDeleteMembers: async function(ids) {
      if (!Array.isArray(ids) || ids.length === 0) return { success: true, count: 0 };
      var webAppUrl = this.getWebAppUrl();
      if (webAppUrl) {
        try {
          var host = typeof window !== 'undefined' && window.location ? window.location.hostname : '';
          var isStaticHost = host && host.includes('github.io');
          if (!isStaticHost && typeof fetch !== 'undefined') {
            await fetch('/api/sheets/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ webAppUrl: webAppUrl, ids: ids, action: 'delete' })
            });
          } else {
            for (var i = 0; i < ids.length; i++) {
              var url = webAppUrl + '?action=delete&id=' + encodeURIComponent(ids[i] || '');
              await fetch(url, { method: 'GET', mode: 'no-cors' });
            }
          }
        } catch (e) {
          console.warn('[GoogleSheetsDB] batchDeleteMembers proxy notice:', e);
        }
      }

      var sheetId = this.getConnectedSheetId();
      if (sheetId && this.hasAccessToken()) {
        try {
          var allMembers = await this.readAllMembers(sheetId);
          var idSet = new Set(ids);
          var filtered = allMembers.filter(function(m) {
            return !idSet.has(m.id) && !idSet.has(m.clanMemberNumber);
          });
          if (filtered.length !== allMembers.length) {
            await this.writeAllMembers(sheetId, null, filtered, true);
          }
        } catch (e2) {
          console.warn('[GoogleSheetsDB] batchDeleteMembers REST notice:', e2);
        }
      }

      return { success: true, count: ids.length };
    },

    // 12. Save or Update Member to Google Sheet (Zero Duplicates Upsert)
    saveMember: async function(member) {
      if (!member) return null;
      var webAppUrl = this.getWebAppUrl();
      if (webAppUrl) {
        try {
          var host = typeof window !== 'undefined' && window.location ? window.location.hostname : '';
          var isStaticHost = host && host.includes('github.io');
          if (!isStaticHost && typeof fetch !== 'undefined') {
            await fetch('/api/sheets/push', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ webAppUrl: webAppUrl, member: member })
            });
          } else {
            await fetch(webAppUrl, {
              method: 'POST',
              mode: 'no-cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(member)
            });
          }
        } catch (e) {
          console.warn('[GoogleSheetsDB] saveMember proxy notice:', e);
        }
      }

      var sheetId = this.getConnectedSheetId();
      if (sheetId && this.hasAccessToken()) {
        try {
          var allMembers = await this.readAllMembers(sheetId);
          var found = false;
          var mId = String(member.id || '').trim();
          var mClanNum = String(member.clanMemberNumber || '').trim().toUpperCase();
          var mEmail = String(member.email || '').trim().toLowerCase();
          var mFn = String(member.firstName || '').trim().toLowerCase();
          var mLn = String(member.lastName || '').trim().toLowerCase();

          for (var i = 0; i < allMembers.length; i++) {
            var r = allMembers[i];
            var rId = String(r.id || '').trim();
            var rClanNum = String(r.clanMemberNumber || '').trim().toUpperCase();
            var rEmail = String(r.email || '').trim().toLowerCase();
            var rFn = String(r.firstName || '').trim().toLowerCase();
            var rLn = String(r.lastName || '').trim().toLowerCase();

            if ((mId && rId === mId) ||
                (mClanNum && rClanNum === mClanNum) ||
                (mEmail && rEmail === mEmail) ||
                (mFn && mLn && rFn === mFn && rLn === mLn)) {
              allMembers[i] = Object.assign({}, r, member);
              found = true;
              break;
            }
          }

          if (!found) {
            allMembers.push(member);
          }

          await this.writeAllMembers(sheetId, null, allMembers, true);
        } catch (e) {
          console.warn('[GoogleSheetsDB] saveMember sheet upsert notice:', e);
        }
      }
      return member;
    },

    // Fast deterministic hash calculator for records array to detect genuine changes
    _computeMembersHash: function(members) {
      if (!Array.isArray(members) || members.length === 0) return "empty";
      var sum = 0;
      var len = members.length;
      for (var i = 0; i < len; i++) {
        var m = members[i];
        if (m) {
          var str = (m.id || "") + ":" + (m.clanMemberNumber || "") + ":" + (m.firstName || "") + ":" + (m.lastName || "") + ":" + (m.email || "") + ":" + (m.phone || "") + ":" + (m.fatherId || "") + ":" + (m.motherId || "") + ":" + (m.spouseId || "") + ":" + (m.deceased ? "1" : "0");
          for (var j = 0; j < str.length; j++) {
            sum = ((sum << 5) - sum + str.charCodeAt(j)) | 0;
          }
        }
      }
      return len + ":" + sum.toString(36);
    },

    // 13. Sync Sheet Edits to App Instantly (Zero Duplicates & Change-Triggered Only)
    syncSheetToApp: async function() {
      var sheetId = this.getConnectedSheetId();
      if (!sheetId) return null;
      try {
        var sheetMembers = await this.readAllMembers(sheetId);
        if (Array.isArray(sheetMembers) && sheetMembers.length > 0) {
          var currentHash = this._computeMembersHash(sheetMembers);
          if (this._lastSyncedHash && this._lastSyncedHash === currentHash) {
            // Google Sheets content is identical - no new changes detected.
            return { success: true, unchanged: true, count: sheetMembers.length };
          }
          this._lastSyncedHash = currentHash;

          var resp = await fetch("/api/db/sync/records", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "X-Requested-With": "XMLHttpRequest"
            },
            body: JSON.stringify({ records: sheetMembers, author: "google_sheets_autosync", source: "google_sheets" })
          });
          if (resp.ok) {
            var data = await resp.json();
            // Only notify if rows were genuinely added or updated
            if (data && (data.added > 0 || data.updated > 0)) {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('clan-members-updated', { detail: { count: sheetMembers.length, data: data } }));
              }
            }
            return data;
          }
        }
      } catch (e) {
        console.warn('[GoogleSheetsDB] syncSheetToApp notice:', e);
      }
      return null;
    },

    startAutoSync: function(intervalMs) {
      if (this._autoSyncTimer) return;
      var syncInterval = intervalMs || 300000; // 5 minutes default
      var self = this;
      this._autoSyncTimer = setInterval(function() {
        if (self.getConnectedSheetId()) {
          self.syncSheetToApp();
        }
      }, syncInterval);
    }
  };

  global.GoogleSheetsDB = GoogleSheetsDB;
})(typeof window !== 'undefined' ? window : this);
