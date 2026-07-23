/* Trip Planner — a fun, beachy vacation planner.
   Track name, dates, flights, hotels, itinerary, ticketed events, reservations
   and an itemized budget for EVERY trip. Add as many trips as you like — each
   one is its own copy of the same reusable template.

   All data lives in localStorage on this device. "Back up all trips" exports a
   JSON file you can restore anywhere. No framework, no build step, no server. */
(function () {
  "use strict";

  // ---- Storage -------------------------------------------------------------
  // ONE stable key. New fields are handled by merging with defaults on load,
  // never by renaming the key (renaming wipes data).
  var STORE_KEY = "trip-planner";
  var THEME_KEY = "trip-planner:theme";

  // Budget categories: [emoji, label]. Used for the category picker + grouping.
  var CATS = {
    flights:  ["✈️", "Flights"],
    lodging:  ["🏨", "Lodging"],
    food:     ["🍽️", "Food & Drink"],
    activity: ["🎟️", "Activities"],
    transport:["🚗", "Transport"],
    shopping: ["🛍️", "Shopping"],
    other:    ["💸", "Other"],
  };

  // Itinerary entry types (covers activities, reservations, ticketed events…).
  var PLAN_TYPES = {
    activity:   ["🏖️", "Activity"],
    ticket:     ["🎟️", "Ticketed event"],
    reservation:["🍽️", "Reservation"],
    transport:  ["🚗", "Transport"],
    note:       ["📌", "Note"],
  };

  var COVER_EMOJIS = ["🏖️","🌴","🏝️","⛱️","🌊","☀️","🐚","🍹","✈️","🗺️","⛰️","🏔️","🎿","🏙️","🗽","🎡","🛳️","🏕️","🌋","🦩"];

  // ---- State ---------------------------------------------------------------
  var state = load();
  var saveTimer = null;

  function uid() {
    // Time-free unique id (Date.now avoided for determinism isn't needed here,
    // but keep it simple & collision-safe with a counter fallback).
    uid._n = (uid._n || 0) + 1;
    return "id" + Date.now().toString(36) + uid._n.toString(36) +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  function blankTrip(name) {
    return {
      id: uid(),
      name: name || "My Getaway",
      destination: "",
      startDate: "",
      endDate: "",
      coverEmoji: "🏖️",
      budgetCap: "",
      flights: [],   // {id,label,airline,flightNo,from,to,depart,arrive,confirmation,seat,cost}
      hotels: [],    // {id,name,checkIn,checkOut,address,confirmation,cost,notes}
      plans: [],     // {id,date,time,type,title,location,confirmation,cost,notes}
      budget: [],    // {id,cat,label,planned,actual,paid,src}
      notes: "",
    };
  }

  function starterTrip() {
    // A friendly first trip so the app isn't empty on first open.
    var t = blankTrip("My Beach Getaway 🌴");
    t.destination = "";
    t.coverEmoji = "🏖️";
    return t;
  }

  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { raw = null; }
    if (!raw || !Array.isArray(raw.trips) || !raw.trips.length) {
      var t = starterTrip();
      return { trips: [t], activeId: t.id };
    }
    // Merge each trip with defaults so older saves gain new fields safely.
    raw.trips = raw.trips.map(function (t) {
      var base = blankTrip();
      var merged = Object.assign(base, t);
      ["flights", "hotels", "plans", "budget"].forEach(function (k) {
        if (!Array.isArray(merged[k])) merged[k] = [];
      });
      return merged;
    });
    if (!raw.activeId || !raw.trips.some(function (t) { return t.id === raw.activeId; })) {
      raw.activeId = raw.trips[0].id;
    }
    return raw;
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  // Immediate, un-debounced write — for structural changes (add/remove trips)
  // and page-hide, where a debounce could lose data if the tab closes first.
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function activeTrip() {
    return state.trips.find(function (t) { return t.id === state.activeId; }) || state.trips[0];
  }

  // ---- Helpers -------------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function money(v) {
    var n = num(v);
    return "$" + n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  // Parse a yyyy-mm-dd string into a LOCAL date (avoids UTC off-by-one).
  function parseDate(s) {
    if (!s) return null;
    var p = String(s).split("-");
    if (p.length < 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d) ? null : d;
  }
  function fmtDate(s, opts) {
    var d = parseDate(s);
    if (!d) return "";
    return d.toLocaleDateString(undefined, opts || { month: "short", day: "numeric", year: "numeric" });
  }
  function daysBetween(a, b) {
    var d1 = parseDate(a), d2 = parseDate(b);
    if (!d1 || !d2) return 0;
    return Math.round((d2 - d1) / 86400000);
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  // ---- View state ----------------------------------------------------------
  var view = "overview";

  // =========================================================================
  //  RENDER
  // =========================================================================
  function renderAll() {
    renderTripSelect();
    renderHero();
    renderMain();
  }

  function renderTripSelect() {
    var sel = $("#tripSelect");
    sel.innerHTML = "";
    state.trips.forEach(function (t) {
      var o = el("option");
      o.value = t.id;
      o.textContent = (t.coverEmoji || "🏖️") + "  " + (t.name || "Untitled trip");
      if (t.id === state.activeId) o.selected = true;
      sel.appendChild(o);
    });
  }

  function renderHero() {
    var t = activeTrip();
    var hero = $("#hero");
    var nights = t.startDate && t.endDate ? Math.max(0, daysBetween(t.startDate, t.endDate)) : 0;
    var days = nights ? nights + 1 : (t.startDate ? 1 : 0);

    hero.innerHTML =
      '<div class="hero-top">' +
        '<button class="hero-emoji" id="coverEmojiBtn" title="Change icon" type="button">' + esc(t.coverEmoji || "🏖️") + '</button>' +
        '<div class="hero-fields">' +
          '<input class="hero-name" id="fName" placeholder="Name your trip…" value="' + esc(t.name) + '" />' +
          '<input class="hero-dest" id="fDest" placeholder="📍 Where are you headed?" value="' + esc(t.destination) + '" />' +
          '<div class="hero-dates">' +
            '<div class="hero-date"><label>Leaving</label><input type="date" id="fStart" value="' + esc(t.startDate) + '" /></div>' +
            '<div class="hero-date"><label>Coming home</label><input type="date" id="fEnd" value="' + esc(t.endDate) + '" /></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="hero-stats">' +
        '<div class="hero-stat"><b>' + (days || "—") + '</b><span>' + (days === 1 ? "day" : "days") + '</span></div>' +
        '<div class="hero-stat"><b>' + (nights || "—") + '</b><span>' + (nights === 1 ? "night" : "nights") + '</span></div>' +
        '<div class="hero-stat"><b>' + t.flights.length + '</b><span>flights</span></div>' +
        '<div class="hero-stat"><b>' + t.plans.length + '</b><span>plans</span></div>' +
      '</div>' +
      countdownHtml(t);

    // Emoji picker
    $("#coverEmojiBtn", hero).addEventListener("click", cycleEmoji);
    // Field bindings
    bindField($("#fName", hero), function (v) { t.name = v; renderTripSelect(); });
    bindField($("#fDest", hero), function (v) { t.destination = v; });
    bindField($("#fStart", hero), function (v) { t.startDate = v; renderHero(); if (view !== "overview") return; renderMain(); });
    bindField($("#fEnd", hero), function (v) { t.endDate = v; renderHero(); if (view === "itinerary" || view === "overview") renderMain(); });
  }

  function countdownHtml(t) {
    if (!t.startDate) return "";
    var toStart = daysBetween(todayStr(), t.startDate);
    var toEnd = t.endDate ? daysBetween(todayStr(), t.endDate) : toStart;
    var txt, emo;
    if (toStart > 1) { txt = toStart + " days to go!"; emo = "🧳"; }
    else if (toStart === 1) { txt = "Tomorrow — almost there!"; emo = "🎉"; }
    else if (toStart === 0) { txt = "It's trip day! Bon voyage!"; emo = "🌅"; }
    else if (toEnd >= 0) { txt = "You're on your trip — enjoy! 🍹"; emo = "🏖️"; }
    else { txt = "Trip complete. What a getaway!"; emo = "📸"; }
    return '<div class="countdown-chip"><span>' + emo + '</span> ' + esc(txt) + '</div>';
  }

  function cycleEmoji() {
    var t = activeTrip();
    var i = COVER_EMOJIS.indexOf(t.coverEmoji);
    t.coverEmoji = COVER_EMOJIS[(i + 1) % COVER_EMOJIS.length];
    save();
    $("#coverEmojiBtn").textContent = t.coverEmoji;
    renderTripSelect();
  }

  function renderMain() {
    var main = $("#main");
    main.innerHTML = "";
    if (view === "overview") main.appendChild(viewOverview());
    else if (view === "flights") main.appendChild(viewFlights());
    else if (view === "hotels") main.appendChild(viewHotels());
    else if (view === "itinerary") main.appendChild(viewItinerary());
    else if (view === "budget") main.appendChild(viewBudget());
    else if (view === "details") main.appendChild(viewDetails());
  }

  // ---- Generic field binding ----------------------------------------------
  // Updates state on input WITHOUT re-rendering (keeps focus). Optional cb runs
  // after each change for live totals / dependent UI.
  function bindField(node, setter) {
    if (!node) return;
    node.addEventListener("input", function () {
      setter(node.value);
      save();
    });
  }

  function sectionHead(title, hint, addLabel, onAdd) {
    var h = el("div", "section-head");
    h.appendChild(el("h2", null, esc(title)));
    if (addLabel) {
      var b = el("button", "add-btn", esc(addLabel));
      b.type = "button";
      b.addEventListener("click", onAdd);
      h.appendChild(b);
    }
    if (hint) h.appendChild(el("p", "hint", esc(hint)));
    return h;
  }

  function emptyState(emoji, text, btnLabel, onClick) {
    var e = el("div", "empty");
    e.innerHTML = '<span class="big">' + emoji + '</span><p>' + esc(text) + '</p>';
    if (btnLabel) {
      var b = el("button", "add-btn", esc(btnLabel));
      b.type = "button";
      b.addEventListener("click", onClick);
      e.appendChild(b);
    }
    return e;
  }

  function delBtn(onClick, label) {
    var b = el("button", "del-btn", "🗑️");
    b.type = "button";
    b.title = label || "Remove";
    b.setAttribute("aria-label", label || "Remove");
    b.addEventListener("click", onClick);
    return b;
  }

  // Build a labelled field. type: text|date|time|number|money|textarea|select
  function fld(label, value, onInput, opts) {
    opts = opts || {};
    var wrap = el("div", "field" + (opts.wide ? " wide" : ""));
    wrap.appendChild(el("label", null, esc(label)));
    var input;
    if (opts.type === "textarea") {
      input = el("textarea");
      input.value = value || "";
    } else if (opts.type === "select") {
      input = el("select");
      opts.options.forEach(function (o) {
        var op = el("option");
        op.value = o.value; op.textContent = o.label;
        if (o.value === value) op.selected = true;
        input.appendChild(op);
      });
    } else {
      input = el("input");
      input.type = opts.type === "money" ? "number" : (opts.type || "text");
      if (opts.type === "money") { input.step = "0.01"; input.min = "0"; input.inputMode = "decimal"; }
      if (opts.placeholder) input.placeholder = opts.placeholder;
      input.value = value == null ? "" : value;
    }
    input.addEventListener("input", function () { onInput(input.value); save(); });
    if (opts.type === "money") {
      var mw = el("div", "money-input");
      mw.appendChild(input);
      wrap.appendChild(mw);
    } else {
      wrap.appendChild(input);
    }
    return wrap;
  }

  // =========================================================================
  //  OVERVIEW
  // =========================================================================
  function viewOverview() {
    var t = activeTrip();
    var frag = document.createDocumentFragment();

    var committed = sumCosts(t);
    var plannedBudget = t.budget.reduce(function (s, b) { return s + num(b.planned); }, 0);
    var cap = num(t.budgetCap);
    var totalBudget = plannedBudget || committed.total;

    // Stat cards
    var grid = el("div", "ov-grid");
    grid.appendChild(ovCard("💰", money(totalBudget), plannedBudget ? "Planned budget" : "Booked so far"));
    grid.appendChild(ovCard("✈️", t.flights.length, t.flights.length === 1 ? "Flight" : "Flights"));
    grid.appendChild(ovCard("🏨", t.hotels.length, t.hotels.length === 1 ? "Hotel stay" : "Hotel stays"));
    grid.appendChild(ovCard("🎟️", t.plans.filter(function (p) { return p.type === "ticket" || p.type === "reservation"; }).length, "Bookings"));
    if (cap) {
      var pct = cap ? Math.min(100, Math.round((totalBudget / cap) * 100)) : 0;
      var c = ovCard("🎯", pct + "%", "of $" + cap.toLocaleString() + " budget");
      c.classList.add("accent");
      grid.appendChild(c);
    }
    frag.appendChild(grid);

    // Trip at a glance — flights + hotels quick list
    if (t.flights.length || t.hotels.length || t.plans.length) {
      frag.appendChild(el("div", "ov-summary-title", "🧳 Your trip at a glance"));
    }

    t.flights.forEach(function (f) {
      var route = (f.from || "?") + " → " + (f.to || "?");
      var sub = [f.airline, f.flightNo].filter(Boolean).join(" · ") || "Flight details";
      frag.appendChild(miniRow(f.label === "Return" ? "🛬" : "🛫", route, sub, f.depart ? fmtDateTime(f.depart) : "", f.cost ? money(f.cost) : ""));
    });
    t.hotels.forEach(function (h) {
      var nights = h.checkIn && h.checkOut ? daysBetween(h.checkIn, h.checkOut) : 0;
      var sub = (h.checkIn ? fmtDate(h.checkIn) : "—") + " → " + (h.checkOut ? fmtDate(h.checkOut) : "—") + (nights ? " · " + nights + (nights === 1 ? " night" : " nights") : "");
      frag.appendChild(miniRow("🏨", h.name || "Hotel", sub, "", h.cost ? money(h.cost) : ""));
    });

    if (!t.flights.length && !t.hotels.length && !t.plans.length) {
      frag.appendChild(emptyState("🗺️", "This trip is a blank canvas! Add your flights, hotels and plans to see them here.", "✈️ Start with flights", function () { setView("flights"); }));
    }

    return frag;
  }

  function ovCard(ico, big, label) {
    var c = el("div", "ov-card");
    c.innerHTML = '<div class="ico">' + ico + '</div><b>' + esc(big) + '</b><span>' + esc(label) + '</span>';
    return c;
  }
  function miniRow(ico, main, sub, val, val2) {
    var r = el("div", "mini-row");
    r.innerHTML =
      '<div class="mini-ico">' + ico + '</div>' +
      '<div class="mini-main"><b>' + esc(main) + '</b><span>' + esc(sub) + '</span></div>' +
      '<div class="mini-val">' + esc(val2 || "") + (val ? '<small>' + esc(val) + '</small>' : (val2 ? '' : '')) + '</div>';
    return r;
  }
  function fmtDateTime(s) {
    // s is a datetime-local value: yyyy-mm-ddThh:mm
    if (!s) return "";
    var parts = String(s).split("T");
    var d = fmtDate(parts[0], { month: "short", day: "numeric" });
    var time = parts[1] ? " · " + fmt12h(parts[1]) : "";
    return d + time;
  }
  function fmt12h(hm) {
    if (!hm) return "";
    var p = hm.split(":"); var h = +p[0]; var m = p[1];
    var ap = h >= 12 ? "PM" : "AM"; var h12 = h % 12 || 12;
    return h12 + ":" + m + " " + ap;
  }

  function sumCosts(t) {
    var f = t.flights.reduce(function (s, x) { return s + num(x.cost); }, 0);
    var h = t.hotels.reduce(function (s, x) { return s + num(x.cost); }, 0);
    var p = t.plans.reduce(function (s, x) { return s + num(x.cost); }, 0);
    return { flights: f, hotels: h, plans: p, total: f + h + p };
  }

  // =========================================================================
  //  FLIGHTS
  // =========================================================================
  function viewFlights() {
    var t = activeTrip();
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionHead("Flights", "Add your outbound and return flights — plus any connections. Flight numbers, seats and confirmation codes all in one place.", "+ Add flight", function () {
      t.flights.push({ id: uid(), label: t.flights.length === 0 ? "Outbound" : (t.flights.length === 1 ? "Return" : "Flight"), airline: "", flightNo: "", from: "", to: "", depart: "", arrive: "", confirmation: "", seat: "", cost: "" });
      save(); renderMain(); renderHero();
    }));

    if (!t.flights.length) {
      frag.appendChild(emptyState("🛫", "No flights yet. Add your first one to start the journey!", "+ Add flight", function () {
        t.flights.push({ id: uid(), label: "Outbound", airline: "", flightNo: "", from: "", to: "", depart: "", arrive: "", confirmation: "", seat: "", cost: "" });
        save(); renderMain(); renderHero();
      }));
      return frag;
    }

    t.flights.forEach(function (f) {
      var item = el("div", "item");
      var head = el("div", "item-head");
      head.innerHTML = '<span class="item-badge' + (f.label === "Return" ? " ret" : "") + '">' + esc(f.label || "Flight") + '</span>' +
        '<span class="item-title-mini">' + esc((f.from || "?") + " → " + (f.to || "?")) + '</span>';
      var d = delBtn(function () { removeFrom(t.flights, f.id); save(); renderMain(); renderHero(); }, "Remove flight");
      head.appendChild(d);
      item.appendChild(head);

      var grid = el("div", "grid");
      grid.appendChild(fld("Trip leg", f.label, function (v) { f.label = v; }, { type: "select", options: [
        { value: "Outbound", label: "Outbound ✈️" }, { value: "Return", label: "Return 🛬" }, { value: "Connection", label: "Connection" }, { value: "Flight", label: "Flight" }
      ]}));
      grid.appendChild(fld("Airline", f.airline, function (v) { f.airline = v; }, { placeholder: "e.g. Delta" }));
      grid.appendChild(fld("Flight #", f.flightNo, function (v) { f.flightNo = v; }, { placeholder: "e.g. DL 123" }));
      grid.appendChild(fld("From", f.from, function (v) { f.from = v; refreshMiniTitle(item, f); }, { placeholder: "Airport / city" }));
      grid.appendChild(fld("To", f.to, function (v) { f.to = v; refreshMiniTitle(item, f); }, { placeholder: "Airport / city" }));
      grid.appendChild(fld("Departs", f.depart, function (v) { f.depart = v; }, { type: "datetime-local" }));
      grid.appendChild(fld("Arrives", f.arrive, function (v) { f.arrive = v; }, { type: "datetime-local" }));
      grid.appendChild(fld("Seat", f.seat, function (v) { f.seat = v; }, { placeholder: "e.g. 14C" }));
      grid.appendChild(fld("Confirmation #", f.confirmation, function (v) { f.confirmation = v; }, { placeholder: "Booking code" }));
      grid.appendChild(fld("Cost", f.cost, function (v) { f.cost = v; }, { type: "money", placeholder: "0" }));
      item.appendChild(grid);
      frag.appendChild(item);
    });
    return frag;
  }

  function refreshMiniTitle(item, f) {
    var el2 = item.querySelector(".item-title-mini");
    if (el2) el2.textContent = (f.from || "?") + " → " + (f.to || "?");
  }

  // =========================================================================
  //  HOTELS
  // =========================================================================
  function viewHotels() {
    var t = activeTrip();
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionHead("Hotels & stays", "Where you're resting your head each night — check-in and check-out dates, address and confirmation.", "+ Add stay", function () {
      t.hotels.push({ id: uid(), name: "", checkIn: t.startDate || "", checkOut: t.endDate || "", address: "", confirmation: "", cost: "", notes: "" });
      save(); renderMain(); renderHero();
    }));

    if (!t.hotels.length) {
      frag.appendChild(emptyState("🏨", "No stays booked yet. Add a hotel, resort or rental!", "+ Add stay", function () {
        t.hotels.push({ id: uid(), name: "", checkIn: t.startDate || "", checkOut: t.endDate || "", address: "", confirmation: "", cost: "", notes: "" });
        save(); renderMain(); renderHero();
      }));
      return frag;
    }

    t.hotels.forEach(function (h) {
      var item = el("div", "item");
      var nights = h.checkIn && h.checkOut ? Math.max(0, daysBetween(h.checkIn, h.checkOut)) : 0;
      var head = el("div", "item-head");
      head.innerHTML = '<span class="type-pill">🏨</span>' +
        '<span class="item-title-mini">' + esc(h.name || "New stay") + (nights ? ' <span style="color:var(--muted);font-weight:600">· ' + nights + (nights === 1 ? " night" : " nights") + '</span>' : '') + '</span>';
      head.appendChild(delBtn(function () { removeFrom(t.hotels, h.id); save(); renderMain(); renderHero(); }, "Remove stay"));
      item.appendChild(head);

      var grid = el("div", "grid");
      grid.appendChild(fld("Hotel / place name", h.name, function (v) { h.name = v; var m = item.querySelector(".item-title-mini"); if (m && m.childNodes[0]) m.childNodes[0].nodeValue = (v || "New stay"); }, { wide: true, placeholder: "e.g. Sunset Beach Resort" }));
      grid.appendChild(fld("Check-in", h.checkIn, function (v) { h.checkIn = v; renderMain(); }, { type: "date" }));
      grid.appendChild(fld("Check-out", h.checkOut, function (v) { h.checkOut = v; renderMain(); }, { type: "date" }));
      grid.appendChild(fld("Confirmation #", h.confirmation, function (v) { h.confirmation = v; }, { placeholder: "Booking code" }));
      grid.appendChild(fld("Cost", h.cost, function (v) { h.cost = v; }, { type: "money", placeholder: "0" }));
      grid.appendChild(fld("Address", h.address, function (v) { h.address = v; }, { wide: true, placeholder: "Street, city" }));
      grid.appendChild(fld("Notes", h.notes, function (v) { h.notes = v; }, { wide: true, type: "textarea", placeholder: "Breakfast included? Late check-out? Room preferences…" }));
      item.appendChild(grid);
      frag.appendChild(item);
    });
    return frag;
  }

  // =========================================================================
  //  ITINERARY (activities, ticketed events, reservations)
  // =========================================================================
  function viewItinerary() {
    var t = activeTrip();
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionHead("Itinerary", "Every plan, ticketed event and reservation — organised by day. Add times so your days flow.", "+ Add plan", function () {
      addPlan(t);
    }));

    if (!t.plans.length) {
      frag.appendChild(emptyState("🗓️", "No plans yet. Add dinners, tours, tickets, spa days — anything you've booked or want to do!", "+ Add plan", function () { addPlan(t); }));
      return frag;
    }

    // Group plans by date (undated go last).
    var groups = {};
    var order = [];
    t.plans.forEach(function (p) {
      var key = p.date || "zzz-undated";
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(p);
    });
    order.sort();

    order.forEach(function (key) {
      var group = el("div", "day-group");
      var head = el("div", "day-head");
      if (key === "zzz-undated") {
        head.innerHTML = '<span class="d-date">📌 No date yet</span>';
      } else {
        var dayNo = t.startDate ? daysBetween(t.startDate, key) + 1 : null;
        var wk = fmtDate(key, { weekday: "long" });
        head.innerHTML =
          (dayNo && dayNo >= 1 ? '<span class="d-num">Day ' + dayNo + '</span>' : '') +
          '<span class="d-date">' + esc(fmtDate(key, { month: "short", day: "numeric" })) + '</span>' +
          '<span class="d-week">' + esc(wk) + '</span>';
      }
      group.appendChild(head);

      // Sort within a day by time.
      groups[key].sort(function (a, b) { return (a.time || "99").localeCompare(b.time || "99"); });
      groups[key].forEach(function (p) { group.appendChild(planItem(t, p)); });
      frag.appendChild(group);
    });

    return frag;
  }

  function addPlan(t) {
    t.plans.push({ id: uid(), date: t.startDate || "", time: "", type: "activity", title: "", location: "", confirmation: "", cost: "", notes: "" });
    save(); renderMain(); renderHero();
  }

  function planItem(t, p) {
    var item = el("div", "item plan-item");
    var head = el("div", "item-head");
    var pill = el("span", "type-pill");
    pill.textContent = (PLAN_TYPES[p.type] || PLAN_TYPES.activity)[0];
    head.appendChild(pill);
    var titleEl = el("span", "item-title-mini", esc(p.title || (PLAN_TYPES[p.type] || PLAN_TYPES.activity)[1]));
    head.appendChild(titleEl);
    head.appendChild(delBtn(function () { removeFrom(t.plans, p.id); save(); renderMain(); renderHero(); }, "Remove plan"));
    item.appendChild(head);

    var grid = el("div", "grid");
    grid.appendChild(fld("Type", p.type, function (v) { p.type = v; pill.textContent = (PLAN_TYPES[v] || PLAN_TYPES.activity)[0]; }, { type: "select", options: Object.keys(PLAN_TYPES).map(function (k) { return { value: k, label: PLAN_TYPES[k][0] + " " + PLAN_TYPES[k][1] }; }) }));
    grid.appendChild(fld("What", p.title, function (v) { p.title = v; titleEl.textContent = v || (PLAN_TYPES[p.type] || PLAN_TYPES.activity)[1]; }, { placeholder: "e.g. Snorkel tour, Dinner at…" }));
    grid.appendChild(fld("Date", p.date, function (v) { p.date = v; renderMain(); }, { type: "date" }));
    grid.appendChild(fld("Time", p.time, function (v) { p.time = v; }, { type: "time" }));
    grid.appendChild(fld("Location", p.location, function (v) { p.location = v; }, { placeholder: "Where" }));
    grid.appendChild(fld("Confirmation #", p.confirmation, function (v) { p.confirmation = v; }, { placeholder: "Booking / ticket #" }));
    grid.appendChild(fld("Cost", p.cost, function (v) { p.cost = v; }, { type: "money", placeholder: "0" }));
    grid.appendChild(fld("Notes", p.notes, function (v) { p.notes = v; }, { wide: true, type: "textarea", placeholder: "Dress code, meeting point, who's coming…" }));
    item.appendChild(grid);
    return item;
  }

  // =========================================================================
  //  BUDGET
  // =========================================================================
  function viewBudget() {
    var t = activeTrip();
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionHead("Budget", "Set an overall target, then itemise your spend. Track planned vs actual and tick off what's paid.", "+ Add item", function () {
      t.budget.push({ id: uid(), cat: "other", label: "", planned: "", actual: "", paid: false });
      save(); renderMain(); renderHero();
    }));

    // Overall cap + progress bar
    var capCard = el("div", "card budget-cap-card");
    capCard.appendChild(fld("Total trip budget", t.budgetCap, function (v) { t.budgetCap = v; updateBudgetBar(t); }, { type: "money", placeholder: "e.g. 3000" }));
    var barWrap = el("div", "budget-bar-wrap");
    barWrap.innerHTML =
      '<div class="budget-bar" id="budgetBar"><i></i></div>' +
      '<div class="budget-bar-legend"><span id="budgetSpent">$0 planned</span><span id="budgetLeft"></span></div>';
    capCard.appendChild(barWrap);
    frag.appendChild(capCard);

    // Suggestion card — pull costs from bookings
    var committed = sumCosts(t);
    if (committed.total > 0) {
      var sc = el("div", "card suggest-card");
      sc.innerHTML =
        '<div class="s-line">💡 From your bookings: ' +
        '<span>✈️ Flights <b>' + money(committed.flights) + '</b></span>' +
        '<span>🏨 Hotels <b>' + money(committed.hotels) + '</b></span>' +
        '<span>🎟️ Plans <b>' + money(committed.plans) + '</b></span>' +
        '</div>';
      var pull = el("button", "add-btn", "＋ Add these to budget");
      pull.type = "button";
      pull.addEventListener("click", function () { pullBookingCosts(t); });
      sc.appendChild(pull);
      frag.appendChild(sc);
    }

    if (!t.budget.length) {
      frag.appendChild(emptyState("💰", "No budget items yet. Add lines for flights, food, activities and more — or pull them from your bookings above.", "+ Add item", function () {
        t.budget.push({ id: uid(), cat: "other", label: "", planned: "", actual: "", paid: false });
        save(); renderMain(); renderHero();
      }));
      // Still show the bar behavior
      setTimeout(function () { updateBudgetBar(t); }, 0);
      return frag;
    }

    // Table
    var table = el("div", "card btable");
    var head = el("div", "brow head");
    head.innerHTML = '<div>Item</div><div class="r">Planned</div><div class="r actual-h">Actual</div><div class="r">Paid</div>';
    table.appendChild(head);

    t.budget.forEach(function (b) {
      var row = el("div", "brow");
      // Category + label
      var catCell = el("div", "cat");
      var catSel = el("select");
      Object.keys(CATS).forEach(function (k) {
        var o = el("option"); o.value = k; o.textContent = CATS[k][0];
        if (k === b.cat) o.selected = true;
        catSel.appendChild(o);
      });
      catSel.title = "Category";
      catSel.addEventListener("change", function () { b.cat = catSel.value; save(); });
      var labelInput = el("input");
      labelInput.type = "text";
      labelInput.placeholder = CATS[b.cat] ? CATS[b.cat][1] : "Item";
      labelInput.value = b.label || "";
      labelInput.addEventListener("input", function () { b.label = labelInput.value; save(); });
      catCell.appendChild(catSel);
      catCell.appendChild(labelInput);
      row.appendChild(catCell);

      // Planned
      row.appendChild(moneyCell(b.planned, function (v) { b.planned = v; updateBudgetBar(t); updateBudgetTotals(t, table); }));
      // Actual
      var actualCell = moneyCell(b.actual, function (v) { b.actual = v; updateBudgetTotals(t, table); });
      actualCell.classList.add("actual-cell");
      row.appendChild(actualCell);

      // Paid + delete
      var paidCell = el("div", "paid-cell");
      var chk = el("input"); chk.type = "checkbox"; chk.checked = !!b.paid; chk.title = "Paid";
      chk.addEventListener("change", function () { b.paid = chk.checked; save(); });
      paidCell.appendChild(chk);
      var dwrap = el("div"); dwrap.style.display = "flex"; dwrap.style.alignItems = "center"; dwrap.style.gap = "2px";
      dwrap.appendChild(paidCell);
      dwrap.appendChild(delBtn(function () { removeFrom(t.budget, b.id); save(); renderMain(); renderHero(); }, "Remove item"));
      row.appendChild(dwrap);

      table.appendChild(row);
    });

    // Totals row
    var totals = el("div", "btotal");
    totals.id = "budgetTotals";
    table.appendChild(totals);
    frag.appendChild(table);

    setTimeout(function () { updateBudgetBar(t); updateBudgetTotals(t, table); }, 0);
    return frag;
  }

  function moneyCell(value, onInput) {
    var cell = el("div", "amt");
    var inp = el("input");
    inp.type = "number"; inp.step = "0.01"; inp.min = "0"; inp.inputMode = "decimal";
    inp.placeholder = "0"; inp.value = value == null ? "" : value;
    inp.addEventListener("input", function () { onInput(inp.value); save(); });
    cell.appendChild(inp);
    return cell;
  }

  function updateBudgetTotals(t, table) {
    var planned = t.budget.reduce(function (s, b) { return s + num(b.planned); }, 0);
    var actual = t.budget.reduce(function (s, b) { return s + num(b.actual); }, 0);
    var paid = t.budget.reduce(function (s, b) { return s + (b.paid ? num(b.actual || b.planned) : 0); }, 0);
    var cap = num(t.budgetCap);
    var node = table.querySelector("#budgetTotals");
    if (!node) return;
    var diffCls = "", diffTxt = "";
    if (cap) {
      var diff = cap - planned;
      diffCls = diff < 0 ? "over" : "under";
      diffTxt = diff < 0 ? money(-diff) + " over budget" : money(diff) + " to spare";
    }
    node.innerHTML =
      '<div class="lbl">Totals' + (diffTxt ? ' · <span class="' + diffCls + '">' + esc(diffTxt) + '</span>' : '') + '</div>' +
      '<div class="r">' + money(planned) + '</div>' +
      '<div class="r actual-cell">' + money(actual) + '</div>' +
      '<div class="r" title="Paid so far">' + (paid ? "✅" : "—") + '</div>';
  }

  function updateBudgetBar(t) {
    var bar = document.getElementById("budgetBar");
    if (!bar) return;
    var planned = t.budget.reduce(function (s, b) { return s + num(b.planned); }, 0);
    var cap = num(t.budgetCap);
    var fill = bar.querySelector("i");
    var pct = cap ? Math.min(100, (planned / cap) * 100) : (planned ? 100 : 0);
    fill.style.width = pct + "%";
    bar.classList.toggle("over", cap && planned > cap);
    var spent = document.getElementById("budgetSpent");
    var left = document.getElementById("budgetLeft");
    if (spent) spent.textContent = money(planned) + " planned";
    if (left) {
      if (cap) left.textContent = planned > cap ? money(planned - cap) + " over" : money(cap - planned) + " left";
      else left.textContent = "Set a target →";
    }
  }

  function pullBookingCosts(t) {
    var committed = sumCosts(t);
    // Remove any previously auto-added lines so re-pulling stays idempotent.
    t.budget = t.budget.filter(function (b) { return b.src !== "auto"; });
    var lines = [
      { cat: "flights", label: "Flights (from bookings)", planned: committed.flights },
      { cat: "lodging", label: "Lodging (from bookings)", planned: committed.hotels },
      { cat: "activity", label: "Plans & tickets (from bookings)", planned: committed.plans },
    ].filter(function (l) { return l.planned > 0; });
    lines.forEach(function (l) {
      t.budget.push({ id: uid(), cat: l.cat, label: l.label, planned: l.planned, actual: "", paid: false, src: "auto" });
    });
    save(); renderMain(); renderHero();
    toast("Added " + lines.length + " line" + (lines.length === 1 ? "" : "s") + " from your bookings 💰");
  }

  // =========================================================================
  //  DETAILS
  // =========================================================================
  function viewDetails() {
    var t = activeTrip();
    var frag = document.createDocumentFragment();
    frag.appendChild(sectionHead("Important details", "Passport numbers, emergency contacts, packing list, currency, wifi codes — your trip's catch-all notebook.", null, null));
    var card = el("div", "card details-note");
    card.appendChild(fld("Notes", t.notes, function (v) { t.notes = v; }, { wide: true, type: "textarea", placeholder: "🛂 Passport expiry…\n📞 Emergency contact…\n🧴 Packing list…\n💱 Currency & budget notes…\n📶 Rental wifi / codes…" }));
    frag.appendChild(card);
    return frag;
  }

  // ---- Utilities -----------------------------------------------------------
  function removeFrom(arr, id) {
    var i = arr.findIndex(function (x) { return x.id === id; });
    if (i >= 0) arr.splice(i, 1);
  }

  function setView(v) {
    view = v;
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.classList.toggle("active", b.dataset.view === v);
    });
    renderMain();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // =========================================================================
  //  TRIP MANAGEMENT
  // =========================================================================
  function switchTrip(id) {
    state.activeId = id;
    saveNow();
    setView("overview");
    renderAll();
  }

  function newTrip() {
    var t = blankTrip("New Trip");
    state.trips.push(t);
    state.activeId = t.id;
    saveNow();
    setView("overview");
    renderAll();
    toast("New trip created — name it and go! ✈️");
    setTimeout(function () { var n = document.getElementById("fName"); if (n) { n.focus(); n.select(); } }, 50);
  }

  function duplicateTrip() {
    var t = activeTrip();
    var copy = JSON.parse(JSON.stringify(t));
    copy.id = uid();
    copy.name = (t.name || "Trip") + " (copy)";
    // Fresh ids for all nested items so edits don't collide.
    ["flights", "hotels", "plans", "budget"].forEach(function (k) {
      copy[k] = copy[k].map(function (x) { x.id = uid(); return x; });
    });
    state.trips.push(copy);
    state.activeId = copy.id;
    saveNow();
    closeMenu();
    setView("overview");
    renderAll();
    toast("Duplicated! Reuse it as your template 📑");
  }

  function deleteTrip() {
    if (state.trips.length <= 1) {
      // Never leave the app empty — reset the single trip instead.
      if (!confirm("This is your only trip. Clear it and start fresh?")) return;
      var fresh = blankTrip("New Trip");
      state.trips = [fresh];
      state.activeId = fresh.id;
    } else {
      var t = activeTrip();
      if (!confirm("Delete \"" + (t.name || "this trip") + "\"? This can't be undone.")) return;
      removeFrom(state.trips, t.id);
      state.activeId = state.trips[0].id;
    }
    saveNow();
    closeMenu();
    setView("overview");
    renderAll();
    toast("Trip deleted 🗑️");
  }

  // ---- Backup / restore ----------------------------------------------------
  function backup() {
    var data = JSON.stringify(state, null, 2);
    var blob = new Blob([data], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = el("a");
    a.href = url;
    a.download = "trip-planner-backup.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    menuMsg("Backup downloaded 💾");
  }

  function restore(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.trips) || !data.trips.length) throw new Error("bad");
        state = data;
        // Re-merge for safety.
        state = (function () {
          localStorage.setItem(STORE_KEY, JSON.stringify(data));
          return load();
        })();
        closeMenu();
        setView("overview");
        renderAll();
        toast("Restored " + state.trips.length + " trip" + (state.trips.length === 1 ? "" : "s") + " 🎉");
      } catch (e) {
        menuMsg("Hmm, that file didn't look like a Trip Planner backup.");
      }
    };
    reader.readAsText(file);
  }

  function menuMsg(m) { var n = $("#menuMsg"); if (n) n.textContent = m; }

  // ---- Theme ---------------------------------------------------------------
  function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", mode === "dark" ? "#071a20" : "#0891b2");
    var btn = $("#themeToggle");
    if (btn) btn.textContent = mode === "dark" ? "☀️ Light mode" : "🌙 Dark mode";
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    var next = cur === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyTheme(next);
  }

  // ---- Menu ----------------------------------------------------------------
  function toggleMenu() {
    var p = $("#menuPanel"), btn = $("#menuBtn");
    var open = p.hidden;
    p.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) menuMsg("");
  }
  function closeMenu() {
    $("#menuPanel").hidden = true;
    $("#menuBtn").setAttribute("aria-expanded", "false");
  }

  // =========================================================================
  //  WIRE UP
  // =========================================================================
  function init() {
    // Theme
    var savedTheme = null;
    try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
    applyTheme(savedTheme === "dark" ? "dark" : "light");

    // Tabs
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.addEventListener("click", function () { setView(b.dataset.view); });
    });

    // Trip switcher + buttons
    $("#tripSelect").addEventListener("change", function (e) { switchTrip(e.target.value); });
    $("#newTripBtn").addEventListener("click", newTrip);
    $("#menuBtn").addEventListener("click", toggleMenu);
    $("#duplicateTrip").addEventListener("click", duplicateTrip);
    $("#deleteTrip").addEventListener("click", deleteTrip);
    $("#saveFile").addEventListener("click", backup);
    $("#printBtn").addEventListener("click", function () { window.print(); });
    $("#themeToggle").addEventListener("click", toggleTheme);
    $("#loadData").addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) restore(e.target.files[0]);
      e.target.value = "";
    });

    // Flush any pending debounced save before the tab is hidden/closed so
    // last-second edits are never lost.
    window.addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") saveNow();
    });

    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
