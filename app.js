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
  var settingsBtn = document.getElementById("settings-btn");
  var settingsMenu = document.getElementById("settings-menu");
  var banner = document.getElementById("setup-banner");
  var toastEl = document.getElementById("toast");

  var state = {
    user: null, // Firebase auth user
    profile: null, // Firestore user doc
    view: "discover",
    sessions: [],
    unsub: { sessions: null, profile: null },
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
    if (!LH.available) {
      banner.hidden = false;
      banner.innerHTML =
        "⚙️ <strong>Setup needed.</strong> Paste your new Firebase project's keys into " +
        "<code>firebase-config.js</code> to enable sign-in and open-play data. " +
        "See the README for the 5-minute setup.";
      return false;
    }
    banner.hidden = true;
    return true;
  }

  // ---- auth views -------------------------------------------------------
  function closeMenu() {
    settingsMenu.hidden = true;
    settingsBtn.setAttribute("aria-expanded", "false");
    settingsBtn.classList.remove("active");
  }

  function renderSignedOut() {
    tabs.hidden = true;
    settingsBtn.hidden = true;
    closeMenu();
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
            '<button class="btn-primary" type="submit" id="auth-submit">Sign in</button>' +
            '<button class="btn-ghost full" type="button" id="toggle-mode">New here? Create an account</button>' +
            '<div class="divider"><span>or</span></div>' +
            '<button class="btn-google full" type="button" id="google-btn">Continue with Google</button>' +
            "</form>"
          : '<p class="muted">Sign-in turns on once Firebase is configured.</p>') +
        "</section>"
    );
    main.appendChild(card);
    if (!configured) return;

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
        toast(err.message || "Sign-in failed.");
      }).finally(function () {
        submit.disabled = false;
      });
    });
    card.querySelector("#google-btn").addEventListener("click", function () {
      LH.signInWithGoogle().catch(function (err) {
        toast(err.message || "Google sign-in failed.");
      });
    });
  }

  // ---- signed-in shell --------------------------------------------------
  function renderSignedIn() {
    tabs.hidden = false;
    settingsBtn.hidden = false;
    Array.prototype.forEach.call(tabs.querySelectorAll(".tab"), function (t) {
      t.classList.toggle("active", t.dataset.view === state.view);
    });
    if (state.view === "discover") renderDiscover();
    else if (state.view === "create") renderCreate();
    else if (state.view === "coaching") renderCoaching();
    else if (state.view === "profile") renderProfile();
  }

  function renderCoaching() {
    main.innerHTML = "";
    var wrap = el('<section class="stack"></section>');
    wrap.appendChild(
      el(
        '<div class="view-head"><h2>Coaching</h2>' +
          '<p class="muted">Level up your game with lessons and drills.</p></div>'
      )
    );
    var items = [
      ["🎯", "Find a coach", "Browse local coaches by skill focus and availability."],
      ["📅", "Book a lesson", "Schedule 1-on-1 or small-group sessions."],
      ["📚", "Drills &amp; tips", "A library of drills to sharpen your dinks, serves, and strategy."],
    ];
    items.forEach(function (it) {
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

  function renderDiscover() {
    main.innerHTML = "";
    var wrap = el('<section class="stack"></section>');
    var head = el(
      '<div class="view-head"><h2>Open Play</h2>' +
        '<p class="muted">Upcoming sessions you can join.</p></div>'
    );
    wrap.appendChild(head);

    if (!state.sessions.length) {
      wrap.appendChild(
        el(
          '<div class="empty">No upcoming sessions yet. ' +
            'Tap <strong>Host</strong> to create the first one.</div>'
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
        '<button class="btn-primary btn-rsvp">Join</button>' +
        "</div>" +
        "</article>"
    );

    var rosterEl = card.querySelector(".roster");
    var rosterBtn = card.querySelector(".btn-roster");
    var rsvpBtn = card.querySelector(".btn-rsvp");

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
            ? list
                .map(function (r) {
                  return (
                    "<li>" +
                    esc(r.displayName) +
                    (r.rating != null ? ' <span class="muted">' + r.rating + "</span>" : "") +
                    "</li>"
                  );
                })
                .join("")
            : '<li class="muted">No one yet — be first!</li>';
        });
      }
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
                rating: state.profile ? state.profile.homeRatingDoubles : null,
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

  function renderCreate() {
    main.innerHTML = "";
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
    main.appendChild(card);

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

  function renderProfile() {
    main.innerHTML = "";
    var p = state.profile || {};
    var linked = !!p.duprLinked;
    var card = el(
      '<section class="card stack">' +
        "<h2>Profile</h2>" +
        '<div class="field"><label>Name</label>' +
        '<input id="p-name" type="text" value="' + esc(p.displayName || "") + '" /></div>' +
        '<button class="btn-ghost" id="save-name">Save name</button>' +
        '<div class="dupr-box">' +
        "<h3>DUPR rating</h3>" +
        (linked
          ? '<p class="muted">Linked ✓ · Doubles ' +
            (p.homeRatingDoubles != null ? p.homeRatingDoubles : "—") +
            " · Singles " +
            (p.homeRatingSingles != null ? p.homeRatingSingles : "—") +
            "</p>"
          : '<p class="muted">Not linked yet. Connecting your DUPR account lets your ' +
            "open-play results update your official rating.</p>" +
            '<button class="btn-primary" id="link-dupr">Connect DUPR</button>') +
        "</div>" +
        "</section>"
    );
    main.appendChild(card);

    card.querySelector("#save-name").addEventListener("click", function () {
      var name = card.querySelector("#p-name").value.trim();
      if (!name) return toast("Name can't be empty.");
      // Re-run ensure by writing through the wrapper's user doc.
      var u = LH.currentUser();
      if (!u) return;
      firebase
        .firestore()
        .collection("users")
        .doc(u.uid)
        .set({ displayName: name }, { merge: true })
        .then(function () {
          toast("Saved.");
        })
        .catch(function () {
          toast("Could not save.");
        });
    });

    var linkBtn = card.querySelector("#link-dupr");
    if (linkBtn) {
      linkBtn.addEventListener("click", function () {
        // DUPR linking requires the partner API (client secret) which must run
        // server-side in a Cloud Function. Stubbed until that's deployed.
        toast("DUPR connect is coming — needs the server-side partner API (see functions/).");
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
        state.profile = doc;
        if (state.view === "profile") renderProfile();
      });
    }
  }

  tabs.addEventListener("click", function (e) {
    var t = e.target.closest(".tab");
    if (!t) return;
    state.view = t.dataset.view;
    renderSignedIn();
  });

  // Gear menu: toggle, act on items, and close when clicking elsewhere.
  settingsBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var open = settingsMenu.hidden;
    settingsMenu.hidden = !open;
    settingsBtn.setAttribute("aria-expanded", open ? "true" : "false");
    settingsBtn.classList.toggle("active", open);
  });
  settingsMenu.addEventListener("click", function (e) {
    var item = e.target.closest(".menu-item");
    if (!item) return;
    closeMenu();
    if (item.dataset.action === "profile") {
      state.view = "profile";
      renderSignedIn();
    } else if (item.dataset.action === "signout") {
      LH.signOut();
    }
  });
  document.addEventListener("click", function () {
    if (!settingsMenu.hidden) closeMenu();
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
