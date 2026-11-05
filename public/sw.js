// HUM service worker: makes the game installable and lets solo nights run offline.
// Caches are prefixed with the app's id so they never mix with another game's on
// the same origin. Multiplayer (/ws) and the health check always go to the network.

const PREFIX = 'forgecreativeco.hum.';
const SHELL = `${PREFIX}shell-v1`; // the page, manifest, icons and built scripts
const MEDIA = `${PREFIX}media-v1`; // audio, cached as it's first played
const FONTS = `${PREFIX}fonts-v1`;
const KEEP = [SHELL, MEDIA, FONTS];

const SCOPE = new URL(self.registration.scope);
const at = (path) => new URL(path, SCOPE).href;
const STATIC = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

/** The built scripts and styles a page refers to (Vite hashes their names). */
function assetsIn(html) {
  return [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => at(m[1]));
}

/** Cache the page and everything it needs; drop built files it no longer uses. */
async function cachePage(res) {
  const cache = await caches.open(SHELL);
  const html = await res.clone().text();
  const assets = assetsIn(html);
  await cache.put(at('./'), res.clone());
  await Promise.all(assets.map(async (url) => {
    if (!(await cache.match(url))) await cache.add(url).catch(() => {});
  }));
  for (const req of await cache.keys()) {
    if (req.url.includes('/assets/') && !assets.includes(req.url)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(STATIC.slice(1).map(at));
    const page = await fetch(at('./'), { cache: 'no-store' });
    if (page.ok) await cachePage(page);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && !KEEP.includes(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') (await caches.open(name)).put(req, res.clone());
  return res;
}

async function networkFirst(req, name) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(name)).put(req, res.clone());
    return res;
  } catch {
    const hit = await caches.match(req);
    if (hit) return hit;
    throw new Error('offline');
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fonts from Google: keep a copy so the camcorder text survives offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONTS));
    return;
  }
  if (url.origin !== SCOPE.origin || !url.href.startsWith(SCOPE.href)) return;
  const path = url.pathname.slice(SCOPE.pathname.length);
  if (path === 'ws' || path === 'health' || path === 'sw.js') return;

  // The page: always try for the newest version, fall back to the cached one.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) event.waitUntil(cachePage(res.clone()));
        return res;
      } catch {
        return (await caches.match(at('./'))) ?? Response.error();
      }
    })());
    return;
  }
  // Built files have hashed names, so a cached copy is always right.
  if (path.startsWith('assets/')) {
    event.respondWith(cacheFirst(req, SHELL));
    return;
  }
  if (path.startsWith('audio/')) {
    event.respondWith(cacheFirst(req, MEDIA));
    return;
  }
  event.respondWith(networkFirst(req, SHELL));
});
