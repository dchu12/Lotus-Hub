# 🏖️ Trip Planner

A fun, beachy **vacation planner**. Name your trip, set the dates, and track
everything in one place: flights (to & from, with flight numbers, seats and
confirmation codes), hotels for each night, a day-by-day itinerary with
ticketed events and reservations, and an itemized budget.

Every trip is its own copy of the same **reusable template** — spin up a new
one for each getaway, or duplicate an existing trip to reuse as a starting point.

> Rename it any time — "Trip Planner" is just a placeholder for a more creative
> name later. Change it right in the header (the trip name) or the browser tab
> title in `index.html`.

## Features

| Tab | What it holds |
|-----|---------------|
| 🧭 **Overview** | Trip name, destination, dates, live countdown, day/night counts, budget snapshot, and your flights & hotels at a glance |
| ✈️ **Flights** | Outbound, return and connecting flights — airline, flight #, from/to, times, seat, confirmation, cost |
| 🏨 **Accommodations** | Each stay — hotel, resort or rental — with check-in / check-out (auto nights), address, confirmation, cost and notes |
| 🗓️ **Itinerary** | Day-by-day plans grouped by date — activities, 🎟️ ticketed events, 🍽️ reservations, transport and notes |
| 🧳 **Packing** | A checklist you tick off as you pack, with a progress bar. Add your own items or drop in the beach essentials |
| 💰 **Budget** | Currency picker, travellers + **per-person split**, overall target, itemized lines by category, planned vs actual, paid checkboxes, and a one-click pull of costs from your bookings |
| 📌 **Details** | Catch-all notebook — passports, emergency contacts, wifi codes… |

### Travellers & splitting

Add everyone on the trip in the **Budget** tab. Each budget line is split evenly
by default; tap a traveller's avatar on any line to include/exclude them (e.g.
one person's flight, or an activity only some join). The **Split N ways** card
shows what each person owes.

### Share a trip

**⚙ menu → 🔗 Share this trip** copies a link with the whole trip packed into it
(no server, no account). Whoever opens the link is offered a one-tap **Add to my
planner** — a read-only-until-you-keep-it copy of your trip.

### Install as an app (PWA)

Trip Planner ships a web manifest + service worker, so you can **install it to
your home screen** and it **works offline** (your data is on-device anyway). On
mobile, use "Add to Home Screen"; on desktop Chrome/Edge, the install icon in
the address bar.

### Currencies

Each trip has its own currency, chosen on the **Budget** tab. It reformats every
amount across the whole trip (flights, hotels, plans and budget):

- 🇨🇦 **Canadian Dollar (CAD)** — the default
- 🇯🇵 **Japanese Yen (JPY)**
- 🇲🇾 **Malaysian Ringgit (MYR)**

## How it works

- **No build, no server, no account.** Plain HTML/CSS/JS.
- **Auto-saves** to your browser's `localStorage` on this device.
- **Back up all trips** exports a JSON file; **Restore from file** brings it back
  (or moves everything to another device).
- **Print / Save PDF** and a light/dark **beach theme** are built in.

## Run it

```bash
python3 -m http.server 8000
# then open http://localhost:8000/trip-planner/
```

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell — header, tabs, decorative sky/waves |
| `styles.css` | Ocean + sunset theme (light & dark) |
| `app.js` | All app logic — state, rendering, trips, budget |

It's fully self-contained and shares no data or backend with anything else in
this repository.
