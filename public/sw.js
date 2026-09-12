const C = "pnkas-v2";

self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k.filter((n) => n !== C).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // never cache auth or API traffic — a stale session or stale ledger is worse than an error
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/sign-")) return;

  // navigations: network first so a deploy lands on next open; cache is the offline fallback
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(C).then((c) => c.put(e.request, copy));
          return r;
        })
        .catch(() => caches.match(e.request).then((r) => r || caches.match("/")))
    );
    return;
  }

  // build assets are content-hashed, so cache-first is safe and fast
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit ||
      fetch(e.request).then((r) => {
        if (r.ok && (url.pathname.startsWith("/_next/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname))) {
          const copy = r.clone();
          caches.open(C).then((c) => c.put(e.request, copy));
        }
        return r;
      })
    )
  );
});
