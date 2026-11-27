import puppeteer from 'puppeteer';

async function testFunctions() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER UNCAUGHT:', err));

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n--- Evaluating window functions ---');
  const res = await page.evaluate(() => {
    return {
      openCloudDbModalType: typeof window.openCloudDbModal,
      openInbuiltDiagnosticsModalType: typeof window.openInbuiltDiagnosticsModal,
      openUserManagementType: typeof window.openUserManagement,
      toggleFirebaseGoogleAuthType: typeof window.toggleFirebaseGoogleAuth,
      toggleMobileMenuType: typeof window.toggleMobileMenu,
      cloudDbBtnOnclick: document.getElementById('cloudDbBtn') ? document.getElementById('cloudDbBtn').onclick?.toString() : null,
      topbarDiagnosticsBtnOnclick: document.getElementById('topbarDiagnosticsBtn') ? document.getElementById('topbarDiagnosticsBtn').onclick?.toString() : null,
      topbarUserMgmtBtnOnclick: document.getElementById('topbarUserMgmtBtn') ? document.getElementById('topbarUserMgmtBtn').onclick?.toString() : null,
      firebaseAuthBtnOnclick: document.getElementById('firebaseAuthBtn') ? document.getElementById('firebaseAuthBtn').onclick?.toString() : null
    };
  });
  console.log(res);

  console.log('\n--- Directly Calling openUserManagement() ---');
  const umCall = await page.evaluate(() => {
    try {
      window.openUserManagement();
      const m = document.getElementById('userManagementModal');
      return { success: true, hasOpenClass: m?.classList.contains('open'), display: m?.style.display };
    } catch (e) {
      return { success: false, error: e.message, stack: e.stack };
    }
  });
  console.log('openUserManagement() result:', umCall);

  console.log('\n--- Directly Calling openCloudDbModal() ---');
  const cloudDbCall = await page.evaluate(() => {
    try {
      window.openCloudDbModal();
      const m = document.getElementById('cloudDbModal');
      return { success: true, hasOpenClass: m?.classList.contains('open'), display: m?.style.display };
    } catch (e) {
      return { success: false, error: e.message, stack: e.stack };
    }
  });
  console.log('openCloudDbModal() result:', cloudDbCall);

  console.log('\n--- Directly Calling openInbuiltDiagnosticsModal() ---');
  const diagCall = await page.evaluate(() => {
    try {
      window.openInbuiltDiagnosticsModal();
      const m = document.getElementById('inbuiltDiagnosticsModal');
      return { success: true, hasOpenClass: m?.classList.contains('open'), display: m?.style.display };
    } catch (e) {
      return { success: false, error: e.message, stack: e.stack };
    }
  });
  console.log('openInbuiltDiagnosticsModal() result:', diagCall);

  console.log('\n--- Directly Clicking the Buttons via DOM element.click() ---');
  const clickCalls = await page.evaluate(() => {
    const results = {};
    for (const id of ['cloudDbBtn', 'topbarDiagnosticsBtn', 'topbarUserMgmtBtn', 'firebaseAuthBtn']) {
      const btn = document.getElementById(id);
      if (!btn) {
        results[id] = 'NOT_FOUND';
        continue;
      }
      try {
        btn.click();
        results[id] = 'CLICKED_OK';
      } catch (e) {
        results[id] = 'ERROR: ' + e.message;
      }
    }
    return results;
  });
  console.log('Click results:', clickCalls);

  console.log('\n--- Checking Modals after button.click() ---');
  const modalsAfter = await page.evaluate(() => {
    return {
      userManagementModal: document.getElementById('userManagementModal')?.className + ' | ' + document.getElementById('userManagementModal')?.style.display,
      cloudDbModal: document.getElementById('cloudDbModal')?.className + ' | ' + document.getElementById('cloudDbModal')?.style.display,
      inbuiltDiagnosticsModal: document.getElementById('inbuiltDiagnosticsModal')?.className + ' | ' + document.getElementById('inbuiltDiagnosticsModal')?.style.display
    };
  });
  console.log('Modals after clicks:', modalsAfter);

  console.log('\n--- Testing Mobile Toggle ---');
  const mobileRes = await page.evaluate(() => {
    const btn = document.querySelector('.mobile-menu-toggle');
    const controls = document.querySelector('.controls');
    const commandbar = document.querySelector('.commandbar');
    return {
      btnExists: !!btn,
      controlsClasses: controls?.className,
      commandbarClasses: commandbar?.className,
      onclick: btn?.getAttribute('onclick')
    };
  });
  console.log('Mobile toggle info:', mobileRes);

  await browser.close();
}

testFunctions().catch(console.error);
