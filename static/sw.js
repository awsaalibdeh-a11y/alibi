/* Alibi: lets the game install and open quickly. The game itself always talks to the server. */
const CACHE = "alibi-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/")) return;
  if (u.origin === location.origin && u.pathname.startsWith("/static/")) { e.respondWith(caches.open(CACHE).then(async (c) => { const hit = await c.match(e.request); const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit); return hit || net; })); return; }
  if (u.pathname.endsWith(".apk")) return;                                       // the Android app is a download: straight to the network, never kept as the page
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); if (r.ok && u.pathname === "/") caches.open(CACHE).then((c) => c.put("/", copy)); return r; }).catch(() => caches.match("/")));
});
