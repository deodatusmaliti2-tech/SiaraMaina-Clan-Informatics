import puppeteer from 'puppeteer';

async function testEach() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  console.log('=== TEST 1: Open and Close User Management (#topbarUserMgmtBtn) ===');
  await page.click('#topbarUserMgmtBtn');
  await new Promise(r => setTimeout(r, 500));
  let state = await page.evaluate(() => {
    const m = document.getElementById('userManagementModal');
    return {
      open: m?.classList.contains('open'),
      display: window.getComputedStyle(m).display,
      directoryPanelDisplay: window.getComputedStyle(document.getElementById('umDirectoryPanel')).display,
      userListCount: document.querySelectorAll('#userList tr').length
    };
  });
  console.log('User Management Modal State:', state);

  // Close modal via its close button
  await page.click('#userManagementModal .close');
  await new Promise(r => setTimeout(r, 300));
  state = await page.evaluate(() => {
    const m = document.getElementById('userManagementModal');
    return { open: m?.classList.contains('open'), display: window.getComputedStyle(m).display };
  });
  console.log('User Management Modal Closed State:', state);

  console.log('\n=== TEST 2: Open and Close Firestore DB (#cloudDbBtn) ===');
  await page.click('#cloudDbBtn');
  await new Promise(r => setTimeout(r, 500));
  state = await page.evaluate(() => {
    const m = document.getElementById('cloudDbModal');
    return {
      open: m?.classList.contains('open'),
      display: window.getComputedStyle(m).display,
      title: m?.querySelector('h2')?.innerText
    };
  });
  console.log('Firestore DB Modal State:', state);

  // Close modal via its close button
  await page.click('#cloudDbModal .close');
  await new Promise(r => setTimeout(r, 300));
  state = await page.evaluate(() => {
    const m = document.getElementById('cloudDbModal');
    return { open: m?.classList.contains('open'), display: window.getComputedStyle(m).display };
  });
  console.log('Firestore DB Modal Closed State:', state);

  console.log('\n=== TEST 3: Open and Close Diagnostics (#topbarDiagnosticsBtn) ===');
  await page.click('#topbarDiagnosticsBtn');
  await new Promise(r => setTimeout(r, 500));
  state = await page.evaluate(() => {
    const m = document.getElementById('inbuiltDiagnosticsModal');
    return {
      open: m?.classList.contains('open'),
      display: window.getComputedStyle(m).display,
      title: m?.querySelector('h2')?.innerText
    };
  });
  console.log('Diagnostics Modal State:', state);

  // Close modal via its close button
  await page.click('#inbuiltDiagnosticsModal .close');
  await new Promise(r => setTimeout(r, 300));
  state = await page.evaluate(() => {
    const m = document.getElementById('inbuiltDiagnosticsModal');
    return { open: m?.classList.contains('open'), display: window.getComputedStyle(m).display };
  });
  console.log('Diagnostics Modal Closed State:', state);

  console.log('\n=== TEST 4: Open and Close Sign In (#firebaseAuthBtn) ===');
  await page.click('#firebaseAuthBtn');
  await new Promise(r => setTimeout(r, 500));
  state = await page.evaluate(() => {
    const m = document.getElementById('loginScreen');
    return {
      open: m?.classList.contains('open'),
      display: window.getComputedStyle(m).display
    };
  });
  console.log('Login Modal State:', state);

  // Close login modal via close button
  await page.click('#loginScreen .close');
  await new Promise(r => setTimeout(r, 300));
  state = await page.evaluate(() => {
    const m = document.getElementById('loginScreen');
    return { open: m?.classList.contains('open'), display: window.getComputedStyle(m).display };
  });
  console.log('Login Modal Closed State:', state);

  console.log('\nTotal Errors Caught during sequential modal tests:', errors);

  await browser.close();
}

testEach().catch(console.error);
