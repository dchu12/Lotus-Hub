/* Coach Console — Lotus Pickleball Academy.
   Schedule lessons, track students & their DUPR goals, keep a drill library,
   and see who still owes you. All data lives in localStorage on this device.
   "Back up everything" exports a JSON file you can restore anywhere.
   No framework, no build step, no server. */
(function () {
  "use strict";

  // ---- Storage -------------------------------------------------------------
  // ONE stable key. New fields are handled by merging with defaults on load,
  // never by renaming the key (renaming wipes data).
  var STORE_KEY = "lotus-coach";
  var THEME_KEY = "lotus-coach:theme";

  var LEVELS = ["Beginner", "2.5", "3.0", "3.5", "4.0", "4.5+", "Junior"];

  // Lesson types: [emoji, label].
  var LESSON_TYPES = {
    private:  ["👤", "Private"],
    semi:     ["👥", "Semi-private"],
    group:    ["👨‍👩‍👧", "Group"],
    clinic:   ["🏟️", "Clinic"],
    assess:   ["📋", "Assessment"],
  };

  // Drill categories: [emoji, label].
  var DRILL_CATS = {
    dinks:    ["🪶", "Dinks & soft game"],
    drives:   ["💥", "Drives & power"],
    thirds:   ["🎯", "Third shot"],
    serves:   ["🏓", "Serve & return"],
    volleys:  ["🖐️", "Volleys & hands"],
    footwork: ["👟", "Footwork"],
    strategy: ["🧠", "Strategy & games"],
  };

  var AVATAR_COLORS = ["#c01f2c", "#0f9d58", "#f5b301", "#2563eb", "#8b5cf6", "#db2777", "#0891b2", "#ea580c"];

  // ---- State ---------------------------------------------------------------
  var state = load();
  var view = "schedule";
  var scheduleFilter = "upcoming"; // upcoming | past | all
  var saveTimer = null;

  function uid() {
    uid._n = (uid._n || 0) + 1;
    return "id" + Date.now().toString(36) + uid._n.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function defaults() {
    return {
      settings: { coach: "", currency: "$", price: 60 },
      students: [], // {id,name,phone,email,level,duprNow,duprGoal,goals,color}
      lessons:  [], // {id,studentId,date,time,dur,type,focus,drills:[id],price,paid}
      drills:   [], // {id,name,cat,desc}
    };
  }

  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { raw = null; }
    var base = defaults();
    if (!raw || typeof raw !== "object") return base;
    var merged = Object.assign(base, raw);
    merged.settings = Object.assign(defaults().settings, raw.settings || {});
    ["students", "lessons", "drills"].forEach(function (k) {
      if (!Array.isArray(merged[k])) merged[k] = [];
    });
    return merged;
  }

  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---- Helpers -------------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function cur() { return state.settings.currency || "$"; }
  function money(n) {
    n = Number(n) || 0;
    var s = Math.round(n).toLocaleString("en-US");
    return cur() + s;
  }
  function initials(name) {
    var p = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "?";
    if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
    return (p[0][0] + p[p.length - 1][0]).toUpperCase();
  }
  function studentById(id) { return state.students.find(function (s) { return s.id === id; }); }
  function drillById(id) { return state.drills.find(function (d) { return d.id === id; }); }
  function studentName(id) { var s = studentById(id); return s ? s.name : "Unknown"; }

  // Dates. Lessons store date "YYYY-MM-DD" + time "HH:MM" (24h).
  function lessonWhen(l) {
    if (!l.date) return null;
    var d = new Date(l.date + "T" + (l.time || "00:00"));
    return isNaN(d.getTime()) ? null : d;
  }
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function fmtDay(dateStr) {
    var d = new Date(dateStr + "T00:00");
    if (isNaN(d.getTime())) return dateStr || "No date";
    var today = startOfToday();
    var diff = Math.round((new Date(dateStr + "T00:00") - today) / 86400000);
    var wk = d.toLocaleDateString(undefined, { weekday: "short" });
    var md = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    var rel = "";
    if (diff === 0) rel = "Today";
    else if (diff === 1) rel = "Tomorrow";
    else if (diff === -1) rel = "Yesterday";
    else if (diff > 1 && diff < 7) rel = "In " + diff + " days";
    return { head: wk + ", " + md, rel: rel };
  }
  function fmtTime(t) {
    if (!t) return { t: "—", ampm: "" };
    var parts = t.split(":"); var h = parseInt(parts[0], 10); var m = parts[1] || "00";
    var ampm = h < 12 ? "AM" : "PM"; var h12 = h % 12; if (h12 === 0) h12 = 12;
    return { t: h12 + ":" + m, ampm: ampm };
  }
  function todayISO() {
    var d = new Date(); var mm = String(d.getMonth() + 1).padStart(2, "0"); var dd = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mm + "-" + dd;
  }

  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.hidden = false;
    requestAnimationFrame(function () { t.classList.add("show"); });
    clearTimeout(toast._t); toast._t = setTimeout(function () {
      t.classList.remove("show"); setTimeout(function () { t.hidden = true; }, 250);
    }, 2200);
  }

  // ---- Dashboard -----------------------------------------------------------
  function renderDash() {
    var now = new Date();
    var upcoming = state.lessons
      .map(function (l) { return { l: l, d: lessonWhen(l) }; })
      .filter(function (x) { return x.d && x.d >= now; })
      .sort(function (a, b) { return a.d - b.d; });

    var next = upcoming[0];
    var weekEnd = new Date(now.getTime() + 7 * 86400000);
    var thisWeek = upcoming.filter(function (x) { return x.d <= weekEnd; }).length;
    var owed = state.lessons.reduce(function (sum, l) {
      var d = lessonWhen(l);
      var isPast = d ? d < now : true;
      return sum + (!l.paid && isPast ? (Number(l.price) || 0) : 0);
    }, 0);

    var heroHtml;
    if (next) {
      var day = fmtDay(next.l.date); var tm = fmtTime(next.l.time);
      var lbl = (typeof day === "object" ? day.head : day);
      heroHtml =
        '<div class="stat hero">' +
          '<span class="big">📅</span>' +
          '<div><div class="k">Next lesson</div>' +
          '<div class="v">' + esc(studentName(next.l.studentId)) + ' · ' + esc(lbl) + ' at ' + tm.t + ' ' + tm.ampm + '</div>' +
          '<div class="s">' + esc(next.l.focus || (LESSON_TYPES[next.l.type] ? LESSON_TYPES[next.l.type][1] : "Lesson")) + '</div></div>' +
        '</div>';
    } else {
      heroHtml =
        '<div class="stat hero">' +
          '<span class="big">🎯</span>' +
          '<div><div class="k">Next lesson</div>' +
          '<div class="v">Nothing scheduled</div>' +
          '<div class="s">Tap “＋ Add” to book a lesson</div></div>' +
        '</div>';
    }

    $("#dash").innerHTML =
      heroHtml +
      '<div class="stat"><div class="k">This week</div><div class="v">' + thisWeek + '</div><div class="s">lesson' + (thisWeek === 1 ? "" : "s") + ' in 7 days</div></div>' +
      '<div class="stat"><div class="k">Students</div><div class="v">' + state.students.length + '</div><div class="s">on your roster</div></div>' +
      '<div class="stat' + (owed > 0 ? ' warn-tint' : '') + '"><div class="k">Outstanding</div><div class="v">' + money(owed) + '</div><div class="s">unpaid, past lessons</div></div>';
  }

  // ---- Views ---------------------------------------------------------------
  function render() {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.view === view);
    });
    renderDash();
    var main = $("#main");
    if (view === "schedule") main.innerHTML = viewSchedule();
    else if (view === "students") main.innerHTML = viewStudents();
    else if (view === "drills") main.innerHTML = viewDrills();
    else if (view === "money") main.innerHTML = viewMoney();
  }

  function emptyState(emoji, text, cta) {
    return '<div class="empty"><div class="em">' + emoji + '</div><p>' + esc(text) + '</p>' +
      (cta ? '<button class="btn primary" data-add="' + cta + '">＋ ' + (cta === "lesson" ? "Book a lesson" : cta === "student" ? "Add a student" : "Add a drill") + '</button>' : '') +
      '</div>';
  }

  function viewSchedule() {
    var now = new Date();
    var items = state.lessons.map(function (l) { return { l: l, d: lessonWhen(l) }; });
    var filtered = items.filter(function (x) {
      if (scheduleFilter === "all") return true;
      if (!x.d) return scheduleFilter === "upcoming"; // undated shows under upcoming
      return scheduleFilter === "upcoming" ? x.d >= startOfToday() : x.d < startOfToday();
    });

    var head =
      '<div class="section-hd"><h2>Schedule</h2>' +
      '<div class="seg" data-seg="schedule">' +
        '<button data-f="upcoming" class="' + (scheduleFilter === "upcoming" ? "active" : "") + '">Upcoming</button>' +
        '<button data-f="past" class="' + (scheduleFilter === "past" ? "active" : "") + '">Past</button>' +
        '<button data-f="all" class="' + (scheduleFilter === "all" ? "active" : "") + '">All</button>' +
      '</div></div>';

    if (!filtered.length) {
      if (!state.lessons.length) return head + emptyState("📅", "No lessons yet. Book your first one.", "lesson");
      return head + '<div class="empty"><div class="em">🗓️</div><p>No ' + scheduleFilter + ' lessons.</p></div>';
    }

    // Sort: upcoming ascending, past/all descending (most recent first).
    filtered.sort(function (a, b) {
      var av = a.d ? a.d.getTime() : Infinity, bv = b.d ? b.d.getTime() : Infinity;
      return scheduleFilter === "upcoming" ? av - bv : bv - av;
    });

    // Group by date.
    var groups = {}, order = [];
    filtered.forEach(function (x) {
      var key = x.l.date || "nodate";
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(x.l);
    });

    var html = head;
    order.forEach(function (key) {
      var day = key === "nodate" ? { head: "No date set", rel: "" } : fmtDay(key);
      html += '<div class="day-group"><div class="day-label">' + esc(day.head) +
        (day.rel ? '<span class="pill">' + esc(day.rel) + '</span>' : '') + '</div>';
      groups[key].forEach(function (l) { html += lessonRow(l, now); });
      html += '</div>';
    });
    return html;
  }

  function lessonRow(l, now) {
    var tm = fmtTime(l.time);
    var d = lessonWhen(l);
    var isPast = d ? d < now : false;
    var type = LESSON_TYPES[l.type] || ["🏓", "Lesson"];
    var drillChips = (l.drills || []).map(function (id) {
      var dr = drillById(id); return dr ? '<span class="chip">' + esc(dr.name) + '</span>' : "";
    }).join("");
    var payTag = l.paid
      ? '<span class="tag paid">Paid</span>'
      : (isPast ? '<span class="tag due">Unpaid</span>' : '');
    return '<div class="row" data-id="' + l.id + '">' +
      '<div class="when"><div class="t">' + tm.t + '</div><div class="ampm">' + tm.ampm + '</div></div>' +
      '<div class="body">' +
        '<div class="title">' + esc(studentName(l.studentId)) +
          ' <span class="tag type">' + type[0] + ' ' + esc(type[1]) + '</span>' + payTag + '</div>' +
        '<div class="meta">' + (l.dur ? esc(l.dur) + ' min' : "") + '</div>' +
        (l.focus ? '<div class="focus">' + esc(l.focus) + '</div>' : "") +
        (drillChips ? '<div class="chips">' + drillChips + '</div>' : "") +
        '<div class="row-actions">' +
          '<button class="mini" data-edit-lesson="' + l.id + '">Edit</button>' +
          '<button class="mini" data-toggle-paid="' + l.id + '">' + (l.paid ? "Mark unpaid" : "Mark paid") + '</button>' +
          '<button class="mini danger" data-del-lesson="' + l.id + '">Delete</button>' +
        '</div>' +
      '</div>' +
      '<div class="end"><div class="price">' + money(l.price) + '</div></div>' +
    '</div>';
  }

  function viewStudents() {
    var head = '<div class="section-hd"><h2>Students</h2><button class="btn sm primary" data-add="student">＋ Student</button></div>';
    if (!state.students.length) return head + emptyState("🧑‍🎓", "No students yet. Add your first player.", "student");

    var sorted = state.students.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var cards = sorted.map(function (s) {
      var color = s.color || AVATAR_COLORS[0];
      var nLessons = state.lessons.filter(function (l) { return l.studentId === s.id; }).length;
      var now = Number(s.duprNow), goal = Number(s.duprGoal);
      var duprHtml = "";
      if (s.duprNow) {
        var pct = 0;
        if (goal && goal > now) {
          // Progress from a 2.0 floor toward the goal.
          var floor = Math.min(now, 2.0);
          pct = Math.max(6, Math.min(100, Math.round(((now - floor) / (goal - floor)) * 100)));
        } else { pct = 100; }
        duprHtml = '<div class="dupr"><div class="nums"><span>DUPR <b>' + esc(s.duprNow) + '</b></span>' +
          (s.duprGoal ? '<span>goal ' + esc(s.duprGoal) + '</span>' : '') + '</div>' +
          '<div class="bar"><span style="width:' + pct + '%"></span></div></div>';
      }
      return '<div class="pcard" data-id="' + s.id + '">' +
        '<div class="top">' +
          '<span class="avatar" style="background:' + color + '">' + esc(initials(s.name)) + '</span>' +
          '<div><div class="name">' + esc(s.name) + '</div>' +
            '<div class="sub">' + (s.level ? '<span class="tag lvl">' + esc(s.level) + '</span> ' : '') +
            (s.phone ? esc(s.phone) : (s.email ? esc(s.email) : '')) + '</div></div>' +
        '</div>' +
        duprHtml +
        (s.goals ? '<div class="goals">🎯 ' + esc(s.goals) + '</div>' : '') +
        '<div class="foot"><span class="lessons-n">' + nLessons + ' lesson' + (nLessons === 1 ? "" : "s") + '</span>' +
          '<span><button class="mini" data-book="' + s.id + '">Book</button> ' +
          '<button class="mini" data-edit-student="' + s.id + '">Edit</button> ' +
          '<button class="mini danger" data-del-student="' + s.id + '">✕</button></span>' +
        '</div>' +
      '</div>';
    }).join("");
    return head + '<div class="grid-cards">' + cards + '</div>';
  }

  function viewDrills() {
    var head = '<div class="section-hd"><h2>Drill library</h2><button class="btn sm primary" data-add="drill">＋ Drill</button></div>';
    if (!state.drills.length) return head + emptyState("🎯", "No drills yet. Build your library so you can drop them into lessons.", "drill");

    var byCat = {}, order = [];
    Object.keys(DRILL_CATS).forEach(function (c) { byCat[c] = []; });
    state.drills.forEach(function (d) { (byCat[d.cat] || (byCat[d.cat] = [])).push(d); });

    var html = head;
    Object.keys(DRILL_CATS).forEach(function (c) {
      var list = byCat[c]; if (!list || !list.length) return;
      var cat = DRILL_CATS[c];
      html += '<div class="day-group"><div class="day-label">' + cat[0] + ' ' + esc(cat[1]) + '</div>';
      list.forEach(function (d) {
        html += '<div class="row" data-id="' + d.id + '">' +
          '<div class="body"><div class="title">' + esc(d.name) + '</div>' +
            (d.desc ? '<div class="focus">' + esc(d.desc) + '</div>' : '') +
            '<div class="row-actions">' +
              '<button class="mini" data-edit-drill="' + d.id + '">Edit</button>' +
              '<button class="mini danger" data-del-drill="' + d.id + '">Delete</button>' +
            '</div>' +
          '</div></div>';
      });
      html += '</div>';
    });
    return html;
  }

  function viewMoney() {
    var now = new Date();
    var d0 = new Date(now.getFullYear(), now.getMonth(), 1);
    var earnedMonth = 0, earnedAll = 0, owed = 0;
    var owePer = {};
    state.lessons.forEach(function (l) {
      var price = Number(l.price) || 0;
      var d = lessonWhen(l);
      var isPast = d ? d < now : true;
      if (l.paid) {
        earnedAll += price;
        if (d && d >= d0 && d <= now) earnedMonth += price;
      } else if (isPast) {
        owed += price;
        owePer[l.studentId] = (owePer[l.studentId] || 0) + price;
      }
    });

    var monthName = now.toLocaleDateString(undefined, { month: "long" });
    var html =
      '<div class="section-hd"><h2>Money</h2></div>' +
      '<div class="dash" style="margin-bottom:16px">' +
        '<div class="stat"><div class="k">Earned in ' + esc(monthName) + '</div><div class="v">' + money(earnedMonth) + '</div><div class="s">paid lessons this month</div></div>' +
        '<div class="stat"><div class="k">Earned all-time</div><div class="v">' + money(earnedAll) + '</div><div class="s">across every paid lesson</div></div>' +
        '<div class="stat' + (owed > 0 ? ' warn-tint' : '') + '"><div class="k">Outstanding</div><div class="v">' + money(owed) + '</div><div class="s">unpaid past lessons</div></div>' +
      '</div>';

    var oweIds = Object.keys(owePer).sort(function (a, b) { return owePer[b] - owePer[a]; });
    html += '<div class="section-hd"><h2>Who owes you</h2></div>';
    if (!oweIds.length) {
      html += '<div class="empty"><div class="em">✅</div><p>All settled up — nothing outstanding.</p></div>';
    } else {
      html += '<div class="money-list">';
      oweIds.forEach(function (id) {
        html += '<div class="owe-row"><span>' + esc(studentName(id)) + '</span>' +
          '<span class="amt">' + money(owePer[id]) + '</span></div>';
      });
      html += '</div>';
    }
    return html;
  }

  // ---- Drawer (add / edit forms) ------------------------------------------
  var editing = null; // { kind, id }

  function openDrawer(kind, id, presetStudent) {
    editing = { kind: kind, id: id || null };
    var f = $("#drawerForm");
    var title = (id ? "Edit " : "Add ") + (kind === "lesson" ? "lesson" : kind === "student" ? "student" : "drill");
    $("#drawerTitle").textContent = title;
    if (kind === "lesson") f.innerHTML = lessonForm(id, presetStudent);
    else if (kind === "student") f.innerHTML = studentForm(id);
    else f.innerHTML = drillForm(id);
    $("#drawerRoot").hidden = false;
    document.body.style.overflow = "hidden";
    var first = f.querySelector("input, select, textarea");
    if (first) setTimeout(function () { first.focus(); }, 60);
  }
  function closeDrawer() {
    $("#drawerRoot").hidden = true; document.body.style.overflow = ""; editing = null;
  }

  function opt(list, sel) {
    return list.map(function (v) {
      var val = Array.isArray(v) ? v[0] : v, lbl = Array.isArray(v) ? v[1] : v;
      return '<option value="' + esc(val) + '"' + (val === sel ? " selected" : "") + '>' + esc(lbl) + '</option>';
    }).join("");
  }

  function lessonForm(id, presetStudent) {
    var l = id ? state.lessons.find(function (x) { return x.id === id; }) : null;
    l = l || { studentId: presetStudent || (state.students[0] && state.students[0].id) || "",
      date: todayISO(), time: "17:00", dur: 60, type: "private", focus: "", drills: [],
      price: state.settings.price, paid: false };

    var studentOpts = state.students.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === l.studentId ? " selected" : "") + '>' + esc(s.name) + '</option>';
    }).join("");
    studentOpts += '<option value="__new"' + (l.studentId === "__new" ? " selected" : "") + '>＋ New student…</option>';

    var typeChoices = Object.keys(LESSON_TYPES).map(function (k) {
      return '<button type="button" class="choice' + (k === l.type ? " active" : "") + '" data-type="' + k + '">' +
        LESSON_TYPES[k][0] + ' ' + LESSON_TYPES[k][1] + '</button>';
    }).join("");

    var drillPick = state.drills.length
      ? state.drills.map(function (d) {
          var on = (l.drills || []).indexOf(d.id) >= 0;
          return '<button type="button" class="choice' + (on ? " active" : "") + '" data-drill="' + d.id + '">' + esc(d.name) + '</button>';
        }).join("")
      : '<span class="menu-msg">No drills yet — add some in the Drills tab.</span>';

    return '' +
      '<label class="field"><span>Student</span><select name="studentId">' + studentOpts + '</select></label>' +
      '<label class="field" data-newname' + (l.studentId === "__new" ? "" : ' hidden') + ' style="margin-top:12px"><span>New student name</span><input name="newName" placeholder="Full name" /></label>' +
      '<div class="field-row" style="margin-top:12px">' +
        '<label class="field"><span>Date</span><input type="date" name="date" value="' + esc(l.date) + '" /></label>' +
        '<label class="field narrow"><span>Time</span><input type="time" name="time" value="' + esc(l.time) + '" /></label>' +
        '<label class="field narrow"><span>Minutes</span><input type="number" name="dur" min="0" step="15" value="' + esc(l.dur) + '" inputmode="numeric" /></label>' +
      '</div>' +
      '<label class="field"><span>Type</span></label>' +
      '<div class="choice-wrap" data-choice="type"><input type="hidden" name="type" value="' + esc(l.type) + '">' + typeChoices + '</div>' +
      '<label class="field" style="margin-top:14px"><span>Focus / notes</span><textarea name="focus" placeholder="e.g. Third-shot drops, resets off pace">' + esc(l.focus) + '</textarea></label>' +
      '<label class="field" style="margin-top:12px"><span>Drills</span></label>' +
      '<div class="drill-pick" data-choice="drills">' + drillPick + '</div>' +
      '<div class="field-row" style="margin-top:14px">' +
        '<label class="field narrow"><span>Price (' + esc(cur()) + ')</span><input type="number" name="price" min="0" step="5" value="' + esc(l.price) + '" inputmode="decimal" /></label>' +
        '<label class="field" style="justify-content:flex-end"><span>&nbsp;</span><label class="pay-toggle"><input type="checkbox" name="paid"' + (l.paid ? " checked" : "") + '> Paid</label></label>' +
      '</div>' +
      drawerActions(id, "lesson");
  }

  function studentForm(id) {
    var s = id ? studentById(id) : null;
    s = s || { name: "", phone: "", email: "", level: "", duprNow: "", duprGoal: "", goals: "" };
    return '' +
      '<label class="field"><span>Name</span><input name="name" value="' + esc(s.name) + '" placeholder="Full name" required /></label>' +
      '<div class="field-row" style="margin-top:12px">' +
        '<label class="field"><span>Phone</span><input name="phone" value="' + esc(s.phone) + '" placeholder="Optional" inputmode="tel" /></label>' +
        '<label class="field"><span>Email</span><input name="email" type="email" value="' + esc(s.email) + '" placeholder="Optional" /></label>' +
      '</div>' +
      '<div class="field-row">' +
        '<label class="field"><span>Level</span><select name="level"><option value="">—</option>' + opt(LEVELS, s.level) + '</select></label>' +
        '<label class="field narrow"><span>DUPR now</span><input name="duprNow" value="' + esc(s.duprNow) + '" placeholder="3.2" inputmode="decimal" /></label>' +
        '<label class="field narrow"><span>DUPR goal</span><input name="duprGoal" value="' + esc(s.duprGoal) + '" placeholder="3.5" inputmode="decimal" /></label>' +
      '</div>' +
      '<label class="field"><span>Goals / notes</span><textarea name="goals" placeholder="What they’re working toward">' + esc(s.goals) + '</textarea></label>' +
      drawerActions(id, "student");
  }

  function drillForm(id) {
    var d = id ? drillById(id) : null;
    d = d || { name: "", cat: "dinks", desc: "" };
    return '' +
      '<label class="field"><span>Drill name</span><input name="name" value="' + esc(d.name) + '" placeholder="e.g. Cross-court dink rally" required /></label>' +
      '<label class="field" style="margin-top:12px"><span>Category</span><select name="cat">' +
        Object.keys(DRILL_CATS).map(function (k) {
          return '<option value="' + k + '"' + (k === d.cat ? " selected" : "") + '>' + DRILL_CATS[k][0] + ' ' + DRILL_CATS[k][1] + '</option>';
        }).join("") + '</select></label>' +
      '<label class="field" style="margin-top:12px"><span>How it works</span><textarea name="desc" placeholder="Setup, reps, coaching cues">' + esc(d.desc) + '</textarea></label>' +
      drawerActions(id, "drill");
  }

  function drawerActions(id, kind) {
    return '<div class="drawer-actions">' +
      (id ? '<button type="button" class="btn danger" data-drawer-del="' + kind + ':' + id + '">Delete</button>' : '') +
      '<button type="submit" class="btn primary">' + (id ? "Save" : "Add") + '</button>' +
    '</div>';
  }

  function submitDrawer(e) {
    e.preventDefault();
    var f = e.target;
    var data = {};
    Array.prototype.forEach.call(f.elements, function (el) {
      if (!el.name) return;
      data[el.name] = el.type === "checkbox" ? el.checked : el.value;
    });

    if (editing.kind === "lesson") {
      var studentId = data.studentId;
      if (studentId === "__new") {
        var nm = (data.newName || "").trim();
        if (!nm) { toast("Enter the new student’s name"); return; }
        var ns = { id: uid(), name: nm, phone: "", email: "", level: "", duprNow: "", duprGoal: "", goals: "",
          color: AVATAR_COLORS[state.students.length % AVATAR_COLORS.length] };
        state.students.push(ns); studentId = ns.id;
      }
      if (!studentId) { toast("Add a student first"); return; }
      var picked = Array.prototype.map.call(f.querySelectorAll('[data-drill].active'), function (b) { return b.dataset.drill; });
      var rec = { studentId: studentId, date: data.date, time: data.time, dur: data.dur,
        type: data.type, focus: (data.focus || "").trim(), drills: picked,
        price: data.price === "" ? 0 : Number(data.price), paid: !!data.paid };
      upsert("lessons", rec);
      toast(editing.id ? "Lesson updated" : "Lesson booked");
    } else if (editing.kind === "student") {
      if (!(data.name || "").trim()) { toast("Name is required"); return; }
      var srec = { name: data.name.trim(), phone: (data.phone || "").trim(), email: (data.email || "").trim(),
        level: data.level, duprNow: (data.duprNow || "").trim(), duprGoal: (data.duprGoal || "").trim(),
        goals: (data.goals || "").trim() };
      if (!editing.id) srec.color = AVATAR_COLORS[state.students.length % AVATAR_COLORS.length];
      upsert("students", srec);
      toast(editing.id ? "Student updated" : "Student added");
    } else if (editing.kind === "drill") {
      if (!(data.name || "").trim()) { toast("Name is required"); return; }
      upsert("drills", { name: data.name.trim(), cat: data.cat, desc: (data.desc || "").trim() });
      toast(editing.id ? "Drill updated" : "Drill added");
    }
    saveNow(); closeDrawer(); render();
  }

  function upsert(coll, rec) {
    if (editing.id) {
      var i = state[coll].findIndex(function (x) { return x.id === editing.id; });
      if (i >= 0) state[coll][i] = Object.assign(state[coll][i], rec);
    } else {
      rec.id = uid(); state[coll].push(rec);
    }
  }

  function removeById(coll, id) {
    state[coll] = state[coll].filter(function (x) { return x.id !== id; });
    if (coll === "students") {
      // Keep lessons but they'll show "Unknown" — safer than silently deleting history.
    }
  }

  // ---- Events --------------------------------------------------------------
  document.addEventListener("click", function (e) {
    var t = e.target;
    var close = t.closest("[data-close]"); if (close) { closeDrawer(); return; }

    // Tabs
    var tab = t.closest(".tab");
    if (tab) { view = tab.dataset.view; render(); return; }

    // Schedule filter segment
    var seg = t.closest("[data-seg] button");
    if (seg) { scheduleFilter = seg.dataset.f; render(); return; }

    // Add buttons (header + empty states + section headers)
    if (t.id === "addBtn" || t.closest("#addBtn")) { openDrawer(defaultAddKind()); return; }
    var addKind = t.closest("[data-add]");
    if (addKind) { openDrawer(addKind.dataset.add); return; }

    // Type choice / drill toggles inside drawer
    var typeBtn = t.closest('[data-choice="type"] [data-type]');
    if (typeBtn) {
      typeBtn.parentNode.querySelectorAll(".choice").forEach(function (b) { b.classList.remove("active"); });
      typeBtn.classList.add("active");
      typeBtn.parentNode.querySelector('input[name="type"]').value = typeBtn.dataset.type;
      return;
    }
    var drillBtn = t.closest('[data-choice="drills"] [data-drill]');
    if (drillBtn) { drillBtn.classList.toggle("active"); return; }

    // Lesson row actions
    var el;
    if ((el = t.closest("[data-edit-lesson]"))) { openDrawer("lesson", el.dataset.editLesson); return; }
    if ((el = t.closest("[data-toggle-paid]"))) {
      var lz = state.lessons.find(function (x) { return x.id === el.dataset.togglePaid; });
      if (lz) { lz.paid = !lz.paid; saveNow(); render(); toast(lz.paid ? "Marked paid" : "Marked unpaid"); }
      return;
    }
    if ((el = t.closest("[data-del-lesson]"))) {
      if (confirm("Delete this lesson?")) { removeById("lessons", el.dataset.delLesson); saveNow(); render(); toast("Lesson deleted"); }
      return;
    }
    // Student actions
    if ((el = t.closest("[data-book]"))) { openDrawer("lesson", null, el.dataset.book); return; }
    if ((el = t.closest("[data-edit-student]"))) { openDrawer("student", el.dataset.editStudent); return; }
    if ((el = t.closest("[data-del-student]"))) {
      var sN = studentById(el.dataset.delStudent);
      var lc = state.lessons.filter(function (x) { return x.studentId === el.dataset.delStudent; }).length;
      if (confirm("Remove " + (sN ? sN.name : "this student") + "?" + (lc ? "\nTheir " + lc + " lesson(s) stay in your history." : ""))) {
        removeById("students", el.dataset.delStudent); saveNow(); render(); toast("Student removed");
      }
      return;
    }
    // Drill actions
    if ((el = t.closest("[data-edit-drill]"))) { openDrawer("drill", el.dataset.editDrill); return; }
    if ((el = t.closest("[data-del-drill]"))) {
      if (confirm("Delete this drill?")) { removeById("drills", el.dataset.delDrill); saveNow(); render(); toast("Drill deleted"); }
      return;
    }
    // Delete from within drawer
    var dd = t.closest("[data-drawer-del]");
    if (dd) {
      var parts = dd.dataset.drawerDel.split(":"); var coll = parts[0] === "lesson" ? "lessons" : parts[0] === "student" ? "students" : "drills";
      if (confirm("Delete this " + parts[0] + "?")) { removeById(coll, parts[1]); saveNow(); closeDrawer(); render(); toast("Deleted"); }
      return;
    }
  });

  // Toggle the "new student name" field visibility inside the lesson drawer.
  document.addEventListener("change", function (e) {
    if (e.target.name === "studentId") {
      var wrap = e.target.closest("form").querySelector("[data-newname]");
      if (wrap) wrap.hidden = e.target.value !== "__new";
    }
  });

  $("#drawerForm").addEventListener("submit", submitDrawer);

  function defaultAddKind() {
    return view === "students" ? "student" : view === "drills" ? "drill" : "lesson";
  }

  // ---- Settings panel & data ----------------------------------------------
  function initSettings() {
    $("#setCoach").value = state.settings.coach || "";
    $("#setCurrency").value = state.settings.currency || "$";
    $("#setPrice").value = state.settings.price != null ? state.settings.price : "";
  }
  $("#gearBtn").addEventListener("click", function () {
    var p = $("#menuPanel"); var open = p.hidden;
    p.hidden = !open; this.setAttribute("aria-expanded", String(open));
  });
  ["setCoach", "setCurrency", "setPrice"].forEach(function (idn) {
    $("#" + idn).addEventListener("input", function () {
      state.settings.coach = $("#setCoach").value.trim();
      state.settings.currency = ($("#setCurrency").value.trim() || "$");
      var pr = parseFloat($("#setPrice").value); state.settings.price = isNaN(pr) ? 0 : pr;
      save(); renderDash();
      if (view === "money" || view === "schedule") render();
    });
  });

  $("#themeToggle").addEventListener("click", function () {
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    setTheme(dark ? "light" : "dark");
  });
  function setTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", mode === "dark" ? "#171213" : "#c01f2c");
    $("#themeToggle").textContent = mode === "dark" ? "☀️ Light mode" : "🌙 Dark mode";
  }

  $("#saveFile").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "lotus-coach-backup.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    $("#menuMsg").textContent = "Backed up all your data.";
  });
  $("#loadData").addEventListener("change", function (e) {
    var file = e.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || typeof data !== "object") throw new Error("bad");
        if (!confirm("Restore from this file? It replaces everything currently on this device.")) return;
        state = Object.assign(defaults(), data);
        state.settings = Object.assign(defaults().settings, data.settings || {});
        ["students", "lessons", "drills"].forEach(function (k) { if (!Array.isArray(state[k])) state[k] = []; });
        saveNow(); initSettings(); render();
        $("#menuMsg").textContent = "Restored from file.";
        toast("Data restored");
      } catch (err) { $("#menuMsg").textContent = "Couldn’t read that file."; }
    };
    reader.readAsText(file); e.target.value = "";
  });
  $("#printBtn").addEventListener("click", function () { window.print(); });
  $("#wipeBtn").addEventListener("click", function () {
    if (!confirm("Erase ALL students, lessons and drills on this device? This cannot be undone.")) return;
    state = defaults(); saveNow(); initSettings(); render(); toast("All data erased");
  });
  $("#seedBtn").addEventListener("click", function () {
    if (state.students.length || state.lessons.length || state.drills.length) {
      if (!confirm("Add sample students, drills and lessons alongside your data?")) return;
    }
    seedSample(); saveNow(); render(); toast("Sample data loaded");
    $("#menuPanel").hidden = true;
  });

  function seedSample() {
    var color = function (i) { return AVATAR_COLORS[i % AVATAR_COLORS.length]; };
    var s1 = { id: uid(), name: "Maya Chen", phone: "555-0148", email: "", level: "3.0", duprNow: "3.05", duprGoal: "3.5", goals: "Consistent third-shot drops; stop popping up dinks.", color: color(0) };
    var s2 = { id: uid(), name: "Derek Alvarez", phone: "", email: "derek@example.com", level: "3.5", duprNow: "3.6", duprGoal: "4.0", goals: "Speed-ups and hand battles at the kitchen.", color: color(1) };
    var s3 = { id: uid(), name: "Priya Nair", phone: "555-0199", email: "", level: "2.5", duprNow: "2.4", duprGoal: "3.0", goals: "Footwork and serve depth.", color: color(2) };
    state.students.push(s1, s2, s3);

    var d1 = { id: uid(), name: "Cross-court dink rally", cat: "dinks", desc: "Both players dink cross-court only. 20 in a row before switching lines." };
    var d2 = { id: uid(), name: "Third-shot drop ladder", cat: "thirds", desc: "Feed from baseline, aim to land in kitchen. Move up a step each 3 makes." };
    var d3 = { id: uid(), name: "Hands battle at the line", cat: "volleys", desc: "Fast hands from mid-kitchen. Reset when you lose control." };
    var d4 = { id: uid(), name: "Serve targets", cat: "serves", desc: "Deep corners, 10 serves each. Track make %." };
    state.drills.push(d1, d2, d3, d4);

    var iso = function (offsetDays) {
      var d = new Date(); d.setDate(d.getDate() + offsetDays);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    };
    state.lessons.push(
      { id: uid(), studentId: s1.id, date: iso(1), time: "17:00", dur: 60, type: "private", focus: "Third-shot consistency", drills: [d2.id], price: 60, paid: false },
      { id: uid(), studentId: s2.id, date: iso(2), time: "18:30", dur: 60, type: "private", focus: "Hands & speed-ups", drills: [d3.id], price: 65, paid: false },
      { id: uid(), studentId: s3.id, date: iso(4), time: "10:00", dur: 45, type: "semi", focus: "Footwork + serves", drills: [d4.id], price: 45, paid: false },
      { id: uid(), studentId: s1.id, date: iso(-3), time: "17:00", dur: 60, type: "private", focus: "Dinks", drills: [d1.id], price: 60, paid: true },
      { id: uid(), studentId: s2.id, date: iso(-6), time: "18:30", dur: 60, type: "private", focus: "Resets", drills: [], price: 65, paid: false }
    );
  }

  // ---- Boot ----------------------------------------------------------------
  function boot() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (!saved) saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(saved);
    initSettings();
    render();
    window.addEventListener("pagehide", saveNow);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("#drawerRoot").hidden) closeDrawer(); });
  }

  // If the access lock (lock.js) is present, hold the app until the owner is
  // signed in; otherwise boot immediately.
  if (window.__LOTUS_LOCK_ACTIVE && !window.__LOTUS_UNLOCKED) {
    window.addEventListener("lotus-unlocked", boot, { once: true });
  } else {
    boot();
  }

  // Register service worker for offline / installability.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
