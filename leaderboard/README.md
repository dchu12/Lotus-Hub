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

The table itself stays minimal — Rank, Player, Lotus Score, Skill Points,
Community Points, Points Behind 1st — and sorts automatically.

- **Ranks and ties**: players level on Lotus Score share a rank (1, 1, 3…),
  and "Points Behind 1st" shows "—" for everyone in 1st. Gold/silver/bronze
  medals and the highlighted leader row only appear once someone has
  scored; before that, a note says scores update after each session (or
  when the challenge starts). The published tie-break for 1st, shown in
  "How scoring works", is **more Skill Points wins**, and that's also the
  display order within a tie.
- **Phones** show just Score and Behind 1st (tapping a player shows the
  Skill/Community split), so the table fits without sideways scrolling.
  The CSV export has every column.
- **Countdown**: next to the dates in the header: "Starts in 7 days",
  "12 days left", "Last day!", then "Challenge ended". Driven by the Start
  date / End date fields in the edit panel (`startDate` / `endDate` on the
  board doc); the `default` board falls back to Oct 1–31 2026
  (`DEFAULT_DATES` in `app.js`) until dates are saved.
- **Rank movement arrows** (▲2 / ▼1 beside a name): compared against a
  weekly snapshot of the rankings (`snapshot` on the board doc). An admin
  save takes a new snapshot at most once every 7 days, from the rankings
  as they stood before that save, and never while nobody has points.
- **Prize banner**: right under the header, every visit, with a photo of
  the paddle (`prize-paddle.png`, a transparent cut-out so it sits directly on the banner): "1st place wins / Zocker Pro Series
  Control Paddle". It's plain markup in `index.html`
  (`<section class="prize">`); edit it when the prize changes.
- **Share my rank**: once scores exist, the "your rank" strip has a
  **Share** button. It draws a 1080×1350 PNG on a canvas (logo, challenge
  name, rank medallion, name, points, standing, the prize, and the player
  link), built in the background as soon as the strip shows, so tapping
  Share opens the phone's share sheet straight away (iOS requires that).
  The caption is "I'm 3rd in the October Lotus Challenge with 36 points!"
  plus the link. On a computer without a share sheet, it downloads the image
  and copies the caption.
- **Find your name**: a search bar at the top of the leaderboard card. In
  the player view, a challenger picks their name to pin a "your rank" strip
  (rank, points, how far behind 1st, or tied/leading) and a "You" tag on
  their row; "Breakdown" opens their points breakdown. The pick is
  remembered in `localStorage` on that device only; "Not you?" clears it.
  In the admin view the same bar is "Find a player" and just jumps to that
  player's row, opened.
- **Upcoming community events**: a card below the leaderboard listing the
  next five events, each with a date tile, time, place, a colour-coded tag
  showing the Community Points it earns (Social +3, Drill +2, Ranked +1, or
  Special), and **Add to calendar**, which offers **Google Calendar** (opens Google
  Calendar's pre-filled "new event" page in the viewer's time zone) or
  **Apple / Outlook** (downloads an `.ics` file). The next
  event is highlighted, past events drop off, and players only see the card
  once there's at least one upcoming event.
  **Editing:** on the admin link, signed in as the coach account, tap **Edit
  events** on the card (or "⋯" → Edit events). That opens a form (date,
  start, optional end, name, type, optional location) and puts Edit/Delete
  on every event, including past ones, which stay in the admin list so they
  can be tidied up. Tap **Done** when finished. Events are stored on the
  board doc as `events` and saved through the same coach-only transaction
  as everything else.
- **Events from Google Calendar (optional)**: paste a *public* Google
  Calendar's ID into "⋯" → Edit challenge details → **Events from Google
  Calendar**, and the events card reads the next five events from that
  calendar (Calendar API v3, read-only, refreshed every 10 minutes and
  cached for offline) instead of the list stored on the board. Players get
  **Subscribe in Google Calendar** / **Subscribe on iPhone / Outlook**
  (webcal) to follow every event automatically; the admin's "Edit events"
  becomes **Manage in Google Calendar**. A pasted share/embed link is
  accepted and reduced to the ID. Clear the ID to go back to in-page events.
  The type tag comes from words in the event's title or description:
  "social" → Social Play +3, "drill"/"clinic" → Drill Training +2,
  "ranked" → Ranked Play +1, anything else → Special event. All-day events
  show "All day"; cancelled ones are skipped. If the calendar can't be read,
  the admin sees why (key blocked, API off, not public/not found) and
  players simply don't see the card.
  **One-time Google setup** (Google Cloud console for the `lots-hub`
  project):
  1. In Google Calendar, create the calendar, then Settings → Access
     permissions → **Make available to public**, and copy its **Calendar
     ID** (Integrate calendar section).
  2. APIs & Services → Library → **Google Calendar API** → Enable.
  3. APIs & Services → Credentials → the "Browser key (auto created by
     Firebase)" → API restrictions → add **Google Calendar API** → Save.
     (Or create a separate key restricted to that API and to
     `lots-hub.web.app/*`, and paste it in the optional key field.)
- **How scoring works**: the formula as tiles, plus the tie-break rule.
  Collapsible; open by default on wide screens, collapsed on phones.

