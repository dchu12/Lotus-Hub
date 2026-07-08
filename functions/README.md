# Cloud Functions — DUPR integration (server side)

All DUPR Partner API calls live here because the API uses a **client secret**
(never allowed in the browser) and DUPR posts **webhooks** that need an HTTPS
endpoint. Functions write results to Firestore with the Admin SDK.

## Functions

| Function | Type | Purpose |
|---|---|---|
| `linkDupr` | callable | Look up a DUPR account by email, store `duprId` + ratings on the user doc |
| `refreshDuprRating` | callable | Re-fetch the caller's rating and update the cache |
| `submitSessionMatches` | callable (organizer) | Bulk-submit a session's `pending` matches to DUPR |
| `duprWebhook` | HTTPS | Receive rating-change events and update cached ratings |

## Prerequisites (all four are required before this works)

1. **DUPR API partner access** — apply to DUPR for a **client key + secret**
   (see <https://www.dupr.com/club-resources> / contact DUPR). This is the long pole.
2. **Firebase Blaze plan** — Cloud Functions with outbound network calls require
   pay-as-you-go (Firebase Console → upgrade project to Blaze; has a free tier).
3. **Node + Firebase CLI on a computer** — deploying can't be done from a phone.
4. **Confirm API paths** — the base URL, auth flow and endpoint paths in
   `index.js` (`CONFIG`) are correct in shape but must be verified against the
   DUPR partner docs / Swagger (<https://backend.mydupr.com/swagger-ui/index.html>).

## Deploy

```bash
cd Lotus-Hub
npm install -g firebase-tools        # if not already
firebase login
cd functions && npm install && cd ..

# Set DUPR credentials as secrets (never commit these):
firebase functions:secrets:set DUPR_CLIENT_KEY
firebase functions:secrets:set DUPR_CLIENT_SECRET

firebase deploy --only functions
```

After deploy, copy the `duprWebhook` URL from the deploy output and register it
in your DUPR partner dashboard, and add DUPR's signature verification to
`duprWebhook` before trusting payloads.

## Local testing (optional)

```bash
cd functions && npm install
firebase emulators:start --only functions,firestore
```

Until these are deployed, the app's **Connect DUPR** button will report that the
integration isn't live yet — everything else works without it.
