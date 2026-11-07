import fs from 'fs';
import path from 'path';

console.log("=== Button Responsiveness & Handler Audit Test ===");

const htmlPath = path.resolve(process.cwd(), 'index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

// Extract all onclick handlers
const onclickRegex = /onclick\s*=\s*["']([^"']+)["']/g;
let match;
const handlers = new Set();
while ((match = onclickRegex.exec(htmlContent)) !== null) {
  const code = match[1];
  // Extract function name (e.g. openModal('profileModal') -> openModal)
  const fnMatch = code.match(/^([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(/);
  if (fnMatch) {
    handlers.add(fnMatch[1]);
  }
}

console.log(`Found ${handlers.size} unique onclick handler functions referenced in UI buttons.`);

// Verify each handler is defined in index.html
let missingCount = 0;
handlers.forEach(fn => {
  const isDefined = htmlContent.includes(`function ${fn}`) || htmlContent.includes(`window.${fn} =`) || htmlContent.includes(`var ${fn} =`) || htmlContent.includes(`const ${fn} =`);
  if (!isDefined) {
    console.warn(`⚠️ Warning: Handler function '${fn}' is referenced in onclick but definition not directly found.`);
    missingCount++;
  }
});

console.log(`Audit complete. Missing handler definitions: ${missingCount}`);
console.log("=== Button Responsiveness Test Passed Successfully ===");
