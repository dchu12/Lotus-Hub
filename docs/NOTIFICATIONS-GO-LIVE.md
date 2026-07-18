# Push notifications go-live checklist

Session-reminder push is fully built and deployed on the client. It stays
dormant (the profile shows "Session reminders — coming soon") until you do the
steps below. Reminders fire ~1 hour before an open-play session to everyone
who's marked **going**.

## What's already in place
- `firebase-messaging-sw.js` — background push handler (shows the notification).
- Client flow — permission request, FCM token, saved under `users/{uid}/tokens/*`,
  plus the **Enable reminders** toggle on the profile edit screen.
- Firestore rules — token subcollection is private to its owner.
- `functions/sendSessionReminders` — scheduled function (every 15 min) that finds
  sessions starting in ~1h, collects attendees' tokens, and sends the push.

## Steps to turn it on

1. **Upgrade to the Blaze plan** (scheduled Cloud Functions + Cloud Scheduler
   require it): Firebase Console → project `lots-hub` → upgrade to Blaze.

2. **Create a Web Push certificate (VAPID key):**
   Firebase Console → ⚙ Project settings → **Cloud Messaging** → **Web Push
   certificates** → **Generate key pair** → copy the key.

3. **Add it to the config:** in `firebase-config.js`, uncomment and fill:
   ```js
   vapidKey: "BPaste_your_public_VAPID_key_here",
   ```
   (Bump the `firebase-config.js?v=` query in `index.html` + `sw.js` so clients
   pick it up, then redeploy hosting.)

4. **Deploy the function** (from a computer with Node + Firebase CLI, on Blaze):
   ```bash
   cd functions && npm install && cd ..
   firebase deploy --only functions:sendSessionReminders,firestore:rules,hosting
   ```
   The first deploy will prompt to enable the Cloud Scheduler + Pub/Sub APIs —
   accept.

5. **Test:** on your phone, open the app → Profile → Edit → **Enable reminders**
   (grant permission). Create a session starting ~1 hour out, join it, and wait
   for the scheduled run — or trigger the function manually from the console to
   verify the push arrives.

## Notes
- iOS: web push works only for apps **added to the Home Screen** (installed PWA),
  iOS 16.4+. Android/desktop Chrome work in the browser.
- The `notification` permission prompt must be triggered by a tap (it is — the
  Enable button), so users opt in explicitly.
- `sendSessionReminders` marks each session `reminderSent: true` so nobody gets
  reminded twice.
