const fs = require("node:fs");
const path = require("node:path");
const { expect } = require("@playwright/test");

const FAKE_FB = fs.readFileSync(path.join(__dirname, "fake-firebase.js"), "utf8");
const BASE = "http://localhost:4173";

/* ---------------- the fake cloud (mirrors firestore.rules) ---------------- */
function newCloud() { return { store: new Map(), writes: 0, log: [] }; }

function cloudHandler(cloud) {
  const deny = () => ({ error: { code: "permission-denied", message: "Missing or insufficient permissions." } });
  const okShape = (d) => d && typeof d === "object" && Object.keys(d).every((k) => ["u", "v", "json"].includes(k)) && typeof d.u === "number" && d.v === 1 && typeof d.json === "string" && d.json.length < 1_000_000;
  return async (op, p, data, meta) => {
    meta = meta || {};
    const own = (x) => meta.uid && x.startsWith("users/" + meta.uid + "/");
    if (op === "batch") {
      for (const [k, pp, d] of data) {
        if (!own(pp)) return deny();
        if (k === "set" && (!meta.verified || !okShape(d))) return deny();
      }
      for (const [k, pp, d] of data) { if (k === "set") { cloud.store.set(pp, JSON.parse(JSON.stringify(d))); cloud.writes++; } else cloud.store.delete(pp); }
      cloud.log.push(["batch", data.length]);
      return {};
    }
    if (op === "list") {
      if (!meta.uid || !(p + "/").startsWith("users/" + meta.uid + "/")) return deny();
      const docs = [];
      for (const [k, v] of cloud.store) if (k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")) docs.push({ id: k.slice(p.length + 1), data: v });
      return { docs };
    }
    if (!own(p)) return deny();
    if (op === "get") return { exists: cloud.store.has(p), data: cloud.store.get(p) };
    if (op === "set") { if (!meta.verified || !okShape(data)) return deny(); cloud.store.set(p, data); cloud.writes++; return {}; }
    if (op === "delete") { cloud.store.delete(p); return {}; }
    return { error: { code: "internal", message: "unknown op " + op } };
  };
}

/* ---------------- page setup ---------------- */
const SRI_STUB = `window.NXSRI={HASH:{},script:function(u){return new Promise(function(res,rej){var s=document.createElement('script');s.src=u;s.onload=res;s.onerror=function(){rej(new Error('load '+u))};document.head.appendChild(s)})},text:function(u){return fetch(u).then(function(r){return r.text()})}};`;
const CSP_LISTENER = `document.addEventListener('securitypolicyviolation',function(e){try{var a=JSON.parse(sessionStorage.getItem('csp')||'[]');a.push(e.violatedDirective+' '+e.blockedURI+' @'+(e.sourceFile||'')+':'+(e.lineNumber||''));sessionStorage.setItem('csp',JSON.stringify(a))}catch(_){}});`;

const DEFAULT_CONFIG = { firebase: {}, api: "", googleClientId: "", operatorName: "", contactEmail: "", sync: true };

/**
 * Configure a browser context.
 *   fake     use the fake Firebase SDK + a shared fake cloud (signed-in tests)
 *   user     seed a signed-in user ({uid,email,password,emailVerified,providerId,displayName})
 *   config   overrides merged into window.NEXUS_CONFIG
 *   realCdn  let cdnjs / gstatic through to the real network (pdf.js, mammoth, real Firebase SDK)
 */
async function setup(context, opts = {}) {
  const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
  if (opts.fake) config.firebase = { apiKey: "fake-key", projectId: "nexus-test", appId: "1:1:web:1", authDomain: "nexus-test.firebaseapp.com", ...(config.firebase || {}) };

  /* outside world: stubbed unless a test lets it through */
  await context.route(/^https?:\/\/(?!localhost:4173)/, (route) => {
    const u = new URL(route.request().url());
    if (opts.realCdn && /(^|\.)(cdnjs\.cloudflare\.com|gstatic\.com)$/.test(u.hostname) && u.hostname !== "fonts.gstatic.com") return route.continue();
    if (/fonts\.googleapis\.com$/.test(u.hostname)) return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    if (/fonts\.gstatic\.com$/.test(u.hostname)) return route.fulfill({ status: 200, contentType: "font/woff2", body: "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await context.route(BASE + "/firebase-config.js", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "window.NEXUS_CONFIG = " + JSON.stringify(config) + ";" }));

  if (opts.fake) {
    await context.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat\.js/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_FB }));
    await context.route(/gstatic\.com\/firebasejs\/.*(auth|firestore)-compat\.js/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "/* fake: provided by app-compat */" }));
    await context.route(BASE + "/sri.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: SRI_STUB }));
    const cloud = opts.cloud || newCloud();
    await context.exposeFunction("__fs", cloudHandler(cloud));
  }

  await context.addInitScript(CSP_LISTENER);
  if (opts.user) {
    await context.addInitScript((u) => {
      if (!localStorage.getItem("fake-seeded")) { localStorage.setItem("fake-fb-user", JSON.stringify(u)); localStorage.setItem("fake-seeded", "1"); }
    }, opts.user);
  }
}

const USER = { uid: "u1", email: "aarav@example.com", displayName: "Aarav", password: "correct-horse", emailVerified: true, providerId: "password" };

/* ---------------- common actions ---------------- */
async function openPortal(page, path = "/app.html") {
  await page.goto(path);
  await page.locator("#nav .nav-item").first().waitFor({ timeout: 15_000 });
}
async function enterLocalMode(page) {
  await page.goto("/auth.html");
  await page.locator("#localBtn").click();
  await page.locator("#nav .nav-item").first().waitFor({ timeout: 15_000 });
}
async function cspViolations(page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem("csp") || "[]"));
}
async function expectNoCsp(page) { expect(await cspViolations(page), "Content-Security-Policy violations").toEqual([]); }

/* collect uncaught page errors so a test can assert there were none */
function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  return errors;
}

module.exports = { setup, newCloud, USER, openPortal, enterLocalMode, cspViolations, expectNoCsp, trackErrors, BASE };
