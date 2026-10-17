const CACHE = "bunny-v15";
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

// Notificações de vencimento
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Bunny", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Bunny", {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: d.key || undefined,
    data: { url: d.url || "/app/" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/app/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.includes("/app/")) { c.focus(); return c.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  }));
});
