/* Lotus Hub launcher service worker — installable + offline.
   Network-first for same-origin GETs, cache fallback when offline.
   Only manages caches under its own prefix so it never touches the other apps. */
var CACHE = "lotus-hub-v1";
var CACHE_PREFIX = "lotus-hub-";
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
  if (url.origin !== self.location.origin) return;

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
