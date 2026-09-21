/* node --test tests/auth.test.js - auth-core.js run against a fake Firebase + browser */
const test = require("node:test");
const assert = require("node:assert");
const path = require.resolve("../auth-core.js");

function makeEnv({ configured = true, user = null } = {}) {
  const env = { replaced: [], calls: [], store: {}, user };
  const local = { getItem: (k) => (k in env.store ? env.store[k] : null), setItem: (k, v) => { env.store[k] = String(v); }, removeItem: (k) => { delete env.store[k]; } };

  const auth = {
    get currentUser() { return env.user; },
    onAuthStateChanged(cb) { queueMicrotask(() => cb(env.user)); return () => {}; },
    async signInWithEmailAndPassword(e, p) { env.calls.push(["signIn", e]); return { user: env.user }; },
    async createUserWithEmailAndPassword(e, p) {
      env.calls.push(["create", e]);
      env.user = { uid: "new1", email: e, displayName: null, emailVerified: false, providerData: [{ providerId: "password" }],
        async updateProfile(x) { env.calls.push(["updateProfile", x.displayName]); this.displayName = x.displayName; },
        async sendEmailVerification() { env.calls.push(["sendVerification"]); } };
      return { user: env.user };
    },
    async signInWithPopup() { env.calls.push(["popup"]); return { user: env.user }; },
    async sendPasswordResetEmail(e) { env.calls.push(["reset", e]); },
    async signOut() { env.calls.push(["signOut"]); env.user = null; },
  };
  const fb = {
    apps: [], initializeApp(cfg) { this.apps.push(cfg); env.calls.push(["init", cfg.projectId]); },
    auth: Object.assign(() => auth, {
      EmailAuthProvider: { credential: (email, pw) => ({ email, pw, kind: "password-cred" }) },
      GoogleAuthProvider: function () { this.setCustomParameters = () => {}; this.kind = "google"; },
    }),
  };

  globalThis.window = globalThis;
  globalThis.NEXUS_CONFIG = { firebase: configured ? { apiKey: "k", projectId: "p", appId: "a", authDomain: "d" } : {} };
  globalThis.localStorage = local;
  globalThis.location = { pathname: "/app.html", hash: "#jobs", replace: (u) => env.replaced.push(u) };
  globalThis.firebase = fb;
  delete globalThis.NXSRI;
  globalThis.document = { createElement: () => ({}), head: { appendChild: (el) => queueMicrotask(() => el.onload && el.onload()) } };
  delete require.cache[path];
  require(path);
  env.auth = globalThis.NexusAuth;
  return env;
}
const verifiedUser = (over = {}) => ({
  uid: "u1", email: "a@b.com", displayName: "Aarav", emailVerified: true, providerData: [{ providerId: "password" }],
  async reload() { this._reloaded = (this._reloaded || 0) + 1; }, async getIdToken(force) { this._tokens = (this._tokens || []).concat(!!force); return "tok" + (force ? "-fresh" : ""); },
  reauth: [], async reauthenticateWithCredential(c) { this.reauth.push(c); }, async reauthenticateWithPopup(p) { this.reauth.push(p); },
  async delete() { this._deleted = true; }, ...over,
});

/* ---------- local mode ---------- */
test("unconfigured: no session until the visitor opts into local mode", async () => {
  const env = makeEnv({ configured: false });
  assert.strictEqual(env.auth.configured, false);
  assert.strictEqual(await env.auth.current(), null);
  env.auth.enterLocalMode();
  const u = await env.auth.current();
  assert.strictEqual(u.local, true);
  assert.strictEqual(u.uid, "local");
});

test("the gate sends signed-out visitors to auth.html, remembering where they were going", async () => {
  const env = makeEnv({ configured: false });
  env.auth.guard();                                    // never resolves
  await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual(env.replaced, ["auth.html?next=" + encodeURIComponent("app.html#jobs")]);
});

test("configured but signed out: gate redirects; signed in: resolves with a shaped user", async () => {
  let env = makeEnv({ user: null });
  env.auth.guard(); await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(env.replaced.length, 1);
  env = makeEnv({ user: verifiedUser() });
  const u = await env.auth.guard();
  assert.deepStrictEqual(u, { uid: "u1", email: "a@b.com", name: "Aarav", photo: "", verified: true, local: false });
  assert.strictEqual(env.replaced.length, 0);
});

/* ---------- redirect safety ---------- */
test("safeNext only ever returns our own portal page", () => {
  const { auth } = makeEnv();
  assert.strictEqual(auth.safeNext("app.html"), "app.html");
  assert.strictEqual(auth.safeNext("app.html#jobs"), "app.html#jobs");
  for (const evil of ["https://evil.example/app.html", "//evil.example", "javascript:alert(1)", "/app.html", "../app.html", "data:text/html,x", "auth.html", "", null, undefined, "app.html.evil.com"]) {
    assert.strictEqual(auth.safeNext(evil), "app.html", "must not follow: " + evil);
  }
});

