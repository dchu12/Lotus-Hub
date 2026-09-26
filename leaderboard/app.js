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
  var JOIN_URL = "https://ig.me/m/lotuspickleballacademy_to"; // Instagram DM
  // What a new player sends us; they fill in the blanks in the How to join panel.
  var JOIN_MSG = "Hi Lotus! I'd like to join the October Challenge.\n\n" +
    "Name: \nDUPR ID: ";
  // ...and what someone booking a Drill Training session sends.
  var DRILL_MSG = "Hi Lotus! I'd like to book a Drill Training session.\n\n" +
    "Name: \nPreferred day and time: ";
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
    title: "October Challenge",
    subtitle: "Oct 1 – 31",
    entries: [],
    startDate: null, // "YYYY-MM-DD", drives the header countdown
    endDate: null,
    snapshot: null, // { at: "YYYY-MM-DD", ranks: { playerId: rank } }, for movement arrows
    weeks: null, // { "YYYY-MM-DD" (a Monday): { r: { id: rank }, t: { id: total } } }, for Climber of the week
    events: [], // upcoming community events, see renderEvents()
    calendarId: null, // optional public Google Calendar that replaces `events`
    calendarKey: null, // optional API key for it (defaults to the site's Firebase key)
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
  var boardLoaded = false; // false until the first real snapshot (or error): show the placeholder card

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
    // Past the first hour, a clock time says more than "5 hours ago":
    // "today, 9:12 PM", "yesterday, 9:12 PM", then "Oct 3, 9:12 PM".
    if (mins < 60) return mins + (mins === 1 ? " minute" : " minutes") + " ago";
    var time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    var day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var daysAgo = Math.round((today - day) / 86400000);
    if (daysAgo <= 0) return "today, " + time;
    if (daysAgo === 1) return "yesterday, " + time;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + time;
  }
  // A DUPR box left blank means "not entered yet", not a rating of 0.
  function hasDupr(v) { return num(v) > 0; }
  function computed(e) {
    // Until both Start and End DUPR are in, Skill Points stay at 0 (a blank
    // End used to count as 0 and knock ~350 points off).
    var missing = e.mode === "range" && !(hasDupr(e.startDupr) && hasDupr(e.endDupr));
    var duprPoints = missing ? 0 : Math.round(num(e.duprImprovement) * 100);
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
    var improvement = e._c.duprPoints / 100;
    var d = Math.min(3, Math.max(2, decimals(e.startDupr), decimals(e.endDupr)));
    var sign = improvement > 0 ? "+" : "";
    var change = sign + improvement.toFixed(d);
    var fmtD = function (v) { return hasDupr(v) ? num(v).toFixed(d) : "&ndash;"; };
    var duprDetail = e.mode === "range"
      ? fmtD(e.startDupr) + " &rarr; " + fmtD(e.endDupr) +
        (hasDupr(e.startDupr) && hasDupr(e.endDupr) ? '<span class="bd-detail">' + change + "</span>" : "")
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
        "</tr>"
      );
    }).join("");
    if (restricted) return html;
    var id = esc(e.id);
    return html +
      '<tr class="bd-row bd-admin bd-last"><td colspan="5"><div class="admin-actions">' +
      '<div class="aa-log"><span class="aa-label">Log a session</span>' +
      ["ranked", "social", "drill"].map(function (f) {
        return '<button type="button" class="btn small session-btn" data-log="' + f + '" data-id="' + id + '">+1 ' + SESSION_LABELS[f] + "</button>";
      }).join("") +
      '</div><div class="aa-manage"><button type="button" class="btn small ghost" data-edit="' + id + '">Edit</button>' +
      '<button type="button" class="btn small danger" data-del="' + id + '">Delete</button></div>' +
      "</div></td></tr>";
  }
  // Players level on Lotus Score share a rank (1, 1, 3, ...). Within a tie
  // the display order is Community Points then name, which matches the
  // published tie-break for 1st, but the rank number stays shared.
  function sortedEntries(entries) {
    var list = (entries || board.entries)
      .map(function (e) {
        return Object.assign({}, e, { _c: computed(e) });
      })
      .sort(function (a, b) {
        return b._c.total - a._c.total || b._c.community - a._c.community || a.name.localeCompare(b.name);
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
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  }
  // { text, phase: "before" | "live" | "ended" } or null when no dates are set.
  function countdown() {
    var d = challengeDates();
    var today = dayNum(isoToday());
    if (d.start && today < dayNum(d.start)) {
      // A date rather than a day count: the countdown card below shows the
      // exact time left, and "in 7 days" next to "6 days 0 hours" reads as a bug.
      var n = dayNum(d.start) - today;
      return { phase: "before", text: n === 1 ? "Starts tomorrow" : "Starts " + fmtDay(d.start) };
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

  // ---- Climber of the week ------------------------------------------------------
  // Weeks run Monday to Sunday. The first admin save of each week records the
  // standings as they were before that save, which (since only saves change
  // the board) is exactly where everyone stood when the week began. Comparing
  // one week's record with the next gives that week's movement.
  function isoFromDayNum(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function weekStartIso(iso) {
    var n = dayNum(iso);
    return isoFromDayNum(n - ((n + 3) % 7)); // day 0 (1970-01-01) was a Thursday
  }
  function standingsMap(list) {
    var m = { r: {}, t: {} };
    list.forEach(function (e) { m.r[e.id] = e._rank; m.t[e.id] = e._c.total; });
    return m;
  }
  function weeksBefore(doc) {
    var wk = weekStartIso(isoToday());
    var weeks = doc.weeks && typeof doc.weeks === "object" ? doc.weeks : {};
    if (weeks[wk]) return doc.weeks;
    var before = sortedEntries(doc.entries);
    if (!before.length) return doc.weeks || null;
    var next = {};
    Object.keys(weeks).filter(validIso).sort().slice(-7).forEach(function (k) { next[k] = weeks[k]; });
    next[wk] = standingsMap(before);
    return next;
  }
  // The player who climbed the most spots between two standings, then most
  // points gained. Only players who were on the board at the start and have
  // gained points since count, so being added mid-week isn't a "climb".
  function bestClimber(base, end, byId) {
    var picks = [];
    Object.keys(end.t || {}).forEach(function (id) {
      var e = byId[id];
      if (!e || typeof base.t[id] !== "number" || typeof base.r[id] !== "number") return; // removed since, or added mid-week
      var pts = end.t[id] - base.t[id];
      if (pts <= 0) return;
      var up = base.r[id] - end.r[id];
      picks.push({ e: e, up: up, pts: pts, rank: end.r[id] });
    });
    picks.sort(function (a, b) { return b.up - a.up || b.pts - a.pts || a.rank - b.rank || a.e.name.localeCompare(b.e.name); });
    return picks[0] || null;
  }
  // Last full week's climber, which stays up all week (ready for a weekly
  // post); in the first week, before there is one, the climber so far.
  function climberOfWeek(list) {
    var weeks = board.weeks;
    if (!weeks || typeof weeks !== "object") return null;
    var keys = Object.keys(weeks).filter(validIso).sort();
    if (!keys.length) return null;
    var byId = {};
    list.forEach(function (e) { byId[e.id] = e; });
    var now = standingsMap(list);
    var cur = weekStartIso(isoToday());
    var i = keys.indexOf(cur);
    // Every change between one record and the next happened in the earlier
    // record's week, even if weeks with no saves sit in between.
    var from = i > 0 ? keys[i - 1] : i === -1 && keys[keys.length - 1] < cur ? keys[keys.length - 1] : null;
    if (from) {
      var pick = bestClimber(weeks[from], i > 0 ? weeks[cur] : now, byId);
      if (pick) { pick.when = "Week of " + fmtDay(from); return pick; }
    }
    if (i !== -1) {
      var live = bestClimber(weeks[cur], now, byId);
      if (live) { live.when = "So far this week"; return live; }
    }
    return null;
  }
  function climberStats(c) {
    return { up: c.up > 0 ? "\u25B2" + c.up + (c.up === 1 ? " spot" : " spots") : "", pts: "+" + c.pts + " Lotus Score" };
  }
  function renderClimber(list, show) {
    var c = show ? climberOfWeek(list) : null;
    els.climber.hidden = !c;
    if (!c) return;
    var st = climberStats(c);
    els.climber.setAttribute("data-pod", c.e.id);
    els.climber.setAttribute("aria-label", "Climber of the week (" + c.when + "): " + c.e.name +
      (c.up > 0 ? ", up " + c.up + (c.up === 1 ? " spot" : " spots") : "") + ", Lotus Score up " + c.pts + ". Show how their points add up.");
    els.climber.innerHTML =
      avatarHtml(c.e.name) +
      '<span class="cl-txt"><span class="cl-eyebrow">Climber of the week</span><span class="cl-name">' + esc(c.e.name) + '</span><span class="cl-when">' + esc(c.when) + "</span></span>" +
      '<span class="cl-stats">' + (st.up ? '<span class="cl-up">' + st.up + "</span>" : "") + '<span class="cl-pts">' + st.pts + "</span></span>";
  }

  // ---- Page visits (player link), by source ----------------------------------------
  // Each place the link is posted gets its own ?src= so the admin page can
  // show which channel brings people in. The tag is dropped from the address
  // bar once read, so a link copied from there isn't credited twice.
  var VISIT_SOURCES = {
    bio: "Instagram bio", story: "Instagram Stories", wa: "WhatsApp", qr: "QR code",
    share: "Shared by players", ig: "Instagram (other)", direct: "Direct / other",
  };
  var TRACKING_LINKS = ["bio", "story", "wa", "qr"];
  var visitSrc = (function () {
    var s = String(params.get("src") || "").toLowerCase();
    if (VISIT_SOURCES.hasOwnProperty(s)) return s;
    var ua = navigator.userAgent || "", ref = document.referrer || "";
    if (/Instagram/i.test(ua) || /instagram\.com/i.test(ref)) return "ig";
    if (/whatsapp/i.test(ref)) return "wa";
    return "direct";
  })();
  if (params.has("src") && window.history && history.replaceState) {
    try {
      var cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete("src");
      history.replaceState(history.state, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    } catch (err) {}
  }
  var visitLogged = false;
  // Player view only, once per browser per day, never for the coach.
  function logVisit() {
    if (visitLogged || !readOnly || !(window.LH && LH.ready && LH.logLeaderboardVisit)) return;
    visitLogged = true;
    if (isCoach()) return;
    var today = isoToday(), key = "lotus-leaderboard:visit:" + boardId;
    try {
      if (localStorage.getItem(key) === today) return;
      localStorage.setItem(key, today);
    } catch (err) {}
    LH.logLeaderboardVisit(boardId, today, visitSrc).catch(function () {});
  }

  var visits = null; // [{ id: "YYYY-MM-DD_src", n }] once loaded
  var visitsState = "idle"; // idle | loading | error
  function loadVisits() {
    if (!(window.LH && LH.ready && LH.getLeaderboardVisits) || visitsState === "loading") return;
    visitsState = "loading";
    renderStatsBody();
    LH.getLeaderboardVisits(boardId).then(function (rows) {
      visits = rows;
      visitsState = "idle";
      renderStatsBody();
    }, function () {
      visitsState = "error";
      renderStatsBody();
    });
  }
  function renderStats(show) {
    els.statsCard.hidden = !show;
    if (!show) return;
    if (!els.statsLinks.children.length) {
      els.statsLinks.innerHTML = TRACKING_LINKS.map(function (src) {
        var url = playerViewUrl(src);
        return '<li><span class="sl-txt"><span class="sl-lbl">' + VISIT_SOURCES[src] + '</span><span class="sl-url">' + esc(url.replace(/^https?:\/\//, "")) + "</span></span>" +
          '<button type="button" class="btn small" data-copy-src="' + src + '" aria-label="Copy the ' + VISIT_SOURCES[src] + ' link">Copy</button></li>';
      }).join("");
    }
    if (visits === null && visitsState === "idle") loadVisits();
    else renderStatsBody();
  }
  function renderStatsBody() {
    if (visits === null) {
      els.statsTotal.innerHTML = '<span class="st-all">' + (visitsState === "error" ? "Couldn't load visits. Check your connection, then tap Refresh." : "Loading visits\u2026") + "</span>";
      els.statsBars.innerHTML = "";
      return;
    }
    var today = dayNum(isoToday());
    var week = {}, thisWeek = 0, lastWeek = 0, all = 0;
    visits.forEach(function (v) {
      var m = /^(\d{4}-\d{2}-\d{2})_(\w+)$/.exec(v.id);
      if (!m) return;
      var age = today - dayNum(m[1]);
      all += v.n;
      if (age >= 0 && age < 7) { thisWeek += v.n; week[m[2]] = (week[m[2]] || 0) + v.n; }
      else if (age >= 7 && age < 14) lastWeek += v.n;
    });
    var diff = thisWeek - lastWeek;
    var delta = lastWeek || thisWeek
      ? '<span class="st-delta ' + (diff > 0 ? "up" : diff < 0 ? "down" : "") + '">' + (diff > 0 ? "\u25B2 " : diff < 0 ? "\u25BC " : "") + Math.abs(diff) + " vs previous 7 days</span>"
      : "";
    els.statsTotal.innerHTML =
      '<span class="st-num">' + thisWeek + '</span><span class="st-lbl">' + (thisWeek === 1 ? "visit" : "visits") + " in the last 7 days</span>" + delta +
      '<span class="st-all">' + all + (all === 1 ? " visit" : " visits") + " since tracking began</span>";
    var srcs = Object.keys(week).sort(function (a, b) { return week[b] - week[a]; });
    var max = srcs.length ? week[srcs[0]] : 0;
    els.statsBars.innerHTML = srcs.length
      ? srcs.map(function (src) {
          return '<li><span class="sb-lbl">' + esc(VISIT_SOURCES[src] || src) + '</span><span class="sb-track" aria-hidden="true"><span class="sb-fill" style="width:' +
            Math.round(week[src] / max * 100) + '%"></span></span><span class="sb-n">' + week[src] + "</span></li>";
        }).join("")
      : '<li><span class="sb-empty">No visits in the last 7 days yet. Post the links below to start counting.</span></li>';
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
  // The board was first saved with the long dates line; show the shorter
  // one instead. cleanDoc() runs on every save, so the next admin save
  // writes the new text to the board as well.
  var OLD_SUBTITLES = { "October 1 – October 31": "Oct 1 – 31", "October 1 - October 31": "Oct 1 – 31" };
  function shortSubtitle(s) {
    return OLD_SUBTITLES.hasOwnProperty(s) ? OLD_SUBTITLES[s] : s;
  }
  // Same for the challenge name, renamed to "October Challenge".
  var OLD_TITLES = { "October Lotus Challenge": "October Challenge" };
  function newTitle(s) {
    return OLD_TITLES.hasOwnProperty(s) ? OLD_TITLES[s] : s;
  }
  function cleanDoc(src) {
    src = src || {};
    return {
      title: newTitle(src.title || board.title),
      subtitle: shortSubtitle(src.subtitle || board.subtitle),
      entries: JSON.parse(JSON.stringify(Array.isArray(src.entries) ? src.entries : [])),
      startDate: validIso(src.startDate) ? src.startDate : null,
      endDate: validIso(src.endDate) ? src.endDate : null,
      snapshot: src.snapshot ? JSON.parse(JSON.stringify(src.snapshot)) : null,
      weeks: src.weeks && typeof src.weeks === "object" ? JSON.parse(JSON.stringify(src.weeks)) : null,
      events: JSON.parse(JSON.stringify(Array.isArray(src.events) ? src.events : [])),
      calendarId: typeof src.calendarId === "string" && src.calendarId ? src.calendarId : null,
      calendarKey: typeof src.calendarKey === "string" && src.calendarKey ? src.calendarKey : null,
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
      doc.weeks = weeksBefore(doc);
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
    // An empty snapshot from the local cache isn't an answer yet; keep the
    // placeholder up until the server replies (or it errors).
    if (err || data || !fromCache) boardLoaded = true;
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
      board.title = newTitle(data.title || board.title);
      board.subtitle = shortSubtitle(data.subtitle || board.subtitle);
      board.entries = Array.isArray(data.entries) ? data.entries : [];
      board.startDate = data.startDate || null;
      board.endDate = data.endDate || null;
      board.snapshot = data.snapshot || null;
      board.weeks = data.weeks || null;
      board.events = Array.isArray(data.events) ? data.events : [];
      board.calendarId = data.calendarId || null;
      board.calendarKey = data.calendarKey || null;
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
    fetchCalendar(false);
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
        logVisit();
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
      boardLoaded = true;
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
      "noScores", "duprWarn", "moveHint", "scoringCard", "prizeMeta", "eventsCard", "eventsList",
      "eventsEditBtn", "eventsSub", "eventsEmpty", "eventForm", "evFormTitle", "evDate", "evStart", "evEnd",
      "evTitle", "evType", "evPlace", "evSaveBtn", "evCancelBtn", "evMsg", "menuEventsBtn",
      "eventsManageLink", "calError", "eventsSubscribe", "subGoogle", "subApple", "calendarIdInput", "calendarKeyInput",
      "winnerCard", "prizeBanner", "joinCard", "joinBtn", "drillBtn", "joinSticky", "skelCard", "prizeZoomBtn", "prizeDialog", "prizeDialogImg", "prizeDialogClose", "joinDialog", "joinDialogClose", "joinDialogKicker", "joinDialogTitle", "joinSteps", "joinMsg", "joinCopyFail", "joinOpenBtn", "launchCard", "launchCount", "launchRosterCount", "launchRoster",
      "boardCard", "boardHeading", "podium", "climber",
      "statsCard", "statsRefreshBtn", "statsTotal", "statsBars", "statsLinks",
      "shareWrap", "shareBoardBtn", "shareMenu", "shareWhatsApp", "shareCopyBtn", "menuShareBtn", "storyBtn",
      "storyCard", "storyImg", "storyShareBtn", "storySaveBtn", "storyCopyBtn", "storyCloseBtn",
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
    var start = els.startDuprInput.value, end = els.endDuprInput.value;
    return hasDupr(start) && hasDupr(end) ? num(end) - num(start) : 0;
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
      els.startDuprInput.value = hasDupr(e.startDupr) ? e.startDupr : "";
      els.endDuprInput.value = hasDupr(e.endDupr) ? e.endDupr : "";
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
      startDupr: hasDupr(els.startDuprInput.value) ? num(els.startDuprInput.value) : null,
      endDupr: hasDupr(els.endDuprInput.value) ? num(els.endDuprInput.value) : null,
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
    els.calendarIdInput.value = board.calendarId || "";
    els.calendarKeyInput.value = board.calendarKey || "";
    els.editPanel.hidden = false;
  }
  function saveBoardMeta() {
    var title = els.titleInput.value.trim();
    var subtitle = els.subtitleInput.value.trim();
    var start = validIso(els.startDateInput.value) ? els.startDateInput.value : null;
    var end = validIso(els.endDateInput.value) ? els.endDateInput.value : null;
    var calId = normalizeCalendarId(els.calendarIdInput.value);
    var calKey = els.calendarKeyInput.value.trim() || null;
    els.editPanel.hidden = true;
    commit(function (doc) {
      if (title) doc.title = title;
      if (subtitle) doc.subtitle = subtitle;
      doc.startDate = start;
      doc.endDate = end;
      doc.calendarId = calId;
      doc.calendarKey = calKey;
    });
    fetchCalendar(true);
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
    els.boardTitle.textContent = newTitle(board.title);
    els.boardSubtitle.textContent = shortSubtitle(board.subtitle);
    var end = challengeDates().end;
    els.prizeMeta.hidden = !end;
    if (end) els.prizeMeta.textContent = "Awarded to the top Lotus Score on " + fmtDay(end);
    var cd = countdown();
    // Before launch the header already shows the dates and the countdown card
    // shows the time left, so a "Starts ..." pill would only repeat them.
    els.countdown.hidden = !cd || cd.phase === "before";
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
    els.shareWrap.hidden = !readOnly; // admins share from the "..." menu
    if (readOnly) els.storyCard.hidden = true;
    els.editBoardBtn.hidden = restricted;
    els.shareLinkBtn.hidden = readOnly;
    els.qrBtn.hidden = readOnly;
    els.exportCsvBtn.hidden = restricted;
    els.menuEventsBtn.hidden = restricted;
    if (restricted) { els.qrCard.hidden = true; els.editPanel.hidden = true; }
    updateLastUpdatedText();

    var list = sortedEntries();
    var scored = anyScored(list);

    var ph = phase();
    var preLaunch = ph === "before" && !scored;
    renderRank(list, scored);
    renderEvents(!restricted);
    renderLaunch(list, preLaunch);
    renderWinner(list, ph === "ended" && scored);
    renderPodium(list, scored && ph !== "before");
    renderJoin(list, ph);
    renderClimber(list, scored && ph === "live");
    renderStats(!restricted && !!(window.LH && LH.ready));
    // Until the board first loads, a placeholder stands in for the countdown /
    // leaderboard, so a slow connection doesn't flash "Be the first" or an
    // empty table before the real players appear.
    var loading = !boardLoaded && !board.entries.length;
    els.skelCard.hidden = !loading;
    // Players get the countdown + roster instead of a table of zeros; the
    // coach keeps the table to add players and log sessions.
    els.boardCard.hidden = preLaunch && restricted;
    if (loading) { els.launchCard.hidden = true; els.boardCard.hidden = true; }
    updateSticky();
    els.boardHeading.textContent = ph === "ended" ? "Final standings" : "Lotus Leaderboard";

    els.playerCount.textContent = list.length ? list.length + (list.length === 1 ? " player" : " players") : "";
    els.boardEmpty.hidden = !!list.length;
    els.boardTable.hidden = !list.length;
    els.boardHint.hidden = !list.length;
    var cd = countdown();
    els.noScores.hidden = !list.length || scored;
    renderDuprWarn(list, !restricted && ph !== "ended");
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
          avatarHtml(e.name, "av-sm") + '<span class="player-name">' + esc(e.name) + "</span>" + (e.id === meId ? '<span class="you-pill">You</span>' : "") +
          (scored ? movementHtml(e) : "") +
          '<span class="chev" aria-hidden="true"></span></button></td>' +
          '<td class="total">' + e._c.total + "</td>" +
          '<td class="col-sub">' + e._c.duprPoints + "</td>" +
          '<td class="col-sub">' + e._c.community + "</td>" +
          "</tr>" +
          (open ? breakdownRows(e, restricted) : "")
        );
      })
      .join("");
  }

  // ---- initials avatars ------------------------------------------------------
  // A coloured circle with a player's initials. Colour is picked from the
  // name so it stays the same everywhere; all shades keep white text ≥4.5:1.
  // Ten clearly different hues, all dark enough for white initials (>= 4.5:1).
  var AVATAR_COLORS = ["#1d4f91", "#0f6e5f", "#6b3fa0", "#b3451b", "#2f6b1f", "#a3386b", "#8a5300", "#0e6a8a", "#b91c2b", "#46606e"];
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    var s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || "?").slice(0, 2);
    return s.toUpperCase();
  }
  // Each player gets the next colour in the order they were added, so the
  // first ten never share one; anyone not on the board falls back to a hash.
  function avatarColor(name) {
    for (var i = 0; i < board.entries.length; i++) {
      if (board.entries[i].name === name) return AVATAR_COLORS[i % AVATAR_COLORS.length];
    }
    var h = 0, s = String(name || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  // Colours picked for particular players, by name (case-insensitive):
  // [background, initials]. Light backgrounds get dark initials (>= 4.5:1).
  var AVATAR_PICKS = {
    "durian d": ["#f5c518", "#3d2f00"], // yellow
    "lumpia l": ["#f76707", "#3a1600"], // orange
  };
  function avatarStyle(name) {
    var pick = AVATAR_PICKS[String(name || "").trim().toLowerCase()];
    return pick ? { bg: pick[0], fg: pick[1] } : { bg: avatarColor(name), fg: "#fff" };
  }
  function avatarHtml(name, cls) {
    var st = avatarStyle(name);
    return '<span class="av' + (cls ? " " + cls : "") + '" style="background:' + st.bg + ";color:" + st.fg + '" aria-hidden="true">' + esc(initials(name)) + "</span>";
  }

  // ---- challenge phase: before / live / ended ----------------------------------
  function phase() {
    var cd = countdown();
    return cd ? cd.phase : "live";
  }
  function startCountdownParts() {
    var d = challengeDates();
    if (!d.start) return null;
    var p = d.start.split("-");
    var ms = new Date(+p[0], +p[1] - 1, +p[2]).getTime() - Date.now();
    if (ms <= 0) return null;
    var mins = Math.floor(ms / 60000);
    return { days: Math.floor(mins / 1440), hours: Math.floor(mins / 60) % 24, mins: mins % 60 };
  }
  function renderLaunch(list, show) {
    els.launchCard.hidden = !show;
    if (!show) return;
    updateLaunchCount();
    var roster = list.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    els.launchRosterCount.textContent = roster.length ? roster.length + (roster.length === 1 ? " player" : " players") : "";
    var you = readOnly
      ? '<li class="lr-you"><a href="' + JOIN_URL + '" data-join target="_blank" rel="noopener"><span class="lr-plus" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg></span>' +
        (roster.length ? "You?" : "Be the first") + '<span class="sr-only"> Join the challenge on Instagram</span></a></li>'
      : "";
    els.launchRoster.innerHTML = roster.length
      ? roster.map(function (e) { return "<li>" + avatarHtml(e.name) + '<span class="lr-name">' + esc(e.name) + "</span></li>"; }).join("") + you
      : you || '<li class="lr-empty">Be the first to sign up.</li>';
  }
  function updateLaunchCount() {
    var t = startCountdownParts();
    if (!t) { els.launchCount.innerHTML = ""; return; }
    var tile = function (n, label) {
      return '<div class="lc-tile"><span class="lc-num">' + String(n).padStart(2, "0") + '</span><span class="lc-lbl">' + label + "</span></div>";
    };
    els.launchCount.innerHTML = tile(t.days, "days") + tile(t.hours, "hrs") + tile(t.mins, "mins");
    els.launchCount.setAttribute("aria-label", "Starts in " + t.days + " days, " + t.hours + " hours and " + t.mins + " minutes");
  }

  // ---- admin: players still missing a starting DUPR ------------------------------
  // Skill Points count from the Oct 1 rating, so everyone needs one on file
  // before launch. Each name opens that player's edit form.
  function renderDuprWarn(list, show) {
    var missing = show ? list.filter(function (e) { return e.mode === "range" && !hasDupr(e.startDupr); }) : [];
    els.duprWarn.hidden = !missing.length;
    if (!missing.length) return;
    els.duprWarn.innerHTML =
      "<b>" + missing.length + (missing.length === 1 ? " player needs" : " players need") + " a Start DUPR</b> " +
      '<span class="dw-why">Skill Points stay at 0 until it&rsquo;s in. Tap a name to add it.</span>' +
      '<span class="dw-names">' + missing.map(function (e) {
        return '<button type="button" class="dw-name" data-edit="' + esc(e.id) + '">' + esc(e.name) + "</button>";
      }).join("") + "</span>";
  }

  // ---- top-3 podium -----------------------------------------------------------
  function renderPodium(list, show) {
    els.podium.hidden = !show;
    if (!show) return;
    var top = list.slice(0, 3);
    var order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : [top[0]];
    var MEDAL = { 1: "gold", 2: "silver", 3: "bronze" };
    els.podium.innerHTML = order.map(function (e) {
      var place = list.indexOf(e) + 1; // podium step by position; the badge shows the (possibly shared) rank
      return (
        '<button type="button" class="pod pod-' + place + " " + (MEDAL[e._rank] || "") + '" data-pod="' + esc(e.id) + '" aria-label="' +
        esc(ordinal(e._rank) + " place: " + e.name + ", Lotus Score " + e._c.total) + '">' +
        avatarHtml(e.name, "av-lg") +
        '<span class="pod-name">' + esc(e.name) + "</span>" +
        '<span class="pod-pts">' + e._c.total + '<span class="pod-unit">Lotus Score</span></span>' +
        '<span class="pod-step" aria-hidden="true">' + e._rank + "</span>" +
        "</button>"
      );
    }).join("");
  }

  // ---- winner (after the end date) -----------------------------------------------
  function renderWinner(list, show) {
    els.winnerCard.hidden = !show;
    els.prizeBanner.hidden = show;
    if (!show) return;
    var lead = list[0];
    // Published tie-break: equal Lotus Score -> most Community Points wins.
    // Only a tie on both is left for the academy to call.
    var winners = list.filter(function (e) { return e._c.total === lead._c.total && e._c.community === lead._c.community; });
    var names = winners.map(function (e) { return e.name; });
    var headline = winners.length === 1
      ? "Congratulations, " + esc(lead.name) + "!"
      : "It's a tie: " + esc(names.slice(0, -1).join(", ")) + " &amp; " + esc(names[names.length - 1]);
    var sub = winners.length === 1
      ? "Winner of the <b>Zocker Pro Series Control Paddle</b> with a Lotus Score of " + lead._c.total
      : "Level on Lotus Score and Community Points (" + lead._c.total + " Lotus Score). The academy will announce the winner.";
    els.winnerCard.innerHTML =
      '<div class="win-avatars">' + winners.slice(0, 3).map(function (e) { return avatarHtml(e.name, "av-xl"); }).join("") + "</div>" +
      '<div class="win-txt"><div class="win-kicker">Final results</div>' +
      '<div class="win-head">' + headline + "</div>" +
      '<div class="win-sub">' + sub + "</div></div>" +
      '<img class="win-paddle" src="/leaderboard/prize-paddle.png" alt="" width="111" height="240" />';
  }

  // Player view: the Instagram sign-up button for visitors. Hidden in the
  // admin view, once the challenge is over, and once a visitor has picked
  // their own name (they're already in).
  function renderJoin(list, ph) {
    var isIn = list.some(function (e) { return e.id === meId; });
    els.joinCard.hidden = !readOnly || ph === "ended" || isIn;
    // The drilling-session button is for everyone on the player view, joined
    // or not, until the challenge is over.
    els.drillBtn.hidden = !readOnly || ph === "ended";
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
      '<div class="me-txt"><div class="me-name">' + esc(me.name) + ' <span class="me-pts">' + me._c.total + " Lotus Score</span></div>" +
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
    if (!scored) return phase() === "before" ? "You're in. The challenge starts " + fmtDay(challengeDates().start) : "Waiting for the first scores";
    if (phase() === "ended") return "Final result: " + (isTied(me, list) ? "tied for " : "") + ordinal(me._rank) + " place";
    var tied = isTied(me, list);
    if (me._rank === 1) {
      var next = list.filter(function (e) { return e._rank > 1; })[0];
      return tied ? "Tied for 1st place"
        : next ? "1st place, " + (me._c.total - next._c.total) + " ahead of " + ordinal(next._rank)
        : "1st place";
    }
    return (tied ? "Tied for " + ordinal(me._rank) + " \u00b7 " : "") + (list[0]._c.total - me._c.total) + " behind 1st place";
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
  var calOpenId = null; // event whose "Add to calendar" choices are showing
  function fmtClock(hhmm) {
    var p = String(hhmm).split(":"), h = +p[0], m = +p[1];
    return ((h + 11) % 12 + 1) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? " AM" : " PM");
  }
  function validEvent(ev) {
    return ev && validIso(ev.date) && (ev.allDay || /^\d{2}:\d{2}$/.test(ev.start || "")) && ev.title;
  }
  function eventSource() {
    return usingCalendar() ? cal.events || [] : board.events || [];
  }
  function sortedEvents() {
    return eventSource().filter(validEvent)
      .slice()
      .sort(function (a, b) { return (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")); });
  }

  // ---- Google Calendar as the events source (optional) ------------------------
  // With a public calendar's ID saved on the board, events are read from
  // Google Calendar (Calendar API v3, read-only, API key) instead of the
  // board's own list, refreshed every 10 minutes. The event type (and so its
  // points tag) comes from words in the title/description: "social",
  // "drill"/"clinic", "ranked"; anything else shows as a special event.
  var cal = { events: null, error: null, fetchedFor: null, at: 0 };
  var CAL_CACHE_KEY = "lotus-leaderboard:cal:" + boardId;
  function usingCalendar() { return !!board.calendarId; }
  function normalizeCalendarId(raw) {
    var v = String(raw || "").trim();
    if (!v) return null;
    // Accept a pasted share/embed link as well as the bare ID.
    var m = v.match(/[?&](?:src|cid)=([^&#]+)/);
    if (m) {
      v = decodeURIComponent(m[1]);
      if (!/@/.test(v)) { try { v = atob(v.replace(/-/g, "+").replace(/_/g, "/")); } catch (e) {} }
    }
    var ical = v.match(/calendar\/ical\/([^/]+)\//);
    if (ical) v = decodeURIComponent(ical[1]);
    return v || null;
  }
  function calendarKey() {
    return board.calendarKey || (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) || "";
  }
  function typeFromText(s) {
    s = String(s || "").toLowerCase();
    if (/\bsocial\b/.test(s)) return "social";
    if (/\b(drill|drills|clinic)\b/.test(s)) return "drill";
    if (/\branked\b/.test(s)) return "ranked";
    return "special";
  }
  function localIso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function localHm(d) {
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function fromGoogle(item) {
    var s = item.start || {}, e = item.end || {};
    var ev = {
      id: "g_" + item.id,
      title: item.summary || "Untitled event",
      place: item.location || "",
      type: typeFromText((item.summary || "") + " " + (item.description || "")),
    };
    if (s.dateTime) {
      var ds = new Date(s.dateTime);
      ev.date = localIso(ds);
      ev.start = localHm(ds);
      if (e.dateTime) {
        var de = new Date(e.dateTime);
        if (localIso(de) === ev.date) ev.end = localHm(de);
      }
    } else if (s.date) {
      ev.date = s.date;
      ev.allDay = true;
    }
    return ev;
  }
  function explainCalError(err) {
    var reasons = [];
    ((err && err.details) || []).forEach(function (d) { if (d.reason) reasons.push(d.reason); });
    ((err && err.errors) || []).forEach(function (d) { if (d.reason) reasons.push(d.reason); });
    var r = reasons.join(" ") + " " + ((err && err.message) || "");
    if (/API_KEY_SERVICE_BLOCKED|blocked/i.test(r)) return "The site's API key isn't allowed to use Google Calendar yet. Add \u201cGoogle Calendar API\u201d to the key's API restrictions in Google Cloud (setup step 3).";
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(r)) return "The Google Calendar API isn't turned on for this project yet (setup step 2).";
    if (/API_KEY_INVALID|keyInvalid|API key not valid/i.test(r)) return "That Calendar API key isn't valid. Check it in Edit challenge details.";
    if (err && (err.code === 404 || /notFound/i.test(r))) return "Google Calendar couldn't find that calendar. Check the ID, and that the calendar is shared publicly.";
    if (err && err.code === 403) return "Google Calendar refused access. Make sure the calendar is shared publicly (\u201cMake available to public\u201d).";
    return "Couldn't load events from Google Calendar right now.";
  }
  function fetchCalendar(force) {
    var id = board.calendarId;
    if (!id) { cal = { events: null, error: null, fetchedFor: null, at: 0 }; return; }
    if (!force && cal.fetchedFor === id && Date.now() - cal.at < 10 * 60 * 1000) return;
    if (cal.fetchedFor !== id) {
      cal = { events: null, error: null, fetchedFor: id, at: 0 };
      try {
        var cached = JSON.parse(localStorage.getItem(CAL_CACHE_KEY) || "null");
        if (cached && cached.id === id && Array.isArray(cached.events)) cal.events = cached.events;
      } catch (e) {}
    }
    cal.at = Date.now();
    var from = new Date();
    from.setHours(0, 0, 0, 0);
    var url = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(id) +
      "/events?singleEvents=true&orderBy=startTime&maxResults=25&timeMin=" + encodeURIComponent(from.toISOString()) +
      "&key=" + encodeURIComponent(calendarKey());
    fetch(url)
      .then(function (res) {
        return res.json().then(function (j) {
          if (!res.ok) throw (j && j.error) || { code: res.status };
          return j;
        });
      })
      .then(function (j) {
        if (board.calendarId !== id) return;
        cal.events = (j.items || []).filter(function (i) { return i.status !== "cancelled"; }).map(fromGoogle).filter(validEvent);
        cal.error = null;
        try { localStorage.setItem(CAL_CACHE_KEY, JSON.stringify({ id: id, events: cal.events })); } catch (e) {}
        render();
      })
      .catch(function (err) {
        if (board.calendarId !== id) return;
        cal.error = explainCalError(err);
        render();
      });
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
    var when = away < 0 ? "Past" : away === 0 ? "Today" : away === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "long" });
    var time = ev.allDay ? "All day" : fmtClock(ev.start) + (/^\d{2}:\d{2}$/.test(ev.end || "") ? "&ndash;" + fmtClock(ev.end) : "");
    var tag = t.pts
      ? '<span class="ev-tag ' + esc(ev.type) + '">' + t.label + " &middot; +" + t.pts + (t.pts === 1 ? " pt" : " pts") + "</span>"
      : '<span class="ev-tag special">' + t.label + "</span>";
    var id = esc(ev.id);
    var actions = opts.editing
      ? '<div class="ev-admin"><button type="button" class="btn small ghost" data-ev-edit="' + id + '">Edit</button>' +
        '<button type="button" class="btn small danger" data-ev-del="' + id + '">Delete</button></div>'
      : '<button type="button" class="btn small ghost ev-cal" data-cal-toggle="' + id + '" aria-expanded="' + (calOpenId === ev.id) + '" aria-controls="cal-' + id + '" aria-label="Add ' + esc(ev.title) + ' to calendar">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 13v5M9.5 15.5h5"/></svg>' +
        '<span class="ev-cal-txt">Add to calendar</span></button>';
    var calOpts = !opts.editing && calOpenId === ev.id
      ? '<div class="ev-cal-opts" id="cal-' + id + '">' +
        '<a class="btn small ghost" href="' + esc(googleCalUrl(ev)) + '" target="_blank" rel="noopener">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2.5" fill="#fff" stroke="#4285f4" stroke-width="2"/><path d="M3 9h18" stroke="#4285f4" stroke-width="2"/><text x="12" y="18.2" text-anchor="middle" font-size="8.5" font-weight="700" fill="#4285f4" font-family="Arial,sans-serif">31</text></svg>' +
        "Google Calendar</a>" +
        '<button type="button" class="btn small ghost" data-ical="' + id + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>' +
        "Apple / Outlook (.ics)</button></div>"
      : "";
    return (
      '<li class="ev' + (opts.next ? " next" : "") + (away < 0 ? " past" : "") + (ev.id === editingEventId ? " being-edited" : "") + '">' +
      '<div class="ev-date" aria-hidden="true"><span class="ev-mon">' + d.toLocaleDateString("en-US", { month: "short" }) + "</span>" +
      '<span class="ev-day">' + d.getDate() + "</span></div>" +
      '<div class="ev-body"><div class="ev-title">' + esc(ev.title) + "</div>" +
      '<div class="ev-meta"><span class="sr-only">' + esc(d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })) + ", </span>" +
      '<span aria-hidden="true">' + when + " &middot; </span>" + time + (ev.place ? " &middot; " + esc(ev.place) : "") + "</div>" +
      tag + "</div>" + actions + calOpts + "</li>"
    );
  }
  // Google Calendar's "create event" link, pre-filled. Times are local
  // ("floating"), pinned to the viewer's time zone so Google doesn't shift them.
  function googleCalUrl(ev) {
    var stamp = function (hhmm) { return ev.date.replace(/-/g, "") + "T" + hhmm.replace(":", "") + "00"; };
    var dates = ev.allDay ? ev.date.replace(/-/g, "") + "/" + nextDay(ev.date).replace(/-/g, "") : stamp(ev.start) + "/" + stamp(eventEnd(ev));
    var tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    var t = EVENT_TYPES[ev.type] || EVENT_TYPES.special;
    var params = [
      ["action", "TEMPLATE"],
      ["text", ev.title + " (Lotus Pickleball Academy)"],
      ["dates", dates],
      ["details", t.label + (t.pts ? " \u00b7 +" + t.pts + " Community " + (t.pts === 1 ? "point" : "points") : "") + "\nLeaderboard: " + playerViewUrl()],
      ["location", ev.place || ""],
    ];
    if (tz) params.push(["ctz", tz]);
    return "https://calendar.google.com/calendar/render?" + params.map(function (p) {
      return p[0] + "=" + encodeURIComponent(p[1]);
    }).join("&");
  }
  function nextDay(iso) {
    var p = iso.split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1));
    return d.toISOString().slice(0, 10);
  }
  function eventEnd(ev) {
    return /^\d{2}:\d{2}$/.test(ev.end || "") ? ev.end : String(Math.min(23, +ev.start.slice(0, 2) + 1)).padStart(2, "0") + ev.start.slice(2);
  }
  function renderEvents(canEdit) {
    var gc = usingCalendar();
    if (!canEdit || gc) { eventsEditing = false; editingEventId = null; }
    var editing = canEdit && eventsEditing;
    var list = editing ? sortedEvents() : upcomingEvents();
    els.eventsCard.hidden = !list.length && !canEdit;
    els.eventsEditBtn.hidden = !canEdit || gc;
    els.eventsManageLink.hidden = !canEdit || !gc;
    els.calError.hidden = !(canEdit && gc && cal.error);
    els.calError.textContent = cal.error || "";
    els.eventsSubscribe.hidden = !gc || !list.length;
    if (gc) {
      els.subGoogle.href = "https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(board.calendarId);
      els.subApple.href = "webcal://calendar.google.com/calendar/ical/" + encodeURIComponent(board.calendarId) + "/public/basic.ics";
    }
    els.menuEventsBtn.lastChild.textContent = gc ? "Manage events" : "Edit events";
    els.eventsEditBtn.textContent = editing ? "Done" : "Edit events";
    els.eventsEditBtn.setAttribute("aria-expanded", String(editing));
    els.eventForm.hidden = !editing;
    els.eventsSub.hidden = editing;
    els.eventsEmpty.hidden = !!list.length || (gc && !!cal.error);
    els.eventsEmpty.textContent = gc
      ? (cal.events === null ? "Loading events from Google Calendar\u2026" : "No upcoming events on the Google Calendar yet. Add them there and they'll show here (players see this card once there's an event).")
      : canEdit && !editing
        ? "No upcoming events yet. Tap \u201cEdit events\u201d to add one; players only see this card once there's an event."
        : "No events yet. Add the first one above.";
    var firstUpcoming = upcomingEvents()[0];
    els.eventsList.innerHTML = list.map(function (ev) {
      return eventRow(ev, { editing: editing, next: !editing && firstUpcoming && ev.id === firstUpcoming.id });
    }).join("");
  }
  function findEvent(id) {
    return eventSource().find(function (e) { return e.id === id; });
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
      "UID:" + String(ev.id).replace(/[^A-Za-z0-9_-]/g, "") + "@lotus-leaderboard",
      "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z",
      ev.allDay ? "DTSTART;VALUE=DATE:" + ev.date.replace(/-/g, "") : "DTSTART:" + stamp(ev.date, ev.start),
      ev.allDay ? "DTEND;VALUE=DATE:" + nextDay(ev.date).replace(/-/g, "") : "DTEND:" + stamp(ev.date, eventEnd(ev)),
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
    return "I'm " + place + " in the " + board.title + " with " + me._c.total + (me._c.total === 1 ? " point" : " points") + "! See the leaderboard: " + playerViewUrl("share");
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
            '<span class="rm-pts">' + h[0]._c.total + " Lotus Score</span></button>";
        }).join("")
      : '<p class="rank-none">No ' + (readOnly ? "challenger" : "player") + " matching &ldquo;" + esc(els.rankSearch.value.trim()) + "&rdquo;" +
        (readOnly ? ' yet. Check the spelling, or <a href="' + JOIN_URL + '" data-join target="_blank" rel="noopener">DM us on Instagram</a> to join.' : ".") + "</p>";
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

  // src tags the link with where it's posted (see VISIT_SOURCES).
  function playerViewUrl(src) {
    for (var slug in VIEW_SLUGS) {
      if (VIEW_SLUGS[slug] === boardId) return location.origin + "/" + slug + (src ? "?src=" + src : "");
    }
    var u = new URL(location.href);
    u.searchParams.delete("src");
    u.searchParams.set("mode", "view");
    if (src) u.searchParams.set("src", src);
    return u.toString();
  }

  // ---- Share the leaderboard (link) ----------------------------------------
  function shareText() {
    var ph = phase();
    if (ph === "ended") return "The " + board.title + " results are in! See the final standings:";
    if (ph === "before") return "The " + board.title + " starts " + fmtDay(challengeDates().start) + ". 1st place wins a Zocker Pro Series Control Paddle. See who's in:";
    return "Who's leading the " + board.title + "? 1st place wins a Zocker Pro Series Control Paddle. See the live leaderboard:";
  }
  function setShareMenu(open) {
    els.shareMenu.hidden = !open;
    els.shareBoardBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      els.shareWhatsApp.href = "https://wa.me/?text=" + encodeURIComponent(shareText() + " " + playerViewUrl("share"));
      els.shareWhatsApp.focus();
    }
  }
  // Native share sheet where there is one (phones: WhatsApp, Instagram, texts
  // all in one place); otherwise a small WhatsApp / Copy link menu, which is
  // also what Instagram's in-app browser gets.
  function shareBoard(fromMenu) {
    var url = playerViewUrl(readOnly ? "share" : null);
    var fallback = function () {
      if (fromMenu) copyLink(url, "Leaderboard link copied");
      else setShareMenu(true);
    };
    if (navigator.share) {
      navigator.share({ title: board.title, text: shareText(), url: url }).catch(function (err) {
        if (!err || err.name !== "AbortError") fallback();
      });
    } else {
      fallback();
    }
  }
  function copyLink(url, msg) {
    var done = function () { toast(msg); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(function () { window.prompt("Copy this link:", url); });
    } else {
      window.prompt("Copy this link:", url);
    }
  }

  // ---- Instagram Story image (admin) ---------------------------------------
  // 1080x1920 PNG of the current standings (top 10, ties share a rank), the
  // prize and the link, for posting as a Story with a Link sticker. Built on a
  // canvas like the share-my-rank card; shown as a preview first so the
  // Share tap below calls navigator.share straight away (iOS needs that).
  var storyBlob = null;
  function drawStory() {
    var FONT = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    var list = sortedEntries();
    var scored = anyScored(list);
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    return Promise.all([loadImg("/leaderboard/logo.png?v=2"), loadImg("/leaderboard/prize-paddle.png"), fontsReady]).then(function (r) {
      var logo = r[0], paddle = r[1];
      var W = 1080, H = 1920, X = 80, c = document.createElement("canvas");
      c.width = W; c.height = H;
      var ctx = c.getContext("2d");
      var bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#fcebed"); bg.addColorStop(0.35, "#ffffff"); bg.addColorStop(1, "#fdf5f6");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#b91c2b"; ctx.fillRect(0, 0, W, 18);

      var climb = scored && phase() === "live" ? climberOfWeek(list) : null;
      var maxRows = climb ? 7 : 10; // the climber strip takes three rows' worth of room
      var rows = scored ? list.slice(0, maxRows)
        : list.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).slice(0, maxRows);
      var more = list.length - rows.length;
      var rowH = 78, headH = 88, pY = 500, cH = climb ? 150 + 36 : 0;
      var pH = headH + rows.length * rowH + (more > 0 ? 64 : 22);
      // A short list leaves a gap at the bottom: centre the whole layout
      // (brand row down to the link) inside the Story's safe area instead.
      var contentEnd = pY + pH + cH + 36 + 150 + 90 + 100;
      ctx.save();
      ctx.translate(0, Math.max(0, Math.floor((1760 - contentEnd) / 2)));

      // Brand row
      ctx.fillStyle = "#ffffff"; roundRect(ctx, X, 150, 130, 130, 30); ctx.fill();
      ctx.strokeStyle = "#eadfdf"; ctx.lineWidth = 3; ctx.stroke();
      if (logo) ctx.drawImage(logo, X + 7, 157, 116, 116);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#b91c2b"; ctx.font = "800 30px " + FONT; ctx.fillText(phase() === "ended" ? "FINAL RESULTS" : "LIVE LEADERBOARD", X + 160, 205);
      ctx.fillStyle = "#524c4a"; ctx.font = "700 36px " + FONT; ctx.fillText("Lotus Pickleball Academy", X + 160, 252);

      // Title, dates, countdown
      ctx.fillStyle = "#1c1a19"; fitText(ctx, board.title, W - 2 * X, "800", 88, FONT); ctx.fillText(board.title, X, 390);
      ctx.fillStyle = "#524c4a"; ctx.font = "700 36px " + FONT; ctx.fillText(board.subtitle, X, 450);
      var cd = countdown();
      if (cd) {
        var sw = ctx.measureText(board.subtitle + "  ").width;
        // The Story has no countdown card, so before launch say how long is left.
        var until = dayNum(challengeDates().start) - dayNum(isoToday());
        var cdText = cd.phase === "before" ? (until === 1 ? "Starts tomorrow" : "Starts in " + until + " days") : cd.text;
        ctx.fillStyle = "#b91c2b"; ctx.font = "800 36px " + FONT; ctx.fillText("\u00b7 " + cdText, X + sw, 450);
      }

      // Standings panel
      ctx.fillStyle = "#ffffff"; roundRect(ctx, X - 20, pY, W - 2 * X + 40, pH, 32); ctx.fill();
      ctx.strokeStyle = "#eadfdf"; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = "#6f6865"; ctx.font = "800 28px " + FONT;
      ctx.fillText(scored ? (phase() === "ended" ? "FINAL STANDINGS" : "TOP " + rows.length) : "WHO'S IN", X + 20, pY + 58);
      ctx.textAlign = "right";
      ctx.fillText(scored ? "LOTUS SCORE" : list.length + (list.length === 1 ? " PLAYER" : " PLAYERS"), W - X - 20, pY + 58);
      ctx.fillStyle = "#b91c2b"; ctx.fillRect(X, pY + headH - 6, W - 2 * X, 4);
      var MEDAL_FILL = { 1: "#c8860d", 2: "#8b93a0", 3: "#a35d28" };
      rows.forEach(function (e, i) {
        var y = pY + headH + i * rowH;
        if (scored && e._rank === 1) { ctx.fillStyle = "#fcebed"; ctx.fillRect(X, y, W - 2 * X, rowH); }
        if (i > 0) { ctx.fillStyle = "#efe9e8"; ctx.fillRect(X, y, W - 2 * X, 2); }
        var cy = y + rowH / 2;
        if (scored) {
          var medal = MEDAL_FILL[e._rank];
          ctx.beginPath(); ctx.arc(X + 44, cy, 27, 0, Math.PI * 2);
          ctx.fillStyle = medal || "#f6f2f1"; ctx.fill();
          if (!medal) { ctx.strokeStyle = "#e2dbd9"; ctx.lineWidth = 2; ctx.stroke(); }
          ctx.fillStyle = medal ? "#ffffff" : "#524c4a"; ctx.font = "800 28px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(String(e._rank), X + 44, cy + 1);
        }
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#1c1a19"; fitText(ctx, e.name, scored ? 560 : 800, scored && e._rank === 1 ? "800" : "700", 42, FONT);
        ctx.fillText(e.name, scored ? X + 96 : X + 24, cy + 1);
        if (scored) {
          ctx.textAlign = "right"; ctx.fillStyle = "#b91c2b"; ctx.font = "800 44px " + FONT;
          ctx.fillText(String(e._c.total), W - X - 20, cy + 1);
        }
        ctx.textBaseline = "alphabetic";
      });
      if (more > 0) {
        ctx.textAlign = "center"; ctx.fillStyle = "#6f6865"; ctx.font = "700 30px " + FONT;
        ctx.fillText("+ " + more + " more on the full leaderboard", W / 2, pY + headH + rows.length * rowH + 44);
      }

      // Climber of the week strip
      if (climb) {
        var cY = pY + pH + 36, st = climberStats(climb);
        ctx.fillStyle = "#e9f6ee"; roundRect(ctx, X - 20, cY, W - 2 * X + 40, 150, 28); ctx.fill();
        ctx.strokeStyle = "rgba(15,123,69,.35)"; ctx.lineWidth = 3; ctx.stroke();
        var acx = X + 62, acy = cY + 75;
        ctx.beginPath(); ctx.arc(acx, acy, 52, 0, Math.PI * 2); ctx.fillStyle = "#0f7b45"; ctx.fill();
        ctx.beginPath(); ctx.arc(acx, acy, 45, 0, Math.PI * 2); ctx.fillStyle = avatarStyle(climb.e.name).bg; ctx.fill();
        ctx.fillStyle = avatarStyle(climb.e.name).fg; ctx.font = "800 34px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(initials(climb.e.name), acx, acy + 2);
        ctx.textBaseline = "alphabetic"; ctx.textAlign = "right";
        var rx = W - X - 10;
        if (st.up) { ctx.fillStyle = "#0f7b45"; ctx.font = "800 44px " + FONT; ctx.fillText(st.up, rx, cY + 70); }
        ctx.fillStyle = "#b91c2b"; ctx.font = "800 " + (st.up ? 34 : 44) + "px " + FONT; ctx.fillText(st.pts, rx, st.up ? cY + 118 : cY + 90);
        ctx.font = "800 44px " + FONT;
        var statW = Math.max(st.up ? ctx.measureText(st.up).width : 0, ctx.measureText(st.pts).width);
        var ctx0 = X + 140;
        ctx.textAlign = "left";
        ctx.fillStyle = "#0f7b45"; ctx.font = "800 26px " + FONT; ctx.fillText("CLIMBER OF THE WEEK", ctx0, cY + 48);
        ctx.fillStyle = "#1c1a19"; fitText(ctx, climb.e.name, rx - statW - 30 - ctx0, "800", 44, FONT); ctx.fillText(climb.e.name, ctx0, cY + 96);
        ctx.fillStyle = "#6f6865"; ctx.font = "700 26px " + FONT; ctx.fillText(climb.when, ctx0, cY + 136);
      }

      // Prize strip
      var sY = pY + pH + cH + 36, sH = 150;
      ctx.fillStyle = "#fcebed"; roundRect(ctx, X - 20, sY, W - 2 * X + 40, sH, 28); ctx.fill();
      ctx.strokeStyle = "rgba(185,28,43,.3)"; ctx.lineWidth = 3; ctx.stroke();
      var tx = X + 20;
      if (paddle) { var ph = 122, pw = paddle.width * ph / paddle.height; ctx.drawImage(paddle, X + 14, sY + 14, pw, ph); tx = X + 14 + pw + 30; }
      ctx.textAlign = "left";
      ctx.fillStyle = "#b91c2b"; ctx.font = "800 28px " + FONT; ctx.fillText("1ST PLACE WINS", tx, sY + 64);
      ctx.fillStyle = "#1c1a19"; fitText(ctx, "Zocker Pro Series Control Paddle", W - X - tx, "800", 42, FONT);
      ctx.fillText("Zocker Pro Series Control Paddle", tx, sY + 116);

      // Link + freshness
      var fY = sY + sH + 90;
      ctx.textAlign = "center";
      ctx.fillStyle = "#524c4a"; ctx.font = "700 32px " + FONT; ctx.fillText("See the full leaderboard", W / 2, fY);
      ctx.fillStyle = "#b91c2b"; fitText(ctx, playerViewUrl().replace(/^https?:\/\//, ""), W - 2 * X, "800", 40, FONT);
      ctx.fillText(playerViewUrl().replace(/^https?:\/\//, ""), W / 2, fY + 52);
      ctx.fillStyle = "#8a8380"; ctx.font = "600 26px " + FONT;
      ctx.fillText("Updated " + new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" }), W / 2, fY + 100);
      ctx.restore();

      return new Promise(function (resolve) { c.toBlob(resolve, "image/png"); });
    });
  }
  function openStory() {
    storyBlob = null;
    els.storyImg.removeAttribute("src");
    els.storyCard.hidden = false;
    els.storyShareBtn.disabled = true;
    els.storyCard.scrollIntoView({ behavior: "smooth", block: "start" });
    drawStory().then(function (blob) {
      storyBlob = blob;
      if (els.storyImg.dataset.url) URL.revokeObjectURL(els.storyImg.dataset.url);
      var url = URL.createObjectURL(blob);
      els.storyImg.dataset.url = url;
      els.storyImg.src = url;
      els.storyShareBtn.disabled = false;
    });
  }
  function storyFile() {
    return storyBlob && typeof File === "function" ? new File([storyBlob], "lotus-leaderboard-story.png", { type: "image/png" }) : null;
  }
  function shareStory() {
    var file = storyFile();
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(function (err) {
        if (!err || err.name !== "AbortError") saveStory();
      });
    } else {
      saveStory();
    }
  }
  function saveStory() {
    if (!storyBlob) return;
    downloadBlob(storyBlob, "lotus-leaderboard-story.png");
    toast("Story image saved. Post it from your photos.");
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
    var url = playerViewUrl("qr");
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
        fmtSigned(e._c.duprPoints / 100), e._c.duprPoints,
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

  // ---- sticky DM bar (phones) ----------------------------------------------------
  // Shown once the main Join the Challenge button has scrolled out of view, and only
  // while that button itself would be shown (player view, not ended, not
  // already on the board). CSS keeps it to phone widths.
  var joinAbove = false;
  function updateSticky() {
    var show = joinAbove && !els.joinCard.hidden;
    els.joinSticky.hidden = !show;
    document.body.classList.toggle("sticky-on", show);
  }
  function watchJoinButton() {
    if (!("IntersectionObserver" in window)) return;
    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      joinAbove = !e.isIntersecting && e.boundingClientRect.bottom < 0;
      updateSticky();
    }).observe(els.joinBtn);
  }

  // ---- Confetti + haptic on the Join, Drilling and Gachapon buttons ---------------
  // Tapping one fires a short confetti burst from the button (red and white
  // for Join, yellow and white for Drilling, blue and white for Gachapon) and
  // a haptic buzz, then opens the link about 0.75s later so the burst is
  // actually seen (opening straight away would cover it). The delay
  // stays inside the browser's user-activation window, so the new tab isn't
  // treated as a popup; if it's blocked anyway, the DM opens in this tab.
  var hapticLabel = null;
  function buzz() {
    try {
      if (navigator.vibrate) { navigator.vibrate([22, 40, 22]); return; }
      // iPhone: websites can't vibrate, but on iOS 18+ Safari, toggling a
      // switch-style checkbox gives a light haptic tick.
      if (!hapticLabel) {
        hapticLabel = document.createElement("label");
        hapticLabel.setAttribute("aria-hidden", "true");
        hapticLabel.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;";
        var sw = document.createElement("input");
        sw.type = "checkbox"; sw.setAttribute("switch", ""); sw.tabIndex = -1;
        hapticLabel.appendChild(sw);
        document.body.appendChild(hapticLabel);
      }
      hapticLabel.click();
    } catch (err) {}
  }
  // Confetti colour sets per button: [colours, edge colour for white pieces].
  var CONFETTI = {
    red: [["#b91c2b", "#e0364a", "#ffffff", "#ffffff", "#8f1421"], "rgba(185, 28, 43, .55)"],
    blue: [["#1d4f91", "#3b82f6", "#ffffff", "#ffffff", "#0e3a73"], "rgba(29, 79, 145, .55)"],
    yellow: [["#f5c518", "#fcd34d", "#ffffff", "#ffffff", "#d4a106"], "rgba(170, 120, 0, .6)"],
  };
  function confettiBurst(fromEl, scheme) {
    var set = CONFETTI[scheme] || CONFETTI.red;
    var r = fromEl.getBoundingClientRect();
    var c = document.createElement("canvas");
    c.className = "confetti";
    c.setAttribute("aria-hidden", "true");
    var dpr = Math.min(window.devicePixelRatio || 1, 2), W = window.innerWidth, H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr;
    document.body.appendChild(c);
    var ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    var COLORS = set[0];
    var ox = r.left + r.width / 2, oy = r.top + r.height / 2;
    var bits = [];
    for (var i = 0; i < 140; i++) {
      var a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.3; // mostly upward
      var sp = 7 + Math.random() * 9;
      bits.push({
        x: ox + (Math.random() - .5) * r.width * .6, y: oy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        w: 6 + Math.random() * 6, h: 4 + Math.random() * 5,
        rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .35,
        color: COLORS[i % COLORS.length], round: Math.random() < .3,
      });
    }
    var start = performance.now(), LIFE = 1700;
    function frame(now) {
      var t = now - start;
      ctx.clearRect(0, 0, W, H);
      var alpha = t < LIFE - 400 ? 1 : Math.max(0, (LIFE - t) / 400);
      bits.forEach(function (p) {
        p.vy += .32; p.vx *= .99; p.vy *= .99;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        if (p.round) ctx.arc(0, 0, p.h / 2 + 1, 0, Math.PI * 2);
        else ctx.rect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.fill();
        // White pieces get a thin coloured edge so they show on the light page.
        if (p.color === "#ffffff") { ctx.lineWidth = 1; ctx.strokeStyle = set[1]; ctx.stroke(); }
        ctx.restore();
      });
      if (t < LIFE) requestAnimationFrame(frame);
      else c.remove();
    }
    requestAnimationFrame(frame);
  }
  // Click handler for a link that should celebrate before opening: buzz,
  // confetti in the given colours, then open the link.
  function celebrate(scheme) {
    return function (ev) {
    var a = ev.currentTarget;
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return; // let "open in new tab" work normally
    ev.preventDefault();
    buzz();
    var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!calm) confettiBurst(a, scheme);
    setTimeout(function () {
      var w = null;
      try { w = window.open(a.href, "_blank"); } catch (err) {}
      if (w) { try { w.opener = null; } catch (err) {} }
      else location.href = a.href;
    }, calm ? 0 : 750);
    };
  }

  // ---- Message panel: How to join / Book a Drill Training Session -------------------
  // Every Join link and the drilling button open this first, so people know
  // what to send before the (empty) Instagram chat opens. The message is
  // editable and gets copied for them on "Open Instagram"; the links still
  // work as plain DM links without JS.
  var PASTE_STEP = "<li><span>Tap <b>Open Instagram</b>. Your message is copied automatically, so just <b>paste</b> it in the chat and send.</span></li>";
  var PANELS = {
    join: {
      kicker: "October Challenge", title: "How to join", msg: JOIN_MSG, scheme: "red",
      steps: "<li><span>Add your <b>name</b> and <b>DUPR ID</b> below.</span></li>" + PASTE_STEP +
        "<li><span>We&rsquo;ll reply and add you to the leaderboard.</span></li>",
    },
    drill: {
      kicker: "Earn +2 Community Points", title: "Book a Drill Training Session", msg: DRILL_MSG, scheme: "yellow",
      steps: "<li><span>Add your <b>name</b> and the <b>day and time</b> that work for you below.</span></li>" + PASTE_STEP +
        "<li><span>We&rsquo;ll reply to confirm your session. Each session you attend earns <b>+2 Community Points</b>.</span></li>",
    },
  };
  var panelMode = "join";
  var panelDrafts = {}; // what they've typed so far, per panel
  function openJoin(ev, mode) {
    if (ev && (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey)) return;
    if (ev) ev.preventDefault();
    if (els.joinDialog.open) return;
    panelMode = mode || "join";
    var cfg = PANELS[panelMode];
    els.joinDialogKicker.textContent = cfg.kicker;
    els.joinDialogTitle.textContent = cfg.title;
    els.joinSteps.innerHTML = cfg.steps;
    els.joinMsg.value = panelDrafts[panelMode] || cfg.msg;
    els.joinCopyFail.hidden = true;
    if (typeof els.joinDialog.showModal === "function") els.joinDialog.showModal();
    else els.joinDialog.setAttribute("open", "");
    // Tall enough to show the whole message without scrolling inside the box.
    els.joinMsg.style.height = "auto";
    els.joinMsg.style.height = (els.joinMsg.scrollHeight + 2) + "px";
    // Cursor at the end of "Name: " so they can type straight away.
    var at = els.joinMsg.value.indexOf("Name: ");
    if (at !== -1 && window.matchMedia && window.matchMedia("(hover: hover)").matches) {
      els.joinMsg.focus({ preventScroll: true });
      els.joinMsg.setSelectionRange(at + 6, at + 6);
      els.joinMsg.scrollTop = 0;
    }
  }
  function closeJoin() {
    panelDrafts[panelMode] = els.joinMsg.value;
    if (typeof els.joinDialog.close === "function") els.joinDialog.close();
    else els.joinDialog.removeAttribute("open");
  }
  // Resolves true once the message is on the clipboard, false if the
  // browser wouldn't allow it.
  function copyJoinMsg() {
    var text = els.joinMsg.value || PANELS[panelMode].msg;
    var legacy = function () {
      try { els.joinMsg.select(); return document.execCommand("copy"); } catch (err) { return false; }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, legacy);
    }
    return Promise.resolve(legacy());
  }

  // ---- prize photo, full size ------------------------------------------------------
  function openPrize() {
    if (!els.prizeDialogImg.getAttribute("src")) els.prizeDialogImg.src = "/leaderboard/prize-paddle-lg.png";
    if (typeof els.prizeDialog.showModal === "function") els.prizeDialog.showModal();
    else els.prizeDialog.setAttribute("open", "");
  }
  function closePrize() {
    if (typeof els.prizeDialog.close === "function") els.prizeDialog.close();
    else els.prizeDialog.removeAttribute("open");
  }

  // ---- wire up ------------------------------------------------------------
  function bind() {
    els.rankSearch.addEventListener("input", function () { renderMatches(sortedEntries()); });
    els.rankSearch.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter") return;
      var hits = els.rankMatches.querySelectorAll("[data-me]");
      if (hits.length === 1) pickMe(hits[0].getAttribute("data-me"));
    });
    els.podium.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-pod]");
      if (!b) return;
      expandedId = b.getAttribute("data-pod");
      render();
      scrollToRow(expandedId);
    });
    els.prizeZoomBtn.addEventListener("click", openPrize);
    document.addEventListener("click", function (ev) {
      var a = ev.target.closest && ev.target.closest("a[data-join], a[data-drill]");
      if (a) openJoin(ev, a.hasAttribute("data-drill") ? "drill" : "join");
    });
    var panelGo = { red: celebrate("red"), yellow: celebrate("yellow") };
    els.joinOpenBtn.addEventListener("click", function (ev) {
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      var copying = copyJoinMsg();
      panelGo[PANELS[panelMode].scheme](ev); // buzz + confetti from this button, then opens the DM
      copying.then(function (ok) {
        if (ok) { closeJoin(); toast("Message copied. Paste it in the Instagram chat."); return; }
        // Couldn't copy: keep the panel up with the text selected and say how
        // to copy it by hand, rather than claiming it was copied.
        els.joinCopyFail.hidden = false;
        try { els.joinMsg.focus({ preventScroll: true }); els.joinMsg.select(); } catch (err) {}
      });
    });
    els.joinDialogClose.addEventListener("click", closeJoin);
    els.joinDialog.addEventListener("click", function (ev) {
      if (ev.target !== els.joinDialog) return;
      var r = els.joinDialog.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) closeJoin();
    });
    document.getElementById("gachaCard").addEventListener("click", celebrate("blue"));
    els.prizeDialogClose.addEventListener("click", closePrize);
    // A tap on the dimmed backdrop (outside the dialog box) closes it too.
    els.prizeDialog.addEventListener("click", function (ev) {
      if (ev.target !== els.prizeDialog) return;
      var r = els.prizeDialog.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) closePrize();
    });
    watchJoinButton();
    els.duprWarn.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-edit]");
      if (b) editEntryById(b.getAttribute("data-edit"));
    });
    els.climber.addEventListener("click", function () {
      expandedId = els.climber.getAttribute("data-pod");
      render();
      scrollToRow(expandedId);
    });
    els.statsRefreshBtn.addEventListener("click", loadVisits);
    els.statsLinks.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-copy-src]");
      if (!b) return;
      var src = b.getAttribute("data-copy-src");
      copyLink(playerViewUrl(src), VISIT_SOURCES[src] + " link copied");
    });
    els.eventsList.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-cal-toggle], [data-ical], [data-ev-edit], [data-ev-del]");
      if (!b) return;
      if (b.hasAttribute("data-cal-toggle")) {
        var cid = b.getAttribute("data-cal-toggle");
        calOpenId = calOpenId === cid ? null : cid;
        render();
        var again = els.eventsList.querySelector('[data-cal-toggle="' + cid + '"]');
        if (again) again.focus();
      } else if (b.hasAttribute("data-ical")) addToCalendar(b.getAttribute("data-ical"));
      else if (b.hasAttribute("data-ev-edit")) { var e = findEvent(b.getAttribute("data-ev-edit")); if (e) fillEventForm(e); }
      else deleteEvent(b.getAttribute("data-ev-del"));
    });
    els.eventsEditBtn.addEventListener("click", function () {
      if (eventsEditing) { eventsEditing = false; resetEventForm(); render(); }
      else openEventsEditor();
    });
    els.menuEventsBtn.addEventListener("click", function () {
      if (usingCalendar()) window.open("https://calendar.google.com/calendar/r", "_blank", "noopener");
      else openEventsEditor();
    });
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
    els.shareBoardBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (!els.shareMenu.hidden) { setShareMenu(false); return; }
      shareBoard(false);
    });
    els.shareCopyBtn.addEventListener("click", function () {
      setShareMenu(false);
      copyLink(playerViewUrl("share"), "Leaderboard link copied");
    });
    els.shareWhatsApp.addEventListener("click", function () { setShareMenu(false); });
    document.addEventListener("click", function (ev) {
      if (!els.shareMenu.hidden && !els.shareWrap.contains(ev.target)) setShareMenu(false);
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !els.shareMenu.hidden) { setShareMenu(false); els.shareBoardBtn.focus(); }
    });
    els.menuShareBtn.addEventListener("click", function () { shareBoard(true); });
    els.storyBtn.addEventListener("click", openStory);
    els.storyShareBtn.addEventListener("click", shareStory);
    els.storySaveBtn.addEventListener("click", saveStory);
    els.storyCopyBtn.addEventListener("click", function () { copyLink(playerViewUrl("story"), "Link copied. Paste it into the Link sticker."); });
    els.storyCloseBtn.addEventListener("click", function () { els.storyCard.hidden = true; });
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
    render();
    connect();
    setTimeout(function () { if (!boardLoaded) { boardLoaded = true; render(); } }, 10000);
    // Keep the "Updated N minutes ago" text fresh without a full re-render.
    setInterval(updateLastUpdatedText, 30000);
    var lastPhase = phase();
    setInterval(function () {
      var now = phase();
      if (now !== lastPhase) { lastPhase = now; render(); }
      else if (!els.launchCard.hidden) updateLaunchCount();
    }, 30000);
    setInterval(function () { if (usingCalendar()) fetchCalendar(true); }, 10 * 60 * 1000);
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
