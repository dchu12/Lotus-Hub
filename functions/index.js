/**
 * Lotus Hub — Cloud Functions (server-side DUPR integration).
 *
 * WHY THIS IS SERVER-SIDE: the DUPR Partner API uses a client key + secret that
 * must never ship to the browser, and DUPR posts webhooks that need an HTTPS
 * endpoint. So all DUPR calls live here and write results to Firestore with the
 * Admin SDK (which bypasses security rules).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BEFORE THIS DOES ANYTHING REAL you must:
 *   1. Get DUPR API **partner** access (client key + secret) from DUPR.
 *   2. Put the project on the **Blaze** plan (Cloud Functions need it).
 *   3. Set the secrets:
 *        firebase functions:secrets:set DUPR_CLIENT_KEY
 *        firebase functions:secrets:set DUPR_CLIENT_SECRET
 *   4. Verify the API paths in CONFIG below against the DUPR partner docs /
 *      Swagger (https://backend.mydupr.com/swagger-ui/index.html) — the flows
 *      here are correct in shape but the exact paths/payloads must match yours.
 *   5. Deploy:  firebase deploy --only functions
 * ─────────────────────────────────────────────────────────────────────────────
 */
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const DUPR_CLIENT_KEY = defineSecret("DUPR_CLIENT_KEY");
const DUPR_CLIENT_SECRET = defineSecret("DUPR_CLIENT_SECRET");

/* ── CONFIG ─ verify these against the DUPR partner docs after approval ────── */
const CONFIG = {
  // Use the UAT base while developing; switch to production once approved.
  baseUrl: "https://backend.mydupr.com",
  // Auth: exchange client key/secret for a bearer token. Confirm path + body.
  authPath: "/auth/v1.0/token",
  // Endpoint paths (confirm against Swagger — placeholders are best-guess shapes):
  paths: {
    playerSearch: "/player/v1.0/search", // POST { email } -> player(s)
    playerRating: (duprId) => `/player/v1.0/${duprId}/ratings`, // GET
    matchBulk: "/match/v1.0/bulk", // POST bulk match results
  },
  // How long a token is cached in-memory per warm instance (ms).
  tokenTtlMs: 25 * 60 * 1000,
};

/* ── DUPR API client ───────────────────────────────────────────────────────── */
let _token = null;
let _tokenExp = 0;

async function duprToken() {
  const now = Date.now();
  if (_token && now < _tokenExp) return _token;
  const res = await fetch(CONFIG.baseUrl + CONFIG.authPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: DUPR_CLIENT_KEY.value(),
      clientSecret: DUPR_CLIENT_SECRET.value(),
    }),
  });
  if (!res.ok) {
    throw new HttpsError("unavailable", "DUPR auth failed (" + res.status + ")");
  }
  const data = await res.json();
  // Confirm the token field name against the partner docs.
  _token = data.token || data.accessToken || (data.result && data.result.token);
  _tokenExp = now + CONFIG.tokenTtlMs;
  if (!_token) throw new HttpsError("unavailable", "DUPR auth: no token in response");
  return _token;
}

async function duprFetch(path, options = {}) {
  const token = await duprToken();
  const res = await fetch(CONFIG.baseUrl + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!res.ok) {
    logger.error("DUPR API error", { path, status: res.status, body });
    throw new HttpsError("unavailable", "DUPR request failed (" + res.status + ")");
  }
  return body;
}

// Normalize a DUPR player payload into the fields our app stores on the user doc.
function ratingsFrom(player) {
  const r = (player && (player.ratings || player.result || player)) || {};
  const num = (v) => (v == null || v === "" || v === "NR" ? null : Number(v));
  return {
    duprId: player && (player.id || player.duprId) ? String(player.id || player.duprId) : null,
    homeRatingDoubles: num(r.doubles),
    homeRatingSingles: num(r.singles),
  };
}

