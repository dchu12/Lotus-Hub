/* Derek & Kelly · Retirement Goal Status
   A personal net-worth + retirement-goal tracker. Enter your real accounts;
   it aggregates net worth, projects the retirement portfolio forward, and
   tells you whether you're on track. All data stays in localStorage. */
(function () {
  "use strict";

  var STORE_KEY = "dk-retire:v2";
  var THEME_KEY = "dk-retire:theme";

  var THIS_YEAR = new Date().getFullYear();

  // Account types → how they behave in the model.
  //   grow:   'return' market rate | 'inflation' | 'none'
  //   income: counts toward the retirement portfolio & withdrawal income
  //   sign:   +1 asset, -1 liability (subtracts from net worth)
  var TYPES = {
    investment: { label: "Investment", grow: "return",    income: true,  sign: 1 },
    cash:       { label: "Cash / savings", grow: "none",   income: true,  sign: 1 },
    realestate: { label: "Real estate", grow: "inflation", income: false, sign: 1 },
    liability:  { label: "Liability", grow: "none",        income: false, sign: -1 },
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
        withdrawal: 4,
        realDollars: true,
      },
      accounts: [
        { id: "a1", name: "Derek's 401(k)",   owner: "Derek", type: "investment", balance: 145000, monthly: 1500 },
        { id: "a2", name: "Kelly's 403(b)",   owner: "Kelly", type: "investment", balance: 98000,  monthly: 1200 },
        { id: "a3", name: "Roth IRA",         owner: "Derek", type: "investment", balance: 42000,  monthly: 500 },
        { id: "a4", name: "Roth IRA",         owner: "Kelly", type: "investment", balance: 38000,  monthly: 500 },
        { id: "a5", name: "Brokerage",        owner: "Joint", type: "investment", balance: 60000,  monthly: 800 },
        { id: "a6", name: "Emergency savings",owner: "Joint", type: "cash",       balance: 35000,  monthly: 200 },
        { id: "a7", name: "Home (market value)", owner: "Joint", type: "realestate", balance: 530000, monthly: 0 },
        { id: "a8", name: "Mortgage",         owner: "Joint", type: "liability",  balance: 310000, monthly: 0 },
      ],
    };
  }

  var state = defaults();
  var idSeq = 100;

  var el = {};
  ["household", "targetYear", "targetIncome", "rate", "inflation", "withdrawal", "realDollars",
   "addAcct", "acctList", "theme-toggle", "hhTitle", "asOf", "yearsToGo",
   "status", "statusText", "projLbl", "projPortfolio", "projNote",
   "progressFill", "progressPct", "netWorth", "portfolioNow", "monthlyContrib", "ownerSplit",
   "projIncome", "incomeSub", "needed", "gapBox", "gapLine", "gapHint",
   "chart", "chartX"].forEach(function (id) {
    el[id.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = document.getElementById(id);
  });

  /* ---------- money helpers ---------- */
  function fmtMoney(n) {
    if (!isFinite(n)) n = 0;
    n = Math.round(n);
    return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US");
  }
  function fmtShort(n) {
    var a = Math.abs(n), s = n < 0 ? "-" : "";
    if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return s + "$" + Math.round(a / 1e3) + "K";
    return s + "$" + Math.round(a);
  }
  function num(v, fallback) { var x = parseFloat(v); return isFinite(x) ? x : (fallback || 0); }

  /* ---------- projection ---------- */
  function project() {
    var s = state.settings;
    var years = Math.max(0, Math.round(s.targetYear - THIS_YEAR));
    var months = years * 12;
    var rMonthly = (s.rate / 100) / 12;
    var infl = s.inflation / 100;
    var inflMonthly = Math.pow(1 + infl, 1 / 12) - 1;

    function rateFor(t) {
      var g = (TYPES[t] || TYPES.other || {}).grow;
      if (g === "return") return rMonthly;
      if (g === "inflation") return inflMonthly;
      return 0;
    }

    // Current-day tallies
    var netWorth = 0, portfolioNow = 0, monthlyContrib = 0;
    var ownerNow = { Derek: 0, Kelly: 0, Joint: 0 };

    state.accounts.forEach(function (a) {
      var t = TYPES[a.type] || TYPES.investment;
      var bal = num(a.balance);
      netWorth += t.sign * bal;
      if (t.income) {
        portfolioNow += bal;
        monthlyContrib += num(a.monthly);
        if (ownerNow[a.owner] === undefined) ownerNow[a.owner] = 0;
        ownerNow[a.owner] += bal;
      }
    });

    // Aggregate the income portfolio forward, tracking contributed principal
    // separately so we can split the chart into contributions vs. growth.
    var aggBal = new Array(years + 1).fill(0);
    var aggContrib = new Array(years + 1).fill(0);

    state.accounts.forEach(function (a) {
      var t = TYPES[a.type] || TYPES.investment;
      if (!t.income) return;
      var bal = num(a.balance);
      var contributed = bal;
      var mo = num(a.monthly);
      var r = rateFor(a.type);
      aggBal[0] += bal; aggContrib[0] += contributed;
      var y = 0;
      for (var m = 1; m <= months; m++) {
        bal = bal * (1 + r) + mo;
        contributed += mo;
        if (m % 12 === 0) { y = m / 12; aggBal[y] += bal; aggContrib[y] += contributed; }
      }
    });

    var series = [];
    for (var i = 0; i <= years; i++) series.push({ year: i, balance: aggBal[i], contributed: aggContrib[i] });
    if (series.length < 2) series.push({ year: 0, balance: portfolioNow, contributed: portfolioNow });

    var projPortfolio = series[series.length - 1].balance;
    var projContributed = series[series.length - 1].contributed;

    var deflator = Math.pow(1 + infl, years);
    var wr = Math.max(0.01, s.withdrawal / 100);

    // Target income entered in today's dollars → nest egg needed today, and the
    // same figure grown to the retirement date for a nominal comparison.
    var neededReal = s.targetIncome / wr;
    var neededNominal = neededReal * deflator;
    var projIncomeNominal = projPortfolio * wr;

    return {
      years: years, series: series,
      netWorth: netWorth, portfolioNow: portfolioNow, monthlyContrib: monthlyContrib, ownerNow: ownerNow,
      projPortfolio: projPortfolio, projContributed: projContributed,
      projGrowth: Math.max(0, projPortfolio - projContributed),
      neededReal: neededReal, neededNominal: neededNominal, projIncomeNominal: projIncomeNominal,
      deflator: deflator, wr: wr, infl: infl,
    };
  }

  // Monthly contribution across income accounts that would close the gap,
  // scaling everyone's current contribution up proportionally.
  function requiredMonthly(p) {
    var months = p.years * 12;
    if (months === 0) return Infinity;
    var s = state.settings;
    var rMonthly = (s.rate / 100) / 12;
    // Future value of today's income balances at their own growth rates.
    var fvBalances = 0;
    state.accounts.forEach(function (a) {
      var t = TYPES[a.type] || TYPES.investment;
      if (!t.income) return;
      var r = t.grow === "return" ? rMonthly : (t.grow === "inflation" ? Math.pow(1 + s.inflation / 100, 1 / 12) - 1 : 0);
      fvBalances += num(a.balance) * Math.pow(1 + r, months);
    });
    var remaining = p.neededNominal - fvBalances;
    if (remaining <= 0) return 0;
    var factor = rMonthly === 0 ? months : (Math.pow(1 + rMonthly, months) - 1) / rMonthly;
    return remaining / factor;
  }

  /* ---------- render: results ---------- */
  function renderResults() {
    var s = state.settings;
    var p = project();
    var real = s.realDollars;
    var conv = real ? (1 / p.deflator) : 1; // nominal → display for future figures

    el.hhTitle.textContent = s.household || "Retirement";
    document.title = (s.household || "Retirement") + " · Retirement Goal Status";

    // Today tallies (never inflation-adjusted — they're already today's dollars)
    el.netWorth.textContent = fmtMoney(p.netWorth);
    el.portfolioNow.textContent = fmtMoney(p.portfolioNow);
    el.monthlyContrib.textContent = fmtMoney(p.monthlyContrib);

    // Headline projection
    el.projPortfolio.textContent = fmtMoney(p.projPortfolio * conv);
    el.projNote.textContent = real
      ? "in today's dollars · " + fmtMoney(p.projPortfolio) + " nominal at retirement"
      : "future dollars at retirement";

    el.projIncome.textContent = fmtMoney(p.projIncomeNominal * conv);
    el.incomeSub.textContent = "at " + s.withdrawal + "% withdrawal" + (real ? " · today's $" : "");
    el.needed.textContent = fmtMoney(p.neededNominal * conv);

    // Progress toward goal (ratio is identical in real or nominal terms)
    var ratio = p.neededNominal > 0 ? p.projPortfolio / p.neededNominal : 0;
    var pct = Math.round(ratio * 100);
    el.progressFill.style.width = Math.max(0, Math.min(100, ratio * 100)) + "%";
    el.progressPct.textContent = pct + "%";

    // Status + gap coaching
    var surplus = p.projPortfolio - p.neededNominal;
    var badYears = s.targetYear <= THIS_YEAR;
    if (badYears) {
      setStatus(false, "Set a future year");
      el.projLbl.innerHTML = "Retirement year is in the past";
      el.gapBox.className = "gap warn";
      el.gapLine.textContent = "Set a retirement year later than " + THIS_YEAR + ".";
      el.gapHint.textContent = "";
    } else if (surplus >= 0) {
      setStatus(true, "On track");
      el.projLbl.innerHTML = "On pace to retire in <span id=\"yearsToGo\">" + p.years + " years (" + s.targetYear + ")</span>";
      el.gapBox.className = "gap good";
      el.gapLine.textContent = "Ahead of goal by " + fmtMoney(surplus * conv) + ".";
      el.gapHint.textContent = "That funds about " + fmtMoney(p.projIncomeNominal * conv)
        + "/yr vs your " + fmtMoney(s.targetIncome) + "/yr target — room to spare, or you could retire earlier.";
    } else {
      setStatus(false, "Behind goal");
      el.projLbl.innerHTML = "On pace to retire in <span id=\"yearsToGo\">" + p.years + " years (" + s.targetYear + ")</span>";
      var reqM = requiredMonthly(p);
      el.gapBox.className = "gap warn";
      el.gapLine.textContent = "Short of goal by " + fmtMoney(-surplus * conv) + ".";
      if (isFinite(reqM)) {
        var extra = Math.max(0, reqM - p.monthlyContrib);
        el.gapHint.textContent = "Bump combined contributions to about " + fmtMoney(reqM) + "/mo ("
          + fmtMoney(extra) + " more than today) — or retire later, or trim the target income.";
      } else {
        el.gapHint.textContent = "Increase contributions or push the retirement year back.";
      }
    }

    renderOwnerSplit(p);
    drawChart(p, real);
  }

  function setStatus(ok, text) {
    el.status.className = "status" + (ok ? "" : " warn");
    el.statusText.textContent = text;
  }

  function renderOwnerSplit(p) {
    var maxVal = Math.max(1, p.ownerNow.Derek, p.ownerNow.Kelly, p.ownerNow.Joint);
    var colors = { Derek: "var(--derek)", Kelly: "var(--kelly)", Joint: "var(--joint)" };
    el.ownerSplit.innerHTML = OWNERS.map(function (o) {
      var v = p.ownerNow[o] || 0;
      var w = Math.round((v / maxVal) * 100);
      return '<div class="os-row">'
        + '<span class="os-name">' + o + '</span>'
        + '<span class="os-bar"><i style="width:' + w + '%;background:' + colors[o] + '"></i></span>'
        + '<span class="os-val">' + fmtMoney(v) + '</span>'
        + '</div>';
    }).join("");
  }

  /* ---------- render: chart ---------- */
  function drawChart(p, real) {
    var W = 500, H = 190, padL = 4, padR = 4, padT = 10, padB = 4;
    var iw = W - padL - padR, ih = H - padT - padB;
    var s = state.settings, infl = p.infl;

    // Values in the currently-displayed unit (deflate per-year for real dollars).
    var pts = p.series.map(function (d) {
      var f = real ? 1 / Math.pow(1 + infl, d.year) : 1;
      return { year: d.year, balance: d.balance * f, contributed: d.contributed * f };
    });
    var neededLine = real ? p.neededReal : p.neededNominal;

    var n = pts.length;
    if (n < 2) { el.chart.innerHTML = ""; el.chartX.innerHTML = ""; return; }

    var maxBal = 0;
    pts.forEach(function (d) { if (d.balance > maxBal) maxBal = d.balance; });
    var top = Math.max(maxBal, neededLine) * 1.08 || 1;

    function x(i) { return padL + (iw * i) / (n - 1); }
    function y(v) { return padT + ih - (ih * v) / top; }
    var base = padT + ih;

    var contribTop = pts.map(function (d, i) { return [x(i), y(d.contributed)]; });
    var balTop = pts.map(function (d, i) { return [x(i), y(d.balance)]; });

    var growthPath = "M" + balTop.map(function (q) { return q[0] + "," + q[1]; }).join(" L ");
    for (var g = n - 1; g >= 0; g--) growthPath += " L " + contribTop[g][0] + "," + contribTop[g][1];
    growthPath += " Z";

    var contribPath = "M " + padL + "," + base + " L "
      + contribTop.map(function (q) { return q[0] + "," + q[1]; }).join(" L ")
      + " L " + x(n - 1) + "," + base + " Z";

    var balLine = "M " + balTop.map(function (q) { return q[0] + "," + q[1]; }).join(" L ");
    var ty = y(neededLine);
    var showTarget = neededLine > 0 && neededLine <= top;

    el.chart.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Projected portfolio growth toward goal">'
      + '<path d="' + contribPath + '" fill="var(--contrib)" opacity="0.9"/>'
      + '<path d="' + growthPath + '" fill="var(--growth)" opacity="0.85"/>'
      + '<path d="' + balLine + '" fill="none" stroke="var(--growth)" stroke-width="2"/>'
      + (showTarget ? '<line x1="' + padL + '" y1="' + ty + '" x2="' + (W - padR) + '" y2="' + ty
          + '" stroke="var(--target)" stroke-width="2" stroke-dasharray="6 5"/>' : '')
      + '</svg>';

    var midYear = THIS_YEAR + Math.round(p.years / 2);
    el.chartX.innerHTML = '<span>' + THIS_YEAR + '</span><span>' + midYear + '</span><span>' + s.targetYear + '</span>';
  }

  /* ---------- render: accounts table ---------- */
  function renderAccounts() {
    if (!state.accounts.length) {
      el.acctList.innerHTML = '<div class="acct-empty">No accounts yet — add your 401(k), IRA, brokerage, savings…</div>';
      return;
    }
    el.acctList.innerHTML = "";
    state.accounts.forEach(function (a, idx) {
      var row = document.createElement("div");
      row.className = "acct-row";
      var typeOpts = Object.keys(TYPES).map(function (k) {
        return '<option value="' + k + '"' + (a.type === k ? " selected" : "") + '>' + TYPES[k].label + '</option>';
      }).join("");
      var ownerOpts = OWNERS.map(function (o) {
        return '<option value="' + o + '"' + (a.owner === o ? " selected" : "") + '>' + o + '</option>';
      }).join("");
      row.innerHTML =
        '<span class="cell-name"><input type="text" data-i="' + idx + '" data-f="name" value="' + escapeHtml(a.name) + '" placeholder="Account name" autocomplete="off" /></span>'
      + '<span class="cell-owner"><select data-i="' + idx + '" data-f="owner">' + ownerOpts + '</select></span>'
      + '<span class="cell-type"><select data-i="' + idx + '" data-f="type">' + typeOpts + '</select></span>'
      + '<span class="cell-bal"><input class="num" type="number" inputmode="decimal" step="100" data-i="' + idx + '" data-f="balance" value="' + a.balance + '" /></span>'
      + '<span class="cell-mo"><input class="num" type="number" inputmode="decimal" step="50" data-i="' + idx + '" data-f="monthly" value="' + a.monthly + '" /></span>'
      + '<span class="cell-del"><button type="button" class="del-btn" data-del="' + idx + '" aria-label="Remove ' + escapeHtml(a.name) + '">×</button></span>';
      el.acctList.appendChild(row);
    });

    // wire row inputs
    el.acctList.querySelectorAll("input, select").forEach(function (input) {
      var evt = input.tagName === "SELECT" ? "change" : "input";
      input.addEventListener(evt, function () {
        var i = +input.getAttribute("data-i"), f = input.getAttribute("data-f");
        var a = state.accounts[i];
        if (!a) return;
        a[f] = (f === "balance" || f === "monthly") ? num(input.value) : input.value;
        save();
        renderResults(); // don't re-render the table (keeps focus)
      });
    });
    el.acctList.querySelectorAll(".del-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.accounts.splice(+btn.getAttribute("data-del"), 1);
        save(); renderAccounts(); renderResults();
      });
    });
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------- settings inputs ---------- */
  function syncSettingsToForm() {
    var s = state.settings;
    el.household.value = s.household;
    el.targetYear.value = s.targetYear;
    el.targetIncome.value = s.targetIncome;
    el.rate.value = s.rate;
    el.inflation.value = s.inflation;
    el.withdrawal.value = s.withdrawal;
    el.realDollars.checked = !!s.realDollars;
  }

  function wireSettings() {
    el.household.addEventListener("input", function () { state.settings.household = el.household.value; save(); renderResults(); });
    [["targetYear", "targetYear"], ["targetIncome", "targetIncome"], ["rate", "rate"], ["inflation", "inflation"], ["withdrawal", "withdrawal"]]
      .forEach(function (pair) {
        el[pair[0]].addEventListener("input", function () { state.settings[pair[1]] = num(el[pair[0]].value); save(); renderResults(); });
      });
    el.realDollars.addEventListener("change", function () { state.settings.realDollars = el.realDollars.checked; save(); renderResults(); });
    el.addAcct.addEventListener("click", function () {
      state.accounts.push({ id: "a" + (++idSeq), name: "", owner: "Joint", type: "investment", balance: 0, monthly: 0 });
      save(); renderAccounts(); renderResults();
    });
  }

  /* ---------- persistence ---------- */
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
    if (raw && raw.settings && Array.isArray(raw.accounts)) {
      var d = defaults();
      state = { settings: Object.assign(d.settings, raw.settings), accounts: raw.accounts };
    } else {
      state = defaults();
    }
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
  wireSettings();
  renderAccounts();
  renderResults();
})();
