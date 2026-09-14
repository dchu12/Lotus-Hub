# 🏆 Lotus Leaderboard

A live leaderboard for the **Lotus Pickleball Academy** monthly challenge —
add players, enter their DUPR improvement and Lotus community points, and it
tallies each player's **Lotus Score** automatically, per the challenge flyer:

- **+0.01 DUPR improvement = +1 point** (enter the improvement directly, or
  flip "Use start / end DUPR instead" and type both ratings — the app does
  the subtraction).
- **Lotus community points**, earned per session attended:
  - 🏓 Ranked Play — **+1**
  - 👥 Social Play — **+1**
  - 🚧 Drill Training — **+3**
  - ⭐ Sensei Training — **+5**
- **Lotus Score = DUPR points + community points.**

The board sorts by score automatically and calls out the current leader with 🏆.

## How it's shared

The board is one document in the same **Firestore** project the rest of Lotus
Hub uses (`firebase-config.js`), stored open (no sign-in) like the wedding
thank-you tracker — anyone with the link can view and edit it. Keep it private
by not sharing the URL outside your organizers.

Multiple boards can exist side by side via `?board=<id>` in the URL (e.g.
`?board=november-2026`); leaving it off uses `default`.

**First-time setup:** publish the `leaderboards/{boardId}` rule added to the
repo's [`firestore.rules`](../firestore.rules) — Firebase console → Firestore
Database → **Rules** → paste → Publish (same step as the rest of the repo's
setup, see the root [`README.md`](../README.md)). Until that's published, the
app still works — it just keeps its data in this browser only (a banner says
so) and syncs to everyone once the rules go live.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell — header, add-player form, leaderboard table |
| `styles.css` | Crimson + gold theme (light & dark), matching the flyer |
| `app.js` | Scoring logic, form handling, Firestore sync + local fallback |
| `manifest.webmanifest` / `sw.js` | PWA install + offline app shell |

Uses the shared `LH.watchLeaderboard` / `LH.saveLeaderboard` helpers added to
the root [`firebase.js`](../firebase.js) wrapper.

## Run it

```bash
python3 -m http.server 8000
# then open http://localhost:8000/leaderboard/
```
