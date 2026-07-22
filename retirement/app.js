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

  // ONE stable storage key — deliberately un-versioned. It must NEVER change
  // again: renaming it is what wiped data before. New fields are handled by
  // merging with defaults on load (see mergeState), not by a new key.
  var STORE_KEY = "dk-retire";
  var LEGACY_KEYS = ["dk-retire:v6", "dk-retire:v5", "dk-retire:v4", "dk-retire:v3", "dk-retire:v2", "dk-retire:v1"];
  var THEME_KEY = "dk-retire:theme";
  var THIS_YEAR = new Date().getFullYear();

  // taxWeight = share of a withdrawal that's taxable income in retirement:
  //   1 = fully taxed (RRSP/401k), 0.5 ≈ non-registered (capital gains),
  //   0 = tax-free (TFSA/Roth, or already-taxed cash).
  var TYPES = {
    investment: { label: "Taxable (RRSP/401k)", income: true, taxWeight: 1 },
    tfsa:       { label: "Tax-free (TFSA/Roth)", income: true, taxWeight: 0 },
    nonreg:     { label: "Non-registered", income: true, taxWeight: 0.5 },
    cash:       { label: "Cash / savings", income: true, taxWeight: 0 },
    realestate: { label: "Home / property", income: false },
    other:      { label: "Other asset", income: false },
  };
  var OWNERS = ["Derek", "Kelly", "Joint"];

  function defaults() {
    return {
      settings: {
        household: "Derek & Kelly",
        currentAge: 45,
        partnerAge: 0,
        retireAge: 65,
        planThroughAge: 95,
        targetIncome: 80000,
        rate: 6.0,
        inflation: 2.5,
        cashYield: 3.5,
        investPct: 85,
        debtPaydown: 150,
        retireTaxRate: 15,
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
        { id: "a3", name: "Roth IRA",           owner: "Derek", type: "tfsa",       balance: 24000 },
        { id: "a4", name: "Roth IRA",           owner: "Kelly", type: "tfsa",       balance: 20000 },
        { id: "a5", name: "Brokerage",          owner: "Joint", type: "nonreg",     balance: 20000 },
        { id: "a6", name: "Emergency savings",  owner: "Joint", type: "cash",       balance: 22000 },
        { id: "a7", name: "Home",               owner: "Joint", type: "realestate", balance: 460000 },
      ],
      debts: [
        { id: "d1", name: "Mortgage", balance: 265000, apr: 6.3, payment: 2150 },
        { id: "d2", name: "Car loan", balance: 14000,  apr: 6.9, payment: 420 },
      ],
      retIncomes: [
        { id: "r1", name: "Social Security (combined)", amount: 38000, startAge: 67, owner: "both" },
      ],
      oneTime: [],
      windfalls: [],
      history: [],
    };
  }

  var state = defaults();
  var idSeq = 100;

  var el = {};
  ["household", "currentAge", "partnerAge", "retireAge", "planThroughAge", "targetIncome", "rate", "inflation", "cashYield",
   "investPct", "investPctLbl", "splitNote", "variable", "debtPaydown", "retireTaxRate", "realNote",
   "addIncome", "addFixed", "addAcct", "addDebt", "addRet", "addOneTime", "addWindfall",
   "incomeList", "fixedList", "acctList", "debtList", "retList", "otList", "wfList", "nwHistory", "debtNote",
   "theme-toggle", "hhTitle",
   "status", "statusText", "verdictLine", "verdictSub", "progressFill", "progressPct",
   "incMo", "expMo", "leaves", "netWorth", "portfolioNow",
   "spendLbl", "lastsAge", "lastsSub", "confidence", "earliest", "chart", "chartX", "whatifList",
   "milestones", "countdown", "coastLine", "efund",
   "resetBtn", "copyLink", "saveFile", "loadData", "dataMsg", "saveStatus", "printBtn", "printSummary"].forEach(function (id) {
    el[id.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = document.getElementById(id);
  });

  /* ---------- helpers ---------- */
  function fmtMoney(n) {
    if (!isFinite(n)) n = 0;
    n = Math.round(n);
    return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US");
  }
  function num(v, fb) { var x = parseFloat(String(v).replace(/[$,\s]/g, "")); return isFinite(x) ? x : (fb || 0); }
  // Format a money value with thousands separators for display in an input.
  function commafy(v) { var n = num(v); return isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0"; }
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
  // Retirement income (CPP/OAS, Social Security, pensions) active when YOU are
  // youAge. A source marked "partner" starts at the partner's age — since the
  // whole timeline runs on your age, we shift it by the age gap so a younger
  // partner's income kicks in the right number of years later.
  function partnerGap() {
    var s = state.settings, pa = num(s.partnerAge);
    return (pa >= 10 && pa < 120) ? (num(s.currentAge) - pa) : 0; // + if partner is younger
  }
  function retIncomeAt(youAge) {
    var gap = partnerGap();
    return state.retIncomes.reduce(function (sum, r) {
      var eff = (r.owner === "partner") ? num(r.startAge) + gap : num(r.startAge);
      return sum + (youAge >= eff ? num(r.amount) : 0);
    }, 0);
  }
  // Big one-time costs (a car, tuition, a trip) that fall on a given age.
  function oneTimeAt(age) {
    return state.oneTime.reduce(function (sum, o) {
      return sum + (Math.round(num(o.atAge)) === age ? num(o.amount) : 0);
    }, 0);
  }
  // One-time money coming in (downsizing, inheritance, a sale) — treated as
  // tax-free lump sums added to savings at a given age.
  function windfallAt(age) {
    return state.windfalls.reduce(function (sum, w) {
      return sum + (Math.round(num(w.atAge)) === age ? num(w.amount) : 0);
    }, 0);
  }
  // Retirement taxes. taxWeight of the portfolio (share that's taxable when
  // withdrawn) × the effective retirement tax rate gives the drag on
  // withdrawals; retirement income (CPP/OAS/pension) is taxed at the full rate.
  function retTaxRate() { return Math.max(0, Math.min(60, num(state.settings.retireTaxRate))) / 100; }
  function portfolioTaxWeight() {
    var tot = 0, wsum = 0;
    state.accounts.forEach(function (a) {
      var t = TYPES[a.type];
      if (t && t.income) { var b = num(a.balance); tot += b; wsum += b * (t.taxWeight || 0); }
    });
    return tot > 0 ? wsum / tot : 0;
  }
  function taxInfo() { var rate = retTaxRate(); return { rate: rate, effW: Math.min(0.95, rate * portfolioTaxWeight()) }; }

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
  function simulate(cf, nominalRate, stopSaveAge) {
    if (stopSaveAge == null) stopSaveAge = Infinity; // age at which new saving stops (coast); Infinity = save the whole way
    var s = state.settings;
    var currentAge = num(s.currentAge), retireAge = num(s.retireAge), endAge = num(s.planThroughAge);
    var accumYears = Math.max(0, Math.round(retireAge - currentAge));
    var months = accumYears * 12;
    var rRet = realMonthly(nominalRate), rCash = realMonthly(s.cashYield), rDraw = realAnnual(nominalRate);

    var invStart = 0, cashStart = 0;
    state.accounts.forEach(function (a) {
      var t = TYPES[a.type]; if (!t || !t.income) return;
      if (a.type === "cash") cashStart += num(a.balance); else invStart += num(a.balance); // tfsa/nonreg grow like investments
    });
    var liabs = state.debts.map(function (d) {
      return { bal: num(d.balance), rate: realMonthly(d.apr), payment: num(d.payment), paidOff: num(d.balance) <= 0 };
    });

    var invBal = invStart, cashBal = cashStart;
    var series = [{ age: currentAge, bal: invStart + cashStart }];
    for (var m = 1; m <= months; m++) {
      var contribute = (currentAge + m / 12) < stopSaveAge; // once coasting, debts still amortize but no new money is added
      var freed = 0;
      liabs.forEach(function (l) { if (l.paidOff) freed += l.payment; });
      var extra = contribute ? cf.debtMo : 0;
      liabs.forEach(function (l) {
        if (l.paidOff) return;
        l.bal *= (1 + l.rate);
        if (l.payment >= l.bal) { extra += (l.payment - l.bal); l.bal = 0; l.paidOff = true; }
        else l.bal -= l.payment;
      });
      liabs.filter(function (l) { return !l.paidOff; }).sort(function (a, b) { return b.rate - a.rate; })
           .forEach(function (l) { if (extra <= 0) return; var ap = Math.min(extra, l.bal); l.bal -= ap; extra -= ap; if (l.bal <= 0) l.paidOff = true; });
      var pool = contribute ? (freed + Math.max(0, extra)) : 0;
      invBal = invBal * (1 + rRet) + (contribute ? cf.investMo : 0) + pool * cf.pct;
      cashBal = cashBal * (1 + rCash) + (contribute ? cf.cashMo : 0) + pool * (1 - cf.pct);
      if (m % 12 === 0) {
        var yrAge = currentAge + m / 12;
        var wf = windfallAt(yrAge); if (wf > 0) invBal += wf; // one-time money in lands in investments
        var ot = oneTimeAt(yrAge);                            // one-time costs: cash first, then investments
        if (ot > 0) { var fromCash = Math.min(cashBal, ot); cashBal -= fromCash; invBal = Math.max(0, invBal - (ot - fromCash)); }
        series.push({ age: yrAge, bal: invBal + cashBal });
      }
    }

    var retireBal = invBal + cashBal;
    var bal = retireBal, runOutAge = null, tax = taxInfo();
    for (var age = retireAge; age < endAge; age++) {
      bal += windfallAt(age); // one-time money in (tax-free, e.g. downsizing)
      if (bal > 0) {
        var netInc = retIncomeAt(age) * (1 - tax.rate);                       // CPP/OAS/pension after tax
        var netNeed = Math.max(0, num(s.targetIncome) - netInc) + oneTimeAt(age);
        bal -= netNeed / (1 - tax.effW);                                       // gross-up the taxable withdrawal
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
    var s = state.settings, retireAge = num(s.retireAge), endAge = num(s.planThroughAge), needed = 0, tax = taxInfo();
    for (var t = 0; t < Math.max(0, endAge - retireAge); t++) {
      var age = retireAge + t;
      var netInc = retIncomeAt(age) * (1 - tax.rate);
      var netNeed = Math.max(0, num(s.targetIncome) - netInc) + oneTimeAt(age);
      var gross = netNeed / (1 - tax.effW) - windfallAt(age); // windfalls reduce what savings must cover
      needed += gross / Math.pow(1 + rDraw, t);
    }
    return Math.max(0, needed);
  }

  // Largest yearly spending the retirement balance can sustain to the plan age.
  function maxSpend(retireBal, rDraw) {
    var s = state.settings, retireAge = num(s.retireAge), endAge = num(s.planThroughAge);
    var tax = taxInfo();
    function lasts(spend) {
      var bal = retireBal;
      for (var age = retireAge; age < endAge; age++) {
        bal += windfallAt(age);
        var netInc = retIncomeAt(age) * (1 - tax.rate);
        bal -= (Math.max(0, spend - netInc) + oneTimeAt(age)) / (1 - tax.effW);
        if (bal < 0) return false;
        bal *= (1 + rDraw);
      }
      return true;
    }
    var lo = 0, hi = Math.max(num(s.targetIncome) * 3, retireBal / 2 + 1);
    for (var i = 0; i < 44; i++) { var mid = (lo + hi) / 2; if (lasts(mid)) lo = mid; else hi = mid; }
    return lo;
  }

  // Soonest retirement age at which the money still lasts to the plan age,
  // holding everything else constant. Temporarily varies retireAge for the sim.
  function earliestRetireAge(cf) {
    var s = state.settings;
    var saved = s.retireAge;
    var start = Math.max(Math.round(num(s.currentAge)) + 1, 25);
    var end = Math.round(num(s.planThroughAge)) - 1;
    var found = null;
    for (var a = start; a <= end; a++) {
      s.retireAge = a;
      if (simulate(cf, s.rate).lastsToEnd) { found = a; break; }
    }
    s.retireAge = saved;
    return found;
  }

  // "Coast" age: the earliest age you could stop adding new money to savings and
  // still have the plan last to the end (your pot keeps growing on its own). Null
  // if the plan doesn't last even when saving the whole way.
  function coastStopAge(cf) {
    var s = state.settings;
    if (!simulate(cf, s.rate).lastsToEnd) return null;
    var start = Math.round(num(s.currentAge)), retire = Math.round(num(s.retireAge));
    for (var a = start; a <= retire; a++) {
      if (simulate(cf, s.rate, a).lastsToEnd) return a;
    }
    return retire;
  }

  // Standard normal via Box–Muller (for the market simulation).
  function gaussian() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // Chance of success: draw down the retirement pot under many random market
  // paths (returns vary year to year) and count how often the money lasts.
  function mcSuccess(retireBal, meanReal) {
    var s = state.settings, retireAge = num(s.retireAge), endAge = num(s.planThroughAge), tax = taxInfo();
    var sigma = 0.09, N = 300, ok = 0; // ~9% real annual volatility (diversified mix)
    for (var i = 0; i < N; i++) {
      var bal = retireBal, survived = true;
      for (var age = retireAge; age < endAge; age++) {
        bal += windfallAt(age);
        var netInc = retIncomeAt(age) * (1 - tax.rate);
        bal -= (Math.max(0, num(s.targetIncome) - netInc) + oneTimeAt(age)) / (1 - tax.effW);
        if (bal <= 0) { survived = false; break; }
        bal *= (1 + meanReal + sigma * gaussian());
      }
      if (survived) ok++;
    }
    return ok / N;
  }

  // Record a net-worth snapshot once per calendar month for the trend line.
  function snapshotHistory() {
    var m;
    try { m = new Date().toISOString().slice(0, 7); } catch (e) { return; }
    var nw = 0;
    state.accounts.forEach(function (a) { nw += num(a.balance); });
    state.debts.forEach(function (d) { nw -= num(d.balance); });
    var h = state.history;
    if (h.length && h[h.length - 1].m === m) h[h.length - 1].nw = nw;
    else { h.push({ m: m, nw: nw }); if (h.length > 240) h.shift(); }
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
    state.accounts.forEach(function (a) { var t = TYPES[a.type]; netWorth += num(a.balance); if (t && t.income) portfolioNow += num(a.balance); });
    state.debts.forEach(function (d) { debtStart += num(d.balance); netWorth -= num(d.balance); });
    el.netWorth.textContent = fmtMoney(netWorth);
    el.portfolioNow.textContent = fmtMoney(portfolioNow);
    renderHistory();
    renderEmergencyFund(cf);

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
      el.lastsAge.textContent = "—"; el.lastsSub.textContent = ""; el.confidence.textContent = ""; el.confidence.className = "confidence";
      el.earliest.textContent = ""; el.earliest.className = "earliest";
      el.milestones.hidden = true;
      el.chart.innerHTML = ""; el.chartX.innerHTML = "";
      el.printSummary.innerHTML = '<p class="ps-fine">Enter your ages and plan to see a summary.</p>';
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

    // chance of success across many random market paths (Monte Carlo)
    var success = Math.round(mcSuccess(exp.retireBal, realAnnual(s.rate)) * 100);
    if (success >= 85) {
      el.confidence.className = "confidence good";
      el.confidence.textContent = "✅ Strong plan — your money lasts in about " + success + "% of market scenarios.";
    } else if (success >= 70) {
      el.confidence.className = "confidence";
      el.confidence.textContent = "👍 Fairly safe — lasts in about " + success + "% of market scenarios. A cushion would help.";
    } else {
      el.confidence.className = "confidence warn";
      el.confidence.textContent = "⚠️ Shaky — lasts in only about " + success + "% of market scenarios. Consider spending less, saving more, or retiring later.";
    }

    // earliest age you could retire at this spending
    var earliest = earliestRetireAge(cf);
    var chosen = Math.round(num(s.retireAge));
    if (earliest == null) {
      el.earliest.className = "earliest warn";
      el.earliest.textContent = "Even by working longer, spending " + fmtMoney(s.targetIncome) + "/yr doesn't quite last — trimming spending a little would fix it.";
    } else if (earliest < chosen) {
      el.earliest.className = "earliest good";
      el.earliest.textContent = "🎯 Earliest you could retire: about age " + earliest + " — that's " + (chosen - earliest) + " year" + (chosen - earliest === 1 ? "" : "s") + " sooner than your plan.";
    } else if (earliest === chosen) {
      el.earliest.className = "earliest";
      el.earliest.textContent = "🎯 Age " + chosen + " is about the earliest you can retire at this spending.";
    } else {
      el.earliest.className = "earliest";
      el.earliest.textContent = "🎯 Earliest you could retire at this spending: about age " + earliest + ".";
    }

    // countdown to retirement + "coast" point (when you could stop adding to savings)
    renderMilestones(cf, exp);

    // verdict
    if (exp.lastsToEnd) {
      setStatus(true, "On track");
      el.verdictLine.textContent = "Retiring at " + s.retireAge + " in " + retireYear + " and spending " + fmtMoney(s.targetIncome)
        + " a year, your savings last through age " + endAge + ". You're on track. 🎉";
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

    // printable one-page summary (shown only when printing / saving as PDF)
    function psItem(label, val) { return '<div class="ps-item"><span>' + label + '</span><b>' + escapeHtml(String(val)) + '</b></div>'; }
    el.printSummary.innerHTML =
        '<div class="ps-head"><h1>' + escapeHtml(s.household || "Retirement") + '</h1><p>Retirement summary — all figures in today’s dollars</p></div>'
      + '<p class="ps-verdict">' + escapeHtml(el.verdictLine.textContent) + '</p>'
      + '<div class="ps-grid">'
      + psItem("Money lasts to", el.lastsAge.textContent)
      + psItem("Retire at age", s.retireAge + " (in " + retireYear + ")")
      + psItem("Yearly spending", fmtMoney(s.targetIncome))
      + psItem("On track", Math.round(ratio * 100) + "% of your goal")
      + psItem("Net worth today", fmtMoney(netWorth))
      + psItem("Retirement savings", fmtMoney(portfolioNow))
      + psItem("Saving per month", fmtMoney(cf.saveMo))
      + psItem("Could spend up to", fmtMoney(msMax) + "/yr")
      + '</div>'
      + '<p class="ps-note">' + escapeHtml(el.earliest.textContent) + '</p>'
      + '<p class="ps-fine">Estimates only — not financial advice. Revisit as your plan changes.</p>';
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

  // Countdown to retirement + the "coast" point — the age you could stop adding
  // to savings and still coast to the finish.
  function renderMilestones(cf, exp) {
    var s = state.settings;
    var years = Math.max(0, Math.round(num(s.retireAge) - num(s.currentAge)));
    var retireYear = THIS_YEAR + years;
    el.countdown.textContent = years <= 0
      ? "⏳ Retirement age reached"
      : "⏳ " + years + " year" + (years === 1 ? "" : "s") + " to retirement · around " + retireYear;

    if (!exp.lastsToEnd) {
      // not on track — the verdict already explains; keep the coast line quiet
      el.coastLine.textContent = "";
      el.coastLine.className = "ms-coast";
    } else {
      var coast = coastStopAge(cf), nowAge = Math.round(num(s.currentAge));
      if (coast != null && coast <= nowAge) {
        el.coastLine.className = "ms-coast good";
        el.coastLine.textContent = "🏖️ You're already there — you could stop adding to savings today and still coast to the finish.";
      } else if (coast != null && coast < Math.round(num(s.retireAge))) {
        el.coastLine.className = "ms-coast good";
        el.coastLine.textContent = "🏖️ Coast point: you could stop saving at age " + coast + " (in "
          + (coast - nowAge) + " year" + (coast - nowAge === 1 ? "" : "s") + ") and your savings would still last — everything after that is a cushion.";
      } else {
        el.coastLine.className = "ms-coast";
        el.coastLine.textContent = "🏖️ Plan to keep saving right up to retirement — that's what keeps you on track.";
      }
    }
    el.milestones.hidden = false;
  }

  // Emergency fund: how many months of expenses your cash covers (aim for 3–6).
  function renderEmergencyFund(cf) {
    var cash = 0;
    state.accounts.forEach(function (a) { if (a.type === "cash") cash += num(a.balance); });
    var monthly = cf.expenseMo;
    if (monthly <= 0) { el.efund.hidden = true; return; }
    var target = monthly * 3;
    if (cash <= 0) {
      el.efund.className = "efund warn";
      el.efund.innerHTML = "🛟 <b>No cash set aside for emergencies yet.</b> A 3–6 month cushion (about " + fmtMoney(target)
        + ") keeps a surprise from derailing the plan. Mark savings as “Cash / savings” in the list above.";
    } else {
      var months = cash / monthly;
      var m1 = months.toFixed(months < 10 ? 1 : 0);
      if (months >= 6) {
        el.efund.className = "efund good";
        el.efund.innerHTML = "🛟 <b>Emergency fund: " + m1 + " months</b> of expenses in cash — plenty of cushion. 👍";
      } else if (months >= 3) {
        el.efund.className = "efund good";
        el.efund.innerHTML = "🛟 <b>Emergency fund: " + m1 + " months</b> of expenses in cash — a solid cushion.";
      } else {
        el.efund.className = "efund warn";
        el.efund.innerHTML = "🛟 <b>Emergency fund: " + m1 + " months</b> of expenses in cash — most folks aim for 3–6 (about "
          + fmtMoney(target) + "). Building this up protects the plan.";
      }
    }
    el.efund.hidden = false;
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
      + '<span class="cell-amt"><input type="text" inputmode="decimal" class="mnum" data-i="' + idx + '" data-f="amount" value="' + commafy(item.amount) + '" /></span>'
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
      var whoOpts = [["you", "You"], ["partner", "Partner"], ["both", "Both"]].map(function (o) {
        return '<option value="' + o[0] + '"' + (((r.owner || "you") === o[0]) ? " selected" : "") + '>' + o[1] + '</option>';
      }).join("");
      row.innerHTML =
        '<span class="cell-name"><input type="text" data-i="' + idx + '" data-f="name" value="' + escapeHtml(r.name) + '" placeholder="e.g. CPP" autocomplete="off" /></span>'
      + '<span class="cell-who"><select data-i="' + idx + '" data-f="owner">' + whoOpts + '</select></span>'
      + '<span class="cell-amt"><input type="text" inputmode="decimal" class="mnum" data-i="' + idx + '" data-f="amount" value="' + commafy(r.amount) + '" placeholder="e.g. 18,000" /></span>'
      + '<span class="cell-age"><input type="number" inputmode="numeric" step="1" data-i="' + idx + '" data-f="startAge" value="' + r.startAge + '" placeholder="e.g. 67" /></span>'
      + '<span class="cell-del"><button type="button" class="del-btn" data-del="' + idx + '" aria-label="Remove">×</button></span>';
      c.appendChild(row);
    });
    wireRows(c, state.retIncomes, ["amount", "startAge"], renderRet);
  }

  function renderOneTime() {
    var c = el.otList;
    if (!state.oneTime.length) { c.innerHTML = '<div class="acct-empty">None planned? Leave this empty.</div>'; return; }
    c.innerHTML = "";
    state.oneTime.forEach(function (o, idx) {
      var row = document.createElement("div");
      row.className = "ot-row";
      row.innerHTML =
        '<span class="cell-name"><input type="text" data-i="' + idx + '" data-f="name" value="' + escapeHtml(o.name) + '" placeholder="e.g. New car" autocomplete="off" /></span>'
      + '<span class="cell-amt"><input type="text" inputmode="decimal" class="mnum" data-i="' + idx + '" data-f="amount" value="' + commafy(o.amount) + '" placeholder="e.g. 35,000" /></span>'
      + '<span class="cell-age"><input type="number" inputmode="numeric" step="1" data-i="' + idx + '" data-f="atAge" value="' + o.atAge + '" placeholder="e.g. 55" /></span>'
      + '<span class="cell-del"><button type="button" class="del-btn" data-del="' + idx + '" aria-label="Remove">×</button></span>';
      c.appendChild(row);
    });
    wireRows(c, state.oneTime, ["amount", "atAge"], renderOneTime);
  }

  function renderWindfalls() {
    var c = el.wfList;
    if (!state.windfalls.length) { c.innerHTML = '<div class="acct-empty">None expected? Leave this empty.</div>'; return; }
    c.innerHTML = "";
    state.windfalls.forEach(function (o, idx) {
      var row = document.createElement("div");
      row.className = "ot-row";
      row.innerHTML =
        '<span class="cell-name"><input type="text" data-i="' + idx + '" data-f="name" value="' + escapeHtml(o.name) + '" placeholder="e.g. Downsize home" autocomplete="off" /></span>'
      + '<span class="cell-amt"><input type="text" inputmode="decimal" class="mnum" data-i="' + idx + '" data-f="amount" value="' + commafy(o.amount) + '" placeholder="e.g. 200,000" /></span>'
      + '<span class="cell-age"><input type="number" inputmode="numeric" step="1" data-i="' + idx + '" data-f="atAge" value="' + o.atAge + '" placeholder="e.g. 60" /></span>'
      + '<span class="cell-del"><button type="button" class="del-btn" data-del="' + idx + '" aria-label="Remove">×</button></span>';
      c.appendChild(row);
    });
    wireRows(c, state.windfalls, ["amount", "atAge"], renderWindfalls);
  }

  function renderHistory() {
    if (!el.nwHistory) return;
    var h = state.history || [];
    if (h.length < 2) { el.nwHistory.innerHTML = ""; return; }
    var vals = h.map(function (p) { return num(p.nw); });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = (max - min) || 1;
    var W = 240, H = 40;
    var pts = vals.map(function (v, i) { return ((W * i) / (vals.length - 1)).toFixed(1) + "," + (H - ((v - min) / span) * H).toFixed(1); });
    var first = h[0], last = h[h.length - 1], delta = num(last.nw) - num(first.nw), up = delta >= 0;
    el.nwHistory.innerHTML =
        '<div class="nwh-head"><span>Net worth over time</span><span class="nwh-delta ' + (up ? "up" : "down") + '">' + (up ? "▲ " : "▼ ") + fmtMoney(Math.abs(delta)) + " since " + first.m + '</span></div>'
      + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="nwh-svg" aria-hidden="true"><polyline points="' + pts.join(" ") + '" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linejoin="round"/></svg>';
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
      + '<span class="cell-bal"><input type="text" inputmode="decimal" class="mnum" data-i="' + idx + '" data-f="balance" value="' + commafy(a.balance) + '" /></span>'
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
      + '<span class="cell-bal"><input type="text" inputmode="decimal" class="mnum" data-i="' + idx + '" data-f="balance" value="' + commafy(d.balance) + '" /></span>'
      + '<span class="cell-apr"><input type="number" inputmode="decimal" step="0.1" data-i="' + idx + '" data-f="apr" value="' + d.apr + '" /></span>'
      + '<span class="cell-pmt"><input type="text" inputmode="decimal" class="mnum" data-i="' + idx + '" data-f="payment" value="' + commafy(d.payment) + '" /></span>'
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
    el.partnerAge.value = s.partnerAge ? s.partnerAge : "";
    el.retireAge.value = s.retireAge;
    el.planThroughAge.value = s.planThroughAge;
    el.targetIncome.value = commafy(s.targetIncome);
    el.rate.value = s.rate;
    el.inflation.value = s.inflation;
    el.cashYield.value = s.cashYield;
    el.investPct.value = s.investPct;
    el.debtPaydown.value = commafy(s.debtPaydown);
    el.retireTaxRate.value = s.retireTaxRate;
    el.variable.value = commafy(state.variable);
  }
  function wire() {
    el.household.addEventListener("input", function () { state.settings.household = el.household.value; save(); renderAll(); });
    [["currentAge", "currentAge"], ["partnerAge", "partnerAge"], ["retireAge", "retireAge"], ["planThroughAge", "planThroughAge"], ["targetIncome", "targetIncome"],
     ["rate", "rate"], ["inflation", "inflation"], ["cashYield", "cashYield"], ["investPct", "investPct"], ["debtPaydown", "debtPaydown"], ["retireTaxRate", "retireTaxRate"]]
      .forEach(function (pair) { el[pair[0]].addEventListener("input", function () { state.settings[pair[1]] = num(el[pair[0]].value); save(); renderAll(); }); });
    el.variable.addEventListener("input", function () { state.variable = num(el.variable.value); save(); renderAll(); });
    el.addIncome.addEventListener("click", function () { state.incomes.push({ id: "i" + (++idSeq), name: "", amount: 0, freq: "mo" }); save(); renderLineList(el.incomeList, state.incomes); renderAll(); });
    el.addFixed.addEventListener("click", function () { state.fixed.push({ id: "f" + (++idSeq), name: "", amount: 0, freq: "mo" }); save(); renderLineList(el.fixedList, state.fixed); renderAll(); });
    el.addRet.addEventListener("click", function () { state.retIncomes.push({ id: "r" + (++idSeq), name: "", amount: 0, startAge: state.settings.retireAge, owner: "you" }); save(); renderRet(); renderAll(); });
    el.addOneTime.addEventListener("click", function () { state.oneTime.push({ id: "o" + (++idSeq), name: "", amount: 0, atAge: state.settings.retireAge }); save(); renderOneTime(); renderAll(); });
    el.addWindfall.addEventListener("click", function () { state.windfalls.push({ id: "w" + (++idSeq), name: "", amount: 0, atAge: state.settings.retireAge }); save(); renderWindfalls(); renderAll(); });
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
    el.saveFile.addEventListener("click", function () {
      try {
        var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = "my-retirement-plan.json"; document.body.appendChild(a); a.click();
        document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        flash("Saved a file called “my-retirement-plan.json”. Keep it — “Open a saved file” loads it back anytime, on any device.");
      } catch (e) {
        // sandboxed previews can block downloads — fall back to the copyable link
        var link = location.origin + location.pathname + "#d=" + encodeData();
        promptLink(link);
        flash("This view blocked the download — copy the link that just popped up instead, and keep it safe.");
      }
    });
    el.loadData.addEventListener("change", function () {
      var file = el.loadData.files && el.loadData.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { if (importData(reader.result)) { syncSettingsToForm(); renderAllLists(); renderAll(); flash("Loaded your saved plan."); } else flash("That file didn't look like a saved plan."); el.loadData.value = ""; };
      reader.readAsText(file);
    });
  }
  el.printBtn.addEventListener("click", function () { try { window.print(); } catch (e) {} });

  function flash(msg) { el.dataMsg.textContent = msg; }
  function promptLink(link) { try { window.prompt("Copy this link to open your plan elsewhere:", link); } catch (e) { flash("Copy failed."); } }
  function renderAllLists() {
    renderLineList(el.incomeList, state.incomes);
    renderLineList(el.fixedList, state.fixed);
    renderRet(); renderOneTime(); renderWindfalls(); renderAccounts(); renderDebts();
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
      oneTime: Array.isArray(raw.oneTime) ? raw.oneTime : d.oneTime,
      windfalls: Array.isArray(raw.windfalls) ? raw.windfalls : d.windfalls,
      history: Array.isArray(raw.history) ? raw.history : d.history,
    };
  }

  /* ---------- persistence ---------- */
  var storageOk = true;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); storageOk = true; }
    catch (e) { storageOk = false; }
    updateSaveStatus();
  }
  // Honest, plain-language indicator of whether auto-save is actually working
  // here — some sandboxed/preview views block browser storage.
  function updateSaveStatus() {
    if (!el.saveStatus) return;
    if (storageOk) {
      el.saveStatus.className = "sb-status ok";
      el.saveStatus.textContent = "✓ Auto-saving on this device — your numbers will be here when you come back. (Tip: “Save my plan to a file” keeps a backup you can’t lose.)";
    } else {
      el.saveStatus.className = "sb-status warn";
      el.saveStatus.textContent = "⚠️ This preview can’t save your numbers. Open the website version (lots-hub.web.app/retirement/) — or tap “Save my plan to a file” and keep it safe.";
    }
  }
  function readKey(k) {
    try { var r = JSON.parse(localStorage.getItem(k)); if (r && r.settings && Array.isArray(r.accounts)) return r; } catch (e) {}
    return null;
  }
  function load() {
    // a shared link wins over everything
    if (location.hash.indexOf("#d=") === 0 && importData(location.hash.slice(3))) {
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
      return;
    }
    // the stable key first; if it's empty, recover the most recent data left
    // under any older versioned key (they were orphaned, never deleted).
    var raw = readKey(STORE_KEY);
    if (!raw) { for (var i = 0; i < LEGACY_KEYS.length && !raw; i++) raw = readKey(LEGACY_KEYS[i]); }
    state = raw ? mergeState(raw) : defaults();
    save(); // write forward into the stable key so it persists across all future updates
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
    // Default to light for everyone; only honor a theme the user explicitly picked.
    applyTheme(saved === "dark" || saved === "light" ? saved : "light");
  }
  el.themeToggle.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next); try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  // Re-format any money field with thousands separators when it loses focus
  // (kept raw while typing so the cursor doesn't jump).
  document.addEventListener("focusout", function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains("mnum")) t.value = commafy(t.value);
  });

  /* ---------- boot ---------- */
  initTheme();
  load();
  snapshotHistory();
  syncSettingsToForm();
  wire();
  renderAllLists();
  renderAll();
  updateSaveStatus();
})();
