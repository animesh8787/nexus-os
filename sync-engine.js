/* ============================================================
   Nexus OS — cross-device sync engine (pure logic, no browser / Firebase).

   The portal's state is split into documents and item collections:
     docs   core (settings, practice, tasks, schedule, projects, skills, profile...)
            feed (job-feed rules + seen/dismissed/tracked)  gmail  resume
     items  apps   (the tracker)   solves   (the solution log)
   Each is stored remotely as { u: lastEditMs, v: 1, json: <canonical JSON> }.

   NEVER leaves the device:  settings.ghToken, settings.groqKey  (secrets)
                             jobfeed.cache / errors / lastFetch  (bulky, re-fetchable)
                             gh (GitHub API payload, re-fetchable)
                             pendingApply  (ephemeral)

   Merge model: a three-way comparison per document/item between
     local (now), base (what we last synced) and remote.
   - only local changed  -> keep local, push it
   - only remote changed -> take remote
   - both changed        -> last writer wins (by edit time), and the losing local
                            copy is backed up first
   - an item known to have been synced but missing on one side was DELETED there.
     A concurrent edit beats a delete (nothing is silently lost).

   The backend is an interface, so this file is tested with an in-memory fake:
     load() -> { docs:{name:rec}, apps:{id:rec}, solves:{id:rec} }
     peek(refs) -> [u | null, ...]      commit(ops)      wipe()
   ============================================================ */
