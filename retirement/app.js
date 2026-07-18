/* Derek & Kelly · Retirement
   A plain-language, cash-flow retirement tracker. Everything is modeled and
   shown in TODAY'S DOLLARS (real terms): every rate is converted to a real
   rate, so contributions held flat are really "kept up with inflation," and
   there is no separate nominal/real toggle to confuse anyone.
     earn − spend = what you save each month
       → extra debt paydown, then split invest / cash
       → savings grow at real returns; debts pay down; freed payments re-split
       → compared against what you'll need = desired yearly spending ÷ 4%.
   All data stays in localStorage. */
(function () {
  "use strict";

  var STORE_KEY = "dk-retire:v5";
  var THEME_KEY = "dk-retire:theme";
  var THIS_YEAR = new Date().getFullYear();

  var TYPES = {
    investment: { label: "Investments", income: true },
    cash:       { label: "Cash / savings", income: true },
    realestate: { label: "Home / property", income: false },
    other:      { label: "Other asset", income: false },
  };
  var OWNERS = ["Derek", "Kelly", "Joint"];

  function defaults() {
    return {
      settings: {
        household: "Derek & Kelly",
        targetYear: THIS_YEAR + 22,
        targetIncome: 90000,
        rate: 6.0,
        inflation: 2.5,
        cashYield: 3.5,
        withdrawal: 4,
        investPct: 85,
        debtPaydown: 300,
      },
      incomes: [
        { id: "i1", name: "Derek — salary", amount: 7000, freq: "mo" },
        { id: "i2", name: "Kelly — salary", amount: 5500, freq: "mo" },
        { id: "i3", name: "Annual bonus", amount: 15000, freq: "yr" },
        { id: "i4", name: "Other income", amount: 250, freq: "mo" },
      ],
      fixed: [
        { id: "f1", name: "Utilities & phone", amount: 350, freq: "mo" },
        { id: "f2", name: "Insurance", amount: 400, freq: "mo" },
        { id: "f3", name: "Childcare", amount: 1300, freq: "mo" },
      ],
      variable: 3200,
      accounts: [
        { id: "a1", name: "Derek's 401(k)",     owner: "Derek", type: "investment", balance: 145000 },
        { id: "a2", name: "Kelly's 403(b)",     owner: "Kelly", type: "investment", balance: 98000 },
        { id: "a3", name: "Roth IRA",           owner: "Derek", type: "investment", balance: 42000 },
        { id: "a4", name: "Roth IRA",           owner: "Kelly", type: "investment", balance: 38000 },
        { id: "a5", name: "Brokerage",          owner: "Joint", type: "investment", balance: 60000 },
        { id: "a6", name: "Emergency savings",  owner: "Joint", type: "cash",       balance: 35000 },
        { id: "a7", name: "Home",               owner: "Joint", type: "realestate", balance: 530000 },
      ],
      debts: [
        { id: "d1", name: "Mortgage", balance: 310000, apr: 6.5, payment: 2600 },
        { id: "d2", name: "Car loan", balance: 18000,  apr: 7.0, payment: 500 },
      ],
    };
  }

  var state = defaults();
  var idSeq = 100;

  var el = {};
  ["household", "targetYear", "targetIncome", "rate", "inflation", "cashYield", "withdrawal",
   "investPct", "investPctLbl", "splitNote", "variable", "debtPaydown", "realNote",
   "addIncome", "addFixed", "addAcct", "addDebt", "incomeList", "fixedList", "acctList", "debtList", "debtNote",
   "theme-toggle", "hhTitle",
   "status", "statusText", "verdictLine", "verdictSub", "progressFill", "progressPct",
   "incMo", "expMo", "leaves", "netWorth", "portfolioNow",
   "goalYear", "projIncome", "projSub", "chart", "chartX", "whatifList", "resetBtn"].forEach(function (id) {
    el[id.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = document.getElementById(id);
  });

  /* ---------- helpers ---------- */
  function fmtMoney(n) {
    if (!isFinite(n)) n = 0;
    n = Math.round(n);
    return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US");
  }
  function fmtK(n) {
    var a = Math.abs(Math.round(n));
    if (a >= 1e6) return (n < 0 ? "-$" : "$") + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + " million";
    if (a >= 1000) return (n < 0 ? "-$" : "$") + Math.round(a / 1000) + ",000";
    return fmtMoney(n);
  }
  function num(v, fb) { var x = parseFloat(v); return isFinite(x) ? x : (fb || 0); }
  function monthlyOf(item) { return item.freq === "yr" ? num(item.amount) / 12 : num(item.amount); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  // Nominal annual % → real monthly rate (adjusted for inflation).
  function realMonthly(nominalPct) {
    var infl = num(state.settings.inflation) / 100;
    return Math.pow((1 + num(nominalPct) / 100) / (1 + infl), 1 / 12) - 1;
  }

  /* ---------- cash flow ---------- */
  function cashflow() {
    var s = state.settings;
    var incomeMo = state.incomes.reduce(function (a, i) { return a + monthlyOf(i); }, 0);
    var fixedMo = state.fixed.reduce(function (a, f) { return a + monthlyOf(f); }, 0);
    var varMo = num(state.variable);
    var debtPayMo = state.debts.reduce(function (a, d) { return a + num(d.payment); }, 0);
    var expenseMo = fixedMo + varMo + debtPayMo;
    var surplusMo = incomeMo - expenseMo;
    var saveRate = incomeMo > 0 ? surplusMo / incomeMo : 0;
    var pct = Math.max(0, Math.min(100, num(s.investPct, 85))) / 100;
    var savePos = Math.max(0, surplusMo);
    var debtMo = Math.min(Math.max(0, num(s.debtPaydown)), savePos);
    var rem = savePos - debtMo;
    return {
      incomeMo: incomeMo, expenseMo: expenseMo, surplusMo: surplusMo, saveRate: saveRate,
      debtMo: debtMo, investMo: rem * pct, cashMo: rem * (1 - pct), saveMo: savePos, pct: pct,
    };
  }

  /* ---------- projection (all in today's dollars) ---------- */
  function project(cf, opts) {
    var s = state.settings;
    var targetYear = (opts && opts.targetYear) || s.targetYear;
    var years = Math.max(0, Math.round(targetYear - THIS_YEAR));
    var months = years * 12;
    var rReturn = realMonthly(s.rate);
    var rCash = realMonthly(s.cashYield);

    var invStart = 0, cashStart = 0, assetTotal = 0;
    state.accounts.forEach(function (a) {
      var bal = num(a.balance);
      assetTotal += bal;
      if (a.type === "investment") invStart += bal;
      if (a.type === "cash") cashStart += bal;
    });
    var debtStart = state.debts.reduce(function (x, d) { return x + num(d.balance); }, 0);
    var portfolioNow = invStart + cashStart;
    var netWorth = assetTotal - debtStart;

    var liabs = state.debts.map(function (d) {
      return { bal: num(d.balance), rate: realMonthly(d.apr), payment: num(d.payment), paidOff: num(d.balance) <= 0 };
    });

    var invBal = invStart, cashBal = cashStart, contributed = portfolioNow;
    var debtFreeMonth = liabs.every(function (l) { return l.paidOff; }) ? 0 : null;
    var series = [{ year: 0, balance: portfolioNow }];

    for (var m = 1; m <= months; m++) {
      var freed = 0;
      liabs.forEach(function (l) { if (l.paidOff) freed += l.payment; });

      var extra = cf.debtMo;
      liabs.forEach(function (l) {
        if (l.paidOff) return;
        l.bal *= (1 + l.rate);
        if (l.payment >= l.bal) { extra += (l.payment - l.bal); l.bal = 0; l.paidOff = true; }
        else l.bal -= l.payment;
      });
      liabs.filter(function (l) { return !l.paidOff; })
           .sort(function (a, b) { return b.rate - a.rate; })
           .forEach(function (l) {
        if (extra <= 0) return;
        var ap = Math.min(extra, l.bal); l.bal -= ap; extra -= ap;
        if (l.bal <= 0) l.paidOff = true;
      });

      // freed payments + any leftover extra flow back through the invest/cash split
      var pool = freed + Math.max(0, extra);
      var investThis = cf.investMo + pool * cf.pct;
      var cashThis = cf.cashMo + pool * (1 - cf.pct);
      invBal = invBal * (1 + rReturn) + investThis;
      cashBal = cashBal * (1 + rCash) + cashThis;
      contributed += investThis + cashThis;

      if (debtFreeMonth === null && liabs.every(function (l) { return l.paidOff; })) debtFreeMonth = m;
      if (m % 12 === 0) series.push({ year: m / 12, balance: invBal + cashBal });
    }
    if (series.length < 2) series.push({ year: 0, balance: portfolioNow });

    var projPortfolio = series[series.length - 1].balance;
    var wr = Math.max(0.01, s.withdrawal / 100);
    var needed = s.targetIncome / wr; // today's dollars

    return {
      years: years, series: series, netWorth: netWorth, portfolioNow: portfolioNow, debtStart: debtStart,
      invStart: invStart, cashStart: cashStart, rReturn: rReturn,
      projPortfolio: projPortfolio, contributed: contributed, needed: needed,
      projIncome: projPortfolio * wr, wr: wr, debtFreeMonth: debtFreeMonth,
    };
  }

  // Real monthly investing needed to reach the goal from today's balances.
  function requiredInvestMonthly(p) {
    var months = p.years * 12;
    if (months === 0) return Infinity;
    var r = p.rReturn;
    var rc = realMonthly(state.settings.cashYield);
    var fv = p.invStart * Math.pow(1 + r, months) + p.cashStart * Math.pow(1 + rc, months);
    var remaining = p.needed - fv;
    if (remaining <= 0) return 0;
    var factor = r === 0 ? months : (Math.pow(1 + r, months) - 1) / r;
    return remaining / factor;
  }

  /* ---------- render ---------- */
  function renderAll() {
    var s = state.settings;
    var cf = cashflow();
    var p = project(cf);

    el.hhTitle.textContent = s.household || "Retirement";
    document.title = (s.household || "Retirement") + " · Retirement";

    // step 1 & 2 subtotals
    el.incMo.innerHTML = fmtMoney(cf.incomeMo) + "<em>/mo</em>";
    el.expMo.innerHTML = fmtMoney(cf.expenseMo) + "<em>/mo</em>";
    if (cf.surplusMo > 0) {
      el.leaves.className = "leaves";
      el.leaves.textContent = "That leaves " + fmtMoney(cf.surplusMo) + " a month to save — "
        + Math.round(cf.saveRate * 100) + "% of what you earn. 💪";
    } else {
      el.leaves.className = "leaves neg";
      el.leaves.textContent = "You're spending about as much as you earn — nothing left to save yet.";
    }

    // step 3 totals
    el.netWorth.textContent = fmtMoney(p.netWorth);
    el.portfolioNow.textContent = fmtMoney(p.portfolioNow);
    if (!state.debts.length || p.debtStart <= 0) {
      el.debtNote.innerHTML = state.debts.length ? "<b>No debt.</b> Nicely done." : "";
    } else if (p.debtFreeMonth != null) {
      var yr = THIS_YEAR + Math.ceil(p.debtFreeMonth / 12);
      el.debtNote.innerHTML = "You owe <b>" + fmtMoney(p.debtStart) + "</b> today — on track to be <b>debt-free by " + yr + "</b>"
        + (cf.debtMo > 0 ? " with your " + fmtMoney(cf.debtMo) + "/mo extra" : "") + ". After that, those payments go toward savings.";
    } else {
      el.debtNote.innerHTML = "You owe <b>" + fmtMoney(p.debtStart) + "</b> today — not fully paid off by " + s.targetYear + " at current payments.";
    }

    // step 4 result
    el.goalYear.textContent = s.targetYear;
    el.projIncome.innerHTML = fmtMoney(p.projIncome) + "<em>/yr</em>";
    el.projSub.textContent = "from about " + fmtMoney(p.projPortfolio) + " in savings · you'd need about "
      + fmtMoney(p.needed) + " for your " + fmtMoney(s.targetIncome) + "/yr goal";

    // progress
    var ratio = p.needed > 0 ? p.projPortfolio / p.needed : 0;
    el.progressFill.style.width = Math.max(0, Math.min(100, ratio * 100)) + "%";
    el.progressPct.textContent = Math.round(ratio * 100) + "%";

    // verdict (plain English)
    var gap = p.projPortfolio - p.needed;
    if (s.targetYear <= THIS_YEAR) {
      setStatus(false, "Check the year");
      el.verdictLine.textContent = "Pick a retirement year in the future to see where you stand.";
      el.verdictSub.textContent = "";
    } else if (cf.surplusMo <= 0) {
      setStatus(false, "Nothing to save yet");
      el.verdictLine.textContent = "Right now you're spending about as much as you earn, so there's nothing left to put toward retirement.";
      el.verdictSub.textContent = "Trim spending or add income in steps 1–2, and the plan comes to life.";
    } else if (gap >= 0) {
      setStatus(true, "On track");
      var overBy = p.projIncome - s.targetIncome;
      var margin = overBy > s.targetIncome * 0.15 ? "comfortably above" : "just above";
      el.verdictLine.textContent = "Saving " + fmtMoney(cf.saveMo) + " a month, you're on pace to retire in "
        + s.targetYear + " with about " + fmtMoney(p.projIncome) + " a year to spend — " + margin + " your "
        + fmtMoney(s.targetIncome) + " goal. 🎉";
      el.verdictSub.textContent = "You've got room to spare — you could spend a little more now, or retire a bit earlier.";
    } else {
      setStatus(false, "A bit behind");
      var reqInv = requiredInvestMonthly(p);
      var incomeShort = s.targetIncome - p.projIncome;
      el.verdictLine.textContent = "Saving " + fmtMoney(cf.saveMo) + " a month, by " + s.targetYear
        + " you'd have about " + fmtMoney(p.projIncome) + " a year to spend — short of your "
        + fmtMoney(s.targetIncome) + " goal by roughly " + fmtMoney(incomeShort) + " a year.";
      if (isFinite(reqInv)) {
        var extra = Math.max(0, reqInv - cf.investMo);
        el.verdictSub.textContent = "To close it: save about " + fmtMoney(extra) + " more a month, retire a little later, or aim for a bit less. Small changes add up.";
      } else {
        el.verdictSub.textContent = "Try saving more, or giving yourself more time.";
      }
    }

    // advanced note: real return
    var realR = (Math.pow(1 + realMonthly(s.rate), 12) - 1) * 100;
    el.realNote.textContent = "After " + s.inflation + "% inflation, your investments grow about "
      + realR.toFixed(1) + "% a year in today's money — that's what the projection uses.";
    el.investPctLbl.textContent = Math.round(num(s.investPct, 85)) + "%";
    el.splitNote.textContent = cf.surplusMo <= 0
      ? "No surplus to allocate yet."
      : "≈ " + fmtMoney(cf.debtMo) + "/mo extra to debt · " + fmtMoney(cf.investMo) + "/mo invested · " + fmtMoney(cf.cashMo) + "/mo to cash.";

    drawChart(p);
    renderWhatif();
  }

  function setStatus(ok, text) { el.status.className = "status" + (ok ? "" : " warn"); el.statusText.textContent = text; }

  /* ---------- chart: single savings area toward the goal line ---------- */
  function drawChart(p) {
    var W = 500, H = 180, padL = 4, padR = 4, padT = 10, padB = 4;
    var iw = W - padL - padR, ih = H - padT - padB;
    var pts = p.series, n = pts.length;
    if (n < 2) { el.chart.innerHTML = ""; el.chartX.innerHTML = ""; return; }
    var maxBal = 0; pts.forEach(function (d) { if (d.balance > maxBal) maxBal = d.balance; });
    var top = Math.max(maxBal, p.needed) * 1.08 || 1;
    function x(i) { return padL + (iw * i) / (n - 1); }
    function y(v) { return padT + ih - (ih * v) / top; }
    var base = padT + ih;

    var line = pts.map(function (d, i) { return x(i) + "," + y(d.balance); });
    var area = "M " + padL + "," + base + " L " + line.join(" L ") + " L " + x(n - 1) + "," + base + " Z";
    var stroke = "M " + line.join(" L ");
    var ty = y(p.needed);
    var showTarget = p.needed > 0 && p.needed <= top;

    el.chart.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Your retirement savings growing toward your goal">'
      + '<path d="' + area + '" fill="var(--savings)" opacity="0.16"/>'
      + '<path d="' + stroke + '" fill="none" stroke="var(--savings)" stroke-width="2.5"/>'
      + (showTarget ? '<line x1="' + padL + '" y1="' + ty + '" x2="' + (W - padR) + '" y2="' + ty + '" stroke="var(--target)" stroke-width="2" stroke-dasharray="6 5"/>' : '')
      + '</svg>';
    var midYear = THIS_YEAR + Math.round(p.years / 2);
    el.chartX.innerHTML = '<span>' + THIS_YEAR + '</span><span>' + midYear + '</span><span>' + state.settings.targetYear + '</span>';
  }

  /* ---------- "what if" scenarios (non-destructive) ---------- */
  var SCENARIOS = [
    { label: "Retire 3 years earlier", yearsDelta: -3 },
    { label: "Retire 3 years later", yearsDelta: 3 },
    { label: "Save $300 more a month", extraMonthly: 300 },
    { label: "If investments grow slower", rateDelta: -2 },
  ];

  function renderWhatif() {
    var s = state.settings;
    var base = cashflow();
    el.whatifList.innerHTML = SCENARIOS.map(function (sc) {
      var cf2 = base, detail = "", year = s.targetYear, savedRate = s.rate;
      if (sc.extraMonthly) {
        cf2 = Object.assign({}, base, {
          investMo: base.investMo + sc.extraMonthly * base.pct,
          cashMo: base.cashMo + sc.extraMonthly * (1 - base.pct),
          saveMo: base.saveMo + sc.extraMonthly,
        });
      }
      if (sc.yearsDelta) { year = s.targetYear + sc.yearsDelta; detail = String(year); }

      var out, cls, pill;
      if (year <= THIS_YEAR) {
        out = "—"; cls = "mute"; pill = "too soon";
      } else {
        if (sc.rateDelta) s.rate = savedRate + sc.rateDelta;   // temporary tweak for the sim
        var p = project(cf2, { targetYear: year });
        if (sc.rateDelta) s.rate = savedRate;                  // restore immediately
        var meets = p.projPortfolio >= p.needed;
        out = fmtMoney(p.projIncome) + "<em>/yr</em>";
        cls = meets ? "good" : "warn";
        pill = meets ? "Meets goal" : "Falls short";
      }
      return '<div class="wi-row"><span class="wi-label">' + escapeHtml(sc.label)
        + (detail ? ' <em>(' + detail + ')</em>' : '') + '</span>'
        + '<span class="wi-out"><span class="wi-income">' + out + '</span>'
        + '<span class="wi-pill ' + cls + '">' + pill + '</span></span></div>';
    }).join("");
  }

  /* ---------- editable lists ---------- */
  function renderLineList(container, arr) {
    if (!arr.length) { container.innerHTML = '<div class="acct-empty">Nothing here yet — tap + Add.</div>'; return; }
    container.innerHTML = "";
    arr.forEach(function (item, idx) {
      var row = document.createElement("div");
      row.className = "line-row";
      row.innerHTML =
        '<span class="cell-name"><input type="text" data-i="' + idx + '" data-f="name" value="' + escapeHtml(item.name) + '" placeholder="Name" autocomplete="off" /></span>'
      + '<span class="cell-amt"><input type="number" inputmode="decimal" step="50" data-i="' + idx + '" data-f="amount" value="' + item.amount + '" /></span>'
      + '<span class="cell-freq"><select data-i="' + idx + '" data-f="freq"><option value="mo"' + (item.freq === "mo" ? " selected" : "") + '>/mo</option><option value="yr"' + (item.freq === "yr" ? " selected" : "") + '>/yr</option></select></span>'
      + '<span class="cell-del"><button type="button" class="del-btn" data-del="' + idx + '" aria-label="Remove">×</button></span>';
      container.appendChild(row);
    });
    wireRows(container, arr, ["amount"], function () { renderLineList(container, arr); });
  }

  function renderAccounts() {
    var c = el.acctList;
    if (!state.accounts.length) { c.innerHTML = '<div class="acct-empty">Add a 401(k), IRA, savings, home…</div>'; return; }
    c.innerHTML = "";
    state.accounts.forEach(function (a, idx) {
      var row = document.createElement("div");
      row.className = "acct-row";
      var typeOpts = Object.keys(TYPES).map(function (k) { return '<option value="' + k + '"' + (a.type === k ? " selected" : "") + '>' + TYPES[k].label + '</option>'; }).join("");
      var ownerOpts = OWNERS.map(function (o) { return '<option value="' + o + '"' + (a.owner === o ? " selected" : "") + '>' + o + '</option>'; }).join("");
      row.innerHTML =
        '<span class="cell-name"><input type="text" data-i="' + idx + '" data-f="name" value="' + escapeHtml(a.name) + '" placeholder="Account" autocomplete="off" /></span>'
      + '<span class="cell-owner"><select data-i="' + idx + '" data-f="owner">' + ownerOpts + '</select></span>'
      + '<span class="cell-type"><select data-i="' + idx + '" data-f="type">' + typeOpts + '</select></span>'
      + '<span class="cell-bal"><input type="number" inputmode="decimal" step="100" data-i="' + idx + '" data-f="balance" value="' + a.balance + '" /></span>'
      + '<span class="cell-del"><button type="button" class="del-btn" data-del="' + idx + '" aria-label="Remove">×</button></span>';
      c.appendChild(row);
    });
    wireRows(c, state.accounts, ["balance"], renderAccounts);
  }

  function renderDebts() {
    var c = el.debtList;
    if (!state.debts.length) { c.innerHTML = '<div class="acct-empty">No debts? Leave this empty.</div>'; return; }
    c.innerHTML = "";
    state.debts.forEach(function (d, idx) {
      var row = document.createElement("div");
      row.className = "debt-row";
      row.innerHTML =
        '<span class="cell-name"><input type="text" data-i="' + idx + '" data-f="name" value="' + escapeHtml(d.name) + '" placeholder="Debt" autocomplete="off" /></span>'
      + '<span class="cell-bal"><input type="number" inputmode="decimal" step="100" data-i="' + idx + '" data-f="balance" value="' + d.balance + '" /></span>'
      + '<span class="cell-apr"><input type="number" inputmode="decimal" step="0.1" data-i="' + idx + '" data-f="apr" value="' + d.apr + '" /></span>'
      + '<span class="cell-pmt"><input type="number" inputmode="decimal" step="25" data-i="' + idx + '" data-f="payment" value="' + d.payment + '" /></span>'
      + '<span class="cell-del"><button type="button" class="del-btn" data-del="' + idx + '" aria-label="Remove">×</button></span>';
      c.appendChild(row);
    });
    wireRows(c, state.debts, ["balance", "apr", "payment"], renderDebts);
  }

  function wireRows(container, arr, numericFields, reRender) {
    container.querySelectorAll("input, select").forEach(function (input) {
      input.addEventListener(input.tagName === "SELECT" ? "change" : "input", function () {
        var it = arr[+input.getAttribute("data-i")]; if (!it) return;
        var f = input.getAttribute("data-f");
        it[f] = numericFields.indexOf(f) >= 0 ? num(input.value) : input.value;
        save(); renderAll();
      });
    });
    container.querySelectorAll(".del-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        arr.splice(+btn.getAttribute("data-del"), 1);
        save(); reRender(); renderAll();
      });
    });
  }

  /* ---------- settings ---------- */
  function syncSettingsToForm() {
    var s = state.settings;
    el.household.value = s.household;
    el.targetYear.value = s.targetYear;
    el.targetIncome.value = s.targetIncome;
    el.rate.value = s.rate;
    el.inflation.value = s.inflation;
    el.cashYield.value = s.cashYield;
    el.withdrawal.value = s.withdrawal;
    el.investPct.value = s.investPct;
    el.debtPaydown.value = s.debtPaydown;
    el.variable.value = state.variable;
  }
  function wire() {
    el.household.addEventListener("input", function () { state.settings.household = el.household.value; save(); renderAll(); });
    [["targetYear", "targetYear"], ["targetIncome", "targetIncome"], ["rate", "rate"], ["inflation", "inflation"],
     ["cashYield", "cashYield"], ["withdrawal", "withdrawal"], ["investPct", "investPct"], ["debtPaydown", "debtPaydown"]]
      .forEach(function (pair) {
        el[pair[0]].addEventListener("input", function () { state.settings[pair[1]] = num(el[pair[0]].value); save(); renderAll(); });
      });
    el.variable.addEventListener("input", function () { state.variable = num(el.variable.value); save(); renderAll(); });
    el.addIncome.addEventListener("click", function () { state.incomes.push({ id: "i" + (++idSeq), name: "", amount: 0, freq: "mo" }); save(); renderLineList(el.incomeList, state.incomes); renderAll(); });
    el.addFixed.addEventListener("click", function () { state.fixed.push({ id: "f" + (++idSeq), name: "", amount: 0, freq: "mo" }); save(); renderLineList(el.fixedList, state.fixed); renderAll(); });
    el.addAcct.addEventListener("click", function () { state.accounts.push({ id: "a" + (++idSeq), name: "", owner: "Joint", type: "investment", balance: 0 }); save(); renderAccounts(); renderAll(); });
    el.addDebt.addEventListener("click", function () { state.debts.push({ id: "d" + (++idSeq), name: "", balance: 0, apr: 6, payment: 0 }); save(); renderDebts(); renderAll(); });
    el.resetBtn.addEventListener("click", function () {
      if (!window.confirm("Reset everything back to the example household? This clears the numbers you've entered.")) return;
      state = defaults();
      save();
      syncSettingsToForm();
      renderLineList(el.incomeList, state.incomes);
      renderLineList(el.fixedList, state.fixed);
      renderAccounts();
      renderDebts();
      renderAll();
    });
  }

  /* ---------- persistence ---------- */
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
    var d = defaults();
    if (raw && raw.settings && Array.isArray(raw.accounts)) {
      state = {
        settings: Object.assign(d.settings, raw.settings),
        incomes: Array.isArray(raw.incomes) ? raw.incomes : d.incomes,
        fixed: Array.isArray(raw.fixed) ? raw.fixed : d.fixed,
        variable: raw.variable != null ? raw.variable : d.variable,
        accounts: raw.accounts,
        debts: Array.isArray(raw.debts) ? raw.debts : d.debts,
      };
    } else { state = d; }
  }

  /* ---------- theme ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    el.themeToggle.textContent = t === "dark" ? "☀️" : "🌙";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#0e1613" : "#0f766e");
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (!saved) saved = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    applyTheme(saved);
  }
  el.themeToggle.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  /* ---------- boot ---------- */
  initTheme();
  load();
  syncSettingsToForm();
  wire();
  renderLineList(el.incomeList, state.incomes);
  renderLineList(el.fixedList, state.fixed);
  renderAccounts();
  renderDebts();
  renderAll();
})();
