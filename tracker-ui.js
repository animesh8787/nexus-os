/* ============================================================
   Nexus OS — Job Tracker UI: board, detail drawer, "did you apply?"
   prompt and the read-only Gmail connection.  Logic lives in tracker.js.

   Gmail: Google Identity Services gives the browser a short-lived
   (~1 h) read-only access token. It is kept IN MEMORY ONLY - never
   written to storage - and used to call the Gmail REST API directly.
   Only sender, subject, date and Gmail's own short snippet are read.
   ============================================================ */
(function () {
  "use strict";
  var N = window.NEXUS, T = window.NXTracker;
  if (!N || !T) return;
  var esc = N.esc, icon = N.icon, S = function () { return N.S; };

  var COLS = [
    { k: "saved", label: "Saved", stages: ["saved"] },
    { k: "applied", label: "Applied", stages: ["applied"] },
    { k: "assessment", label: "Assessment", stages: ["assessment"] },
    { k: "interview", label: "Interview", stages: ["interview"] },
    { k: "offer", label: "Offer", stages: ["offer"] },
    { k: "closed", label: "Closed", stages: ["rejected", "withdrawn"] }
  ];
  var EVT = {
    saved: ["Saved to tracker", "star"], applied: ["Applied", "send"], received: ["Confirmation received", "mail"],
    assessment: ["Assessment", "code"], interview: ["Interview", "user"], offer: ["Offer", "trophy"],
    rejected: ["Rejected", "x"], withdrawn: ["Withdrawn", "logout"], note: ["Note", "edit"]
  };
  var STAGE_ORDER = ["saved", "applied", "assessment", "interview", "offer", "rejected", "withdrawn"];

  var openId = null, showForm = false, adviceHtml = "", adviceBusy = false, gmailMsg = "", showReview = false, reviewLimit = 15;
  /* Which stage accordions are expanded. Unset until the first render of that stage, which
     defaults it to "open" only if it already has cards - after that the user's own choice sticks. */
  var openStage = {};

  /* ---------- helpers ---------- */
  var jobs = function () { return S().jobs; };
  var byId = function (id) { return jobs().find(function (j) { return j.id === id; }); };
  function normalizeAll() { jobs().forEach(function (j) { T.normalizeJob(j, N.iso()); }); }
  function fmtD(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return esc(iso);
    var opt = { month: "short", day: "numeric" };
    if (d.getFullYear() !== new Date().getFullYear()) opt.year = "numeric";
    return d.toLocaleDateString("en", opt);
  }
  var daysSince = function (iso) { return T.dayNum(N.iso()) - T.dayNum(iso); };
  var appliedList = function () { return jobs().filter(function (j) { return j.pipeline !== "saved"; }); };

  N.funnel = function () { normalizeAll(); return T.funnel(jobs(), N.iso()); };
  N.recentApps = function () {
    normalizeAll();
    return appliedList().slice(0, 15).map(function (j) {
      return { company: j.co, role: j.role, stage: j.stage, daysSinceApplied: daysSince(j.dt), source: j.source || "Direct", fromInbox: j.events.some(function (e) { return e.src === "gmail"; }) };
    });
  };

  /* ================= Gmail ================= */
  var G = { token: "", exp: 0, client: null, busy: false, timer: null };
  function gclient() { return String((window.NEXUS_CONFIG && window.NEXUS_CONFIG.googleClientId) || ""); }
  function gs() { var s = S(); if (!s.gmail) s.gmail = { enabled: false, lastSync: 0, seen: {}, last: null };
    if (!s.gmail.ignored) s.gmail.ignored = {};
    if (!s.gmail.ai) s.gmail.ai = { on: false, at: 0 }; return s.gmail; }
  function tokenOk() { return !!G.token && Date.now() < G.exp - 30000; }

  var loaded = {};
  function loadScript(url) {
    if (!loaded[url]) loaded[url] = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = url; s.async = true; s.onload = res;
      s.onerror = function () { delete loaded[url]; rej(new Error("Couldn't load Google sign-in. Check your connection or ad-blocker.")); };
      document.head.appendChild(s);
    });
    return loaded[url];
  }

  async function connect() {
    if (!gclient()) throw new Error("Gmail sync isn't set up yet - add googleClientId in firebase-config.js.");
    await loadScript("https://accounts.google.com/gsi/client");
    return new Promise(function (res, rej) {
      if (!G.client) {
        G.client = google.accounts.oauth2.initTokenClient({
          client_id: gclient(),
          scope: "https://www.googleapis.com/auth/gmail.readonly",
          callback: function (r) {
            if (r.error) return G.rej(new Error(r.error_description || r.error));
            G.token = r.access_token; G.exp = Date.now() + (+r.expires_in || 3600) * 1000; G.res();
          },
          error_callback: function (e) {
            G.rej(new Error(e && e.type === "popup_closed" ? "The Google window was closed before finishing." :
              e && e.type === "popup_failed_to_open" ? "Your browser blocked the Google popup - allow popups and retry." : (e && e.message) || "Google sign-in failed."));
          }
        });
      }
      G.res = res; G.rej = rej;
      G.client.requestAccessToken({ prompt: gs().enabled ? "" : "consent", hint: (N.user && N.user.email) || undefined });
    });
  }

  function buildQuery() {
    var last = gs().lastSync;
    var since = last ? "after:" + Math.floor((last - 2 * 864e5) / 1000) : "newer_than:90d";
    var senders = "greenhouse-mail.io greenhouse.io lever.co ashbyhq.com myworkday.com workday.com workable.com smartrecruiters.com icims.com jobvite.com successfactors.com taleo.net breezy.hr recruitee.com bamboohr.com zohorecruit.com hackerrank.com codility.com codesignal.com hackerearth.com naukri.com instahyre.com wellfound.com indeed.com".split(" ");
    var subjects = ['"thank you for applying"', '"thanks for applying"', '"application received"', '"your application"', '"application to"', '"application for"',
      '"received your application"', "interview", "assessment", '"coding challenge"', '"next steps"', '"offer letter"', "unfortunately", '"not moving forward"', '"other candidates"'];
    return since + " ({from:(" + senders.join(" OR ") + ")} OR subject:(" + subjects.join(" OR ") + "))";
  }

  async function gfetch(url) {
    var r = await fetch(url, { headers: { Authorization: "Bearer " + G.token } });
    if (r.ok) return r.json();
    var j = await r.json().catch(function () { return {}; }), msg = (j.error && j.error.message) || "";
    if (r.status === 401) { G.token = ""; throw new Error("Your Gmail session expired - reconnect to keep syncing."); }
    if (r.status === 403 && /has not been used|disabled|not enabled/i.test(msg)) throw new Error("The Gmail API isn't enabled for your Google Cloud project yet (APIs & Services -> Library -> Gmail API -> Enable).");
    if (r.status === 403) throw new Error("Gmail permission wasn't granted. Reconnect and tick the read-only Gmail permission.");
    if (r.status === 429) throw new Error("Gmail is rate-limiting requests - try again in a minute.");
    throw new Error(msg || "Gmail returned an error (" + r.status + ").");
  }

  async function listIds() {
    var ids = [], page = "", q = encodeURIComponent(buildQuery());
    for (var i = 0; i < 2; i++) {
      var j = await gfetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=" + q + (page ? "&pageToken=" + page : ""));
      (j.messages || []).forEach(function (m) { ids.push(m.id); });
      if (!j.nextPageToken) break;
      page = j.nextPageToken;
    }
    return ids;
  }
  async function fetchMeta(ids) {
    var out = [], i = 0;
    async function worker() {
      while (i < ids.length) {
        var id = ids[i++];
        try {
          var m = await gfetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id + "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date");
          var h = {}; ((m.payload && m.payload.headers) || []).forEach(function (x) { h[x.name.toLowerCase()] = x.value; });
          out.push({ id: id, from: h.from || "", subject: h.subject || "", snippet: m.snippet || "", date: +m.internalDate || Date.parse(h.date) || 0 });
        } catch (e) { if (/expired|permission|enabled|rate-limit/i.test(e.message)) throw e; /* one bad message shouldn't stop the sync */ }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    return out;
  }

  async function sync(opts) {
    opts = opts || {};
    if (G.busy) return;
    G.busy = true; gmailMsg = ""; paint();
    try {
      if (!tokenOk()) {
        if (opts.silent) return;
        await connect();
      }
      var g = gs(); g.enabled = true;
      var ids = await listIds();
      var fresh = ids.filter(function (id) { return !g.seen[id]; });
      var msgs = await fetchMeta(fresh.slice(0, 150));
      var ignored = g.ignored || {};
      var classified = msgs.filter(function (m) { return !ignored[m.id]; }).map(T.classifyEmail).filter(Boolean);
      /* Optional, off by default: mail the rules could not place goes to the AI provider, but only after the user switched this on. */
      var aiUsed = 0, aiNote = "", notSeen = {};
      if (g.ai && g.ai.on && window.NXAI && NXAI.available()) {
        var unclear = msgs.filter(function (m) { return !ignored[m.id] && T.needsAI(m); }).slice(0, 20);
        if (unclear.length) {
          try {
            var out = NXAI.parseJson(await NXAI.run("email_triage", T.aiPayload(unclear)));
            var extra = T.fromAI(out.results, unclear);
            classified = classified.concat(extra); aiUsed = extra.length;
          } catch (e) {
            aiNote = e.message;
            unclear.forEach(function (m) { notSeen[m.id] = 1; });          // try these again next time
          }
        }
      }
      normalizeAll();
      var res = T.ingestEmails(jobs(), classified, N.uid);
      msgs.forEach(function (m) { if (!notSeen[m.id]) g.seen[m.id] = m.date || 1; });
      var keys = Object.keys(g.seen);
      if (keys.length > 1500) keys.sort(function (a, b) { return g.seen[a] - g.seen[b]; }).slice(0, keys.length - 1200).forEach(function (k) { delete g.seen[k]; });
      g.lastSync = Date.now();
      g.last = { scanned: msgs.length, matched: classified.length, added: res.added, updated: res.updated, events: res.events, ai: aiUsed };
      N.save();
      gmailMsg = aiNote ? "The AI check was skipped: " + aiNote : "";
      if (!opts.silent || res.events) {
        N.toast(res.events ? "Inbox: " + res.events + " update" + (res.events === 1 ? "" : "s") + " (" + res.added + " new application" + (res.added === 1 ? "" : "s") + ")" : "Inbox checked - nothing new", "ok");
      }
    } catch (e) {
      gmailMsg = e.message;
      if (!opts.silent) N.toast(e.message, "err");
    } finally { G.busy = false; paint(); }
  }

  function startTimer() {
    if (G.timer) return;
    G.timer = setInterval(function () { if (tokenOk() && !G.busy) sync({ silent: true }); }, 10 * 60 * 1000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && tokenOk() && !G.busy && Date.now() - gs().lastSync > 10 * 60 * 1000) sync({ silent: true });
    });
  }

  function disconnect() {
    var t = G.token; G.token = ""; G.exp = 0;
    try { if (t && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(t, function () {}); } catch (e) {}
    var g = gs(); g.enabled = false; g.lastSync = 0; g.last = null; g.ai = { on: false, at: 0 };
    N.save(); paint();
    N.toast("Gmail disconnected", "ok");
  }

  /* ================= Inbox review ================= */
  var TYPE_LABEL = { received: "Confirmation", assessment: "Assessment", interview: "Interview", offer: "Offer", rejected: "Rejection" };
  var HIGH = { offer: 1, rejected: 1 };
  function reviewCard() {
    var list = T.mailEvents(jobs()), todo = list.filter(function (x) { return !x.ev.ok; }).length;
    var ign = Object.keys(gs().ignored || {}).length;
    if (!list.length && !ign) return "";
    var head = '<div class="gb-row"><span class="gb-ico" style="color:' + (todo ? "var(--amber)" : "var(--green)") + '">' + icon(todo ? "inbox" : "check", 20) + '</span>' +
      '<div class="gb-text"><div class="card-title">Inbox review</div><div class="faint" style="font-size:12.5px;margin-top:2px">' +
      (todo ? todo + " email" + (todo === 1 ? "" : "s") + " Nexus filed for you " + (todo === 1 ? "hasn't" : "haven't") + " been checked yet. A wrong stage is easy to fix here." :
        "Everything Nexus filed from your inbox has been checked.") + '</div></div>' +
      '<div class="wrap" style="flex-shrink:0"><button class="btn btn-sm' + (todo && !showReview ? " btn-primary" : "") + '" data-action="trk-review-toggle" aria-expanded="' + showReview + '">' + (showReview ? "Hide" : "Review") + "</button></div></div>";
    if (!showReview) return '<div class="card gmail-bar" id="inboxReview" style="margin-bottom:14px">' + head + "</div>";
    /* unchecked first, then newest */
    var sorted = list.slice().sort(function (a, b) { return (a.ev.ok ? 1 : 0) - (b.ev.ok ? 1 : 0); });
    var rows = sorted.slice(0, reviewLimit).map(function (x) {
      var j = x.job, e = x.ev, id = esc(j.id), dat = 'data-id="' + id + '" data-i="' + x.i + '"';
      var opts = T.MAIL_TYPES.map(function (t) { return '<option value="' + t + '"' + (t === e.t ? " selected" : "") + ">" + TYPE_LABEL[t] + "</option>"; }).join("");
      var moves = '<option value="">Move to another application…</option>' + jobs().filter(function (o) { return o !== j; }).slice(0, 80).map(function (o) {
        return '<option value="' + esc(o.id) + '">' + esc(o.co) + " - " + esc(o.role) + "</option>"; }).join("");
      return '<div class="rv-row' + (e.ok ? " rv-done" : "") + '">' +
        '<div class="rv-main"><div class="rv-title"><strong>' + esc(j.co) + '</strong> <span class="faint">' + esc(j.role) + '</span>' +
        (HIGH[e.t] && !e.ok ? ' <span class="badge b-amber">high impact</span>' : "") + (e.ai ? ' <span class="badge b-accent" title="Filed by the optional AI check - please confirm it">AI-suggested</span>' : "") + (e.ok ? ' <span class="badge b-green">checked</span>' : "") + '</div>' +
        '<div class="rv-subj">' + icon("mail", 11) + " " + esc(e.subj || "(no subject)") + ' <span class="faint">- ' + fmtD(e.d) + '</span></div></div>' +
        '<div class="rv-ctl"><select class="input rv-sel" data-action="trk-mail-type" ' + dat + ' aria-label="What this email is">' + opts + "</select>" +
        '<select class="input rv-sel" data-action="trk-mail-move" ' + dat + ' aria-label="Move this email to another application">' + moves + "</select>" +
        (e.ok ? "" : '<button class="btn btn-sm" data-action="trk-mail-ok" ' + dat + ">Looks right</button>") +
        '<button class="btn btn-sm btn-ghost" data-action="trk-mail-drop" ' + dat + ' title="Remove it from the tracker and never file it again">Not a job email</button></div></div>';
    }).join("");
    var foot = "";
    if (sorted.length > reviewLimit) foot += '<button class="btn btn-sm btn-ghost" data-action="trk-review-more">Show ' + Math.min(15, sorted.length - reviewLimit) + " more</button> ";
    if (todo > 1) foot += '<button class="btn btn-sm btn-ghost" data-action="trk-mail-okall">Mark all as checked</button> ';
    if (ign) foot += '<button class="btn btn-sm btn-ghost" data-action="trk-mail-restore" title="Forget the emails you removed and scan the inbox again">Restore ' + ign + " removed email" + (ign === 1 ? "" : "s") + "</button>";
    return '<div class="card gmail-bar" id="inboxReview" style="margin-bottom:14px">' + head + '<div class="rv-list">' + (rows || '<div class="faint" style="padding:10px 2px;font-size:13px">No inbox entries.</div>') + "</div>" +
      (foot ? '<div class="wrap" style="margin-top:10px">' + foot + "</div>" : "") + "</div>";
  }

  function aiRow() {
    var g = gs(), on = !!(g.ai && g.ai.on), can = !!(window.NXAI && NXAI.available());
    return '<div class="ai-row"><div class="ai-txt"><strong>AI check for unclear emails</strong> <span class="badge ' + (on ? "b-accent" : "b-muted") + '">' + (on ? "On" : "Off") + '</span>' +
      '<div class="faint" style="font-size:12px;margin-top:3px">' + (on
        ? "Emails the rules can't place are sent to the AI provider (sender name and domain, subject and Gmail's short snippet only)."
        : "Off. Some emails don't match Nexus's rules. If you choose, AI can read those few emails to file them. Nothing is sent unless you turn this on.") +
      (!can && !on ? " Needs the AI coach - see Settings." : "") + '</div></div>' +
      (on ? '<button class="btn btn-sm btn-ghost" data-action="gmail-ai-off">Turn off</button>'
          : '<button class="btn btn-sm" data-action="gmail-ai-on"' + (can ? "" : " disabled") + '>Turn on…</button>') + '</div>';
  }

  function gmailBar() {
    var g = gs(), st;
    if (!gclient()) {
      return '<div class="card gmail-bar" style="margin-bottom:14px"><div class="gb-row"><span class="gb-ico" style="color:var(--faint)">' + icon("mail", 20) + '</span>' +
        '<div class="gb-text"><div class="card-title">Inbox sync</div><div class="faint" style="font-size:12.5px">Not set up on this deployment. Add a Google client ID to <code>firebase-config.js</code> to let Nexus read confirmation and reply emails (read-only). Until then, the "Did you apply?" prompt and manual entries keep this board current.</div></div>' +
        '<span class="badge b-muted">off</span></div></div>';
    }
    if (!g.enabled) {
      st = '<button class="btn btn-primary btn-sm" data-action="gmail-sync"' + (G.busy ? " disabled" : "") + '>' + icon("mail", 13) + ' Connect Gmail</button>';
      return '<div class="card gmail-bar" style="margin-bottom:14px"><div class="gb-row"><span class="gb-ico">' + icon("mail", 20) + '</span>' +
        '<div class="gb-text"><div class="card-title">Let your inbox update this board</div><div class="faint" style="font-size:12.5px">Read-only. Nexus finds confirmation, assessment, interview and rejection emails and stamps the date on the right application. It reads only sender, subject, date and a short snippet - and the access token stays in memory.</div></div>' + st + '</div>' +
        (gmailMsg ? '<div class="auth-err show" style="margin-top:12px">' + esc(gmailMsg) + '</div>' : "") + '</div>';
    }
    var live = tokenOk();
    var last = g.last ? g.last.events + " update" + (g.last.events === 1 ? "" : "s") + " last check · " + g.last.scanned + " emails scanned" : "";
    return '<div class="card gmail-bar" style="margin-bottom:14px"><div class="gb-row"><span class="gb-ico" style="color:' + (live ? "var(--green)" : "var(--amber)") + '">' + icon("mail", 20) + '</span>' +
      '<div class="gb-text"><div class="card-title">Gmail ' + (live ? "connected" : "needs reconnecting") + '</div>' +
      '<div class="faint" style="font-size:12.5px">' + (G.busy ? '<span class="spin"></span> Checking your inbox...' : (g.lastSync ? "Last checked " + N.ago(g.lastSync) : "Not checked yet") + (last ? " · " + last : "") + (live ? " · rechecks every 10 min while this page is open" : " · Google sessions last about an hour")) + '</div></div>' +
      '<div class="wrap" style="flex-shrink:0"><button class="btn btn-sm ' + (live ? "" : "btn-primary") + '" data-action="gmail-sync"' + (G.busy ? " disabled" : "") + '>' + icon("refresh", 12) + (live ? " Check now" : " Reconnect") + '</button>' +
      '<button class="btn btn-sm btn-ghost" data-action="gmail-rescan"' + (G.busy ? " disabled" : "") + ' title="Look at the last 90 days again">Rescan 90 days</button>' +
      '<button class="btn btn-sm btn-ghost" data-action="gmail-disconnect">Disconnect</button></div></div>' +
      aiRow() + (gmailMsg ? '<div class="auth-err show" style="margin-top:12px">' + esc(gmailMsg) + '</div>' : "") + '</div>';
  }

  /* ================= board ================= */
  function card(j) {
    var last = j.events[j.events.length - 1] || {}, fromMail = j.events.some(function (e) { return e.src === "gmail"; });
    var waiting = (j.pipeline === "applied") && daysSince(j.dt) >= 14;
    var tag = last.t && last.t !== "applied" && last.t !== "saved" && EVT[last.t]
      ? '<span class="tc-tag st-' + esc(last.t) + '">' + esc(EVT[last.t][0]) + " · " + fmtD(last.d) + "</span>" : "";
    return '<div class="tcard st-' + esc(j.pipeline) + '" draggable="true" tabindex="0" role="button" aria-label="' + esc((j.role || "Role not stated") + " at " + j.co + ", " + T.LABEL[j.pipeline] + ". Open details") + '" data-action="trk-open" data-id="' + esc(j.id) + '">' +
      '<div class="tc-role' + (!j.role || j.role === "Role not stated" ? " unk" : "") + '">' + esc(j.role || "Role not stated") + '</div><div class="tc-co">' + esc(j.co) + '</div>' +
      '<div class="tc-meta"><span>' + (j.pipeline === "saved" ? "Saved " : "Applied ") + fmtD(j.dt) + '</span>' +
      (fromMail ? '<span class="tc-mail" title="Updated from your inbox">' + icon("mail", 11) + '</span>' : "") +
      (waiting ? '<span class="tc-wait" title="No reply yet">' + daysSince(j.dt) + 'd</span>' : "") + '</div>' + tag + '</div>';
  }
  function board() {
    var list = jobs();
    return '<div class="board">' + COLS.map(function (c) {
      var items = list.filter(function (j) { return c.stages.indexOf(j.pipeline) >= 0; });
      if (openStage[c.k] == null) openStage[c.k] = items.length > 0;
      var open = !!openStage[c.k], bodyId = "colBody-" + c.k;
      return '<div class="col col-' + c.k + (open ? " open" : "") + '" data-col="' + c.k + '">' +
        '<button type="button" class="col-head" data-action="trk-col-toggle" data-col="' + c.k + '" aria-expanded="' + open + '" aria-controls="' + bodyId + '">' +
          '<span class="col-chev">' + icon("chevron", 13) + '</span><span class="col-label">' + c.label + '</span><span class="col-n">' + items.length + '</span>' +
        '</button>' +
        '<div class="col-body" id="' + bodyId + '" role="region" aria-label="' + esc(c.label) + '"' + (open ? "" : " hidden") + '>' +
          (items.length ? items.map(card).join("") : '<div class="col-empty">' + (c.k === "saved" ? "Jobs you save from the feed land here." : "Nothing at this stage yet.") + "</div>") +
        "</div></div>";
    }).join("") + "</div>";
  }

  function formCard() {
    if (!showForm) return "";
    return '<div class="card" style="margin-bottom:14px;border-color:var(--accent-border)"><div class="section-label">New application</div>' +
      '<div class="grid g-2" style="gap:10px;margin-bottom:12px">' +
      '<div><label class="field-label">Company *</label><input class="input" id="tCo" placeholder="Stripe"></div>' +
      '<div><label class="field-label">Role *</label><input class="input" id="tRole" placeholder="Backend Engineer Intern"></div>' +
      '<div><label class="field-label">Date applied</label><input class="input" type="date" id="tDate" value="' + N.iso() + '"></div>' +
      '<div><label class="field-label">Stage</label><select id="tStage">' + STAGE_ORDER.filter(function (s) { return s !== "saved"; }).map(function (s) { return '<option value="' + s + '">' + T.LABEL[s] + "</option>"; }).join("") + "</select></div>" +
      '<div><label class="field-label">Posting link</label><input class="input" id="tUrl" placeholder="https://..."></div>' +
      '<div><label class="field-label">Compensation</label><input class="input" id="tSal" placeholder="₹1.5L/mo"></div></div>' +
      '<div style="display:flex;gap:8px"><button class="btn btn-primary" data-action="trk-add">Save application</button><button class="btn btn-ghost" data-action="trk-add-form">Cancel</button></div></div>';
  }

  function stats() {
    var f = N.funnel(), st = f.stages;
    var prog = st.assessment + st.interview;
    return '<div class="grid g-4" style="margin-bottom:14px">' +
      N.stat("Applied", f.applied, f.saved ? f.saved + " more saved" : "applications sent", { icon: "send", color: f.applied ? "var(--accent)" : "var(--faint)" }) +
      N.stat("In progress", prog, "assessment + interview", { icon: "columns", color: prog ? "var(--amber)" : "var(--faint)" }) +
      N.stat("Offers", st.offer, st.rejected + " closed as rejected", { icon: "trophy", color: st.offer ? "var(--green)" : "var(--faint)" }) +
      N.stat("Response rate", f.responseRate + "%", f.medianDaysToReply != null ? "median reply in " + f.medianDaysToReply + " days" : "no replies yet", { icon: "chart", color: f.responseRate >= 10 ? "var(--green)" : "var(--faint)" }) + "</div>";
  }

  /* ================= detail drawer ================= */
  function drawer() {
    var j = openId && byId(openId);
    if (!j) return "";
    var evs = j.events.map(function (e, i) { return { e: e, i: i }; }).sort(function (a, b) { return a.e.d < b.e.d ? -1 : a.e.d > b.e.d ? 1 : a.i - b.i; });
    var waiting = j.pipeline === "applied" ? daysSince(j.dt) : null;
    return '<div class="modal-back" data-action="trk-close"><div class="modal" role="dialog" aria-modal="true" aria-label="Application details">' +
      '<div class="modal-head"><div style="min-width:0"><input class="input m-title" data-action="trk-field" data-k="role" data-id="' + esc(j.id) + '" value="' + esc(j.role) + '" aria-label="Role">' +
      '<input class="input m-sub" data-action="trk-field" data-k="co" data-id="' + esc(j.id) + '" value="' + esc(j.co) + '" aria-label="Company"></div>' +
      '<button class="icon-btn" data-action="trk-close" aria-label="Close">' + icon("x", 16) + '</button></div>' +
      '<div class="modal-body">' +
      '<div class="section-label">Stage</div><div class="wrap" style="margin-bottom:16px">' + STAGE_ORDER.map(function (s) {
        return '<button class="btn btn-sm ' + (j.pipeline === s ? "btn-primary" : "") + '" data-action="trk-stage" data-id="' + esc(j.id) + '" data-s="' + s + '">' + T.LABEL[s] + "</button>"; }).join("") + "</div>" +
      '<div class="grid g-3" style="gap:10px;margin-bottom:16px">' +
        '<div><label class="field-label">' + (j.pipeline === "saved" ? "Saved on" : "Applied on") + '</label><input class="input" type="date" data-action="trk-field" data-k="dt" data-id="' + esc(j.id) + '" value="' + esc(j.dt) + '"></div>' +
        '<div><label class="field-label">Compensation</label><input class="input" data-action="trk-field" data-k="sal" data-id="' + esc(j.id) + '" value="' + esc(j.sal || "") + '" placeholder="-"></div>' +
        '<div><label class="field-label">Source</label><input class="input" data-action="trk-field" data-k="source" data-id="' + esc(j.id) + '" value="' + esc(j.source || "") + '" placeholder="-"></div></div>' +
      (waiting != null && waiting >= 14 ? '<div class="hint-row" style="margin-bottom:14px"><span>' + waiting + ' days since you applied with no reply. A short, polite follow-up often helps.</span></div>' : "") +
      '<div class="section-label">Timeline</div><div class="tl">' + evs.map(function (x) {
        var e = x.e, m = EVT[e.t] || [e.t, "dot"];
        return '<div class="tl-item"><span class="tl-dot st-' + esc(e.t) + '">' + icon(m[1], 12) + '</span><div class="tl-main"><div class="tl-top"><strong>' + esc(m[0]) + '</strong><span class="faint">' + fmtD(e.d) + '</span>' +
          (e.src === "gmail" ? '<span class="badge b-accent">' + icon("mail", 10) + ' inbox</span>' : "") +
          (e.src !== "gmail" ? '<button class="icon-btn tl-del" data-action="trk-evt-del" data-id="' + esc(j.id) + '" data-i="' + x.i + '" title="Remove entry" aria-label="Remove entry">' + icon("x", 11) + "</button>" : "") + '</div>' +
          ((e.subj || e.note) ? '<div class="tl-note">' + esc(e.subj || e.note) + "</div>" : "") + "</div></div>"; }).join("") + "</div>" +
      '<div class="tl-add"><select id="evT">' + ["note", "assessment", "interview", "offer", "rejected", "withdrawn"].map(function (t) { return '<option value="' + t + '">' + (t === "note" ? "Add a note" : "Moved to " + T.LABEL[t]) + "</option>"; }).join("") + '</select>' +
      '<input class="input" type="date" id="evD" value="' + N.iso() + '"><input class="input" id="evN" placeholder="Details (optional)" data-enter="trk-evt-add" data-id="' + esc(j.id) + '"><button class="btn btn-sm" data-action="trk-evt-add" data-id="' + esc(j.id) + '">Add</button></div>' +
      '<label class="field-label" style="margin-top:16px">Notes</label><textarea class="code-area" rows="3" data-action="trk-field" data-k="notes" data-id="' + esc(j.id) + '" placeholder="Recruiter name, prep notes, next steps...">' + esc(j.notes || "") + '</textarea>' +
      '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
        (j.url ? '<a class="btn btn-sm" href="' + esc(j.url) + '" target="_blank" rel="noopener">Open posting ' + icon("arrow-up-right", 12) + "</a>" : "") +
        '<button class="btn btn-sm btn-danger right" data-action="trk-del" data-id="' + esc(j.id) + '">' + icon("trash", 12) + " Delete</button></div></div></div></div>";
  }

  /* ================= page ================= */
  function body() {
    normalizeAll();
    var has = jobs().length;
    var ai = window.NXAI && NXAI.available();
    return '<div class="topline" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px 16px;flex-wrap:wrap;margin-bottom:16px">' +
      '<div><div class="page-title">Job Tracker</div><div class="page-sub" style="margin-bottom:0">Every application, its stage, and the date each thing happened.</div></div>' +
      '<div class="wrap"><button class="btn btn-sm" data-action="trk-advice"' + (ai && !adviceBusy ? "" : " disabled") + ' title="' + (ai ? "" : "Turn on the AI coach in Settings") + '">' + icon("sparkles", 13) + (adviceBusy ? " Thinking..." : " Job-search advice") + '</button>' +
      '<button class="btn btn-primary btn-sm" data-action="trk-add-form">' + (showForm ? "Cancel" : icon("plus", 13) + " Add application") + "</button></div></div>" +
      stats() + '<div id="trkAdvice">' + adviceHtml + "</div>" + gmailBar() + reviewCard() + formCard() +
      (has ? board() : '<div class="card">' + N.empty("target", "No applications yet", "Hit Apply on a job in your feed - Nexus will ask if you applied and log it. Or add one by hand.") + "</div>") +
      drawer();
  }
  var releaseTrap = null, opener = null;
  function paint() {
    var r = document.getElementById("trkRoot");
    var mem = window.NXA11y ? NXA11y.remember() : null;
    if (r) r.innerHTML = body();
    var isOpen = !!(openId && byId(openId));
    document.body.style.overflow = isOpen ? "hidden" : "";
    if (!window.NXA11y) return;
    if (isOpen && !releaseTrap) {
      releaseTrap = NXA11y.trap(function () { return document.querySelector(".modal"); }, { onClose: function () { closeDrawer(); }, initial: ".m-title" });
    } else if (!isOpen && releaseTrap) {
      releaseTrap(false); releaseTrap = null;
      NXA11y.restore(opener); opener = null;              // hand focus back to the card that opened it
    } else if (isOpen) {
      NXA11y.restore(mem, document.querySelector(".modal"));    // re-rendered while open: keep the user's place
    }
  }
  function closeDrawer() { openId = null; paint(); }
  N.ROUTES.jobs = function () { return '<div id="trkRoot">' + body() + "</div>"; };
  /* leaving the page must release the scroll lock */
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest('[data-action="nav"]') && openId) {
      openId = null; document.body.style.overflow = "";
      if (releaseTrap) { releaseTrap(false); releaseTrap = null; }
    }
  }, true);

  /* ================= actions ================= */
  var A = N.actions, C = N.changes;
  function touch() { N.save(); paint(); }

  A["trk-open"] = function (D) { opener = window.NXA11y ? NXA11y.remember() : null; openId = D.id; paint(); };
  A["trk-close"] = function (D, t, ev) {
    if (ev && t && t.classList.contains("modal-back") && ev.target !== t) return;   // click landed inside the dialog
    closeDrawer();
  };
  /* keyboard: Enter / Space opens a focused card (Escape + Tab are handled by the focus trap) */
  document.addEventListener("keydown", function (e) {
    var c = e.target && e.target.classList && e.target.classList.contains("tcard") ? e.target : null;
    if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); A["trk-open"]({ id: c.dataset.id }); }
  });
  A["trk-add-form"] = function () { showForm = !showForm; paint(); };
  A["trk-add"] = function () {
    var g = function (id) { var x = document.getElementById(id); return x ? x.value.trim() : ""; };
    var co = g("tCo"), role = g("tRole");
    if (!co || !role) return N.toast("Company and role are required");
    var stage = g("tStage") || "applied", d = g("tDate") || N.iso();
    var j = T.normalizeJob({ id: N.uid(), co: co, role: role, dt: d, sal: g("tSal"), url: g("tUrl"), source: "Manual", pipeline: stage, events: [] }, d);
    j.events = [{ d: d, t: "applied", src: "manual" }];
    if (stage !== "applied") j.events.push({ d: d, t: stage, src: "manual" });
    jobs().unshift(j); showForm = false; touch();
  };
  A["trk-stage"] = function (D) {
    var j = byId(D.id); if (!j || j.pipeline === D.s) return;
    T.setPipeline(j, D.s, { src: "manual" }); touch();
  };
  A["trk-del"] = function (D) {
    if (!confirm("Delete this application and its timeline?")) return;
    var j = byId(D.id);
    if (j && j.jobId) delete S().jobfeed.tracked[j.jobId];
    S().jobs = jobs().filter(function (x) { return x.id !== D.id; });
    openId = null; touch();
  };
  A["trk-evt-add"] = function (D) {
    var j = byId(D.id); if (!j) return;
    var t = document.getElementById("evT").value, d = document.getElementById("evD").value || N.iso(), n = document.getElementById("evN").value.trim().slice(0, 300);
    if (t === "note") { if (!n) return N.toast("Write a note first"); j.events.push({ d: d, t: "note", src: "manual", note: n }); }
    else T.setPipeline(j, t, { date: d, note: n, src: "manual" });
    touch();
  };
  A["trk-evt-del"] = function (D) {
    var j = byId(D.id); if (!j || j.events.length <= 1) return N.toast("An application needs at least one entry");
    j.events.splice(+D.i, 1); touch();
  };
  C["trk-field"] = function (t, D) {
    var j = byId(D.id); if (!j) return;
    var v = t.value;
    if (D.k === "dt") { if (!v) return; j.dt = v; if (j.events[0] && (j.events[0].t === "applied" || j.events[0].t === "saved")) j.events[0].d = v; }
    else if (D.k === "co" || D.k === "role") { v = v.trim().slice(0, 90); if (!v) { t.value = j[D.k]; return; } j[D.k] = v; }
    else j[D.k] = v.slice(0, D.k === "notes" ? 2000 : 120);
    N.save();
    var r = document.getElementById("trkRoot");
    /* keep typing focus: only the board behind the dialog needs a refresh */
    if (r) { var b = r.querySelector(".board"); if (b) b.outerHTML = board(); }
  };
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (e.key === "Enter" && t && t.dataset && t.dataset.enter === "trk-evt-add") { e.preventDefault(); A["trk-evt-add"](t.dataset); }
  });

  A["trk-review-toggle"] = function () { showReview = !showReview; reviewLimit = 15; paint(); };
  A["trk-review-more"] = function () { reviewLimit += 15; paint(); };
  A["trk-mail-ok"] = function (D) {
    var j = byId(D.id), e = j && j.events[+D.i]; if (!e) return;
    e.ok = true; touch();
  };
  A["trk-mail-okall"] = function () {
    T.mailEvents(jobs()).forEach(function (x) { x.ev.ok = true; });
    touch();
  };
  A["trk-mail-drop"] = function (D) {
    var j = byId(D.id); if (!j) return;
    var r = T.dropMail(jobs(), j, +D.i); if (!r) return;
    var g = gs(); g.ignored[r.id] = Date.now();
    var ks = Object.keys(g.ignored);
    if (ks.length > 500) ks.sort(function (a, b) { return g.ignored[a] - g.ignored[b]; }).slice(0, ks.length - 500).forEach(function (k) { delete g.ignored[k]; });
    if (openId && !byId(openId)) openId = null;
    N.toast(r.removedJob ? "Removed the email and the application it created" : "Email removed - stage recalculated", "ok");
    touch();
  };
  A["trk-mail-restore"] = function () {
    var g = gs(); g.ignored = {}; g.seen = {}; g.lastSync = 0; N.save();
    if (tokenOk()) sync(); else { paint(); N.toast("Removed emails restored - they come back at your next Gmail sync", "ok"); }
  };
  C["trk-mail-type"] = function (t, D) {
    var j = byId(D.id); if (!j) return;
    if (T.setMailType(j, +D.i, t.value)) touch();
  };
  C["trk-mail-move"] = function (t, D) {
    var j = byId(D.id), to = byId(t.value); if (!j || !to) return;
    if (T.moveMail(jobs(), j, +D.i, to)) { N.toast("Moved to " + to.co, "ok"); touch(); }
  };

  A["gmail-ai-on"] = async function () {
    if (!(window.NXAI && NXAI.available())) return;
    var route = NXAI.mode() === "proxy" ? "through the Nexus AI service to Groq (the AI provider)" : "straight from your browser to Groq (the AI provider), using your own key";
    var r = await NXA11y.dialog({
      title: "Send unclear emails to an AI service?",
      bodyHtml:
        "<p>Nexus files most job emails with its own rules, in your browser. Some emails don't match those rules. If you turn this on, those emails are sent <strong>" + route + "</strong> so it can tell whether each one is a confirmation, assessment, interview, offer or rejection.</p>" +
        "<p><strong>What is sent, for those emails only (at most 20 per check):</strong> the sender's name and domain (not the email address), the subject line, and the short snippet Gmail provides.</p>" +
        "<p><strong>What is never sent:</strong> full message bodies, attachments, your address, or any email the rules already handled.</p>" +
        "<p>Nexus does not store what is sent or returned. The provider handles it under its own terms and privacy policy. It is used only to file your emails, not for ads or to train AI models by us. You can turn this off at any time, and it turns off if you disconnect Gmail. Details are in the <a href=\"privacy.html\" target=\"_blank\" rel=\"noopener\">Privacy Policy</a>.</p>",
      confirmLabel: "Yes, send unclear emails"
    });
    if (!r.ok) return;
    var g = gs(); g.ai = { on: true, at: Date.now() }; N.save(); paint();
    N.toast("AI check is on - it applies to your next inbox check", "ok");
  };
  A["gmail-ai-off"] = function () { var g = gs(); g.ai = { on: false, at: 0 }; N.save(); paint(); N.toast("AI check is off", "ok"); };

  A["gmail-sync"] = function () { sync(); };
  A["gmail-rescan"] = function () { var g = gs(); g.seen = {}; g.lastSync = 0; N.save(); sync(); };
  A["gmail-disconnect"] = disconnect;

  A["trk-advice"] = async function () {
    if (adviceBusy) return;
    adviceBusy = true; paint();
    try {
      var text = await NXAI.run("job_advice", {
        funnel: N.funnel(), recent: N.recentApps(), profile: N.profileBrief ? N.profileBrief() : null,
        solved: { total: N.solvedTotal(), byTopic: N.solveStats().byTopic }
      });
      S().ai.history.unshift({ kind: "job", date: new Date().toISOString(), text: text });
      S().ai.history = S().ai.history.slice(0, 30);
      N.save();
      adviceHtml = '<div class="card review-box" style="margin-bottom:14px"><div class="review-head"><span class="badge b-accent">' + icon("sparkles", 11) + ' Job-search advice</span>' +
        '<button class="btn btn-sm btn-ghost right" data-action="trk-advice-hide">Dismiss</button></div><div class="md-body">' + N.mdToHtml(text) + "</div></div>";
    } catch (e) {
      adviceHtml = '<div class="auth-err show" style="margin-bottom:14px">' + esc(e.message) + "</div>";
    }
    adviceBusy = false; paint();
  };
  A["trk-advice-hide"] = function () { adviceHtml = ""; paint(); };

  A["trk-col-toggle"] = function (D) { openStage[D.col] = !openStage[D.col]; paint(); };

  /* Drag a card to reorder it within its own stage - the stage must already be open (see
     trk-col-toggle). Changing STAGE happens through the drawer's Stage buttons or an
     automatic Gmail match, never by dragging a card into a different section. */
  function reorder(id, targetId, before) {
    var arr = jobs(), from = arr.findIndex(function (j) { return j.id === id; });
    if (from < 0) return;
    var item = arr.splice(from, 1)[0];
    var to = arr.findIndex(function (j) { return j.id === targetId; });
    arr.splice(to < 0 ? arr.length : (before ? to : to + 1), 0, item);
  }
  function clearDragMarks() { document.querySelectorAll(".tcard.drag-before,.tcard.drag-after").forEach(function (n) { n.classList.remove("drag-before", "drag-after"); }); }
  var dragId = null;
  document.addEventListener("dragstart", function (e) {
    var c = e.target.closest && e.target.closest(".tcard");
    var body = c && c.closest(".col-body");
    if (!c || !body || body.hidden) { if (c) e.preventDefault(); return; }
    dragId = c.dataset.id; c.classList.add("dragging");
    try { e.dataTransfer.setData("text/plain", dragId); e.dataTransfer.effectAllowed = "move"; } catch (x) {}
  });
  document.addEventListener("dragend", function (e) {
    var c = e.target.closest && e.target.closest(".tcard"); if (c) c.classList.remove("dragging");
    clearDragMarks(); dragId = null;
  });
  document.addEventListener("dragover", function (e) {
    if (!dragId) return;
    var over = e.target.closest && e.target.closest(".tcard");
    if (!over || over.dataset.id === dragId) return;
    var dragEl = document.querySelector('.tcard[data-id="' + dragId + '"]');
    if (!dragEl || dragEl.parentElement !== over.parentElement) return;      // only within the same open stage
    e.preventDefault();
    var before = e.clientY < over.getBoundingClientRect().top + over.getBoundingClientRect().height / 2;
    if (!over.classList.contains(before ? "drag-before" : "drag-after")) clearDragMarks();
    over.classList.toggle("drag-before", before);
    over.classList.toggle("drag-after", !before);
  });
  document.addEventListener("drop", function (e) {
    if (!dragId) return;
    var over = e.target.closest && e.target.closest(".tcard");
    var dragEl = document.querySelector('.tcard[data-id="' + dragId + '"]');
    var id = dragId; dragId = null;
    if (!over || !dragEl || over === dragEl || dragEl.parentElement !== over.parentElement) { clearDragMarks(); return; }
    e.preventDefault();
    reorder(id, over.dataset.id, over.classList.contains("drag-before"));
    clearDragMarks(); touch();
  });

  /* ================= "Did you apply?" ================= */
  function pending() { var s = S(); if (!Array.isArray(s.pendingApply)) s.pendingApply = []; return s.pendingApply; }

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[data-action="feed-open"]');
    if (!a) return;
    var j = S().jobfeed.cache.find(function (x) { return x.id === a.dataset.id; });
    if (!j) return;
    var row = jobs().find(function (x) { return x.jobId === j.id; });
    if (row && row.pipeline !== "saved") return;                                   // already applied
    var p = pending();
    if (!p.some(function (x) { return x.id === j.id; })) {
      p.push({ id: j.id, title: j.title, company: j.company || j.srcLabel || "", url: j.url, loc: j.loc || "", sal: j.salary || "", src: j.srcLabel || "", ts: Date.now(), snooze: 0 });
      if (p.length > 10) p.shift();
      N.save();
    }
  }, true);

  function promptEl() {
    var el = document.getElementById("applyPrompt");
    if (!el) { el = document.createElement("div"); el.id = "applyPrompt"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    return el;
  }
  function showPrompt() {
    var now = Date.now();
    var due = pending().filter(function (p) { return now - p.ts > 6000 && now > (p.snooze || 0) && now - p.ts < 3 * 864e5; });
    var el = promptEl();
    if (!due.length || document.hidden) { el.innerHTML = ""; el.classList.remove("show"); return; }
    el.innerHTML = '<div class="ap-head"><span class="ap-ico">' + icon("send", 16) + '</span><div><div class="ap-title">Did you apply?</div><div class="faint" style="font-size:12px">Tell Nexus and it goes on your board with today\'s date.</div></div>' +
      '<button class="icon-btn" data-action="pend-later" aria-label="Ask me later" title="Ask me later">' + icon("x", 13) + '</button></div>' +
      '<div class="ap-list">' + due.slice(0, 4).map(function (p) {
        return '<div class="ap-row"><div class="ap-txt"><strong>' + esc(p.title) + '</strong><span>' + esc(p.company) + '</span></div>' +
          '<button class="btn btn-sm btn-primary" data-action="pend-yes" data-id="' + esc(p.id) + '">I applied</button>' +
          '<button class="btn btn-sm btn-ghost" data-action="pend-no" data-id="' + esc(p.id) + '">No</button></div>'; }).join("") +
      (due.length > 4 ? '<div class="faint" style="font-size:11.5px;padding:4px 2px">+' + (due.length - 4) + " more waiting</div>" : "") + "</div>";
    el.classList.add("show");
  }
  function dropPending(id) { var s = S(); s.pendingApply = pending().filter(function (p) { return p.id !== id; }); N.save(); showPrompt(); }
  A["pend-yes"] = function (D) {
    var p = pending().find(function (x) { return x.id === D.id; }); if (!p) return;
    var d = N.iso(), row = jobs().find(function (x) { return x.jobId === p.id; });
    if (row) { if (row.pipeline === "saved") T.setPipeline(row, "applied", { date: d, src: "manual" }); }
    else {
      var j = T.normalizeJob({ id: N.uid(), co: p.company || "Unknown", role: p.title, dt: d, sal: p.sal, url: p.url, source: p.src || "Job Feed", loc: p.loc, jobId: p.id, pipeline: "applied", events: [] }, d);
      j.events = [{ d: d, t: "applied", src: "manual" }];
      jobs().unshift(j);
    }
    S().jobfeed.tracked[p.id] = true; S().jobfeed.seen[p.id] = true;
    N.toast("Logged: " + p.title, "ok");
    dropPending(p.id);
    if (N.current === "jobs") paint(); else if (N.current === "jobfeed") N.rerender();
  };
  A["pend-no"] = function (D) { dropPending(D.id); };
  A["pend-later"] = function () {
    var until = Date.now() + 30 * 60 * 1000;
    pending().forEach(function (p) { p.snooze = until; });
    N.save(); showPrompt();
  };
  /* ask when the user comes back to this tab, and once shortly after the portal loads */
  document.addEventListener("visibilitychange", function () { if (!document.hidden) setTimeout(showPrompt, 700); });
  window.addEventListener("focus", function () { setTimeout(showPrompt, 700); });

  /* the feed's "Track" button saves a job (not applied yet) - give it the pipeline fields */
  N.onStart.push(function () {
    normalizeAll(); N.save(); startTimer(); setTimeout(showPrompt, 2200);
    /* preload Google's script so the consent popup opens inside the user's click, not after a download */
    if (gclient()) loadScript("https://accounts.google.com/gsi/client").catch(function () {});
  });
})();
