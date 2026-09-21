/* node --test tests/sync.test.js - the sync engine against an in-memory backend, two "devices" at a time */
const test = require("node:test");
const assert = require("node:assert");
globalThis.window = globalThis;
require("../sync-engine.js");
const { Engine, newMeta, slicesOf, canon } = globalThis.NXSyncEngine;

const clone = (o) => JSON.parse(JSON.stringify(o));

/* one shared clock so "later" is well defined across devices */
let clock = 1000;
const tick = (n = 10) => (clock += n);
const now = () => clock;

function fakeBackend() {
  const db = { docs: {}, apps: {}, solves: {} };
  const b = {
    db, ops: [], failNext: false, loads: 0, peeks: 0,
    async load() { b.loads++; return clone(db); },
    async peek(refs) { b.peeks++; return refs.map((r) => { const rec = r.kind === "doc" ? db.docs[r.name] : db[r.col][r.id]; return rec ? rec.u : null; }); },
    async commit(ops) {
      if (b.failNext) { b.failNext = false; throw new Error("network down"); }
      ops.forEach((op) => {
        b.ops.push(clone(op));
        if (op.kind === "doc") db.docs[op.name] = clone(op.set);
        else if (op.del) delete db[op.col][op.id];
        else db[op.col][op.id] = clone(op.set);
      });
    },
    async wipe() { db.docs = {}; db.apps = {}; db.solves = {}; },
  };
  return b;
}

const baseState = () => ({
  settings: { leetcode: "", github: "", lcGoal: 400, theme: "system", ghToken: "", ghRepo: "leetcode-solutions", groqKey: "", groqModel: "" },
  lc: null, gh: null, practice: { log: [] }, solves: [], pmeta: {}, ai: { history: [] },
  jobfeed: { boards: [], aggregators: {}, filters: { include: ["python"], minScore: 2 }, cache: [], seen: {}, dismissed: {}, tracked: {}, lastFetch: 0, errors: [] },
  tasks: {}, taskDefs: [], schedule: [], projects: [], skills: { fullstack: [], aiml: [] }, jobs: [],
  profile: null,
});
function device(backend, S = baseState(), metaOverride) {
  const meta = metaOverride || newMeta();
  const backups = [];
  const e = new Engine({ backend, getS: () => S, meta, now, backup: (s) => backups.push(clone(s)) });
  return { S, e, meta, backups };
}
const app = (id, co, extra = {}) => ({ id, co, role: "SWE", dt: "2026-09-01", pipeline: "applied", status: "applied", stage: "Applied", events: [{ d: "2026-09-01", t: "applied", src: "manual" }], ...extra });
const solve = (id, extra = {}) => ({ id, slug: "s-" + id, title: "Solve " + id, difficulty: "Easy", topics: ["arrays"], lang: "python", date: "2026-09-01", code: "print(1)", ...extra });

/* ================= privacy: what may leave the device ================= */
test("secrets and bulky regenerable data are never uploaded", async () => {
  const be = fakeBackend(), a = device(be);
  a.S.settings.ghToken = "github_pat_SECRET"; a.S.settings.groqKey = "gsk_SECRET";
  a.S.jobfeed.cache = [{ id: "j1", title: "big cached job" }];
  a.S.gh = { profile: { login: "x" }, events: [{ payload: { huge: true } }] };
  a.S.pendingApply = [{ id: "p1" }];
  a.S.profile = { name: "Aarav", skills: [], resumeText: "MY RESUME TEXT", draft: null };
  tick(); await a.e.sync();
  const everything = JSON.stringify(be.db);
  for (const bad of ["github_pat_SECRET", "gsk_SECRET", "big cached job", "pendingApply", "huge"]) {
    assert.ok(!everything.includes(bad), "leaked: " + bad);
  }
  assert.ok(everything.includes("MY RESUME TEXT"), "the resume travels only in its own document");
  assert.ok(be.db.docs.resume, "resume has its own doc");
  assert.ok(!be.db.docs.core.json.includes("MY RESUME TEXT"), "and never inside core");
});

test("pulling remote settings keeps this device's own secrets", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  a.S.settings.theme = "dark"; a.S.settings.ghToken = "A-token";
  tick(); await a.e.sync();
  b.S.settings.ghToken = "B-token"; b.S.settings.groqKey = "B-groq";
  tick(); await b.e.sync();
  assert.strictEqual(b.S.settings.theme, "dark", "ordinary settings sync");
  assert.strictEqual(b.S.settings.ghToken, "B-token");
  assert.strictEqual(b.S.settings.groqKey, "B-groq");
});