/* ── Callable: link a DUPR account by email ──────────────────────────────────── */
exports.linkDupr = onCall(
  { secrets: [DUPR_CLIENT_KEY, DUPR_CLIENT_SECRET] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const email = String((request.data && request.data.email) || "").trim().toLowerCase();
    if (!email) throw new HttpsError("invalid-argument", "A DUPR email is required.");

    // Look up the DUPR player by email. Confirm request/response shape vs docs.
    const found = await duprFetch(CONFIG.paths.playerSearch, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    const player =
      (found && found.result && (found.result[0] || found.result.player)) ||
      (Array.isArray(found) ? found[0] : found);
    if (!player) throw new HttpsError("not-found", "No DUPR account found for that email.");

    const info = ratingsFrom(player);
    if (!info.duprId) throw new HttpsError("not-found", "Couldn't read that DUPR profile.");

    await db.collection("users").doc(request.auth.uid).set(
      {
        duprLinked: true,
        duprId: info.duprId,
        duprEmail: email,
        homeRatingDoubles: info.homeRatingDoubles,
        homeRatingSingles: info.homeRatingSingles,
        duprSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true, duprId: info.duprId, ratings: info };
  }
);

/* ── Callable: refresh the caller's cached rating ────────────────────────────── */
exports.refreshDuprRating = onCall(
  { secrets: [DUPR_CLIENT_KEY, DUPR_CLIENT_SECRET] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const ref = db.collection("users").doc(request.auth.uid);
    const snap = await ref.get();
    const duprId = snap.exists && snap.data().duprId;
    if (!duprId) throw new HttpsError("failed-precondition", "No linked DUPR account.");

    const data = await duprFetch(CONFIG.paths.playerRating(duprId));
    const info = ratingsFrom({ id: duprId, ratings: data });
    await ref.set(
      {
        homeRatingDoubles: info.homeRatingDoubles,
        homeRatingSingles: info.homeRatingSingles,
        duprSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true, ratings: info };
  }
);

/* ── Callable: submit an open-play session's matches to DUPR ─────────────────── */
exports.submitSessionMatches = onCall(
  { secrets: [DUPR_CLIENT_KEY, DUPR_CLIENT_SECRET] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const sessionId = String((request.data && request.data.sessionId) || "");
    if (!sessionId) throw new HttpsError("invalid-argument", "sessionId is required.");

    const sessSnap = await db.collection("sessions").doc(sessionId).get();
    if (!sessSnap.exists) throw new HttpsError("not-found", "Session not found.");
    if (sessSnap.data().organizerUid !== request.auth.uid) {
      throw new HttpsError("permission-denied", "Only the organizer can submit results.");
    }

    const matchesSnap = await db
      .collection("matches")
      .where("sessionId", "==", sessionId)
      .where("duprStatus", "==", "pending")
      .get();
    if (matchesSnap.empty) return { ok: true, submitted: 0 };

    // Map our match docs to DUPR's bulk-match payload. Confirm shape vs docs.
    const matches = matchesSnap.docs.map((d) => {
      const m = d.data();
      return {
        // TODO: map team DUPR IDs + scores to DUPR's expected fields.
        teamA: m.teamA,
        teamB: m.teamB,
        scores: m.scores,
      };
    });

    const result = await duprFetch(CONFIG.paths.matchBulk, {
      method: "POST",
      body: JSON.stringify({ matches }),
    });

    const batch = db.batch();
    matchesSnap.docs.forEach((d) => {
      batch.update(d.ref, {
        duprStatus: "submitted",
        duprSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    return { ok: true, submitted: matches.length, result };
  }
);

/* ── HTTPS: DUPR rating-change webhook ───────────────────────────────────────── */
// Register this URL in the DUPR partner dashboard. Add signature verification
// per DUPR's webhook docs before trusting the payload.
exports.duprWebhook = onRequest(
  { secrets: [DUPR_CLIENT_KEY, DUPR_CLIENT_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    try {
      const body = req.body || {};
      const duprId = String(body.duprId || body.id || "");
      if (!duprId) return res.status(400).send("missing duprId");

      const info = ratingsFrom(body);
      const q = await db.collection("users").where("duprId", "==", duprId).get();
      const batch = db.batch();
      q.forEach((doc) => {
        batch.set(
          doc.ref,
          {
            homeRatingDoubles: info.homeRatingDoubles,
            homeRatingSingles: info.homeRatingSingles,
            duprSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
      await batch.commit();
      return res.status(200).send("ok");
    } catch (e) {
      logger.error("duprWebhook error", e);
      return res.status(500).send("error");
    }
  }
);
