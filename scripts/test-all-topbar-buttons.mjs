import puppeteer from 'puppeteer';

async function testAllTopbarButtons() {
  console.log('=== Starting Complete Topbar Automation Test with Puppeteer ===');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  const uncaughtErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    uncaughtErrors.push(err.message);
  });

  console.log('1. Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  // Helper to check modal visibility
  async function checkModal(modalId) {
    return await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return { exists: false };
      const style = window.getComputedStyle(el);
      return {
        exists: true,
        hasOpenClass: el.classList.contains('open'),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity
      };
    }, modalId);
  }

  // Helper to close open modal
  async function closeModal(modalId) {
    await page.evaluate((id) => {
      if (id === 'loginScreen') {
        if (typeof window.closeLoginModal === 'function') window.closeLoginModal();
      } else {
        if (typeof window.closeModal === 'function') window.closeModal(id);
      }
    }, modalId);
    await new Promise(r => setTimeout(r, 200));
  }

  const testCases = [
    { name: '👥 Users Button (#topbarUserMgmtBtn)', selector: '#topbarUserMgmtBtn', modalId: 'userManagementModal' },
    { name: '☁️ Firestore DB Button (#cloudDbBtn)', selector: '#cloudDbBtn', modalId: 'cloudDbModal' },
    { name: '🩺 Diagnostics Button (#topbarDiagnosticsBtn)', selector: '#topbarDiagnosticsBtn', modalId: 'inbuiltDiagnosticsModal' },
    { name: '🔑 Sign In / Account Button (#firebaseAuthBtn)', selector: '#firebaseAuthBtn', modalId: 'loginScreen' },
    { name: '🔍 Filter Button', selector: '.command-group:first-child button[onclick*="openCustomFilter"]', modalId: 'customFilterModal' }
  ];

  console.log('\n2. Testing Primary Topbar Action Buttons (Desktop 1440x900)...');
  for (const tc of testCases) {
    console.log(`\nTesting ${tc.name}:`);
    const btnExists = await page.$(tc.selector);
    if (!btnExists) {
      console.error(`  ❌ Button selector NOT found: ${tc.selector}`);
      continue;
    }

    // Click button
    await page.click(tc.selector);
    await new Promise(r => setTimeout(r, 400));

    // Verify modal state
    const state = await checkModal(tc.modalId);
    const isOpen = state.exists && (state.hasOpenClass || state.display === 'flex');
    if (isOpen) {
      console.log(`  ✅ Modal [#${tc.modalId}] opened successfully! (display: ${state.display})`);
    } else {
      console.error(`  ❌ Modal [#${tc.modalId}] failed to open! State:`, state);
    }

    // Close modal
    await closeModal(tc.modalId);
    const postState = await checkModal(tc.modalId);
    const isClosed = !postState.hasOpenClass && postState.display === 'none';
    if (isClosed) {
      console.log(`  ✅ Modal [#${tc.modalId}] closed cleanly.`);
    } else {
      console.error(`  ❌ Modal [#${tc.modalId}] failed to close cleanly. State:`, postState);
    }
  }

  console.log('\n3. Testing Topbar Dropdowns & Inner Action Buttons...');
  // Utilities dropdown -> User Management, Cloud DB, Diagnostics
  await page.click('.command-group:nth-child(2) .dropdown:nth-child(3) .top-button');
  await new Promise(r => setTimeout(r, 300));
  const utilsOpen = await page.evaluate(() => document.getElementById('utilitiesMenu')?.classList.contains('open'));
  console.log('Utilities menu opened:', utilsOpen ? '✅ YES' : '❌ NO');

  if (utilsOpen) {
    // Click User Management inside Utilities dropdown
    await page.click('#userManagementDropdownBtn');
    await new Promise(r => setTimeout(r, 400));
    const umState = await checkModal('userManagementModal');
    console.log('User Management opened from dropdown:', (umState.hasOpenClass || umState.display === 'flex') ? '✅ YES' : '❌ NO');
    await closeModal('userManagementModal');
  }

  console.log('\n4. Testing Mobile View (375x667)...');
  await page.setViewport({ width: 375, height: 667 });
  await new Promise(r => setTimeout(r, 500));

  await page.click('.mobile-menu-toggle');
  await new Promise(r => setTimeout(r, 300));
  const mobileOpen = await page.evaluate(() => document.querySelector('.controls')?.classList.contains('mobile-open'));
  console.log('Mobile menu opened (.controls.mobile-open):', mobileOpen ? '✅ YES' : '❌ NO');

  if (mobileOpen) {
    // Test Users button in mobile menu
    await page.click('#topbarUserMgmtBtn');
    await new Promise(r => setTimeout(r, 400));
    const mobUmState = await checkModal('userManagementModal');
    console.log('Mobile Users button opened modal:', (mobUmState.hasOpenClass || mobUmState.display === 'flex') ? '✅ YES' : '❌ NO');
    await closeModal('userManagementModal');
  }

  console.log('\n5. Summary of Console / Page Errors:');
  console.log('Uncaught Page JS Errors:', uncaughtErrors.length);
  if (uncaughtErrors.length > 0) {
    uncaughtErrors.forEach(e => console.error('  -', e));
  }
  console.log('Console Errors:', consoleErrors.length);

  await browser.close();
  console.log('\n=== Test Execution Completed Successfully ===');
}

testAllTopbarButtons().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