/* ================= the basics ================= */
test("a new device pulls everything the first device pushed", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  a.S.jobs = [app("a1", "Stripe"), app("a2", "Notion")];
  a.S.solves = [solve("s1"), solve("s2")];
  a.S.profile = { name: "Aarav", skills: [{ n: "python", w: 3 }], resumeText: "" };
  a.S.jobfeed.filters.include = ["python", "pytorch"];
  tick(); const r = await a.e.sync();
  assert.ok(r.pushed.wrote >= 6);
  tick(); const p = await b.e.sync();
  assert.strictEqual(b.S.jobs.length, 2);
  assert.strictEqual(b.S.solves.length, 2);
  assert.strictEqual(b.S.profile.name, "Aarav");
  assert.deepStrictEqual(b.S.jobfeed.filters.include, ["python", "pytorch"]);
  assert.strictEqual(p.pushed.wrote, 0, "nothing to push back");
});

test("syncing with no changes writes nothing (and a second pull applies nothing)", async () => {
  const be = fakeBackend(), a = device(be);
  a.S.jobs = [app("a1", "Stripe")];
  tick(); await a.e.sync();
  const writes = be.ops.length;
  tick(); const r = await a.e.sync();
  assert.strictEqual(be.ops.length, writes);
  assert.strictEqual(r.pulled.docs.length + r.pulled.apps + r.pulled.solves, 0);
});

test("key order does not cause phantom edits", async () => {
  const be = fakeBackend(), a = device(be);
  a.S.jobs = [{ id: "k1", co: "A", role: "B", dt: "2026-09-01", pipeline: "applied", events: [] }];
  tick(); await a.e.sync();
  const writes = be.ops.length;
  a.S.jobs = [{ events: [], pipeline: "applied", dt: "2026-09-01", role: "B", co: "A", id: "k1" }];   // same data, different key order
  tick(); await a.e.push();
  assert.strictEqual(be.ops.length, writes);
  assert.strictEqual(canon({ b: 1, a: [2, { d: 1, c: 2 }] }), canon({ a: [2, { c: 2, d: 1 }], b: 1 }));
});

test("an edit on one device shows up on the other", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  a.S.jobs = [app("a1", "Stripe")];
  tick(); await a.e.sync(); tick(); await b.e.sync();
  a.S.jobs[0].pipeline = "interview"; a.S.jobs[0].events.push({ d: "2026-09-10", t: "interview", src: "gmail" });
  tick(); await a.e.push(); tick(); await b.e.sync();
  assert.strictEqual(b.S.jobs[0].pipeline, "interview");
  assert.strictEqual(b.S.jobs[0].events.length, 2);
});

/* ================= deletes ================= */
test("a delete on one device removes the item on the other", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  a.S.jobs = [app("a1", "Stripe"), app("a2", "Notion")];
  tick(); await a.e.sync(); tick(); await b.e.sync();
  a.S.jobs = a.S.jobs.filter((j) => j.id !== "a1");
  tick(); await a.e.push();
  assert.ok(!be.db.apps.a1, "deleted remotely");
  tick(); const r = await b.e.sync();
  assert.deepStrictEqual(b.S.jobs.map((j) => j.id), ["a2"]);
  assert.strictEqual(r.pulled.removed, 1);
});

test("a deleted item does not come back on the next sync", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  a.S.solves = [solve("s1")];
  tick(); await a.e.sync(); tick(); await b.e.sync();
  b.S.solves = [];
  tick(); await b.e.sync();
  tick(); await a.e.sync(); tick(); await b.e.sync(); tick(); await a.e.sync();
  assert.strictEqual(a.S.solves.length, 0);
  assert.strictEqual(b.S.solves.length, 0);
  assert.deepStrictEqual(Object.keys(be.db.solves), []);
});

