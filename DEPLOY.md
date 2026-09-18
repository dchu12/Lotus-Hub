# Deploying Lotus Hub (Firebase Hosting)

Gets the app onto a public URL like `https://lotus-hub.web.app` so you can open it
on your phone and add it to your home screen — no local server needed.

> You need to run these once on a **computer** (Mac/Windows/Linux) with Node.js
> installed. There's no phone-only path to deploy.

> **Naming note:** the underlying Firebase *project* is `lots-hub` (a typo from
> when it was created — project IDs can't be renamed after the fact, and
> recreating the project would mean losing all its Firestore data). The site is
> configured to deploy to a second, correctly-spelled **Hosting site**,
> `lotus-hub`, via the `main` target in `.firebaserc` / `firebase.json` — that's
> why the live URL below reads right even though the project id doesn't. The
> original `lots-hub.web.app` site still exists under the same project but no
> longer receives deploys once `lotus-hub` is set up (below); it'll keep serving
> whatever was last deployed there.

## 1. Install the Firebase CLI

```bash
npm install -g firebase-tools
```

## 2. Log in (opens a browser — use the same Google account as the project)

```bash
firebase login
```

## 3. Get the code

```bash
git clone https://github.com/dchu12/Lotus-Hub.git
cd Lotus-Hub
```

## 4. One-time: create the `lotus-hub` Hosting site

Only needed once per Firebase project (skip if it already exists — check
Firebase console → Hosting):

```bash
firebase hosting:sites:create lotus-hub
```

`.firebaserc` already maps the `main` hosting target used by `firebase.json` to
this site name, so nothing else to configure.

## 5. Deploy

```bash
firebase deploy
```

This publishes the site **and** the Firestore security rules. When it finishes it
prints your live URL: **https://lotus-hub.web.app**

(Merging to `main` on GitHub also deploys automatically via
`.github/workflows/firebase-deploy.yml`, using a stored service-account key —
no local CLI needed for that path, other than the one-time site creation above.)

## Thank-you card tracker (`/thank-you.html`)

A private, shared tracker at **https://lotus-hub.web.app/thank-you.html**. It syncs
in real time through this same Firebase project (Firestore doc `trackers/wedding`)
and is gated to an email **allowlist** in `firestore.rules` (`trackerAllowed()`).

- `firebase deploy` publishes the site **and** the rules together, so the allowlist
  takes effect on deploy — no extra step.
- To add/remove who can open it, edit the email list in **two** places and redeploy:
  `firestore.rules` (`trackerAllowed()`) and `ALLOWED_EMAILS` in `thank-you.html`.
- If Firebase is unreachable, the page falls back to on-device storage so it still works.

## Custom domain (later)

Firebase console → Hosting → **Add custom domain** → follow the DNS steps for a
domain you own (e.g. `lotushub.com`).
