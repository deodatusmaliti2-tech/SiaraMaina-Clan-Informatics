import puppeteer from 'puppeteer';

async function runTests() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleLogs = [];
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(text);
      console.log('  [Console Error]:', text);
    } else {
      consoleLogs.push(text);
    }
  });

  page.on('pageerror', err => {
    pageErrors.push(err.message);
    console.error('  [Page Uncaught Error]:', err.message);
  });

  console.log('=== Loading http://localhost:3000 at 1440x900 ===');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n--- Initial Page Load State ---');
  console.log('Page Title:', await page.title());
  console.log('Total Console Errors on load:', consoleErrors.length);
  console.log('Total Page Errors on load:', pageErrors.length);

  // 1. Inspect layout and positions of topbar buttons
  const buttonSelectors = [
    { name: 'Catalogue Dropdown', selector: '.command-group:first-child .dropdown:nth-child(2) .top-button', isDropdown: true, menuId: 'catalogueMenu' },
    { name: 'Family Tree Dropdown', selector: '.command-group:first-child .dropdown:nth-child(3) .top-button', isDropdown: true, menuId: 'treeMenu' },
    { name: 'Filter Button', selector: '.command-group:first-child button[onclick*="openCustomFilter"]', isModal: true, modalId: 'customFilterModal' },
    { name: 'Statistics Button', selector: '.command-group:first-child button[onclick*="showStatistics"]', isModal: true, modalId: 'statisticsModal' },
    { name: 'Geographical Map Button', selector: '.command-group:first-child button[onclick*="showMap"]', isModal: true, modalId: 'mapModal' },
    { name: 'Contact Button', selector: '.command-group:first-child button[onclick*="showContactForms"]', isModal: true, modalId: 'contactModal' },
    { name: 'View Dropdown', selector: '.command-group:nth-child(2) .dropdown:nth-child(2) .top-button', isDropdown: true, menuId: 'viewMenu' },
    { name: 'Utilities Dropdown', selector: '.command-group:nth-child(2) .dropdown:nth-child(3) .top-button', isDropdown: true, menuId: 'utilitiesMenu' },
    { name: '+ Add Member', selector: '.action-group button.command-add' },
    { name: '☁️ Firestore DB', selector: '#cloudDbBtn', isModal: true, modalId: 'cloudDbModal' },
    { name: '🩺 Diagnostics', selector: '#topbarDiagnosticsBtn', isModal: true, modalId: 'inbuiltDiagnosticsModal' },
    { name: '🔑 Sign In (Firebase)', selector: '#firebaseAuthBtn', isModal: true, modalId: 'loginScreen' },
    { name: '👥 Users', selector: '#topbarUserMgmtBtn', isModal: true, modalId: 'userManagementModal' }
  ];

  console.log('\n--- Testing Click & Interaction On Every Desktop Topbar Button ---');

  for (const item of buttonSelectors) {
    console.log(`\nTesting: [${item.name}]`);
    const exists = await page.$(item.selector);
    if (!exists) {
      console.error(`  ❌ Element not found for selector: ${item.selector}`);
      continue;
    }

    const details = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        id: el.id,
        tagName: el.tagName,
        text: el.innerText.trim(),
        display: style.display,
        visibility: style.visibility,
        pointerEvents: style.pointerEvents,
        zIndex: style.zIndex,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    }, item.selector);

    console.log(`  Properties:`, details);

    // Try real user click
    try {
      await page.click(item.selector);
      console.log(`  ✓ Click executed without being intercepted by overlay.`);
    } catch (clickErr) {
      console.error(`  ❌ CLICK FAILED / INTERCEPTED:`, clickErr.message);
      continue;
    }

    await new Promise(r => setTimeout(r, 400));

    // Check if dropdown or modal opened
    if (item.isDropdown && item.menuId) {
      const isOpen = await page.evaluate((id) => {
        const m = document.getElementById(id);
        return m ? m.classList.contains('open') : false;
      }, item.menuId);
      console.log(`  Dropdown [${item.menuId}] opened: ${isOpen ? '✅ YES' : '❌ NO'}`);
      
      // Close dropdown by clicking body
      await page.click('body', { offset: { x: 10, y: 300 } });
      await new Promise(r => setTimeout(r, 200));
    }

    if (item.isModal && item.modalId) {
      const modalState = await page.evaluate((id) => {
        const m = document.getElementById(id);
        if (!m) return null;
        const style = window.getComputedStyle(m);
        return {
          hasOpenClass: m.classList.contains('open'),
          display: style.display,
          opacity: style.opacity,
          visibility: style.visibility,
          zIndex: style.zIndex
        };
      }, item.modalId);
      console.log(`  Modal [${item.modalId}] state:`, modalState);
      const isVisible = modalState && (modalState.hasOpenClass || modalState.display !== 'none');
      console.log(`  Modal [${item.modalId}] visible: ${isVisible ? '✅ YES' : '❌ NO'}`);

      // Try closing the modal
      const closed = await page.evaluate((id) => {
        if (id === 'loginScreen') {
          if (typeof window.closeLoginModal === 'function') {
            window.closeLoginModal();
            return true;
          }
        }
        if (typeof window.closeModal === 'function') {
          window.closeModal(id);
          return true;
        }
        return false;
      }, item.modalId);

      await new Promise(r => setTimeout(r, 200));
      const postCloseState = await page.evaluate((id) => {
        const m = document.getElementById(id);
        if (!m) return null;
        const style = window.getComputedStyle(m);
        return {
          hasOpenClass: m.classList.contains('open'),
          display: style.display
        };
      }, item.modalId);
      console.log(`  Modal [${item.modalId}] closed state:`, postCloseState);
    }
  }

  // 2. Mobile View Testing (375x667)
  console.log('\n\n=== Testing Mobile View (375x667) ===');
  await page.setViewport({ width: 375, height: 667 });
  await new Promise(r => setTimeout(r, 500));

  const mobileToggle = await page.$('.mobile-menu-toggle');
  console.log('Mobile menu toggle button exists:', !!mobileToggle);
  if (mobileToggle) {
    await page.click('.mobile-menu-toggle');
    console.log('Clicked mobile menu toggle');
    await new Promise(r => setTimeout(r, 300));

    const isMobileOpen = await page.evaluate(() => {
      const cb = document.querySelector('.commandbar');
      return cb ? cb.classList.contains('mobile-open') : false;
    });
    console.log('Mobile menu opened (.commandbar.mobile-open):', isMobileOpen ? '✅ YES' : '❌ NO');

    // Test clicking Users, Firestore DB, Diagnostics in mobile menu
    for (const id of ['cloudDbBtn', 'topbarDiagnosticsBtn', 'topbarUserMgmtBtn']) {
      try {
        await page.click(`#${id}`);
        console.log(`  Mobile click on #${id}: SUCCESS`);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.error(`  Mobile click on #${id} FAILED:`, err.message);
      }
    }
  }

  await browser.close();
  console.log('\n=== All tests finished ===');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
