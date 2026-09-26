# 🏆 Lotus Leaderboard

A live leaderboard for the **Lotus Pickleball Academy** monthly challenge —
add players, enter their Start/End DUPR and Lotus community points, and it
tallies each player's **Lotus Score** automatically:

- **DUPR improvement is calculated automatically** — enter a player's Start
  DUPR and End DUPR and the app subtracts them for you into its own
  **DUPR Improvement** field, shown read-only right next to them (no manual
  override — it's always Start DUPR − End DUPR). Every **+0.01 DUPR
  improvement = +1 point**.
- **Lotus community points**, earned per session attended hosted by Lotus:
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
  "How scoring works" under Tiebreaker rules, is **most Community Points
  wins**, and that's also the
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
- **Loading placeholder**: until the board first arrives from Firestore, a
  shimmering placeholder card stands in for the countdown/leaderboard, so a
  slow connection doesn't flash "Be the first" or an empty table. If nothing
  arrives within 10 seconds, the page shows its normal empty state.
- **Sticky DM bar (phones)**: once the main Join the Challenge button scrolls out of
  view, a slim version is pinned to the bottom of the screen. It only shows
  when the main button would (player view, not ended, visitor not on the
  board), and never on desktop.
- **Sponsor line**: on its own line under the paddle name, "Sponsored by:
  Lotus Pickleball Academy".
- **Paddle name link**: "Zocker Pro Series Control Paddle" in the prize
  banner links to the paddle on zocker.ca (new tab).
- **Paddle photo**: tapping the prize photo opens it full size in a dialog
  (`prize-paddle-lg.png`, loaded only on tap). Escape, the close button or
  tapping the backdrop closes it.
- **Leaderboard heading**: "Lotus Leaderboard" with "5 players · Updated N
  minutes ago" directly under it, and the admin's + Add player button beside
  it.
- **Prize banner**: right under the header, every visit, with a photo of
  the paddle (`prize-paddle.png`, a transparent cut-out so it sits directly on the banner): "1st place wins / Zocker Pro Series
  Control Paddle". It's plain markup in `index.html`
  (`<section class="prize">`); edit it when the prize changes.
- **Challenge phases** (from the start/end dates):
  - **Before it starts** (and nobody has scored): players see a **Kicks off
    October 1** card with a live days/hours/minutes countdown and a **Who's
    in** roster, instead of a table of zeros. The coach still gets the table
    so players can be added. Share text reads "starts October 1… See who's in".
  - **During**: a **top-3 podium** (avatars, medals, points; ties share a
    rank) sits above the table. Tapping a podium spot opens that player's
    breakdown.
  - **After the end date**: a **winner banner** replaces the prize banner
    ("Congratulations, Chad Y! Winner of the Zocker Pro Series Control
    Paddle"), the table is titled **Final standings**, and the share text and
    Story image switch to final results. The published tie-break (most
    Community Points) decides a tie on Lotus Score; a tie on both says the academy will
    announce the winner.
  The page re-checks the phase every 30 seconds, so it flips over on its own.
- **Initials avatars**: a coloured circle with each player's initials in the
  table, podium, roster and winner banner. The colour comes from the name,
  so it's stable; all colours keep white text readable.
- **Link previews**: `index.html` carries Open Graph / Twitter tags pointing
  at `og-image.jpg` (1200×630, logo + challenge name + prize + "See who's
  leading"), so the link shows a branded card in WhatsApp, Instagram DMs,
  iMessage and Facebook. Crawlers don't run JavaScript, so these are static:
  **when the challenge name, dates or prize change, update the tags and
  regenerate `og-image.jpg`** (bump its `?v=`; now `?v=2`, with the academy
  eyebrow, "Oct 1 – 31" and the flag badge). WhatsApp caches a preview
  per link for a while.
- **Climber of the week**: a green card under the podium showing the
  player who climbed the most spots in the last full week (Monday to
  Sunday), with "▲4 spots · +12 pts". Ties go to more points gained. In the
  first week, before a full week exists, it shows the climber "so far this
  week". Only players who were on the board when the week began count.
  Tapping it opens that player's breakdown, and the Instagram Story image
  includes it. How it works: the first admin save each week stores the
  standings as they were before that save (the `weeks` field, keeping the
  last 8 weeks). Since only saves change the board, that is exactly where
  everyone stood when the week began. It's shown only while the challenge
  is live.
- **Page visits by source (admin)**: the player page counts one visit per
  browser per day (never the coach's own visits) in
  `leaderboards/{id}/visits/{YYYY-MM-DD}_{source}`. The admin page shows a
  **Page visits** card with the last 7 days by source, the change vs the
  previous 7 days, and the all-time total. It also lists **tracking
  links** to copy: `?src=bio` (Instagram bio), `?src=story` (Stories; the
  Story card's Copy link uses it too), `?src=wa` (WhatsApp) and `?src=qr`
  (the QR code encodes it). Links shared from the player page's Share
  button count as "Shared by players". Instagram's in-app browser without
  a tag counts as "Instagram (other)", and everything else as "Direct /
  other". The tag is removed from the address bar after it's read. The
  rules let anyone add exactly 1 to a counter for an existing board, and
  only the coach can read the counters. Counts are approximate: clearing
  browser data counts a visitor again.
- **Polish details**:
  - Before launch there's no header pill: the header shows the dates and
    the countdown card shows the exact time left. Once live, the pill shows
    "X days left". The Story image, which has no countdown card, says
    "Starts in X days". The countdown card's heading reads "October Challenge Kicks Off In",
    so the date isn't repeated there either.
  - Dates are always written in US style ("October 1"), whatever the phone's
    language setting.
  - Avatar colours follow the order players were added, so the first ten
    players all get different colours (all at least 5.5:1 contrast with
    white). Specific players can be given a fixed colour in `AVATAR_PICKS`
    in `app.js` (Durian D is yellow and Lumpia L orange, both with dark
    initials).
  - The player view's "Who's in" ends with a dashed **+ You?** bubble that
    opens the Instagram DM.
  - A footer shows the logo, the academy name, the Instagram handle and
    "Leaderboard updates live".
- **Prize banner**: "1st place wins" has the Vietnam flag beside it (an inline
  SVG; screen readers hear "Vietnam brand"). It's drawn in SVG because flag
  emoji don't render on Windows.
- **Header**: three lines: "Lotus Pickleball Academy" (small red eyebrow,
  fixed in `index.html`), then the challenge name, then the dates line. The
  name and the dates line come from **Edit challenge details** in the admin
  menu, which saves them to the board doc. The default dates line is
  "Oct 1 – 31". The old saved name "October Lotus Challenge" is shown as "October
  Challenge" (`newTitle`), and the old "October 1 – October 31" as
  "Oct 1 – 31" (`shortSubtitle` in `app.js`) and rewritten to it on the
  next admin save.
- **Button celebrations**: tapping Join the October Challenge (or the pinned
  bar) fires a red-and-white confetti burst from the button; Book Drilling
  Session fires yellow and white; Lotus Gachapon fires blue and white. Each
  also gives a haptic buzz
  (vibration on Android; a light haptic tick on iPhone with iOS 18+, since
  iPhones don't let websites vibrate), then opens its Instagram link about
  0.75s later so the burst is seen. With "reduce motion" on there's no
  confetti and the DM opens straight away. If the browser blocks the new
  tab, the DM opens in the same tab.
- **Book Drilling Session**: just above the Lotus Gachapon card, a white
  outlined button "Book Drilling Session" with an "Earn +2 Community
  Points" tag that opens the academy's Instagram DM. It shows on the player
  view for everyone (joined or not) until the challenge ends.
- **Custom domain**: a second Hosting site, `lotuspickleballacademy` (target
  `academy` in `.firebaserc` and `firebase.json`), serves the same files. Its
  home page 302-redirects to `/lotusoctoberchallenge`, so
  lotuspickleballacademy.com opens the challenge. The deploy workflow creates
  the site if it's missing. To connect the domain, see
  `CUSTOM_DOMAIN_SETUP.md`.
- **Lotus Gachapon**: a tappable card right after the leaderboard (or after
  the countdown card before launch) that opens its Instagram post
  (`https://www.instagram.com/p/Ddk2QlsEc5f/`, set in `index.html`), with the
  subtitle "Bonus prizes available". It shows on both the player and
  admin views.
- **Colour**: cards and secondary buttons use a neutral outline (`--outline`
  in `styles.css`). Red is kept for the Join button, the prize banner, links,
  scores, icons and arrows.
- **Join the challenge**: the player view shows a full-width **Join the October Challenge**
  button ("Message us on Instagram" underneath) under the Challenge information card that opens an
  Instagram DM to `@lotuspickleballacademy_to`
  (`https://ig.me/m/lotuspickleballacademy_to`, set in `JOIN_URL` in
  `app.js` and the `#joinBtn` link in `index.html`). It's hidden in the admin view,
  once the challenge has ended, and once a visitor has picked their own name.
  The "Find your name" search links to the same DM when a name isn't found.
  Every Join link (the button, the sticky bar, "+ You?" and that search
  link) first opens a **How to join** panel: three steps and an editable
  message ("Full name", "DUPR ID" and a consent line for photos/videos at
  Lotus events for social media; set in `JOIN_MSG` in `app.js`). **Open
  Instagram** copies the message, fires the confetti and opens the DM. If
  the browser blocks copying, the panel stays open with the text selected
  and a note on copying it by hand.
- **Share the leaderboard**: the player view has a **Share** button in the
  header (share icon on phones). It opens the phone's share sheet (WhatsApp,
  Instagram, texts…) with a short message and the player link; where there's
  no share sheet (desktop, Instagram's in-app browser) it offers **Share on
  WhatsApp** (`wa.me` link) and **Copy link**. On the admin link it's
  "⋯" → **Share leaderboard**.
- **Instagram Story image** (admin, "⋯" → Instagram Story image): draws a
  1080×1920 image of the current standings (top 10, ties share a rank; "Who's
  in" before anyone has scored), the countdown, the prize and the player
  link, previews it, then **Share to Instagram** (share sheet) or **Save
  image**. "Copy link for the sticker" copies the player link for
  Instagram's Link sticker.
- **Share my rank**: once scores exist, the "your rank" strip has a
  **Share** button. It draws a 1080×1350 PNG on a canvas (logo, challenge
  name, rank medallion, name, points, standing, the prize, and the player
  link), built in the background as soon as the strip shows, so tapping
  Share opens the phone's share sheet straight away (iOS requires that).
  The caption is "I'm 3rd in the October Challenge with 36 points!"
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
  **Phone-friendly setup guide:** [`GOOGLE_CALENDAR_SETUP.md`](GOOGLE_CALENDAR_SETUP.md)
  (not set up yet as of 2026-09-24).
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
- **How It Works** (hint "Scoring · Prize · Tiebreaker"): a button to the
  full challenge post on Instagram, then "Highest Lotus Score wins", then a
  formula line, "Lotus Score = Skill Points + Community Points", a tile for
  each part, and the tie-break rule as a one-line note. The post link
  (`https://www.instagram.com/p/DdZCGGOkYlW/`) is set in `index.html`.
  Sits under the Join the October Challenge button, collapsed by default (one
  tap to open) so the leaderboard stays near the top.

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
