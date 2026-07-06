/* firebase-config.js — Firebase project config for Lotus Hub.
 *
 * This points at the app's own dedicated Firebase project (`lots-hub`), separate
 * from any other app. These web config values are PUBLIC identifiers, not secrets —
 * safe to commit. Real security comes from firestore.rules and Firebase Auth.
 *
 * To change projects, replace the values below with the config from
 * Firebase console → ⚙ Project settings → Your apps → Web app.
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyC9b-VCWEG3K1yf7WZee6uo4az95VItJqc",
  authDomain: "lots-hub.firebaseapp.com",
  projectId: "lots-hub",
  storageBucket: "lots-hub.firebasestorage.app",
  messagingSenderId: "409895305585",
  appId: "1:409895305585:web:30e93ab6598ddd389e36d0",
};

// True once real values are filled in — the app uses this to show a setup banner.
window.FIREBASE_CONFIGURED =
  !String(window.FIREBASE_CONFIG.apiKey).startsWith("PASTE_");
