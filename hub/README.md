# 🪷 Lotus Hub — launcher

The front door to every Lotus app. A simple, installable card grid that links
out to each app so you launch them all from one home-screen icon.

Static HTML/CSS/JS, no build step. Open `hub/index.html`, or serve the repo and
visit `/hub/`.

## Apps it links to

| App | Path |
|-----|------|
| 🏓 Pickleball (open play, roster, rankings) | `/` |
| 🎯 Coach Console (lessons, students, drills) | `/coach/` |

> The `retirement/` and `trip-planner/` apps are standalone and intentionally
> not listed here.

## Adding an app

Edit the `APPS` array at the top of [`app.js`](./app.js):

```js
{ emoji: "🎾", name: "New App", tag: "What it does", href: "../new-app/", accent: "#0f766e" },
```

Each entry needs an emoji, a name, a one-line tagline, a `href` (relative to
`/hub/`), and an accent colour for its card stripe.
