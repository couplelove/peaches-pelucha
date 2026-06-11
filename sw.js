// Service worker for Peaches & Pelucha.
// Strategy: cache the app shell so it installs and opens instantly / offline.
// (Live data still needs a connection — that's Supabase, never cached.)
const CACHE = "pp-v8";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./engine.js",
  "./game.js",
  "./push.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ---- Push notifications ("Your turn" alerts) ----
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title || "Peaches & Pelucha", {
      body: data.body || "It's your turn! 💗",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "pp-turn",          // collapse repeats into one notification
      data: { url: "./" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
      for (const w of ws) if ("focus" in w) return w.focus();
      return clients.openWindow("./");
    })
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never touch Supabase / API traffic — always go to the network.
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== "GET") return;

  // Network-first for our own files so updates show up; fall back to cache.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match("./index.html")))
  );
});
