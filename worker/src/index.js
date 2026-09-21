/* ============================================================
   Nexus OS — AI proxy (Cloudflare Worker).

   POST /ai   { action, data }   Authorization: Bearer <Firebase ID token>
   GET  /health

   Why it exists: a Groq key placed in the web app is readable by anyone.
   This Worker holds the key as a secret and:
     1. verifies the caller's Firebase ID token (RS256, Google's public keys)
     2. requires a VERIFIED email and refuses throwaway-mail domains -
        accounts are free, so per-user limits alone can be farmed
     3. rate-limits per user, per IP, and globally per day
     4. builds the prompt ITSELF from prompts.js - the client sends an action
        name and data, never a prompt, so the key can't be used as a free chatbot.

   Config (wrangler.toml [vars]): FIREBASE_PROJECT_ID, ALLOWED_ORIGINS,
     DAILY_LIMIT, MINUTE_LIMIT, IP_MINUTE_LIMIT, GLOBAL_DAILY_LIMIT,
     REQUIRE_VERIFIED_EMAIL, BLOCKED_EMAIL_DOMAINS, GROQ_MODEL (optional)
   Secret:  GROQ_API_KEY            (wrangler secret put GROQ_API_KEY)
   Optional KV binding RATE for daily counters that survive restarts.
   ============================================================ */
import "../../prompts.js";            // defines globalThis.NXPrompts (same file the browser uses)

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const GROQ = "https://api.groq.com/openai/v1";
const MAX_BODY = 90 * 1024;

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || ""; }
}

/* ---------- helpers ---------- */
const enc = new TextEncoder();
function b64urlBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

function corsFor(origin, env) {
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = list.length ? list.includes(origin) : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const h = { Vary: "Origin" };
  if (ok) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    h["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS";
    h["Access-Control-Max-Age"] = "86400";
  }
  return { ok, headers: h };
}
const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

/* ---------- Firebase ID token verification ---------- */
let jwks = { keys: [], exp: 0 };
async function loadKeys(force) {
  if (!force && jwks.keys.length && Date.now() < jwks.exp) return jwks.keys;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new HttpError(503, "Can't verify sign-in right now.");
  const j = await r.json();
  const m = (r.headers.get("cache-control") || "").match(/max-age=(\d+)/);
  jwks = { keys: j.keys || [], exp: Date.now() + (m ? +m[1] : 3600) * 1000 };
  return jwks.keys;
}

async function verifyIdToken(token, projectId) {
  const bad = () => new HttpError(401, "Please sign in again.");
  if (!projectId) throw new HttpError(500, "The AI service is not configured.");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw bad();
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch (e) { throw bad(); }
  if (header.alg !== "RS256" || !header.kid) throw bad();

  let key = (await loadKeys(false)).find((k) => k.kid === header.kid);
  if (!key) key = (await loadKeys(true)).find((k) => k.kid === header.kid);   // keys rotate
  if (!key) throw bad();

  let ok = false;
  try {
    const ck = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", ck, b64urlBytes(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  } catch (e) { ok = false; }
  if (!ok) throw bad();

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw bad();
  if (payload.iss !== "https://securetoken.google.com/" + projectId) throw bad();
  if (typeof payload.exp !== "number" || payload.exp <= now) throw bad();
  if (typeof payload.iat !== "number" || payload.iat > now + 300) throw bad();
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128) throw bad();
  return payload;
}

/* ---------- who may use the shared key ---------- */
/* Throwaway-mail providers. Not exhaustive - extend with BLOCKED_EMAIL_DOMAINS. */
const DISPOSABLE = ["mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "sharklasers.com", "10minutemail.com", "10minutemail.net",
  "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmailo.com", "yopmail.com", "yopmail.net", "trashmail.com", "trashmail.net", "throwawaymail.com",
  "getnada.com", "nada.email", "maildrop.cc", "dispostable.com", "fakeinbox.com", "mailnesia.com", "mintemail.com", "mohmal.com", "emailondeck.com",
  "burnermail.io", "spamgourmet.com", "moakt.com", "tempinbox.com", "mytemp.email", "inboxkitten.com", "harakirimail.com", "discard.email", "anonaddy.me"];
