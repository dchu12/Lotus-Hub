/* Coach Console service worker — makes the app installable and offline-capable.
   Strategy: network-first for same-origin GETs (so new deploys show when
   you're online), falling back to the cache when the network is unavailable.
   All data lives in localStorage, so the SW only caches the app shell. */
var CACHE = "lotus-coach-v1";
var CACHE_PREFIX = "lotus-coach-"; // only ever manage caches under this prefix
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=1",
  "./app.js?v=1",
  "./manifest.webmanifest",
  "./icon.svg",
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
  if (url.origin !== self.location.origin) return; // don't touch cross-origin

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
