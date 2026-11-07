import puppeteer from 'puppeteer';

async function testClick() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  // Add observer on cloudDbModal class and style
  await page.evaluate(() => {
    window._modalMutations = [];
    const target = document.getElementById('cloudDbModal');
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        window._modalMutations.push({
          type: m.type,
          attributeName: m.attributeName,
          value: target.getAttribute(m.attributeName),
          stack: new Error().stack
        });
      }
    });
    observer.observe(target, { attributes: true });

    // Track clicks on cloudDbBtn
    const btn = document.getElementById('cloudDbBtn');
    btn.addEventListener('click', (e) => {
      console.log('cloudDbBtn clicked! target:', e.target.tagName, 'currentTarget:', e.currentTarget.id);
    });
  });

  console.log('--- Clicking #cloudDbBtn via page.click ---');
  await page.click('#cloudDbBtn');
  await new Promise(r => setTimeout(r, 500));

  const mutations = await page.evaluate(() => window._modalMutations);
  console.log('Modal mutations:', JSON.stringify(mutations, null, 2));

  const finalState = await page.evaluate(() => {
    const m = document.getElementById('cloudDbModal');
    return {
      className: m.className,
      display: m.style.display,
      computedDisplay: window.getComputedStyle(m).display
    };
  });
  console.log('Final modal state:', finalState);

  await browser.close();
}

testClick().catch(console.error);
