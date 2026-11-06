// App-Hülle offline verfügbar halten; neue Version wird beim nächsten Start geladen.
const CACHE = "angebot-v2";
const FILES = [
  "./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./icon-180.png",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"
];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || e.request.url.includes("api.anthropic.com")) return;
  // Netz zuerst (immer aktuelle Version), Cache als Rückfall ohne Empfang
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
