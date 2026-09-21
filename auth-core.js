/* ============================================================
   Nexus OS — auth core (Firebase Authentication, compat SDK).
   Loaded by auth.html and app.html. The Firebase SDK is fetched only
   when firebase-config.js is filled in, so local mode stays offline-
   friendly and dependency-free.

     NexusAuth.configured            true once Firebase config is present
     NexusAuth.guard()               -> user, or redirects to auth.html
     NexusAuth.current()             -> user | null   (no redirect)
     NexusAuth.signIn / signUp / google / reset / signOut
     NexusAuth.idToken()             -> Firebase ID token for the AI proxy
   A "user" is { uid, email, name, photo, verified, local }.
   ============================================================ */
(function () {
  var cfg = (window.NEXUS_CONFIG && window.NEXUS_CONFIG.firebase) || {};
  var configured = !!(cfg.apiKey && cfg.projectId && cfg.appId);
  var VER = "10.14.1";
  var LOCAL_FLAG = "nexus-os:local-mode";
  var authP = null;

  function loadScript(src) {
    if (window.NXSRI) return window.NXSRI.script(src);          // integrity-checked
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = res;
      s.onerror = function () { rej(new Error("Could not load " + src.split("/").pop() + " - check your connection.")); };
      document.head.appendChild(s);
    });
  }

  function init() {
    if (!configured) return Promise.resolve(null);
    if (authP) return authP;
    authP = (async function () {
      var base = "https://www.gstatic.com/firebasejs/" + VER + "/";
      await loadScript(base + "firebase-app-compat.js");
      await loadScript(base + "firebase-auth-compat.js");
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      return firebase.auth();
    })();
    return authP;
  }

  function shape(u) {
    if (!u) return null;
    return {
      uid: u.uid, email: u.email || "",
      name: u.displayName || (u.email || "").split("@")[0] || "You",
      photo: u.photoURL || "", verified: !!u.emailVerified, local: false
    };
  }
  function localUser() { return { uid: "local", email: "", name: "Local mode", photo: "", verified: true, local: true }; }
  function isLocal() { try { return !configured && localStorage.getItem(LOCAL_FLAG) === "1"; } catch (e) { return false; } }

  /* resolves once Firebase has restored (or not) the persisted session */
  async function current() {
    if (!configured) return isLocal() ? localUser() : null;
    var a = await init();
    return new Promise(function (res) {
      var off = a.onAuthStateChanged(function (u) { off(); res(shape(u)); });
    });
  }

  /* only ever redirect to our own pages, never to a URL taken from the query string */
  var NEXT_OK = { "app.html": 1 };
  function safeNext(n) {
    var page = String(n || "").split("#")[0].split("?")[0];
    return NEXT_OK[page] ? String(n) : "app.html";
  }

  async function guard() {
    var u = await current();
    if (u) return u;
    var here = (location.pathname.split("/").pop() || "app.html") + location.hash;
    location.replace("auth.html?next=" + encodeURIComponent(here));
    return new Promise(function () {});           // never resolves: the page is leaving
  }

  /* if the session ends in another tab, leave the portal */
  async function watch() {
    if (!configured) return;
    var a = await init();
    var first = true;
    a.onAuthStateChanged(function (u) {
      if (first) { first = false; return; }
      if (!u) location.replace("auth.html");
    });
  }

  var MSG = {
    "auth/invalid-credential": "That email and password don't match an account.",
    "auth/wrong-password": "That email and password don't match an account.",
    "auth/user-not-found": "That email and password don't match an account.",
    "auth/invalid-email": "That doesn't look like a valid email address.",
    "auth/email-already-in-use": "An account with this email already exists - try signing in.",
    "auth/weak-password": "Choose a stronger password (at least 6 characters).",
    "auth/too-many-requests": "Too many attempts. Wait a minute, then try again.",
    "auth/network-request-failed": "Network error - check your connection and try again.",
    "auth/popup-closed-by-user": "The Google window was closed before finishing.",
    "auth/cancelled-popup-request": "The Google window was closed before finishing.",
    "auth/popup-blocked": "Your browser blocked the Google popup. Allow popups for this site and retry.",
    "auth/unauthorized-domain": "This domain isn't authorised in Firebase (Authentication -> Settings -> Authorised domains).",
    "auth/operation-not-allowed": "This sign-in method isn't enabled in the Firebase console yet.",
    "auth/account-exists-with-different-credential": "That email is registered with a different sign-in method.",
    "auth/requires-recent-login": "For your security, please confirm your password and try again.",
    "auth/user-mismatch": "That's a different account from the one you're signed in with.",
    "auth/user-token-expired": "Your session expired - please sign in again."
  };
  function friendly(e) {
    var code = (e && e.code) || "";
    if (MSG[code]) return MSG[code];
    /* setup mistakes the site owner needs to hear about, in plain words */
    if (/^auth\/api-key/.test(code)) return "The Firebase API key in firebase-config.js isn't valid - copy it again from the Firebase console.";
    if (code === "auth/configuration-not-found" || code === "auth/project-not-found") return "Firebase Authentication isn't set up for this project yet (Firebase console -> Build -> Authentication -> Get started).";
    if (code === "auth/app-not-authorized") return "This app isn't authorised for that Firebase project.";
    if (code === "auth/network-request-failed") return MSG[code];
    /* never show Firebase's raw "Firebase: Error (auth/...)" text to a visitor */
    if (e && e.message && !/^Firebase:/i.test(e.message)) return e.message;
    return "Sign-in failed" + (code ? " (" + code.replace(/^auth\//, "") + ")" : "") + ". Please try again.";
  }

  async function need() {
    var a = await init();
    if (!a) throw new Error("Firebase isn't configured yet.");
    return a;
  }

  window.NexusAuth = {
    configured: configured,
    isLocal: isLocal,
    enterLocalMode: function () { try { localStorage.setItem(LOCAL_FLAG, "1"); } catch (e) {} },
    safeNext: safeNext,
    friendly: friendly,
    current: current,
    guard: guard,
    watch: watch,

    signIn: async function (email, password) {
      var a = await need();
      return shape((await a.signInWithEmailAndPassword(email, password)).user);
    },
    signUp: async function (name, email, password) {
      var a = await need();
      var cred = await a.createUserWithEmailAndPassword(email, password);
      if (name) { try { await cred.user.updateProfile({ displayName: name }); } catch (e) {} }
      try { await cred.user.sendEmailVerification(); } catch (e) {}
      return shape(cred.user);
    },
    google: async function () {
      var a = await need();
      var p = new firebase.auth.GoogleAuthProvider();
      p.setCustomParameters({ prompt: "select_account" });
      return shape((await a.signInWithPopup(p)).user);
    },
    reset: async function (email) { var a = await need(); await a.sendPasswordResetEmail(email); },
    resendVerification: async function () {
      var a = await need();
      if (a.currentUser) await a.currentUser.sendEmailVerification();
    },
    signOut: async function () {
      try { localStorage.removeItem(LOCAL_FLAG); } catch (e) {}
      if (configured) { var a = await init(); await a.signOut(); }
      location.replace("index.html");
    },
    /* the sign-in method of the current user: "password", "google.com", ... */
    providerId: async function () {
      var a = await need();
      var u = a.currentUser;
      return u && u.providerData && u.providerData[0] ? u.providerData[0].providerId : "";
    },
    /* After the user clicks the link in their verification email: pick up the new emailVerified
       flag and force a fresh ID token, so the AI proxy and Firestore rules see it immediately
       instead of after the old token expires (up to an hour). */
    refreshVerification: async function () {
      var a = await need(), u = a.currentUser;
      if (!u) return false;
      await u.reload();
      if (!u.emailVerified) return false;
      await u.getIdToken(true);
      return true;
    },
    /* the raw Firebase namespace, for modules that need another product (Firestore) */
    firebase: async function () { await need(); return window.firebase; },
    /* Deleting an account needs a recent sign-in. Do this BEFORE wiping data so a failed
       re-auth (wrong password) leaves everything intact. */
    reauthenticate: async function (password) {
      var a = await need(), u = a.currentUser;
      if (!u) throw new Error("You're not signed in.");
      var prov = u.providerData && u.providerData[0] ? u.providerData[0].providerId : "";
      if (prov === "password") {
        if (!password) { var e = new Error("Enter your password to continue."); e.code = "nexus/password-required"; throw e; }
        await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, password));
      } else {
        await u.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
      }
    },
    /* Permanently removes the Firebase account, then leaves the portal. */
    deleteAccount: async function () {
      var a = await need(), u = a.currentUser;
      if (!u) throw new Error("You're not signed in.");
      await u.delete();
      try { localStorage.removeItem(LOCAL_FLAG); } catch (e) {}
      location.replace("index.html?deleted=1");
    },
    /* Firebase ID token, sent as a Bearer token to the AI proxy so it can verify who is calling */
    idToken: async function () {
      if (!configured) return "";
      var a = await init();
      return a.currentUser ? a.currentUser.getIdToken() : "";
    }
  };
})();
