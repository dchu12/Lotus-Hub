/* Lotus lock — restricts a page to an owner email allowlist using Firebase Auth.
   Include a page's scripts in this order, BEFORE the page's own app script:
     <script src=".../firebase-app-compat.js"></script>
     <script src=".../firebase-auth-compat.js"></script>
     <script src="/firebase-config.js"></script>
     <script src="/lock.js"></script>
     <script src="app.js"></script>
   Any visitor who is not signed in as an allowed account sees a full-screen
   lock, and the page's app script is held until an allowed account signs in.

   Scope of protection: this hides the page and blocks casual/member access.
   It is not a hard data wall — the page's code is public on static hosting —
   but the apps it guards keep their data only in this device's localStorage,
   so there is nothing for a signed-out visitor to see. */
(function () {
  "use strict";

  // The ONLY accounts allowed to open this page (lowercase Google/Gmail addresses).
  // Add a second address on its own line to share access.
  var ALLOWED = [
    "kokwithchu@gmail.com",
  ];

  // Remembers a prior successful sign-in on THIS device so the owner can still
  // open the page offline, when the Firebase SDK (loaded from a CDN) is absent.
  var FLAG = "lotus-lock:ok";

  // Signals to the page's app script that it must wait for unlock before booting.
  window.__LOTUS_LOCK_ACTIVE = true;
  window.__LOTUS_UNLOCKED = false;

  function norm(e) { return String(e || "").trim().toLowerCase(); }
  function isAllowed(email) { return ALLOWED.indexOf(norm(email)) !== -1; }

  // ---- Lock overlay --------------------------------------------------------
  var style = document.createElement("style");
  style.textContent =
    "#lotus-lock{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;" +
    "background:linear-gradient(160deg,#c01f2c,#7d1420);color:#fff;padding:24px;" +
    "font-family:'Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif}" +
    "#lotus-lock .box{max-width:360px;width:100%;text-align:center}" +
    "#lotus-lock .lotus{font-size:52px;line-height:1}" +
    "#lotus-lock h1{margin:.35em 0 .15em;font-size:1.5rem;letter-spacing:-.01em}" +
    "#lotus-lock p{margin:.3em 0 1.2em;opacity:.92;line-height:1.5;font-size:.95rem}" +
    "#lotus-lock button{appearance:none;border:0;border-radius:12px;padding:12px 18px;font:inherit;" +
    "font-weight:700;cursor:pointer;width:100%;background:#fff;color:#c01f2c}" +
    "#lotus-lock button.ghost{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.5);margin-top:10px}" +
    "#lotus-lock .msg{margin-top:14px;font-size:.84rem;opacity:.92;min-height:1.2em}";
  (document.head || document.documentElement).appendChild(style);

  var el = document.createElement("div");
  el.id = "lotus-lock";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.innerHTML =
    '<div class="box">' +
      '<div class="lotus">🪷</div>' +
      '<h1>Private area</h1>' +
      '<p id="lotus-lock-sub">Sign in with the owner account to continue.</p>' +
      '<button id="lotus-lock-in" type="button">Sign in with Google</button>' +
      '<button id="lotus-lock-out" type="button" class="ghost" hidden>Use a different account</button>' +
      '<div class="msg" id="lotus-lock-msg"></div>' +
    '</div>';
  function mount() { (document.body || document.documentElement).appendChild(el); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  function byId(id) { return document.getElementById(id); }
  function set(sub, msg, showIn, showOut) {
    if (byId("lotus-lock-sub")) byId("lotus-lock-sub").textContent = sub;
    if (byId("lotus-lock-msg")) byId("lotus-lock-msg").textContent = msg || "";
    if (byId("lotus-lock-in")) byId("lotus-lock-in").hidden = !showIn;
    if (byId("lotus-lock-out")) byId("lotus-lock-out").hidden = !showOut;
  }

  var revealed = false;
  function reveal() {
    revealed = true;
    window.__LOTUS_UNLOCKED = true;
    if (el && el.parentNode) el.parentNode.removeChild(el);
    window.dispatchEvent(new Event("lotus-unlocked"));
  }
  function relock() {
    // Signed out after being unlocked — reload to re-lock cleanly.
    if (revealed) window.location.reload();
  }

  // ---- Firebase auth -------------------------------------------------------
  var auth = null;
  try {
    if (window.firebase && window.FIREBASE_CONFIG) {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      auth = firebase.auth();
    }
  } catch (e) { auth = null; }

  if (!auth) {
    // Offline / Firebase unavailable: allow only if this device signed in before.
    var ok = false; try { ok = !!localStorage.getItem(FLAG); } catch (e) {}
    if (ok) { reveal(); return; }
    set("You appear to be offline. Connect to the internet once to sign in.", "", false, false);
    return;
  }

  document.addEventListener("click", function (ev) {
    var id = ev.target && ev.target.id;
    if (id === "lotus-lock-in") {
      set("Signing in…", "", false, false);
      var provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithPopup(provider).catch(function (err) {
        set("Sign in with the owner account to continue.",
          (err && err.message) ? err.message : "Sign-in was cancelled.", true, false);
      });
    } else if (id === "lotus-lock-out") {
      auth.signOut();
    }
  });

  auth.onAuthStateChanged(function (u) {
    if (u && isAllowed(u.email)) {
      try { localStorage.setItem(FLAG, "1"); } catch (e) {}
      reveal();
    } else if (u) {
      try { localStorage.removeItem(FLAG); } catch (e) {}
      if (revealed) { relock(); return; }
      set("The account " + (u.email || "") + " isn’t authorized here.",
        "Ask the owner for access, or switch accounts.", false, true);
    } else {
      try { localStorage.removeItem(FLAG); } catch (e) {}
      if (revealed) { relock(); return; }
      set("Sign in with the owner account to continue.", "", true, false);
    }
  });
})();
