import fs from 'fs';
import path from 'path';

console.log('=== Cleaning up duplicate user records in server/data/users.json ===');

const jsonPath = path.resolve(process.cwd(), 'server/data/users.json');
let users = [];
try {
  users = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  console.error('Failed to read users.json:', e);
}

console.log(`Initial user count: ${users.length}`);

const map = new Map();
users.forEach(u => {
  if (!u || !u.email) return;
  const emailKey = String(u.email).toLowerCase().trim();
  if (!map.has(emailKey)) {
    map.set(emailKey, { ...u, email: emailKey });
  } else {
    const existing = map.get(emailKey);
    const existingIsLegacy = String(existing.uid || '').startsWith('user-');
    const newIsLegacy = String(u.uid || '').startsWith('user-');
    let preferredUid = existing.uid || u.uid;
    if (existingIsLegacy && !newIsLegacy && u.uid) {
      preferredUid = u.uid;
    }
    const merged = {
      ...existing,
      ...u,
      uid: preferredUid,
      email: emailKey,
      displayName: u.displayName || existing.displayName || emailKey.split('@')[0],
      role: (existing.role === 'admin' || u.role === 'admin') ? 'admin' : (existing.role === 'editor' || u.role === 'editor') ? 'editor' : 'viewer',
      approved: Boolean(existing.approved || u.approved),
      active: existing.active !== false && u.active !== false
    };
    map.set(emailKey, merged);
  }
});

const deduplicated = Array.from(map.values());
fs.writeFileSync(jsonPath, JSON.stringify(deduplicated, null, 2));

console.log(`Cleaned user count: ${deduplicated.length}`);
console.log('Final Users list in users.json:');
deduplicated.forEach(u => console.log(` - UID: ${u.uid} | Email: ${u.email} | Role: ${u.role} | Name: ${u.displayName}`));

console.log('\n=== User Deduplication Script Completed Successfully ===');