test("an edit made elsewhere AFTER a delete wins - nothing is silently lost", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  a.S.jobs = [app("x1", "Stripe", { notes: "original" })];
  tick(); await a.e.sync(); tick(); await b.e.sync();
  a.S.jobs = [];                                           // A deletes (offline)
  tick(); b.S.jobs[0].notes = "B added recruiter details"; // B edits later, and syncs first
  tick(); await b.e.sync();
  tick(); await a.e.sync();                                // A comes online: its delete must not destroy B's edit
  assert.strictEqual(a.S.jobs.length, 1);
  assert.strictEqual(a.S.jobs[0].notes, "B added recruiter details");
  assert.ok(be.db.apps.x1, "still stored remotely");
});

test("deleting locally something edited remotely keeps it; deleting remotely something edited locally recreates it", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  a.S.jobs = [app("y1", "Notion")];
  tick(); await a.e.sync(); tick(); await b.e.sync();
  b.S.jobs = [];                                           // B deletes and syncs
  tick(); await b.e.sync();
  a.S.jobs[0].notes = "edited on A after B deleted";       // A edits before learning of the delete
  tick(); await a.e.sync();
  assert.strictEqual(a.S.jobs.length, 1, "A keeps its edited copy");
  assert.ok(be.db.apps.y1, "and it is recreated remotely");
  tick(); await b.e.sync();
  assert.strictEqual(b.S.jobs[0].notes, "edited on A after B deleted");
});

/* ================= conflicts ================= */
test("both devices edit the same item offline: the later edit wins, the loser is backed up", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  a.S.jobs = [app("c1", "Stripe")];
  tick(); await a.e.sync(); tick(); await b.e.sync();
  tick(); a.S.jobs[0].notes = "A's earlier edit"; await a.e.push();      // hits scan at this time
  // B edits LATER but hasn't synced yet
  tick(50); b.S.jobs[0].notes = "B's later edit";
  tick(); await b.e.sync();
  tick(); await a.e.sync();
  assert.strictEqual(a.S.jobs[0].notes, "B's later edit");
  assert.strictEqual(b.S.jobs[0].notes, "B's later edit");
});

test("the earlier of two conflicting offline edits loses, and a backup of the loser exists", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  a.S.jobs = [app("c2", "Stripe")];
  tick(); await a.e.sync(); tick(); await b.e.sync();
  tick(); a.S.jobs[0].notes = "A edit (later)";
  await a.e.push();                                          // A's edit is recorded and uploaded first
  tick(-5);                                                  // B's edit happened EARLIER in real time...
  b.S.jobs[0].notes = "B edit (earlier)";
  await b.e.pull();                                          // ...but is only noticed now
  assert.strictEqual(b.S.jobs[0].notes, "A edit (later)", "the later edit is kept");
  assert.ok(b.backups.length >= 1, "the discarded local copy was backed up first");
  assert.ok(JSON.stringify(b.backups[0]).includes("B edit (earlier)"));
});

test("independent edits to different items merge without conflict", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  a.S.jobs = [app("m1", "Stripe"), app("m2", "Notion")];
  tick(); await a.e.sync(); tick(); await b.e.sync();
  a.S.jobs.find((j) => j.id === "m1").notes = "from A";
  b.S.jobs.find((j) => j.id === "m2").notes = "from B";
  tick(); await a.e.sync(); tick(); await b.e.sync(); tick(); await a.e.sync();
  for (const d of [a, b]) {
    assert.strictEqual(d.S.jobs.find((j) => j.id === "m1").notes, "from A");
    assert.strictEqual(d.S.jobs.find((j) => j.id === "m2").notes, "from B");
  }
});

test("new items created on both devices are unioned", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  tick(); await a.e.sync(); tick(); await b.e.sync();
  a.S.solves = [solve("n1")]; b.S.solves = [solve("n2")];
  tick(); await a.e.sync(); tick(); await b.e.sync(); tick(); await a.e.sync();
  assert.deepStrictEqual(a.S.solves.map((s) => s.id).sort(), ["n1", "n2"]);
  assert.deepStrictEqual(b.S.solves.map((s) => s.id).sort(), ["n1", "n2"]);
});

test("pushing over a document someone else changed merges first instead of clobbering", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  a.S.settings.lcGoal = 400;
  tick(); await a.e.sync(); tick(); await b.e.sync();
  b.S.settings.lcGoal = 500;                                 // B changes the goal and uploads
  tick(); await b.e.push();
  a.S.tasks = { "2026-09-21": { wake: true } };              // A changes something else in core, unaware
  tick();
  const before = be.peeks;
  await a.e.push();                                          // stale-detect -> pull -> LWW -> push
  assert.ok(be.peeks > before, "peeked before writing");
  const remote = JSON.parse(be.db.docs.core.json);
  assert.ok(remote.tasks["2026-09-21"], "A's newer edit is stored");
});

