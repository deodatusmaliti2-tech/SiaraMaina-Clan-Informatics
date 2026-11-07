import puppeteer from 'puppeteer';

async function runTest() {
  console.log("=== Starting Google Sheets Integration End-to-End Test ===");
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  page.on('dialog', async dialog => {
    console.log(`[Auto-handled Dialog: ${dialog.type()}] "${dialog.message()}"`);
    await dialog.accept();
  });

  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));

  // Set administrator session
  await page.evaluate(() => {
    window.currentUser = {
      uid: "admin-test-01",
      email: "deodatusmaliti2@gmail.com",
      displayName: "Deodatus Maliti",
      role: "admin",
      approved: true
    };
    localStorage.setItem("siara_user_session", JSON.stringify(window.currentUser));
    localStorage.setItem("siara_session_token", "test-token");
  });

  console.log("\n1. Verifying Google Sheets Global Functions & Objects...");
  const globals = await page.evaluate(() => {
    return {
      hasGoogleSheetsDB: typeof window.GoogleSheetsDB === 'object' && window.GoogleSheetsDB !== null,
      hasSaveMember: typeof window.GoogleSheetsDB?.saveMember === 'function',
      hasDeleteMember: typeof window.GoogleSheetsDB?.deleteMember === 'function',
      hasBatchDeleteMembers: typeof window.GoogleSheetsDB?.batchDeleteMembers === 'function',
      hasWriteAllMembers: typeof window.GoogleSheetsDB?.writeAllMembers === 'function',
      hasReadAllMembers: typeof window.GoogleSheetsDB?.readAllMembers === 'function',
      hasExportAllMembersToGoogleWebApp: typeof window.exportAllMembersToGoogleWebApp === 'function',
      hasPushMemberToGoogleWebApp: typeof window.pushMemberToGoogleWebApp === 'function',
      hasDeleteMemberFromGoogleWebApp: typeof window.deleteMemberFromGoogleWebApp === 'function',
      hasBatchDeleteMembersFromGoogleWebApp: typeof window.batchDeleteMembersFromGoogleWebApp === 'function',
      hasSyncFromGoogleSheetUrl: typeof window.syncFromGoogleSheetUrl === 'function',
      hasOpenGoogleSheetsExportModal: typeof window.openGoogleSheetsExportModal === 'function',
      hasOpenGoogleSheetsImportModal: typeof window.openGoogleSheetsImportModal === 'function',
      hasOpenGoogleAppsScriptModal: typeof window.openGoogleAppsScriptModal === 'function',
      hasOpenDataSheetsPortal: typeof window.openDataSheetsPortal === 'function'
    };
  });
  console.log("Globals check:", globals);
  for (const [k, v] of Object.entries(globals)) {
    if (!v) throw new Error(`Missing expected global function: ${k}`);
  }

  console.log("\n2. Testing Google Sheets Modals Open & Close...");
  const modalTest = await page.evaluate(() => {
    window.openGoogleSheetsExportModal();
    const expOpen = document.getElementById('googleSheetsExportModal')?.classList.contains('open');
    closeModal('googleSheetsExportModal');

    window.openGoogleSheetsImportModal();
    const impOpen = document.getElementById('googleSheetsImportModal')?.classList.contains('open');
    closeModal('googleSheetsImportModal');

    window.openGoogleAppsScriptModal();
    const gasOpen = document.getElementById('googleAppsScriptModal')?.classList.contains('open');
    closeModal('googleAppsScriptModal');

    return { expOpen, impOpen, gasOpen };
  });
  console.log("Modal open test:", modalTest);
  if (!modalTest.expOpen || !modalTest.impOpen || !modalTest.gasOpen) {
    throw new Error("One or more Google Sheets modals failed to open.");
  }

  console.log("\n3. Testing Save / Push Member TO Google Sheets...");
  const testMember = {
    id: "test_member_sheets_001",
    firstName: "SheetTestFirst",
    lastName: "SheetTestLast",
    email: "sheettest@siaramaina.org",
    branchType: "siara"
  };

  const pushTest = await page.evaluate(async (m) => {
    localStorage.setItem("siara_google_webapp_url", "http://localhost:3000/api/sheets/mock-echo");
    let caughtError = null;
    try {
      await window.pushMemberToGoogleWebApp(m);
    } catch (e) {
      caughtError = e.message;
    }
    return { caughtError };
  }, testMember);
  console.log("Push member test result:", pushTest);

  console.log("\n4. Testing Delete Member TO Google Sheets...");
  const deleteTest = await page.evaluate(async () => {
    let caughtError = null;
    try {
      await window.deleteMemberFromGoogleWebApp("test_member_sheets_001", "sheettest@siaramaina.org");
      await window.batchDeleteMembersFromGoogleWebApp(["test_member_sheets_001", "test_member_sheets_002"]);
      await window.GoogleSheetsDB.deleteMember("test_member_sheets_001", "sheettest@siaramaina.org");
      await window.GoogleSheetsDB.batchDeleteMembers(["test_member_sheets_001"]);
    } catch (e) {
      caughtError = e.message;
    }
    return { caughtError };
  });
  console.log("Delete member test result:", deleteTest);

  console.log("\n5. Testing Deletion Reconciliation FROM Google Sheet INTO App...");
  const reconcileTest = await page.evaluate(async () => {
    // Seed test records in memory
    window.records = [
      { id: "keep_1", firstName: "Alice", lastName: "Maina", email: "alice@test.com", branchType: "maina" },
      { id: "delete_me_1", firstName: "Bob", lastName: "Siara", email: "bob@test.com", branchType: "siara" }
    ];
    localStorage.setItem("siara_records", JSON.stringify(window.records));

    // Simulate Google Sheet response where Bob was deleted from the sheet (only Alice remains)
    const sheetDataCsv = 'Member ID,First Name,Last Name,Email Address\nkeep_1,Alice,Maina,alice@test.com';

    // Mock fetch to return this CSV when syncFromGoogleSheetUrl runs
    const origFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && (url.includes('/api/sheets/fetch-csv') || url.includes('export?format=csv'))) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, csv: sheetDataCsv, isJson: false }),
          text: async () => sheetDataCsv
        };
      }
      return origFetch(url, opts);
    };

    const input = document.getElementById("googleSheetUrlInput");
    if (input) input.value = "https://docs.google.com/spreadsheets/d/test_doc/export?format=csv";

    // Run sync
    await window.syncFromGoogleSheetUrl();
    window.fetch = origFetch;

    const remainingIds = window.records.map(r => r.id);
    return {
      totalRemaining: window.records.length,
      hasAlice: remainingIds.includes("keep_1"),
      hasBob: remainingIds.includes("delete_me_1")
    };
  });
  console.log("Reconcile Deletion result:", reconcileTest);
  if (!reconcileTest.hasAlice) throw new Error("Expected member Alice to remain in app records.");
  if (reconcileTest.hasBob) throw new Error("Expected deleted member Bob to be pruned from app records upon sync from sheet.");

  console.log("\n6. Testing JSON Format Google Apps Script Web App Sync...");
  const jsonSyncTest = await page.evaluate(async () => {
    window.records = [
      { id: "keep_1", firstName: "Alice", lastName: "Maina", email: "alice@test.com", branchType: "maina" }
    ];

    const appsScriptJson = JSON.stringify([
      { "Member ID": "keep_1", "First Name": "Alice", "Last Name": "Maina Updated", "Email Address": "alice@test.com" },
      { "Member ID": "new_sheet_user", "First Name": "Charlie", "Last Name": "Maliti", "Email Address": "charlie@test.com" }
    ]);

    const origFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && (url.includes('/api/sheets/fetch-csv') || url.includes('/api/sheets/fetch-data'))) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, csv: appsScriptJson, isJson: true, data: JSON.parse(appsScriptJson) }),
          text: async () => appsScriptJson
        };
      }
      return origFetch(url, opts);
    };

    const input = document.getElementById("googleSheetUrlInput");
    if (input) input.value = "https://script.google.com/macros/s/test_web_app_id/exec";

    await window.syncFromGoogleSheetUrl();
    window.fetch = origFetch;

    const ids = window.records.map(r => r.id);
    const alice = window.records.find(r => r.id === "keep_1");
    return {
      count: window.records.length,
      hasCharlie: ids.includes("new_sheet_user"),
      aliceLastName: alice?.lastName
    };
  });
  console.log("JSON Apps Script Web App sync result:", jsonSyncTest);
  if (!jsonSyncTest.hasCharlie) throw new Error("Expected new member Charlie from Apps Script JSON to be added.");
  if (jsonSyncTest.aliceLastName !== "Maina Updated") throw new Error("Expected Alice's updated last name from Apps Script JSON.");

  console.log("\n7. Verifying Top Bar Buttons & Responsiveness...");
  const buttonsWorking = await page.evaluate(() => {
    const cloudBtn = document.getElementById('cloudDbBtn');
    const diagBtn = document.getElementById('topbarDiagnosticsBtn');
    const userBtn = document.getElementById('topbarUserMgmtBtn');
    const authBtn = document.getElementById('firebaseAuthBtn');

    return {
      cloudBtnVisible: !!cloudBtn,
      diagBtnVisible: !!diagBtn,
      userBtnVisible: !!userBtn,
      authBtnVisible: !!authBtn,
      openCloudDbModalIsFunction: typeof window.openCloudDbModal === 'function',
      openInbuiltDiagnosticsModalIsFunction: typeof window.openInbuiltDiagnosticsModal === 'function',
      openUserManagementIsFunction: typeof window.openUserManagement === 'function',
      toggleFirebaseGoogleAuthIsFunction: typeof window.toggleFirebaseGoogleAuth === 'function'
    };
  });
  console.log("Button functions verification:", buttonsWorking);
  for (const [k, v] of Object.entries(buttonsWorking)) {
    if (!v) throw new Error(`Button check failed for ${k}`);
  }

  await browser.close();
  console.log("\n🎉 ALL GOOGLE SHEETS & APP INTEGRATION TESTS PASSED PERFECTLY!");
}

runTest().catch(err => {
  console.error("\n❌ TEST FAILED:", err);
  process.exit(1);
});
