# Deploying Lotus Hub (Firebase Hosting)

Gets the app onto a public URL like `https://lots-hub.web.app` so you can open it
on your phone and add it to your home screen — no local server needed.

## Automated deploys (GitHub Actions) — recommended

`.github/workflows/deploy.yml` deploys **Hosting + Firestore rules** to the
`lots-hub` project on every push to `main` (and on manual trigger). Set it up
once — after that, merging to `main` publishes the app; no computer needed.

**One-time setup — create a deploy key and add it as a repo secret:**

1. **Create a service account** (all in the browser):
   [Google Cloud console → IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=lots-hub)
   → **Create service account** (e.g. `github-deploy`) → grant it the role
   **Firebase Admin** (covers Hosting + Firestore rules) → **Done**.
2. **Make a JSON key:** open the new service account → **Keys → Add key →
   Create new key → JSON** → this downloads a `.json` file.
3. **Add it to GitHub:** repo **Settings → Secrets and variables → Actions →
   New repository secret**. Name it exactly `FIREBASE_SERVICE_ACCOUNT` and paste
   the **entire contents** of the JSON file as the value.
4. **Trigger a deploy:** merge to `main`, or run the workflow manually from the
   repo's **Actions** tab (**Deploy to Firebase → Run workflow**).

> Cloud Functions are **not** deployed by CI (they need the Blaze plan and the
> DUPR secrets). Deploy those separately when DUPR goes live — see
> `docs/DUPR-GO-LIVE.md`.

## Manual deploy (from a computer)

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

## Custom domain (later)

Firebase console → Hosting → **Add custom domain** → follow the DNS steps for a
domain you own (e.g. `lotushub.com`).
