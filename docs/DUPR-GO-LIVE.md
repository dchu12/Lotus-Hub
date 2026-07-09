# DUPR go-live checklist

Everything for the DUPR integration is already built and pushed. This is the
exact sequence to run **once DUPR approves the API partner application** and
issues a **client key + secret**.

> Status as of saving this: application **submitted** (awaiting approval).
> Manual/self-reported DUPR ratings are live in the app in the meantime.

## Steps (in order)

1. **Receive DUPR credentials** — client key + secret from DUPR.

2. **Upgrade Firebase to the Blaze plan** (Cloud Functions require it):
   Firebase Console → project `lots-hub` → upgrade to **Blaze** (pay-as-you-go;
   has a free tier, needs a billing card).

3. **Confirm the DUPR API paths** in `functions/index.js` → `CONFIG` against the
   partner docs / Swagger (`https://backend.mydupr.com/swagger-ui/index.html`):
   - `authPath` and the token field name in the auth response
   - `paths.playerSearch`, `paths.playerRating`, `paths.matchBulk`
   - request/response shapes in `ratingsFrom()` and `submitSessionMatches`

4. **Deploy** (on a computer with Node + Firebase CLI):
   ```bash
   cd Lotus-Hub
   firebase login
   cd functions && npm install && cd ..
   firebase functions:secrets:set DUPR_CLIENT_KEY
   firebase functions:secrets:set DUPR_CLIENT_SECRET
   firebase deploy --only functions
   ```

5. **Register the webhook** — copy the `duprWebhook` URL from the deploy output
   into the DUPR partner dashboard, and add DUPR's signature verification to the
   `duprWebhook` function before trusting payloads.

6. **Test** — on the profile, tap **Connect DUPR**, enter your DUPR email; the
   verified rating should replace the self-reported one. Then wire the leaderboard
   to real ratings and hook `submitSessionMatches` into score entry.

## What's already done (no action needed)

- `functions/` — `linkDupr`, `refreshDuprRating`, `submitSessionMatches`, `duprWebhook`
- Client — Connect DUPR / Refresh flow, calls the callables, clear "not live yet" messaging
- `firebase.json` — functions codebase registered
- Interim — manual self-reported rating on the profile

## Follow-ups parked until approval (raise these again after go-live)

- Feed real (verified) ratings into the **Rank** leaderboard (replace sample players)
- **Score entry** for open-play sessions → submit results to DUPR via `submitSessionMatches`
