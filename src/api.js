function getAuthInstance() {
  if (typeof window !== 'undefined') {
    if (window.auth) return window.auth;
    if (window.firebase && typeof window.firebase.auth === 'function') {
      return window.firebase.auth();
    }
  }
  return null;
}

export const auth = {
  get currentUser() {
    const inst = getAuthInstance();
    return inst ? inst.currentUser : null;
  }
};

const API_BASE = '';

async function adminHeaders() {
  const inst = getAuthInstance();
  const user = inst ? inst.currentUser : null;
  if (!user) {
    throw new Error('Administrator sign-in required');
  }
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

export async function submitContact(name, email, message) {
  const res = await fetch(`${API_BASE}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, message }),
  });
  return res.json();
}

export async function getContacts() {
  const res = await fetch(`${API_BASE}/api/contact`, { headers: await adminHeaders() });
  return res.json();
}

export async function subscribeNewsletter(email) {
  const res = await fetch(`${API_BASE}/api/newsletter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return res.json();
}

export async function getStats() {
  const res = await fetch(`${API_BASE}/api/stats`, { headers: await adminHeaders() });
  return res.json();
}

export async function saveContent(key, value) {
  const authHdr = await adminHeaders();
  const res = await fetch(`${API_BASE}/api/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHdr },
    body: JSON.stringify({ key, value }),
  });
  return res.json();
}

export async function getContent(key) {
  const res = await fetch(`${API_BASE}/api/content?key=${encodeURIComponent(key)}`);
  return res.json();
}

export async function trackVisitor(path) {
  const res = await fetch(`${API_BASE}/api/visitor?path=${encodeURIComponent(path)}`, { method: 'POST' });
  return res.json();
}