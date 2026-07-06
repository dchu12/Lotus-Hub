/* sw.js — minimal service worker so Lotus Hub is installable as a PWA.
 * Caches the app shell; network-first for everything else so Firebase stays live. */
var CACHE = "lotus-hub-v2";
var SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=2",
  "./app.js?v=1",
  "./firebase.js?v=1",
  "./firebase-config.js?v=1",
  "./manifest.json",
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) { return k === CACHE ? null : caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  var url = e.request.url;
  // Never cache Firebase / Google traffic — always hit the network.
  if (url.indexOf("firebase") > -1 || url.indexOf("googleapis") > -1 || url.indexOf("gstatic") > -1) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(function () {
      return caches.match(e.request).then(function (r) {
        return r || caches.match("./index.html");
      });
    })
  );
});