const truthy = (v, dflt) => (v === undefined || v === null || v === "" ? dflt : !/^(0|false|no|off)$/i.test(String(v)));

function isBlockedEmail(email, env) {
  const domain = String(email || "").toLowerCase().split("@")[1] || "";
  if (!domain) return true;
  const extra = String(env.BLOCKED_EMAIL_DOMAINS || "").toLowerCase().split(",").map((d) => d.trim()).filter(Boolean);
  return DISPOSABLE.concat(extra).some((d) => domain === d || domain.endsWith("." + d));
}

function requireAllowedUser(user, env) {
  if (truthy(env.REQUIRE_VERIFIED_EMAIL, true) && user.email_verified !== true) {
    throw new HttpError(403, "Verify your email address to use the AI features.", "email_not_verified");
  }
  if (isBlockedEmail(user.email, env)) {
    throw new HttpError(403, "Please sign in with a permanent email address.", "email_blocked");
  }
}

/* ---------- rate limiting ----------
   Per-minute burst control is in memory (per isolate, best effort).
   The daily quota lives in KV when bound (one write per request). */
const minMem = new Map(), ipMem = new Map(), dayMem = new Map();
const sweep = (map, suffix) => { for (const k of map.keys()) if (!k.endsWith(suffix)) map.delete(k); };

/* Checks first, consumes last: a refused request never burns anyone's quota. */
async function rateLimit(env, uid, ip) {
  const dayLimit = +env.DAILY_LIMIT || 40, minLimit = +env.MINUTE_LIMIT || 6;
  const ipLimit = +env.IP_MINUTE_LIMIT || 20, globalLimit = env.GLOBAL_DAILY_LIMIT === undefined || env.GLOBAL_DAILY_LIMIT === "" ? 2000 : +env.GLOBAL_DAILY_LIMIT;
  const min = Math.floor(Date.now() / 60000), day = new Date().toISOString().slice(0, 10);

  /* burst control: many accounts from one address is the farming signature */
  sweep(minMem, ":" + min); sweep(ipMem, ":" + min);
  const mk = uid + ":" + min, ik = ip + ":" + min;
  const m = (minMem.get(mk) || 0) + 1, i = (ipMem.get(ik) || 0) + 1;
  if (ip && i > ipLimit) throw new HttpError(429, "Too many requests from your network - try again in a minute.", "ip_limited");
  if (m > minLimit) throw new HttpError(429, "Slow down - a few requests per minute is the limit.", "rate_limited");

  /* daily quotas: per user, and one global cap that bounds the key's total spend */
  const dk = "d:" + uid + ":" + day, gk = "g:" + day;
  let used, total = 0;
  if (env.RATE) {
    used = +(await env.RATE.get(dk)) || 0;
    if (globalLimit > 0) total = +(await env.RATE.get(gk)) || 0;
  } else {
    sweep(dayMem, ":" + day);
    used = dayMem.get(dk) || 0;
    total = dayMem.get(gk + ":" + day) || 0;
  }
  if (used >= dayLimit) throw new HttpError(429, "You've reached today's AI limit (" + dayLimit + "). It resets tomorrow.", "daily_limit");
  if (globalLimit > 0 && total >= globalLimit) throw new HttpError(503, "The AI service is at capacity for today - please try again tomorrow.", "capacity");

  minMem.set(mk, m); if (ip) ipMem.set(ik, i);
  if (env.RATE) {
    await env.RATE.put(dk, String(used + 1), { expirationTtl: 172800 });
    if (globalLimit > 0) await env.RATE.put(gk, String(total + 1), { expirationTtl: 172800 });
  } else {
    dayMem.set(dk, used + 1);
    dayMem.set(gk + ":" + day, total + 1);
  }
  return dayLimit - (used + 1);
}

