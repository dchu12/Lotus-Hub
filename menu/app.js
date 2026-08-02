/* TapMenu — a paid QR menu / "link-in-one-place" tool for small local businesses.
 *
 * One app, two modes (decided by the URL):
 *   • Public menu  ?m=<slug>  → what a customer sees when they scan the QR.
 *                               Read-only, no sign-in, always the latest version.
 *   • Owner app    (no ?m=)   → the business owner signs in, builds their menu,
 *                               downloads their QR code and shares the link.
 *
 * Vanilla JS, no build step. Firebase Auth + Firestore (see /firebase-config.js).
 * Each menu is one Firestore doc under `menus/{slug}`; the slug is the public id
 * in the QR URL. Security lives in firestore.rules (public read, owner-only write).
 */
(function () {
  "use strict";

  // ---- Constants --------------------------------------------------------
  var TRIAL_DAYS = 14;
  var THEME_KEY = "tapmenu:theme";
  var THEMES = [
    { id: "sunrise", name: "Sunrise", accent: "#e8562a" },
    { id: "forest", name: "Forest", accent: "#0f9d58" },
    { id: "ocean", name: "Ocean", accent: "#2b73e8" },
    { id: "berry", name: "Berry", accent: "#c0308a" },
    { id: "ink", name: "Ink", accent: "#334155" },
  ];

  // ---- Firebase ---------------------------------------------------------
  var configured = !!window.FIREBASE_CONFIGURED;
  var auth = null, db = null, ready = false;
  function initFirebase() {
    if (ready || !configured || typeof firebase === "undefined") return ready;
    try {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});
      ready = true;
    } catch (e) { ready = false; }
    return ready;
  }

  // ---- Tiny DOM helpers -------------------------------------------------
  var app = document.getElementById("app");
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function el(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function uid4() {
    // Short random id for sections/items. Fine for local uniqueness.
    return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
  }
  function slugify(s) {
    return String(s || "").toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 28)
      .replace(/^-|-$/g, "") || "menu";
  }
  function accentFor(themeId) {
    var t = THEMES.filter(function (x) { return x.id === themeId; })[0];
    return t ? t.accent : THEMES[0].accent;
  }

  // ---- Menu model helpers ----------------------------------------------
  function trialEnds(menu) {
    var start = menu.createdAt || Date.now();
    return start + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  }
  function daysLeft(menu) {
    return Math.max(0, Math.ceil((trialEnds(menu) - Date.now()) / (24 * 60 * 60 * 1000)));
  }
  function isActive(menu) {
    // The paywall: a menu renders publicly while on trial or once upgraded.
    return menu && (menu.plan === "pro" || Date.now() < trialEnds(menu));
  }
  function money(menu, price) {
    var p = String(price == null ? "" : price).trim();
    if (!p) return "";
    var cur = (menu && menu.currency) || "$";
    // If it already contains a currency symbol/letter, leave it as typed.
    return /^[\d.,\s\-–]+$/.test(p) ? cur + p : p;
  }
  function shareUrl(slug) { return location.origin + "/menu/?m=" + encodeURIComponent(slug); }

  // =======================================================================
  //  ROUTER
  // =======================================================================
  function boot() {
    applyStoredTheme();
    var params = new URLSearchParams(location.search);
    var slug = params.get("m");
    if (slug) return renderPublic(slug);
    return renderOwner();
  }

  function applyStoredTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (!saved) saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", saved);
  }
  function toggleMode() {
    var dark = document.documentElement.getAttribute("data-mode") === "dark";
    var next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-mode", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  }

  // =======================================================================
  //  PUBLIC MENU (the page a customer sees after scanning the QR)
  // =======================================================================
  function renderPublic(slug) {
    document.title = "Menu";
    app.innerHTML = '<div class="pub-loading">Loading menu…</div>';
    if (!initFirebase()) {
      app.innerHTML = notReadyHTML();
      return;
    }
    db.collection("menus").doc(slug).get().then(function (snap) {
      if (!snap.exists) { app.innerHTML = publicMissingHTML("This menu doesn’t exist (or the link is mistyped)."); return; }
      var m = snap.data();
      if (!m.published) { app.innerHTML = publicMissingHTML("This menu isn’t published yet. Check back soon!"); return; }
      if (!isActive(m)) { app.innerHTML = publicMissingHTML("This menu is temporarily unavailable."); return; }
      document.title = m.name || "Menu";
      paintPublic(m, slug);
    }).catch(function () {
      app.innerHTML = publicMissingHTML("Couldn’t load this menu. Check your connection and try again.");
    });
  }

  function publicMissingHTML(msg) {
    return '<div class="pub"><div class="pub-card empty"><div class="pub-emoji">🍽️</div>' +
      '<p>' + esc(msg) + '</p><p class="muted small">Powered by TapMenu</p></div></div>';
  }
  function notReadyHTML() {
    return '<div class="pub"><div class="pub-card empty"><div class="pub-emoji">⚙️</div>' +
      '<p>TapMenu isn’t connected to Firebase yet.</p>' +
      '<p class="muted small">Add your keys in <code>firebase-config.js</code> to go live.</p></div></div>';
  }

  function paintPublic(m, slug) {
    var accent = accentFor(m.theme);
    var links = m.links || {};
    var linkBtns = [];
    if (links.website) linkBtns.push(pubLink("🌐", "Website", links.website));
    if (links.instagram) linkBtns.push(pubLink("📸", "Instagram", igUrl(links.instagram)));
    if (links.facebook) linkBtns.push(pubLink("👍", "Facebook", links.facebook));
    if (links.whatsapp) linkBtns.push(pubLink("💬", "WhatsApp", waUrl(links.whatsapp)));
    if (m.phone) linkBtns.push(pubLink("📞", "Call", "tel:" + String(m.phone).replace(/\s+/g, "")));
    if (m.address) linkBtns.push(pubLink("📍", "Directions", "https://maps.google.com/?q=" + encodeURIComponent(m.address)));

    var sections = (m.sections || []).map(function (sec) {
      var items = (sec.items || []).map(function (it) {
        return '<div class="pit' + (it.soldOut ? " sold" : "") + '">' +
          '<div class="pit-main"><span class="pit-name">' + esc(it.name) + (it.soldOut ? ' <span class="soldtag">Sold out</span>' : "") + '</span>' +
          (it.desc ? '<span class="pit-desc">' + esc(it.desc) + '</span>' : "") +
          (it.tags && it.tags.length ? '<span class="pit-tags">' + it.tags.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join("") + '</span>' : "") +
          '</div>' +
          (it.price != null && String(it.price).length ? '<span class="pit-price">' + esc(money(m, it.price)) + '</span>' : "") +
          '</div>';
      }).join("");
      return '<section class="psec"><h2>' + esc(sec.title) + '</h2>' +
        (sec.note ? '<p class="psec-note">' + esc(sec.note) + '</p>' : "") +
        '<div class="pit-list">' + (items || '<p class="muted small">Nothing here yet.</p>') + '</div></section>';
    }).join("");

    app.innerHTML =
      '<div class="pub" style="--accent:' + accent + '">' +
        '<header class="pub-hero">' +
          '<h1>' + esc(m.name || "Menu") + '</h1>' +
          (m.tagline ? '<p class="pub-tag">' + esc(m.tagline) + '</p>' : "") +
          (m.hours ? '<p class="pub-hours">🕒 ' + esc(m.hours) + '</p>' : "") +
        '</header>' +
        (linkBtns.length ? '<div class="pub-links">' + linkBtns.join("") + '</div>' : "") +
        '<main class="pub-body">' + (sections || '<p class="muted center">This menu is being set up.</p>') + '</main>' +
        '<footer class="pub-foot"><a href="' + location.origin + '/menu/" class="madewith">Make your own free menu → <b>TapMenu</b></a></footer>' +
      '</div>';
  }
  function pubLink(ico, label, href) {
    return '<a class="pub-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer"><span>' + ico + '</span>' + esc(label) + '</a>';
  }
  function igUrl(v) { v = String(v).trim(); if (/^https?:/i.test(v)) return v; return "https://instagram.com/" + v.replace(/^@/, ""); }
  function waUrl(v) { v = String(v).trim(); if (/^https?:/i.test(v)) return v; return "https://wa.me/" + v.replace(/[^\d]/g, ""); }

  // =======================================================================
  //  OWNER APP
  // =======================================================================
  var currentUser = null;
  var myMenus = [];       // [{slug, data}]
  var activeSlug = null;  // slug being edited

  function renderOwner() {
    document.title = "TapMenu · Your menus";
    if (!initFirebase()) { app.innerHTML = ownerShell(notReadyHTML()); wireHeader(); return; }
    app.innerHTML = ownerShell('<div class="pub-loading">Loading…</div>');
    wireHeader();
    auth.onAuthStateChanged(function (u) {
      currentUser = u;
      if (!u) return renderSignIn();
      loadMenus();
    });
  }

  function ownerShell(inner) {
    return '' +
      '<header class="hd">' +
        '<div class="hd-brand">' +
          '<span class="hd-logo" aria-hidden="true">🍽️</span>' +
          '<div><h1>TapMenu</h1><p class="hd-sub">Your menu, one QR code</p></div>' +
        '</div>' +
        '<div class="hd-actions">' +
          '<button id="modeToggle" class="icon-btn" type="button" title="Light / dark">🌙</button>' +
          '<button id="signOutBtn" class="icon-btn" type="button" title="Sign out" hidden>⏻</button>' +
        '</div>' +
      '</header>' +
      '<main class="owner" id="owner">' + inner + '</main>';
  }
  function wireHeader() {
    var mt = document.getElementById("modeToggle");
    if (mt) mt.addEventListener("click", toggleMode);
    var so = document.getElementById("signOutBtn");
    if (so) so.addEventListener("click", function () { auth.signOut(); });
  }
  function ownerMain() { return document.getElementById("owner"); }
  function showSignOut(show) { var b = document.getElementById("signOutBtn"); if (b) b.hidden = !show; }

  // ---- Sign in / register ----------------------------------------------
  function renderSignIn() {
    showSignOut(false);
    ownerMain().innerHTML =
      '<div class="auth">' +
        '<div class="auth-hero">' +
          '<div class="auth-emoji">🍽️</div>' +
          '<h2>One QR code for your whole menu</h2>' +
          '<p class="muted">Build your menu once. Print the QR on your tables and counter. Change a price or mark something sold out anytime — customers always see the latest, no reprinting.</p>' +
        '</div>' +
        '<form id="authForm" class="auth-form card">' +
          '<div class="seg" id="authSeg">' +
            '<button type="button" class="seg-btn active" data-mode="signin">Sign in</button>' +
            '<button type="button" class="seg-btn" data-mode="register">Create account</button>' +
          '</div>' +
          '<label class="field"><span>Email</span><input type="email" id="authEmail" autocomplete="email" required placeholder="you@business.com" /></label>' +
          '<label class="field"><span>Password</span><input type="password" id="authPass" autocomplete="current-password" required minlength="6" placeholder="At least 6 characters" /></label>' +
          '<button class="btn primary block" type="submit" id="authSubmit">Sign in</button>' +
          '<div class="or"><span>or</span></div>' +
          '<button class="btn google block" type="button" id="googleBtn">Continue with Google</button>' +
          '<p class="auth-msg" id="authMsg" role="alert"></p>' +
        '</form>' +
      '</div>';

    var mode = "signin";
    var seg = document.getElementById("authSeg");
    seg.addEventListener("click", function (e) {
      var b = e.target.closest(".seg-btn"); if (!b) return;
      mode = b.getAttribute("data-mode");
      seg.querySelectorAll(".seg-btn").forEach(function (x) { x.classList.toggle("active", x === b); });
      document.getElementById("authSubmit").textContent = mode === "register" ? "Create account" : "Sign in";
      document.getElementById("authPass").setAttribute("autocomplete", mode === "register" ? "new-password" : "current-password");
    });

    function fail(err) {
      var map = {
        "auth/invalid-credential": "Email or password is incorrect.",
        "auth/wrong-password": "Email or password is incorrect.",
        "auth/user-not-found": "No account with that email — try Create account.",
        "auth/email-already-in-use": "That email already has an account — try Sign in.",
        "auth/weak-password": "Password must be at least 6 characters.",
        "auth/invalid-email": "That doesn’t look like a valid email.",
      };
      document.getElementById("authMsg").textContent = map[err && err.code] || (err && err.message) || "Something went wrong.";
    }
    document.getElementById("authForm").addEventListener("submit", function (e) {
      e.preventDefault();
      document.getElementById("authMsg").textContent = "";
      var email = document.getElementById("authEmail").value.trim();
      var pass = document.getElementById("authPass").value;
      var p = mode === "register"
        ? auth.createUserWithEmailAndPassword(email, pass)
        : auth.signInWithEmailAndPassword(email, pass);
      p.catch(fail);
    });
    document.getElementById("googleBtn").addEventListener("click", function () {
      document.getElementById("authMsg").textContent = "";
      var provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithPopup(provider).catch(fail);
    });
  }

  // ---- Dashboard: list this owner's menus ------------------------------
  function loadMenus() {
    showSignOut(true);
    ownerMain().innerHTML = '<div class="pub-loading">Loading your menus…</div>';
    db.collection("menus").where("ownerUid", "==", currentUser.uid).get().then(function (qs) {
      myMenus = [];
      qs.forEach(function (d) { myMenus.push({ slug: d.id, data: d.data() }); });
      myMenus.sort(function (a, b) { return (b.data.createdAt || 0) - (a.data.createdAt || 0); });
      renderDashboard();
    }).catch(function (e) {
      ownerMain().innerHTML = '<div class="card"><p>Couldn’t load your menus.</p><p class="muted small">' + esc(e.message || "") + '</p></div>';
    });
  }

  function renderDashboard() {
    if (activeSlug) return renderEditor(activeSlug);
    var cards = myMenus.map(function (m) {
      var d = m.data, dl = daysLeft(d), pro = d.plan === "pro";
      var badge = pro ? '<span class="badge pro">Pro</span>'
        : (isActive(d) ? '<span class="badge trial">Trial · ' + dl + 'd left</span>' : '<span class="badge off">Trial ended</span>');
      return '<button class="menu-card" data-slug="' + esc(m.slug) + '" style="--accent:' + accentFor(d.theme) + '">' +
        '<span class="mc-top"><span class="mc-name">' + esc(d.name || "Untitled menu") + '</span>' + badge + '</span>' +
        '<span class="mc-sub">' + (d.published ? "🟢 Live" : "⚪ Draft") + ' · ' + ((d.sections || []).reduce(function (n, s) { return n + (s.items || []).length; }, 0)) + ' items</span>' +
        '<span class="mc-slug">/menu/?m=' + esc(m.slug) + '</span>' +
      '</button>';
    }).join("");

    ownerMain().innerHTML =
      '<div class="dash-head"><h2>Your menus</h2><button class="btn primary" id="newMenuBtn" type="button">＋ New menu</button></div>' +
      (myMenus.length
        ? '<div class="menu-grid">' + cards + '</div>'
        : '<div class="card empty-state"><div class="pub-emoji">🍽️</div><h3>Create your first menu</h3><p class="muted">It takes about 2 minutes. You’ll get a QR code and a link to share.</p><button class="btn primary" id="newMenuBtn2" type="button">＋ New menu</button></div>');

    var n1 = document.getElementById("newMenuBtn"), n2 = document.getElementById("newMenuBtn2");
    if (n1) n1.addEventListener("click", createMenu);
    if (n2) n2.addEventListener("click", createMenu);
    ownerMain().querySelectorAll(".menu-card").forEach(function (c) {
      c.addEventListener("click", function () { activeSlug = c.getAttribute("data-slug"); renderEditor(activeSlug); });
    });
  }

  function createMenu() {
    var name = window.prompt("What’s your business called?", "");
    if (name == null) return;
    name = name.trim() || "My menu";
    var slug = slugify(name) + "-" + Math.random().toString(36).slice(2, 6);
    var now = Date.now();
    var menu = {
      ownerUid: currentUser.uid,
      name: name, tagline: "", category: "", hours: "", phone: "", address: "",
      currency: "$", theme: "sunrise",
      links: { website: "", instagram: "", facebook: "", whatsapp: "" },
      plan: "trial", published: false,
      sections: [{ id: uid4(), title: "Menu", note: "", items: [] }],
      createdAt: now, updatedAt: now,
    };
    db.collection("menus").doc(slug).set(menu).then(function () {
      myMenus.unshift({ slug: slug, data: menu });
      activeSlug = slug;
      renderEditor(slug);
      toast("Menu created — you’ve got a " + TRIAL_DAYS + "-day free trial ✨");
    }).catch(function (e) { toast("Couldn’t create menu: " + (e.message || "")); });
  }

  function getMenu(slug) { var f = myMenus.filter(function (m) { return m.slug === slug; })[0]; return f ? f.data : null; }

  var saveTimer = null;
  function saveMenu(slug, silent) {
    var m = getMenu(slug); if (!m) return;
    m.updatedAt = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      db.collection("menus").doc(slug).set(m).then(function () {
        if (!silent) toast("Saved ✓");
      }).catch(function (e) { toast("Save failed: " + (e.message || "")); });
    }, 250);
  }

  // ---- Editor -----------------------------------------------------------
  function renderEditor(slug) {
    var m = getMenu(slug); if (!m) { activeSlug = null; return renderDashboard(); }
    var dl = daysLeft(m), pro = m.plan === "pro";

    ownerMain().innerHTML =
      '<div class="ed">' +
        '<div class="ed-bar">' +
          '<button class="btn ghost" id="backBtn" type="button">← All menus</button>' +
          '<div class="ed-bar-right">' +
            (pro ? '<span class="badge pro">Pro</span>' : (isActive(m) ? '<span class="badge trial">Trial · ' + dl + 'd</span>' : '<span class="badge off">Trial ended</span>')) +
            '<label class="switch"><input type="checkbox" id="pubToggle" ' + (m.published ? "checked" : "") + ' /><span>Live</span></label>' +
          '</div>' +
        '</div>' +

        (!isActive(m) ? '<div class="paywall"><b>Your free trial has ended.</b> Your menu is paused for customers. Upgrade to Pro to switch it back on. <button class="btn primary sm" id="upNow" type="button">Upgrade</button></div>' : "") +

        '<div class="ed-grid">' +
          '<section class="card">' +
            '<h3>Business details</h3>' +
            field("Name", "text", "f-name", m.name) +
            field("Tagline", "text", "f-tagline", m.tagline, "e.g. Fresh coffee & pastries") +
            field("Hours", "text", "f-hours", m.hours, "e.g. Mon–Sat 7am–4pm") +
            '<div class="field-row">' +
              field("Phone", "tel", "f-phone", m.phone) +
              field("Currency", "text", "f-currency", m.currency, "$", "narrow") +
            '</div>' +
            field("Address", "text", "f-address", m.address, "Street, city") +
            '<h3 class="mt">Links</h3>' +
            field("Website", "url", "f-website", (m.links || {}).website, "https://…") +
            field("Instagram", "text", "f-instagram", (m.links || {}).instagram, "@yourhandle") +
            field("Facebook", "url", "f-facebook", (m.links || {}).facebook, "https://facebook.com/…") +
            field("WhatsApp", "text", "f-whatsapp", (m.links || {}).whatsapp, "Phone number") +
            '<h3 class="mt">Theme</h3>' +
            '<div class="theme-row" id="themeRow">' + THEMES.map(function (t) {
              return '<button type="button" class="swatch' + (m.theme === t.id ? " on" : "") + '" data-theme="' + t.id + '" style="background:' + t.accent + '" title="' + t.name + '" aria-label="' + t.name + '"></button>';
            }).join("") + '</div>' +
          '</section>' +

          '<section class="card">' +
            '<div class="row-between"><h3>Menu items</h3><button class="btn sm" id="addSectionBtn" type="button">＋ Section</button></div>' +
            '<div id="sections"></div>' +
          '</section>' +

          '<section class="card share-card">' +
            '<h3>Your QR code &amp; link</h3>' +
            '<div class="qr-wrap"><div id="qrBox" class="qrbox"></div></div>' +
            '<div class="share-url"><input type="text" id="shareUrl" readonly value="' + esc(shareUrl(slug)) + '" /><button class="btn sm" id="copyBtn" type="button">Copy</button></div>' +
            '<div class="share-actions">' +
              '<button class="btn" id="dlPng" type="button">⬇︎ Download QR (PNG)</button>' +
              '<a class="btn" id="viewLive" href="' + esc(shareUrl(slug)) + '" target="_blank" rel="noopener">↗ Preview</a>' +
            '</div>' +
            '<p class="muted small">Print this QR on your tables, menus and window. Customers scan it to see this page — and it always shows your latest edits.</p>' +
            '<hr/>' +
            '<div class="plan-box">' +
              (pro ? '<p>✅ <b>Pro</b> — thanks! Your menu stays live.</p>'
                   : '<p><b>Trial:</b> ' + dl + ' day' + (dl === 1 ? "" : "s") + ' left. Keep your menu live forever for a small monthly fee.</p><button class="btn primary block" id="upgradeBtn" type="button">Upgrade to Pro</button>') +
            '</div>' +
            '<button class="btn danger ghost block mt" id="deleteBtn" type="button">Delete this menu</button>' +
          '</section>' +
        '</div>' +
      '</div>';

    wireEditor(slug);
    renderSections(slug);
    renderQR(slug);
  }

  function field(label, type, id, val, ph, cls) {
    return '<label class="field ' + (cls || "") + '"><span>' + esc(label) + '</span>' +
      '<input type="' + type + '" id="' + id + '" value="' + esc(val) + '" placeholder="' + esc(ph || "") + '" /></label>';
  }

  function wireEditor(slug) {
    var m = getMenu(slug);
    document.getElementById("backBtn").addEventListener("click", function () { activeSlug = null; renderDashboard(); });

    // Bind simple text fields → model, debounced save.
    var binds = [
      ["f-name", function (v) { m.name = v; }],
      ["f-tagline", function (v) { m.tagline = v; }],
      ["f-hours", function (v) { m.hours = v; }],
      ["f-phone", function (v) { m.phone = v; }],
      ["f-currency", function (v) { m.currency = v || "$"; }],
      ["f-address", function (v) { m.address = v; }],
      ["f-website", function (v) { m.links.website = v; }],
      ["f-instagram", function (v) { m.links.instagram = v; }],
      ["f-facebook", function (v) { m.links.facebook = v; }],
      ["f-whatsapp", function (v) { m.links.whatsapp = v; }],
    ];
    binds.forEach(function (b) {
      var input = document.getElementById(b[0]); if (!input) return;
      input.addEventListener("input", function () { m.links = m.links || {}; b[1](input.value); saveMenu(slug, true); });
    });

    document.getElementById("pubToggle").addEventListener("change", function (e) {
      m.published = e.target.checked; saveMenu(slug); toast(m.published ? "Menu is now live 🟢" : "Menu set to draft");
    });

    document.getElementById("themeRow").addEventListener("click", function (e) {
      var b = e.target.closest(".swatch"); if (!b) return;
      m.theme = b.getAttribute("data-theme");
      document.getElementById("themeRow").querySelectorAll(".swatch").forEach(function (x) { x.classList.toggle("on", x === b); });
      saveMenu(slug, true);
    });

    document.getElementById("addSectionBtn").addEventListener("click", function () {
      m.sections = m.sections || [];
      m.sections.push({ id: uid4(), title: "New section", note: "", items: [] });
      saveMenu(slug, true); renderSections(slug);
    });

    document.getElementById("copyBtn").addEventListener("click", function () { copyText(shareUrl(slug)); });
    document.getElementById("dlPng").addEventListener("click", function () { downloadQR(slug); });

    var up = document.getElementById("upgradeBtn"), upNow = document.getElementById("upNow");
    if (up) up.addEventListener("click", showUpgrade);
    if (upNow) upNow.addEventListener("click", showUpgrade);

    document.getElementById("deleteBtn").addEventListener("click", function () {
      if (!window.confirm("Delete “" + (m.name || "this menu") + "” permanently? This can’t be undone.")) return;
      db.collection("menus").doc(slug).delete().then(function () {
        myMenus = myMenus.filter(function (x) { return x.slug !== slug; });
        activeSlug = null; renderDashboard(); toast("Menu deleted");
      }).catch(function (e) { toast("Delete failed: " + (e.message || "")); });
    });
  }

  // ---- Sections & items -------------------------------------------------
  function renderSections(slug) {
    var m = getMenu(slug);
    var host = document.getElementById("sections"); if (!host) return;
    var secs = m.sections || [];
    host.innerHTML = secs.map(function (sec, si) {
      var items = (sec.items || []).map(function (it, ii) {
        return '<div class="ed-item" data-si="' + si + '" data-ii="' + ii + '">' +
          '<div class="ed-item-txt"><span class="ed-item-name">' + esc(it.name) + (it.soldOut ? ' <span class="soldtag">Sold out</span>' : "") + '</span>' +
          (it.desc ? '<span class="ed-item-desc">' + esc(it.desc) + '</span>' : "") + '</div>' +
          '<span class="ed-item-price">' + esc(money(m, it.price)) + '</span>' +
          '<button class="icon-btn sm" data-act="edit-item" title="Edit">✏️</button>' +
        '</div>';
      }).join("");
      return '<div class="ed-sec" data-si="' + si + '">' +
        '<div class="ed-sec-head">' +
          '<input class="ed-sec-title" data-si="' + si + '" value="' + esc(sec.title) + '" placeholder="Section name" />' +
          '<div class="ed-sec-tools">' +
            (si > 0 ? '<button class="icon-btn sm" data-act="up-sec" title="Move up">↑</button>' : "") +
            (si < secs.length - 1 ? '<button class="icon-btn sm" data-act="down-sec" title="Move down">↓</button>' : "") +
            '<button class="icon-btn sm" data-act="del-sec" title="Delete section">🗑️</button>' +
          '</div>' +
        '</div>' +
        '<div class="ed-item-list">' + items + '</div>' +
        '<button class="btn ghost sm add-item" data-si="' + si + '" type="button">＋ Add item</button>' +
      '</div>';
    }).join("");

    // Section title edits
    host.querySelectorAll(".ed-sec-title").forEach(function (inp) {
      inp.addEventListener("input", function () { secs[+inp.getAttribute("data-si")].title = inp.value; saveMenu(slug, true); });
    });
    // Add item
    host.querySelectorAll(".add-item").forEach(function (b) {
      b.addEventListener("click", function () { openItemDrawer(slug, +b.getAttribute("data-si"), null); });
    });
    // Section + item tools (event delegation)
    host.querySelectorAll(".ed-sec").forEach(function (secEl) {
      var si = +secEl.getAttribute("data-si");
      secEl.querySelectorAll("[data-act]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var act = btn.getAttribute("data-act");
          if (act === "del-sec") {
            if (!window.confirm("Delete this whole section?")) return;
            secs.splice(si, 1); saveMenu(slug, true); renderSections(slug); return;
          }
          if (act === "up-sec") { var t = secs[si - 1]; secs[si - 1] = secs[si]; secs[si] = t; saveMenu(slug, true); renderSections(slug); return; }
          if (act === "down-sec") { var t2 = secs[si + 1]; secs[si + 1] = secs[si]; secs[si] = t2; saveMenu(slug, true); renderSections(slug); return; }
          if (act === "edit-item") { var itemEl = btn.closest(".ed-item"); openItemDrawer(slug, +itemEl.getAttribute("data-si"), +itemEl.getAttribute("data-ii")); return; }
        });
      });
    });
  }

  function openItemDrawer(slug, si, ii) {
    var m = getMenu(slug);
    var sec = m.sections[si];
    var editing = ii != null;
    var it = editing ? sec.items[ii] : { id: uid4(), name: "", desc: "", price: "", tags: [], soldOut: false };
    document.getElementById("drawerTitle").textContent = editing ? "Edit item" : "Add item";
    var form = document.getElementById("drawerForm");
    form.innerHTML =
      field("Item name", "text", "it-name", it.name, "e.g. Flat white") +
      field("Description", "text", "it-desc", it.desc, "Optional — a short line") +
      '<div class="field-row">' +
        field("Price", "text", "it-price", it.price, "e.g. 4.50", "narrow") +
        field("Tags", "text", "it-tags", (it.tags || []).join(", "), "e.g. vegan, gf") +
      '</div>' +
      '<label class="check"><input type="checkbox" id="it-sold" ' + (it.soldOut ? "checked" : "") + ' /> <span>Sold out</span></label>' +
      '<div class="drawer-foot">' +
        (editing ? '<button type="button" class="btn danger ghost" id="it-del">Delete</button>' : '<span></span>') +
        '<button type="submit" class="btn primary">' + (editing ? "Save" : "Add item") + '</button>' +
      '</div>';

    openDrawer();
    document.getElementById("it-name").focus();

    form.onsubmit = function (e) {
      e.preventDefault();
      it.name = document.getElementById("it-name").value.trim();
      if (!it.name) { toast("Give the item a name"); return; }
      it.desc = document.getElementById("it-desc").value.trim();
      it.price = document.getElementById("it-price").value.trim();
      it.tags = document.getElementById("it-tags").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      it.soldOut = document.getElementById("it-sold").checked;
      if (!editing) { sec.items = sec.items || []; sec.items.push(it); }
      saveMenu(slug, true); closeDrawer(); renderSections(slug);
    };
    var del = document.getElementById("it-del");
    if (del) del.onclick = function () {
      sec.items.splice(ii, 1); saveMenu(slug, true); closeDrawer(); renderSections(slug);
    };
  }

  // ---- Drawer -----------------------------------------------------------
  var drawerRoot = document.getElementById("drawerRoot");
  function openDrawer() { drawerRoot.hidden = false; document.body.classList.add("noscroll"); }
  function closeDrawer() { drawerRoot.hidden = true; document.body.classList.remove("noscroll"); }
  drawerRoot.addEventListener("click", function (e) { if (e.target.getAttribute("data-close")) closeDrawer(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !drawerRoot.hidden) closeDrawer(); });

  // ---- QR code ----------------------------------------------------------
  function makeQR(text) {
    if (typeof qrcode === "undefined") return null;
    var qr = qrcode(0, "M");     // type 0 = auto-size, medium error correction
    qr.addData(text); qr.make();
    return qr;
  }
  function qrCanvas(text, targetPx) {
    var qr = makeQR(text); if (!qr) return null;
    var count = qr.getModuleCount();
    var margin = 4;                       // quiet zone (modules) — required for reliable scans
    var total = count + margin * 2;
    var scale = Math.max(1, Math.floor((targetPx || 640) / total));
    var px = total * scale;
    var c = document.createElement("canvas");
    c.width = px; c.height = px;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#000000";
    for (var r = 0; r < count; r++) {
      for (var col = 0; col < count; col++) {
        if (qr.isDark(r, col)) ctx.fillRect((col + margin) * scale, (r + margin) * scale, scale, scale);
      }
    }
    return c;
  }
  function renderQR(slug) {
    var box = document.getElementById("qrBox"); if (!box) return;
    var c = qrCanvas(shareUrl(slug), 260);
    if (!c) { box.innerHTML = '<p class="muted small">QR generator offline — reconnect to see your code.</p>'; return; }
    c.style.width = "220px"; c.style.height = "220px"; c.style.imageRendering = "pixelated";
    box.innerHTML = ""; box.appendChild(c);
  }
  function downloadQR(slug) {
    var m = getMenu(slug);
    var c = qrCanvas(shareUrl(slug), 1024);
    if (!c) { toast("QR generator is offline right now"); return; }
    try {
      var url = c.toDataURL("image/png");
      var a = document.createElement("a");
      a.href = url; a.download = slugify(m ? m.name : "menu") + "-qr.png";
      document.body.appendChild(a); a.click(); a.remove();
      toast("QR downloaded — print it big & clear 🖨️");
    } catch (e) { toast("Couldn’t download the QR"); }
  }

  // ---- Copy & upgrade ---------------------------------------------------
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Link copied ✓"); }).catch(function () { toast(text); });
    } else {
      var i = document.getElementById("shareUrl"); if (i) { i.select(); try { document.execCommand("copy"); toast("Link copied ✓"); } catch (e) { toast(text); } }
    }
  }
  function showUpgrade() {
    // Payments are wired via Stripe Checkout in a Cloud Function (see menu/README.md).
    // Until that's connected, guide the owner rather than showing a broken button.
    document.getElementById("drawerTitle").textContent = "Upgrade to Pro";
    document.getElementById("drawerForm").innerHTML =
      '<div class="upsell">' +
        '<div class="price"><span class="amt">$7</span><span class="per">/month</span></div>' +
        '<ul class="ticks">' +
          '<li>✓ Keep your menu live for customers</li>' +
          '<li>✓ Unlimited items &amp; sections</li>' +
          '<li>✓ Edit prices &amp; sold-out anytime</li>' +
          '<li>✓ Your QR never changes when you edit</li>' +
        '</ul>' +
        '<button class="btn primary block" id="checkoutBtn" type="button">Continue to payment</button>' +
        '<p class="muted small center mt">Secure checkout. Cancel anytime.</p>' +
      '</div>';
    openDrawer();
    document.getElementById("checkoutBtn").addEventListener("click", function () {
      // TODO: redirect to Stripe Checkout session created by the `createCheckout`
      // Cloud Function, then a webhook flips this menu's plan to "pro".
      toast("Payments aren’t connected yet — see menu/README.md to add Stripe.");
    });
  }

  // ---- Go ---------------------------------------------------------------
  boot();
})();
