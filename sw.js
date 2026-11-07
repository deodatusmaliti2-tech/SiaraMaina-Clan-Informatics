/**
 * SiaraMaina Clan Informatics - Background Service Worker
 * 
 * Provides:
 * 1. Background sync & periodic sync verification between 'siaraMainaClan/records' and '/members'.
 * 2. Cross-tab message broadcasting for real-time synchronization state.
 * 3. Offline resilience for core shell assets.
 */

const CACHE_NAME = 'siaramaina-v2.3-github-synced';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/SiaraMainaInformatics.html',
  '/diagnostic.html',
  '/siara-maina-clan-data.json',
  '/firebase-applet-config.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching static assets');
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('[ServiceWorker] Pre-cache partial warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Periodic Background Sync API handler
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'verify-members-sync') {
    console.log('[ServiceWorker] Received periodic background sync event: verify-members-sync');
    event.waitUntil(notifyClientsToVerifyMembersSync());
  }
});

// Broadcast periodic verification requests to all active browser windows/tabs
async function notifyClientsToVerifyMembersSync(reason = 'periodic-timer') {
  const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  console.log(`[ServiceWorker] Broadcasting verification trigger to ${allClients.length} clients`);
  
  for (const client of allClients) {
    client.postMessage({
      type: 'VERIFY_MEMBERS_SYNC_TRIGGER',
      reason,
      timestamp: new Date().toISOString()
    });
  }
}

// Background timer inside active ServiceWorker worker scope
let verificationIntervalId = null;
function startWorkerVerificationInterval(intervalMs = 3 * 60 * 1000) { // every 3 minutes
  if (verificationIntervalId) clearInterval(verificationIntervalId);
  verificationIntervalId = setInterval(() => {
    notifyClientsToVerifyMembersSync('service-worker-interval');
  }, intervalMs);
}

// Message channel for client interaction
self.addEventListener('message', (event) => {
  if (!event.data) return;

  switch (event.data.type) {
    case 'START_PERIODIC_SYNC':
      startWorkerVerificationInterval(event.data.intervalMs || 180000);
      event.ports?.[0]?.postMessage({ status: 'started' });
      break;

    case 'TRIGGER_IMMEDIATE_SYNC_CHECK':
      notifyClientsToVerifyMembersSync('manual-request');
      event.ports?.[0]?.postMessage({ status: 'triggered' });
      break;

    case 'MEMBERS_SYNC_REPORT':
      // Broadcast verified status to all other tabs
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => {
          if (c.id !== event.source?.id) {
            c.postMessage({
              type: 'MEMBERS_SYNC_STATUS_UPDATED',
              data: event.data.payload
            });
          }
        });
      });
      break;
  }
});
