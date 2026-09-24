# 🏆 Lotus Leaderboard

A live leaderboard for the **Lotus Pickleball Academy** monthly challenge —
add players, enter their Start/End DUPR and Lotus community points, and it
tallies each player's **Lotus Score** automatically:

- **DUPR improvement is calculated automatically** — enter a player's Start
  DUPR and End DUPR and the app subtracts them for you into its own
  **DUPR Improvement** field, shown read-only right next to them (no manual
  override — it's always Start DUPR − End DUPR). Every **+0.01 DUPR
  improvement = +1 point**.
- **Lotus community points**, earned per session attended:
  - Ranked Play — **+1**
  - Social Play — **+3**
  - Drill Training — **+2**
- **Lotus Score = Skill Points + Community Points.**

The table itself stays minimal — Rank, Player, Skill Points, Community Points,
Lotus Score — sorts automatically, and calls out the current leader (plus
gold/silver/bronze medal badges for the top 3).

- **Points breakdown**: tap (or click, or press Enter on) any player to
  expand indented rows under them, one per scoring source, each number
  sitting in its own column: DUPR (start → end and the change) under Skill
  Points, and Ranked / Social / Drill as `sessions × pts` under Community
  Points. The player's own row above already shows the totals. Works in
  the admin and player views, one player open at a time, and stays open
  through live Firestore updates.
- **"Updated N minutes ago"** next to the leaderboard header, so players can
  tell the board is current rather than stale. Only shows once there's a
  real synced timestamp from Firestore (`updatedAt`, set on every save) —
  never a made-up local time. Refreshes itself every 30s while the page is
  open.
- **QR code** (🔲 button, next to the share-link button) — a scannable code
  for the player link, generated entirely client-side via the
  [`qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator)
  library (loaded from jsDelivr in `index.html`; nothing about the link is
  sent to any server to render it). If that script didn't load (offline, or
  blocked), the panel still shows the plain link and a copy button.
- **Export CSV** (admin only, board-card header) — downloads every player's
  full data (start/end DUPR, session counts, computed points) as a `.csv`,
  entirely client-side (`Blob` + a throwaway `<a download>`, no server round
  trip). It's the only backup of a board's data and the easiest way to do
  prize math or email winners outside the app.
- **Duplicate-name check** — adding (or renaming, via edit) a player to a
  name that's already on the board (case-insensitive) asks for confirmation
  first, so "did I already add them?" doesn't quietly create two rows for
  the same person. Confirming still allows it, for the rare case of two
  players who really do share a name.

The header badge (top-left) shows the Lotus Pickleball Academy logo mark
(`logo.png`, cropped from the full brand logo). No emoji anywhere in the UI —
every other icon (edit, link, the three community-point icons) is a small
custom inline SVG defined in `index.html`
(and, for the one JS-generated icon — the leader-card trophy — in the
`ICONS` object at the top of `app.js`). Light theme only, by design; there's
no dark-mode toggle or `prefers-color-scheme` handling.

## How it's shared

The board is one document in the same **Firestore** project the rest of Lotus
Hub uses (`firebase-config.js`), stored open (no sign-in) like the wedding
thank-you tracker — anyone with the link can view and edit it. Keep it private
by not sharing the URL outside your organizers.

### Admin PIN

Set an **Admin PIN** from the ✏️ edit-challenge panel to require it before
this or any *other* browser/device can add, edit, or delete players — until
a PIN is set, editing stays open exactly as before (opt-in, not forced). The
board itself is still readable and writable to anyone with the link at the
Firestore level (see `firestore.rules`); the PIN only gates this page's UI,
storing a SHA-256 hash of it on the board doc and a matching copy in
`localStorage` on whichever browser(s) have unlocked it. **This deters
accidental edits and a casually shared or screenshotted link — it is not
real security.** Anyone who opens the browser console and calls the
Firestore SDK directly bypasses it entirely, same as the existing
`?mode=view` split. Real enforcement would need Firebase Auth + rewritten
security rules, out of scope for this tool.

To remove PIN protection, open the edit panel (once unlocked) and check
"Remove PIN protection."

### Firestore write validation

The `leaderboards/{boardId}` rule in [`firestore.rules`](../firestore.rules)
stays open to writes from anyone (no auth — same trust model as the PIN
above, which is UI-only and not enforced here), but a write must now match
the document shape this app actually produces: known fields only, title/
subtitle length caps, the entries array capped at 300 players, `adminPinHash`
either `null` or a real 64-character SHA-256 hex digest, and `updatedAt`
required to be a genuine server timestamp (not a spoofed date). This is
meant to stop a write crafted directly against the Firestore SDK — bypassing
`app.js`, and so the PIN prompt, entirely — from corrupting the board with a
runaway array or garbage top-level data.

**What this does *not* do:** validate the contents of individual entries
inside that array (a garbage player name or DUPR value inside an otherwise
well-shaped document still gets through). The Firestore rules language has
no per-element loop, and `entries` is a plain array rather than a
subcollection, so per-entry validation isn't practically achievable without
a data-model change. Real protection for that would need Firebase Auth —
out of scope here, same as the PIN.

**Short player link:** `https://<host>/lotus` always opens the read-only
player view of the current challenge (the `default` board). It's what the
share-link button and QR code hand out, instead of a long `?mode=view`
URL. It's set up via `VIEW_SLUGS` in `app.js` and a matching `/lotus`
rewrite in `firebase.json`. Point it at a different board next month by
changing `VIEW_SLUGS.lotus` (and `BOARD_ALIASES.lotus`). Other boards
still share a `?mode=view` link.

Multiple boards can exist side by side, addressed either by a clean path —
`/leaderboard/<slug>` (e.g. `/leaderboard/november-2026`) — or a `?board=<id>`
query param; leaving both off uses `default`. Path wins if a page somehow has
both. `/leaderboard/lotusoctoberchallenge` **and** the even shorter
`/lotusoctoberchallenge` (no `/leaderboard/` prefix at all — see the extra
rewrite pair in `firebase.json`) both alias to `default` (see `BOARD_ALIASES`
in `app.js`), so any of the three URLs for the current challenge point at the
*same* data — none of them start a second, empty board. Add more aliases the
same way for future months if you want a memorable link without renaming the
underlying board.

Both clean-path forms need matching hosting rewrites in the repo's
[`firebase.json`](../firebase.json) — already included — routing that URL to
`/leaderboard/index.html`. Because a page can then be served at a URL that
isn't literally under `/leaderboard/`, every asset this page loads
(`styles.css`, `app.js`, `manifest.webmanifest`, `icon.svg`, and the service
worker registration) uses an **absolute** `/leaderboard/...` path rather than
a relative one — a relative path resolves against the *browser's URL*, not
this file's location, so it'd 404 or load the wrong thing from a short alias
like `/lotusoctoberchallenge`. Keep that in mind if you add more assets here.

These path-based rewrites only take effect on the real Firebase Hosting
deploy — a plain `python3 -m http.server` (see "Run it" below) doesn't apply
them, so only the bare `/leaderboard/` URL works for local testing; the short
aliases will 404 locally.

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
| `styles.css` | Crimson + gold theme, light only |
| `app.js` | Scoring logic, form handling, Firestore sync + local fallback |
| `logo.png` | Lotus Pickleball Academy logo mark, shown in the header |
| `manifest.webmanifest` / `sw.js` | PWA install + offline app shell |

Uses the shared `LH.watchLeaderboard` / `LH.saveLeaderboard` helpers added to
the root [`firebase.js`](../firebase.js) wrapper.

## Run it

```bash
python3 -m http.server 8000
# then open http://localhost:8000/leaderboard/
```
