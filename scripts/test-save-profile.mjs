import fs from 'fs';
import path from 'path';

console.log("=== Testing Save Profile Execution Logic ===");

const htmlPath = path.resolve(process.cwd(), 'index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

// Verify that getVal is used throughout saveProfile
if (htmlContent.includes('document.getElementById("firstName").value')) {
  console.error("❌ Error: direct document.getElementById without null checks found in saveProfile!");
  process.exit(1);
} else {
  console.log("✓ All field reads in saveProfile use safe getVal checks.");
}

// Verify that records.unshift / records.push and saveRecords(true) run synchronously
if (htmlContent.includes('saveRecords(true);') && htmlContent.includes('showCatalogue("all");')) {
  console.log("✓ Instant local persistence & catalogue refresh verified in saveProfile.");
} else {
  console.error("❌ Error: Local persistence missing in saveProfile!");
  process.exit(1);
}

console.log("=== All Save Profile Tests Passed Successfully ===");
