/* Only the public offline screen and icons are cached. Account data is network-only. */
const shellCache = "closr-public-shell-v1";
const publicAssets = ["/offline.html", "/pwa-icon-192.png", "/pwa-icon-512.png", "/apple-touch-icon.png"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(shellCache).then((cache) => cache.addAll(publicAssets)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("closr-public-shell-") && key !== shellCache).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match("/offline.html")) || Response.error()));
  }
});
