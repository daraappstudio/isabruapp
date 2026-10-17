const CACHE = "bunny-v7";
const SHELL = [
  "/", "/index.html", "/prefs.js", "/manifest.json",
  "/app/", "/app/index.html", "/app/style.css", "/app/app.js", "/app/config.js",
  "/vendor/supabase.js", "/vendor/lucide.min.js", "/vendor/qrcode.js",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/favicon.svg", "/fonts/onest-latin-wght-normal.woff2",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Rede primeiro (pega atualizações), cache se estiver offline. Supabase não passa por aqui.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const same = url.origin === self.location.origin;
  const font = /fonts\.(googleapis|gstatic)\.com$/.test(url.host);
  if (!same && !font) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match(url.pathname.startsWith("/app") ? "/app/index.html" : "/index.html")))
  );
});
