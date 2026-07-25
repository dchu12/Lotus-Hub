# 🎯 Coach Console

A lightweight console for running your pickleball coaching — part of **Lotus
Hub**. Schedule lessons, track each student and their **DUPR goal**, keep a
reusable **drill library**, and see at a glance **who still owes you**.

Static HTML/CSS/JS, no build step, no dependencies, no server. Open
`coach/index.html`, or serve the repo and visit `/coach/`. Installable as a PWA
and works offline.

## What it does

| Tab | What it holds |
|-----|---------------|
| 📅 **Schedule** | Lessons grouped by day (upcoming / past / all) — student, time, type, focus, drills used, price and paid status. One-tap **mark paid**. |
| 🧑‍🎓 **Students** | Each player — level, contact, current → goal **DUPR** with a progress bar, goals/notes, and a lesson count. Book a lesson straight from their card. |
| 🎯 **Drills** | Your drill library grouped by category (dinks, thirds, serves, volleys, footwork, strategy…). Drop drills into any lesson. |
| 💵 **Money** | Earned this month, earned all-time, total outstanding, and a **who-owes-you** breakdown per student. |

The dashboard up top always shows your **next lesson**, **lessons this week**,
**student count**, and **outstanding balance**.

## Data & privacy

Everything saves automatically to **localStorage on this device** — nothing is
sent anywhere. Use **⚙️ → Back up everything** to export a JSON file you can
restore on another device, and **Load sample data** to see how it all fits
together before entering your own.

> Want it synced across devices and your phone? The natural next step is to wire
> it to the same Firebase (Auth + Firestore) the main Lotus Hub app already
> uses — the data model here (students / lessons / drills) maps cleanly to
> Firestore collections.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell, tabs, drawer |
| `styles.css` | Lotus crimson + gold theme (light + dark) |
| `app.js` | All app logic — views, forms, storage |
| `manifest.webmanifest` / `sw.js` | PWA install + offline shell |
| `icon.svg` | App icon |