- **Admin tools** (admin link only):
  - **"⋯" menu** in the header: Copy player link, Player link QR code,
    Edit challenge details, Export CSV, Sign out. Keyboard: Arrow keys,
    Home/End move through it; Escape or Tab closes it.
  - **"+ Add player"** in the leaderboard header opens the add form, which
    stays hidden otherwise. Edit also opens it; saving or Cancel closes it.
  - **Log a session**: open a player (tap their row, or use "Find a
    player") and tap **+1 Ranked / +1 Social / +1 Drill**. It saves
    immediately, and the confirmation has an **Undo** for about 6 seconds.
    Edit and Delete live in the same strip.
  - The form's DUPR fields show example placeholders ("e.g. 3.20"), and the
    summary line shows the calculated DUPR change and resulting points.
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
- **QR code** (admin "⋯" menu → Player link QR code) — a scannable code
  for the player link, generated entirely client-side via the
  [`qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator)
  library (loaded from jsDelivr in `index.html`; nothing about the link is
  sent to any server to render it). If that script didn't load (offline, or
  blocked), the panel still shows the plain link and a copy button.
- **Export CSV** (admin "⋯" menu) — downloads every player's
  full data (start/end DUPR, session counts, computed points) as a `.csv`,
  entirely client-side (`Blob` + a throwaway `<a download>`, no server round
  trip). It's the only backup of a board's data and the easiest way to do
  prize math or email winners outside the app.
- **Duplicate-name check** — adding (or renaming, via edit) a player to a
  name that's already on the board (case-insensitive) asks for confirmation
  first, so "did I already add them?" doesn't quietly create two rows for
  the same person. Confirming still allows it, for the rare case of two
  players who really do share a name.

The header badge (top-left) and the share-my-rank image show the Lotus
Pickleball Academy lotus mark (`logo.png`, transparent background). The same
mark is the browser-tab icon (`favicon-64.png`) and the home-screen app icon
(`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, on the logo's cream
background, sized for maskable icons). No emoji anywhere in the UI —
every other icon (edit, link, the three community-point icons) is a small
custom inline SVG defined in `index.html` (or the `ICONS` object at the top
of `app.js`). Light theme only, by design; there's
no dark-mode toggle or `prefers-color-scheme` handling.

## How it's shared

The board is one document in the same **Firestore** project the rest of Lotus
Hub uses (`firebase-config.js`). **Anyone can read it** (players just open the
link, no sign-in). **Only the academy's coach account can change it.**

### Coach sign-in

The admin link shows the board read-only until you sign in with the coach
account (**lotuspickleballacademy@gmail.com**), via "Sign in with Google" or
"Use email and password instead". Sign-in is shared across the whole Lotus
Hub site, so if you're already signed in to Lotus Hub on that device you're
signed in here too. Signed in with a different account, the page says so and
offers Sign out. Sign out is also in the "⋯" menu.

This is enforced by Firestore, not just hidden in the page:
`isLeaderboardCoach()` in [`firestore.rules`](../firestore.rules) only allows
writes from that account's Firebase Auth UID, or from a session whose
**verified** email is the academy address. `COACH_UIDS` / `COACH_EMAILS` at
the top of `app.js` mirror it, and only decide whether to show the editing
tools. **To add another coach:** have them sign in to Lotus Hub once, copy
their UID from Firebase console → Authentication, and add it to both lists.

(This replaced the old admin PIN, which only hid the editing tools and
couldn't stop a direct write. Any `adminPinHash` left on an old board is
ignored and dropped on the next save.)

### Saves can't overwrite each other

Every change (+1 session, add/edit/delete player, challenge details) is sent
as a small edit that `LH.updateLeaderboard` re-applies to the **latest**
server copy inside a Firestore transaction. Two coaches logging sessions at
the same moment both land; the second can't silently undo the first. The
page applies the change instantly and rolls it back with an explanation if
the save is refused (not signed in as the coach, or offline).

### Firestore write validation

On top of the coach check, a write must match the document shape this app
produces: known fields only, title/subtitle length caps, the entries array
capped at 300 players, `startDate` / `endDate` either absent/`null` or
`YYYY-MM-DD`, `snapshot` either absent/`null` or
`{ at: "YYYY-MM-DD", ranks: {…} }` with at most 300 ranks, and `updatedAt`
required to be a genuine server timestamp (not a spoofed date). Deletes are
refused outright.

**What this does *not* do:** validate the contents of individual entries
inside that array. The Firestore rules language has no per-element loop, and
`entries` is a plain array rather than a subcollection. Since only the coach
account can write at all, that's an accepted limit.

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
(`styles.css`, `app.js`, `manifest.webmanifest`, the logo and icons, and the service
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

**Renaming the challenge:** the title/subtitle you set in the edit panel is
saved to the board and shown on every link once the page loads. Also update
the placeholder heading in `index.html` (and the defaults at the top of
`app.js`) to match. On a slow phone that placeholder is what players see
while the Firebase SDK is still downloading, so a stale one looks like the
player link has a different title.

**Accessibility:** the page has a `main` landmark, a screen-reader caption
and `scope="col"` headers on the table, a labelled search field, and text
contrast ≥4.5:1. It was checked with axe-core (WCAG 2.1 A/AA plus best
practices) in the player view, the admin view (menu open, player opened,
add form) and the sign-in card, with no violations. That's an automated
check, not a test with a real screen reader.

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
