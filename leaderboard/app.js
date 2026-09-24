/* Lotus Leaderboard — vanilla JS, no build step.
 *
 * Data model: one shared Firestore doc (see /firebase.js -> LH.watchLeaderboard /
 * LH.updateLeaderboard) holding { title, subtitle, entries: [...] }. Anyone
 * can read it; only the coach account(s) in COACH_UIDS can save, enforced by
 * firestore.rules. Falls back to a local copy on this device if Firebase
 * isn't reachable yet (e.g. the rules haven't been published), so the tool
 * still works standalone.
 *
 * Lotus Score = DUPR improvement points + Lotus community points:
 *   +0.01 DUPR improvement = +1 point (calculated automatically from the
 *     Start/End DUPR a player enters — no manual override; shown read-only
 *     in its own field so it's clear it's not editable)
 *   Ranked Play   +1 / session
 *   Social Play   +3 / session
 *   Drill Training +2 / session
 */
(function () {
  "use strict";

  var POINTS = { ranked: 1, social: 3, drill: 2 };
  var params = new URLSearchParams(location.search);

  // Custom line-icon set (replaces emoji throughout the page). Plain inline
  // SVG strings, no icon font/library — stroke="currentColor" so each icon
  // picks up whatever text color its container sets.
  var ICON_ATTRS = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  var ICONS = {
    qr:
      '<svg viewBox="0 0 24 24" ' + ICON_ATTRS + '><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M14 20h3"/><path d="M20 14v3"/><path d="M20 20h.01"/></svg>',
  };

  // Accounts allowed to save. This mirrors isLeaderboardCoach() in
  // firestore.rules, which is what actually enforces it; this list only
  // decides whether to show the editing tools. Firebase Auth UIDs, since they
  // don't depend on how the account signs in.
  var COACH_UIDS = [
    "ewi5OyB2XlcJBTBRWTdqqUFOO1s2", // lotuspickleballacademy@gmail.com
  ];
  var COACH_EMAILS = ["lotuspickleballacademy@gmail.com"]; // only counts once verified
  var user = null;
  var authKnown = false;
  // Apps' built-in browsers (Instagram, Facebook, TikTok…, Android WebViews):
  // Google refuses OAuth sign-in inside them, so point people to a real
  // browser instead of offering a button that can't work.
  var IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|Snapchat|musical_ly|TikTok|; wv\)/i.test(navigator.userAgent || "");
  function isCoach() {
    if (!(window.LH && LH.ready)) return true; // no Firebase: local-only mode, nothing is shared
    if (!user) return false;
    return COACH_UIDS.indexOf(user.uid) !== -1 ||
      (!!user.emailVerified && COACH_EMAILS.indexOf(String(user.email || "").toLowerCase()) !== -1);
  }

  // Board routing: /leaderboard/<slug> (clean path, e.g. shared links) takes
  // over from a bare /leaderboard/ or an explicit ?board= — either works,
  // path wins when both are present. A slug can alias an existing board's
  // storage id so a nicer link doesn't fragment data already on that board.
  function boardIdFromPath() {
    var segments = location.pathname.split("/").filter(Boolean);
    if (segments[0] === "leaderboard") segments.shift();
    var slug = segments[0];
    if (!slug || slug === "index.html") return null;
    return decodeURIComponent(slug);
  }
  var BOARD_ALIASES = { lotusoctoberchallenge: "default", lotus: "default" };
  // Short slugs that always open the read-only player view, so the shared
  // player link doesn't need a ?mode=view tacked on. Each needs a matching
  // rewrite in firebase.json.
  var VIEW_SLUGS = { lotusoctoberchallenge: "default" };
  var requestedBoardId = params.get("board") || boardIdFromPath() || "default";
  var boardId = BOARD_ALIASES[requestedBoardId] || requestedBoardId;
  var LOCAL_KEY = "lotus-leaderboard:" + boardId;
  // Which player this browser picked in "Where do you rank?", so a returning
  // challenger sees their own rank straight away. Per-device convenience only.
  var ME_KEY = "lotus-leaderboard:me:" + boardId;
  var meId = null;
  try { meId = localStorage.getItem(ME_KEY); } catch (err) {}
  // Cosmetic split, not a security boundary: the board itself is open-write
  // to anyone with the link (see firestore.rules), same as the wedding
  // tracker. ?mode=view just hides the editing controls so players get a
  // clean, read-only board to look at.
  var readOnly = params.get("mode") === "view" || VIEW_SLUGS.hasOwnProperty(requestedBoardId);

  var board = {
    // Keep in sync with the placeholder heading in index.html.
    title: "October Lotus Challenge",
    subtitle: "October 1 – October 31",
    entries: [],
    startDate: null, // "YYYY-MM-DD", drives the header countdown
    endDate: null,
    snapshot: null, // { at: "YYYY-MM-DD", ranks: { playerId: rank } }, for movement arrows
    events: [], // upcoming community events, see renderEvents()
  };
  // Fallback dates for a board whose doc doesn't have them saved yet; the
  // edit panel's date fields override these once saved.
  var DEFAULT_DATES = { "default": ["2026-10-01", "2026-10-31"] };
  var lastRemoteDoc = null; // the board as last synced from the server, to roll back a failed save

  var editingId = null;
  var expandedId = null;
  var formOpen = false; // the add/edit player form stays tucked away until needed
  var connected = false;
  var unsub = null;
  var lastUpdated = null; // Date, from Firestore's server-set updatedAt; null until we have a real one

  // ---- helpers ------------------------------------------------------------
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  function int(v) {
    var n = parseInt(v, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }
  function uid() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function fmtSigned(n) {
    n = num(n);
    return (n > 0 ? "+" : "") + n.toFixed(2);
  }
  function formatRelativeTime(date) {
    var secs = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (secs < 45) return "just now";
    var mins = Math.round(secs / 60);
    if (mins < 60) return mins + " minute" + (mins === 1 ? "" : "s") + " ago";
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + " hour" + (hours === 1 ? "" : "s") + " ago";
    var days = Math.round(hours / 24);
    if (days < 7) return days + " day" + (days === 1 ? "" : "s") + " ago";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function computed(e) {
    var duprPoints = Math.round(num(e.duprImprovement) * 100);
    var community =
      int(e.ranked) * POINTS.ranked +
      int(e.social) * POINTS.social +
      int(e.drill) * POINTS.drill;
    return { duprPoints: duprPoints, community: community, total: duprPoints + community };
  }
  function decimals(v) {
    var m = String(num(v)).split(".")[1];
    return m ? m.length : 0;
  }
  // One row per scoring source, laid out in the main table's own columns so
  // each number sits directly under Skill Points or Community Points.
  var SESSION_LABELS = { ranked: "Ranked", social: "Social", drill: "Drill" };
  function breakdownRows(e, restricted) {
    var improvement = num(e.duprImprovement);
    var d = Math.min(3, Math.max(2, decimals(e.startDupr), decimals(e.endDupr)));
    var sign = improvement > 0 ? "+" : "";
    var change = sign + improvement.toFixed(d);
    var duprDetail = e.mode === "range"
      ? num(e.startDupr).toFixed(d) + " &rarr; " + num(e.endDupr).toFixed(d) + '<span class="bd-detail">' + change + "</span>"
      : change;
    var rows = [["DUPR", duprDetail, e._c.duprPoints, ""]];
    [["Ranked Play", int(e.ranked), POINTS.ranked],
     ["Social Play", int(e.social), POINTS.social],
     ["Drill Training", int(e.drill), POINTS.drill]].forEach(function (x) {
      rows.push([x[0], x[1] + " &times; " + x[2] + (x[2] === 1 ? " pt" : " pts"), "", x[1] * x[2]]);
    });
    var html = rows.map(function (r, i) {
      return (
        '<tr class="bd-row' + (restricted && i === rows.length - 1 ? " bd-last" : "") + '">' +
        '<td class="name bd-name" colspan="2"><span class="bd-label">' + r[0] + '</span><span class="bd-detail">' + r[1] + "</span></td>" +
        '<td class="total"><span class="m-only">' + (r[2] !== "" ? r[2] : r[3]) + "</span></td>" +
        '<td class="col-sub">' + r[2] + "</td>" +
        '<td class="col-sub">' + r[3] + "</td>" +
        '<td class="behind"></td>' +
        "</tr>"
      );
    }).join("");
    if (restricted) return html;
    var id = esc(e.id);
    return html +
      '<tr class="bd-row bd-admin bd-last"><td colspan="6"><div class="admin-actions">' +
      '<div class="aa-log"><span class="aa-label">Log a session</span>' +
      ["ranked", "social", "drill"].map(function (f) {
        return '<button type="button" class="btn small session-btn" data-log="' + f + '" data-id="' + id + '">+1 ' + SESSION_LABELS[f] + "</button>";
      }).join("") +
      '</div><div class="aa-manage"><button type="button" class="btn small ghost" data-edit="' + id + '">Edit</button>' +
      '<button type="button" class="btn small danger" data-del="' + id + '">Delete</button></div>' +
      "</div></td></tr>";
  }
  // Players level on Lotus Score share a rank (1, 1, 3, ...). Within a tie
  // the display order is Skill Points then name, which matches the
  // published tie-break for 1st, but the rank number stays shared.
  function sortedEntries(entries) {
    var list = (entries || board.entries)
      .map(function (e) {
        return Object.assign({}, e, { _c: computed(e) });
      })
      .sort(function (a, b) {
        return b._c.total - a._c.total || b._c.duprPoints - a._c.duprPoints || a.name.localeCompare(b.name);
      });
    list.forEach(function (e, i) {
      e._rank = i > 0 && e._c.total === list[i - 1]._c.total ? list[i - 1]._rank : i + 1;
    });
    return list;
  }
  function anyScored(list) {
    return list.some(function (e) { return e._c.total !== 0; });
  }
  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ---- dates / countdown ----------------------------------------------------
  function isoToday() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function dayNum(iso) {
    var p = String(iso).split("-");
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000;
  }
  function validIso(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v); }
  function challengeDates() {
    var fb = DEFAULT_DATES[boardId] || [];
    return {
      start: validIso(board.startDate) ? board.startDate : fb[0] || null,
      end: validIso(board.endDate) ? board.endDate : fb[1] || null,
    };
  }
  function fmtDay(iso) {
    var p = iso.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { month: "long", day: "numeric" });
  }
  // { text, phase: "before" | "live" | "ended" } or null when no dates are set.
  function countdown() {
    var d = challengeDates();
    var today = dayNum(isoToday());
    if (d.start && today < dayNum(d.start)) {
      var n = dayNum(d.start) - today;
      return { phase: "before", text: n === 1 ? "Starts tomorrow" : "Starts in " + n + " days" };
    }
    if (!d.end) return null;
    var left = dayNum(d.end) - today + 1;
    if (left < 1) return { phase: "ended", text: "Challenge ended" };
    return { phase: "live", text: left === 1 ? "Last day!" : left + " days left" };
  }

  // ---- weekly rank snapshot (movement arrows) --------------------------------
  // Written on an admin save at most once a week, from the rankings as they
  // stood before that save. Skipped while nobody has points, so a week of
  // all-zero ties can't produce a wall of arrows.
  function snapshotBefore(doc) {
    var today = isoToday();
    var snap = doc.snapshot;
    if (snap && validIso(snap.at) && dayNum(today) - dayNum(snap.at) < 7) return snap;
    var before = sortedEntries(doc.entries);
    if (!anyScored(before)) return snap || null;
    var ranks = {};
    before.forEach(function (e) { ranks[e.id] = e._rank; });
    return { at: today, ranks: ranks };
  }
  function movementHtml(e) {
    var snap = board.snapshot;
    if (!snap || !snap.ranks || typeof snap.ranks[e.id] !== "number") return "";
    var diff = snap.ranks[e.id] - e._rank;
    if (!diff) return "";
    var up = diff > 0;
    return '<span class="move ' + (up ? "up" : "down") + '" title="' + (up ? "Up " : "Down ") + Math.abs(diff) +
      " since " + esc(fmtDay(snap.at)) + '"><span aria-hidden="true">' + (up ? "&#9650;" : "&#9660;") + "</span>" +
      Math.abs(diff) + '<span class="sr-only">' + (up ? " up" : " down") + "</span></span>";
  }

  // ---- local cache (fallback + resilience) --------------------------------
  function saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(board)); } catch (e) {}
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries)) return parsed;
    } catch (e) {}
    return null;
  }

  // ---- persistence ---------------------------------------------------------
  // Every change is a small mutate(doc) function rather than "write my whole
  // copy of the board". It's applied to the local board straight away (so
  // the UI responds instantly), then re-applied inside a Firestore
  // transaction to the *latest* server copy. Two coaches logging sessions at
  // the same moment therefore both land, instead of the second save
  // silently overwriting the first with its stale list.
  function cleanDoc(src) {
    src = src || {};
    return {
      title: src.title || board.title,
      subtitle: src.subtitle || board.subtitle,
      entries: JSON.parse(JSON.stringify(Array.isArray(src.entries) ? src.entries : [])),
      startDate: validIso(src.startDate) ? src.startDate : null,
      endDate: validIso(src.endDate) ? src.endDate : null,
      snapshot: src.snapshot ? JSON.parse(JSON.stringify(src.snapshot)) : null,
      events: JSON.parse(JSON.stringify(Array.isArray(src.events) ? src.events : [])),
    };
  }
  function commit(mutate) {
    mutate(board);
    saveLocal();
    render();
    if (!(window.LH && LH.ready)) return;
    LH.updateLeaderboard(boardId, function (current) {
      var doc = cleanDoc(current || board);
      doc.snapshot = snapshotBefore(doc);
      mutate(doc);
      return doc;
    }).catch(function (err) {
      if (lastRemoteDoc) {
        var back = cleanDoc(lastRemoteDoc);
        Object.keys(back).forEach(function (k) { board[k] = back[k]; });
        saveLocal();
        render();
      }
      showBanner(err && err.code === "permission-denied"
        ? "That change wasn't saved: only the academy's coach account can edit the leaderboard. Sign in with it and try again."
        : "That change wasn't saved (" + (err && err.message ? err.message : "unknown error") + "). Check your connection and try again.");
    });
  }

  function onRemote(data, err, fromCache) {
    if (err) {
      connected = false;
      showBanner("Couldn't reach the shared board — working from a local copy on this device. (" + err.message + ")");
      var local = loadLocal();
      if (local) board = local;
      render();
      return;
    }
    connected = true;
    if (data) {
      board.title = data.title || board.title;
      board.subtitle = data.subtitle || board.subtitle;
      board.entries = Array.isArray(data.entries) ? data.entries : [];
      board.startDate = data.startDate || null;
      board.endDate = data.endDate || null;
      board.snapshot = data.snapshot || null;
      board.events = Array.isArray(data.events) ? data.events : [];
      lastRemoteDoc = cleanDoc(data);
      // A write we just made ourselves can arrive with updatedAt still null
      // for one snapshot (the serverTimestamp placeholder resolves a moment
      // later) — keep whatever we last had rather than blanking it.
      if (data.updatedAt && typeof data.updatedAt.toDate === "function") {
        lastUpdated = data.updatedAt.toDate();
      }
      hideBanner();
      saveLocal();
    } else {
      var localSeed = loadLocal();
      if (localSeed) board = localSeed;
      // Only create the board when the *server* says it doesn't exist, and
      // never from the player view. An empty-cache snapshot while offline
      // isn't proof, and a seed write queued then would overwrite the real
      // board as soon as the connection came back.
      if (!fromCache && !readOnly && isCoach()) commit(function () {});
      if (fromCache && !board.entries.length) showBanner("Can't reach the leaderboard right now. Check your connection; it'll update as soon as you're back online.");
    }
    render();
  }

  function connect() {
    if (window.LH && LH.available) {
      try { LH.init(); } catch (e) {}
    }
    if (window.LH && LH.ready) {
      unsub = LH.watchLeaderboard(boardId, onRemote);
      LH.onAuth(function (u) {
        user = u;
        authKnown = true;
        render();
      });
      // Coming back from the redirect fallback: surface any sign-in error.
      if (LH.redirectResult) LH.redirectResult.catch(function (err) {
        var msg = signinError(err);
        if (!msg) return;
        els.signinMsg.textContent = msg;
        els.signinMsg.className = "form-msg err";
      });
    } else {
      authKnown = true;
      var local = loadLocal();
      if (local) board = local;
      showBanner("Not connected to the shared board yet — working from a local copy on this device only. See the leaderboard README to finish Firebase setup.");
      render();
    }
  }

  // ---- banner / toast -------------------------------------------------------
  function showBanner(msg) {
    var b = document.getElementById("connBanner");
    b.textContent = msg;
    b.hidden = false;
  }
  function hideBanner() {
    document.getElementById("connBanner").hidden = true;
  }
  var toastTimer = null;
  function toast(msg, actionLabel, onAction) {
    var t = document.getElementById("toast");
    t.textContent = "";
    var text = document.createElement("span");
    text.textContent = msg;
    t.appendChild(text);
    if (actionLabel) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "toast-action";
      b.textContent = actionLabel;
      b.addEventListener("click", function () {
        clearTimeout(toastTimer);
        t.hidden = true;
        onAction();
      });
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, actionLabel ? 6000 : 2200);
  }

  // ---- form -------------------------------------------------------------
  var els = {};
  function cacheEls() {
    [
      "nameInput", "startDuprInput", "endDuprInput",
      "rankedInput", "socialInput", "drillInput",
      "scorePreview", "saveEntryBtn", "cancelEditBtn", "formMsg", "formHeading",
      "boardTitle", "boardSubtitle", "countdown", "editBoardBtn", "editPanel", "titleInput",
      "subtitleInput", "startDateInput", "endDateInput", "saveBoardBtn", "cancelBoardBtn",
      "noScores", "moveHint", "scoringCard", "prizeMeta", "eventsCard", "eventsList",
      "eventsEditBtn", "eventsSub", "eventsEmpty", "eventForm", "evFormTitle", "evDate", "evStart", "evEnd",
      "evTitle", "evType", "evPlace", "evSaveBtn", "evCancelBtn", "evMsg", "menuEventsBtn",
      "rankCard", "rankFind", "rankSearch", "rankMatches", "rankMe",
      "boardEmpty", "boardTable", "boardBody", "boardHint", "playerCount",
      "shareLinkBtn", "formCard", "lockCard", "menuWrap", "menuBtn", "adminMenu", "addPlayerBtn",
      "lockMsg", "googleSignInBtn", "lockSignOutBtn", "pwSignin", "signinEmail", "signinPassword",
      "pwSignInBtn", "signinMsg", "menuSignOutBtn", "inAppNote", "copyAdminLinkBtn",
      "lastUpdatedText", "exportCsvBtn", "qrBtn", "qrCard", "qrWrap",
      "qrUrlText", "qrCopyBtn", "qrCloseBtn",
    ].forEach(function (id) { els[id] = document.getElementById(id); });
  }

  // DUPR improvement is always calculated automatically from Start/End DUPR —
  // no manual override.
  function currentImprovement() {
    return num(els.endDuprInput.value) - num(els.startDuprInput.value);
  }

  function updatePreview() {
    var improvement = currentImprovement();
    var draft = {
      duprImprovement: improvement,
      ranked: els.rankedInput.value, social: els.socialInput.value,
      drill: els.drillInput.value,
    };
    var c = computed(draft);
    els.scorePreview.innerHTML =
      "DUPR change <b>" + fmtSigned(improvement) + "</b> &rarr; Skill <b>" + c.duprPoints + "</b> + Community <b>" + c.community +
      "</b> = Lotus Score <b>" + c.total + "</b>";
  }

  function resetForm() {
    editingId = null;
    els.nameInput.value = "";
    els.startDuprInput.value = "";
    els.endDuprInput.value = "";
    els.rankedInput.value = 0;
    els.socialInput.value = 0;
    els.drillInput.value = 0;
    els.saveEntryBtn.textContent = "Add to leaderboard";
    els.formHeading.textContent = "Add a player";
    els.formMsg.textContent = "";
    els.formMsg.className = "form-msg";
    updatePreview();
  }

  function fillFormForEdit(e) {
    editingId = e.id;
    els.nameInput.value = e.name;
    // Legacy entries saved before DUPR became auto-calculated may only have
    // a manually-typed duprImprovement with no start/end on file — fall back
    // to Start 0 / End <improvement> so the value carries over unchanged.
    if (e.mode === "range") {
      els.startDuprInput.value = e.startDupr != null ? e.startDupr : "";
      els.endDuprInput.value = e.endDupr != null ? e.endDupr : "";
    } else {
      els.startDuprInput.value = 0;
      els.endDuprInput.value = e.duprImprovement != null ? e.duprImprovement : "";
    }
    els.rankedInput.value = e.ranked || 0;
    els.socialInput.value = e.social || 0;
    els.drillInput.value = e.drill || 0;
    els.saveEntryBtn.textContent = "Save changes";
    els.formHeading.textContent = "Edit player";
    els.formMsg.textContent = "";
    updatePreview();
    showForm();
  }
  function showForm() {
    formOpen = true;
    render();
    els.formCard.scrollIntoView({ behavior: "smooth", block: "start" });
    els.nameInput.focus({ preventScroll: true });
  }
  function closeForm() {
    resetForm();
    formOpen = false;
    render();
  }

  function saveEntry() {
    var name = els.nameInput.value.trim();
    if (!name) {
      els.formMsg.textContent = "Enter a player name.";
      els.formMsg.className = "form-msg err";
      els.nameInput.focus();
      return;
    }
    // Catches "did I already add them?" mistakes — case-insensitive, and
    // excludes whichever entry is currently being edited so renaming a
    // player (or re-saving them unchanged) never trips this on itself.
    var isDuplicate = board.entries.some(function (e) {
      return e.id !== editingId && e.name.trim().toLowerCase() === name.toLowerCase();
    });
    if (isDuplicate && !window.confirm('A player named "' + name + '" is already on the board. Add another one with the same name?')) {
      els.nameInput.focus();
      return;
    }
    var entry = {
      id: editingId || uid(),
      name: name,
      mode: "range",
      startDupr: num(els.startDuprInput.value),
      endDupr: num(els.endDuprInput.value),
      duprImprovement: currentImprovement(),
      ranked: int(els.rankedInput.value),
      social: int(els.socialInput.value),
      drill: int(els.drillInput.value),
    };
    var existed = !!editingId;
    formOpen = false;
    resetForm();
    commit(function (doc) {
      var idx = doc.entries.findIndex(function (e) { return e.id === entry.id; });
      if (idx >= 0) doc.entries[idx] = JSON.parse(JSON.stringify(entry));
      else doc.entries.push(JSON.parse(JSON.stringify(entry)));
    });
    toast(existed ? "Saved " + name : "Added " + name + " to the leaderboard");
  }

  function findEntry(id) {
    return board.entries.find(function (x) { return x.id === id; });
  }
  var SESSION_NAMES = { ranked: "Ranked Play", social: "Social Play", drill: "Drill Training" };
  // Adjusts the count on whatever the latest copy holds (not a value
  // computed from this device's possibly-stale copy).
  function bumpSession(id, field, delta) {
    return function (doc) {
      var e = doc.entries.find(function (x) { return x.id === id; });
      if (e) e[field] = Math.max(0, int(e[field]) + delta);
    };
  }
  function logSession(id, field) {
    var e = findEntry(id);
    if (!e) return;
    commit(bumpSession(id, field, 1));
    toast(e.name + ": +1 " + SESSION_NAMES[field] + " (+" + pts(POINTS[field]) + ")", "Undo", function () {
      commit(bumpSession(id, field, -1));
      toast("Undone");
    });
  }

  function editEntryById(id) {
    var e = board.entries.find(function (x) { return x.id === id; });
    if (e) fillFormForEdit(e);
  }

  function deleteEntryById(id) {
    var e = board.entries.find(function (x) { return x.id === id; });
    if (!e) return;
    if (!window.confirm("Remove " + e.name + " from the leaderboard?")) return;
    if (editingId === id) { resetForm(); formOpen = false; }
    commit(function (doc) {
      doc.entries = doc.entries.filter(function (x) { return x.id !== id; });
    });
    toast("Removed " + e.name);
  }

  // ---- board title/subtitle edit -----------------------------------------
  function openEditPanel() {
    var d = challengeDates();
    els.titleInput.value = board.title;
    els.subtitleInput.value = board.subtitle;
    els.startDateInput.value = d.start || "";
    els.endDateInput.value = d.end || "";
    els.editPanel.hidden = false;
  }
  function saveBoardMeta() {
    var title = els.titleInput.value.trim();
    var subtitle = els.subtitleInput.value.trim();
    var start = validIso(els.startDateInput.value) ? els.startDateInput.value : null;
    var end = validIso(els.endDateInput.value) ? els.endDateInput.value : null;
    els.editPanel.hidden = true;
    commit(function (doc) {
      if (title) doc.title = title;
      if (subtitle) doc.subtitle = subtitle;
      doc.startDate = start;
      doc.endDate = end;
    });
    toast("Challenge details saved");
  }

  // ---- coach sign-in ---------------------------------------------------------
  function signinError(err) {
    var code = err && err.code;
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
    if (code === "auth/popup-blocked") return "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found" || code === "auth/invalid-login-credentials") return "That email and password didn't match.";
    if (code === "auth/web-storage-unsupported") return "This browser is blocking what sign-in needs (often private browsing). Try Safari or Chrome in a normal window.";
    if (code === "auth/unauthorized-domain") return "Sign-in isn't enabled for this web address yet.";
    if (code === "auth/account-exists-with-different-credential") return "This account uses email and password. Use \u201cUse email and password instead\u201d below.";
    return (err && err.message) || "Sign-in failed.";
  }
  function showSigninResult(p) {
    els.signinMsg.textContent = "";
    els.signinMsg.className = "form-msg";
    p.catch(function (err) {
      els.signinMsg.textContent = signinError(err);
      els.signinMsg.className = "form-msg err";
    });
  }
  function signOut() {
    LH.signOut().then(function () { toast("Signed out"); });
  }

  // ---- render ---------------------------------------------------------------
  function renderHeader() {
    els.boardTitle.textContent = board.title;
    els.boardSubtitle.textContent = board.subtitle;
    var end = challengeDates().end;
    els.prizeMeta.hidden = !end;
    if (end) els.prizeMeta.textContent = "Awarded to the top Lotus Score on " + fmtDay(end);
    var cd = countdown();
    els.countdown.hidden = !cd;
    if (cd) {
      els.countdown.textContent = cd.text;
      els.countdown.className = "countdown " + cd.phase;
    }
  }

  function render() {
    renderHeader();

    var coach = isCoach();
    var locked = !readOnly && authKnown && !coach;
    var restricted = readOnly || !coach;
    document.body.classList.toggle("read-only", readOnly);
    document.body.classList.toggle("locked", locked);
    els.formCard.hidden = restricted || !formOpen;
    els.addPlayerBtn.hidden = restricted || formOpen;
    els.lockCard.hidden = !locked;
    if (locked) {
      els.lockMsg.textContent = user
        ? "You're signed in as " + (user.email || "another account") + ", which can't edit this leaderboard. Sign out, then sign in with the academy's coach account."
        : "Sign in with the academy's coach account to add players and log sessions.";
      els.googleSignInBtn.hidden = !!user || IN_APP_BROWSER;
      els.inAppNote.hidden = !!user || !IN_APP_BROWSER;
      els.pwSignin.hidden = !!user;
      if (IN_APP_BROWSER && !user) els.pwSignin.open = true;
      els.lockSignOutBtn.hidden = !user;
    }
    els.menuSignOutBtn.hidden = !user;
    els.menuWrap.hidden = readOnly;
    els.editBoardBtn.hidden = restricted;
    els.shareLinkBtn.hidden = readOnly;
    els.qrBtn.hidden = readOnly;
    els.exportCsvBtn.hidden = restricted;
    els.menuEventsBtn.hidden = restricted;
    if (restricted) { els.qrCard.hidden = true; els.editPanel.hidden = true; }
    updateLastUpdatedText();

    var list = sortedEntries();
    var scored = anyScored(list);

    renderRank(list, scored);
    renderEvents(!restricted);

    els.playerCount.textContent = list.length ? list.length + (list.length === 1 ? " player" : " players") : "";
    els.boardEmpty.hidden = !!list.length;
    els.boardTable.hidden = !list.length;
    els.boardHint.hidden = !list.length;
    var cd = countdown();
    els.noScores.hidden = !list.length || scored;
    els.boardEmpty.textContent = restricted ? "No players yet." : "No players yet. Tap \u201c+ Add player\u201d to add the first one.";
    els.noScores.textContent = cd && cd.phase === "before"
      ? "The challenge starts " + fmtDay(challengeDates().start) + ". Scores update after each session."
      : "No points on the board yet. Scores update after each session.";
    var snap = board.snapshot;
    var moved = scored && snap && validIso(snap.at) && list.some(function (e) { return movementHtml(e) !== ""; });
    els.moveHint.textContent = moved ? " Arrows show rank changes since " + fmtDay(snap.at) + "." : "";

    var MEDALS = { 1: "gold", 2: "silver", 3: "bronze" };
    els.boardBody.innerHTML = list
      .map(function (e, i) {
        var medal = scored && MEDALS[e._rank] ? " " + MEDALS[e._rank] : "";
        var tied = (list[i - 1] && list[i - 1]._rank === e._rank) || (list[i + 1] && list[i + 1]._rank === e._rank);
        var rankBadge = '<span class="rank-badge' + medal + '"' + (tied ? ' title="Tied for ' + ordinal(e._rank) + '"' : "") + ">" + e._rank + "</span>";
        var open = e.id === expandedId;
        var classes = ["player-row", scored && e._rank === 1 ? "leader-row" : "", i % 2 ? "zebra" : "", open ? "open" : "", e.id === meId ? "me-row" : ""].join(" ").trim();
        return (
          '<tr class="' + classes + '" data-toggle="' + esc(e.id) + '">' +
          '<td class="rank">' + rankBadge + "</td>" +
          '<td class="name"><button type="button" class="name-btn" aria-expanded="' + open + '" data-toggle="' + esc(e.id) + '">' +
          '<span class="player-name">' + esc(e.name) + "</span>" + (e.id === meId ? '<span class="you-pill">You</span>' : "") +
          (scored ? movementHtml(e) : "") +
          '<span class="chev" aria-hidden="true"></span></button></td>' +
          '<td class="total">' + e._c.total + "</td>" +
          '<td class="col-sub">' + e._c.duprPoints + "</td>" +
          '<td class="col-sub">' + e._c.community + "</td>" +
          '<td class="behind">' + behindFirst(e, list) + "</td>" +
          "</tr>" +
          (open ? breakdownRows(e, restricted) : "")
        );
      })
      .join("");
  }

  function behindFirst(e, list) {
    if (e._rank === 1) return '<span class="behind-lead">&mdash;</span>';
    return list[0]._c.total - e._c.total;
  }
  function pts(n) { return n + (n === 1 ? " pt" : " pts"); }
  function setMe(id) {
    meId = id;
    try { if (id) localStorage.setItem(ME_KEY, id); else localStorage.removeItem(ME_KEY); } catch (err) {}
  }
  function renderRank(list, scored) {
    els.rankCard.hidden = !list.length;
    if (!list.length) return;
    els.rankSearch.placeholder = readOnly ? "Find your name" : "Find a player";
    els.rankSearch.setAttribute("aria-label", readOnly ? "Find your name on the leaderboard" : "Find a player");
    var me = null;
    if (readOnly) list.some(function (e) { if (e.id === meId) { me = e; return true; } return false; });
    els.rankFind.hidden = !!me;
    els.rankMe.hidden = !me;
    if (!me) { renderMatches(list); return; }
    els.rankMatches.innerHTML = "";

    var status = standingText(me, list, scored);
    var medal = scored ? MEDAL_BY_RANK[me._rank] || "" : "none";
    els.rankMe.innerHTML =
      '<span class="rank-big ' + medal + '">' + (scored ? "#" + me._rank : "&ndash;") + "</span>" +
      '<div class="me-txt"><div class="me-name">' + esc(me.name) + ' <span class="me-pts">' + me._c.total + " pts</span></div>" +
      '<div class="me-status">' + esc(status) + "</div></div>" +
      '<div class="me-actions">' +
      (scored ? '<button type="button" class="btn small primary" data-rank="share">Share</button>' : "") +
      '<button type="button" class="btn small ghost" data-rank="show">Breakdown</button>' +
      '<button type="button" class="link-btn" data-rank="clear">Not you?</button></div>';
    if (scored) prepareShareCard(me, list, status);
  }

  var MEDAL_BY_RANK = { 1: "gold", 2: "silver", 3: "bronze" };
  function isTied(me, list) {
    return list.filter(function (e) { return e._rank === me._rank; }).length > 1;
  }
  function standingText(me, list, scored) {
    if (!scored) return "Waiting for the first scores";
    var tied = isTied(me, list);
    if (me._rank === 1) {
      var next = list.filter(function (e) { return e._rank > 1; })[0];
      return tied ? "Tied for 1st place"
        : next ? "1st place, " + pts(me._c.total - next._c.total) + " ahead of " + ordinal(next._rank)
        : "1st place";
    }
    return (tied ? "Tied for " + ordinal(me._rank) + " \u00b7 " : "") + pts(list[0]._c.total - me._c.total) + " behind 1st place";
  }

  // ---- Upcoming community events ------------------------------------------
  // Stored on the board doc as `events` ({ id, date "YYYY-MM-DD", start/end
  // "HH:MM" 24h, title, type, place }) and edited by the coach account from
  // the card itself. Players see the next five upcoming; past ones drop off.
  var EVENT_TYPES = {
    social: { label: "Social Play", pts: POINTS.social },
    drill: { label: "Drill Training", pts: POINTS.drill },
    ranked: { label: "Ranked Play", pts: POINTS.ranked },
    special: { label: "Special event", pts: 0 },
  };
  var eventsEditing = false;
  var editingEventId = null;
  function fmtClock(hhmm) {
    var p = String(hhmm).split(":"), h = +p[0], m = +p[1];
    return ((h + 11) % 12 + 1) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? " AM" : " PM");
  }
  function validEvent(ev) {
    return ev && validIso(ev.date) && /^\d{2}:\d{2}$/.test(ev.start || "") && ev.title;
  }
  function sortedEvents() {
    return (board.events || []).filter(validEvent)
      .slice()
      .sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); });
  }
  function upcomingEvents() {
    var today = dayNum(isoToday());
    return sortedEvents().filter(function (ev) { return dayNum(ev.date) >= today; }).slice(0, 5);
  }
  function eventRow(ev, opts) {
    var p = ev.date.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var t = EVENT_TYPES[ev.type] || EVENT_TYPES.special;
    var away = dayNum(ev.date) - dayNum(isoToday());
    var when = away < 0 ? "Past" : away === 0 ? "Today" : away === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "long" });
    var time = fmtClock(ev.start) + (/^\d{2}:\d{2}$/.test(ev.end || "") ? "&ndash;" + fmtClock(ev.end) : "");
    var tag = t.pts
      ? '<span class="ev-tag ' + esc(ev.type) + '">' + t.label + " &middot; +" + t.pts + (t.pts === 1 ? " pt" : " pts") + "</span>"
      : '<span class="ev-tag special">' + t.label + "</span>";
    var id = esc(ev.id);
    var actions = opts.editing
      ? '<div class="ev-admin"><button type="button" class="btn small ghost" data-ev-edit="' + id + '">Edit</button>' +
        '<button type="button" class="btn small danger" data-ev-del="' + id + '">Delete</button></div>'
      : '<button type="button" class="btn small ghost ev-cal" data-ical="' + id + '" aria-label="Add ' + esc(ev.title) + ' to calendar">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 13v5M9.5 15.5h5"/></svg>' +
        '<span class="ev-cal-txt">Add to calendar</span></button>';
    return (
      '<li class="ev' + (opts.next ? " next" : "") + (away < 0 ? " past" : "") + (ev.id === editingEventId ? " being-edited" : "") + '">' +
      '<div class="ev-date" aria-hidden="true"><span class="ev-mon">' + d.toLocaleDateString(undefined, { month: "short" }) + "</span>" +
      '<span class="ev-day">' + d.getDate() + "</span></div>" +
      '<div class="ev-body"><div class="ev-title">' + esc(ev.title) + "</div>" +
      '<div class="ev-meta"><span class="sr-only">' + esc(d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })) + ", </span>" +
      '<span aria-hidden="true">' + when + " &middot; </span>" + time + (ev.place ? " &middot; " + esc(ev.place) : "") + "</div>" +
      tag + "</div>" + actions + "</li>"
    );
  }
  function renderEvents(canEdit) {
    if (!canEdit) { eventsEditing = false; editingEventId = null; }
    var editing = canEdit && eventsEditing;
    var list = editing ? sortedEvents() : upcomingEvents();
    els.eventsCard.hidden = !list.length && !canEdit;
    els.eventsEditBtn.hidden = !canEdit;
    els.eventsEditBtn.textContent = editing ? "Done" : "Edit events";
    els.eventsEditBtn.setAttribute("aria-expanded", String(editing));
    els.eventForm.hidden = !editing;
    els.eventsSub.hidden = editing;
    els.eventsEmpty.hidden = !!list.length;
    els.eventsEmpty.textContent = canEdit && !editing
      ? "No upcoming events yet. Tap \u201cEdit events\u201d to add one; players only see this card once there's an event."
      : "No events yet. Add the first one above.";
    var firstUpcoming = upcomingEvents()[0];
    els.eventsList.innerHTML = list.map(function (ev) {
      return eventRow(ev, { editing: editing, next: !editing && firstUpcoming && ev.id === firstUpcoming.id });
    }).join("");
  }
  function findEvent(id) {
    return (board.events || []).find(function (e) { return e.id === id; });
  }
  function resetEventForm() {
    editingEventId = null;
    els.evDate.value = "";
    els.evStart.value = "";
    els.evEnd.value = "";
    els.evTitle.value = "";
    els.evType.value = "social";
    els.evPlace.value = "";
    els.evSaveBtn.textContent = "Add event";
    els.evFormTitle.textContent = "Add an event";
    els.evCancelBtn.hidden = true;
    els.evMsg.textContent = "";
    els.evMsg.className = "form-msg";
  }
  function fillEventForm(ev) {
    editingEventId = ev.id;
    els.evDate.value = ev.date;
    els.evStart.value = ev.start;
    els.evEnd.value = ev.end || "";
    els.evTitle.value = ev.title;
    els.evType.value = EVENT_TYPES[ev.type] ? ev.type : "special";
    els.evPlace.value = ev.place || "";
    els.evSaveBtn.textContent = "Save changes";
    els.evFormTitle.textContent = "Edit event";
    els.evCancelBtn.hidden = false;
    els.evMsg.textContent = "";
    render();
    els.eventForm.scrollIntoView({ behavior: "smooth", block: "start" });
    els.evTitle.focus({ preventScroll: true });
  }
  function saveEvent() {
    var fail = function (msg, field) {
      els.evMsg.textContent = msg;
      els.evMsg.className = "form-msg err";
      field.focus();
    };
    var ev = {
      id: editingEventId || uid(),
      date: els.evDate.value,
      start: els.evStart.value,
      end: els.evEnd.value || "",
      title: els.evTitle.value.trim(),
      type: EVENT_TYPES[els.evType.value] ? els.evType.value : "special",
      place: els.evPlace.value.trim(),
    };
    if (!validIso(ev.date)) return fail("Pick a date.", els.evDate);
    if (!/^\d{2}:\d{2}$/.test(ev.start)) return fail("Pick a start time.", els.evStart);
    if (ev.end && ev.end <= ev.start) return fail("The end time needs to be after the start time.", els.evEnd);
    if (!ev.title) return fail("Give the event a name.", els.evTitle);
    var existed = !!editingEventId;
    commit(function (doc) {
      doc.events = (doc.events || []).filter(function (e) { return e.id !== ev.id; }).concat([JSON.parse(JSON.stringify(ev))]);
    });
    resetEventForm();
    render();
    toast(existed ? "Event updated" : "Event added");
  }
  function deleteEvent(id) {
    var ev = findEvent(id);
    if (!ev || !window.confirm("Delete \u201c" + ev.title + "\u201d?")) return;
    if (editingEventId === id) resetEventForm();
    commit(function (doc) {
      doc.events = (doc.events || []).filter(function (e) { return e.id !== id; });
    });
    toast("Event deleted");
  }
  function openEventsEditor() {
    eventsEditing = true;
    resetEventForm();
    render();
    els.eventsCard.scrollIntoView({ behavior: "smooth", block: "start" });
    els.evDate.focus({ preventScroll: true });
  }
  function icsFor(ev) {
    var stamp = function (date, hhmm) { return date.replace(/-/g, "") + "T" + hhmm.replace(":", "") + "00"; };
    var clean = function (s) { return String(s).replace(/([,;\\])/g, "\\$1"); };
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lotus Pickleball Academy//Leaderboard//EN",
      "BEGIN:VEVENT",
      "UID:" + ev.date + "-" + ev.start.replace(":", "") + "@lotus-leaderboard",
      "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z",
      "DTSTART:" + stamp(ev.date, ev.start),
      "DTEND:" + stamp(ev.date, /^\d{2}:\d{2}$/.test(ev.end || "") ? ev.end : String(Math.min(23, +ev.start.slice(0, 2) + 1)).padStart(2, "0") + ev.start.slice(2)),
      "SUMMARY:" + clean(ev.title + " (Lotus Pickleball Academy)"),
      "LOCATION:" + clean(ev.place || ""),
      "DESCRIPTION:" + clean((EVENT_TYPES[ev.type] || EVENT_TYPES.special).label + ". Leaderboard: " + playerViewUrl()),
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
  }
  function addToCalendar(id) {
    var ev = findEvent(id);
    if (!ev) return;
    var blob = new Blob([icsFor(ev)], { type: "text/calendar;charset=utf-8" });
    downloadBlob(blob, ev.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + ".ics");
  }

  // ---- "Share my rank" image card -------------------------------------------
  // Drawn on a canvas as a 1080x1350 PNG (portrait, fits Instagram/Stories/
  // texts). Built in the background as soon as the "your rank" strip shows,
  // because iOS only opens the share sheet from a tap if navigator.share()
  // is called straight away, not after an async image build.
  var shareCard = { key: null, blob: null, pending: null };
  function loadImg(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function fitText(ctx, text, maxWidth, weight, size, family) {
    var s = size;
    do { ctx.font = weight + " " + s + "px " + family; s -= 2; } while (ctx.measureText(text).width > maxWidth && s > 20);
  }
  function drawShareCard(me, list, status) {
    var FONT = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    return Promise.all([loadImg("/leaderboard/logo.png?v=2"), loadImg("/leaderboard/prize-paddle.png"), fontsReady]).then(function (r) {
      var logo = r[0], paddle = r[1];
      var W = 1080, H = 1350, c = document.createElement("canvas");
      c.width = W; c.height = H;
      var ctx = c.getContext("2d");
      var bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#fcebed"); bg.addColorStop(0.45, "#ffffff"); bg.addColorStop(1, "#ffffff");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#b91c2b"; ctx.fillRect(0, 0, W, 18);

      // Header: logo + challenge name
      ctx.fillStyle = "#ffffff"; roundRect(ctx, 80, 80, 150, 150, 32); ctx.fill();
      ctx.strokeStyle = "#e7e3e1"; ctx.lineWidth = 3; ctx.stroke();
      if (logo) ctx.drawImage(logo, 88, 88, 134, 134);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#1c1a19"; fitText(ctx, board.title, 740, "800", 56, FONT); ctx.fillText(board.title, 262, 150);
      ctx.fillStyle = "#6f6865"; fitText(ctx, board.subtitle, 740, "600", 34, FONT); ctx.fillText(board.subtitle, 262, 202);

      // Rank medallion
      var color = { 1: "#c8860d", 2: "#8b93a0", 3: "#a35d28" }[me._rank] || "#b91c2b";
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(540, 520, 170, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(540, 520, 148, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      fitText(ctx, "#" + me._rank, 250, "800", 150, FONT); ctx.fillText("#" + me._rank, 540, 528);

      // Name, points, standing
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#1c1a19"; fitText(ctx, me.name, 920, "800", 84, FONT); ctx.fillText(me.name, 540, 820);
      ctx.fillStyle = "#b91c2b"; ctx.font = "800 54px " + FONT; ctx.fillText(me._c.total + " Lotus points", 540, 900);
      ctx.fillStyle = "#524c4a"; fitText(ctx, status, 920, "600", 40, FONT); ctx.fillText(status, 540, 966);

      // Prize panel
      ctx.fillStyle = "#fcebed"; roundRect(ctx, 80, 1040, 920, 170, 28); ctx.fill();
      ctx.strokeStyle = "rgba(185,28,43,.3)"; ctx.lineWidth = 3; ctx.stroke();
      var textX = 130;
      if (paddle) {
        var ph = 140, pw = paddle.width * ph / paddle.height;
        ctx.drawImage(paddle, 116, 1055, pw, ph);
        textX = 116 + pw + 34;
      }
      ctx.textAlign = "left";
      ctx.fillStyle = "#b91c2b"; ctx.font = "800 30px " + FONT; ctx.fillText("1ST PLACE WINS", textX, 1112);
      ctx.fillStyle = "#1c1a19"; fitText(ctx, "Zocker Pro Series Control Paddle", 1000 - textX - 40, "800", 44, FONT);
      ctx.fillText("Zocker Pro Series Control Paddle", textX, 1168);

      // Footer link
      ctx.textAlign = "center"; ctx.fillStyle = "#6f6865"; ctx.font = "600 32px " + FONT;
      ctx.fillText(playerViewUrl().replace(/^https?:\/\//, ""), 540, 1290);

      return new Promise(function (resolve) { c.toBlob(resolve, "image/png"); });
    });
  }
  function prepareShareCard(me, list, status) {
    var key = [me.id, me.name, me._rank, me._c.total, status, board.title, board.subtitle].join("|");
    if (shareCard.key === key) return;
    shareCard = { key: key, blob: null, pending: null };
    var mine = shareCard;
    mine.pending = drawShareCard(me, list, status).then(function (blob) {
      mine.blob = blob;
      return blob;
    });
  }
  function shareMessage(me, list) {
    var place = isTied(me, list) ? "tied for " + ordinal(me._rank) : ordinal(me._rank);
    return "I'm " + place + " in the " + board.title + " with " + me._c.total + (me._c.total === 1 ? " point" : " points") + "! See the leaderboard: " + playerViewUrl();
  }
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function shareRank() {
    var list = sortedEntries();
    var me = list.find(function (e) { return e.id === meId; });
    if (!me) return;
    var text = shareMessage(me, list);
    var onError = function (err) {
      if (err && err.name === "AbortError") return; // user closed the share sheet
      toast("Couldn't open sharing. Try again.");
    };
    var withBlob = function (blob) {
      var file = blob && typeof File === "function" ? new File([blob], "lotus-rank.png", { type: "image/png" }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], text: text }).catch(onError);
      }
      if (navigator.share) return navigator.share({ title: board.title, text: text }).catch(onError);
      if (blob) downloadBlob(blob, "lotus-rank.png");
      var done = function () { toast(blob ? "Image saved, and the caption is copied" : "Caption copied"); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
      else done();
    };
    // Call share synchronously when the card is already built (keeps the tap's
    // user activation, which iOS requires); otherwise wait for it.
    if (shareCard.blob) withBlob(shareCard.blob);
    else if (shareCard.pending) shareCard.pending.then(withBlob, function () { withBlob(null); });
    else withBlob(null);
  }
  function renderMatches(list) {
    var q = els.rankSearch.value.trim().toLowerCase();
    if (!q) { els.rankMatches.innerHTML = ""; return; }
    var hits = [];
    list.forEach(function (e, i) { if (e.name.toLowerCase().indexOf(q) !== -1) hits.push([e, i]); });
    els.rankMatches.innerHTML = hits.length
      ? hits.slice(0, 6).map(function (h) {
          return '<button type="button" class="rank-match" data-me="' + esc(h[0].id) + '">' +
            '<span class="rm-rank">#' + h[0]._rank + '</span><span class="rm-name">' + esc(h[0].name) + "</span>" +
            '<span class="rm-pts">' + h[0]._c.total + " pts</span></button>";
        }).join("")
      : '<p class="rank-none">No ' + (readOnly ? "challenger" : "player") + " matching &ldquo;" + esc(els.rankSearch.value.trim()) + "&rdquo;" +
        (readOnly ? " yet. Check the spelling, or ask a coach to add you." : ".") + "</p>";
  }
  // Player view: remember "me". Admin view: just jump to that player's row
  // with it open, which is where the session buttons live.
  function pickMe(id) {
    els.rankSearch.value = "";
    if (readOnly) {
      setMe(id);
      render();
      return;
    }
    expandedId = id;
    render();
    scrollToRow(id);
  }
  function scrollToRow(id) {
    var btn = [].find.call(els.boardBody.querySelectorAll(".name-btn"), function (b) { return b.getAttribute("data-toggle") === id; });
    if (btn) btn.closest("tr").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function playerViewUrl() {
    for (var slug in VIEW_SLUGS) {
      if (VIEW_SLUGS[slug] === boardId) return location.origin + "/" + slug;
    }
    var u = new URL(location.href);
    u.searchParams.set("mode", "view");
    return u.toString();
  }

  function copyPlayerLink() {
    var url = playerViewUrl();
    var done = function () { toast("Player view link copied"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(function () { window.prompt("Copy this link:", url); });
    } else {
      window.prompt("Copy this link:", url);
    }
  }

  // ---- QR code (of the player link) -----------------------------------------
  // Uses the "qrcode-generator" library (loaded via <script> in index.html) —
  // pure JS, no network calls per code generated, so it still works offline
  // and never sends the link to a third-party image service.
  function renderQr() {
    var url = playerViewUrl();
    els.qrUrlText.textContent = url;
    if (typeof qrcode !== "function") {
      els.qrWrap.innerHTML = '<p class="hint">QR code generator didn’t load (offline?) — copy the link below instead.</p>';
      return;
    }
    var qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    els.qrWrap.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  }
  function toggleQr() {
    if (els.qrCard.hidden) {
      renderQr();
      els.qrCard.hidden = false;
    } else {
      els.qrCard.hidden = true;
    }
  }

  // ---- CSV export -------------------------------------------------------
  function csvField(v) {
    var s = String(v == null ? "" : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv() {
    var list = sortedEntries();
    var header = [
      "Rank", "Player", "Start DUPR", "End DUPR", "DUPR Improvement", "Skill Points",
      "Ranked Sessions", "Social Sessions", "Drill Sessions", "Community Points", "Lotus Score", "Points Behind 1st",
    ];
    var rows = list.map(function (e) {
      return [
        e._rank, e.name, e.startDupr != null ? e.startDupr : "", e.endDupr != null ? e.endDupr : "",
        fmtSigned(e.duprImprovement), e._c.duprPoints,
        int(e.ranked), int(e.social), int(e.drill),
        e._c.community, e._c.total, list[0]._c.total - e._c.total,
      ];
    });
    var csv = [header].concat(rows).map(function (r) { return r.map(csvField).join(","); }).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (board.title || "lotus-leaderboard").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Exported " + list.length + " player" + (list.length === 1 ? "" : "s") + " to CSV");
  }

  // ---- last-updated display ---------------------------------------------
  function updateLastUpdatedText() {
    els.lastUpdatedText.textContent = lastUpdated ? "Updated " + formatRelativeTime(lastUpdated) : "";
  }

  // ---- wire up ------------------------------------------------------------
  function bind() {
    els.rankSearch.addEventListener("input", function () { renderMatches(sortedEntries()); });
    els.rankSearch.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter") return;
      var hits = els.rankMatches.querySelectorAll("[data-me]");
      if (hits.length === 1) pickMe(hits[0].getAttribute("data-me"));
    });
    els.eventsList.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-ical], [data-ev-edit], [data-ev-del]");
      if (!b) return;
      if (b.hasAttribute("data-ical")) addToCalendar(b.getAttribute("data-ical"));
      else if (b.hasAttribute("data-ev-edit")) { var e = findEvent(b.getAttribute("data-ev-edit")); if (e) fillEventForm(e); }
      else deleteEvent(b.getAttribute("data-ev-del"));
    });
    els.eventsEditBtn.addEventListener("click", function () {
      if (eventsEditing) { eventsEditing = false; resetEventForm(); render(); }
      else openEventsEditor();
    });
    els.menuEventsBtn.addEventListener("click", openEventsEditor);
    els.evSaveBtn.addEventListener("click", saveEvent);
    els.evCancelBtn.addEventListener("click", function () { resetEventForm(); render(); });
    els.evTitle.addEventListener("keydown", function (ev) { if (ev.key === "Enter") saveEvent(); });
    els.rankMatches.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-me]");
      if (b) pickMe(b.getAttribute("data-me"));
    });
    els.rankMe.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-rank]");
      if (!b) return;
      if (b.getAttribute("data-rank") === "share") {
        shareRank();
      } else if (b.getAttribute("data-rank") === "show") {
        expandedId = meId;
        render();
        scrollToRow(meId);
      } else {
        setMe(null);
        render();
        els.rankSearch.focus();
      }
    });
    [
      "startDuprInput", "endDuprInput",
      "rankedInput", "socialInput", "drillInput",
    ].forEach(function (id) { els[id].addEventListener("input", updatePreview); });

    els.saveEntryBtn.addEventListener("click", saveEntry);
    els.cancelEditBtn.addEventListener("click", closeForm);
    els.addPlayerBtn.addEventListener("click", function () { resetForm(); showForm(); });

    var setMenu = function (open) {
      els.adminMenu.hidden = !open;
      els.menuBtn.setAttribute("aria-expanded", String(open));
    };
    els.menuBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var opening = els.adminMenu.hidden;
      setMenu(opening);
      if (opening) {
        var first = [].find.call(els.adminMenu.querySelectorAll("button"), function (b) { return !b.hidden; });
        if (first) first.focus();
      }
    });
    els.adminMenu.addEventListener("click", function (ev) {
      if (ev.target.closest("button")) setMenu(false);
    });
    document.addEventListener("click", function (ev) {
      if (!els.adminMenu.hidden && !els.menuWrap.contains(ev.target)) setMenu(false);
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !els.adminMenu.hidden) { setMenu(false); els.menuBtn.focus(); }
    });
    // Standard menu keys: arrows/Home/End move between items, Tab leaves.
    var menuItems = function () {
      return [].filter.call(els.adminMenu.querySelectorAll("button"), function (b) { return !b.hidden; });
    };
    els.menuBtn.addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
      ev.preventDefault();
      setMenu(true);
      var items = menuItems();
      if (items.length) items[ev.key === "ArrowUp" ? items.length - 1 : 0].focus();
    });
    els.adminMenu.addEventListener("keydown", function (ev) {
      var items = menuItems();
      var i = items.indexOf(document.activeElement);
      var next = null;
      if (ev.key === "ArrowDown") next = items[(i + 1) % items.length];
      else if (ev.key === "ArrowUp") next = items[(i - 1 + items.length) % items.length];
      else if (ev.key === "Home") next = items[0];
      else if (ev.key === "End") next = items[items.length - 1];
      else if (ev.key === "Tab") { setMenu(false); return; }
      if (next) { ev.preventDefault(); next.focus(); }
    });
    els.nameInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") saveEntry();
    });

    els.editBoardBtn.addEventListener("click", function () {
      if (els.editPanel.hidden) {
        openEditPanel();
        els.editPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        els.editPanel.hidden = true;
      }
    });
    els.shareLinkBtn.addEventListener("click", copyPlayerLink);
    els.qrBtn.addEventListener("click", toggleQr);
    els.qrCloseBtn.addEventListener("click", function () { els.qrCard.hidden = true; });
    els.qrCopyBtn.addEventListener("click", copyPlayerLink);
    els.exportCsvBtn.addEventListener("click", exportCsv);
    els.saveBoardBtn.addEventListener("click", saveBoardMeta);
    els.cancelBoardBtn.addEventListener("click", function () { els.editPanel.hidden = true; });

    els.googleSignInBtn.addEventListener("click", function () { showSigninResult(LH.signInWithGoogle()); });
    els.copyAdminLinkBtn.addEventListener("click", function () {
      var url = location.href;
      var done = function () { toast("Link copied. Paste it into Safari or Chrome."); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt("Copy this link:", url); });
      else window.prompt("Copy this link:", url);
    });
    var pwSignIn = function () {
      showSigninResult(LH.signIn(els.signinEmail.value, els.signinPassword.value).then(function () {
        els.signinPassword.value = "";
      }));
    };
    els.pwSignInBtn.addEventListener("click", pwSignIn);
    els.signinPassword.addEventListener("keydown", function (ev) { if (ev.key === "Enter") pwSignIn(); });
    els.lockSignOutBtn.addEventListener("click", signOut);
    els.menuSignOutBtn.addEventListener("click", signOut);

    els.boardBody.addEventListener("click", function (ev) {
      var action = ev.target.closest("[data-edit], [data-del], [data-log]");
      if (action) {
        if (action.hasAttribute("data-edit")) editEntryById(action.getAttribute("data-edit"));
        else if (action.hasAttribute("data-del")) deleteEntryById(action.getAttribute("data-del"));
        else logSession(action.getAttribute("data-id"), action.getAttribute("data-log"));
        return;
      }
      var row = ev.target.closest("[data-toggle]");
      if (!row) return;
      var id = row.getAttribute("data-toggle");
      expandedId = expandedId === id ? null : id;
      render();
      var btn = [].find.call(els.boardBody.querySelectorAll(".name-btn"), function (b) { return b.getAttribute("data-toggle") === id; });
      if (btn && ev.target.closest(".name-btn")) btn.focus();
    });
  }

  // Hosting ignores the ?v= query, so a browser still holding an older
  // index.html can end up running this newer app.js against markup it
  // doesn't match. Reload once (which revalidates the page) instead of
  // throwing on missing elements.
  function markupIsStale() {
    var missing = Object.keys(els).filter(function (k) { return !els[k]; });
    if (!missing.length) return false;
    try {
      if (sessionStorage.getItem("lotus-leaderboard:reloaded")) return false;
      sessionStorage.setItem("lotus-leaderboard:reloaded", "1");
      location.reload();
      return true;
    } catch (e) {
      return false;
    }
  }

  function boot() {
    cacheEls();
    if (markupIsStale()) return;
    try { sessionStorage.removeItem("lotus-leaderboard:reloaded"); } catch (e) {}
    bind();
    resetForm();
    // Scoring explainer starts open on wider screens, collapsed on phones.
    if (window.matchMedia && window.matchMedia("(min-width: 641px)").matches) els.scoringCard.open = true;
    render();
    connect();
    // Keep the "Updated N minutes ago" text fresh without a full re-render.
    setInterval(updateLastUpdatedText, 30000);
  }

  document.addEventListener("DOMContentLoaded", boot);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      // Absolute src + explicit scope: this script can run from a page URL
      // that isn't literally under /leaderboard/ (e.g. the short alias
      // /lotusoctoberchallenge), and "sw.js" alone would resolve relative to
      // that page instead of this app's own directory.
      navigator.serviceWorker.register("/leaderboard/sw.js", { scope: "/leaderboard/" }).catch(function () {});
    });
  }
})();
