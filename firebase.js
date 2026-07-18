/* firebase.js — thin wrapper around Firebase Auth + Firestore for Lotus Hub.
 *
 * Loads only if the Firebase compat SDK and a real config are present. Exposes a
 * small global `LH` API used by app.js. Keeps all Firebase specifics in one place
 * so the rest of the app talks in plain domain terms (users, sessions, rsvps).
 *
 * NOTE: This wrapper only does client-safe work — auth and reading/writing
 * Firestore under the security rules. Anything involving the DUPR client SECRET
 * (submitting matches, receiving rating webhooks) must live in Cloud Functions
 * (see functions/), never here, or the secret would leak to the browser. */
(function () {
  "use strict";

  var hasSDK =
    typeof firebase !== "undefined" &&
    firebase &&
    typeof firebase.initializeApp === "function";
  var configured = !!window.FIREBASE_CONFIGURED;

  var auth = null;
  var db = null;
  var fns = null;
  var analytics = null;
  var messaging = null;
  var ready = false;

  function init() {
    if (!hasSDK || !configured || ready) return ready;
    try {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      // Cloud Functions (DUPR integration). Only usable once functions deploy.
      try { fns = firebase.functions ? firebase.functions() : null; } catch (e) { fns = null; }
      // Analytics stays dormant until a measurementId is added to the config.
      try {
        analytics = firebase.analytics && window.FIREBASE_CONFIG.measurementId ? firebase.analytics() : null;
      } catch (e) { analytics = null; }
      // Cloud Messaging (push). Dormant until a vapidKey is added to the config.
      try { messaging = firebase.messaging ? firebase.messaging() : null; } catch (e) { messaging = null; }
      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});
      db.enablePersistence({ synchronizeTabs: true }).catch(function () {});
      ready = true;
    } catch (e) {
      ready = false;
    }
    return ready;
  }

  // ---- DUPR (calls Cloud Functions; see functions/) ---------------------
  function callFn(name, payload) {
    if (!ready || !fns) return Promise.reject(new Error("Not connected."));
    return fns
      .httpsCallable(name)(payload || {})
      .then(function (res) {
        return res.data;
      });
  }
  function linkDupr(email) {
    return callFn("linkDupr", { email: String(email || "").trim() });
  }
  function refreshDuprRating() {
    return callFn("refreshDuprRating", {});
  }

  // ---- Auth -------------------------------------------------------------
  function onAuth(cb) {
    if (!ready) {
      cb(null);
      return function () {};
    }
    return auth.onAuthStateChanged(function (u) {
      cb(u || null);
    });
  }

  function signUp(email, password, displayName) {
    if (!ready) return Promise.reject(new Error("Sign-in isn't available yet."));
    return auth
      .createUserWithEmailAndPassword(String(email).trim(), password)
      .then(function (cred) {
        return ensureUserDoc(cred.user, displayName);
      });
  }

  function signIn(email, password) {
    if (!ready) return Promise.reject(new Error("Sign-in isn't available yet."));
    return auth
      .signInWithEmailAndPassword(String(email).trim(), password)
      .then(function (cred) {
        return ensureUserDoc(cred.user);
      });
  }

  function signInWithGoogle() {
    if (!ready) return Promise.reject(new Error("Sign-in isn't available yet."));
    var provider = new firebase.auth.GoogleAuthProvider();
    return auth.signInWithPopup(provider).then(function (res) {
      return ensureUserDoc(res.user);
    });
  }

  function signOut() {
    return ready && auth ? auth.signOut() : Promise.resolve();
  }

  // Fire-and-forget analytics event. No-ops safely if analytics isn't set up.
  function logEvent(name, params) {
    try { if (analytics) analytics.logEvent(name, params || {}); } catch (e) {}
  }

  // ---- Push notifications (session reminders) ---------------------------
  function notificationsSupported() {
    return !!(
      ready && messaging &&
      typeof window !== "undefined" && "Notification" in window &&
      "serviceWorker" in navigator &&
      window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.vapidKey
    );
  }
  function notificationPermission() {
    return typeof Notification !== "undefined" ? Notification.permission : "unsupported";
  }

  // Ask permission, get an FCM token, and store it under the user's tokens
  // subcollection so the reminder function can reach this device.
  function enableNotifications() {
    if (!notificationsSupported()) return Promise.reject(new Error("Notifications aren't set up yet."));
    var u = auth.currentUser;
    if (!u) return Promise.reject(new Error("Sign in first."));
    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") {
        throw new Error("Notifications are blocked — allow them for this site in your browser settings.");
      }
      return messaging.getToken({ vapidKey: window.FIREBASE_CONFIG.vapidKey });
    }).then(function (token) {
      if (!token) throw new Error("Couldn't register this device for notifications.");
      return userDoc(u.uid).collection("tokens").doc(token).set({
        token: token,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        ua: (typeof navigator !== "undefined" && navigator.userAgent) || null,
      }).then(function () { return token; });
    });
  }

  // Turn off: delete the current token doc and the FCM token.
  function disableNotifications() {
    if (!ready || !messaging) return Promise.resolve();
    var u = auth.currentUser;
    return messaging.getToken({ vapidKey: (window.FIREBASE_CONFIG || {}).vapidKey }).then(function (token) {
      var work = [];
      if (token && u) work.push(userDoc(u.uid).collection("tokens").doc(token).delete().catch(function () {}));
      work.push(messaging.deleteToken().catch(function () {}));
      return Promise.all(work);
    }).catch(function () {});
  }

  function onForegroundMessage(cb) {
    if (!ready || !messaging) return function () {};
    try { return messaging.onMessage(function (payload) { cb(payload); }); }
    catch (e) { return function () {}; }
  }

  function resetPassword(email) {
    if (!ready) return Promise.reject(new Error("Sign-in isn't available yet."));
    return auth.sendPasswordResetEmail(String(email || "").trim());
  }

  // ---- Users ------------------------------------------------------------
  function userDoc(uid) {
    return db.collection("users").doc(uid);
  }

  // Create the profile doc on first sign-in. On later sign-ins, ONLY fill in
  // fields that are missing — never clobber values the user has saved (name,
  // photo, skill, court, paddle, DUPR).
  function ensureUserDoc(user, displayName) {
    if (!user) return Promise.resolve(null);
    var ref = userDoc(user.uid);
    return ref.get().then(function (snap) {
      if (!snap.exists) {
        var base = {
          uid: user.uid,
          email: user.email || null,
          displayName: displayName || user.displayName || (user.email || "Player").split("@")[0],
          photoURL: user.photoURL || null,
          duprLinked: false,
          duprId: null,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        return ref.set(base).then(function () {
          return base;
        });
      }
      var data = snap.data();
      var patch = {};
      if (displayName) patch.displayName = displayName; // explicit sign-up name wins
      else if (!data.displayName) patch.displayName = user.displayName || (user.email || "Player").split("@")[0];
      if (!data.email && user.email) patch.email = user.email;
      if (data.photoURL == null && user.photoURL) patch.photoURL = user.photoURL;
      if (!Object.keys(patch).length) return data;
      return ref.set(patch, { merge: true }).then(function () {
        return Object.assign({}, data, patch);
      });
    });
  }

  function watchUser(uid, cb) {
    if (!ready) return function () {};
    return userDoc(uid).onSnapshot(
      function (snap) {
        cb(snap.exists ? snap.data() : null);
      },
      function () {}
    );
  }

  // One-time read of any user's public profile (used for a coach's detail page).
  function getUserOnce(uid) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    return userDoc(uid)
      .get()
      .then(function (s) {
        return s.exists ? Object.assign({ uid: s.id }, s.data()) : null;
      });
  }

  // Realtime list of players for the Connect tab (bounded for read cost;
  // filtered/sorted client-side).
  function watchPlayers(cb) {
    if (!ready) return function () {};
    return db
      .collection("users")
      .limit(200)
      .onSnapshot(
        function (qs) {
          var out = [];
          qs.forEach(function (d) {
            out.push(Object.assign({ uid: d.id }, d.data()));
          });
          cb(out);
        },
        function () {
          cb([]);
        }
      );
  }

  // Realtime list of users who have opted in as coaches.
  function watchCoaches(cb) {
    if (!ready) return function () {};
    return db
      .collection("users")
      .where("isCoach", "==", true)
      .onSnapshot(
        function (qs) {
          var out = [];
          qs.forEach(function (d) {
            out.push(Object.assign({ uid: d.id }, d.data()));
          });
          cb(out);
        },
        function () {
          cb([]);
        }
      );
  }

  // ---- Connections (player-to-player friend requests) -------------------
  // One doc per pair, keyed by the two uids sorted + joined so a pair can't be
  // duplicated regardless of who initiates.
  function pairId(a, b) {
    return [a, b].sort().join("__");
  }

  function watchConnections(cb) {
    if (!ready) return function () {};
    var u = auth.currentUser;
    if (!u) { cb([]); return function () {}; }
    return db
      .collection("connections")
      .where("users", "array-contains", u.uid)
      .onSnapshot(
        function (qs) {
          var out = [];
          qs.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); });
          cb(out);
        },
        function () { cb([]); }
      );
  }

  function requestConnection(otherUid) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    var u = auth.currentUser;
    if (!u) return Promise.reject(new Error("Sign in first."));
    if (otherUid === u.uid) return Promise.reject(new Error("That's your own profile."));
    return db.collection("connections").doc(pairId(u.uid, otherUid)).set({
      users: [u.uid, otherUid].sort(),
      requestedBy: u.uid,
      status: "pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  function acceptConnection(otherUid) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    var u = auth.currentUser;
    if (!u) return Promise.reject(new Error("Sign in first."));
    return db.collection("connections").doc(pairId(u.uid, otherUid)).update({
      status: "accepted",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  function removeConnection(otherUid) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    var u = auth.currentUser;
    if (!u) return Promise.reject(new Error("Sign in first."));
    return db.collection("connections").doc(pairId(u.uid, otherUid)).delete();
  }

  // ---- Reports & blocks -------------------------------------------------
  function reportUser(uid, reason) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    var u = auth.currentUser;
    if (!u) return Promise.reject(new Error("Sign in first."));
    return db.collection("reports").add({
      reporterUid: u.uid,
      reportedUid: uid,
      reason: reason || null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
  function blockUser(uid) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    var u = auth.currentUser;
    if (!u) return Promise.reject(new Error("Sign in first."));
    return userDoc(u.uid).collection("blocks").doc(uid).set({
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
  function unblockUser(uid) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    var u = auth.currentUser;
    if (!u) return Promise.reject(new Error("Sign in first."));
    return userDoc(u.uid).collection("blocks").doc(uid).delete();
  }
  function watchBlocks(cb) {
    if (!ready) return function () {};
    var u = auth.currentUser;
    if (!u) { cb([]); return function () {}; }
    return userDoc(u.uid).collection("blocks").onSnapshot(
      function (qs) { var out = []; qs.forEach(function (d) { out.push(d.id); }); cb(out); },
      function () { cb([]); }
    );
  }

  // ---- Sessions (open play) --------------------------------------------
  function sessionsCol() {
    return db.collection("sessions");
  }

  // Realtime list of upcoming, non-cancelled sessions, soonest first.
  function watchUpcomingSessions(cb) {
    if (!ready) return function () {};
    return sessionsCol()
      .where("status", "in", ["open", "full"])
      .orderBy("startAt", "asc")
      .onSnapshot(
        function (qs) {
          var out = [];
          qs.forEach(function (d) {
            out.push(Object.assign({ id: d.id }, d.data()));
          });
          cb(out);
        },
        function () {
          cb([]);
        }
      );
  }

  function createSession(data) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    var u = auth.currentUser;
    if (!u) return Promise.reject(new Error("Sign in first."));
    var doc = {
      title: data.title,
      venueName: data.venueName,
      startAt: firebase.firestore.Timestamp.fromDate(data.startAt),
      endAt: data.endAt ? firebase.firestore.Timestamp.fromDate(data.endAt) : null,
      courtCount: data.courtCount || 1,
      capacity: data.capacity || 8,
      skillMin: data.skillMin != null ? data.skillMin : null,
      skillMax: data.skillMax != null ? data.skillMax : null,
      organizerUid: u.uid,
      organizerName: data.organizerName || u.displayName || "Organizer",
      status: "open",
      attendeeCount: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    return sessionsCol().add(doc);
  }

  // ---- RSVPs ------------------------------------------------------------
  // Stored as a subcollection: sessions/{id}/rsvps/{uid}. attendeeCount on the
  // parent is kept roughly in sync via a transaction so lists stay cheap.
  function rsvpDoc(sessionId, uid) {
    return sessionsCol().doc(sessionId).collection("rsvps").doc(uid);
  }

  // All RSVPs for a session, oldest-first. Confirmed vs. waitlist is DERIVED by
  // the client from this order + the session capacity — so when someone leaves,
  // everyone behind them shifts up automatically (free waitlist promotion).
  function watchRsvps(sessionId, cb) {
    if (!ready) return function () {};
    return sessionsCol()
      .doc(sessionId)
      .collection("rsvps")
      .orderBy("joinedAt", "asc")
      .onSnapshot(
        function (qs) {
          var out = [];
          qs.forEach(function (d) {
            out.push(Object.assign({ uid: d.id }, d.data()));
          });
          cb(out);
        },
        function () {
          cb([]);
        }
      );
  }

  function join(sessionId, profile) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    var u = auth.currentUser;
    if (!u) return Promise.reject(new Error("Sign in first."));
    var sessRef = sessionsCol().doc(sessionId);
    var myRsvp = rsvpDoc(sessionId, u.uid);
    return db.runTransaction(function (tx) {
      return tx.get(sessRef).then(function (sessSnap) {
        if (!sessSnap.exists) throw new Error("Session no longer exists.");
        var s = sessSnap.data();
        return tx.get(myRsvp).then(function (rsvpSnap) {
          var already = rsvpSnap.exists;
          var count = s.attendeeCount || 0;
          // As the newest RSVP, my slot is the current total; confirmed if that
          // is still within capacity.
          var confirmed = count < (s.capacity || 8);
          tx.set(myRsvp, {
            uid: u.uid,
            displayName: profile.displayName || u.displayName || "Player",
            rating: profile.rating != null ? profile.rating : null,
            photoDataUrl: profile.photoDataUrl || profile.photoURL || null,
            skillLevel: profile.skillLevel || null,
            heritageFlag: profile.heritageFlag || null,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          if (!already) tx.update(sessRef, { attendeeCount: count + 1 });
          return already ? "already" : confirmed ? "going" : "waitlist";
        });
      });
    });
  }

  function leave(sessionId) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    var u = auth.currentUser;
    if (!u) return Promise.reject(new Error("Sign in first."));
    var sessRef = sessionsCol().doc(sessionId);
    var myRsvp = rsvpDoc(sessionId, u.uid);
    return db.runTransaction(function (tx) {
      return tx.get(myRsvp).then(function (rsvpSnap) {
        if (!rsvpSnap.exists) return;
        tx.delete(myRsvp);
        return tx.get(sessRef).then(function (sessSnap) {
          if (!sessSnap.exists) return;
          var count = Math.max(0, (sessSnap.data().attendeeCount || 0) - 1);
          tx.update(sessRef, { attendeeCount: count });
        });
      });
    });
  }

  // Organizer edits the session's details.
  function updateSession(sessionId, data) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    if (!auth.currentUser) return Promise.reject(new Error("Sign in first."));
    return sessionsCol().doc(sessionId).update({
      title: data.title,
      venueName: data.venueName,
      startAt: firebase.firestore.Timestamp.fromDate(data.startAt),
      courtCount: data.courtCount || 1,
      capacity: data.capacity || 8,
      skillMin: data.skillMin != null ? data.skillMin : null,
      skillMax: data.skillMax != null ? data.skillMax : null,
    });
  }

  // Organizer cancels the session (drops it from the upcoming list).
  function cancelSession(sessionId) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    if (!auth.currentUser) return Promise.reject(new Error("Sign in first."));
    return sessionsCol().doc(sessionId).update({ status: "cancelled" });
  }

  function myRsvpStatus(sessionId, cb) {
    if (!ready) return function () {};
    var u = auth.currentUser;
    if (!u) {
      cb(null);
      return function () {};
    }
    return rsvpDoc(sessionId, u.uid).onSnapshot(
      function (snap) {
        cb(snap.exists ? snap.data().status : null);
      },
      function () {}
    );
  }

  // ---- Games / scores (open-play results) -------------------------------
  // Stored as sessions/{id}/games/{gameId}; organizer-entered (see rules).
  // These power player stats now and bridge to DUPR (matches) later.
  function sessionGames(sessionId) {
    return sessionsCol().doc(sessionId).collection("games");
  }

  function watchSessionGames(sessionId, cb) {
    if (!ready) return function () {};
    return sessionGames(sessionId)
      .orderBy("createdAt", "asc")
      .onSnapshot(
        function (qs) {
          var out = [];
          qs.forEach(function (d) {
            out.push(Object.assign({ id: d.id }, d.data()));
          });
          cb(out);
        },
        function () {
          cb([]);
        }
      );
  }

  // game: { teamA: [{uid,displayName}], teamB: [...], scoreA, scoreB }
  function addGame(sessionId, game) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    var u = auth.currentUser;
    if (!u) return Promise.reject(new Error("Sign in first."));
    var teamA = (game.teamA || []).slice(0, 2);
    var teamB = (game.teamB || []).slice(0, 2);
    var uidOf = function (p) { return p.uid; };
    var nameOf = function (p) { return p.displayName || "Player"; };
    return sessionGames(sessionId).add({
      teamA: teamA.map(uidOf),
      teamB: teamB.map(uidOf),
      teamANames: teamA.map(nameOf),
      teamBNames: teamB.map(nameOf),
      players: teamA.concat(teamB).map(uidOf), // flat list for array-contains
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      winner: game.scoreA > game.scoreB ? "A" : "B",
      enteredBy: u.uid,
      duprStatus: "pending", // picked up by submitSessionMatches once DUPR is live
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  function deleteGame(sessionId, gameId) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    return sessionGames(sessionId).doc(gameId).delete();
  }

  function getSessionOnce(sessionId) {
    if (!ready) return Promise.reject(new Error("Not connected."));
    return sessionsCol()
      .doc(sessionId)
      .get()
      .then(function (s) {
        return s.exists ? Object.assign({ id: s.id }, s.data()) : null;
      });
  }

  // Every player's record in one pass, for the leaderboard. Returns a map of
  // uid -> { games, wins, losses, winRate }.
  function getAllPlayerStats() {
    if (!ready) return Promise.resolve({});
    return db
      .collectionGroup("games")
      .get()
      .then(function (qs) {
        var map = {};
        qs.forEach(function (d) {
          var g = d.data();
          var teamA = g.teamA || [];
          (g.players || []).forEach(function (uid) {
            var m = map[uid] || (map[uid] = { games: 0, wins: 0, losses: 0, winRate: 0 });
            m.games++;
            var inA = teamA.indexOf(uid) > -1;
            if ((inA && g.winner === "A") || (!inA && g.winner === "B")) m.wins++;
          });
        });
        Object.keys(map).forEach(function (uid) {
          var m = map[uid];
          m.losses = m.games - m.wins;
          m.winRate = m.games ? Math.round((m.wins / m.games) * 100) : 0;
        });
        return map;
      })
      .catch(function () { return {}; });
  }

  // A player's cross-session record, computed from every game they appear in.
  function getPlayerStats(uid) {
    if (!ready || !uid) return Promise.resolve({ games: 0, wins: 0, losses: 0, winRate: 0 });
    return db
      .collectionGroup("games")
      .where("players", "array-contains", uid)
      .get()
      .then(function (qs) {
        var games = 0;
        var wins = 0;
        qs.forEach(function (d) {
          var g = d.data();
          games++;
          var inA = (g.teamA || []).indexOf(uid) > -1;
          if ((inA && g.winner === "A") || (!inA && g.winner === "B")) wins++;
        });
        return {
          games: games,
          wins: wins,
          losses: games - wins,
          winRate: games ? Math.round((wins / games) * 100) : 0,
        };
      });
  }

  window.LH = {
    get available() {
      return hasSDK && configured;
    },
    get ready() {
      return ready;
    },
    get configured() {
      return configured;
    },
    init: init,
    currentUser: function () {
      return ready && auth.currentUser ? auth.currentUser : null;
    },
    onAuth: onAuth,
    signUp: signUp,
    signIn: signIn,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    resetPassword: resetPassword,
    logEvent: logEvent,
    notificationsSupported: notificationsSupported,
    notificationPermission: notificationPermission,
    enableNotifications: enableNotifications,
    disableNotifications: disableNotifications,
    onForegroundMessage: onForegroundMessage,
    watchUser: watchUser,
    getUserOnce: getUserOnce,
    watchCoaches: watchCoaches,
    watchPlayers: watchPlayers,
    watchConnections: watchConnections,
    requestConnection: requestConnection,
    acceptConnection: acceptConnection,
    removeConnection: removeConnection,
    reportUser: reportUser,
    blockUser: blockUser,
    unblockUser: unblockUser,
    watchBlocks: watchBlocks,
    linkDupr: linkDupr,
    refreshDuprRating: refreshDuprRating,
    watchUpcomingSessions: watchUpcomingSessions,
    createSession: createSession,
    updateSession: updateSession,
    cancelSession: cancelSession,
    watchRsvps: watchRsvps,
    join: join,
    leave: leave,
    myRsvpStatus: myRsvpStatus,
    watchSessionGames: watchSessionGames,
    addGame: addGame,
    deleteGame: deleteGame,
    getSessionOnce: getSessionOnce,
    getPlayerStats: getPlayerStats,
    getAllPlayerStats: getAllPlayerStats,
  };
})();