/* ================= first sync on a device that already has data ================= */
test("first sync: remote core wins, local-only items are kept and uploaded, local work is backed up", async () => {
  const be = fakeBackend(), a = device(be), b = device(be);
  a.S.settings.lcGoal = 999; a.S.jobs = [app("r1", "Stripe")];
  tick(); await a.e.sync();
  b.S.settings.lcGoal = 123;                                 // B has its own data from before it ever synced
  b.S.jobs = [app("r2", "Notion")];
  tick(); const r = await b.e.sync();
  assert.strictEqual(b.S.settings.lcGoal, 999, "remote core wins on a device's first sync");
  assert.deepStrictEqual(b.S.jobs.map((j) => j.id).sort(), ["r1", "r2"], "but B's own application is kept");
  assert.ok(be.db.apps.r2, "and uploaded");
  assert.ok(r.pulled.backedUp && b.backups.length === 1, "B's overwritten local state was backed up");
  assert.strictEqual(b.backups[0].settings.lcGoal, 123);
});

/* ================= failure handling ================= */
test("a failed upload changes nothing, and the next attempt succeeds", async () => {
  const be = fakeBackend(), a = device(be);
  a.S.jobs = [app("f1", "Stripe")];
  be.failNext = true;
  tick(); await assert.rejects(a.e.sync(), /network down/);
  assert.deepStrictEqual(Object.keys(be.db.apps), []);
  assert.strictEqual(a.meta.hash.apps.f1, undefined, "nothing recorded as synced");
  tick(); await a.e.sync();
  assert.ok(be.db.apps.f1, "uploaded on retry");
});

test("engine survives a restart: meta persisted and restored means no re-upload", async () => {
  const be = fakeBackend(), a = device(be);
  a.S.jobs = [app("p1", "Stripe")];
  tick(); await a.e.sync();
  const saved = clone(a.meta), S = clone(a.S), writes = be.ops.length;
  const again = device(be, S, saved);                        // "reload the page"
  tick(); await again.e.sync();
  assert.strictEqual(be.ops.length, writes);
});

test("corrupt remote records are skipped, not fatal", async () => {
  const be = fakeBackend(), a = device(be);
  be.db.apps.bad = { u: 5, v: 1, json: "{not json" };
  be.db.solves.worse = { u: 5, v: 1 };
  be.db.docs.core = { u: 5, v: 1, json: "nope" };
  a.S.jobs = [app("g1", "Stripe")];
  tick(); await a.e.sync();
  assert.deepStrictEqual(a.S.jobs.map((j) => j.id), ["g1"]);
});

/* ================= size + account deletion ================= */
test("an oversized core document is trimmed for upload but stays whole locally", async () => {
  const be = fakeBackend(), a = device(be);
  a.S.ai = { history: Array.from({ length: 30 }, (_, i) => ({ kind: "brief", date: "d" + i, text: "x".repeat(40000) })) };
  tick(); await a.e.sync();
  assert.ok(be.db.docs.core.json.length <= globalThis.NXSyncEngine.MAX_DOC);
  assert.strictEqual(a.S.ai.history.length, 30, "local copy is untouched");
});

test("wipe removes every remote document and resets sync state", async () => {
  const be = fakeBackend(), a = device(be);
  a.S.jobs = [app("w1", "Stripe")]; a.S.solves = [solve("w2")];
  tick(); await a.e.sync();
  assert.ok(Object.keys(be.db.docs).length && Object.keys(be.db.apps).length);
  await a.e.wipe();
  assert.deepStrictEqual([Object.keys(be.db.docs), Object.keys(be.db.apps), Object.keys(be.db.solves)], [[], [], []]);
  assert.deepStrictEqual(Object.keys(a.meta.known.apps), []);
});

test("slicesOf never includes items without an id and tolerates missing state", () => {
  const sl = slicesOf({ settings: {}, jobs: [{ co: "no id" }, null, app("ok", "A")], solves: undefined });
  assert.deepStrictEqual(Object.keys(sl.items.apps), ["ok"]);
  assert.deepStrictEqual(sl.items.solves, {});
  assert.doesNotThrow(() => slicesOf({}));
});
