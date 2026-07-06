/* firebase-config.js — Firebase project config for Lotus Hub.
 *
 * ⚠️ PASTE YOUR OWN NEW FIREBASE PROJECT'S CONFIG BELOW.
 *
 * This is a brand-new, separate Firebase project — NOT the Yosan / payday-budget
 * project. Create it at https://console.firebase.google.com:
 *   1. Add project (e.g. "lotus-hub")
 *   2. Build → Authentication → enable Email/Password and Google
 *   3. Build → Firestore Database → create (test mode; rules are in firestore.rules)
 *   4. Project settings ⚙ → Your apps → Web app </> → copy the config object here
 *
 * These web config values are PUBLIC identifiers, not secrets — safe to commit.
 * Real security comes from firestore.rules and Firebase Auth, not from hiding these.
 */
window.FIREBASE_CONFIG = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID",
};

// True once real values are filled in — the app uses this to show a setup banner.
window.FIREBASE_CONFIGURED =
  !String(window.FIREBASE_CONFIG.apiKey).startsWith("PASTE_");