(function (root) {
  "use strict";

  var SECRET_SETTINGS = ["ghToken", "groqKey"];
  var MAX_DOC = 900000;                 // Firestore's limit is 1 MiB; leave headroom
  var CAP = 4000;                       // seen / dismissed / tracked entries kept in sync
  var COLS = ["apps", "solves"];
  var ARRAY_OF = { apps: "jobs", solves: "solves" };

  var clone = function (o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); };

  /* deterministic JSON: same data -> same string regardless of key order */
  function canon(v) {
    if (v === null || typeof v !== "object") { var j = JSON.stringify(v); return j === undefined ? "null" : j; }
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    var keys = Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort();
    return "{" + keys.map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }
  function hash(str) {
    var h = 5381, i = str.length;
    while (i) h = (h * 33) ^ str.charCodeAt(--i);
    return (h >>> 0).toString(36) + "." + str.length;
  }

  function capKeys(o, n) {
    var k = Object.keys(o || {});
    if (k.length <= n) return o || {};
    var out = {};
    k.slice(-n).forEach(function (x) { out[x] = o[x]; });
    return out;
  }
  function byId(arr) {
    var m = {};
    (Array.isArray(arr) ? arr : []).forEach(function (x) { if (x && x.id) m[x.id] = x; });
    return m;
  }

  /* ---------- what to sync ---------- */
  function slicesOf(S) {
    var settings = clone(S.settings) || {};
    SECRET_SETTINGS.forEach(function (k) { delete settings[k]; });

    var profile = clone(S.profile) || null, resume = null;
    if (profile) {
      if (profile.resumeText) resume = { text: profile.resumeText };
      profile.resumeText = "";
    }
    var jf = clone(S.jobfeed) || {};
    delete jf.cache; delete jf.errors; delete jf.lastFetch;
    jf.seen = capKeys(jf.seen, CAP); jf.dismissed = capKeys(jf.dismissed, CAP); jf.tracked = capKeys(jf.tracked, CAP);

    var docs = {
      core: {
        settings: settings, lc: clone(S.lc) || null, practice: clone(S.practice), pmeta: clone(S.pmeta), ai: clone(S.ai),
        tasks: clone(S.tasks), taskDefs: clone(S.taskDefs), schedule: clone(S.schedule), projects: clone(S.projects),
        skills: clone(S.skills), profile: profile
      },
      feed: jf
    };
    if (S.gmail) docs.gmail = clone(S.gmail);
    if (resume) docs.resume = resume;
    return { docs: docs, items: { apps: byId(S.jobs), solves: byId(S.solves) } };
  }

  /* the core document is the only one that can grow large; trim what can be regenerated */
  function fit(name, obj) {
    var json = canon(obj);
    if (json.length <= MAX_DOC || name !== "core") return json;
    var c = clone(obj);
    if (c.ai && Array.isArray(c.ai.history)) c.ai.history = c.ai.history.slice(0, 8);
    json = canon(c);
    if (json.length > MAX_DOC) { c.pmeta = {}; json = canon(c); }
    return json;
  }

  function measure(S) {
    var sl = slicesOf(S), out = { docs: {}, items: { apps: {}, solves: {} } };
    Object.keys(sl.docs).forEach(function (n) { var j = fit(n, sl.docs[n]); out.docs[n] = { json: j, h: hash(j) }; });
    COLS.forEach(function (c) {
      Object.keys(sl.items[c]).forEach(function (id) { var j = canon(sl.items[c][id]); out.items[c][id] = { json: j, h: hash(j) }; });
    });
    return out;
  }

  /* ---------- applying remote data ---------- */
  function applyDoc(S, name, d) {
    if (!d || typeof d !== "object") return;
    if (name === "core") {
      var keep = {};
      SECRET_SETTINGS.forEach(function (k) { keep[k] = (S.settings || {})[k]; });
      if (d.settings) S.settings = Object.assign({}, S.settings, d.settings, keep);
      ["lc", "practice", "pmeta", "ai", "tasks", "taskDefs", "schedule", "projects", "skills"].forEach(function (k) { if (d[k] !== undefined) S[k] = d[k]; });
      if (d.profile) S.profile = Object.assign({}, d.profile, { resumeText: (S.profile && S.profile.resumeText) || "" });
    } else if (name === "feed") {
      var cur = S.jobfeed || {};
      S.jobfeed = Object.assign({}, d, { cache: cur.cache || [], errors: cur.errors || [], lastFetch: cur.lastFetch || 0 });
    } else if (name === "gmail") {
      S.gmail = d;
    } else if (name === "resume") {
      if (!S.profile) S.profile = {};
      S.profile.resumeText = String(d.text || "");
    }
  }
  function setItem(S, col, id, obj) {
    var k = ARRAY_OF[col], arr = (S[k] || []).filter(function (x) { return x.id !== id; });
    arr.push(obj);
    S[k] = arr;
  }
  function removeItem(S, col, id) {
    var k = ARRAY_OF[col];
    S[k] = (S[k] || []).filter(function (x) { return x.id !== id; });
  }
  function reorder(S) {
    (S.jobs || []).sort(function (a, b) { return a.dt < b.dt ? 1 : a.dt > b.dt ? -1 : a.id < b.id ? 1 : -1; });
    (S.solves || []).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1; });
  }

  function newMeta() {
    return {
      hash: { docs: {}, apps: {}, solves: {} },    // hash of each thing as of the last successful sync
      ru: { docs: {}, apps: {}, solves: {} },      // the remote "u" we last saw or wrote
      lu: { docs: {}, apps: {}, solves: {} },      // local edit time of unsynced changes: { t, h }
      known: { apps: {}, solves: {} },             // item ids that have existed remotely
      lastSync: 0
    };
  }

  /* ---------- the engine ---------- */
  function Engine(o) {
    this.backend = o.backend;
    this.getS = o.getS;
    this.meta = o.meta || newMeta();
    this.persist = o.persist || function () {};
    this.backup = o.backup || function () {};
    this.now = o.now || Date.now;
  }

  /* remember WHEN each locally-changed thing was last changed (for last-writer-wins) */
  Engine.prototype._track = function (ms, t) {
    var m = this.meta;
    function mark(bucket, key, h) {
      if (h === m.hash[bucket][key]) { delete m.lu[bucket][key]; return; }
      var lu = m.lu[bucket][key];
      if (!lu || lu.h !== h) m.lu[bucket][key] = { t: t, h: h };
    }
    Object.keys(ms.docs).forEach(function (n) { mark("docs", n, ms.docs[n].h); });
    COLS.forEach(function (c) { Object.keys(ms.items[c]).forEach(function (id) { mark(c, id, ms.items[c][id].h); }); });
  };

  Engine.prototype.pull = async function () {
    var m = this.meta, self = this, S = this.getS();
    var remote = await this.backend.load();
    var ms = measure(S), res = { docs: [], apps: 0, solves: 0, removed: 0, restored: 0, backedUp: false };
    this._track(ms, this.now());

    function backup() { if (!res.backedUp) { res.backedUp = true; self.backup(S); } }
    function parse(rec) { try { return JSON.parse(rec.json); } catch (e) { return null; } }

    /* --- documents --- */
    Object.keys(remote.docs || {}).forEach(function (name) {
      var r = remote.docs[name];
      if (!r || typeof r.json !== "string") return;
      var rh = hash(r.json), loc = ms.docs[name], base = m.hash.docs[name];
      if (loc && loc.h === rh) { m.hash.docs[name] = rh; m.ru.docs[name] = r.u; delete m.lu.docs[name]; return; }
      var localChanged = loc ? loc.h !== base : false;
      var remoteChanged = r.u !== m.ru.docs[name];
      var luT = (m.lu.docs[name] || {}).t || 0;
      var take = base === undefined || (!localChanged && remoteChanged) || (localChanged && remoteChanged && r.u > luT);
      if (!take) return;                                    // local wins; push will upload it
      var data = parse(r);
      if (!data) return;
      if (loc && localChanged) backup();                    // about to overwrite unsynced local work
      applyDoc(S, name, data);
      var after = measure(S).docs[name];
      m.hash.docs[name] = after ? after.h : rh; m.ru.docs[name] = r.u; delete m.lu.docs[name];
      res.docs.push(name);
    });

    /* --- item collections --- */
    COLS.forEach(function (col) {
      var L = ms.items[col], R = remote[col] || {}, known = m.known[col], seen = {};
      Object.keys(L).concat(Object.keys(R)).forEach(function (id) {
        if (seen[id]) return; seen[id] = 1;
        var l = L[id], r = R[id];
        if (r && typeof r.json !== "string") r = null;

        if (l && r) {
          var rh = hash(r.json);
          if (l.h === rh) { m.hash[col][id] = rh; m.ru[col][id] = r.u; known[id] = 1; delete m.lu[col][id]; return; }
          var base = m.hash[col][id], localChanged = l.h !== base, remoteChanged = r.u !== m.ru[col][id], luT = (m.lu[col][id] || {}).t || 0;
          var take = base === undefined || (!localChanged && remoteChanged) || (localChanged && remoteChanged && r.u > luT);
          if (take) {
            var obj = parse(r);
            if (!obj) return;
            if (localChanged && base !== undefined) backup();
            setItem(S, col, id, obj);
            m.hash[col][id] = rh; m.ru[col][id] = r.u; known[id] = 1; delete m.lu[col][id];
            res[col]++;
          } else known[id] = 1;
          return;
        }
        if (r && !l) {                                       // remote only
          if (known[id] && r.u <= (m.ru[col][id] || 0)) return;   // we deleted it here; push will delete it there
          var o = parse(r);
          if (!o) return;
          setItem(S, col, id, o);
          if (known[id]) res.restored++;                     // it was edited elsewhere after we deleted it: keep it
          m.hash[col][id] = hash(r.json); m.ru[col][id] = r.u; known[id] = 1; delete m.lu[col][id];
          res[col]++;
          return;
        }
        if (l && !r && known[id]) {                          // local only, but it used to exist remotely
          if (l.h === m.hash[col][id]) {                     // untouched here -> it was deleted elsewhere
            removeItem(S, col, id);
            delete known[id]; delete m.hash[col][id]; delete m.ru[col][id]; delete m.lu[col][id];
            res.removed++;
          } else { delete known[id]; delete m.ru[col][id]; }  // edited here after the delete: recreate it on push
        }
        /* local only and never synced: a new item; push uploads it */
      });
    });

    reorder(S);
    m.lastSync = this.now();
    this.persist(m);
    return res;
  };

  Engine.prototype.push = async function (opts) {
    opts = opts || {};
    var m = this.meta, S = this.getS(), ms = measure(S), now = this.now();
    this._track(ms, now);

    var ops = [];
    Object.keys(ms.docs).forEach(function (n) {
      var d = ms.docs[n];
      if (d.h !== m.hash.docs[n]) ops.push({ kind: "doc", name: n, set: { u: (m.lu.docs[n] || {}).t || now, v: 1, json: d.json }, _h: d.h });
    });
    COLS.forEach(function (c) {
      Object.keys(ms.items[c]).forEach(function (id) {
        var it = ms.items[c][id];
        if (it.h !== m.hash[c][id]) ops.push({ kind: "item", col: c, id: id, set: { u: (m.lu[c][id] || {}).t || now, v: 1, json: it.json }, _h: it.h });
      });
      Object.keys(m.known[c]).forEach(function (id) {
        if (!ms.items[c][id]) ops.push({ kind: "item", col: c, id: id, del: true });
      });
    });
    if (!ops.length) { m.lastSync = now; this.persist(m); return { wrote: 0, deleted: 0 }; }

    /* has anyone else written to something we're about to write? then merge first (once) */
    if (!opts.force) {
      var probe = ops.filter(function (op) { return (op.kind === "doc" ? m.ru.docs[op.name] : m.ru[op.col][op.id]) !== undefined; });
      if (probe.length) {
        var seen = await this.backend.peek(probe.map(function (op) { return op.kind === "doc" ? { kind: "doc", name: op.name } : { kind: "item", col: op.col, id: op.id }; }));
        var stale = probe.some(function (op, i) {
          var expect = op.kind === "doc" ? m.ru.docs[op.name] : m.ru[op.col][op.id];
          return seen[i] !== expect;
        });
        if (stale) { await this.pull(); return this.push({ force: true }); }
      }
    }

    await this.backend.commit(ops.map(function (op) { var c = { kind: op.kind, name: op.name, col: op.col, id: op.id }; if (op.set) c.set = op.set; if (op.del) c.del = true; return c; }));

    var wrote = 0, deleted = 0;
    ops.forEach(function (op) {
      if (op.kind === "doc") { m.hash.docs[op.name] = op._h; m.ru.docs[op.name] = op.set.u; delete m.lu.docs[op.name]; wrote++; }
      else if (op.del) { delete m.known[op.col][op.id]; delete m.hash[op.col][op.id]; delete m.ru[op.col][op.id]; delete m.lu[op.col][op.id]; deleted++; }
      else { m.known[op.col][op.id] = 1; m.hash[op.col][op.id] = op._h; m.ru[op.col][op.id] = op.set.u; delete m.lu[op.col][op.id]; wrote++; }
    });
    m.lastSync = now;
    this.persist(m);
    return { wrote: wrote, deleted: deleted };
  };

  Engine.prototype.sync = async function () {
    var pulled = await this.pull();
    var pushed = await this.push();
    return { pulled: pulled, pushed: pushed };
  };

  /* delete the account's cloud copy (used by "delete my account") */
  Engine.prototype.wipe = async function () {
    await this.backend.wipe();
    var fresh = newMeta();
    Object.keys(this.meta).forEach(function (k) { delete this.meta[k]; }, this);   // reset in place: holders of the reference stay valid
    Object.assign(this.meta, fresh);
    this.persist(this.meta);
  };

  root.NXSyncEngine = {
    Engine: Engine, newMeta: newMeta, slicesOf: slicesOf, canon: canon, hash: hash,
    SECRET_SETTINGS: SECRET_SETTINGS, MAX_DOC: MAX_DOC
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
