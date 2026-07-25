/* Lotus Hub — a simple launcher that links out to every Lotus app.
   Vanilla JS, no build step. Edit the APPS list to add or reorder apps. */
(function () {
  "use strict";

  var THEME_KEY = "lotus-hub:theme";

  // Each app: emoji, name, tagline, href (relative to /hub/), and an accent.
  var APPS = [
    { emoji: "🏓", name: "Pickleball", tag: "Open play, roster & live rankings", href: "../", accent: "#c01f2c" },
    { emoji: "🎯", name: "Coach Console", tag: "Lessons, students, drills & who owes you", href: "../coach/", accent: "#0f9d58" },
    { emoji: "📈", name: "Retirement", tag: "Are we on track to retire?", href: "../retirement/", accent: "#0f766e" },
    { emoji: "🗼", name: "Trip Planner", tag: "Plan your next city adventure", href: "../trip-planner/", accent: "#4f46e5" },
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

  (function boot() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (!saved) saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(saved);
    greet();
    render();
  })();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
