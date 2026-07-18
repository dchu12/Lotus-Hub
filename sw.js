/* sw.js — service worker for Lotus Hub (installable PWA).
 * Network-first with HTTP-cache bypass so the newest deploy always loads on open;
 * falls back to the runtime cache only when offline. */
var CACHE = "lotus-hub-v53";
var SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=53",
  "./app.js?v=52",
  "./firebase.js?v=39",
  "./firebase-config.js?v=3",
  "./manifest.json",
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = req.url;
  // Never intercept Firebase / Google traffic — always straight to network.
  if (url.indexOf("firebase") > -1 || url.indexOf("googleapis") > -1 || url.indexOf("gstatic") > -1) {
    return;
  }
  // Network-first, bypassing the browser HTTP cache so a fresh deploy always
  // wins on open. Cache a copy for offline. Fall back to cache when offline.
  e.respondWith(
    fetch(req, { cache: "no-store" })
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match("./index.html"); });
      })
  );
});
