/* ============================================================
   Nexus OS — AI layer (client).
     NXAI.mode()            "proxy" | "own" | "none"
     NXAI.available()       true when any AI route works
     NXAI.run(action, data) -> Promise<string>
   proxy : the hosted Groq proxy (NEXUS_CONFIG.api) holds the shared key and
           builds the prompt from { action, data }. Needs a signed-in user.
   own   : the user's own Groq key from Settings; prompts come from prompts.js
           and go straight to api.groq.com.
   Loads after app.js (needs window.NEXUS) and prompts.js (NXPrompts).
   ============================================================ */
(function () {
  "use strict";
  var N = window.NEXUS;
  var esc = N.esc;
  var ownKeyOpen = false, remaining = null;   // UI-only state, deliberately not persisted

  function apiUrl() { return String((window.NEXUS_CONFIG && window.NEXUS_CONFIG.api) || "").replace(/\/+$/, ""); }
  function signedIn() { return !!(N.user && !N.user.local && window.NexusAuth && NexusAuth.configured); }

  function mode() {
    if (apiUrl() && signedIn()) return "proxy";
    if (N.S.settings.groqKey) return "own";
    return "none";
  }

  async function viaProxy(action, data, retried) {
    var token = await NexusAuth.idToken();
    if (!token) throw new Error("Your session expired - sign in again.");
    var r;
    try {
      r = await fetch(apiUrl() + "/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ action: action, data: data })
      });
    } catch (e) { throw new Error("Couldn't reach the AI service. Check your connection."); }
    var j = await r.json().catch(function () { return {}; });
    /* The proxy only serves verified emails. If they just clicked the link, our token is stale:
       pick up the new flag, refresh the token, and try once more before complaining. */
    if (r.status === 403 && j.code === "email_not_verified") {
      if (!retried) {
        var ok = false;
        try { ok = await NexusAuth.refreshVerification(); } catch (e) { ok = false; }
        if (ok) { if (N.user) N.user.verified = true; return viaProxy(action, data, true); }
      }
      throw new Error("Verify your email address to use the AI features - check your inbox for the link, then try again (you can resend it in Settings).");
    }
    if (r.status === 403 && j.code === "email_blocked") throw new Error(j.error);
    if (r.status === 503 && j.code === "capacity") throw new Error(j.error);
    if (r.status === 429) throw new Error(j.error || "You've reached today's AI limit. It resets tomorrow.");
    if (r.status === 401) throw new Error("Your session expired - sign in again.");
    if (!r.ok) throw new Error(j.error || "The AI service returned an error (" + r.status + ").");
    if (j.remaining != null) remaining = j.remaining;
    return j.text || "";
  }

  async function viaOwnKey(action, data) {
    var spec = NXPrompts.build(action, data);
    return N.groqChat(spec.messages, { max: spec.max, temp: spec.temp, json: spec.json });
  }

  async function run(action, data) {
    var m = mode();
    if (m === "proxy") return viaProxy(action, data);
    if (m === "own") return viaOwnKey(action, data);
    throw new Error("Add a Groq key in Settings to use the AI features.");
  }

  /* pull one JSON object out of a model reply, tolerating ``` fences and stray prose */
  function parseJson(text) {
    var t = String(text || "").trim();
    var f = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (f) t = f[1].trim();
    var a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("The AI reply wasn't valid data - try again.");
    try { return JSON.parse(t.slice(a, b + 1)); }
    catch (e) { throw new Error("The AI reply wasn't valid data - try again."); }
  }

  window.NXAI = { mode: mode, available: function () { return mode() !== "none"; }, run: run, parseJson: parseJson, remaining: function () { return remaining; } };

  /* ---------- "what can I do better?" on a pushed solution ---------- */
  var busyAdvise = {};
  async function advise(id, opts) {
    opts = opts || {};
    var s = N.S.solves.find(function (x) { return x.id === id; });
    if (!s || busyAdvise[id]) return;
    if (!String(s.code || "").trim()) { if (!opts.silent) N.toast("This solve has no code stored to review"); return; }
    if (!NXAI.available()) { if (!opts.silent) N.toast("Turn on the AI coach first (Settings)"); return; }
    busyAdvise[id] = true;
    if (!opts.silent) N.toast("Reviewing " + s.title + "...");
    try {
      var text = await run("review_push", {
        solve: { title: s.title, difficulty: s.difficulty, topic: (s.topics && s.topics[0]) || "", lang: s.lang, code: s.code, notes: s.notes },
        funnel: N.funnel ? N.funnel() : null,
        profile: N.profileBrief ? N.profileBrief() : null
      });
      s.review = { text: text, date: new Date().toISOString() };
      N.save();
      N.toast("Review ready for " + s.title, "ok");
      if (N.current === "solves") N.rerender();
    } catch (e) {
      N.toast(e.message, "err");
    } finally { delete busyAdvise[id]; }
  }
  N.actions["solve-advise"] = function (D) { advise(D.id); };
  N.onPushed = function (id) { if (N.S.settings.autoAdvise && NXAI.available()) advise(id, { silent: true }); };

  N.actions["review-clear"] = function (D) {
    var s = N.S.solves.find(function (x) { return x.id === D.id; });
    if (s) { delete s.review; N.save(); N.rerender(); }
  };

  /* Settings: show "included" instead of a key box when the hosted proxy is in use */
  N.actions["ai-toggle-own"] = function () { ownKeyOpen = !ownKeyOpen; N.rerender(); };
  N.aiSettingsCard = function () {
    var s = N.S.settings, m = mode();
    var hosted = !!(apiUrl() && signedIn());
    var status = m === "proxy" ? '<span class="badge b-green">included</span>'
      : m === "own" ? '<span class="badge b-accent">your key</span>'
      : '<span class="badge b-muted">off</span>';
    var keyBlock = '<div class="grid g-2" style="gap:12px">' +
      '<div><label class="field-label">Groq API key</label>' +
      '<input class="input" type="password" id="setGroqKey" value="' + esc(s.groqKey) + '" placeholder="gsk_..." autocomplete="off"></div>' +
      '<div><label class="field-label">Model <span class="faint">- blank to auto-pick</span></label>' +
      '<input class="input" id="setGroqModel" value="' + esc(s.groqModel) + '" placeholder="auto"></div></div>' +
      '<div id="groqModelOut" style="margin-top:10px"></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-primary" data-action="settings-save">Save</button>' +
      '<button class="btn" data-action="groq-models">Load available models</button></div>';
    return '<div class="card" style="margin-bottom:14px">' +
      '<div class="card-head"><div class="section-label" style="margin:0">AI coach</div>' + status + '</div>' +
      (hosted
        ? '<p class="faint" style="font-size:12px;margin-bottom:12px">AI features run through the Nexus AI service with a fair-use daily limit. Only the data each feature needs is sent - your study stats, or the resume text you choose to parse.</p>' +
          '<button class="btn btn-sm btn-ghost" data-action="ai-toggle-own">' + (ownKeyOpen ? "Hide" : "Use my own Groq key instead") + '</button>' +
          (ownKeyOpen ? '<div style="margin-top:12px">' + keyBlock + '</div>' : "")
        : '<p class="faint" style="font-size:12px;margin-bottom:12px">Free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>. Stored in this browser, sent only to api.groq.com. Only your study stats are sent - no name, email or code unless you paste it into a review.</p>' + keyBlock) +
      '<label class="checkline" style="margin-top:14px"><input type="checkbox" id="setAutoAdvise" ' + (s.autoAdvise ? "checked" : "") + '> After I push a solution from here, automatically tell me what I can do better</label>' +
      '</div>';
  };
})();
