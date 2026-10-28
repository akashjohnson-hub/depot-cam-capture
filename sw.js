// Cam Capture offline helper.
// - The app page: always fetched fresh when there is signal (so updates arrive
//   as before); the last good copy is used when there is no signal.
// - Leaflet (the map library) and the app icons: kept after the first load.
// - Satellite map tiles: kept as they are seen, and all at once with
//   "Save depot map for offline use" in Settings.
// Nothing from the Apps Script backend is stored here: the app keeps its own
// copy of the pole list on the phone.
const SHELL = 'cc-shell-1';
const TILES = 'cc-tiles-1';
const MAX_TILES = 4000;
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
const SHELL_URLS = ['./index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png',
  LEAFLET + 'leaflet.js', LEAFLET + 'leaflet.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(SHELL_URLS.map((u) =>
    fetch(new Request(u, { cache: 'reload', mode: u.startsWith('http') ? 'cors' : 'same-origin' }))
      .then((r) => { if (r.ok) return c.put(u, r); }).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('cc-') && k !== SHELL && k !== TILES).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.hostname === 'server.arcgisonline.com' && url.pathname.indexOf('/tile/') >= 0) { e.respondWith(tile(req)); return; }
  if (req.url.startsWith(LEAFLET)) { e.respondWith(cacheFirst(req.url, SHELL)); return; }
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has('check')) return;          // the app's "is there a new version?" check: network only
  if (req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname)) { e.respondWith(page(req)); return; }
  if (/\.(png|webmanifest)$/.test(url.pathname)) e.respondWith(cacheFirst(url.origin + url.pathname, SHELL, req));
});

async function page(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await timeout(fetch(req), 8000);
    if (res && res.ok && (res.headers.get('content-type') || '').indexOf('text/html') >= 0) cache.put('./index.html', res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match('./index.html');
    return hit || Response.error();
  }
}
async function cacheFirst(key, name, req) {
  const cache = await caches.open(name);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(req || new Request(key, { mode: 'cors' }));
  if (res && res.ok) cache.put(key, res.clone());
  return res;
}
let tilePuts = 0;
async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(req.url, { mode: 'cors' });
    if (res.ok) {
      await cache.put(req.url, res.clone());
      if (++tilePuts % 100 === 0) trim(cache);
    }
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}
function timeout(p, ms) {
  return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), ms); p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });
}
