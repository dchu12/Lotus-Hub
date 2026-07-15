# Retirement Tracker

A self-contained retirement planning calculator. Static HTML/CSS/JS — no build
step, no dependencies. Open `retirement/index.html` directly, or serve the repo
and visit `/retirement/`.

## What it does

Enter your age, retirement age, current savings, monthly contribution, expected
return, inflation, and the income you want in retirement. It projects your nest
egg and tells you whether you're on track.

- **Projection** — compounds your current savings plus monthly contributions
  month by month at your expected return, to your retirement age.
- **On-track check** — compares your projected balance against the nest egg
  needed to fund your target income at the chosen safe-withdrawal rate (the "4%
  rule"). Your target income is entered in today's dollars and grown to the
  retirement date for an apples-to-apples comparison.
- **Gap coaching** — if you're short, it solves for the monthly contribution
  that would close the gap.
- **Today's dollars** — toggle to view all results adjusted for inflation.
- **Growth chart** — a stacked area of contributions vs. investment growth over
  time, with your target as a reference line.

Inputs and theme preference persist in `localStorage`. Light/dark theme follows
your system by default and can be toggled.

Estimates only — not financial advice.
