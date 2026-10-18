/* nexus-leethub background worker: one commit per solve, token never handed out. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(fetchImpl, store) {
  let listener;
  const chrome = {
    storage: { local: {
      get: (keys, cb) => cb(Object.fromEntries(Object.keys(store).filter((k) => keys.includes(k)).map((k) => [k, store[k]]))),
      set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
    } },
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
  };
  const ctx = vm.createContext({ globalThis: null, chrome, fetch: fetchImpl, TextEncoder, TextDecoder, atob, btoa, console, Date, JSON });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "nexus-leethub", "background.js"), "utf8"), ctx);
  return (msg) => new Promise((res) => listener(msg, {}, res));
}

/* a tiny fake GitHub: records every request, answers the Git Data API */
function fakeGitHub(opts = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const p = new URL(url).pathname, method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, p, body });
    const ok = (j, status = 200) => ({ ok: status < 300, status, json: async () => j });
    if (p === "/user") return ok({ login: "me" });
    if (p === "/repos/me/sols") return ok({ full_name: "me/sols", default_branch: "main", html_url: "x" });
    if (p === "/repos/me/sols/contents/solutions/index.json") return ok({ message: "Not Found" }, 404);
    if (p === "/repos/me/sols/git/ref/heads/main") return ok({ object: { sha: "c0" } });
    if (p === "/repos/me/sols/git/commits/c0") return ok({ tree: { sha: "t0" } });
    if (p === "/repos/me/sols/git/trees") return ok({ sha: opts.sameTree ? "t0" : "t1" });
    if (p === "/repos/me/sols/git/commits" && method === "POST") return ok({ sha: "c1", html_url: "https://github.com/me/sols/commit/c1" }, 201);
    if (p === "/repos/me/sols/git/refs/heads/main" && method === "PATCH") return ok({});
    return ok({ message: "unexpected " + method + " " + p }, 500);
  };
  return { calls, fetchImpl };
}

const SOLVE = { slug: "two-sum", title: "Two Sum", qid: 1, difficulty: "Easy", lang: "python3", topics: ["array"], code: "print(1)", url: "https://leetcode.com/problems/two-sum/", solvedAt: "2026-01-02T00:00:00Z" };
const store = () => ({ ghToken: "ghp_secret", ghRepo: "sols", autoPush: true });

test("a solve lands as ONE commit holding solution, index.json and README", async () => {
  const gh = fakeGitHub();
  const send = load(gh.fetchImpl, store());
  const r = await send({ type: "SOLVE_ACCEPTED", solve: SOLVE });
  assert.deepStrictEqual([r.ok, r.action, r.commit], [true, "pushed", "https://github.com/me/sols/commit/c1"]);
  assert.strictEqual(gh.calls.filter((c) => c.method === "POST" && c.p.endsWith("/git/commits")).length, 1);
  assert.strictEqual(gh.calls.filter((c) => c.method === "PUT").length, 0, "no per-file contents commits");
  const tree = gh.calls.find((c) => c.p.endsWith("/git/trees")).body;
  assert.deepStrictEqual(tree.tree.map((t) => t.path), ["solutions/array/0001-two-sum.py", "solutions/index.json", "README.md"]);
  assert.strictEqual(tree.base_tree, "t0");
});

test("an unchanged tree makes no empty commit", async () => {
  const gh = fakeGitHub({ sameTree: true });
  const r = await load(gh.fetchImpl, store())({ type: "SOLVE_ACCEPTED", solve: SOLVE });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(gh.calls.filter((c) => c.p.endsWith("/git/commits") && c.method === "POST").length, 0);
});

test("GET_STATE reports hasToken but never the token itself", async () => {
  const s = await load(async () => ({}), store())({ type: "GET_STATE" });
  assert.strictEqual(s.hasToken, true);
  assert.strictEqual(s.ghToken, undefined);
  assert.ok(!JSON.stringify(s).includes("ghp_secret"));
});
