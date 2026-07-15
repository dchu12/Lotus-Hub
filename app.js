/* app.js — Lotus Hub open-play pickleball app (vanilla JS, no framework).
 *
 * Views:
 *   - Signed out       → welcome + sign in / sign up (email + Google)
 *   - Open Play        → list of upcoming sessions; join / leave; live roster
 *   - Host             → create a new open-play session
 *   - Profile          → your name + DUPR link (link flow is a stub until the
 *                        Cloud Functions DUPR integration lands — see functions/)
 *
 * All shared data lives in Firestore via the LH wrapper (firebase.js). Nothing
 * is stored on a per-device basis except the Firebase auth session. */
(function () {
  "use strict";

  var main = document.getElementById("main");
  var tabs = document.getElementById("tabs");
  var banner = document.getElementById("setup-banner");
  var toastEl = document.getElementById("toast");

  var state = {
    user: null, // Firebase auth user
    profile: null, // Firestore user doc
    view: "discover",
    sessions: [],
    viewingCoachUid: null, // which coach's profile is open
    viewingPlayerUid: null, // which player's profile is open (visitor view)
    playerBackView: "discover", // where "‹ Back" returns from a player view
    scoresSessionId: null, // which session's scores view is open
    unsub: { sessions: null, profile: null, coaches: null, scores: null },
  };

  // ---- helpers ----------------------------------------------------------
  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Pull a flag emoji (two regional-indicator chars) out of a free-text string.
  function flagOf(s) {
    if (!s) return "";
    var m = String(s).match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
    return m ? m[0] : "";
  }
  // Person's flag: the chosen `flag` field, falling back to a flag emoji found
  // in legacy heritage/ethnicity text.
  function heritageFlagOf(o) {
    if (!o) return "";
    return o.flag || flagOf(o.heritage != null ? o.heritage : o.ethnicity);
  }
  // The rating to display for a player: verified DUPR (when linked) wins,
  // otherwise the self-reported one. Mirrors what the profile view shows so a
  // self-rated player's number isn't dropped on rosters.
  function ratingOf(p) {
    if (!p) return null;
    if (p.duprLinked && p.homeRatingDoubles != null) return p.homeRatingDoubles;
    return p.duprManual != null ? p.duprManual : null;
  }
  // Small flag badge that sits at ~5 o'clock on an avatar circle.
  function flagBadge(flag) {
    return flag ? '<span class="av-flag">' + esc(flag) + "</span>" : "";
  }
  // Tappable flag badge for the edit avatar (placeholder globe when unset).
  function flagEditBtn(flag) {
    return (
      '<button type="button" class="av-flag av-flag-edit" id="flag-pick" aria-label="Choose your flag" title="Choose your flag">' +
      (flag ? esc(flag) : "🌍") +
      "</button>"
    );
  }

  // Curated country flags for the picker (emoji + name).
  var FLAGS = [
    ["🇨🇦", "Canada"], ["🇺🇸", "United States"], ["🇲🇽", "Mexico"], ["🇧🇷", "Brazil"],
    ["🇦🇷", "Argentina"], ["🇬🇧", "United Kingdom"], ["🇮🇪", "Ireland"], ["🇫🇷", "France"],
    ["🇩🇪", "Germany"], ["🇪🇸", "Spain"], ["🇵🇹", "Portugal"], ["🇮🇹", "Italy"],
    ["🇳🇱", "Netherlands"], ["🇧🇪", "Belgium"], ["🇨🇭", "Switzerland"], ["🇸🇪", "Sweden"],
    ["🇳🇴", "Norway"], ["🇩🇰", "Denmark"], ["🇫🇮", "Finland"], ["🇵🇱", "Poland"],
    ["🇨🇿", "Czechia"], ["🇦🇹", "Austria"], ["🇬🇷", "Greece"], ["🇷🇴", "Romania"],
    ["🇺🇦", "Ukraine"], ["🇷🇺", "Russia"], ["🇹🇷", "Türkiye"], ["🇮🇱", "Israel"],
    ["🇸🇦", "Saudi Arabia"], ["🇦🇪", "UAE"], ["🇮🇳", "India"], ["🇵🇰", "Pakistan"],
    ["🇧🇩", "Bangladesh"], ["🇱🇰", "Sri Lanka"], ["🇳🇵", "Nepal"], ["🇨🇳", "China"],
    ["🇭🇰", "Hong Kong"], ["🇹🇼", "Taiwan"], ["🇯🇵", "Japan"], ["🇰🇷", "South Korea"],
    ["🇵🇭", "Philippines"], ["🇻🇳", "Vietnam"], ["🇹🇭", "Thailand"], ["🇲🇾", "Malaysia"],
    ["🇸🇬", "Singapore"], ["🇮🇩", "Indonesia"], ["🇦🇺", "Australia"], ["🇳🇿", "New Zealand"],
    ["🇿🇦", "South Africa"], ["🇳🇬", "Nigeria"], ["🇬🇭", "Ghana"], ["🇰🇪", "Kenya"],
    ["🇪🇬", "Egypt"], ["🇲🇦", "Morocco"], ["🇪🇹", "Ethiopia"], ["🇯🇲", "Jamaica"],
    ["🇹🇹", "Trinidad & Tobago"], ["🇩🇴", "Dominican Republic"], ["🇨🇺", "Cuba"], ["🇨🇴", "Colombia"],
    ["🇨🇱", "Chile"], ["🇵🇪", "Peru"], ["🇻🇪", "Venezuela"], ["🇬🇹", "Guatemala"],
  ];

  // Flag picker modal. Calls onPick(emoji) when a flag is chosen.
  function openFlagPicker(current, onPick) {
    var root = document.getElementById("modal-root");
    root.innerHTML = "";
    var sheet = el(
      '<div class="modal-overlay" id="fp-overlay">' +
        '<div class="modal-sheet" role="dialog" aria-label="Choose your flag">' +
        '<div class="drawer-head"><h3>Choose your flag</h3><button class="drawer-close" id="fp-close" aria-label="Close">✕</button></div>' +
        '<input class="fp-search" id="fp-search" type="text" placeholder="Search country…" />' +
        '<div class="fp-grid" id="fp-grid"></div>' +
        "</div></div>"
    );
    root.appendChild(sheet);
    var grid = sheet.querySelector("#fp-grid");
    function draw(q) {
      var query = (q || "").trim().toLowerCase();
      grid.innerHTML = FLAGS.filter(function (f) {
        return !query || f[1].toLowerCase().indexOf(query) > -1;
      })
        .map(function (f) {
          return (
            '<button class="fp-item' + (f[0] === current ? " selected" : "") + '" type="button" data-flag="' + f[0] + '">' +
            '<span class="fp-emoji">' + f[0] + "</span><span class=\"fp-name\">" + esc(f[1]) + "</span></button>"
          );
        })
        .join("");
    }
    draw("");
    function close() { root.innerHTML = ""; }
    sheet.addEventListener("click", function (e) {
      if (e.target === sheet) close(); // click on backdrop
    });
    sheet.querySelector("#fp-close").addEventListener("click", close);
    sheet.querySelector("#fp-search").addEventListener("input", function (e) {
      draw(e.target.value);
    });
    grid.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-flag]");
      if (!btn) return;
      close();
      onPick(btn.dataset.flag);
    });
  }

  // Save the chosen flag to the current user's profile.
  function saveFlag(flag) {
    var u = LH.currentUser() || state.user;
    if (!u) return Promise.reject(new Error("Not signed in."));
    return firebase.firestore().collection("users").doc(u.uid).set({ flag: flag }, { merge: true });
  }
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.hidden = true;
    }, 2600);
  }
  function fmtWhen(ts) {
    if (!ts) return "";
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  function skillLabel(s) {
    if (s.skillMin == null && s.skillMax == null) return "All levels";
    if (s.skillMin != null && s.skillMax != null) return s.skillMin + "–" + s.skillMax + " DUPR";
    if (s.skillMin != null) return s.skillMin + "+ DUPR";
    return "up to " + s.skillMax + " DUPR";
  }

  // ---- setup / connection banner ---------------------------------------
  function renderBanner() {
    if (LH.available) {
      banner.hidden = true;
      return true;
    }
    banner.hidden = false;
    if (!LH.configured) {
      banner.innerHTML =
        "⚙️ <strong>Setup needed.</strong> Paste your Firebase project's keys into " +
        "<code>firebase-config.js</code>. See the README for setup.";
    } else {
      // Config is present but the Firebase SDK didn't load — almost always a
      // network issue reaching the CDN, not a real setup problem.
      banner.innerHTML =
        "⚠️ <strong>Can't connect.</strong> Couldn't reach the server — usually a " +
        "network hiccup. Check your internet and reload the page.";
    }
    return false;
  }

  // ---- auth views -------------------------------------------------------
  // Turn Firebase's auth error codes into friendly, actionable messages.
  function authErrorMessage(err) {
    var code = err && err.code ? String(err.code) : "";
    var map = {
      "auth/invalid-email": "That email doesn't look right.",
      "auth/user-not-found": "No account found with that email.",
      "auth/wrong-password": "Incorrect password — try again or reset it.",
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/email-already-in-use": "An account already exists with that email — try signing in instead.",
      "auth/weak-password": "Password should be at least 6 characters.",
      "auth/missing-password": "Please enter a password.",
      "auth/too-many-requests": "Too many attempts — wait a moment and try again.",
      "auth/popup-closed-by-user": "Sign-in was cancelled.",
      "auth/popup-blocked": "Your browser blocked the sign-in popup — allow popups and try again.",
      "auth/network-request-failed": "Network problem — check your connection and try again.",
    };
    return map[code] || (err && err.message) || "Something went wrong. Please try again.";
  }

  function renderSignedOut() {
    tabs.hidden = true;
    var configured = LH.available;
    main.innerHTML = "";
    var card = el(
      '<section class="card auth-card">' +
        '<h2>Find your next game 🏓</h2>' +
        '<p class="muted">Join open-play pickleball sessions near you, see who\'s coming, ' +
        "and (soon) sync your results to your DUPR rating.</p>" +
        (configured
          ? '<form id="auth-form">' +
            '<div class="field"><label>Name <span class="only-signup">(sign up)</span></label>' +
            '<input id="f-name" type="text" placeholder="Your name" autocomplete="name" /></div>' +
            '<div class="field"><label>Email</label>' +
            '<input id="f-email" type="email" placeholder="you@example.com" autocomplete="email" required /></div>' +
            '<div class="field"><label>Password</label>' +
            '<input id="f-pass" type="password" placeholder="••••••••" autocomplete="current-password" required /></div>' +
            '<div class="auth-forgot only-signin"><button type="button" class="link-inline" id="forgot-pass">Forgot password?</button></div>' +
            '<button class="btn-primary" type="submit" id="auth-submit">Sign in</button>' +
            '<button class="btn-ghost full" type="button" id="toggle-mode">New here? Create an account</button>' +
            '<div class="divider"><span>or</span></div>' +
            '<button class="btn-google full" type="button" id="google-btn">Continue with Google</button>' +
            "</form>"
          : LH.configured
          ? '<p class="muted">Can\'t connect right now — check your internet, then reload.</p>' +
            '<button class="btn-primary" type="button" id="reload-btn">Reload</button>'
          : '<p class="muted">Sign-in turns on once Firebase is configured.</p>') +
        "</section>"
    );
    main.appendChild(card);
    if (!configured) {
      var rb = card.querySelector("#reload-btn");
      if (rb) rb.addEventListener("click", function () { window.location.reload(); });
      return;
    }

    var mode = "signin";
    var form = card.querySelector("#auth-form");
    var submit = card.querySelector("#auth-submit");
    card.querySelector("#toggle-mode").addEventListener("click", function () {
      mode = mode === "signin" ? "signup" : "signin";
      submit.textContent = mode === "signin" ? "Sign in" : "Create account";
      this.textContent =
        mode === "signin" ? "New here? Create an account" : "Have an account? Sign in";
      card.classList.toggle("is-signup", mode === "signup");
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = card.querySelector("#f-name").value.trim();
      var email = card.querySelector("#f-email").value.trim();
      var pass = card.querySelector("#f-pass").value;
      var p =
        mode === "signup" ? LH.signUp(email, pass, name) : LH.signIn(email, pass);
      submit.disabled = true;
      p.catch(function (err) {
        toast(authErrorMessage(err));
      }).finally(function () {
        submit.disabled = false;
      });
    });
    card.querySelector("#google-btn").addEventListener("click", function () {
      LH.signInWithGoogle().catch(function (err) {
        toast(authErrorMessage(err));
      });
    });
    card.querySelector("#forgot-pass").addEventListener("click", function () {
      var email = card.querySelector("#f-email").value.trim();
      if (!email) return toast("Enter your email above, then tap Forgot password.");
      LH.resetPassword(email)
        .then(function () { toast("Password reset link sent — check your email."); })
        .catch(function (err) { toast(authErrorMessage(err)); });
    });
  }

  // ---- signed-in shell --------------------------------------------------
  function renderSignedIn() {
    tabs.hidden = false;
    // Stop the scores listeners when leaving that view (tab switch or otherwise).
    if (state.view !== "scores" && state.unsub.scores) {
      state.unsub.scores();
      state.unsub.scores = null;
    }
    var isCoaching = state.view === "coaching" || state.view.indexOf("coach") === 0;
    var isPlay = state.view === "discover" || state.view === "create" || state.view === "player-view" || state.view === "scores";
    var isProfile = state.view === "profile" || state.view === "profile-edit";
    Array.prototype.forEach.call(tabs.querySelectorAll(".tab"), function (t) {
      var v = t.dataset.view;
      var active =
        v === state.view ||
        (v === "coaching" && isCoaching) ||
        (v === "discover" && isPlay) ||
        (v === "profile" && isProfile);
      t.classList.toggle("active", active);
    });
    if (state.view === "discover") renderDiscover();
    else if (state.view === "create") renderCreate();
    else if (state.view === "coaching") renderCoaching();
    else if (state.view === "coaches") renderCoachList();
    else if (state.view === "coach-edit") renderCoachEdit();
    else if (state.view === "coach-view") renderCoachDetail(state.viewingCoachUid);
    else if (state.view === "connect") renderConnect();
    else if (state.view === "rank") renderRank();
    else if (state.view === "profile-edit") renderProfileEdit();
    else if (state.view === "profile") renderProfileView();
    else if (state.view === "player-view") renderPlayerView(state.viewingPlayerUid);
    else if (state.view === "scores") renderScores(state.scoresSessionId);
  }

  function renderCoaching() {
    main.innerHTML = "";
    var wrap = el('<section class="stack"></section>');

    // Explore pickleball coaches — clickable, opens the coach directory.
    var findCard = el(
      '<article class="card coach-card is-clickable" id="find-coach" role="button" tabindex="0">' +
        '<div class="coach-icon">🔍</div>' +
        "<div><h3>Explore pickleball coaches</h3>" +
        '<p class="muted">Browse coaches and view their profiles.</p></div>' +
        '<span class="chevron">›</span>' +
        "</article>"
    );
    findCard.addEventListener("click", function () {
      state.view = "coaches";
      renderSignedIn();
    });
    wrap.appendChild(findCard);

    // Still-planned items.
    [
      ["🧑‍🏫", "Book a private lesson", "1-on-1 coaching tailored to you."],
      ["👥", "Book a group lesson", "Small-group sessions with a coach."],
      ["🎯", "Drilling sessions", "Structured drills to sharpen your game."],
      ["🪷", "Lotus mini games", "Fun mini-games and challenges to level up."],
    ].forEach(function (it) {
      wrap.appendChild(
        el(
          '<article class="card coach-card">' +
            '<div class="coach-icon">' + it[0] + "</div>" +
            "<div><h3>" + it[1] + "</h3>" +
            '<p class="muted">' + it[2] + "</p></div>" +
            '<span class="pill">Coming soon</span>' +
            "</article>"
        )
      );
    });
    main.appendChild(wrap);
  }

  // ---- coach directory ----
  function coachAvatar(c, cls) {
    var inner = (c.photoDataUrl || c.photoURL)
      ? '<img src="' + esc(c.photoDataUrl || c.photoURL) + '" alt="" referrerpolicy="no-referrer" />'
      : esc((c.displayName || "?").trim().charAt(0).toUpperCase() || "?");
    return '<span class="' + cls + '">' + inner + flagBadge(heritageFlagOf(c)) + "</span>";
  }

  function coachListItem(c) {
    var bio = c.coachBio ? String(c.coachBio) : "";
    if (bio.length > 90) bio = bio.slice(0, 90) + "…";
    return (
      '<article class="card coach-list-item is-clickable" role="button" tabindex="0" data-uid="' + esc(c.uid) + '">' +
      coachAvatar(c, "coach-list-avatar") +
      '<div class="coach-list-body"><h3>' + esc(c.displayName || "Coach") + "</h3>" +
      (c.skillLevel ? '<span class="pill">' + esc(c.skillLevel) + "</span>" : "") +
      (bio ? '<p class="muted">' + esc(bio) + "</p>" : "") +
      "</div><span class=\"chevron\">›</span></article>"
    );
  }

  function renderCoachList() {
    main.innerHTML = "";
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(
      el(
        '<div class="view-head"><button class="link-back" id="back" type="button">‹ Practice</button>' +
          "<h2>Find a Coach</h2>" +
          '<p class="muted">Tap a coach to view their profile.</p></div>'
      )
    );
    var isCoach = !!(state.profile && state.profile.isCoach);
    var cta = el(
      '<button class="btn-primary" id="edit-coach" type="button">' +
        (isCoach ? "Edit your coach profile" : "Become a coach") +
        "</button>"
    );
    wrap.appendChild(cta);
    var listEl = el('<div class="stack" id="coach-list"><div class="muted" style="text-align:center;padding:20px">Loading coaches…</div></div>');
    wrap.appendChild(listEl);
    main.appendChild(wrap);

    wrap.querySelector("#back").addEventListener("click", function () {
      state.view = "coaching";
      renderSignedIn();
    });
    cta.addEventListener("click", function () {
      state.view = "coach-edit";
      renderSignedIn();
    });

    if (state.unsub.coaches) state.unsub.coaches();
    state.unsub.coaches = LH.watchCoaches(function (list) {
      if (!list.length) {
        listEl.innerHTML =
          '<div class="empty">No coaches listed yet. Be the first — tap <strong>Become a coach</strong> above.</div>';
        return;
      }
      list.sort(function (a, b) {
        return (a.displayName || "").localeCompare(b.displayName || "");
      });
      listEl.innerHTML = list.map(coachListItem).join("");
    });
    listEl.addEventListener("click", function (e) {
      var item = e.target.closest("[data-uid]");
      if (!item) return;
      state.viewingCoachUid = item.dataset.uid;
      state.view = "coach-view";
      renderSignedIn();
    });
  }

  function renderCoachDetail(uid) {
    main.innerHTML = "";
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(
      el(
        '<div class="view-head"><button class="link-back" id="back" type="button">‹ Coaches</button></div>'
      )
    );
    var card = el('<section class="card"><p class="muted">Loading…</p></section>');
    wrap.appendChild(card);
    main.appendChild(wrap);

    wrap.querySelector("#back").addEventListener("click", function () {
      state.view = "coaches";
      renderSignedIn();
    });

    if (!uid) {
      card.innerHTML = '<p class="muted">Coach not found.</p>';
      return;
    }
    LH.getUserOnce(uid)
      .then(function (c) {
        if (!c) {
          card.innerHTML = '<p class="muted">Coach not found.</p>';
          return;
        }
        card.classList.add("stack", "profile-card");
        card.innerHTML =
          '<div class="profile-hero">' +
          coachAvatar(c, "avatar-preview") +
          '<div class="identity-name">' + esc(c.displayName || "Coach") + "</div>" +
          (c.skillLevel ? '<div class="identity-skill">' + esc(c.skillLevel) + "</div>" : "") +
          "</div>" +
          (c.coachSpecialties ? metaRow("Specialties", c.coachSpecialties) : "") +
          (c.coachExperience ? metaRow("Experience", c.coachExperience) : "") +
          (c.coachRate ? metaRow("Rate", c.coachRate) : "") +
          (c.favCourt ? metaRow("Home court", c.favCourt) : "") +
          (c.coachBio
            ? '<div class="coach-bio"><h3>About</h3><p>' + esc(c.coachBio).replace(/\n/g, "<br>") + "</p></div>"
            : "") +
          '<button class="btn-primary" id="book" type="button">Request a lesson</button>';
        card.querySelector("#book").addEventListener("click", function () {
          toast("Booking is coming soon — reach out to your coach directly for now.");
        });
      })
      .catch(function () {
        card.innerHTML = '<p class="muted">Could not load this coach.</p>';
      });
  }

  function metaRow(label, val) {
    return (
      '<div class="meta-row"><span class="meta-label">' + esc(label) + "</span>" +
      '<span class="meta-val">' + esc(val) + "</span></div>"
    );
  }

  function renderCoachEdit() {
    main.innerHTML = "";
    var p = state.profile || {};
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(
      el('<div class="view-head"><button class="link-back" id="back" type="button">‹ Coaches</button><h2>Your Coach Profile</h2><p class="muted">Add a bio so students can get to know you.</p></div>')
    );
    var card = el(
      '<section class="card stack profile-card">' +
        '<div class="profile-hero">' +
        coachAvatar(p, "avatar-preview") +
        '<div class="identity-name">' + esc(p.displayName || "Your name") + "</div>" +
        (p.skillLevel ? '<div class="identity-skill">' + esc(p.skillLevel) + "</div>" : "") +
        "</div>" +
        '<p class="muted" style="text-align:center;margin-top:-4px">Your photo and name come from your <strong>Profile</strong>.</p>' +
        '<div class="field"><label>Biography</label>' +
        '<textarea id="c-bio" rows="5" placeholder="Tell students about your playing background, coaching style, and what you help with…">' + esc(p.coachBio || "") + "</textarea></div>" +
        '<div class="field"><label>Specialties</label>' +
        '<input id="c-spec" type="text" placeholder="e.g. Dinking, 3rd-shot drops, strategy" value="' + esc(p.coachSpecialties || "") + '" /></div>' +
        '<div class="field"><label>Experience</label>' +
        '<input id="c-exp" type="text" placeholder="e.g. 5 years coaching" value="' + esc(p.coachExperience || "") + '" /></div>' +
        '<div class="field"><label>Rate</label>' +
        '<input id="c-rate" type="text" placeholder="e.g. $40 / hour" value="' + esc(p.coachRate || "") + '" /></div>' +
        '<button class="btn-primary" id="save-coach" type="button">' + (p.isCoach ? "Save coach profile" : "Publish coach profile") + "</button>" +
        '<p class="save-status" id="coach-status" hidden></p>' +
        (p.isCoach ? '<button class="btn-signout" id="unlist" type="button">Remove me from the coach list</button>' : "") +
        "</section>"
    );
    wrap.appendChild(card);
    main.appendChild(wrap);

    wrap.querySelector("#back").addEventListener("click", function () {
      state.view = "coaches";
      renderSignedIn();
    });

    var statusEl = card.querySelector("#coach-status");
    function setStatus(msg, kind) {
      statusEl.hidden = false;
      statusEl.textContent = msg;
      statusEl.className = "save-status" + (kind ? " " + kind : "");
    }

    function writeCoach(fields, okMsg) {
      var u = LH.currentUser() || state.user;
      if (!u) return setStatus("You're not signed in.", "err");
      setStatus("Saving…", "");
      firebase
        .firestore()
        .collection("users")
        .doc(u.uid)
        .set(fields, { merge: true })
        .then(function () {
          setStatus(okMsg, "ok");
        })
        .catch(function (err) {
          setStatus("Couldn't save — " + (err && (err.code || err.message) ? err.code || err.message : "error"), "err");
        });
    }

    card.querySelector("#save-coach").addEventListener("click", function () {
      var bio = card.querySelector("#c-bio").value.trim();
      if (!bio) return setStatus("Please add a short bio so students know who you are.", "err");
      writeCoach(
        {
          isCoach: true,
          coachBio: bio,
          coachSpecialties: card.querySelector("#c-spec").value.trim() || null,
          coachExperience: card.querySelector("#c-exp").value.trim() || null,
          coachRate: card.querySelector("#c-rate").value.trim() || null,
        },
        "Saved ✓ — you're now listed as a coach."
      );
    });

    var unlist = card.querySelector("#unlist");
    if (unlist) {
      unlist.addEventListener("click", function () {
        writeCoach({ isCoach: false }, "Removed — you're no longer listed as a coach.");
      });
    }
  }

  function renderDiscover() {
    main.innerHTML = "";
    var wrap = el('<section class="stack"></section>');
    var head = el(
      '<div class="view-head"><h2>Open Play</h2>' +
        '<p class="muted">Upcoming sessions you can join.</p></div>'
    );
    wrap.appendChild(head);

    var hostBtn = el('<button class="btn-primary" type="button">＋ Host an open play</button>');
    hostBtn.addEventListener("click", function () {
      state.view = "create";
      renderSignedIn();
    });
    wrap.appendChild(hostBtn);

    if (!state.sessions.length) {
      wrap.appendChild(
        el(
          '<div class="empty">No upcoming sessions yet. ' +
            "Tap <strong>Host an open play</strong> above to create the first one.</div>"
        )
      );
    }
    state.sessions.forEach(function (s) {
      wrap.appendChild(sessionCard(s));
    });
    main.appendChild(wrap);
  }

  function sessionCard(s) {
    var spots = Math.max(0, (s.capacity || 8) - (s.attendeeCount || 0));
    var card = el(
      '<article class="card session-card">' +
        '<div class="session-top">' +
        '<div><h3>' + esc(s.title) + "</h3>" +
        '<p class="muted">' + esc(s.venueName || "TBD") + " · " + fmtWhen(s.startAt) + "</p></div>" +
        '<span class="pill">' + esc(skillLabel(s)) + "</span>" +
        "</div>" +
        '<div class="session-meta">' +
        "<span>👥 " + (s.attendeeCount || 0) + "/" + (s.capacity || 8) + "</span>" +
        "<span>🎾 " + (s.courtCount || 1) + " court" + ((s.courtCount || 1) > 1 ? "s" : "") + "</span>" +
        "<span>" + (spots > 0 ? spots + " spots left" : "Waitlist only") + "</span>" +
        "</div>" +
        '<ul class="roster" hidden></ul>' +
        '<div class="session-actions">' +
        '<button class="btn-ghost btn-roster">Show players</button>' +
        '<button class="btn-ghost btn-scores">🏓 Scores</button>' +
        '<button class="btn-primary btn-rsvp">Join</button>' +
        "</div>" +
        "</article>"
    );

    var rosterEl = card.querySelector(".roster");
    var rosterBtn = card.querySelector(".btn-roster");
    var rsvpBtn = card.querySelector(".btn-rsvp");
    card.querySelector(".btn-scores").addEventListener("click", function () {
      state.scoresSessionId = s.id;
      state.view = "scores";
      renderSignedIn();
    });

    // Live roster.
    var rosterOpen = false;
    var unsubRoster = null;
    rosterBtn.addEventListener("click", function () {
      rosterOpen = !rosterOpen;
      rosterEl.hidden = !rosterOpen;
      rosterBtn.textContent = rosterOpen ? "Hide players" : "Show players";
      if (rosterOpen && !unsubRoster) {
        unsubRoster = LH.watchRsvps(s.id, function (list) {
          rosterEl.innerHTML = list.length
            ? list.map(rosterItem).join("")
            : '<li class="muted">No one yet — be first!</li>';
        });
      }
    });

    // Tap a player in the roster to open their profile.
    rosterEl.addEventListener("click", function (e) {
      var li = e.target.closest("[data-uid]");
      if (!li || !li.dataset.uid) return;
      state.playerBackView = "discover";
      state.viewingPlayerUid = li.dataset.uid;
      state.view = "player-view";
      renderSignedIn();
    });

    // My RSVP state drives the button.
    LH.myRsvpStatus(s.id, function (status) {
      if (status === "going") {
        rsvpBtn.textContent = "Leave";
        rsvpBtn.classList.add("is-joined");
      } else if (status === "waitlist") {
        rsvpBtn.textContent = "On waitlist — leave";
        rsvpBtn.classList.add("is-joined");
      } else {
        rsvpBtn.textContent = spots > 0 ? "Join" : "Join waitlist";
        rsvpBtn.classList.remove("is-joined");
      }
      rsvpBtn.onclick = function () {
        rsvpBtn.disabled = true;
        var action =
          status === "going" || status === "waitlist"
            ? LH.leave(s.id)
            : LH.join(s.id, {
                displayName: (state.profile && state.profile.displayName) || "Player",
                rating: ratingOf(state.profile),
                photoDataUrl: state.profile ? state.profile.photoDataUrl || state.profile.photoURL : null,
                skillLevel: state.profile ? state.profile.skillLevel : null,
                heritageFlag: heritageFlagOf(state.profile) || null,
              });
        action
          .then(function (res) {
            if (res === "waitlist") toast("Session full — you're on the waitlist.");
          })
          .catch(function (err) {
            toast(err.message || "Something went wrong.");
          })
          .finally(function () {
            rsvpBtn.disabled = false;
          });
      };
    });

    return card;
  }

  // ---- session scores: view results + (organizer) enter games ----
  function renderScores(sessionId) {
    main.innerHTML = "";
    if (state.unsub.scores) { state.unsub.scores(); state.unsub.scores = null; }

    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(
      el('<div class="view-head"><button class="link-back" id="back" type="button">‹ Play</button><h2>Session scores</h2></div>')
    );
    var card = el('<section class="card stack"><p class="muted">Loading…</p></section>');
    wrap.appendChild(card);
    main.appendChild(wrap);

    wrap.querySelector("#back").addEventListener("click", function () {
      if (state.unsub.scores) { state.unsub.scores(); state.unsub.scores = null; }
      state.view = "discover";
      renderSignedIn();
    });

    if (!sessionId) { card.innerHTML = '<p class="muted">Session not found.</p>'; return; }
    var me = LH.currentUser();

    LH.getSessionOnce(sessionId).then(function (s) {
      if (!s) { card.innerHTML = '<p class="muted">This session no longer exists.</p>'; return; }
      var isOrganizer = !!(me && me.uid === s.organizerUid);
      var roster = [];
      var assign = {}; // uid -> "A" | "B"

      card.innerHTML =
        '<div class="scores-head"><h2>' + esc(s.title) + "</h2>" +
        '<p class="muted">' + esc(s.venueName || "TBD") + " · " + fmtWhen(s.startAt) + "</p></div>" +
        '<div class="section-title">Games</div>' +
        '<div id="games-list" class="games-list"><p class="muted">Loading games…</p></div>' +
        (isOrganizer
          ? '<div class="score-entry">' +
              '<div class="section-title">Add a game</div>' +
              '<p class="muted small">Tap players to set Team A (red) or Team B (gold). Tap again to switch teams, once more to clear.</p>' +
              '<div id="picker" class="pk-grid"></div>' +
              '<div class="score-inputs">' +
                '<div class="si"><label>Team A</label><input id="score-a" type="number" min="0" max="99" inputmode="numeric" placeholder="0" /></div>' +
                '<span class="si-dash">–</span>' +
                '<div class="si"><label>Team B</label><input id="score-b" type="number" min="0" max="99" inputmode="numeric" placeholder="0" /></div>' +
              "</div>" +
              '<button class="btn-primary" id="add-game" type="button">Add game</button>' +
              '<p class="save-status" id="score-status" hidden></p>' +
            "</div>"
          : '<p class="muted">Only the organizer can enter scores for this session.</p>');

      var gamesList = card.querySelector("#games-list");

      function gameRow(g) {
        var aWin = g.winner === "A", bWin = g.winner === "B";
        var namesA = (g.teamANames || []).join(" & ") || "Team A";
        var namesB = (g.teamBNames || []).join(" & ") || "Team B";
        return (
          '<div class="game-row">' +
          '<div class="game-side game-a' + (aWin ? " win" : "") + '">' +
          '<span class="gt-names">' + esc(namesA) + (aWin ? " 🏆" : "") + "</span>" +
          '<span class="gt-score">' + esc(g.scoreA) + "</span></div>" +
          '<span class="game-vs">vs</span>' +
          '<div class="game-side game-b' + (bWin ? " win" : "") + '">' +
          '<span class="gt-score">' + esc(g.scoreB) + "</span>" +
          '<span class="gt-names">' + (bWin ? "🏆 " : "") + esc(namesB) + "</span></div>" +
          (isOrganizer ? '<button class="game-del" type="button" data-gid="' + esc(g.id) + '" aria-label="Delete game">✕</button>' : "") +
          "</div>"
        );
      }

      var unsubGames = LH.watchSessionGames(sessionId, function (games) {
        gamesList.innerHTML = games.length
          ? games.map(gameRow).join("")
          : '<p class="empty">No games recorded yet.' + (isOrganizer ? " Add the first one below." : "") + "</p>";
      });
      var unsubRoster = isOrganizer
        ? LH.watchRsvps(sessionId, function (list) { roster = list; drawPicker(); })
        : null;
      state.unsub.scores = function () {
        if (unsubGames) unsubGames();
        if (unsubRoster) unsubRoster();
      };

      gamesList.addEventListener("click", function (e) {
        var del = e.target.closest(".game-del");
        if (!del) return;
        if (!window.confirm("Delete this game?")) return;
        LH.deleteGame(sessionId, del.dataset.gid).catch(function () { toast("Couldn't delete game."); });
      });

      // ---- organizer: player picker + add-game ----
      var pickerEl = card.querySelector("#picker");
      function drawPicker() {
        if (!pickerEl) return;
        if (!roster.length) {
          pickerEl.innerHTML = '<p class="muted small">No players have joined yet — the roster fills in as people RSVP.</p>';
          return;
        }
        pickerEl.innerHTML = roster
          .map(function (p) {
            var a = assign[p.uid];
            return (
              '<button type="button" class="pk-chip' + (a === "A" ? " pk-a" : a === "B" ? " pk-b" : "") + '" data-uid="' + esc(p.uid) + '">' +
              esc(p.displayName || "Player") + (a ? '<span class="pk-tag">' + a + "</span>" : "") + "</button>"
            );
          })
          .join("");
      }
      if (pickerEl) {
        var teamCount = function (t) {
          return roster.filter(function (p) { return assign[p.uid] === t; }).length;
        };
        pickerEl.addEventListener("click", function (e) {
          var chip = e.target.closest(".pk-chip");
          if (!chip) return;
          var uid = chip.dataset.uid;
          var cur = assign[uid];
          // Cycle unassigned → A → B → unassigned, skipping any full (2-player)
          // team so a full Team A never blocks reaching Team B.
          var next;
          if (cur === "A") next = teamCount("B") < 2 ? "B" : null;
          else if (cur === "B") next = null;
          else if (teamCount("A") < 2) next = "A";
          else if (teamCount("B") < 2) next = "B";
          else { toast("Both teams are full — clear a player first."); return; }
          if (next) assign[uid] = next;
          else delete assign[uid];
          drawPicker();
        });
        drawPicker();
      }

      var addBtn = card.querySelector("#add-game");
      if (addBtn) {
        var statusEl = card.querySelector("#score-status");
        var setStatus = function (msg, kind) {
          statusEl.hidden = false;
          statusEl.textContent = msg;
          statusEl.className = "save-status" + (kind ? " " + kind : "");
        };
        addBtn.addEventListener("click", function () {
          var teamA = roster.filter(function (p) { return assign[p.uid] === "A"; });
          var teamB = roster.filter(function (p) { return assign[p.uid] === "B"; });
          if (!teamA.length || !teamB.length) return setStatus("Put at least one player on each team.", "err");
          var sa = parseInt(card.querySelector("#score-a").value, 10);
          var sb = parseInt(card.querySelector("#score-b").value, 10);
          if (isNaN(sa) || isNaN(sb) || sa < 0 || sb < 0) return setStatus("Enter both scores.", "err");
          if (sa === sb) return setStatus("A game can't end in a tie — pick a winner.", "err");
          addBtn.disabled = true;
          setStatus("Saving…", "");
          LH.addGame(sessionId, { teamA: teamA, teamB: teamB, scoreA: sa, scoreB: sb })
            .then(function () {
              setStatus("Game added ✓", "ok");
              assign = {};
              drawPicker();
              card.querySelector("#score-a").value = "";
              card.querySelector("#score-b").value = "";
            })
            .catch(function (err) {
              var code = err && err.code ? String(err.code) : "";
              setStatus(
                code.indexOf("permission-denied") > -1
                  ? "Score-saving isn't live yet — the updated security rules need to be deployed."
                  : (err && err.message) || "Couldn't add game.",
                "err"
              );
            })
            .finally(function () { addBtn.disabled = false; });
        });
      }
    }).catch(function () {
      card.innerHTML = '<p class="muted">Could not load this session.</p>';
    });
  }

  // Fill the stat tiles (games / win rate / record) for a profile, if the
  // player has any recorded games. Async — degrades to nothing on error (e.g.
  // before the games rules are deployed).
  function attachStats(scope, uid) {
    var box = scope.querySelector("[data-stats]");
    if (!box || !uid || !LH.getPlayerStats) return;
    LH.getPlayerStats(uid)
      .then(function (st) {
        if (!st || !st.games) return;
        var tile = function (v, l) {
          return '<div class="pstat"><div class="pstat-v">' + esc(v) + '</div><div class="pstat-l">' + esc(l) + "</div></div>";
        };
        box.innerHTML = tile(st.games, "Games") + tile(st.winRate + "%", "Win rate") + tile(st.wins + "–" + st.losses, "W–L");
        box.hidden = false;
      })
      .catch(function () {});
  }

  function renderCreate() {
    main.innerHTML = "";
    var wrap = el('<section class="stack"></section>');
    var back = el('<div class="view-head"><button class="link-back" id="back" type="button">‹ Play</button></div>');
    wrap.appendChild(back);
    back.querySelector("#back").addEventListener("click", function () {
      state.view = "discover";
      renderSignedIn();
    });
    var card = el(
      '<section class="card">' +
        "<h2>Host an open play</h2>" +
        '<form id="create-form" class="stack">' +
        '<div class="field"><label>Title</label>' +
        '<input id="c-title" type="text" placeholder="Saturday morning doubles" required /></div>' +
        '<div class="field"><label>Venue</label>' +
        '<input id="c-venue" type="text" placeholder="Riverside Courts" required /></div>' +
        '<div class="field"><label>Date &amp; time</label>' +
        '<input id="c-when" type="datetime-local" required /></div>' +
        '<div class="row">' +
        '<div class="field"><label>Courts</label>' +
        '<input id="c-courts" type="number" min="1" value="2" /></div>' +
        '<div class="field"><label>Capacity</label>' +
        '<input id="c-cap" type="number" min="2" value="8" /></div>' +
        "</div>" +
        '<div class="row">' +
        '<div class="field"><label>Min DUPR</label>' +
        '<input id="c-min" type="number" step="0.1" min="2" max="8" placeholder="any" /></div>' +
        '<div class="field"><label>Max DUPR</label>' +
        '<input id="c-max" type="number" step="0.1" min="2" max="8" placeholder="any" /></div>' +
        "</div>" +
        '<button class="btn-primary" type="submit">Create session</button>' +
        "</form></section>"
    );
    wrap.appendChild(card);
    main.appendChild(wrap);

    card.querySelector("#create-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var whenVal = card.querySelector("#c-when").value;
      if (!whenVal) return toast("Pick a date and time.");
      var min = parseFloat(card.querySelector("#c-min").value);
      var max = parseFloat(card.querySelector("#c-max").value);
      LH.createSession({
        title: card.querySelector("#c-title").value.trim(),
        venueName: card.querySelector("#c-venue").value.trim(),
        startAt: new Date(whenVal),
        courtCount: parseInt(card.querySelector("#c-courts").value, 10) || 1,
        capacity: parseInt(card.querySelector("#c-cap").value, 10) || 8,
        skillMin: isNaN(min) ? null : min,
        skillMax: isNaN(max) ? null : max,
        organizerName: (state.profile && state.profile.displayName) || undefined,
      })
        .then(function () {
          toast("Session created!");
          state.view = "discover";
          renderSignedIn();
        })
        .catch(function (err) {
          toast(err.message || "Could not create session.");
        });
    });
  }

  // Resize/crop an image File to a square dataURL (keeps Firestore docs small).
  function resizeImage(file, size) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error("Could not read image."));
      };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () {
          reject(new Error("Could not load image."));
        };
        img.onload = function () {
          var canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          var ctx = canvas.getContext("2d");
          // cover-crop to a centered square
          var s = Math.min(img.width, img.height);
          var sx = (img.width - s) / 2;
          var sy = (img.height - s) / 2;
          ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  var AVATAR_EDIT_BTN =
    '<button class="avatar-edit" id="upload-btn" type="button" aria-label="Change photo" title="Change photo">' +
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>' +
    "</button>";

  function avatarFace(p) {
    if (p.photoDataUrl || p.photoURL) {
      return '<img src="' + esc(p.photoDataUrl || p.photoURL) + '" alt="" referrerpolicy="no-referrer" />';
    }
    var name = p.displayName || (state.user && state.user.email) || "?";
    return '<span class="avatar-initial">' + esc(name.trim().charAt(0).toUpperCase() || "?") + "</span>";
  }

  var SKILLS = ["Beginner", "Intermediate", "Advanced"];

  function segmentedSkill(selected) {
    return (
      '<div class="segmented" id="p-skill" role="group" aria-label="Skill level">' +
      SKILLS.map(function (o) {
        return (
          '<button type="button" class="seg' + (selected === o ? " active" : "") +
          '" data-val="' + o + '">' + o + "</button>"
        );
      }).join("") +
      "</div>"
    );
  }

  // Generic single-select segmented control (format, hand, court side, …).
  function segmentedGroup(id, options, selected) {
    return (
      '<div class="segmented" id="' + esc(id) + '" role="group">' +
      options.map(function (o) {
        return (
          '<button type="button" class="seg' + (selected === o ? " active" : "") +
          '" data-val="' + esc(o) + '">' + esc(o) + "</button>"
        );
      }).join("") +
      "</div>"
    );
  }

  // Wire a segmented control: single-select, tap the active one to clear it.
  // Returns a getter for the current value (or null).
  function wireSegmented(card, id) {
    var seg = card.querySelector("#" + id);
    if (seg) {
      seg.addEventListener("click", function (e) {
        var btn = e.target.closest(".seg");
        if (!btn) return;
        var already = btn.classList.contains("active");
        Array.prototype.forEach.call(seg.querySelectorAll(".seg"), function (s) {
          s.classList.remove("active");
        });
        if (!already) btn.classList.add("active");
      });
    }
    return function () {
      var active = seg && seg.querySelector(".seg.active");
      return active ? active.dataset.val : null;
    };
  }

  // Small circular avatar for rosters (photo or first initial).
  function miniAvatar(r) {
    var inner = r.photoDataUrl
      ? '<img src="' + esc(r.photoDataUrl) + '" alt="" />'
      : esc((r.displayName || "?").trim().charAt(0).toUpperCase() || "?");
    return '<span class="roster-avatar">' + inner + flagBadge(r.heritageFlag) + "</span>";
  }

  function rosterItem(r) {
    return (
      '<li class="roster-item is-clickable" role="button" tabindex="0" data-uid="' + esc(r.uid) + '">' +
      miniAvatar(r) +
      '<span class="roster-name">' + esc(r.displayName) + "</span>" +
      (r.skillLevel ? '<span class="roster-skill">' + esc(r.skillLevel) + "</span>" : "") +
      (r.rating != null ? '<span class="roster-rating">' + esc(r.rating) + "</span>" : "") +
      "</li>"
    );
  }

  // ---- Connect: DUPR leaderboard (sample data for now) ----
  // TODO: replace with real players once the DUPR integration lands.
  var LEADERBOARD = [
    { name: "Derek Chu", flag: "🇨🇳", dupr: 3.10, lotus: 888 },
    { name: "Ralph Llacar", flag: "🇨🇦", dupr: 6.82, lotus: 800 },
    { name: "Jeremy Lin", flag: "🇹🇼", dupr: 6.50, lotus: 750 },
    { name: "Priya Nair", flag: "🇮🇳", dupr: 6.61, lotus: 720 },
    { name: "Marco Silva", flag: "🇧🇷", dupr: 6.75, lotus: 700 },
    { name: "Leo Tanaka", flag: "🇯🇵", dupr: 6.40, lotus: 680 },
    { name: "Sofia Rossi", flag: "🇮🇹", dupr: 6.28, lotus: 660 },
    { name: "James Park", flag: "🇰🇷", dupr: 6.15, lotus: 640 },
    { name: "Emma Müller", flag: "🇩🇪", dupr: 6.03, lotus: 620 },
    { name: "Noah Smith", flag: "🇺🇸", dupr: 5.77, lotus: 600 },
  ];
  // Which metric the leaderboard is ranked by ("dupr" | "lotus"). Lotus Score
  // is the default view.
  var rankMetric = "lotus";
  function rankValueStr(pl) {
    return rankMetric === "lotus" ? String(pl.lotus) : pl.dupr.toFixed(2);
  }

  function podiumCol(pl, rank) {
    var medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
    var cls = rank === 1 ? "gold" : rank === 2 ? "silver" : "bronze";
    var init = pl.name.trim().charAt(0).toUpperCase();
    return (
      '<div class="podium-col ' + cls + '">' +
      (rank === 1 ? '<div class="podium-crown">👑</div>' : "") +
      '<div class="podium-avatar">' + esc(init) + flagBadge(pl.flag) + "</div>" +
      '<div class="podium-medal">' + medal + "</div>" +
      '<div class="podium-name">' + esc(pl.name) + "</div>" +
      '<div class="podium-dupr">' + esc(rankValueStr(pl)) + "</div>" +
      '<div class="podium-stand"><span class="podium-rank">' + rank + "</span></div>" +
      "</div>"
    );
  }

  // ---- Connect: find & connect with players (sample data for now) ----
  var CONNECT_PLAYERS = [
    { name: "Jenny Kim", flag: "🇰🇷", skill: "Intermediate", city: "Toronto" },
    { name: "Raj Patel", flag: "🇮🇳", skill: "Advanced", city: "Mississauga" },
    { name: "Maria Lopez", flag: "🇲🇽", skill: "Beginner", city: "Toronto" },
    { name: "Kevin Wong", flag: "🇭🇰", skill: "Intermediate", city: "Markham" },
    { name: "Aisha Khan", flag: "🇵🇰", skill: "Advanced", city: "Brampton" },
    { name: "Tom Nguyen", flag: "🇻🇳", skill: "Intermediate", city: "Scarborough" },
  ];

  function connectCard(pl) {
    return (
      '<article class="card connect-card">' +
      '<span class="connect-avatar">' + esc(pl.name.trim().charAt(0).toUpperCase()) + flagBadge(pl.flag) + "</span>" +
      '<div class="connect-body"><h3>' + esc(pl.name) + "</h3>" +
      '<p class="muted">' + esc(pl.skill) + " · " + esc(pl.city) + "</p></div>" +
      '<button class="btn-connect" data-connect="' + esc(pl.name) + '" type="button">Connect</button>' +
      "</article>"
    );
  }

  function renderConnect() {
    main.innerHTML = "";
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(
      el(
        '<div class="view-head"><h2>Connect</h2>' +
          '<p class="muted">Find and connect with other players.</p></div>'
      )
    );
    var search = el(
      '<div class="input-wrap"><span class="lead" aria-hidden="true">🔍</span>' +
        '<input class="has-icon" id="connect-search" type="text" placeholder="Search players by name…" /></div>'
    );
    wrap.appendChild(search);
    var listEl = el('<div class="stack" id="connect-list"></div>');
    wrap.appendChild(listEl);
    main.appendChild(wrap);

    function draw(q) {
      var query = (q || "").trim().toLowerCase();
      var items = CONNECT_PLAYERS.filter(function (pl) {
        return !query || pl.name.toLowerCase().indexOf(query) > -1 || pl.city.toLowerCase().indexOf(query) > -1;
      });
      listEl.innerHTML = items.length
        ? items.map(connectCard).join("")
        : '<div class="empty">No players found.</div>';
    }
    draw("");
    search.querySelector("#connect-search").addEventListener("input", function (e) {
      draw(e.target.value);
    });
    listEl.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-connect]");
      if (!btn) return;
      btn.textContent = "Requested";
      btn.disabled = true;
      btn.classList.add("is-requested");
      toast("Connection request sent to " + btn.dataset.connect + "!");
    });
  }

  function renderRank() {
    main.innerHTML = "";
    var isLotus = rankMetric === "lotus";
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(
      el(
        '<div class="rank-head">' +
          "<div><h2>Leaderboard</h2>" +
          '<p class="muted">Top ' + (isLotus ? "Lotus Score" : "DUPR-rated") + " players on Lotus Hub.</p></div>" +
          '<div class="menu-wrap">' +
          '<button class="filter-btn" id="rank-filter" type="button" aria-label="Filter leaderboard" title="Filter">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>' +
          "</button>" +
          '<div class="filter-menu" id="rank-menu" hidden>' +
          '<div class="filter-menu-label">Rank by</div>' +
          '<button class="filter-item' + (!isLotus ? " selected" : "") + '" data-metric="dupr" type="button">DUPR</button>' +
          '<button class="filter-item' + (isLotus ? " selected" : "") + '" data-metric="lotus" type="button">Lotus Score</button>' +
          "</div></div></div>"
      )
    );

    if (isLotus) {
      wrap.appendChild(
        el(
          '<div class="lotus-note"><strong>Lotus Score</strong> is your overall player rating — combining your ' +
            "skill, performance, activity, and community involvement into one score.</div>"
        )
      );
    }

    var ranked = LEADERBOARD.slice().sort(function (a, b) {
      return (isLotus ? b.lotus - a.lotus : b.dupr - a.dupr);
    });
    var top3 = ranked.slice(0, 3);
    var podium = el(
      '<div class="card podium-card"><div class="podium">' +
        (top3[1] ? podiumCol(top3[1], 2) : "") +
        (top3[0] ? podiumCol(top3[0], 1) : "") +
        (top3[2] ? podiumCol(top3[2], 3) : "") +
        "</div></div>"
    );
    wrap.appendChild(podium);

    var rows = ranked
      .slice(3)
      .map(function (pl, i) {
        var rank = i + 4;
        return (
          '<div class="lb-row">' +
          '<span class="lb-rank">' + rank + "</span>" +
          '<span class="lb-avatar">' + esc(pl.name.trim().charAt(0).toUpperCase()) + flagBadge(pl.flag) + "</span>" +
          '<span class="lb-name">' + esc(pl.name) + "</span>" +
          '<span class="lb-dupr">' + esc(rankValueStr(pl)) + "</span>" +
          "</div>"
        );
      })
      .join("");
    wrap.appendChild(el('<div class="card lb-list">' + rows + "</div>"));
    wrap.appendChild(
      el('<p class="muted" style="text-align:center">Sample rankings — real standings arrive with the DUPR integration.</p>')
    );
    main.appendChild(wrap);

    var filterBtn = wrap.querySelector("#rank-filter");
    var filterMenu = wrap.querySelector("#rank-menu");
    function onDocClick(e) {
      if (!filterMenu.contains(e.target) && !filterBtn.contains(e.target)) closeMenu();
    }
    function closeMenu() {
      filterMenu.hidden = true;
      document.removeEventListener("click", onDocClick);
    }
    filterBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (filterMenu.hidden) {
        filterMenu.hidden = false;
        setTimeout(function () { document.addEventListener("click", onDocClick); }, 0);
      } else {
        closeMenu();
      }
    });
    filterMenu.addEventListener("click", function (e) {
      var item = e.target.closest("[data-metric]");
      if (!item) return;
      document.removeEventListener("click", onDocClick);
      rankMetric = item.dataset.metric;
      renderRank();
    });
  }

  // Meta row whose value is trusted HTML (e.g. a link). Label is still escaped.
  function metaRowRaw(label, valHtml) {
    return (
      '<div class="meta-row"><span class="meta-label">' + esc(label) + "</span>" +
      '<span class="meta-val">' + valHtml + "</span></div>"
    );
  }
  // "Mar 2024" from a Firestore timestamp (or nothing if unset).
  function fmtMemberSince(ts) {
    if (!ts) return "";
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
  // Strip a leading @ and whitespace from a handle.
  function cleanHandle(s) {
    return String(s || "").trim().replace(/^@+/, "");
  }
  // Rating line: a bold number with a small tag. Verified DUPR ratings show
  // "DUPR <n>" + a green Verified tag; self-reported ones show just the number
  // + a neutral Self-rated tag (no "DUPR" word).
  function ratingHtml(linked, rating) {
    return (
      '<span class="rating-pill' + (linked ? " verified" : "") + '">' +
      '<span class="rp-label">' + (linked ? "DUPR" : "Self-rated") + "</span>" +
      '<span class="rp-val">' + esc(rating) + "</span>" +
      (linked ? '<span class="rp-check" aria-hidden="true">✓</span>' : "") +
      "</span>"
    );
  }

  // Shared read-only profile body (hero + bio + style + facts). Used by both the
  // owner's "how visitors see you" view and the visitor player view so the two
  // never drift apart.
  function profileBody(p) {
    var linked = !!p.duprLinked;
    var manualVal = p.duprManual != null ? String(p.duprManual) : "";
    var shownRating = linked && p.homeRatingDoubles != null ? String(p.homeRatingDoubles) : manualVal;
    var since = fmtMemberSince(p.createdAt);
    var ig = cleanHandle(p.instagram);

    var tags =
      (p.skillLevel ? '<span class="identity-skill">' + esc(p.skillLevel) + "</span>" : "") +
      (shownRating ? ratingHtml(linked, shownRating) : "") +
      (p.lotusScore != null ? '<span class="chip lotus-chip">🪷 Lotus ' + esc(p.lotusScore) + "</span>" : "");

    var facts =
      (p.country ? metaRow("Location", p.country) : "") +
      (p.favCourt ? metaRow("Home court", p.favCourt) : "") +
      (p.availability ? metaRow("Usually free", p.availability) : "") +
      (p.favPaddle ? metaRow("Paddle", p.favPaddle) : "") +
      (ig
        ? metaRowRaw(
            "Instagram",
            '<a class="meta-link" href="https://instagram.com/' + encodeURIComponent(ig) +
              '" target="_blank" rel="noopener noreferrer">@' + esc(ig) + "</a>"
          )
        : "") +
      (since ? metaRow("Member since", since) : "");

    return (
      '<div class="profile-hero">' +
      '<div class="avatar-preview">' + avatarFace(p) +
      (linked ? '<span class="av-verified" title="DUPR verified">✓</span>' : "") +
      flagBadge(heritageFlagOf(p)) + "</div>" +
      '<div class="identity-name">' + esc(p.displayName || "Player") + "</div>" +
      (tags ? '<div class="identity-tags">' + tags + "</div>" : "") +
      (p.bio ? '<p class="profile-bio">' + esc(p.bio).replace(/\n/g, "<br>") + "</p>" : "") +
      "</div>" +
      '<div class="pstats" data-stats hidden></div>' +
      facts
    );
  }

  // Action bar shown to a VISITOR looking at someone else's profile.
  function visitorActions(p) {
    return (
      '<div class="visitor-actions">' +
      '<button class="btn-primary va-connect" type="button">＋ Connect</button>' +
      '<button class="btn-ghost va-message" type="button">💬 Message</button>' +
      '<button class="btn-ghost va-invite" type="button">🏓 Invite</button>' +
      "</div>" +
      '<div class="visitor-more">' +
      (p.isCoach ? '<button class="btn-ghost full va-coach" type="button">🎯 View coaching profile</button>' : "") +
      '<button class="linkish va-report" type="button">Report or block</button>' +
      "</div>"
    );
  }

  function wireVisitorActions(card, p) {
    var connect = card.querySelector(".va-connect");
    if (connect) {
      connect.addEventListener("click", function () {
        // No connections collection/rules yet — mirror the Connect tab (a local
        // acknowledgement). Persisting the social graph lands with its own rules.
        connect.textContent = "Requested";
        connect.disabled = true;
        connect.classList.add("is-joined");
        toast("Connection request sent to " + (p.displayName || "player") + "!");
      });
    }
    var message = card.querySelector(".va-message");
    if (message) {
      message.addEventListener("click", function () {
        var ig = cleanHandle(p.instagram);
        if (ig) {
          window.open("https://instagram.com/" + encodeURIComponent(ig), "_blank", "noopener");
        } else {
          toast("No contact info yet — try connecting first.");
        }
      });
    }
    var invite = card.querySelector(".va-invite");
    if (invite) {
      invite.addEventListener("click", function () {
        toast("Host a session, then share it with " + (p.displayName || "them") + " to play together.");
        state.view = "create";
        renderSignedIn();
      });
    }
    var coach = card.querySelector(".va-coach");
    if (coach) {
      coach.addEventListener("click", function () {
        state.viewingCoachUid = p.uid;
        state.view = "coach-view";
        renderSignedIn();
      });
    }
    var report = card.querySelector(".va-report");
    if (report) {
      report.addEventListener("click", function () {
        if (window.confirm("Report or block " + (p.displayName || "this player") + "? Our team will review.")) {
          toast("Thanks — we'll review this player.");
        }
      });
    }
  }

  // Visitor view of another player's profile (read-only + action bar).
  function renderPlayerView(uid) {
    main.innerHTML = "";
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(
      el('<div class="view-head"><button class="link-back" id="back" type="button">‹ Back</button></div>')
    );
    var card = el('<section class="card stack profile-card"><p class="muted">Loading…</p></section>');
    wrap.appendChild(card);
    main.appendChild(wrap);

    wrap.querySelector("#back").addEventListener("click", function () {
      state.view = state.playerBackView || "discover";
      renderSignedIn();
    });

    if (!uid) {
      card.innerHTML = '<p class="muted">Player not found.</p>';
      return;
    }
    var me = LH.currentUser();
    LH.getUserOnce(uid)
      .then(function (p) {
        if (!p) {
          card.innerHTML = '<p class="muted">Player not found.</p>';
          return;
        }
        var isSelf = !!(me && me.uid === uid);
        card.innerHTML = profileBody(p) + (isSelf ? "" : visitorActions(p));
        attachStats(card, uid);
        if (!isSelf) wireVisitorActions(card, p);
      })
      .catch(function () {
        card.innerHTML = '<p class="muted">Could not load this player.</p>';
      });
  }

  // Read-only "how visitors see you" profile, with a gear to open settings.
  function renderProfileView() {
    main.innerHTML = "";
    var p = state.profile || {};

    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(
      el(
        '<div class="profile-topbar">' +
          '<button class="gear-btn" id="add-friend" type="button" aria-label="Find friends" title="Find friends">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>' +
          "</button>" +
          '<button class="gear-btn" id="share-profile" type="button" aria-label="Share profile" title="Share profile">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>' +
          "</button>" +
          '<button class="gear-btn" id="open-settings" type="button" aria-label="Settings" title="Settings">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>' +
          "</button>" +
          "</div>"
      )
    );
    var card = el('<section class="card stack profile-card">' + profileBody(p) + "</section>");
    wrap.appendChild(card);
    attachStats(card, state.user && state.user.uid);
    wrap.appendChild(
      el('<p class="muted" style="text-align:center">This is how your profile appears to other players.</p>')
    );

    // Slide-in settings side panel (opened by the gear).
    var overlay = el('<div class="drawer-overlay" id="settings-overlay"></div>');
    var drawer = el(
      '<aside class="drawer" id="settings-drawer" role="dialog" aria-label="Settings">' +
        '<div class="drawer-head"><h3>Settings</h3><button class="drawer-close" id="drawer-close" aria-label="Close">✕</button></div>' +
        '<button class="drawer-item" id="drawer-edit" type="button">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>' +
        " Edit profile</button>" +
        '<button class="drawer-item drawer-item-danger" id="drawer-signout" type="button">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>' +
        " Sign out</button>" +
        "</aside>"
    );
    wrap.appendChild(overlay);
    wrap.appendChild(drawer);
    main.appendChild(wrap);

    function openPanel() {
      overlay.classList.add("show");
      drawer.classList.add("open");
    }
    function closePanel() {
      overlay.classList.remove("show");
      drawer.classList.remove("open");
    }
    wrap.querySelector("#open-settings").addEventListener("click", openPanel);
    // Find friends → the Connect tab (where you discover & connect with players).
    wrap.querySelector("#add-friend").addEventListener("click", function () {
      state.view = "connect";
      renderSignedIn();
    });
    // Share → native share sheet, falling back to copying the link.
    wrap.querySelector("#share-profile").addEventListener("click", function () {
      var url = window.location.origin + "/";
      var data = { title: "Lotus Hub", text: "Check out Lotus Hub — open-play pickleball 🪷", url: url };
      if (navigator.share) {
        navigator.share(data).catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toast("Profile link copied!"); }, function () { toast(url); });
      } else {
        toast(url);
      }
    });
    overlay.addEventListener("click", closePanel);
    drawer.querySelector("#drawer-close").addEventListener("click", closePanel);
    drawer.querySelector("#drawer-edit").addEventListener("click", function () {
      closePanel();
      state.view = "profile-edit";
      renderSignedIn();
    });
    drawer.querySelector("#drawer-signout").addEventListener("click", function () {
      function reload() { window.location.reload(); }
      LH.signOut().then(reload, reload);
    });
  }

  function renderProfileEdit() {
    main.innerHTML = "";
    var p = state.profile || {};
    var linked = !!p.duprLinked;
    var manualVal = p.duprManual != null ? String(p.duprManual) : "";
    // Verified (API) rating wins; otherwise show the self-reported one.
    var shownRating = linked && p.homeRatingDoubles != null ? String(p.homeRatingDoubles) : manualVal;
    var duprValue = shownRating;
    var myFlag = heritageFlagOf(p);
    var card = el(
      '<section class="card stack profile-card">' +
        '<div class="profile-hero">' +
        '<div class="identity-name' + (p.displayName ? "" : " is-empty") + '" id="name-preview">' +
        esc(p.displayName || "Your name") + "</div>" +
        '<div class="avatar-preview" id="avatar-preview">' + avatarFace(p) + AVATAR_EDIT_BTN + flagEditBtn(myFlag) + "</div>" +
        '<input type="file" id="photo-input" accept="image/*" hidden />' +
        '<button type="button" class="flag-hint" id="flag-hint">🌍 Represent your native country — tap to display your flag</button>' +
        (shownRating ? ratingHtml(linked, shownRating) : "") +
        '<div class="identity-skill" id="skill-preview"' + (p.skillLevel ? "" : " hidden") + ">" +
        esc(p.skillLevel || "") + "</div>" +
        "</div>" +
        '<div class="field"><label>Name</label>' +
        '<input id="p-name" type="text" placeholder="Your name" value="' + esc(p.displayName || "") + '" /></div>' +
        '<div class="field"><label>What\'s your game? <span class="muted">(short bio)</span></label>' +
        '<textarea id="p-bio" rows="3" placeholder="e.g. Weeknight dinker chasing 4.0 — always up for a competitive doubles game.">' + esc(p.bio || "") + "</textarea></div>" +
        '<div class="field"><label>Pickleball Skill Level</label>' +
        segmentedSkill(p.skillLevel) + "</div>" +
        '<div class="field"><label>Location</label>' +
        '<input id="p-country" type="text" placeholder="e.g. Toronto, Canada 🇨🇦" value="' + esc(p.country || "") + '" /></div>' +
        '<div class="field"><label>Instagram</label>' +
        '<div class="input-wrap"><span class="lead" aria-hidden="true">@</span>' +
        '<input class="has-icon" id="p-ig" type="text" placeholder="yourhandle" autocapitalize="none" value="' + esc(cleanHandle(p.instagram)) + '" /></div></div>' +
        '<div class="field"><label>Favourite court?</label>' +
        '<div class="input-wrap"><span class="lead" aria-hidden="true">📍</span>' +
        '<input class="has-icon" id="p-court" type="text" placeholder="e.g. Pickleplex Downsview" value="' + esc(p.favCourt || "") + '" /></div></div>' +
        '<div class="field"><label>Favourite paddle?</label>' +
        '<div class="input-wrap"><span class="lead" aria-hidden="true">🏓</span>' +
        '<input class="has-icon" id="p-paddle" type="text" placeholder="e.g. Selkirk Vanguard" value="' + esc(p.favPaddle || "") + '" /></div></div>' +
        '<div class="field"><label>Usually free</label>' +
        '<input id="p-avail" type="text" placeholder="e.g. Evenings &amp; weekends" value="' + esc(p.availability || "") + '" /></div>' +
        '<button class="btn-primary" id="save-profile" type="button">Save profile</button>' +
        '<p class="save-status" id="save-status" hidden></p>' +
        '<div class="dupr-box">' +
        '<div class="dupr-head"><h3>DUPR rating</h3>' +
        '<span class="chip ' + (linked ? "chip-ok" : manualVal ? "chip-warn" : "chip-muted") + '">' +
        (linked ? "Connected" : manualVal ? "Self-reported" : "Not connected") + "</span></div>" +
        (linked
          ? '<div class="field"><label>Rating</label>' +
            '<input id="p-dupr" type="text" value="' + esc(duprValue) + '" disabled /></div>' +
            '<p class="muted">Verified — updates automatically from your matches.</p>' +
            '<button class="btn-ghost" id="refresh-dupr" type="button">Refresh rating</button>'
          : '<div class="field"><label>Your DUPR rating</label>' +
            '<input id="p-dupr" type="number" step="0.001" min="2" max="8.5" value="' + esc(manualVal) + '" placeholder="e.g. 3.750" /></div>' +
            '<button class="btn-ghost" id="save-dupr" type="button">Save rating</button>' +
            '<p class="muted">Self-reported for now. Once our DUPR API access is approved, you can ' +
            "connect your account and ratings verify automatically.</p>" +
            '<button class="btn-primary" id="link-dupr" type="button">Connect DUPR</button>' +
            '<div id="dupr-link-form" hidden>' +
            '<div class="field" style="margin-top:12px"><label>DUPR account email</label>' +
            '<input id="dupr-email" type="email" placeholder="you@example.com" autocomplete="email" /></div>' +
            '<button class="btn-primary" id="dupr-link-go" type="button">Link account</button>' +
            "</div>") +
        '<p class="save-status" id="dupr-status" hidden></p>' +
        "</div>" +
        '<button class="btn-signout" id="signout-btn" type="button">Sign out</button>' +
        "</section>"
    );
    main.appendChild(card);

    card.querySelector("#signout-btn").addEventListener("click", function () {
      // Reload to a clean state afterward so a stale/invalid session can't leave
      // the app stuck showing a signed-in view with no real Firebase user.
      function reload() {
        window.location.reload();
      }
      LH.signOut().then(reload, reload);
    });

    // ---- flag picker ----
    function openPicker() {
      openFlagPicker(myFlag, function (flag) {
        saveFlag(flag)
          .then(function () { renderProfileEdit(); })
          .catch(function () { toast("Couldn't save your flag."); });
      });
    }
    var flagHint = card.querySelector("#flag-hint");
    if (flagHint) flagHint.addEventListener("click", openPicker);

    // ---- photo upload ----
    // Delegate on the container so the handler survives innerHTML swaps: the
    // flag badge opens the flag picker; anywhere else opens the photo picker.
    var photoInput = card.querySelector("#photo-input");
    card.querySelector("#avatar-preview").addEventListener("click", function (e) {
      if (e.target.closest("#flag-pick")) {
        openPicker();
        return;
      }
      photoInput.click();
    });
    photoInput.addEventListener("change", function () {
      var file = photoInput.files && photoInput.files[0];
      if (!file) return;
      var u = LH.currentUser() || state.user;
      if (!u) return toast("You're not signed in. Please sign in again.");
      resizeImage(file, 256)
        .then(function (dataUrl) {
          card.querySelector("#avatar-preview").innerHTML =
            '<img src="' + dataUrl + '" alt="" />' + AVATAR_EDIT_BTN + flagEditBtn(myFlag);
          return firebase
            .firestore()
            .collection("users")
            .doc(u.uid)
            .set({ photoDataUrl: dataUrl }, { merge: true });
        })
        .then(function () {
          toast("Photo updated.");
        })
        .catch(function (err) {
          console.error("Photo save failed:", err);
          toast("Could not update photo: " + (err && (err.message || err.code) ? err.message || err.code : "unknown error"));
        });
    });

    // ---- live preview: name under the avatar ----
    var nameInput = card.querySelector("#p-name");
    var namePreview = card.querySelector("#name-preview");
    function refreshNamePreview() {
      var v = nameInput.value.trim();
      namePreview.textContent = v || "Your name";
      namePreview.classList.toggle("is-empty", !v);
    }
    nameInput.addEventListener("input", refreshNamePreview);

    // ---- segmented skill control ----
    var skillSeg = card.querySelector("#p-skill");
    var skillPreview = card.querySelector("#skill-preview");
    skillSeg.addEventListener("click", function (e) {
      var btn = e.target.closest(".seg");
      if (!btn) return;
      var already = btn.classList.contains("active");
      Array.prototype.forEach.call(skillSeg.querySelectorAll(".seg"), function (s) {
        s.classList.remove("active");
      });
      if (!already) btn.classList.add("active"); // tapping the active one clears it
      var val = already ? "" : btn.dataset.val;
      skillPreview.textContent = val;
      skillPreview.hidden = !val;
    });
    function selectedSkill() {
      var active = skillSeg.querySelector(".seg.active");
      return active ? active.dataset.val : null;
    }


    // ---- save profile fields ----
    var statusEl = card.querySelector("#save-status");
    function setStatus(msg, kind) {
      statusEl.hidden = false;
      statusEl.textContent = msg;
      statusEl.className = "save-status" + (kind ? " " + kind : "");
    }
    card.querySelector("#save-profile").addEventListener("click", function () {
      try {
        var name = card.querySelector("#p-name").value.trim();
        if (!name) return setStatus("Name can't be empty.", "err");
        if (!LH.ready) return setStatus("Not connected to the database yet — try again in a moment.", "err");
        var u = LH.currentUser() || state.user;
        if (!u) return setStatus("You're not signed in. Please sign in again.", "err");
        setStatus("Saving…", "");
        firebase
          .firestore()
          .collection("users")
          .doc(u.uid)
          .set(
            {
              displayName: name,
              bio: card.querySelector("#p-bio").value.trim() || null,
              skillLevel: selectedSkill(),
              country: card.querySelector("#p-country").value.trim() || null,
              favCourt: card.querySelector("#p-court").value.trim() || null,
              favPaddle: card.querySelector("#p-paddle").value.trim() || null,
              availability: card.querySelector("#p-avail").value.trim() || null,
              instagram: cleanHandle(card.querySelector("#p-ig").value) || null,
            },
            { merge: true }
          )
          .then(function () {
            toast("Saved.");
            // Show the profile as visitors see it after saving.
            state.view = "profile";
            renderSignedIn();
          })
          .catch(function (err) {
            console.error("Profile save failed:", err);
            setStatus("Couldn't save — " + (err && (err.code || err.message) ? err.code || err.message : "unknown error"), "err");
          });
      } catch (e) {
        console.error("Profile save threw:", e);
        setStatus("Couldn't save — " + (e && e.message ? e.message : "unexpected error"), "err");
      }
    });

    // ---- DUPR connect / refresh (calls Cloud Functions) ----
    var duprStatus = card.querySelector("#dupr-status");
    function setDuprStatus(msg, kind) {
      duprStatus.hidden = false;
      duprStatus.textContent = msg;
      duprStatus.className = "save-status" + (kind ? " " + kind : "");
    }
    function friendlyDuprError(err) {
      var code = err && err.code ? String(err.code) : "";
      // Function missing/unreachable == not deployed yet.
      if (code.indexOf("not-found") > -1 || code.indexOf("internal") > -1 || code.indexOf("unavailable") > -1) {
        return "DUPR linking isn't live yet — the Cloud Functions need to be deployed (see functions/README).";
      }
      return (err && err.message) || "Couldn't link DUPR.";
    }

    var linkBtn = card.querySelector("#link-dupr");
    if (linkBtn) {
      var linkForm = card.querySelector("#dupr-link-form");
      linkBtn.addEventListener("click", function () {
        linkForm.hidden = false;
        linkBtn.hidden = true;
        var e = card.querySelector("#dupr-email");
        if (e) e.focus();
      });
      card.querySelector("#dupr-link-go").addEventListener("click", function () {
        var email = card.querySelector("#dupr-email").value.trim();
        if (!email) return setDuprStatus("Enter the email on your DUPR account.", "err");
        setDuprStatus("Linking…", "");
        LH.linkDupr(email)
          .then(function () {
            setDuprStatus("Linked ✓", "ok");
            renderProfileEdit();
          })
          .catch(function (err) {
            console.error("linkDupr failed:", err);
            setDuprStatus(friendlyDuprError(err), "err");
          });
      });
    }

    var refreshBtn = card.querySelector("#refresh-dupr");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        setDuprStatus("Refreshing…", "");
        LH.refreshDuprRating()
          .then(function () {
            setDuprStatus("Updated ✓", "ok");
            renderProfileEdit();
          })
          .catch(function (err) {
            setDuprStatus(friendlyDuprError(err), "err");
          });
      });
    }

    var saveDuprBtn = card.querySelector("#save-dupr");
    if (saveDuprBtn) {
      saveDuprBtn.addEventListener("click", function () {
        var raw = card.querySelector("#p-dupr").value.trim();
        var u = LH.currentUser() || state.user;
        if (!u) return setDuprStatus("You're not signed in.", "err");
        var val = raw === "" ? null : parseFloat(raw);
        if (raw !== "" && (isNaN(val) || val < 2 || val > 8.5)) {
          return setDuprStatus("Enter a DUPR rating between 2.0 and 8.5.", "err");
        }
        setDuprStatus("Saving…", "");
        firebase
          .firestore()
          .collection("users")
          .doc(u.uid)
          .set({ duprManual: val }, { merge: true })
          .then(function () {
            setDuprStatus("Saved ✓", "ok");
            renderProfileEdit();
          })
          .catch(function (err) {
            setDuprStatus("Couldn't save — " + (err && (err.code || err.message) ? err.code || err.message : "error"), "err");
          });
      });
    }
  }

  // ---- wiring -----------------------------------------------------------
  function subscribeData() {
    if (state.unsub.sessions) state.unsub.sessions();
    state.unsub.sessions = LH.watchUpcomingSessions(function (list) {
      state.sessions = list;
      if (state.user && state.view === "discover") renderDiscover();
    });
    if (state.user) {
      if (state.unsub.profile) state.unsub.profile();
      state.unsub.profile = LH.watchUser(state.user.uid, function (doc) {
        // Keep the cached profile fresh, but don't re-render the profile form
        // while it's open — that would wipe fields the user is mid-editing.
        // The form is rebuilt from state.profile each time it's opened.
        state.profile = doc;
      });
    }
  }

  tabs.addEventListener("click", function (e) {
    var t = e.target.closest(".tab");
    if (!t) return;
    state.view = t.dataset.view;
    renderSignedIn();
  });

  // Keyboard support for card-style controls that use role="button" (coach and
  // clickable cards): activate them on Enter/Space like a real button would.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    var t = e.target;
    if (!t || typeof t.closest !== "function") return;
    var target = t.closest('[role="button"]');
    if (!target || target.tagName === "BUTTON" || target.tagName === "A") return;
    e.preventDefault();
    target.click();
  });


  function start() {
    var ok = renderBanner();
    LH.init();
    if (!ok) {
      renderSignedOut();
      return;
    }
    LH.onAuth(function (user) {
      state.user = user;
      if (user) {
        subscribeData();
        renderSignedIn();
      } else {
        state.profile = null;
        if (state.unsub.profile) state.unsub.profile();
        renderSignedOut();
      }
    });
  }

  start();
})();
