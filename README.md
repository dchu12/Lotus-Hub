# 🪷 Lotus Hub

An open-play **pickleball** app: sign in, find and join open-play sessions near you,
see who's coming, and (once wired up) sync your results to your **DUPR** rating.

Built as an installable **PWA** with **Firebase** (Auth + Firestore) for shared,
multi-user data. No framework — vanilla JS, same simple style as a static site.

> This is a fresh project with its **own separate Firebase project** — it does not
> share any backend, data, or config with any other app.

## Status

| Area | State |
|---|---|
| Auth (email + Google) | ✅ built (needs your Firebase keys) |
| Open-play sessions: create / browse / join / leave | ✅ built |
| Live roster + waitlist | ✅ built |
| DUPR rating sync | 🚧 stubbed — needs the Cloud Functions integration (see `functions/`) |

See `docs/pickleball-app-plan.md` for the full architecture and phased roadmap.

## Setup (5 minutes)

**1. Create a Firebase project** at <https://console.firebase.google.com>

- Add project (e.g. `lotus-hub`)
- **Build → Authentication** → enable **Email/Password** and **Google**
- **Build → Firestore Database** → create database (start in test mode)
- **Project settings ⚙ → Your apps → Web `</>`** → register → copy the config

**2. Paste your config** into [`firebase-config.js`](./firebase-config.js), replacing
the `PASTE_...` placeholders. (These web keys are public identifiers, not secrets —
safe to commit. Security comes from the rules below.)

**3. Add the security rules** — copy [`firestore.rules`](./firestore.rules) into
Firebase console → Firestore → **Rules** → Publish.

**4. Run it** — no build step:

```bash
python3 -m http.server 8000
# visit http://localhost:8000
```

The app shows a setup banner until real Firebase keys are present, then sign-in
and open play light up.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell, tab layout, script loading |
| `styles.css` | Styling (light + dark) |
| `app.js` | UI + app logic (views, RSVP, forms) |
| `firebase.js` | Firebase Auth + Firestore wrapper (`window.LH`) |
| `firebase-config.js` | **Your** Firebase project keys (placeholders to fill in) |
| `firestore.rules` | Firestore security rules to publish |
| `manifest.json` / `sw.js` | PWA install + offline shell |
| `functions/` | Server-side DUPR integration (planned — holds the client secret) |
| `docs/pickleball-app-plan.md` | Full technical plan & roadmap |

## DUPR integration

DUPR requires a server (its API uses a client **secret**, and it sends webhooks),
so all DUPR calls live in Cloud Functions — never in the browser. That work is
scoped in `functions/README.md` and gated on getting **DUPR API partner** credentials.
Everything else works without it.
