/* WorkOS service worker: Web Push, notification clicks, and an app-shell cache so Today opens offline.
 * Cache scope (QA r1 Q19): only the shell (`/`, any query string collapses onto it), the content-hashed
 * `/assets/*` files and the fixed icons/manifest/theme. Nothing else is stored, so the cache stays small
 * and can never hold a response for an arbitrary URL. Supabase calls are never cached here.
 * The page can empty the cache (for example on sign-out) with postMessage('workos:clear-cache'). */
const SHELL = 'workos-shell-v2';
const FIXED = ['/favicon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/manifest.webmanifest', '/theme.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/favicon.svg'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('message', (e) => {
  if (e.data === 'workos:clear-cache' && e.source && new URL(e.source.url).origin === self.location.origin) {
    e.waitUntil(caches.delete(SHELL));
  }
});

/** The cache key for a same-origin GET, or null when it must not be cached. */
function cacheKey(req, url) {
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    return url.pathname === '/' || url.pathname === '/index.html' ? '/' : null;
  }
  if (url.search) return null;
  if (url.pathname.startsWith('/assets/') && !url.pathname.includes('..')) return url.pathname;
  return FIXED.includes(url.pathname) ? url.pathname : null;
}

// Network first, then the cache, for the allowlisted paths only; everything else goes straight to the network.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const key = cacheKey(req, url);
  if (!key) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit || caches.match('/'))),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'WorkOS', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'WorkOS';
  event.waitUntil(
    self.registration.showNotification(title, { body: data.body || '', tag: data.tag, data: { url: data.url || '/#/' }, icon: '/favicon.svg' }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only same-origin targets: a payload can never send the phone to another site.
  let target = '/#/';
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || '/#/', self.location.origin);
    if (u.origin === self.location.origin) target = u.href;
  } catch { /* keep the default */ }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { if (c.navigate) c.navigate(target).catch(() => undefined); return c.focus(); }
      }
      return self.clients.openWindow(target);
    }),
  );
});
