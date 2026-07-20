# Derek & Kelly · Retirement

A plain-language retirement tracker that answers one question — *"will our money
last?"* — without finance jargon. Static HTML/CSS/JS, no build step, no
dependencies, no server. Open `retirement/index.html`, or serve the repo and
visit `/retirement/`.

## How it reads

A single guided page, top to bottom:

1. **The verdict, first** — e.g. *"Retiring at 65 and spending $95,000 a year,
   your savings comfortably last through age 95. You're on track."*
2. **Step 1 — What you earn**
3. **Step 2 — What you spend** (leaves a monthly savings amount)
4. **Step 3 — What you own & owe** (savings, home, debts + debt-free year)
5. **Step 4 — Your plan** — your age, retirement age, desired yearly spending,
   and the retirement income you'll get (Social Security, pensions). Then the
   headline answer: **the age your savings last to**, a whole-life chart, and a
   good-to-poor **market range**.
6. **What if…** — live scenarios (retire earlier/later, spend less, poor
   markets), each showing the age your money would last to.
7. **Fine-tune & save your plan** — assumptions, plus save/share.

## What it models

Everything is in **today's dollars** (real terms), so there's no confusing
"future dollars" toggle.

    earn − spend = what you save each month
      → extra debt paydown, then split invest / cash
      → savings grow at real returns; debts amortize (highest rate first);
        a paid-off debt's payment re-enters the invest/cash split
      → at retirement, savings are drawn down each year to cover the spending
        that Social Security / pensions don't already cover
      → we report the age the money lasts to, across good / expected / poor
        markets

- **Social Security & pensions** reduce what your savings must cover, so the
  answer is realistic (not "fund 100% of spending from a 4% withdrawal").
- **"Will it last?"** simulates the drawdown to your plan-through age and reports
  the age your money lasts to, instead of an abstract withdrawal rate.
- **Market range** runs the plan at expected, +2%, and −2% returns so a single
  growth guess doesn't feel falsely precise.
- **Save / share your plan** — copy a shareable link (your data is encoded in
  the URL), download a JSON copy, or load one back — so you can move between
  phone and laptop.

Your home counts toward net worth but not toward retirement income. Data is
saved in this browser's `localStorage` (or the link/file you make); light/dark
theme follows your system.

Estimates only — not financial advice.
