/* TapMenu service worker — installable + offline app shell.
   Network-first for same-origin GETs so new deploys show when online, falling
   back to cache when offline. Menu data comes from Firestore at runtime and is
   not part of the cached shell. */
var CACHE = "lotus-tapmenu-v1";
var CACHE_PREFIX = "lotus-tapmenu-"; // only ever manage caches under this prefix
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=1",
  "./app.js?v=1",
  "./manifest.webmanifest",
  "./icon.svg",
  "/firebase-config.js?v=1",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      // Delete only OUR OWN superseded caches. This app shares the origin with
      // the other Lotus apps, so we must never touch a cache that isn't ours.
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k.indexOf(CACHE_PREFIX) === 0) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin (Firebase, QR CDN)

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === "basic") {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match("./index.html") || caches.match("./");
      });
    })
  );
});
