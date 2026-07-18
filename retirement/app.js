/* Derek & Kelly · Retirement
   A plain-language retirement tracker. Everything is in TODAY'S DOLLARS
   (real terms). It models your whole financial life:
     earn − spend = what you save each month
       → extra debt paydown, then split invest / cash
       → savings grow (real returns), debts pay down, freed payments re-split
       → at retirement, savings are drawn down each year to cover the spending
         your Social Security / pensions don't already cover
       → we report the age your money lasts to, across good / expected / poor
         markets.
   All data stays in localStorage (or a shareable link you make). */
(function () {
  "use strict";

  var STORE_KEY = "dk-retire:v6";
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
        currentAge: 45,
        retireAge: 65,
        planThroughAge: 95,
        targetIncome: 95000,
        rate: 6.0,
        inflation: 2.5,
        cashYield: 3.5,
        investPct: 85,
        debtPaydown: 150,
      },
      incomes: [
        { id: "i1", name: "Derek — salary", amount: 5200, freq: "mo" },
        { id: "i2", name: "Kelly — salary", amount: 4300, freq: "mo" },
        { id: "i3", name: "Annual bonus", amount: 6000, freq: "yr" },
      ],
      fixed: [
        { id: "f1", name: "Utilities & phone", amount: 340, freq: "mo" },
        { id: "f2", name: "Insurance", amount: 360, freq: "mo" },
        { id: "f3", name: "Childcare", amount: 1000, freq: "mo" },
      ],
      variable: 3100,
      accounts: [
        { id: "a1", name: "Derek's 401(k)",     owner: "Derek", type: "investment", balance: 88000 },
        { id: "a2", name: "Kelly's 403(b)",     owner: "Kelly", type: "investment", balance: 54000 },
        { id: "a3", name: "Roth IRA",           owner: "Derek", type: "investment", balance: 24000 },
        { id: "a4", name: "Roth IRA",           owner: "Kelly", type: "investment", balance: 20000 },
        { id: "a5", name: "Brokerage",          owner: "Joint", type: "investment", balance: 20000 },
        { id: "a6", name: "Emergency savings",  owner: "Joint", type: "cash",       balance: 22000 },
        { id: "a7", name: "Home",               owner: "Joint", type: "realestate", balance: 460000 },
      ],
      debts: [
        { id: "d1", name: "Mortgage", balance: 265000, apr: 6.3, payment: 2150 },
        { id: "d2", name: "Car loan", balance: 14000,  apr: 6.9, payment: 420 },
      ],
      retIncomes: [
        { id: "r1", name: "Social Security (combined)", amount: 38000, startAge: 67 },
      ],
    };
  }

  var state = defaults();
  var idSeq = 100;

  var el = {};
  ["household", "currentAge", "retireAge", "planThroughAge", "targetIncome", "rate", "inflation", "cashYield",
   "investPct", "investPctLbl", "splitNote", "variable", "debtPaydown", "realNote",
   "addIncome", "addFixed", "addAcct", "addDebt", "addRet",
   "incomeList", "fixedList", "acctList", "debtList", "retList", "debtNote",
   "theme-toggle", "hhTitle",
   "status", "statusText", "verdictLine", "verdictSub", "progressFill", "progressPct",
   "incMo", "expMo", "leaves", "netWorth", "portfolioNow",
   "spendLbl", "lastsAge", "lastsSub", "confidence", "chart", "chartX", "whatifList",
   "resetBtn", "copyLink", "downloadData", "loadData", "dataMsg"].forEach(function (id) {
    el[id.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = document.getElementById(id);
  });

  /* ---------- helpers ---------- */
  function fmtMoney(n) {
    if (!isFinite(n)) n = 0;
    n = Math.round(n);
    return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US");
  }
  function num(v, fb) { var x = parseFloat(v); return isFinite(x) ? x : (fb || 0); }
  function monthlyOf(item) { return item.freq === "yr" ? num(item.amount) / 12 : num(item.amount); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function realMonthly(nominalPct) {
    var infl = num(state.settings.inflation) / 100;
    return Math.pow((1 + num(nominalPct) / 100) / (1 + infl), 1 / 12) - 1;
  }
  function realAnnual(nominalPct) {
    var infl = num(state.settings.inflation) / 100;
    return (1 + num(nominalPct) / 100) / (1 + infl) - 1;
  }
  // Retirement income (Social Security etc.) active at a given age, $/yr today.
  function retIncomeAt(age) {
    return state.retIncomes.reduce(function (s, r) {
      return s + (age >= num(r.startAge) ? num(r.amount) : 0);
    }, 0);
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

  /* ---------- full-life simulation (accumulate, then draw down) ----------
     nominalRate lets scenarios/market-range vary the investment return.
     Returns a per-age balance series covering the whole plan, plus the
     retirement balance and the age (if any) the money runs out. */
  function simulate(cf, nominalRate) {
    var s = state.settings;
    var currentAge = num(s.currentAge), retireAge = num(s.retireAge), endAge = num(s.planThroughAge);
    var accumYears = Math.max(0, Math.round(retireAge - currentAge));
    var months = accumYears * 12;
    var rRet = realMonthly(nominalRate), rCash = realMonthly(s.cashYield), rDraw = realAnnual(nominalRate);

    var invStart = 0, cashStart = 0;
    state.accounts.forEach(function (a) {
      var b = num(a.balance);
      if (a.type === "investment") invStart += b;
      if (a.type === "cash") cashStart += b;
    });
    var liabs = state.debts.map(function (d) {
      return { bal: num(d.balance), rate: realMonthly(d.apr), payment: num(d.payment), paidOff: num(d.balance) <= 0 };
    });

    var invBal = invStart, cashBal = cashStart;
    var series = [{ age: currentAge, bal: invStart + cashStart }];
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
      liabs.filter(function (l) { return !l.paidOff; }).sort(function (a, b) { return b.rate - a.rate; })
           .forEach(function (l) { if (extra <= 0) return; var ap = Math.min(extra, l.bal); l.bal -= ap; extra -= ap; if (l.bal <= 0) l.paidOff = true; });
      var pool = freed + Math.max(0, extra);
      invBal = invBal * (1 + rRet) + cf.investMo + pool * cf.pct;
      cashBal = cashBal * (1 + rCash) + cf.cashMo + pool * (1 - cf.pct);
      if (m % 12 === 0) series.push({ age: currentAge + m / 12, bal: invBal + cashBal });
    }

    var retireBal = invBal + cashBal;
    var bal = retireBal, runOutAge = null;
    for (var age = retireAge; age < endAge; age++) {
      if (bal > 0) {
        var w = Math.max(0, num(s.targetIncome) - retIncomeAt(age));
        bal -= w;
        if (bal <= 0) { bal = 0; if (runOutAge === null) runOutAge = age; }
        else bal *= (1 + rDraw);
      }
      series.push({ age: age + 1, bal: Math.max(0, bal) });
    }
    return { series: series, retireBal: retireBal, runOutAge: runOutAge, leftover: bal,
             lastsToEnd: runOutAge === null, rDraw: rDraw, accumYears: accumYears };
  }

  // Portfolio needed at retirement so savings last exactly to the plan age
  // (present value of the withdrawals Social Security won't cover).
  function neededAtRetirement(rDraw) {
    var s = state.settings, retireAge = num(s.retireAge), endAge = num(s.planThroughAge), needed = 0;
    for (var t = 0; t < Math.max(0, endAge - retireAge); t++) {
      var w = Math.max(0, num(s.targetIncome) - retIncomeAt(retireAge + t));
      needed += w / Math.pow(1 + rDraw, t);
    }
    return needed;
  }

  // Largest yearly spending the retirement balance can sustain to the plan age.
  function maxSpend(retireBal, rDraw) {
    var s = state.settings, retireAge = num(s.retireAge), endAge = num(s.planThroughAge);
    function lasts(spend) {
      var bal = retireBal;
      for (var age = retireAge; age < endAge; age++) {
        bal -= Math.max(0, spend - retIncomeAt(age));
        if (bal < 0) return false;
        bal *= (1 + rDraw);
      }
      return true;
    }
    var lo = 0, hi = Math.max(num(s.targetIncome) * 3, retireBal / 2 + 1);
    for (var i = 0; i < 44; i++) { var mid = (lo + hi) / 2; if (lasts(mid)) lo = mid; else hi = mid; }
    return lo;
  }

  /* ---------- render ---------- */
  function renderAll() {
    var s = state.settings;
    var cf = cashflow();
    el.hhTitle.textContent = s.household || "Retirement";
    document.title = (s.household || "Retirement") + " · Retirement";

    // step 1 & 2
    el.incMo.innerHTML = fmtMoney(cf.incomeMo) + "<em>/mo</em>";
    el.expMo.innerHTML = fmtMoney(cf.expenseMo) + "<em>/mo</em>";
    if (cf.surplusMo > 0) {
      el.leaves.className = "leaves";
      el.leaves.textContent = "That leaves " + fmtMoney(cf.surplusMo) + " a month to save — " + Math.round(cf.saveRate * 100) + "% of what you earn. 💪";
    } else {
      el.leaves.className = "leaves neg";
      el.leaves.textContent = "You're spending about as much as you earn — nothing left to save right now.";
    }

    // step 3
    var netWorth = 0, portfolioNow = 0, debtStart = 0;
    state.accounts.forEach(function (a) { netWorth += num(a.balance); if (a.type === "investment" || a.type === "cash") portfolioNow += num(a.balance); });
    state.debts.forEach(function (d) { debtStart += num(d.balance); netWorth -= num(d.balance); });
    el.netWorth.textContent = fmtMoney(netWorth);
    el.portfolioNow.textContent = fmtMoney(portfolioNow);

    var validAges = s.retireAge > s.currentAge && s.planThroughAge > s.retireAge;
    var retireYear = THIS_YEAR + Math.round(s.retireAge - s.currentAge);

    // debt-free note (from expected sim's amortization — recompute payoff quickly)
    renderDebtNote(cf, debtStart, retireYear);

    if (!validAges) {
      setStatus(false, "Check the ages");
      el.verdictLine.textContent = "Enter your age now, a later retirement age, and a plan-through age to see where you stand.";
      el.verdictSub.textContent = "";
      el.progressFill.style.width = "0%"; el.progressPct.textContent = "—";
      el.spendLbl.textContent = fmtMoney(s.targetIncome);
      el.lastsAge.textContent = "—"; el.lastsSub.textContent = ""; el.confidence.textContent = "";
      el.chart.innerHTML = ""; el.chartX.innerHTML = "";
      renderWhatif(); renderAdvancedNote(cf);
      return;
    }

    var exp = simulate(cf, s.rate);
    var poor = simulate(cf, s.rate - 2);
    var good = simulate(cf, s.rate + 2);
    var endAge = num(s.planThroughAge);
    var msMax = maxSpend(exp.retireBal, exp.rDraw);
    var needed = neededAtRetirement(exp.rDraw);

    // progress = how much of your retirement your savings can fund
    var ratio = needed > 0 ? exp.retireBal / needed : (num(s.targetIncome) <= retIncomeAt(s.retireAge) ? 1 : 0);
    el.progressFill.style.width = Math.max(0, Math.min(100, ratio * 100)) + "%";
    el.progressPct.textContent = Math.round(ratio * 100) + "%";

    // result block
    el.spendLbl.textContent = fmtMoney(s.targetIncome);
    if (exp.lastsToEnd) {
      el.lastsAge.textContent = "age " + endAge + "+";
      el.lastsSub.textContent = "with about " + fmtMoney(exp.leftover) + " still left at " + endAge + " · you could spend up to about " + fmtMoney(msMax) + "/yr and still reach " + endAge;
    } else {
      el.lastsAge.textContent = "age " + exp.runOutAge;
      el.lastsSub.textContent = "that's short of your plan through " + endAge + " · about " + fmtMoney(msMax) + "/yr would last the whole way";
    }

    // confidence (poor market)
    if (poor.lastsToEnd) {
      el.confidence.className = "confidence good";
      el.confidence.textContent = "Even in a poor market, your money still lasts through " + endAge + ". 👍";
    } else {
      el.confidence.className = "confidence warn";
      el.confidence.textContent = "Heads up: in a poor market it could run short around age " + poor.runOutAge + " — worth keeping a cushion.";
    }

    // verdict
    if (exp.lastsToEnd) {
      setStatus(true, "On track");
      el.verdictLine.textContent = "Retiring at " + s.retireAge + " in " + retireYear + " and spending " + fmtMoney(s.targetIncome)
        + " a year, your savings comfortably last through age " + endAge + ". You're on track. 🎉";
      el.verdictSub.textContent = "You could spend up to about " + fmtMoney(msMax) + " a year and still make it — room to enjoy more now, or retire earlier.";
    } else {
      setStatus(false, "Falls short");
      var shortBy = num(s.targetIncome) - msMax;
      el.verdictLine.textContent = "Retiring at " + s.retireAge + " and spending " + fmtMoney(s.targetIncome)
        + " a year, your savings would run out around age " + exp.runOutAge + " — before your plan of " + endAge + ".";
      el.verdictSub.textContent = "To make it last: spend about " + fmtMoney(msMax) + " a year instead (roughly " + fmtMoney(shortBy)
        + " less), retire a little later, add income, or save more. Small changes add up.";
    }
    if (cf.surplusMo <= 0) {
      el.verdictSub.textContent += " Note: right now you're not saving anything each month — freeing up some surplus in steps 1–2 helps a lot.";
    }

    drawChart(exp, poor, good, s);
    renderWhatif();
    renderAdvancedNote(cf);
  }

  function setStatus(ok, text) { el.status.className = "status" + (ok ? "" : " warn"); el.statusText.textContent = text; }

  function renderDebtNote(cf, debtStart, retireYear) {
    if (!state.debts.length) { el.debtNote.textContent = ""; return; }
    if (debtStart <= 0) { el.debtNote.innerHTML = "<b>No debt.</b> Nicely done."; return; }
    // quick payoff scan using the expected real rates
    var liabs = state.debts.map(function (d) { return { bal: num(d.balance), rate: realMonthly(d.apr), payment: num(d.payment), paidOff: num(d.balance) <= 0 }; });
    var freeMonth = null;
    for (var m = 1; m <= 12 * 60; m++) {
      var extra = cf.debtMo;
      liabs.forEach(function (l) { if (l.paidOff) return; l.bal *= (1 + l.rate); if (l.payment >= l.bal) { extra += l.payment - l.bal; l.bal = 0; l.paidOff = true; } else l.bal -= l.payment; });
      liabs.filter(function (l) { return !l.paidOff; }).sort(function (a, b) { return b.rate - a.rate; })
           .forEach(function (l) { if (extra <= 0) return; var ap = Math.min(extra, l.bal); l.bal -= ap; extra -= ap; if (l.bal <= 0) l.paidOff = true; });
      if (liabs.every(function (l) { return l.paidOff; })) { freeMonth = m; break; }
    }
    if (freeMonth) {
      el.debtNote.innerHTML = "You owe <b>" + fmtMoney(debtStart) + "</b> today — debt-free by <b>" + (THIS_YEAR + Math.ceil(freeMonth / 12))
        + "</b>" + (cf.debtMo > 0 ? " with your " + fmtMoney(cf.debtMo) + "/mo extra" : "") + ". After that, those payments go toward savings.";
    } else {
      el.debtNote.innerHTML = "You owe <b>" + fmtMoney(debtStart) + "</b> today.";
    }
  }

  function renderAdvancedNote(cf) {
    var s = state.settings;
    var realR = realAnnual(s.rate) * 100;
    el.realNote.textContent = "After " + s.inflation + "% inflation, investments grow about " + realR.toFixed(1) + "% a year in today's money — that's what the projection uses.";
    el.investPctLbl.textContent = Math.round(num(s.investPct, 85)) + "%";
    el.splitNote.textContent = cf.surplusMo <= 0 ? "No surplus to allocate yet."
      : "≈ " + fmtMoney(cf.debtMo) + "/mo extra to debt · " + fmtMoney(cf.investMo) + "/mo invested · " + fmtMoney(cf.cashMo) + "/mo to cash.";
  }

  /* ---------- what-if (durability framing) ---------- */
  var SCENARIOS = [
    { label: "Retire 2 years earlier", retireDelta: -2 },
    { label: "Retire 2 years later", retireDelta: 2 },
    { label: "Spend $10k less a year", spendDelta: -10000 },
    { label: "If markets do poorly", rateDelta: -2 },
  ];
  function renderWhatif() {
    var s = state.settings;
    var base = cashflow();
    el.whatifList.innerHTML = SCENARIOS.map(function (sc) {
      var savedRetire = s.retireAge, savedSpend = s.targetIncome, savedRate = s.rate, detail = "";
      if (sc.retireDelta) { s.retireAge = savedRetire + sc.retireDelta; detail = "age " + s.retireAge; }
      if (sc.spendDelta) { s.targetIncome = Math.max(0, savedSpend + sc.spendDelta); detail = fmtMoney(s.targetIncome) + "/yr"; }
      if (sc.rateDelta) s.rate = savedRate + sc.rateDelta;

      var out, cls, pill;
      if (!(s.retireAge > s.currentAge && s.planThroughAge > s.retireAge)) {
        out = "—"; cls = "mute"; pill = "n/a";
      } else {
        var sim = simulate(base, s.rate);
        var ok = sim.lastsToEnd;
        out = ok ? "to " + s.planThroughAge + "+" : "to age " + sim.runOutAge;
        cls = ok ? "good" : "warn"; pill = ok ? "Lasts" : "Runs short";
      }
      s.retireAge = savedRetire; s.targetIncome = savedSpend; s.rate = savedRate; // restore

      return '<div class="wi-row"><span class="wi-label">' + escapeHtml(sc.label) + (detail ? ' <em>(' + detail + ')</em>' : '')
        + '</span><span class="wi-out"><span class="wi-income">' + out + '</span><span class="wi-pill ' + cls + '">' + pill + '</span></span></div>';
    }).join("");
  }

  /* ---------- chart: whole-life balance with a good/poor band ---------- */
  function drawChart(exp, poor, good, s) {
    var W = 500, H = 190, padL = 4, padR = 4, padT = 10, padB = 4;
    var iw = W - padL - padR, ih = H - padT - padB;
    var e = exp.series, n = e.length;
    if (n < 2) { el.chart.innerHTML = ""; el.chartX.innerHTML = ""; return; }
    var top = 0;
    good.series.forEach(function (d) { if (d.bal > top) top = d.bal; });
    e.forEach(function (d) { if (d.bal > top) top = d.bal; });
    top = top * 1.06 || 1;
    function x(i) { return padL + (iw * i) / (n - 1); }
    function y(v) { return padT + ih - (ih * v) / top; }

    // band between good (upper) and poor (lower)
    var up = good.series.map(function (d, i) { return x(i) + "," + y(d.bal); });
    var band = "M " + up.join(" L ");
    for (var i = n - 1; i >= 0; i--) band += " L " + x(i) + "," + y((poor.series[i] || { bal: 0 }).bal);
    band += " Z";
    var line = "M " + e.map(function (d, i) { return x(i) + "," + y(d.bal); }).join(" L ");

    // retirement marker
    var retIdx = 0;
    for (var k = 0; k < n; k++) { if (e[k].age >= s.retireAge) { retIdx = k; break; } }
    var rx = x(retIdx);

    el.chart.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Your savings over your life, with a good-to-poor market range">'
      + '<path d="' + band + '" fill="var(--savings)" opacity="0.14"/>'
      + '<line x1="' + rx + '" y1="' + padT + '" x2="' + rx + '" y2="' + (padT + ih) + '" stroke="var(--faint)" stroke-width="1" stroke-dasharray="3 4"/>'
      + '<path d="' + line + '" fill="none" stroke="var(--savings)" stroke-width="2.5"/>'
      + '</svg>';
    el.chartX.innerHTML = '<span>age ' + Math.round(s.currentAge) + '</span><span>retire ' + Math.round(s.retireAge) + '</span><span>' + Math.round(s.planThroughAge) + '</span>';
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

  function renderRet() {
    var c = el.retList;
    if (!state.retIncomes.length) { c.innerHTML = '<div class="acct-empty">None? Leave empty. Most people add Social Security here.</div>'; return; }
    c.innerHTML = "";
    state.retIncomes.forEach(function (r, idx) {
      var row = document.createElement("div");
      row.className = "ret-row";
      row.innerHTML =
        '<span class="cell-name"><input type="text" data-i="' + idx + '" data-f="name" value="' + escapeHtml(r.name) + '" placeholder="e.g. Social Security" autocomplete="off" /></span>'
      + '<span class="cell-amt"><input type="number" inputmode="decimal" step="500" data-i="' + idx + '" data-f="amount" value="' + r.amount + '" /></span>'
      + '<span class="cell-age"><input type="number" inputmode="numeric" step="1" data-i="' + idx + '" data-f="startAge" value="' + r.startAge + '" /></span>'
      + '<span class="cell-del"><button type="button" class="del-btn" data-del="' + idx + '" aria-label="Remove">×</button></span>';
      c.appendChild(row);
    });
    wireRows(c, state.retIncomes, ["amount", "startAge"], renderRet);
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
      btn.addEventListener("click", function () { arr.splice(+btn.getAttribute("data-del"), 1); save(); reRender(); renderAll(); });
    });
  }

  /* ---------- settings ---------- */
  function syncSettingsToForm() {
    var s = state.settings;
    el.household.value = s.household;
    el.currentAge.value = s.currentAge;
    el.retireAge.value = s.retireAge;
    el.planThroughAge.value = s.planThroughAge;
    el.targetIncome.value = s.targetIncome;
    el.rate.value = s.rate;
    el.inflation.value = s.inflation;
    el.cashYield.value = s.cashYield;
    el.investPct.value = s.investPct;
    el.debtPaydown.value = s.debtPaydown;
    el.variable.value = state.variable;
  }
  function wire() {
    el.household.addEventListener("input", function () { state.settings.household = el.household.value; save(); renderAll(); });
    [["currentAge", "currentAge"], ["retireAge", "retireAge"], ["planThroughAge", "planThroughAge"], ["targetIncome", "targetIncome"],
     ["rate", "rate"], ["inflation", "inflation"], ["cashYield", "cashYield"], ["investPct", "investPct"], ["debtPaydown", "debtPaydown"]]
      .forEach(function (pair) { el[pair[0]].addEventListener("input", function () { state.settings[pair[1]] = num(el[pair[0]].value); save(); renderAll(); }); });
    el.variable.addEventListener("input", function () { state.variable = num(el.variable.value); save(); renderAll(); });
    el.addIncome.addEventListener("click", function () { state.incomes.push({ id: "i" + (++idSeq), name: "", amount: 0, freq: "mo" }); save(); renderLineList(el.incomeList, state.incomes); renderAll(); });
    el.addFixed.addEventListener("click", function () { state.fixed.push({ id: "f" + (++idSeq), name: "", amount: 0, freq: "mo" }); save(); renderLineList(el.fixedList, state.fixed); renderAll(); });
    el.addRet.addEventListener("click", function () { state.retIncomes.push({ id: "r" + (++idSeq), name: "", amount: 0, startAge: state.settings.retireAge }); save(); renderRet(); renderAll(); });
    el.addAcct.addEventListener("click", function () { state.accounts.push({ id: "a" + (++idSeq), name: "", owner: "Joint", type: "investment", balance: 0 }); save(); renderAccounts(); renderAll(); });
    el.addDebt.addEventListener("click", function () { state.debts.push({ id: "d" + (++idSeq), name: "", balance: 0, apr: 6, payment: 0 }); save(); renderDebts(); renderAll(); });
    el.resetBtn.addEventListener("click", function () {
      if (!window.confirm("Reset everything back to the example household? This clears the numbers you've entered.")) return;
      state = defaults(); save(); syncSettingsToForm(); renderAllLists(); renderAll();
    });

    // data: copy link / download / load
    el.copyLink.addEventListener("click", function () {
      var link = location.origin + location.pathname + "#d=" + encodeData();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function () { flash("Link copied — paste it anywhere to open your plan on another device."); },
          function () { promptLink(link); });
      } else { promptLink(link); }
    });
    el.downloadData.addEventListener("click", function () {
      try {
        var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = "retirement-plan.json"; document.body.appendChild(a); a.click();
        document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        flash("Saved a copy to your device.");
      } catch (e) { flash("Couldn't download here — try the shareable link instead."); }
    });
    el.loadData.addEventListener("change", function () {
      var file = el.loadData.files && el.loadData.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { if (importData(reader.result)) { syncSettingsToForm(); renderAllLists(); renderAll(); flash("Loaded your saved plan."); } else flash("That file didn't look like a saved plan."); el.loadData.value = ""; };
      reader.readAsText(file);
    });
  }
  function flash(msg) { el.dataMsg.textContent = msg; }
  function promptLink(link) { try { window.prompt("Copy this link to open your plan elsewhere:", link); } catch (e) { flash("Copy failed."); } }
  function renderAllLists() {
    renderLineList(el.incomeList, state.incomes);
    renderLineList(el.fixedList, state.fixed);
    renderRet(); renderAccounts(); renderDebts();
  }

  /* ---------- data encode / decode ---------- */
  function encodeData() { try { return btoa(unescape(encodeURIComponent(JSON.stringify(state)))); } catch (e) { return ""; } }
  function importData(text) {
    try {
      var obj = typeof text === "string" && text.charAt(0) !== "{" ? JSON.parse(decodeURIComponent(escape(atob(text)))) : JSON.parse(text);
      if (!obj || !obj.settings || !Array.isArray(obj.accounts)) return false;
      state = mergeState(obj); save(); return true;
    } catch (e) { return false; }
  }
  function mergeState(raw) {
    var d = defaults();
    return {
      settings: Object.assign(d.settings, raw.settings),
      incomes: Array.isArray(raw.incomes) ? raw.incomes : d.incomes,
      fixed: Array.isArray(raw.fixed) ? raw.fixed : d.fixed,
      variable: raw.variable != null ? raw.variable : d.variable,
      accounts: raw.accounts,
      debts: Array.isArray(raw.debts) ? raw.debts : d.debts,
      retIncomes: Array.isArray(raw.retIncomes) ? raw.retIncomes : d.retIncomes,
    };
  }

  /* ---------- persistence ---------- */
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  function load() {
    // a shared link wins over local storage
    if (location.hash.indexOf("#d=") === 0) {
      if (importData(location.hash.slice(3))) {
        try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
        return;
      }
    }
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
    if (raw && raw.settings && Array.isArray(raw.accounts)) state = mergeState(raw);
    else state = defaults();
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
    applyTheme(next); try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  /* ---------- boot ---------- */
  initTheme();
  load();
  syncSettingsToForm();
  wire();
  renderAllLists();
  renderAll();
})();
