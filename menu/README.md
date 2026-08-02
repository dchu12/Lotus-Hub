# 🍽️ TapMenu — a paid QR menu / "link-in-one-place" for small businesses

Give a café, food truck, salon or shop **one QR code and link** that shows their
menu, prices, hours and socials — and let them **edit it themselves anytime**.
No reprinting laminated menus every time a price changes.

This is the money-maker: businesses pay a small monthly fee to keep their menu
live. It's a standalone app in this repo (`/menu/`), built the same way as the
others — vanilla JS, no build step, Firebase Auth + Firestore.

## How it works

One app, two modes decided by the URL:

| URL | Who | What |
|-----|-----|------|
| `/menu/?m=<slug>` | **Customer** | Scans the QR → sees the live menu. No sign-in. |
| `/menu/` | **Owner** | Signs in, builds the menu, downloads the QR, shares the link. |

Each business's menu is a single Firestore document under `menus/{slug}`. The
`slug` is the public id baked into the QR — so the **QR never changes** even when
the owner edits prices or marks something sold out.

## The business model

- **14-day free trial** on every new menu (no card needed to start).
- After that, **$7/month** keeps the menu live for customers (`plan: "pro"`).
- When a trial ends and they haven't upgraded, the public page shows
  "temporarily unavailable" — the gentle nudge to pay. All the enforcement
  logic (`isActive()` in `app.js`) is already built.

At $7/mo, **100 businesses ≈ $700/month recurring** for a tool you barely touch.
Sell it by walking into local cafés — the QR + "change prices from your phone"
pitch closes in person.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell + Firebase / QR script tags |
| `app.js` | Everything: router, public menu, owner dashboard, editor, QR, paywall |
| `styles.css` | Styling (light + dark), public page + owner UI |
| `manifest.webmanifest` / `sw.js` | PWA install + offline shell |
| `icon.svg` | App icon |

## Setup

TapMenu uses the **shared** Lotus Firebase project (`/firebase-config.js`), so
there's nothing extra to configure locally. Two things to do in Firebase:

1. **Publish the Firestore rules.** The `menus` collection block is already in
   the repo's `firestore.rules` (public read, owner-only write). Publish it via
   the console or `firebase deploy --only firestore:rules`.
2. **Enable Auth providers** — Email/Password and Google (already on for the
   pickleball app).

Run it locally with the rest of the repo:

```bash
python3 -m http.server 8000
# owner app:     http://localhost:8000/menu/
# a live menu:   http://localhost:8000/menu/?m=<slug>
```

Create a menu, toggle it **Live**, then open the share link (or scan the QR) to
see the customer view.

## Wiring real payments (Stripe) — the one remaining piece

Everything works today **except taking money**. The "Upgrade to Pro" button
currently shows a placeholder. To collect the $7/mo, add Stripe Checkout in a
Cloud Function (never in the browser — the Stripe secret key must stay
server-side). Sketch:

1. **`createCheckout` callable function** — creates a Stripe Checkout Session
   for a `price_...` (a $7/mo recurring price) with `client_reference_id` set to
   the menu slug, and returns the session URL. The browser redirects to it.
2. **`stripeWebhook` HTTPS function** — on `checkout.session.completed` and
   `customer.subscription.updated/deleted`, set that menu's
   `plan` to `"pro"` (or back to `"trial"`/expired) using the Admin SDK.
3. In `app.js` → `showUpgrade()`, replace the placeholder `toast(...)` with a
   redirect to the checkout URL returned by `createCheckout`.

The `functions/` folder in the repo root is the right home for these. Store the
Stripe secret with `firebase functions:config:set stripe.secret=...` — it must
**never** appear in any file the browser loads.

Until then the app is fully usable for demos and pilots: menus, QR codes,
sharing, trials and the paywall gate all work.
