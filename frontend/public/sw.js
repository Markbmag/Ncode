/* Ncode's service worker (K2): the app opens from the home screen even without a connection.
 *
 * - Pages: from the network (3 s at most), else the last saved copy of the app.
 * - Built files (/assets/*, hashed names): saved the first time, then read from the phone.
 * - Icons and manifests: from the phone at once, refreshed in the background.
 * - Never touched: /api and /ws (data always comes from the server, nothing is stored offline),
 *   other websites, anything but GET.
 *
 * Bump VERSION to throw away everything saved by an older version.
 */
const VERSION = 'ncode-1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const MAX_ASSETS = 150;
const PAGE_TIMEOUT_MS = 3000;
const PRECACHE = ['/', '/manifest.webmanifest', '/kanban.webmanifest', '/favicon.svg', '/icons/ncode-192.png', '/icons/kanban-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(`${VERSION}-`)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function untouched(url, request) {
  return request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/');
}

async function page(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), PAGE_TIMEOUT_MS)),
    ]);
    // every address serves the same app page, so one copy is enough
    if (response.ok && response.type === 'basic') await cache.put('/', response.clone());
    return response;
  } catch {
    const saved = await cache.match('/');
    return saved || Response.error();
  }
}

async function asset(request) {
  const cache = await caches.open(ASSETS);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(old);
  }
  return response;
}

async function fresh(request) {
  const cache = await caches.open(SHELL);
  const saved = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => saved || Response.error());
  return saved || update;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (untouched(url, request)) return;
  if (request.mode === 'navigate') event.respondWith(page(request));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(asset(request));
  else if (url.pathname.startsWith('/icons/') || url.pathname.endsWith('.webmanifest') || url.pathname === '/favicon.svg') event.respondWith(fresh(request));
});
