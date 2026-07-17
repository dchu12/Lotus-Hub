/* Derek & Kelly · Retirement Goal Status
   Cash-flow-driven retirement tracker. The waterfall:
     revenue − fixed − variable = monthly surplus
     → surplus is split (invest % / cash) into your accounts
     → accounts grow to your target year
     → projection vs. the nest egg your goal needs.
   All data stays in localStorage. */
(function () {
  "use strict";

  var STORE_KEY = "dk-retire:v3";
  var THEME_KEY = "dk-retire:theme";
  var THIS_YEAR = new Date().getFullYear();

  // Account types → behavior. grow: 'return'|'inflation'|'none';
  // income: counts toward retirement portfolio; sign: +asset / -liability.
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
        investPct: 85,
        realDollars: true,
      },
      incomes: [
        { id: "i1", name: "Derek — salary", amount: 7000, freq: "mo" },
        { id: "i2", name: "Kelly — salary", amount: 5500, freq: "mo" },
        { id: "i3", name: "Annual bonus", amount: 15000, freq: "yr" },
        { id: "i4", name: "Other income", amount: 250, freq: "mo" },
      ],
      fixed: [
        { id: "f1", name: "Mortgage", amount: 2600, freq: "mo" },
        { id: "f2", name: "Utilities & phone", amount: 350, freq: "mo" },
        { id: "f3", name: "Insurance", amount: 400, freq: "mo" },
        { id: "f4", name: "Car payment", amount: 500, freq: "mo" },
        { id: "f5", name: "Childcare", amount: 1300, freq: "mo" },
      ],
      variable: 3200, // total variable spending per month
      accounts: [
        { id: "a1", name: "Derek's 401(k)",     owner: "Derek", type: "investment", balance: 145000 },
        { id: "a2", name: "Kelly's 403(b)",     owner: "Kelly", type: "investment", balance: 98000 },
        { id: "a3", name: "Roth IRA",           owner: "Derek", type: "investment", balance: 42000 },
        { id: "a4", name: "Roth IRA",           owner: "Kelly", type: "investment", balance: 38000 },
        { id: "a5", name: "Brokerage",          owner: "Joint", type: "investment", balance: 60000 },
        { id: "a6", name: "Emergency savings",  owner: "Joint", type: "cash",       balance: 35000 },
        { id: "a7", name: "Home (market value)",owner: "Joint", type: "realestate", balance: 530000 },
        { id: "a8", name: "Mortgage",           owner: "Joint", type: "liability",  balance: 310000 },
      ],
    };
  }

  var state = defaults();
  var idSeq = 100;

  var el = {};
  ["household", "targetYear", "targetIncome", "rate", "inflation", "withdrawal", "realDollars", "investPct",
   "investPctLbl", "splitNote", "variable", "saveRate",
   "addIncome", "addFixed", "addAcct", "incomeList", "fixedList", "acctList",
   "theme-toggle", "hhTitle",
   "status", "statusText", "projLbl", "projPortfolio", "projNote", "progressFill", "progressPct",
   "incMo", "incYr", "expMo", "expYr", "surMo", "surYr",
   "netWorth", "portfolioNow", "monthlySave", "ownerSplit",
   "projIncome", "incomeSub", "needed", "gapBox", "gapLine", "gapHint", "chart", "chartX"].forEach(function (id) {
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

  /* ---------- cash flow ---------- */
  function cashflow() {
    var incomeMo = state.incomes.reduce(function (s, i) { return s + monthlyOf(i); }, 0);
    var fixedMo = state.fixed.reduce(function (s, f) { return s + monthlyOf(f); }, 0);
    var varMo = num(state.variable);
    var expenseMo = fixedMo + varMo;
    var surplusMo = incomeMo - expenseMo;
    var saveRate = incomeMo > 0 ? surplusMo / incomeMo : 0;
    var pct = Math.max(0, Math.min(100, num(state.settings.investPct, 85))) / 100;
    var savePos = Math.max(0, surplusMo);
    return {
      incomeMo: incomeMo, expenseMo: expenseMo, surplusMo: surplusMo, saveRate: saveRate,
      investMo: savePos * pct, cashMo: savePos * (1 - pct), saveMo: savePos,
    };
  }

  /* ---------- projection ---------- */
  function project(cf) {
    var s = state.settings;
    var years = Math.max(0, Math.round(s.targetYear - THIS_YEAR));
    var months = years * 12;
    var rMonthly = (s.rate / 100) / 12;
    var infl = s.inflation / 100;

    // current tallies
    var netWorth = 0, invStart = 0, cashStart = 0;
    var ownerNow = { Derek: 0, Kelly: 0, Joint: 0 };
    state.accounts.forEach(function (a) {
      var t = TYPES[a.type] || TYPES.investment;
      var bal = num(a.balance);
      netWorth += t.sign * bal;
      if (a.type === "investment") invStart += bal;
      if (a.type === "cash") cashStart += bal;
      if (t.income) { if (ownerNow[a.owner] === undefined) ownerNow[a.owner] = 0; ownerNow[a.owner] += bal; }
    });
    var portfolioNow = invStart + cashStart;

    // Two buckets grown monthly: investments (return + investMo), cash (0% + cashMo).
    var invBal = invStart, cashBal = cashStart;
    var invContrib = invStart, cashContrib = cashStart;
    var series = [{ year: 0, balance: portfolioNow, contributed: portfolioNow }];
    for (var m = 1; m <= months; m++) {
      invBal = invBal * (1 + rMonthly) + cf.investMo;
      invContrib += cf.investMo;
      cashBal = cashBal + cf.cashMo; // cash: no growth
      cashContrib += cf.cashMo;
      if (m % 12 === 0) series.push({ year: m / 12, balance: invBal + cashBal, contributed: invContrib + cashContrib });
    }
    if (series.length < 2) series.push({ year: 0, balance: portfolioNow, contributed: portfolioNow });

    var projPortfolio = series[series.length - 1].balance;
    var projContributed = series[series.length - 1].contributed;
    var deflator = Math.pow(1 + infl, years);
    var wr = Math.max(0.01, s.withdrawal / 100);
    var neededReal = s.targetIncome / wr;
    var neededNominal = neededReal * deflator;

    return {
      years: years, series: series,
      netWorth: netWorth, portfolioNow: portfolioNow, ownerNow: ownerNow,
      invStart: invStart, cashStart: cashStart,
      projPortfolio: projPortfolio, projContributed: projContributed,
      projGrowth: Math.max(0, projPortfolio - projContributed),
      neededReal: neededReal, neededNominal: neededNominal,
      projIncomeNominal: projPortfolio * wr,
      deflator: deflator, wr: wr, infl: infl,
    };
  }

  // Monthly amount you'd need to INVEST to hit the goal, given current balances.
  function requiredInvestMonthly(p) {
    var months = p.years * 12;
    if (months === 0) return Infinity;
    var r = (state.settings.rate / 100) / 12;
    var fv = p.invStart * Math.pow(1 + r, months) + p.cashStart; // cash doesn't grow
    var remaining = p.neededNominal - fv;
    if (remaining <= 0) return 0;
    var factor = r === 0 ? months : (Math.pow(1 + r, months) - 1) / r;
    return remaining / factor;
  }

  /* ---------- render: everything ---------- */
  function renderAll() {
    var s = state.settings;
    var cf = cashflow();
    var p = project(cf);
    var real = s.realDollars;
    var conv = real ? (1 / p.deflator) : 1;

    el.hhTitle.textContent = s.household || "Retirement";
    document.title = (s.household || "Retirement") + " · Retirement Goal Status";

    // cash flow summary
    el.incMo.textContent = fmtMoney(cf.incomeMo);
    el.incYr.textContent = fmtMoney(cf.incomeMo * 12);
    el.expMo.textContent = fmtMoney(cf.expenseMo);
    el.expYr.textContent = fmtMoney(cf.expenseMo * 12);
    el.surMo.textContent = fmtMoney(cf.surplusMo);
    el.surYr.textContent = fmtMoney(cf.surplusMo * 12);
    el.surMo.parentElement.classList.toggle("neg", cf.surplusMo < 0);
    var rate = Math.round(cf.saveRate * 100);
    el.saveRate.textContent = (cf.surplusMo >= 0 ? rate + "% savings rate" : "Overspending");
    el.investPctLbl.textContent = Math.round(num(s.investPct, 85)) + "%";
    if (cf.surplusMo <= 0) {
      el.splitNote.textContent = "No surplus to invest — trim expenses or raise income.";
    } else {
      el.splitNote.textContent = "≈ " + fmtMoney(cf.investMo) + "/mo to investments · " + fmtMoney(cf.cashMo) + "/mo to cash.";
    }

    // account totals
    el.netWorth.textContent = fmtMoney(p.netWorth);
    el.portfolioNow.textContent = fmtMoney(p.portfolioNow);
    el.monthlySave.textContent = fmtMoney(cf.saveMo);

    // headline projection
    el.projPortfolio.textContent = fmtMoney(p.projPortfolio * conv);
    el.projNote.textContent = real
      ? "in today's dollars · " + fmtMoney(p.projPortfolio) + " nominal at retirement"
      : "future dollars at retirement";
    el.projIncome.textContent = fmtMoney(p.projIncomeNominal * conv);
    el.incomeSub.textContent = "at " + s.withdrawal + "% withdrawal" + (real ? " · today's $" : "");
    el.needed.textContent = fmtMoney(p.neededNominal * conv);

    // progress
    var ratio = p.neededNominal > 0 ? p.projPortfolio / p.neededNominal : 0;
    el.progressFill.style.width = Math.max(0, Math.min(100, ratio * 100)) + "%";
    el.progressPct.textContent = Math.round(ratio * 100) + "%";

    // status + coaching
    var surplusGoal = p.projPortfolio - p.neededNominal;
    if (s.targetYear <= THIS_YEAR) {
      setStatus(false, "Set a future year");
      el.projLbl.textContent = "Retirement year is in the past";
      el.gapBox.className = "gap warn";
      el.gapLine.textContent = "Set a retirement year later than " + THIS_YEAR + ".";
      el.gapHint.textContent = "";
    } else {
      el.projLbl.textContent = "On pace to retire in " + p.years + (p.years === 1 ? " year (" : " years (") + s.targetYear + ")";
      if (cf.surplusMo <= 0) {
        setStatus(false, "No savings");
        el.gapBox.className = "gap warn";
        el.gapLine.textContent = "You're spending everything you earn.";
        el.gapHint.textContent = "Expenses of " + fmtMoney(cf.expenseMo) + "/mo meet or exceed income of "
          + fmtMoney(cf.incomeMo) + "/mo — there's no surplus to invest. Cut spending or raise income to start building toward the goal.";
      } else if (surplusGoal >= 0) {
        setStatus(true, "On track");
        el.gapBox.className = "gap good";
        el.gapLine.textContent = "Ahead of goal by " + fmtMoney(surplusGoal * conv) + ".";
        el.gapHint.textContent = "Saving " + fmtMoney(cf.saveMo) + "/mo (a " + Math.round(cf.saveRate * 100)
          + "% savings rate) gets you to about " + fmtMoney(p.projIncomeNominal * conv) + "/yr — past your "
          + fmtMoney(s.targetIncome) + "/yr target, so you could ease off or retire earlier.";
      } else {
        setStatus(false, "Behind goal");
        el.gapBox.className = "gap warn";
        var reqInv = requiredInvestMonthly(p);
        el.gapLine.textContent = "Short of goal by " + fmtMoney(-surplusGoal * conv) + ".";
        if (isFinite(reqInv)) {
          var extra = Math.max(0, reqInv - cf.investMo);
          el.gapHint.textContent = "Invest about " + fmtMoney(reqInv) + "/mo (" + fmtMoney(extra)
            + " more than today) to close it — find it by trimming the " + fmtMoney(cf.expenseMo)
            + "/mo of expenses, raising income, or retiring later.";
        } else {
          el.gapHint.textContent = "Increase savings or push the retirement year back.";
        }
      }
    }

    renderOwnerSplit(p);
    drawChart(p, real);
  }

  function setStatus(ok, text) { el.status.className = "status" + (ok ? "" : " warn"); el.statusText.textContent = text; }

  function renderOwnerSplit(p) {
    var maxVal = Math.max(1, p.ownerNow.Derek, p.ownerNow.Kelly, p.ownerNow.Joint);
    var colors = { Derek: "var(--derek)", Kelly: "var(--kelly)", Joint: "var(--joint)" };
    el.ownerSplit.innerHTML = OWNERS.map(function (o) {
      var v = p.ownerNow[o] || 0;
      return '<div class="os-row"><span class="os-name">' + o + '</span>'
        + '<span class="os-bar"><i style="width:' + Math.round((v / maxVal) * 100) + '%;background:' + colors[o] + '"></i></span>'
        + '<span class="os-val">' + fmtMoney(v) + '</span></div>';
    }).join("");
  }

  /* ---------- chart ---------- */
  function drawChart(p, real) {
    var W = 500, H = 190, padL = 4, padR = 4, padT = 10, padB = 4;
    var iw = W - padL - padR, ih = H - padT - padB;
    var infl = p.infl;
    var pts = p.series.map(function (d) {
      var f = real ? 1 / Math.pow(1 + infl, d.year) : 1;
      return { year: d.year, balance: d.balance * f, contributed: d.contributed * f };
    });
    var neededLine = real ? p.neededReal : p.neededNominal;
    var n = pts.length;
    if (n < 2) { el.chart.innerHTML = ""; el.chartX.innerHTML = ""; return; }

    var maxBal = 0; pts.forEach(function (d) { if (d.balance > maxBal) maxBal = d.balance; });
    var top = Math.max(maxBal, neededLine) * 1.08 || 1;
    function x(i) { return padL + (iw * i) / (n - 1); }
    function y(v) { return padT + ih - (ih * v) / top; }
    var base = padT + ih;

    var contribTop = pts.map(function (d, i) { return [x(i), y(d.contributed)]; });
    var balTop = pts.map(function (d, i) { return [x(i), y(d.balance)]; });
    var growthPath = "M" + balTop.map(function (q) { return q[0] + "," + q[1]; }).join(" L ");
    for (var g = n - 1; g >= 0; g--) growthPath += " L " + contribTop[g][0] + "," + contribTop[g][1];
    growthPath += " Z";
    var contribPath = "M " + padL + "," + base + " L " + contribTop.map(function (q) { return q[0] + "," + q[1]; }).join(" L ") + " L " + x(n - 1) + "," + base + " Z";
    var balLine = "M " + balTop.map(function (q) { return q[0] + "," + q[1]; }).join(" L ");
    var ty = y(neededLine);
    var showTarget = neededLine > 0 && neededLine <= top;

    el.chart.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Projected portfolio growth toward goal">'
      + '<path d="' + contribPath + '" fill="var(--contrib)" opacity="0.9"/>'
      + '<path d="' + growthPath + '" fill="var(--growth)" opacity="0.85"/>'
      + '<path d="' + balLine + '" fill="none" stroke="var(--growth)" stroke-width="2"/>'
      + (showTarget ? '<line x1="' + padL + '" y1="' + ty + '" x2="' + (W - padR) + '" y2="' + ty + '" stroke="var(--target)" stroke-width="2" stroke-dasharray="6 5"/>' : '')
      + '</svg>';
    var midYear = THIS_YEAR + Math.round(p.years / 2);
    el.chartX.innerHTML = '<span>' + THIS_YEAR + '</span><span>' + midYear + '</span><span>' + state.settings.targetYear + '</span>';
  }

  /* ---------- render: editable line lists ---------- */
  function renderLineList(container, arr) {
    if (!arr.length) { container.innerHTML = '<div class="acct-empty">Nothing here yet — add a line.</div>'; return; }
    container.innerHTML = "";
    arr.forEach(function (item, idx) {
      var row = document.createElement("div");
      row.className = "line-row";
      row.innerHTML =
        '<span class="cell-name"><input type="text" data-i="' + idx + '" data-f="name" value="' + escapeHtml(item.name) + '" placeholder="Name" autocomplete="off" /></span>'
      + '<span class="cell-amt"><input type="number" inputmode="decimal" step="50" data-i="' + idx + '" data-f="amount" value="' + item.amount + '" /></span>'
      + '<span class="cell-freq"><select data-i="' + idx + '" data-f="freq">'
        + '<option value="mo"' + (item.freq === "mo" ? " selected" : "") + '>/mo</option>'
        + '<option value="yr"' + (item.freq === "yr" ? " selected" : "") + '>/yr</option></select></span>'
      + '<span class="cell-del"><button type="button" class="del-btn" data-del="' + idx + '" aria-label="Remove">×</button></span>';
      container.appendChild(row);
    });
    container.querySelectorAll("input, select").forEach(function (input) {
      input.addEventListener(input.tagName === "SELECT" ? "change" : "input", function () {
        var it = arr[+input.getAttribute("data-i")]; if (!it) return;
        var f = input.getAttribute("data-f");
        it[f] = f === "amount" ? num(input.value) : input.value;
        save(); renderAll();
      });
    });
    container.querySelectorAll(".del-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        arr.splice(+btn.getAttribute("data-del"), 1);
        save(); renderLineList(container, arr); renderAll();
      });
    });
  }

  /* ---------- render: accounts ---------- */
  function renderAccounts() {
    if (!state.accounts.length) {
      el.acctList.innerHTML = '<div class="acct-empty">No accounts yet — add your 401(k), IRA, brokerage, savings…</div>';
      return;
    }
    el.acctList.innerHTML = "";
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
      + '<span class="cell-del"><button type="button" class="del-btn" data-del="' + idx + '" aria-label="Remove ' + escapeHtml(a.name) + '">×</button></span>';
      el.acctList.appendChild(row);
    });
    el.acctList.querySelectorAll("input, select").forEach(function (input) {
      input.addEventListener(input.tagName === "SELECT" ? "change" : "input", function () {
        var a = state.accounts[+input.getAttribute("data-i")]; if (!a) return;
        var f = input.getAttribute("data-f");
        a[f] = f === "balance" ? num(input.value) : input.value;
        save(); renderAll();
      });
    });
    el.acctList.querySelectorAll(".del-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.accounts.splice(+btn.getAttribute("data-del"), 1);
        save(); renderAccounts(); renderAll();
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
    el.withdrawal.value = s.withdrawal;
    el.investPct.value = s.investPct;
    el.realDollars.checked = !!s.realDollars;
    el.variable.value = state.variable;
  }

  function wire() {
    el.household.addEventListener("input", function () { state.settings.household = el.household.value; save(); renderAll(); });
    [["targetYear", "targetYear"], ["targetIncome", "targetIncome"], ["rate", "rate"], ["inflation", "inflation"], ["withdrawal", "withdrawal"], ["investPct", "investPct"]]
      .forEach(function (pair) {
        el[pair[0]].addEventListener("input", function () { state.settings[pair[1]] = num(el[pair[0]].value); save(); renderAll(); });
      });
    el.realDollars.addEventListener("change", function () { state.settings.realDollars = el.realDollars.checked; save(); renderAll(); });
    el.variable.addEventListener("input", function () { state.variable = num(el.variable.value); save(); renderAll(); });

    el.addIncome.addEventListener("click", function () {
      state.incomes.push({ id: "i" + (++idSeq), name: "", amount: 0, freq: "mo" });
      save(); renderLineList(el.incomeList, state.incomes); renderAll();
    });
    el.addFixed.addEventListener("click", function () {
      state.fixed.push({ id: "f" + (++idSeq), name: "", amount: 0, freq: "mo" });
      save(); renderLineList(el.fixedList, state.fixed); renderAll();
    });
    el.addAcct.addEventListener("click", function () {
      state.accounts.push({ id: "a" + (++idSeq), name: "", owner: "Joint", type: "investment", balance: 0 });
      save(); renderAccounts(); renderAll();
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
      };
    } else {
      state = d;
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
  wire();
  renderLineList(el.incomeList, state.incomes);
  renderLineList(el.fixedList, state.fixed);
  renderAccounts();
  renderAll();
})();
