/* firebase-messaging-sw.js — background push handler for Lotus Hub.
 *
 * Firebase Cloud Messaging auto-registers this file (by name) to show session
 * reminder notifications when the app is closed or in the background. The config
 * below is the same PUBLIC config as firebase-config.js (inlined because a
 * service worker has no `window`). */
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyC9b-VCWEG3K1yf7WZee6uo4az95VItJqc",
  authDomain: "lots-hub.firebaseapp.com",
  projectId: "lots-hub",
  storageBucket: "lots-hub.firebasestorage.app",
  messagingSenderId: "409895305585",
  appId: "1:409895305585:web:30e93ab6598ddd389e36d0",
});

var messaging = firebase.messaging();

// Background message → show a notification.
messaging.onBackgroundMessage(function (payload) {
  var n = (payload && payload.notification) || {};
  self.registration.showNotification(n.title || "Lotus Hub 🪷", {
    body: n.body || "",
    icon: "/icon-192.png",
    badge: "/favicon-64.png",
    data: (payload && payload.data) || {},
  });
});

// Tap a notification → focus an open tab or open the app.
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var link = (e.notification.data && e.notification.data.link) || "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ("focus" in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});
