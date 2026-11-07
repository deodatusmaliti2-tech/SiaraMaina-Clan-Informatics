import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('index.html', 'utf8');

// Set up virtual DOM with script execution enabled
const virtualConsole = new (await import('jsdom')).VirtualConsole();
const errors = [];
const logs = [];

virtualConsole.on('error', (err) => {
  const msg = err && err.message ? err.message : String(err);
  errors.push(msg);
  console.error('[Browser Error]', msg);
});

virtualConsole.on('warn', (msg) => {
  // console.warn('[Browser Warn]', msg);
});

virtualConsole.on('log', (msg) => {
  logs.push(msg);
  // console.log('[Browser Log]', msg);
});

const dom = new JSDOM(html, {
  url: 'http://localhost:3000/',
  runScripts: 'dangerously',
  resources: 'usable',
  virtualConsole
});

const { window } = dom;
const { document } = window;

// Polyfill things if needed
window.alert = (msg) => console.log('[Alert called]:', msg);
window.confirm = (msg) => true;
window.prompt = () => '';
window.scrollTo = () => {};

// Wait for DOMContentLoaded and async init
await new Promise(resolve => setTimeout(resolve, 2000));

console.log('--- Testing Topbar Buttons ---');

const buttonsToTest = [
  { name: 'Catalogue Dropdown', selector: '.command-group:first-child .dropdown:first-child .top-button', expectMenu: 'catalogueMenu' },
  { name: 'Family Tree Dropdown', selector: '.command-group:first-child .dropdown:nth-child(2) .top-button', expectMenu: 'treeMenu' },
  { name: 'Filter Button', selector: '.command-group:first-child button[onclick*="openCustomFilter"]' },
  { name: 'Statistics Button', selector: '.command-group:first-child button[onclick*="showStatistics"]' },
  { name: 'Geographical Map Button', selector: '.command-group:first-child button[onclick*="showMap"]' },
  { name: 'Contact Button', selector: '.command-group:first-child button[onclick*="showContactForms"]' },
  { name: 'View Dropdown', selector: '.command-group:nth-child(2) .dropdown:first-child .top-button', expectMenu: 'viewMenu' },
  { name: 'Utilities Dropdown', selector: '.command-group:nth-child(2) .dropdown:nth-child(2) .top-button', expectMenu: 'utilitiesMenu' },
  { name: '+ Add Member Button', selector: '.action-group button.command-add' },
  { name: '☁️ Firestore DB Button', selector: '#cloudDbBtn', expectModal: 'cloudDbModal' },
  { name: '🩺 Diagnostics Button', selector: '#topbarDiagnosticsBtn', expectModal: 'inbuiltDiagnosticsModal' },
  { name: '🔑 Sign In (Firebase) Button', selector: '#firebaseAuthBtn', expectModal: 'loginScreen' },
  { name: '👥 Users Button', selector: '#topbarUserMgmtBtn', expectModal: 'userManagementModal' }
];

for (const btnInfo of buttonsToTest) {
  const btn = document.querySelector(btnInfo.selector);
  if (!btn) {
    console.error(`❌ NOT FOUND: ${btnInfo.name} (selector: ${btnInfo.selector})`);
    continue;
  }
  
  const display = window.getComputedStyle(btn).display;
  console.log(`\nTesting: [${btnInfo.name}] (id: ${btn.id || 'none'}, display: ${display})`);
  
  // Attempt click
  try {
    btn.click();
    console.log(`  Click triggered successfully.`);
    
    if (btnInfo.expectMenu) {
      const menu = document.getElementById(btnInfo.expectMenu);
      const isOpen = menu && menu.classList.contains('open');
      console.log(`  Dropdown ${btnInfo.expectMenu} open: ${isOpen ? '✅ YES' : '❌ NO'}`);
    }
    
    if (btnInfo.expectModal) {
      const modal = document.getElementById(btnInfo.expectModal);
      const isOpen = modal && (modal.classList.contains('open') || modal.style.display === 'flex');
      console.log(`  Modal ${btnInfo.expectModal} open: ${isOpen ? '✅ YES' : '❌ NO'} (classes: ${modal?.className}, display: ${modal?.style.display})`);
      
      // Test closing modal
      if (modal && typeof window.closeModal === 'function') {
        window.closeModal(btnInfo.expectModal);
        const isClosed = !modal.classList.contains('open') && modal.style.display !== 'flex';
        console.log(`  Modal ${btnInfo.expectModal} closed again: ${isClosed ? '✅ YES' : '❌ NO'}`);
      } else if (modal && btnInfo.expectModal === 'loginScreen' && typeof window.closeLoginModal === 'function') {
        window.closeLoginModal();
        const isClosed = !modal.classList.contains('open') && modal.style.display !== 'flex';
        console.log(`  Login Modal closed again: ${isClosed ? '✅ YES' : '❌ NO'}`);
      }
    }
  } catch (err) {
    console.error(`  ❌ ERROR on click:`, err);
  }
}

console.log('\nTotal errors caught during execution:', errors.length);
