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
  var THEME_KEY = "lotus-leaderboard:theme";
  var params = new URLSearchParams(location.search);

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
  var BOARD_ALIASES = { lotusoctoberchallenge: "default" };
  var requestedBoardId = params.get("board") || boardIdFromPath() || "default";
  var boardId = BOARD_ALIASES[requestedBoardId] || requestedBoardId;
  var LOCAL_KEY = "lotus-leaderboard:" + boardId;
  // Cosmetic split, not a security boundary: the board itself is open-write
  // to anyone with the link (see firestore.rules), same as the wedding
  // tracker. ?mode=view just hides the editing controls so players get a
  // clean, read-only board to look at.
  var readOnly = params.get("mode") === "view";

  var board = {
    title: "October Lotus Challenge",
    subtitle: "October 1 – October 31",
    entries: [],
  };

  var editingId = null;
  var connected = false;
  var unsub = null;

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
  function computed(e) {
    var duprPoints = Math.round(num(e.duprImprovement) * 100);
    var community =
      int(e.ranked) * POINTS.ranked +
      int(e.social) * POINTS.social +
      int(e.drill) * POINTS.drill;
    return { duprPoints: duprPoints, community: community, total: duprPoints + community };
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
      LH.saveLeaderboard(boardId, { title: board.title, subtitle: board.subtitle, entries: board.entries }).catch(function (err) {
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

  // ---- theme ----------------------------------------------------------------
  function setTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    document.getElementById("themeToggle").textContent = mode === "dark" ? "☀️" : "🌙";
  }
  function bootTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (!saved) saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(saved);
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
      "boardEmpty", "boardTable", "boardBody", "playerCount",
      "shareLinkBtn", "actionsHeader",
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
    toast(idx >= 0 ? "Saved " + name : "Added " + name + " to the leaderboard 🏓");
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
    els.editPanel.hidden = false;
  }
  function saveBoardMeta() {
    board.title = els.titleInput.value.trim() || board.title;
    board.subtitle = els.subtitleInput.value.trim() || board.subtitle;
    els.editPanel.hidden = true;
    persist();
    renderHeader();
    toast("Challenge details saved");
  }

  // ---- render ---------------------------------------------------------------
  function renderHeader() {
    els.boardTitle.textContent = board.title;
    els.boardSubtitle.textContent = board.subtitle;
  }

  function render() {
    renderHeader();
    var list = sortedEntries();

    // Leader card
    if (list.length) {
      var lead = list[0];
      els.leaderCard.hidden = false;
      els.leaderCard.innerHTML =
        '<span class="trophy" aria-hidden="true">🏆</span>' +
        '<div class="leader-txt"><div class="leader-name">' + esc(lead.name) + " is leading</div>" +
        '<div class="leader-score">' + lead._c.total + " Lotus points" +
        (list.length > 1 ? " · " + (list.length - 1) + " other player" + (list.length - 1 === 1 ? "" : "s") + " on the board" : "") +
        "</div></div>";
    } else {
      els.leaderCard.hidden = true;
    }

    els.playerCount.textContent = list.length ? list.length + (list.length === 1 ? " player" : " players") : "";
    els.boardEmpty.hidden = !!list.length;
    els.boardTable.hidden = !list.length;

    var MEDALS = ["gold", "silver", "bronze"];
    els.boardBody.innerHTML = list
      .map(function (e, i) {
        var actionsCell = readOnly
          ? ""
          : '<td class="actions"><span class="row-actions">' +
            '<button type="button" class="btn small ghost" data-edit="' + esc(e.id) + '">Edit</button>' +
            '<button type="button" class="btn small danger" data-del="' + esc(e.id) + '">Delete</button>' +
            "</span></td>";
        var rankBadge = '<span class="rank-badge' + (MEDALS[i] ? " " + MEDALS[i] : "") + '">' + (i + 1) + "</span>";
        return (
          '<tr class="' + (i === 0 ? "leader-row" : "") + '">' +
          '<td class="rank">' + rankBadge + "</td>" +
          '<td class="name"><span class="player-name">' + esc(e.name) + "</span></td>" +
          "<td>" + e._c.duprPoints + "</td>" +
          "<td>" + e._c.community + "</td>" +
          '<td class="total">' + e._c.total + "</td>" +
          actionsCell +
          "</tr>"
        );
      })
      .join("");
  }

  // ---- read-only "player view" ---------------------------------------------
  function applyReadOnly() {
    if (!readOnly) return;
    document.body.classList.add("read-only");
    document.querySelector(".form-card").hidden = true;
    els.editBoardBtn.hidden = true;
    els.shareLinkBtn.hidden = true;
    els.actionsHeader.hidden = true;
  }

  function playerViewUrl() {
    var u = new URL(location.href);
    u.searchParams.set("mode", "view");
    return u.toString();
  }

  function copyPlayerLink() {
    var url = playerViewUrl();
    var done = function () { toast("Player view link copied 🔗"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(function () { window.prompt("Copy this link:", url); });
    } else {
      window.prompt("Copy this link:", url);
    }
  }

  // ---- wire up ------------------------------------------------------------
  function bind() {
    document.getElementById("themeToggle").addEventListener("click", function () {
      var dark = document.documentElement.getAttribute("data-theme") === "dark";
      setTheme(dark ? "light" : "dark");
    });

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
    els.saveBoardBtn.addEventListener("click", saveBoardMeta);
    els.cancelBoardBtn.addEventListener("click", function () { els.editPanel.hidden = true; });

    els.boardBody.addEventListener("click", function (ev) {
      var editId = ev.target.getAttribute("data-edit");
      var delId = ev.target.getAttribute("data-del");
      if (editId) editEntryById(editId);
      if (delId) deleteEntryById(delId);
    });
  }

  function boot() {
    cacheEls();
    bootTheme();
    applyReadOnly();
    bind();
    resetForm();
    render();
    connect();
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
