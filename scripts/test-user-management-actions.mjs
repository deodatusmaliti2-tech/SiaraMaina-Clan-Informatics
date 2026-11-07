import puppeteer from 'puppeteer';

async function testUserManagementActions() {
  console.log('=== Starting User Management Delete Buttons & Persistence Test ===');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error(' [Console Error]:', msg.text());
    }
  });

  page.on('dialog', async dialog => {
    console.log(` [Browser Dialog Prompt]: "${dialog.message()}" -> Auto accepting...`);
    await dialog.accept();
  });

  console.log('1. Loading application at http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });

  // Provision temporary user for deletion test
  await page.evaluate(async () => {
    try {
      await fetch('/api/auth/users/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer clan-admin-token-deodatus'
        },
        body: JSON.stringify({
          uid: 'temp-del-uid-999',
          email: 'temp-del-user@siaramaina.org',
          displayName: 'Temp Delete Account',
          role: 'viewer',
          approved: true,
          active: true
        })
      });
    } catch(e) {}
  });

  // Set admin session in browser
  await page.evaluate(() => {
    const adminUser = {
      uid: "6G8sxMl8cVh3ex2y1lyedqWrwVh2",
      email: "deodatusmaliti2@gmail.com",
      displayName: "Deodatus Maliti",
      role: "admin",
      approved: true,
      active: true
    };
    localStorage.setItem("siara_user_session", JSON.stringify(adminUser));
    localStorage.setItem("siara_session_token", "clan-admin-token-deodatus");
  });

  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  console.log('\n2. Opening User Management Modal as Admin...');
  await page.click('#topbarUserMgmtBtn');
  await new Promise(r => setTimeout(r, 1000));

  const modalOpen = await page.evaluate(() => {
    const m = document.getElementById('userManagementModal');
    return m ? (m.classList.contains('open') || window.getComputedStyle(m).display === 'flex') : false;
  });
  console.log('User Management Modal Opened:', modalOpen ? '✅ YES' : '❌ NO');

  // Evaluate user list details inside the modal
  const userDetails = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table.user-list tbody tr'));
    return rows.map(tr => {
      const emailCode = tr.querySelector('code');
      const nameEl = tr.querySelector('strong');
      const deleteBtn = tr.querySelector('button.danger');
      return {
        name: nameEl ? nameEl.textContent.trim() : '',
        email: emailCode ? emailCode.textContent.trim() : '',
        hasDeleteBtn: !!deleteBtn,
        deleteBtnText: deleteBtn ? deleteBtn.textContent.trim() : ''
      };
    });
  });

  console.log('\n3. Users listed in User Management UI:');
  userDetails.forEach((u, i) => {
    console.log(` [User ${i+1}] ${u.name} (${u.email}) -> Delete Btn: ${u.hasDeleteBtn ? `Available [${u.deleteBtnText}]` : 'Disabled (Master Owner)'}`);
  });

  // Check Victor Maliti's Delete Button
  const victor = userDetails.find(u => u.email.toLowerCase() === 'dmaliti@researchlinktz.com');
  console.log('\n4. Checking Victor Maliti (dmaliti@researchlinktz.com)...');
  if (victor) {
    console.log(` Victor Maliti found! Delete Button status: ${victor.hasDeleteBtn ? '✅ HAS DELETE BUTTON' : '❌ NO DELETE BUTTON'}`);
  } else {
    console.error(' ❌ Victor Maliti not found in list!');
  }

  // Check Deodatus Maliti (Master Owner)
  const masterOwner = userDetails.find(u => u.email.toLowerCase() === 'deodatusmaliti2@gmail.com');
  if (masterOwner) {
    console.log(` Master Owner found! Delete Button status: ${masterOwner.hasDeleteBtn ? '❌ HAS DELETE BUTTON (Should be protected)' : '✅ PROTECTED (No Delete Button)'}`);
  }

  // Test Delete Action on temp account
  const tempAccount = userDetails.find(u => u.email.toLowerCase() === 'temp-del-user@siaramaina.org');
  if (tempAccount) {
    console.log(`\n5. Testing Delete button execution on: ${tempAccount.email}...`);

    await page.evaluate((targetEmail) => {
      const rows = Array.from(document.querySelectorAll('table.user-list tbody tr'));
      for (const tr of rows) {
        const emailCode = tr.querySelector('code');
        if (emailCode && emailCode.textContent.trim().toLowerCase() === targetEmail.toLowerCase()) {
          const btn = tr.querySelector('button.danger');
          if (btn) btn.click();
          break;
        }
      }
    }, tempAccount.email);

    await new Promise(r => setTimeout(r, 1200));

    const postDeleteEmails = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table.user-list tbody tr'));
      return rows.map(tr => tr.querySelector('code')?.textContent.trim().toLowerCase() || '').filter(Boolean);
    });

    const isStillPresent = postDeleteEmails.includes(tempAccount.email.toLowerCase());
    if (!isStillPresent) {
      console.log(` ✅ Delete function successfully deleted ${tempAccount.email}!`);
    } else {
      console.error(` ❌ Deletion failed for ${tempAccount.email}. Remaining emails:`, postDeleteEmails);
    }
  }

  await browser.close();
  console.log('\n=== Test Completed Successfully ===');
}

testUserManagementActions().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
