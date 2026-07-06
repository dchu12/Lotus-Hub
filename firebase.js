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
  var ready = false;

  function init() {
    if (!hasSDK || !configured || ready) return ready;
    try {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});
      db.enablePersistence({ synchronizeTabs: true }).catch(function () {});
      ready = true;
    } catch (e) {
      ready = false;
    }
    return ready;
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

  function watchRsvps(sessionId, cb) {
    if (!ready) return function () {};
    return sessionsCol()
      .doc(sessionId)
      .collection("rsvps")
      .where("status", "==", "going")
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
          var already = rsvpSnap.exists && rsvpSnap.data().status === "going";
          var count = s.attendeeCount || 0;
          var full = count >= (s.capacity || 8);
          var status = already ? "going" : full ? "waitlist" : "going";
          tx.set(myRsvp, {
            uid: u.uid,
            displayName: profile.displayName || u.displayName || "Player",
            rating: profile.rating != null ? profile.rating : null,
            photoDataUrl: profile.photoDataUrl || profile.photoURL || null,
            skillLevel: profile.skillLevel || null,
            status: status,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          if (!already && status === "going") {
            tx.update(sessRef, {
              attendeeCount: count + 1,
              status: count + 1 >= (s.capacity || 8) ? "full" : "open",
            });
          }
          return status;
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
        var wasGoing = rsvpSnap.data().status === "going";
        tx.delete(myRsvp);
        if (wasGoing) {
          return tx.get(sessRef).then(function (sessSnap) {
            if (!sessSnap.exists) return;
            var count = Math.max(0, (sessSnap.data().attendeeCount || 0) - 1);
            tx.update(sessRef, { attendeeCount: count, status: "open" });
          });
        }
      });
    });
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
    watchUser: watchUser,
    getUserOnce: getUserOnce,
    watchCoaches: watchCoaches,
    watchUpcomingSessions: watchUpcomingSessions,
    createSession: createSession,
    watchRsvps: watchRsvps,
    join: join,
    leave: leave,
    myRsvpStatus: myRsvpStatus,
  };
})();
