# Derek & Kelly · Retirement

A plain-language retirement tracker built to answer one question — *"are we on
track?"* — without finance jargon. Static HTML/CSS/JS, no build step, no
dependencies, no server. Open `retirement/index.html`, or serve the repo and
visit `/retirement/`.

## How it reads

A single guided page, top to bottom:

1. **The verdict, first** — a plain-English sentence and a progress bar, e.g.
   *"Saving $5,650 a month, you're on pace to retire in 2048 with about
   $138,000 a year to spend — comfortably above your $90,000 goal."*
2. **Step 1 — What you earn** — every income source (monthly or yearly).
3. **Step 2 — What you spend** — regular bills plus a rough "everything else"
   total. Shows what's left to save each month.
4. **Step 3 — What you own & owe** — savings, investments, home, and debts
   (with a projected debt-free year).
5. **Step 4 — Your goal** — the year you want to retire and the yearly spending
   you'd want, then how much you're on pace to have.
6. **Fine-tune the assumptions** — collapsed by default. Growth, inflation,
   cash interest, safe spending rate, invest/cash split, extra debt paydown.

## Everything is in today's dollars

The whole model runs in **real (inflation-adjusted) terms**, so there's no
confusing "future dollars" toggle — every number on screen is in today's money.
Each rate you enter (investment growth, cash interest, debt rate) is converted
to a real rate internally; holding your monthly saving flat therefore assumes it
keeps pace with inflation, which is the realistic case.

## The model

    earn − spend = what you save each month
      → extra debt paydown comes off the top
      → the rest is split invest / cash
      → savings grow at real returns; debts amortize (highest rate first)
      → a paid-off debt's payment re-enters the invest/cash split
      → compared against what you'll need = desired yearly spending ÷ safe rate

Retirement is funded from investments and cash; your home counts toward net
worth but not toward retirement income. Everything is saved in this browser's
`localStorage` (nothing leaves your device); light/dark theme follows your
system.

Estimates only — not financial advice.
