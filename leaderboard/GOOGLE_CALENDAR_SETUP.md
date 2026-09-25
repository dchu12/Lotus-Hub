# Connect a Google Calendar to the events card (phone guide)

**Status:** optional, not set up yet. Until it is, events are managed on the
admin link with **⋯ → Edit events**, and everything works as normal.

When connected, the leaderboard's "Upcoming community events" card shows the
events from a public Google Calendar (refreshed every ~10 minutes), players
get **Subscribe** buttons that put every event in their own calendar, and
events are added/edited from the Google Calendar app.

Takes about 15 minutes. Steps 1–3 happen in a phone **web browser** (not the
Calendar app); step 5 is the Calendar app.

---

## Before you start (Samsung Galaxy / Android)

Android sends calendar.google.com links straight to the Calendar app. Use
any **one** of these so the website opens instead:

- Open links in a **Chrome Incognito tab** (Chrome **⋮ → New Incognito tab**,
  then type the address). Links don't jump to apps from Incognito.
- Use the **Samsung Internet** browser instead of Chrome.
- Or phone **Settings → Apps → Calendar → Set as default → Open supported
  links → off** (turn it back on when you're done).

Also switch the page to the desktop version when asked:
- **Chrome (Android):** **⋮ → tick "Desktop site"**
- **Samsung Internet:** **☰ → Desktop version**
- **Safari (iPhone):** **aA → Request Desktop Website**

Pinch to zoom as needed.

---

## Step 1 — Create the public calendar

1. Go to **calendar.google.com**, signed in as **lotuspickleballacademy@gmail.com**
   (tap the profile picture, top right, to switch accounts). Switch to the
   desktop version.
2. In the left column, next to **Other calendars**, tap **+** → **Create new calendar**.
3. Name it **Lotus Community Events**, check the **Time zone**, tap **Create calendar**.
4. In the left column under **Settings for my calendars**, tap **Lotus Community Events**.
5. Under **Access permissions for events**, tick **Make available to public**
   → **OK** (leave "See all event details").
6. Scroll to **Integrate calendar**. Copy the **Calendar ID** (ends in
   **@group.calendar.google.com**): press and hold it → Select all → Copy.

## Step 2 — Turn on the Google Calendar API

Use the Google account that owns the Firebase project for the site (probably
the academy account; if you get an access error, try the other one).

1. Go to **console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=lots-hub**
   (desktop version).
2. Tap **Enable**. If it says **Manage**, it's already on.

## Step 3 — Let the site use it

1. Go to **console.cloud.google.com/apis/credentials?project=lots-hub**
2. Under **API Keys**, tap **Browser key (auto created by Firebase)**.
3. Under **API restrictions** (already "Restrict key"), open the dropdown,
   tick **Google Calendar API**, tap **OK**. Don't untick anything else.
4. Tap **Save** at the bottom. Takes up to 5 minutes to take effect.
   Don't change **Application restrictions**.

(Checked on 2026-09-24: this key currently blocks Google Calendar, so this
step is required.)

## Step 4 — Connect it to the leaderboard

1. Open **lots-hub.web.app/lotus** and sign in with the academy account.
2. **⋯ → Edit challenge details** → paste the ID into **Google Calendar ID** → **Save**.
3. The events card now says "No upcoming events on the Google Calendar yet".
   If a step was missed, the card says which one instead.

To go back to adding events on the site, clear that field and Save.

## Step 5 — Add events from the Google Calendar app

1. In the app, tap **☰** and make sure **Lotus Community Events** is ticked
   (it can take a few minutes to appear).
2. **+ → Event** → tap the calendar name → pick **Lotus Community Events**.
3. Put **social**, **drill** (or **clinic**) or **ranked** in the title so the
   leaderboard shows the right points tag, e.g. "Saturday **Social** Mixer".
   Anything else shows as a Special event.
4. Save. It appears on the leaderboard within ~10 minutes (or on reload).
