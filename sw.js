const C = "pnkas-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e =>
  e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));

self.addEventListener("activate", e =>
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(n => n !== C).map(n => caches.delete(n))))
    .then(() => self.clients.claim())));

self.addEventListener("fetch", e => {
  if(e.request.method !== "GET") return;
  // navigations: network first, so a deploy lands on the next open. Cache is only the offline fallback.
  if(e.request.mode === "navigate"){
    e.respondWith(fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
