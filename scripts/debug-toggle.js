import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('index.html', 'utf8');

const dom = new JSDOM(html, {
  url: 'http://localhost:3000/',
  runScripts: 'dangerously',
  resources: 'usable'
});

const { window } = dom;
const { document } = window;

window.requestAnimationFrame = (cb) => setTimeout(cb, 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.alert = (msg) => console.log('[Alert called]:', msg);
window.confirm = (msg) => true;
window.prompt = () => '';
window.scrollTo = () => {};

await new Promise(resolve => setTimeout(resolve, 1500));

console.log('--- Testing Dropdown Toggle ---');
const treeBtn = Array.from(document.querySelectorAll('.top-button')).find(b => b.textContent.includes('Family Tree'));
console.log('treeBtn found:', !!treeBtn, 'onclick:', treeBtn?.getAttribute('onclick'));

const treeMenu = document.getElementById('treeMenu');
console.log('treeMenu before click:', treeMenu.className);

// Add event listener spy to document
document.addEventListener('click', (e) => {
  console.log('Document click saw target:', e.target.tagName, e.target.className, 'openMenus:', document.querySelectorAll('.dropdown-menu.open').length);
}, true); // capture

treeBtn.click();
console.log('treeMenu after click:', treeMenu.className);
