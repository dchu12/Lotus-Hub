# Derek & Kelly · Retirement Goal Status

A personal net-worth and retirement-goal tracker. Enter your real accounts and
assets; it aggregates your net worth, projects your retirement portfolio
forward, and tells you whether you're on track. Static HTML/CSS/JS — no build
step, no dependencies, no server. Open `retirement/index.html`, or serve the
repo and visit `/retirement/`.

## What it does

- **Accounts & assets** — add each account (401(k), IRA, brokerage, cash, home,
  mortgage…) with its owner (Derek / Kelly / Joint), type, balance, and monthly
  contribution. Rows are editable inline; add or remove any.
- **Live totals** — net worth (all assets minus liabilities), retirement
  portfolio (investments + cash), and combined monthly contributions, plus a
  per-owner split of the retirement portfolio.
- **Goal status** — projects the retirement portfolio to your target year and
  compares it against the nest egg needed to fund your desired income at your
  safe-withdrawal rate (the "4% rule"). Shows a progress bar and an on-track /
  behind badge.
- **Gap coaching** — if you're short, it solves for the combined monthly
  contribution that closes the gap; if you're ahead, it tells you by how much.
- **Today's dollars** — toggle to view projections adjusted for inflation.
- **Growth chart** — contributions vs. investment growth over time, with your
  goal drawn as a reference line.

## How each account type behaves

| Type | Grows at | Counts toward net worth | Counts toward retirement income |
|------|----------|:-----------------------:|:-------------------------------:|
| Investment | your expected return | ✓ | ✓ |
| Cash / savings | 0% | ✓ | ✓ |
| Real estate | inflation | ✓ | — |
| Liability | 0% (subtracts) | ✓ (negative) | — |

Everything is saved in this browser's `localStorage` (nothing leaves your
device). Light/dark theme follows your system and can be toggled.

Estimates only — not financial advice.
