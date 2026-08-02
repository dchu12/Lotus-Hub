/* Lotus Hub — a simple launcher that links out to every Lotus app.
   Vanilla JS, no build step. Edit the APPS list to add or reorder apps. */
(function () {
  "use strict";

  var THEME_KEY = "lotus-hub:theme";

  // Each app: emoji, name, tagline, href (relative to /hub/), and an accent.
  var APPS = [
    { emoji: "🏓", name: "Pickleball", tag: "Open play, roster & live rankings", href: "../", accent: "#c01f2c" },
    { emoji: "🎯", name: "Coach Console", tag: "Lessons, students, drills & who owes you", href: "../coach/", accent: "#0f9d58" },
    { emoji: "🍽️", name: "TapMenu", tag: "QR menus & link pages for local businesses", href: "../menu/", accent: "#e8562a" },
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function render() {
    document.getElementById("apps").innerHTML = APPS.map(function (a) {
      return '<a class="app" href="' + esc(a.href) + '" style="--accent:' + a.accent + '">' +
        '<span class="app-ico">' + a.emoji + '</span>' +
        '<span class="app-txt"><span class="app-name">' + esc(a.name) + '</span>' +
        '<span class="app-tag">' + esc(a.tag) + '</span></span>' +
        '<span class="app-go" aria-hidden="true">→</span>' +
      '</a>';
    }).join("");
  }

  function greet() {
    var h = new Date().getHours();
    var g = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    document.getElementById("greeting").textContent = g + " 🪷";
  }

  function setTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", mode === "dark" ? "#171213" : "#c01f2c");
    document.getElementById("themeToggle").textContent = mode === "dark" ? "☀️" : "🌙";
  }

  document.getElementById("themeToggle").addEventListener("click", function () {
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    setTheme(dark ? "light" : "dark");
  });

  function boot() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (!saved) saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(saved);
    greet();
    render();
  }

  // Held by the access lock (lock.js) until the owner signs in.
  if (window.__LOTUS_LOCK_ACTIVE && !window.__LOTUS_UNLOCKED) {
    window.addEventListener("lotus-unlocked", boot, { once: true });
  } else {
    boot();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
