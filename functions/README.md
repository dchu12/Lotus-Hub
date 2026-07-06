# Cloud Functions — DUPR integration (server side)

This folder is where the **DUPR Partner API** integration lives. It is intentionally
kept out of the browser code because the DUPR API uses a **client secret** that must
never ship to the client, and DUPR sends **webhooks** that need a server endpoint.

## Why this can't go in the browser

- The DUPR partner **client key + secret** authenticate your app to DUPR. Anything
  in `firebase.js` / `app.js` is fully visible to users. The secret must stay server-side.
- Submitting match results and receiving rating-change webhooks are server-to-server
  operations.

## Planned functions (not yet implemented)

| Function | Trigger | Purpose |
|---|---|---|
| `linkDupr` | HTTPS callable | Look up a DUPR ID by the user's email, store `duprId` on their user doc |
| `refreshRating` | callable / scheduled | Fetch current rating from DUPR, cache on the user doc |
| `submitSessionMatches` | callable (organizer) | Bulk-submit a session's match results to DUPR |
| `duprWebhook` | HTTPS | Receive DUPR rating-change events, update cached ratings |

## Setup when you're ready to build these

1. Apply for **DUPR API partner** access to get a client key + secret (this approval
   is the long pole — start it early).
2. `cd functions && npm init` and add the Firebase Functions SDK + Admin SDK.
3. Store credentials as secrets — never in source:
   ```bash
   firebase functions:secrets:set DUPR_CLIENT_KEY
   firebase functions:secrets:set DUPR_CLIENT_SECRET
   ```
4. Use the DUPR **UAT** environment for all development; switch to production only
   after partner approval.

Until these exist, the app's "Connect DUPR" button is a stub and open play works
fully without ratings (phases 1–3 of `docs/pickleball-app-plan.md`).
