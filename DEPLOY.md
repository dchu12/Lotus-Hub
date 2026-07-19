# Deploying Lotus Hub (Firebase Hosting)

Gets the app onto a public URL like `https://lots-hub.web.app` so you can open it
on your phone and add it to your home screen — no local server needed.

> You need to run these once on a **computer** (Mac/Windows/Linux) with Node.js
> installed. There's no phone-only path to deploy.

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

## 4. Deploy

```bash
firebase deploy
```

This publishes the site **and** the Firestore security rules. When it finishes it
prints your live URL: **https://lots-hub.web.app**

## Optional: get a nicer URL (`lotus-hub.web.app`)

The default URL uses the project ID (`lots-hub`). To use the correctly-spelled
`lotus-hub` instead, create a second hosting site (name must be free globally):

```bash
firebase hosting:sites:create lotus-hub
firebase target:apply hosting main lotus-hub
```

Then set the hosting target in `firebase.json` (change `"hosting": { ... }` to
`"hosting": [{ "target": "main", ...same options... }]`) and redeploy:

```bash
firebase deploy --only hosting
```

Your app is then live at **https://lotus-hub.web.app**.

## Thank-you card tracker (`/thank-you.html`)

A private, shared tracker at **https://lots-hub.web.app/thank-you.html**. It syncs
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