/* ---------- Groq ---------- */
const rankModel = (id) => {
  const s = String(id).toLowerCase();
  let n = 0;
  if (/120b|70b|maverick|kimi-k2/.test(s)) n += 100;
  else if (/32b|scout|17b/.test(s)) n += 60;
  else if (/20b|8b|instant/.test(s)) n += 30;
  if (/versatile|instruct/.test(s)) n += 10;
  if (/preview|deprecated|specdec/.test(s)) n -= 40;
  return n;
};
let modelCache = { id: "", exp: 0 };
async function pickModel(env, force) {
  if (env.GROQ_MODEL) return env.GROQ_MODEL;
  if (!force && modelCache.id && Date.now() < modelCache.exp) return modelCache.id;
  const r = await fetch(GROQ + "/models", { headers: { Authorization: "Bearer " + env.GROQ_API_KEY } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, "The AI provider is unavailable right now.");
  const ids = (j.data || []).map((m) => m.id).filter((id) => !/whisper|tts|guard|embedding|playai|moderation/i.test(id));
  if (!ids.length) throw new HttpError(502, "No AI model is available right now.");
  ids.sort((a, b) => rankModel(b) - rankModel(a) || a.localeCompare(b));
  modelCache = { id: ids[0], exp: Date.now() + 3600 * 1000 };
  return modelCache.id;
}

async function callGroq(env, spec, retried) {
  const model = await pickModel(env, false);
  const r = await fetch(GROQ + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.GROQ_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, messages: spec.messages, temperature: spec.temp, max_tokens: spec.max,
      ...(spec.json ? { response_format: { type: "json_object" } } : {})
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || "";
    if (!retried && !env.GROQ_MODEL && /does not exist|decommissioned|model_not_found|not found/i.test(msg)) {
      modelCache.exp = 0; await pickModel(env, true);
      return callGroq(env, spec, true);
    }
    if (r.status === 429) throw new HttpError(503, "The AI service is busy - try again in a minute.");
    throw new HttpError(502, "The AI provider returned an error.");            // never forward provider details
  }
  return { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "", model };
}

/* ---------- entry ---------- */
export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const cors = corsFor(origin, env);
    try {
      if (req.method === "OPTIONS") return new Response(null, { status: cors.ok ? 204 : 403, headers: cors.headers });
      const url = new URL(req.url);
      if (url.pathname === "/health") return json({ ok: true }, 200, cors.headers);
      if (url.pathname !== "/ai") throw new HttpError(404, "Not found");
      if (req.method !== "POST") throw new HttpError(405, "Use POST");
      if (origin && !cors.ok) throw new HttpError(403, "This site isn't allowed to use the AI service.");
      if (!env.GROQ_API_KEY) throw new HttpError(500, "The AI service is not configured.");

      const raw = await req.text();
      if (raw.length > MAX_BODY) throw new HttpError(413, "That request is too large.");
      let body;
      try { body = JSON.parse(raw); } catch (e) { throw new HttpError(400, "Bad request."); }

      const auth = /^Bearer\s+(.+)$/i.exec(req.headers.get("Authorization") || "");
      if (!auth) throw new HttpError(401, "Please sign in.");
      const user = await verifyIdToken(auth[1], env.FIREBASE_PROJECT_ID);
      requireAllowedUser(user, env);

      const action = body && body.action;
      if (typeof action !== "string" || !globalThis.NXPrompts.has(action)) throw new HttpError(400, "Unknown action.");
      let spec;
      try { spec = globalThis.NXPrompts.build(action, body.data); }
      catch (e) { throw new HttpError(400, e.message || "Bad request."); }

      const remaining = await rateLimit(env, user.sub, req.headers.get("CF-Connecting-IP") || "");
      const out = await callGroq(env, spec, false);
      return json({ text: out.text, remaining, model: out.model }, 200, cors.headers);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status, cors.headers);
      return json({ error: "Something went wrong." }, 500, cors.headers);        // no stack traces to clients
    }
  }
};