/* ---------- messages ---------- */
test("friendly() explains common failures and never leaks Firebase's raw text", () => {
  const { auth } = makeEnv();
  assert.match(auth.friendly({ code: "auth/invalid-credential" }), /don't match/);
  assert.match(auth.friendly({ code: "auth/email-already-in-use" }), /already exists/);
  assert.match(auth.friendly({ code: "auth/too-many-requests" }), /Too many/);
  assert.match(auth.friendly({ code: "auth/api-key-not-valid.-please-pass-a-valid-api-key." }), /API key in firebase-config\.js/);
  assert.match(auth.friendly({ code: "auth/configuration-not-found" }), /Authentication/);
  assert.match(auth.friendly({ code: "auth/requires-recent-login" }), /confirm your password/);
  const raw = auth.friendly({ code: "auth/something-new", message: "Firebase: Error (auth/something-new)." });
  assert.ok(!/Firebase: Error/.test(raw));
  assert.match(raw, /something-new/);
  assert.match(auth.friendly({ message: "Could not load x - check your connection." }), /check your connection/);
  assert.ok(auth.friendly(undefined).length > 5);
});

/* ---------- sign-up / sign-in ---------- */
test("sign-up stores the display name and sends the verification email", async () => {
  const env = makeEnv({ user: null });
  const u = await env.auth.signUp("Aarav", "new@x.com", "secret12");
  const names = env.calls.map((c) => c[0]);
  assert.ok(names.includes("create") && names.includes("updateProfile") && names.includes("sendVerification"));
  assert.strictEqual(u.name, "Aarav");
  assert.strictEqual(u.verified, false);
});

test("the SDK is only loaded when needed (never in local mode)", async () => {
  const env = makeEnv({ configured: false });
  await env.auth.current();
  assert.ok(!env.calls.some((c) => c[0] === "init"));
  await assert.rejects(env.auth.signIn("a@b.com", "x"), /isn't configured/);
});

/* ---------- verified-email refresh (drives the AI + sync gates) ---------- */
test("refreshVerification: still unverified -> false, and no token refresh is forced", async () => {
  const user = verifiedUser({ emailVerified: false });
  const env = makeEnv({ user });
  assert.strictEqual(await env.auth.refreshVerification(), false);
  assert.strictEqual(user._reloaded, 1);
  assert.strictEqual(user._tokens, undefined);
});

test("refreshVerification: after the email link is clicked, forces a fresh ID token", async () => {
  const user = verifiedUser({ emailVerified: false });
  user.reload = async function () { this.emailVerified = true; };     // the click happened elsewhere
  const env = makeEnv({ user });
  assert.strictEqual(await env.auth.refreshVerification(), true);
  assert.deepStrictEqual(user._tokens, [true], "getIdToken(true) - otherwise the proxy still sees the stale claim");
});

test("idToken: empty in local mode, real token when signed in", async () => {
  assert.strictEqual(await makeEnv({ configured: false }).auth.idToken(), "");
  assert.strictEqual(await makeEnv({ user: verifiedUser() }).auth.idToken(), "tok");
});

/* ---------- account deletion ---------- */
test("re-authentication: password accounts must supply their password; it is verified with Firebase", async () => {
  const user = verifiedUser();
  const env = makeEnv({ user });
  await assert.rejects(env.auth.reauthenticate(""), (e) => e.code === "nexus/password-required");
  assert.strictEqual(user.reauth.length, 0);
  await env.auth.reauthenticate("hunter2");
  assert.deepStrictEqual(user.reauth[0], { email: "a@b.com", pw: "hunter2", kind: "password-cred" });
});

test("re-authentication: Google accounts use the popup and need no password", async () => {
  const user = verifiedUser({ providerData: [{ providerId: "google.com" }] });
  const env = makeEnv({ user });
  await env.auth.reauthenticate();
  assert.strictEqual(user.reauth[0].kind, "google");
});

test("a wrong password stops deletion before anything is removed", async () => {
  const user = verifiedUser();
  user.reauthenticateWithCredential = async () => { const e = new Error("bad"); e.code = "auth/wrong-password"; throw e; };
  const env = makeEnv({ user });
  await assert.rejects(env.auth.reauthenticate("nope"), (e) => e.code === "auth/wrong-password");
  assert.ok(!user._deleted, "account must still exist");
});

test("deleteAccount removes the Firebase user, clears the local-mode flag and leaves with ?deleted=1", async () => {
  const user = verifiedUser();
  const env = makeEnv({ user });
  env.store["nexus-os:local-mode"] = "1";
  await env.auth.deleteAccount();
  assert.strictEqual(user._deleted, true);
  assert.strictEqual(env.store["nexus-os:local-mode"], undefined);
  assert.deepStrictEqual(env.replaced, ["index.html?deleted=1"]);
});

test("deleteAccount when nobody is signed in fails cleanly", async () => {
  const env = makeEnv({ user: null });
  await assert.rejects(env.auth.deleteAccount(), /not signed in/);
});

test("signOut signs out of Firebase and goes home", async () => {
  const env = makeEnv({ user: verifiedUser() });
  await env.auth.signOut();
  assert.ok(env.calls.some((c) => c[0] === "signOut"));
  assert.deepStrictEqual(env.replaced, ["index.html"]);
});
