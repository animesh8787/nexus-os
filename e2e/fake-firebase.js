/* Runs IN THE PAGE in place of firebase-app-compat.js during browser tests.
   A faithful-enough stand-in for the subset of the compat SDK that Nexus OS uses:
     auth:      onAuthStateChanged, currentUser, signIn/create/popup/signOut, reset,
                user.reload / getIdToken / reauthenticate* / delete / updateProfile / sendEmailVerification
     firestore: collection().doc().get/set/delete, collection().get(), batch()
   The signed-in user lives in localStorage["fake-fb-user"] (tests seed it and can flip
   emailVerified to simulate clicking the email link). Firestore is served by the test runner
   through window.__fs, so two browser contexts can share one "cloud". */
(function () {
  var KEY = "fake-fb-user";
  var listeners = [];
  var counters = window.__fakeCounters = { verifyEmails: 0, deleted: false, tokenRefreshes: 0 };

  function readUser() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function writeUser(u) { if (u) localStorage.setItem(KEY, JSON.stringify(u)); else localStorage.removeItem(KEY); }
  function notify() { var u = wrap(); listeners.forEach(function (cb) { cb(u); }); }

  var current = null, freshToken = false;
  function wrap() {
    var raw = readUser();
    if (!raw) { current = null; return null; }
    current = {
      uid: raw.uid, email: raw.email, displayName: raw.displayName || null, emailVerified: !!raw.emailVerified, photoURL: null,
      providerData: [{ providerId: raw.providerId || "password" }],
      reload: function () { var r = readUser(); if (r) { this.emailVerified = !!r.emailVerified; } return Promise.resolve(); },
      /* like the real SDK: once refreshed, later calls return the new token (the old one stays stale) */
      getIdToken: function (force) { if (force) { counters.tokenRefreshes++; freshToken = true; } return Promise.resolve("fake-id-token" + (freshToken ? "-fresh" : "")); },
      reauthenticateWithCredential: function (cred) {
        if (cred.pw !== raw.password) { var e = new Error("wrong"); e.code = "auth/wrong-password"; return Promise.reject(e); }
        return Promise.resolve();
      },
      reauthenticateWithPopup: function () { return Promise.resolve(); },
      delete: function () { counters.deleted = true; writeUser(null); current = null; notify(); return Promise.resolve(); },
      updateProfile: function (p) { var r = readUser(); r.displayName = p.displayName; writeUser(r); return Promise.resolve(); },
      sendEmailVerification: function () { counters.verifyEmails++; return Promise.resolve(); }
    };
    return current;
  }

  var auth = {
    get currentUser() { return wrap(); },
    onAuthStateChanged: function (cb) { listeners.push(cb); setTimeout(function () { cb(wrap()); }, 0); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; },
    signInWithEmailAndPassword: function (email, pw) {
      var r = readUser();
      if (r && r.email === email && r.password === pw) return Promise.resolve({ user: wrap() });
      var e = new Error("bad"); e.code = "auth/invalid-credential"; return Promise.reject(e);
    },
    createUserWithEmailAndPassword: function (email, pw) {
      writeUser({ uid: "u-" + email, email: email, password: pw, emailVerified: false, providerId: "password" });
      var u = wrap(); notify(); return Promise.resolve({ user: u });
    },
    signInWithPopup: function () { return Promise.resolve({ user: wrap() }); },
    sendPasswordResetEmail: function () { return Promise.resolve(); },
    signOut: function () { writeUser(null); notify(); return Promise.resolve(); }
  };

  /* ---- Firestore, backed by the test runner ---- */
  function meta() { var u = readUser() || {}; return { uid: u.uid, verified: !!u.emailVerified }; }
  function call(op, path, data) {
    return window.__fs(op, path, data === undefined ? null : data, meta()).then(function (r) {
      if (r && r.error) { var e = new Error(r.error.message); e.code = r.error.code; throw e; }
      return r;
    });
  }
  function DocRef(path) { this.path = path; this.id = path.split("/").pop(); }
  DocRef.prototype.collection = function (n) { return new CollRef(this.path + "/" + n); };
  DocRef.prototype.get = function () { var self = this; return call("get", this.path).then(function (r) { return { exists: !!r.exists, id: self.id, ref: self, data: function () { return r.data; } }; }); };
  DocRef.prototype.set = function (d) { return call("set", this.path, d); };
  DocRef.prototype.delete = function () { return call("delete", this.path); };
  function CollRef(path) { this.path = path; }
  CollRef.prototype.doc = function (id) { return new DocRef(this.path + "/" + id); };
  CollRef.prototype.get = function () {
    var self = this;
    return call("list", this.path).then(function (r) {
      var docs = r.docs.map(function (d) { return { id: d.id, ref: new DocRef(self.path + "/" + d.id), exists: true, data: function () { return d.data; } }; });
      return { docs: docs, empty: !docs.length, forEach: function (cb) { docs.forEach(cb); } };
    });
  };
  var db = {
    collection: function (n) { return new CollRef(n); },
    batch: function () {
      var ops = [];
      return {
        set: function (ref, d) { ops.push(["set", ref.path, d]); },
        delete: function (ref) { ops.push(["delete", ref.path]); },
        commit: function () { return call("batch", "", ops); }
      };
    }
  };

  var firebase = window.firebase = {
    apps: [],
    initializeApp: function (cfg) { this.apps.push(cfg); return {}; },
    auth: Object.assign(function () { return auth; }, {
      EmailAuthProvider: { credential: function (email, pw) { return { email: email, pw: pw }; } },
      GoogleAuthProvider: function () { this.setCustomParameters = function () {}; this.kind = "google"; }
    }),
    firestore: function () { return db; }
  };
})();
