# Derek & Kelly · Retirement Goal Status

A personal, cash-flow-driven retirement tracker. Enter what you earn, spend,
own, and owe; it works out your monthly surplus, flows that into your accounts,
pays down your debts, and projects whether you're on track to retire on your
terms. Static HTML/CSS/JS — no build step, no dependencies, no server. Open
`retirement/index.html`, or serve the repo and visit `/retirement/`.

## The waterfall

    revenue − fixed − variable − debt payments = monthly surplus
      → extra debt paydown (accelerates payoff, avalanche order)
      → the rest is split invest % / cash
      → investments grow at your return; cash earns a yield; debts amortize
      → a paid-off debt frees its payment into investing
      → portfolio grows to your target year → checked against your goal

## What it does

- **Money in & out** — itemized revenue and fixed-expense lines (each per month
  or per year), plus a total variable-spending figure. Summarized into monthly
  and yearly income, expenses, and surplus, with a savings-rate chip.
- **Surplus allocation** — an "extra debt paydown" amount comes off the top,
  then an invest/cash slider splits the remainder. The split flows into your
  investment and cash accounts.
- **Assets** — 401(k), IRA, brokerage, cash, home… each with owner
  (Derek / Kelly / Joint) and balance. Plus a per-owner split of the retirement
  portfolio.
- **Debts** — each with a balance, APR, and monthly payment. Debts amortize
  over time; extra surplus pays down the highest-APR debt first; once a debt is
  cleared its payment is redirected into investing. Shows your projected
  debt-free year.
- **Goal & projection** — projects the portfolio to your target year and
  compares it against the nest egg needed to fund your desired income at your
  safe-withdrawal rate (the "4% rule"). Progress bar, on-track/behind badge, gap
  coaching, and a saved-vs-growth chart with your goal as a reference line.
- **Assumptions you control** — expected return, inflation, cash savings yield,
  and withdrawal rate. A "today's dollars" toggle shows everything inflation-
  adjusted.

## How each asset type behaves

| Type | Grows at | Net worth | Retirement income |
|------|----------|:---------:|:-----------------:|
| Investment | your expected return | ✓ | ✓ |
| Cash / savings | your savings yield | ✓ | ✓ |
| Real estate | inflation | ✓ | — |

Debts accrue at their APR and reduce net worth; they don't count toward
retirement income.

Everything is saved in this browser's `localStorage` (nothing leaves your
device). Light/dark theme follows your system and can be toggled.

Estimates only — not financial advice.
