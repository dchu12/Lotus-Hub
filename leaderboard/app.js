/* Lotus Leaderboard — vanilla JS, no build step.
 *
 * Data model: one shared Firestore doc (see /firebase.js -> LH.watchLeaderboard /
 * LH.saveLeaderboard) holding { title, subtitle, entries: [...] }. No sign-in
 * required — open by link, same model as the wedding tracker (see
 * firestore.rules). Falls back to a local copy on this device if Firebase
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

  // ---- admin PIN -----------------------------------------------------------
  // A lightweight deterrent, not real security: the board's Firestore rules
  // stay open (see firestore.rules) exactly as before, so this only gates the
  // UI in this browser. It stops casual edits from a shared/leaked link —
  // it does not stop someone technical enough to write to Firestore directly.
  var pinVerified = false;
  function sha256Hex(text) {
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", data).then(function (buf) {
      return Array.prototype.map
        .call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); })
        .join("");
    });
  }
  // Purely a string compare — the stored hash and the saved one are both
  // already hex digests, so this needs no crypto and can run synchronously
  // on every render().
  function checkPinVerified() {
    if (!board.adminPinHash) { pinVerified = true; return; }
    var saved = null;
    try { saved = localStorage.getItem(PIN_KEY); } catch (e) {}
    pinVerified = !!saved && saved === board.adminPinHash;
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
  var PIN_KEY = "lotus-leaderboard:pin:" + boardId; // must come after boardId is resolved above
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
  };
  // Fallback dates for a board whose doc doesn't have them saved yet; the
  // edit panel's date fields override these once saved.
  var DEFAULT_DATES = { "default": ["2026-10-01", "2026-10-31"] };
  var lastRemoteEntries = null; // entries as last synced, i.e. before a local edit

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
  function snapshotForSave() {
    var today = isoToday();
    var snap = board.snapshot;
    if (snap && validIso(snap.at) && dayNum(today) - dayNum(snap.at) < 7) return snap;
    var before = sortedEntries(lastRemoteEntries || board.entries);
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
  function persist() {
    saveLocal();
    if (window.LH && LH.ready) {
      board.snapshot = snapshotForSave();
      LH.saveLeaderboard(boardId, {
        title: board.title, subtitle: board.subtitle, entries: board.entries,
        adminPinHash: board.adminPinHash || null,
        startDate: validIso(board.startDate) ? board.startDate : null,
        endDate: validIso(board.endDate) ? board.endDate : null,
        snapshot: board.snapshot || null,
      }).catch(function (err) {
        showBanner("Couldn't save to the shared board (" + (err && err.message ? err.message : "unknown error") + "). Your change is kept on this device only.");
      });
    }
  }

  function onRemote(data, err) {
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
      board.adminPinHash = data.adminPinHash || null;
      board.startDate = data.startDate || null;
      board.endDate = data.endDate || null;
      board.snapshot = data.snapshot || null;
      lastRemoteEntries = JSON.parse(JSON.stringify(board.entries));
      // A write we just made ourselves can arrive with updatedAt still null
      // for one snapshot (the serverTimestamp placeholder resolves a moment
      // later) — keep whatever we last had rather than blanking it.
      if (data.updatedAt && typeof data.updatedAt.toDate === "function") {
        lastUpdated = data.updatedAt.toDate();
      }
      hideBanner();
      saveLocal();
    } else {
      // Board doesn't exist yet remotely — seed it from a local copy (if any)
      // or the current defaults, so the first save creates it.
      var localSeed = loadLocal();
      if (localSeed) board = localSeed;
      persist();
    }
    render();
  }

  function connect() {
    if (window.LH && LH.available) {
      try { LH.init(); } catch (e) {}
    }
    if (window.LH && LH.ready) {
      unsub = LH.watchLeaderboard(boardId, onRemote);
    } else {
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
      "noScores", "moveHint", "scoringCard",
      "rankCard", "rankFind", "rankSearch", "rankMatches", "rankMe",
      "boardEmpty", "boardTable", "boardBody", "boardHint", "playerCount",
      "shareLinkBtn", "formCard", "lockCard", "pinInput", "menuWrap", "menuBtn", "adminMenu", "addPlayerBtn",
      "pinMsg", "unlockBtn", "newPinInput", "removePinInput",
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
    var idx = board.entries.findIndex(function (e) { return e.id === entry.id; });
    if (idx >= 0) board.entries[idx] = entry;
    else board.entries.push(entry);
    formOpen = false;
    resetForm();
    persist();
    render();
    toast(idx >= 0 ? "Saved " + name : "Added " + name + " to the leaderboard");
  }

  function findEntry(id) {
    return board.entries.find(function (x) { return x.id === id; });
  }
  var SESSION_NAMES = { ranked: "Ranked Play", social: "Social Play", drill: "Drill Training" };
  function logSession(id, field) {
    var e = findEntry(id);
    if (!e) return;
    e[field] = int(e[field]) + 1;
    persist();
    render();
    toast(e.name + ": +1 " + SESSION_NAMES[field] + " (+" + pts(POINTS[field]) + ")", "Undo", function () {
      var cur = findEntry(id);
      if (!cur || int(cur[field]) < 1) return;
      cur[field] = int(cur[field]) - 1;
      persist();
      render();
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
    board.entries = board.entries.filter(function (x) { return x.id !== id; });
    if (editingId === id) { resetForm(); formOpen = false; }
    persist();
    render();
    toast("Removed " + e.name);
  }

  // ---- board title/subtitle edit -----------------------------------------
  function openEditPanel() {
    var d = challengeDates();
    els.titleInput.value = board.title;
    els.subtitleInput.value = board.subtitle;
    els.startDateInput.value = d.start || "";
    els.endDateInput.value = d.end || "";
    els.newPinInput.value = "";
    els.removePinInput.checked = false;
    els.editPanel.hidden = false;
  }
  function saveBoardMeta() {
    board.title = els.titleInput.value.trim() || board.title;
    board.subtitle = els.subtitleInput.value.trim() || board.subtitle;
    board.startDate = validIso(els.startDateInput.value) ? els.startDateInput.value : null;
    board.endDate = validIso(els.endDateInput.value) ? els.endDateInput.value : null;

    var finish = function () {
      els.editPanel.hidden = true;
      els.newPinInput.value = "";
      els.removePinInput.checked = false;
      persist();
      render();
      toast("Challenge details saved");
    };

    if (els.removePinInput.checked) {
      board.adminPinHash = null;
      pinVerified = true;
      finish();
    } else if (els.newPinInput.value.trim()) {
      sha256Hex(els.newPinInput.value.trim()).then(function (hash) {
        board.adminPinHash = hash;
        pinVerified = true;
        try { localStorage.setItem(PIN_KEY, hash); } catch (e) {}
        finish();
      });
    } else {
      finish();
    }
  }

  function attemptUnlock() {
    var pin = els.pinInput.value.trim();
    if (!pin) {
      els.pinMsg.textContent = "Enter the PIN.";
      els.pinMsg.className = "form-msg err";
      return;
    }
    sha256Hex(pin).then(function (hash) {
      if (hash === board.adminPinHash) {
        pinVerified = true;
        try { localStorage.setItem(PIN_KEY, hash); } catch (e) {}
        els.pinInput.value = "";
        els.pinMsg.textContent = "";
        toast("Unlocked");
        render();
      } else {
        els.pinMsg.textContent = "Incorrect PIN.";
        els.pinMsg.className = "form-msg err";
      }
    });
  }

  // ---- render ---------------------------------------------------------------
  function renderHeader() {
    els.boardTitle.textContent = board.title;
    els.boardSubtitle.textContent = board.subtitle;
    var cd = countdown();
    els.countdown.hidden = !cd;
    if (cd) {
      els.countdown.textContent = cd.text;
      els.countdown.className = "countdown " + cd.phase;
    }
  }

  function render() {
    renderHeader();

    checkPinVerified();
    var locked = !readOnly && !!board.adminPinHash && !pinVerified;
    var restricted = readOnly || locked;
    document.body.classList.toggle("read-only", readOnly);
    document.body.classList.toggle("locked", locked);
    els.formCard.hidden = restricted || !formOpen;
    els.addPlayerBtn.hidden = restricted || formOpen;
    els.lockCard.hidden = !locked;
    els.menuWrap.hidden = readOnly;
    els.editBoardBtn.hidden = restricted;
    els.shareLinkBtn.hidden = readOnly;
    els.qrBtn.hidden = readOnly;
    els.exportCsvBtn.hidden = restricted;
    if (restricted) { els.qrCard.hidden = true; els.editPanel.hidden = true; }
    updateLastUpdatedText();

    var list = sortedEntries();
    var scored = anyScored(list);

    renderRank(list, scored);

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

    var sharing = list.filter(function (e) { return e._rank === me._rank; }).length > 1;
    var status;
    if (!scored) {
      status = "Waiting for the first scores";
    } else if (me._rank === 1) {
      var next = list.filter(function (e) { return e._rank > 1; })[0];
      status = sharing ? "Tied for 1st place"
        : next ? "1st place, " + pts(me._c.total - next._c.total) + " ahead of " + ordinal(next._rank)
        : "1st place";
    } else {
      status = (sharing ? "Tied for " + ordinal(me._rank) + " &middot; " : "") + pts(list[0]._c.total - me._c.total) + " behind 1st place";
    }
    var medal = scored ? ({ 1: "gold", 2: "silver", 3: "bronze" })[me._rank] || "" : "none";
    els.rankMe.innerHTML =
      '<span class="rank-big ' + medal + '">' + (scored ? "#" + me._rank : "&ndash;") + "</span>" +
      '<div class="me-txt"><div class="me-name">' + esc(me.name) + ' <span class="me-pts">' + me._c.total + " pts</span></div>" +
      '<div class="me-status">' + status + "</div></div>" +
      '<div class="me-actions"><button type="button" class="btn small ghost" data-rank="show">Breakdown</button>' +
      '<button type="button" class="link-btn" data-rank="clear">Not you?</button></div>';
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
    els.rankMatches.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-me]");
      if (b) pickMe(b.getAttribute("data-me"));
    });
    els.rankMe.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-rank]");
      if (!b) return;
      if (b.getAttribute("data-rank") === "show") {
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

    els.unlockBtn.addEventListener("click", attemptUnlock);
    els.pinInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") attemptUnlock();
    });

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

  function boot() {
    cacheEls();
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
