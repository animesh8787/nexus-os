/* ============================================================
   Nexus OS — cloud sync (Firestore) + account deletion.  Portal only.

   The merge logic lives in sync-engine.js (unit-tested). This file:
     - adapts Firestore to the engine's backend interface
     - decides WHEN to sync: at start, ~2.5 s after edits, when you return to
       the tab, and when the network comes back
     - shows status (sidebar chip + Settings) and explains failures
     - implements "delete my account and all data"

   Data lives at   users/{uid}/state/{core|feed|gmail|resume}
                   users/{uid}/apps/{id}     users/{uid}/solves/{id}
   Each record is { u, v, json }. Access is restricted to the owner by firestore.rules.
   ============================================================ */
(function () {
  "use strict";
  var N = window.NEXUS, E = window.NXSyncEngine;
  if (!N || !E) return;
  var esc = N.esc, icon = N.icon;
  var FIRESTORE = "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js";

  var st = { state: "off", msg: "" };
  var engine = null, applying = false, deleting = false, timer = null, running = false, queued = null;
  var pulledOnce = false, lastFull = 0, lastOk = 0;

  var enabled = function () {
    return !deleting && !!(window.NexusAuth && NexusAuth.configured && N.user && !N.user.local && (window.NEXUS_CONFIG || {}).sync !== false);
  };
  var key = function (name) { return "nexus-os:" + name + ":" + N.user.uid; };
  function loadMeta() {
    try { var m = JSON.parse(localStorage.getItem(key("sync"))); if (m && m.hash && m.known) return m; } catch (e) {}
    return E.newMeta();
  }
  function saveMeta(m) { try { localStorage.setItem(key("sync"), JSON.stringify(m)); } catch (e) {} }
  function saveBackup(S) { try { localStorage.setItem(key("backup"), JSON.stringify({ at: Date.now(), state: S })); } catch (e) {} }

  /* ---------- Firestore <-> engine ---------- */
  function backend(db, uid) {
    var root = db.collection("users").doc(uid);
    var ref = function (r) { return r.kind === "doc" ? root.collection("state").doc(r.name) : root.collection(r.col).doc(r.id); };
    var rec = function (snap) { var d = snap.data(); return d && typeof d.json === "string" ? { u: +d.u || 0, v: d.v, json: d.json } : null; };
    return {
      async load() {
        var out = { docs: {}, apps: {}, solves: {} };
        var snaps = await Promise.all([root.collection("state").get(), root.collection("apps").get(), root.collection("solves").get()]);
        snaps[0].forEach(function (d) { var r = rec(d); if (r) out.docs[d.id] = r; });
        snaps[1].forEach(function (d) { var r = rec(d); if (r) out.apps[d.id] = r; });
        snaps[2].forEach(function (d) { var r = rec(d); if (r) out.solves[d.id] = r; });
        return out;
      },
      async peek(refs) {
        return Promise.all(refs.map(function (r) { return ref(r).get().then(function (s) { return s.exists ? +s.data().u || 0 : null; }); }));
      },
      async commit(ops) {
        for (var i = 0; i < ops.length; i += 400) {
          var b = db.batch();
          ops.slice(i, i + 400).forEach(function (op) { if (op.del) b.delete(ref(op)); else b.set(ref(op), op.set); });
          await b.commit();
        }
      },
      async wipe() {
        var cols = ["state", "apps", "solves"];
        for (var c = 0; c < cols.length; c++) {
          var snap = await root.collection(cols[c]).get(), docs = [];
          snap.forEach(function (d) { docs.push(d.ref); });
          for (var i = 0; i < docs.length; i += 400) {
            var b = db.batch();
            docs.slice(i, i + 400).forEach(function (r) { b.delete(r); });
            await b.commit();
          }
        }
      }
    };
  }

  async function ensure() {
    if (engine) return engine;
    var fb = await NexusAuth.firebase();
    await (window.NXSRI ? NXSRI.script(FIRESTORE) : Promise.reject(new Error("sri.js is missing")));
    engine = new E.Engine({ backend: backend(fb.firestore(), N.user.uid), getS: function () { return N.S; }, meta: loadMeta(), persist: saveMeta, backup: saveBackup });
    return engine;
  }

  function explain(e) {
    var c = (e && e.code) || "", m = String((e && e.message) || "");
    if (c === "permission-denied" || /permission|insufficient/i.test(m)) return "Cloud sync was refused. Verify your email address, and make sure the Firestore security rules from the README are published.";
    if (c === "unavailable" || c === "network-request-failed" || /offline|network|failed to get/i.test(m)) return "You're offline - changes will sync when you're back.";
    if (c === "failed-precondition" || c === "not-found") return "Firestore isn't enabled for this project yet (Firebase console -> Build -> Firestore Database -> Create database).";
    if (c === "unauthenticated") return "Your session expired - sign in again.";
    return "Cloud sync hit a problem" + (c ? " (" + c + ")" : "") + ". It will retry.";
  }

  /* ---------- running a sync ---------- */
  var changed = function (p) { return !!(p && (p.docs.length || p.apps || p.solves || p.removed)); };

  async function run(kind) {
    if (!enabled()) return;
    if (!pulledOnce) kind = "full";                 // never push before this device has seen the cloud copy
    if (running) { queued = queued === "full" || kind === "full" ? "full" : "push"; return; }
    running = true; st.state = "busy"; st.msg = ""; paintChip();
    try {
      var e = await ensure();
      if (kind === "full") {
        var pulled = await e.pull();
        pulledOnce = true; lastFull = Date.now();
        if (changed(pulled)) {
          applying = true; N.save(); applying = false;      // persist the merged state locally...
          N.reload();                                        // ...then re-read it so every view is consistent
          N.toast("Updated from your other device", "ok");
        }
        if (pulled.backedUp) N.toast("Some local changes were replaced by newer ones from the cloud; a backup was kept on this device.", "");
      }
      await e.push();
      lastOk = Date.now(); st.state = "ok";
    } catch (err) {
      var offline = /offline|network|unavailable/i.test(String(err && (err.code || err.message)));
      st.state = offline ? "offline" : "err"; st.msg = explain(err);
    } finally {
      running = false; paintChip(); paintCard();
      if (queued) { var k = queued; queued = null; setTimeout(function () { run(k); }, 300); }
    }
  }

  N.onSave = function () {
    if (applying || !enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(function () { run("push"); }, 2500);
  };

  /* ---------- status UI ---------- */
  function chipModel() {
    if (!N.user) return null;
    if (N.user.local) return { cls: "off", ic: "cloud-off", t: "Local only", tip: "Not signed in - data stays in this browser" };
    if (!enabled()) return { cls: "off", ic: "cloud-off", t: "Not synced", tip: "Cloud sync is not set up on this deployment" };
    if (st.state === "busy") return { cls: "busy", ic: "refresh", t: "Syncing...", tip: "" };
    if (st.state === "err") return { cls: "err", ic: "cloud-off", t: "Sync problem", tip: st.msg };
    if (st.state === "offline") return { cls: "warn", ic: "cloud-off", t: "Offline", tip: st.msg };
    if (lastOk) return { cls: "ok", ic: "cloud", t: "Synced " + N.ago(lastOk), tip: "Your data is backed up to your account" };
    return { cls: "busy", ic: "cloud", t: "Sync pending", tip: "" };
  }
  function paintChip() {
    var c = document.getElementById("cloudChip"), m = chipModel();
    if (!c || !m) return;
    c.className = "cloud-chip " + m.cls;
    c.title = m.tip || "";
    c.innerHTML = icon(m.ic, 13) + "<span>" + esc(m.t) + "</span>";
  }

  function cloudCard() {
    var m = chipModel(), local = N.user && N.user.local, on = enabled();
    var counts = N.S.jobs.length + " applications · " + N.S.solves.length + " solutions";
    return '<div class="card" id="cloudCard" style="margin-bottom:14px"><div class="card-head"><div class="section-label" style="margin:0">Cloud sync</div>' +
      '<span class="badge ' + (on ? (st.state === "err" ? "b-red" : st.state === "ok" || lastOk ? "b-green" : "b-muted") : "b-muted") + '">' + esc(on ? m.t : "off") + "</span></div>" +
      '<p class="faint" style="font-size:12px;margin-bottom:12px">' + (on
        ? "Your tracker, profile, solutions and settings sync to your account, so they're on every device and survive clearing your browser. " +
          "<strong>Never synced:</strong> your GitHub token and Groq key stay on this device."
        : local ? "You're in local mode, so data stays in this browser. Sign in with an account to sync across devices."
        : "Cloud sync isn't set up on this deployment (see the README).") + "</p>" +
      (on ? '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn btn-sm" data-action="sync-now"' + (running ? " disabled" : "") + ">" + icon("refresh", 12) + " Sync now</button>" +
        '<span class="faint" style="font-size:12px">' + esc(counts) + (lastOk ? " · last synced " + esc(N.ago(lastOk)) : "") + "</span></div>" : "") +
      (st.state === "err" || st.state === "offline" ? '<div class="auth-err show" style="margin-top:12px">' + esc(st.msg) + "</div>" : "") + "</div>";
  }
  function paintCard() { var c = document.getElementById("cloudCard"); if (c) c.outerHTML = cloudCard(); }

  function dangerCard() {
    var local = N.user && N.user.local;
    return '<div class="card card-danger" style="margin-bottom:14px"><div class="section-label" style="color:var(--red)">Danger zone</div>' +
      '<p class="faint" style="font-size:12px;margin-bottom:12px">' + (local
        ? "Erase everything Nexus OS has stored in this browser."
        : "Permanently delete your account, your cloud copy and the copy on this device. This cannot be undone. Export a backup first if you want to keep anything.") + "</p>" +
      '<button class="btn btn-danger" data-action="acct-delete">' + icon("trash", 13) + (local ? " Erase local data" : " Delete my account and data") + "</button></div>";
  }

  var origSettings = N.ROUTES.settings;
  N.ROUTES.settings = function () { return origSettings() + cloudCard() + dangerCard(); };
  N.actions["sync-now"] = function () { run("full"); };

  /* ---------- delete account ---------- */
  function clearLocal() {
    var uid = N.user.uid, k = ["nexus-os:v3:" + uid, "nexus-os:sync:" + uid, "nexus-os:backup:" + uid];
    try {
      k.forEach(function (x) { localStorage.removeItem(x); });
      /* the pre-accounts copy of this browser's data, if this account adopted it */
      if (localStorage.getItem("nexus-os:v2:adopted") === uid || N.user.local) { localStorage.removeItem("nexus-os:v2"); localStorage.removeItem("nexus-os:v2:adopted"); }
    } catch (e) {}
  }

  N.actions["acct-delete"] = async function () {
    var local = !!N.user.local, provider = "";
    if (!local) { try { provider = await NexusAuth.providerId(); } catch (e) {} }
    var r = await NXA11y.dialog({
      title: local ? "Erase local data?" : "Delete your account?",
      bodyHtml: local
        ? "<p>This removes everything Nexus OS stored in this browser: tracker, profile, solutions and settings. It cannot be undone.</p>"
        : "<p>This permanently deletes your account, everything synced to the cloud, and the copy on this device. It cannot be undone.</p>" +
          "<p>Your Gmail access (if connected) is revoked. Your GitHub repository is not touched.</p>",
      fields: [{ id: "confirm", label: "Type DELETE to confirm", placeholder: "DELETE" }]
        .concat(provider === "password" ? [{ id: "pw", label: "Your password", type: "password", autocomplete: "current-password" }] : []),
      confirmLabel: local ? "Erase everything" : "Delete everything", danger: true,
      enableWhen: function (v) { return v.confirm === "DELETE" && (provider !== "password" || !!v.pw); }
    });
    if (!r.ok) return;
    try {
      if (!local) {
        await NexusAuth.reauthenticate(r.values.pw);                  // first: a wrong password aborts before anything is deleted
        deleting = true; clearTimeout(timer);
        try { if (N.actions["gmail-disconnect"] && N.S.gmail && N.S.gmail.enabled) N.actions["gmail-disconnect"](); } catch (e) {}
        var e = await ensure();
        await e.wipe();                                                // cloud copy first, while we can still authenticate
      }
      deleting = true; N.onSave = null;
      clearLocal();
      if (local) { try { localStorage.removeItem("nexus-os:local-mode"); } catch (e2) {} location.replace("index.html?deleted=1"); }
      else await NexusAuth.deleteAccount();
    } catch (err) {
      deleting = false; N.onSave = N.onSave || onSaveHook;
      N.toast((window.NexusAuth && NexusAuth.friendly ? NexusAuth.friendly(err) : err.message) || "Couldn't delete the account.", "err");
    }
  };
  var onSaveHook = N.onSave;

  /* ---------- triggers ---------- */
  document.addEventListener("visibilitychange", function () { if (!document.hidden && enabled() && Date.now() - lastFull > 5 * 60 * 1000) run("full"); });
  window.addEventListener("online", function () { if (enabled()) run("full"); });
  N.onStart.push(function () {
    paintChip();
    setInterval(paintChip, 60 * 1000);
    if (enabled()) setTimeout(function () { run("full"); }, 500);
  });
  N.sync = { run: run, status: function () { return { state: st.state, msg: st.msg, lastOk: lastOk }; } };
})();
