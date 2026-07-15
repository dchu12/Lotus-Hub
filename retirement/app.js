/* Retirement Tracker — projection math, chart, persistence.
   No dependencies. All money is nominal internally; we convert to
   today's dollars for display when "real dollars" is toggled on. */
(function () {
  "use strict";

  var STORE_KEY = "retire-tracker:v1";
  var THEME_KEY = "retire-tracker:theme";

  var DEFAULTS = {
    currentAge: 30,
    retireAge: 65,
    currentSavings: 25000,
    monthly: 600,
    rate: 6.5,
    inflation: 2.5,
    targetIncome: 60000,
    withdrawal: 4,
    realDollars: true,
  };

  var FIELDS = ["currentAge", "retireAge", "currentSavings", "monthly", "rate", "inflation", "targetIncome", "withdrawal"];

  var el = {};
  ["currentAge", "retireAge", "currentSavings", "monthly", "rate", "inflation", "targetIncome",
   "withdrawal", "realDollars", "reset", "themeToggle",
   "status", "statusText", "headlineLbl", "nestEgg", "nestNote",
   "projIncome", "incomeSub", "needed", "gapBox", "gapLine", "gapHint",
   "chart", "chartX", "bdContrib", "bdGrowth", "bdYears"].forEach(function (id) {
    el[id] = document.getElementById(id === "themeToggle" ? "theme-toggle" : id);
  });

  /* ---------- helpers ---------- */

  function fmtMoney(n) {
    if (!isFinite(n)) n = 0;
    n = Math.round(n);
    var sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(n).toLocaleString("en-US");
  }
  // Compact for big axis numbers: $1.2M, $850K
  function fmtCompact(n) {
    var a = Math.abs(n);
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + Math.round(n);
  }

  function readInputs() {
    var v = {};
    FIELDS.forEach(function (f) {
      var raw = parseFloat(el[f].value);
      v[f] = isFinite(raw) ? raw : 0;
    });
    v.realDollars = el.realDollars.checked;
    return v;
  }

  function writeInputs(v) {
    FIELDS.forEach(function (f) { el[f].value = v[f]; });
    el.realDollars.checked = !!v.realDollars;
  }

  /* ---------- projection ----------
     Contributions are made monthly, compounded monthly.
     Returns a per-year series so we can draw the growth curve. */
  function project(v) {
    var years = Math.max(0, Math.round(v.retireAge - v.currentAge));
    var months = years * 12;
    var iM = (v.rate / 100) / 12;          // monthly nominal return
    var infl = v.inflation / 100;

    var balance = Math.max(0, v.currentSavings);
    var contributed = Math.max(0, v.currentSavings); // principal deployed so far
    var monthly = Math.max(0, v.monthly);

    // series[k] = state at end of year k (k = 0..years)
    var series = [{ year: 0, balance: balance, contributed: contributed }];

    for (var m = 1; m <= months; m++) {
      balance = balance * (1 + iM) + monthly;
      contributed += monthly;
      if (m % 12 === 0) {
        series.push({ year: m / 12, balance: balance, contributed: contributed });
      }
    }
    // Ensure a final point exists even for a 0-year horizon.
    if (series.length === 1) series.push({ year: 0, balance: balance, contributed: contributed });

    var nestEgg = balance;
    var totalContrib = contributed;
    var growth = Math.max(0, nestEgg - totalContrib);

    // Inflation discount factor to bring retirement-date dollars to today.
    var deflator = Math.pow(1 + infl, years);

    // Target nest egg needed = desired annual income / withdrawal rate.
    // targetIncome is entered in today's dollars; grow it to nominal terms
    // at the retirement date so the comparison is apples to apples.
    var wr = Math.max(0.01, v.withdrawal / 100);
    var targetIncomeNominal = v.targetIncome * deflator;
    var neededNominal = targetIncomeNominal / wr;

    // Projected sustainable income at the chosen withdrawal rate.
    var projIncomeNominal = nestEgg * wr;

    return {
      years: years,
      series: series,
      nestEgg: nestEgg,
      totalContrib: totalContrib,
      growth: growth,
      neededNominal: neededNominal,
      projIncomeNominal: projIncomeNominal,
      targetIncomeNominal: targetIncomeNominal,
      deflator: deflator,
      wr: wr,
    };
  }

  /* ---------- required contribution to hit target ----------
     Solve FV annuity for the monthly payment that lands exactly on the
     needed nest egg, given current savings already invested. */
  function requiredMonthly(v, neededNominal) {
    var months = Math.max(0, Math.round(v.retireAge - v.currentAge)) * 12;
    if (months === 0) return Infinity;
    var iM = (v.rate / 100) / 12;
    var fvCurrent = Math.max(0, v.currentSavings) * Math.pow(1 + iM, months);
    var remaining = neededNominal - fvCurrent;
    if (remaining <= 0) return 0;
    var factor;
    if (iM === 0) factor = months;
    else factor = (Math.pow(1 + iM, months) - 1) / iM;
    return remaining / factor;
  }

  /* ---------- rendering ---------- */

  function render() {
    var v = readInputs();
    var p = project(v);
    var real = v.realDollars;
    var conv = real ? (1 / p.deflator) : 1; // multiply nominal → display

    // Headline nest egg
    el.headlineLbl.textContent = "Projected at age " + Math.round(v.retireAge);
    el.nestEgg.textContent = fmtMoney(p.nestEgg * conv);
    el.nestNote.textContent = real
      ? "in today's dollars · " + fmtMoney(p.nestEgg) + " when you retire"
      : "future dollars at retirement";

    // Income + needed
    el.projIncome.textContent = fmtMoney(p.projIncomeNominal * conv);
    el.incomeSub.textContent = "at " + v.withdrawal + "% withdrawal" + (real ? " · today's $" : "");
    el.needed.textContent = fmtMoney(p.neededNominal * conv);

    // Gap analysis (compare in nominal terms — conv cancels out)
    var surplus = p.nestEgg - p.neededNominal;
    var onTrack = surplus >= 0;
    var incomeDisplay = fmtMoney(p.targetIncomeNominal * conv);

    if (v.retireAge <= v.currentAge) {
      setStatus(false, "Set a retirement age past your current age");
      el.gapBox.className = "gap warn";
      el.gapLine.textContent = "Retirement age needs to be later than your current age.";
      el.gapHint.textContent = "";
    } else if (onTrack) {
      setStatus(true, "On track");
      el.gapBox.className = "gap good";
      el.gapLine.textContent = "You're ahead by " + fmtMoney(surplus * conv) + ".";
      el.gapHint.textContent = "That's roughly " + incomeDisplay + "/yr of income, with a "
        + fmtMoney(surplus * conv) + " cushion on top of your target.";
    } else {
      setStatus(false, "Behind target");
      var reqM = requiredMonthly(v, p.neededNominal);
      el.gapBox.className = "gap warn";
      el.gapLine.textContent = "Short by " + fmtMoney(-surplus * conv) + " at retirement.";
      if (isFinite(reqM)) {
        var extra = Math.max(0, reqM - Math.max(0, v.monthly));
        el.gapHint.textContent = "Contribute about " + fmtMoney(reqM) + "/mo ("
          + fmtMoney(extra) + " more) to close the gap — or retire later, or trim your target.";
      } else {
        el.gapHint.textContent = "Increase contributions or push your retirement age back.";
      }
    }

    // Breakdown
    el.bdContrib.textContent = fmtMoney(p.totalContrib * conv);
    el.bdGrowth.textContent = fmtMoney(p.growth * conv);
    el.bdYears.textContent = p.years;

    drawChart(v, p, conv);
  }

  function setStatus(ok, text) {
    el.status.className = "status" + (ok ? "" : " warn");
    el.statusText.textContent = text;
  }

  /* ---------- chart: stacked area (contributions + growth) with target line ---------- */
  function drawChart(v, p, conv) {
    var W = 500, H = 200, padL = 4, padR = 4, padT = 10, padB = 4;
    var iw = W - padL - padR, ih = H - padT - padB;
    var series = p.series;
    var n = series.length;
    if (n < 2) { el.chart.innerHTML = ""; el.chartX.innerHTML = ""; return; }

    var maxBal = 0;
    series.forEach(function (s) { if (s.balance > maxBal) maxBal = s.balance; });
    // Include the target so the reference line is always on-canvas.
    var top = Math.max(maxBal, p.neededNominal) * 1.08 || 1;

    function x(i) { return padL + (iw * i) / (n - 1); }
    function y(val) { return padT + ih - (ih * val) / top; }

    // Build stacked areas: bottom band = contributions, upper band = growth.
    var contribTop = [], balTop = [];
    for (var i = 0; i < n; i++) {
      contribTop.push([x(i), y(series[i].contributed)]);
      balTop.push([x(i), y(series[i].balance)]);
    }
    var base = padT + ih;

    // growth area (between contributions line and balance line)
    var growthPath = "M" + balTop.map(function (pt) { return pt[0] + "," + pt[1]; }).join(" L ");
    for (var g = n - 1; g >= 0; g--) growthPath += " L " + contribTop[g][0] + "," + contribTop[g][1];
    growthPath += " Z";

    // contributions area (from baseline up to contributions line)
    var contribPath = "M " + padL + "," + base + " L " +
      contribTop.map(function (pt) { return pt[0] + "," + pt[1]; }).join(" L ") +
      " L " + x(n - 1) + "," + base + " Z";

    // balance stroke line
    var balLine = "M " + balTop.map(function (pt) { return pt[0] + "," + pt[1]; }).join(" L ");

    var targetY = y(p.neededNominal);
    var showTarget = p.neededNominal > 0 && p.neededNominal <= top;

    var svg = ''
      + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Projected balance growth">'
      + '<path d="' + contribPath + '" fill="var(--contrib)" opacity="0.9"/>'
      + '<path d="' + growthPath + '" fill="var(--growth)" opacity="0.85"/>'
      + '<path d="' + balLine + '" fill="none" stroke="var(--growth)" stroke-width="2"/>'
      + (showTarget
          ? '<line x1="' + padL + '" y1="' + targetY + '" x2="' + (W - padR) + '" y2="' + targetY
            + '" stroke="var(--target)" stroke-width="2" stroke-dasharray="6 5"/>'
          : '')
      + '</svg>';
    el.chart.innerHTML = svg;

    // x-axis labels: start age, mid, retire age
    var startAge = Math.round(v.currentAge);
    var endAge = Math.round(v.retireAge);
    var midAge = Math.round((startAge + endAge) / 2);
    el.chartX.innerHTML =
      '<span>Age ' + startAge + '</span>' +
      '<span>' + midAge + '</span>' +
      '<span>' + endAge + '</span>';
  }

  /* ---------- persistence & wiring ---------- */

  function save() {
    var v = readInputs();
    v.realDollars = el.realDollars.checked;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) {}
  }

  function load() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
    if (!v || typeof v !== "object") v = DEFAULTS;
    // fill any missing keys from defaults
    Object.keys(DEFAULTS).forEach(function (k) {
      if (v[k] === undefined || v[k] === null || v[k] === "") v[k] = DEFAULTS[k];
    });
    writeInputs(v);
  }

  function onChange() { save(); render(); }

  FIELDS.forEach(function (f) {
    el[f].addEventListener("input", onChange);
  });
  el.realDollars.addEventListener("change", onChange);

  el.reset.addEventListener("click", function () {
    writeInputs(DEFAULTS);
    save();
    render();
  });

  /* theme */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    el.themeToggle.textContent = t === "dark" ? "☀️" : "🌙";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#0e1613" : "#0f766e");
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (!saved) {
      saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    applyTheme(saved);
  }
  el.themeToggle.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  /* boot */
  initTheme();
  load();
  render();
})();
