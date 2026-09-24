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
    trophy:
      '<svg viewBox="0 0 24 24" ' + ICON_ATTRS + '><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 5H5.5a2 2 0 0 0 0 4H7"/><path d="M16 5h2.5a2 2 0 0 1 0 4H17"/><path d="M12 13v3"/><path d="M9 20h6"/><path d="M10 16h4l.8 4H9.2l.8-4Z"/></svg>',
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
  var VIEW_SLUGS = { lotus: "default" };
  var requestedBoardId = params.get("board") || boardIdFromPath() || "default";
  var boardId = BOARD_ALIASES[requestedBoardId] || requestedBoardId;
  var LOCAL_KEY = "lotus-leaderboard:" + boardId;
  var PIN_KEY = "lotus-leaderboard:pin:" + boardId; // must come after boardId is resolved above
  // Cosmetic split, not a security boundary: the board itself is open-write
  // to anyone with the link (see firestore.rules), same as the wedding
  // tracker. ?mode=view just hides the editing controls so players get a
  // clean, read-only board to look at.
  var readOnly = params.get("mode") === "view" || VIEW_SLUGS.hasOwnProperty(requestedBoardId);

  var board = {
    title: "October Lotus Challenge",
    subtitle: "October 1 – October 31",
    entries: [],
  };

  var editingId = null;
  var expandedId = null;
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
    return rows.map(function (r, i) {
      return (
        '<tr class="bd-row' + (i === rows.length - 1 ? " bd-last" : "") + '">' +
        '<td class="name bd-name" colspan="2"><span class="bd-label">' + r[0] + '</span><span class="bd-detail">' + r[1] + "</span></td>" +
        "<td>" + r[2] + "</td>" +
        "<td>" + r[3] + "</td>" +
        '<td class="total"></td>' +
        (restricted ? "" : '<td class="actions"></td>') +
        "</tr>"
      );
    }).join("");
  }
  function sortedEntries() {
    return board.entries
      .map(function (e) {
        return Object.assign({}, e, { _c: computed(e) });
      })
      .sort(function (a, b) {
        return b._c.total - a._c.total || b._c.duprPoints - a._c.duprPoints || a.name.localeCompare(b.name);
      });
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
      LH.saveLeaderboard(boardId, {
        title: board.title, subtitle: board.subtitle, entries: board.entries,
        adminPinHash: board.adminPinHash || null,
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
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }

  // ---- form -------------------------------------------------------------
  var els = {};
  function cacheEls() {
    [
      "nameInput", "startDuprInput", "endDuprInput", "duprImprovementDisplay",
      "rankedInput", "socialInput", "drillInput",
      "scorePreview", "saveEntryBtn", "cancelEditBtn", "formMsg", "formHeading",
      "boardTitle", "boardSubtitle", "editBoardBtn", "editPanel", "titleInput",
      "subtitleInput", "saveBoardBtn", "cancelBoardBtn", "leaderCard",
      "boardEmpty", "boardTable", "boardBody", "boardHint", "playerCount",
      "shareLinkBtn", "actionsHeader", "formCard", "lockCard", "pinInput",
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
    els.duprImprovementDisplay.value = fmtSigned(improvement);
    var draft = {
      duprImprovement: improvement,
      ranked: els.rankedInput.value, social: els.socialInput.value,
      drill: els.drillInput.value,
    };
    var c = computed(draft);
    els.scorePreview.innerHTML =
      "Skill points: <b>" + c.duprPoints + "</b> &nbsp;+&nbsp; Community points: <b>" + c.community +
      "</b> &nbsp;=&nbsp; Lotus Score: <b>" + c.total + "</b>";
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
    els.cancelEditBtn.hidden = true;
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
    els.cancelEditBtn.hidden = false;
    els.formHeading.textContent = "Edit player";
    els.formMsg.textContent = "";
    updatePreview();
    window.scrollTo({ top: els.nameInput.closest(".form-card").offsetTop - 12, behavior: "smooth" });
    els.nameInput.focus();
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
    persist();
    render();
    toast(idx >= 0 ? "Saved " + name : "Added " + name + " to the leaderboard");
    resetForm();
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
    if (editingId === id) resetForm();
    persist();
    render();
    toast("Removed " + e.name);
  }

  // ---- board title/subtitle edit -----------------------------------------
  function openEditPanel() {
    els.titleInput.value = board.title;
    els.subtitleInput.value = board.subtitle;
    els.newPinInput.value = "";
    els.removePinInput.checked = false;
    els.editPanel.hidden = false;
  }
  function saveBoardMeta() {
    board.title = els.titleInput.value.trim() || board.title;
    board.subtitle = els.subtitleInput.value.trim() || board.subtitle;

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
  }

  function render() {
    renderHeader();

    checkPinVerified();
    var locked = !readOnly && !!board.adminPinHash && !pinVerified;
    var restricted = readOnly || locked;
    document.body.classList.toggle("read-only", readOnly);
    document.body.classList.toggle("locked", locked);
    els.formCard.hidden = restricted;
    els.lockCard.hidden = !locked;
    els.editBoardBtn.hidden = restricted;
    els.shareLinkBtn.hidden = readOnly;
    els.qrBtn.hidden = readOnly;
    els.exportCsvBtn.hidden = restricted;
    els.actionsHeader.hidden = restricted;
    if (restricted) els.qrCard.hidden = true;
    updateLastUpdatedText();

    var list = sortedEntries();

    // Leader card
    if (list.length) {
      var lead = list[0];
      els.leaderCard.hidden = false;
      els.leaderCard.innerHTML =
        '<span class="trophy" aria-hidden="true">' + ICONS.trophy + "</span>" +
        '<div class="leader-txt"><div class="leader-name">' + esc(lead.name) + " is leading</div>" +
        '<div class="leader-score">' + lead._c.total + " Lotus points</div></div>";
    } else {
      els.leaderCard.hidden = true;
    }

    els.playerCount.textContent = list.length ? list.length + (list.length === 1 ? " player" : " players") : "";
    els.boardEmpty.hidden = !!list.length;
    els.boardTable.hidden = !list.length;
    els.boardHint.hidden = !list.length;

    var MEDALS = ["gold", "silver", "bronze"];
    els.boardBody.innerHTML = list
      .map(function (e, i) {
        var actionsCell = restricted
          ? ""
          : '<td class="actions"><span class="row-actions">' +
            '<button type="button" class="btn small ghost" data-edit="' + esc(e.id) + '">Edit</button>' +
            '<button type="button" class="btn small danger" data-del="' + esc(e.id) + '">Delete</button>' +
            "</span></td>";
        var rankBadge = '<span class="rank-badge' + (MEDALS[i] ? " " + MEDALS[i] : "") + '">' + (i + 1) + "</span>";
        var open = e.id === expandedId;
        var classes = ["player-row", i === 0 ? "leader-row" : "", i % 2 ? "zebra" : "", open ? "open" : ""].join(" ").trim();
        return (
          '<tr class="' + classes + '" data-toggle="' + esc(e.id) + '">' +
          '<td class="rank">' + rankBadge + "</td>" +
          '<td class="name"><button type="button" class="name-btn" aria-expanded="' + open + '" data-toggle="' + esc(e.id) + '">' +
          '<span class="player-name">' + esc(e.name) + '</span><span class="chev" aria-hidden="true"></span></button></td>' +
          "<td>" + e._c.duprPoints + "</td>" +
          "<td>" + e._c.community + "</td>" +
          '<td class="total">' + e._c.total + "</td>" +
          actionsCell +
          "</tr>" +
          (open ? breakdownRows(e, restricted) : "")
        );
      })
      .join("");
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
      "Ranked Sessions", "Social Sessions", "Drill Sessions", "Community Points", "Lotus Score",
    ];
    var rows = list.map(function (e, i) {
      return [
        i + 1, e.name, e.startDupr != null ? e.startDupr : "", e.endDupr != null ? e.endDupr : "",
        fmtSigned(e.duprImprovement), e._c.duprPoints,
        int(e.ranked), int(e.social), int(e.drill),
        e._c.community, e._c.total,
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
    [
      "startDuprInput", "endDuprInput",
      "rankedInput", "socialInput", "drillInput",
    ].forEach(function (id) { els[id].addEventListener("input", updatePreview); });

    els.saveEntryBtn.addEventListener("click", saveEntry);
    els.cancelEditBtn.addEventListener("click", resetForm);
    els.nameInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") saveEntry();
    });

    els.editBoardBtn.addEventListener("click", function () {
      els.editPanel.hidden ? openEditPanel() : (els.editPanel.hidden = true);
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
      var editId = ev.target.getAttribute("data-edit");
      var delId = ev.target.getAttribute("data-del");
      if (editId) editEntryById(editId);
      if (delId) deleteEntryById(delId);
      if (editId || delId) return;
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
