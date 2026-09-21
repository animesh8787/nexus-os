/* ============================================================
   Nexus OS — Job Tracker: pipeline board, dated timelines, the
   "did you apply?" prompt, and read-only Gmail sync.

   Part 1 (pure, exported as window.NXTracker, unit-tested in Node):
     classifyEmail   an email -> { type, company, role }  or null
     ingestEmails    matches emails to applications, adds dated events,
                     moves the pipeline forward, creates rows when needed
     funnel          the numbers the AI advice is grounded in
   Part 2: the portal UI (only when window.NEXUS exists).

   Data model per application (S.jobs[i]):
     { id, co, role, dt(applied date), pipeline, status/stage (legacy, kept in
       sync for Analytics), events:[{d,t,src,id?,subj?,note?}], url, sal,
       source, jobId?, notes, auto? }
   ============================================================ */
(function () {
  "use strict";

  /* ================= Part 1: pure logic ================= */
  var ORDER = { saved: 0, applied: 1, assessment: 2, interview: 3, offer: 4 };
  var LABEL = { saved: "Saved", applied: "Applied", assessment: "Assessment", interview: "Interview", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn" };
  var CLOSED = { rejected: 1, withdrawn: 1 };
  var REPLY = { assessment: 1, interview: 1, offer: 1, rejected: 1 };

  function statusOf(p) { return CLOSED[p] ? "rejected" : (p === "saved" || p === "applied") ? "applied" : "response"; }
  var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  function isoOf(ms) { var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function dayNum(iso) { var p = String(iso || "").split("-"); return Math.round(Date.UTC(+p[0], (+p[1] || 1) - 1, +p[2] || 1) / 864e5); }
  var clip = function (v, n) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); };

  /* bring any row (old manual entries, feed "Track" rows) onto the pipeline model */
  function normalizeJob(j, todayIso) {
    if (!j.pipeline) {
      var st = String(j.stage || "").toLowerCase(), p;
      if (j.stage === "Found") p = "saved";
      else if (j.status === "rejected") p = "rejected";
      else if (j.status === "response") {
        p = /offer/.test(st) ? "offer" : /assess|\boa\b|test|coding|challenge/.test(st) ? "assessment" : "interview";
      } else p = "applied";
      j.pipeline = p;
    }
    if (!Array.isArray(j.events)) j.events = [];
    if (!j.events.length) j.events.push({ d: j.dt || todayIso, t: j.pipeline === "saved" ? "saved" : "applied", src: "manual" });
    j.stage = LABEL[j.pipeline];
    j.status = statusOf(j.pipeline);
    return j;
  }

  function setPipeline(j, stage, o) {
    o = o || {};
    var was = j.pipeline, d = o.date || isoOf(Date.now());
    j.pipeline = stage; j.stage = LABEL[stage]; j.status = statusOf(stage);
    if (stage === "applied" && was === "saved") j.dt = d;
    j.events.push({ d: d, t: stage, src: o.src || "manual", note: o.note || "" });
    return j;
  }

  /* ---------- email classification ---------- */
  var ATS = /(greenhouse-mail\.io|greenhouse\.io|lever\.co|ashbyhq\.com|myworkday(?:jobs)?\.com|workday\.com|workable\.com|smartrecruiters\.com|icims\.com|jobvite\.com|successfactors\.(?:com|eu)|taleo\.net|breezy\.hr|recruitee\.com|bamboohr\.com|zohorecruit\.(?:com|in)|jazzhr\.com|applytojob\.com|teamtailor\.com|pinpointhq\.com|indeed\.com|linkedin\.com|naukri\.com|instahyre\.com|wellfound\.com|hackerrank\.com|codility\.com|codesignal\.com|hackerearth\.com|hirevue\.com)$/i;
  var PLATFORM_NAME = /^(no[- ]?reply|noreply|do[- ]?not[- ]?reply|donotreply|notifications?|workday|greenhouse|lever|ashby|linkedin|indeed|hackerrank|naukri|instahyre|wellfound|codility|codesignal|hackerearth|smartrecruiters|icims|jobvite|taleo|successfactors|bamboohr|workable|recruiting|careers|jobs|hr|team|talent|hiring|mail|support|info|admin|no reply|noreply)$/i;

  var RX = {
    offer: /(?:pleased|happy|excited|thrilled|delighted)\s+to\s+(?:offer|extend)|offer\s+letter|job\s+offer|(?:extend|extending)\s+(?:you\s+)?an\s+offer|offer\s+of\s+employment|formal\s+offer/,
    rejected: /unfortunately[^.]{0,90}(?:not|no\s+longer|unable|cannot|can\'t|decided|other\s+candidates|won\'t)|regret\s+to\s+inform|not\s+(?:be\s+)?(?:moving|proceeding|going)\s+forward|will\s+not\s+be\s+(?:moving|proceeding)|decided\s+(?:not\s+)?to\s+(?:move|proceed|continue|pursue)|(?:pursue|move\s+forward\s+with)\s+other\s+candidates|not\s+(?:been\s+)?selected|position\s+has\s+been\s+filled|no\s+longer\s+(?:under\s+)?consider|after\s+careful\s+consideration|chosen\s+to\s+(?:move|proceed)|other\s+candidates\s+whose/,
    assessment: /online\s+assessment|coding\s+(?:challenge|assessment|test|round)|take[- ]?home|hackerrank|codility|codesignal|hackerearth|assessment\s+(?:link|invitation|invite)|(?:complete|take)\s+(?:the|this|your|a)\s+(?:assessment|challenge|test)|technical\s+(?:test|assessment)|aptitude\s+test/,
    interview: /(?:schedule|invit\w*|book|set\s+up|arrange|confirm)[^.]{0,40}(?:interview|call|chat|conversation|screen)|interview\s+(?:invitation|invite|schedule|request|confirmation|with|round)|phone\s+screen|(?:technical|hr|final|onsite|on-site|virtual|video)\s+(?:screen|interview|round)|meet\s+(?:with\s+)?(?:our|the)\s+team|your\s+availability|next\s+round/,
    received: /thank(?:s|\s+you)\s+for\s+(?:applying|your\s+(?:application|interest)|submitting)|application\s+(?:has\s+been\s+)?(?:received|submitted)|(?:we(?:'ve|\s+have)|we)\s+(?:received|got)\s+your\s+application|successfully\s+(?:applied|submitted)|thanks\s+for\s+applying|application\s+confirmation|your\s+application\s+(?:to|for|with|was\s+sent)|you\s+applied\s+(?:to|for)/
  };
  var INVITE = /(?:we(?:'d|\s+would)\s+like\s+to|would\s+like\s+to|invite\s+you\s+to|please\s+(?:schedule|book|select|choose)|you(?:'re|\s+are)\s+invited\s+to)[^.]{0,60}/;
  var INVITE_INTERVIEW = /(?:interview|call|chat|conversation|screen)/, INVITE_ASSESS = /(?:assessment|challenge|test|hackerrank|codility|codesignal)/;
  var PLATFORM_ANY = /\b(?:hackerrank|codility|codesignal|hackerearth|greenhouse|lever|ashby|workday|linkedin|indeed|naukri|instahyre|wellfound|smartrecruiters|icims|jobvite|taleo|successfactors|bamboohr|workable|hirevue)\b/i;
  var NOISE = /job\s+alerts?|jobs?\s+(?:you\s+may|for\s+you|recommended)|recommended\s+jobs?|new\s+jobs?\s+(?:for|in|matching)|newsletter|digest|webinar|weekly|\bwe(?:'re| are)\s+hiring\b|top\s+\d+\s+jobs|jobs\s+similar/i;

  function parseFrom(from) {
    var s = String(from || ""), m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    var name = m ? m[1].trim() : "", addr = (m ? m[2] : s).trim().toLowerCase();
    var domain = (addr.split("@")[1] || "").replace(/[>\s].*$/, "");
    return { name: name, addr: addr, domain: domain };
  }
  function isAtsDomain(domain) { return ATS.test(domain || ""); }

  function cleanDisplayName(name) {
    var n = String(name || "").replace(/\s+via\s+.+$/i, "").replace(/[|]/g, " ");
    n = n.replace(/\b(?:recruiting|recruitment|recruiters?|careers?|talent(?:\s+acquisition)?|acquisition|hiring|team|hr|human\s+resources|jobs?|notifications?|applications?|candidates?|campus|university|people|ops|no[- ]?reply|noreply|donotreply)\b/gi, " ")
      .replace(/[<>"()]/g, " ").replace(/\s+/g, " ").trim();
    if (!n || n.length < 2 || n.length > 40 || PLATFORM_NAME.test(n) || PLATFORM_ANY.test(n)) return "";
    return n;
  }

  var NAMECH = "[A-Za-z0-9&.'’ +\\-]";
  var COMPANY_SUBJECT = [
    new RegExp("\\b(?:applying|applied|application)\\s+(?:to|with|at)\\s+(?:the\\s+)?([A-Z0-9]" + NAMECH + "{1,40}?)(?=\\s+(?:for|as|team|has|is|was|-|–|—|\\|)|[!.,:]|$)"),
    new RegExp("\\bat\\s+([A-Z]" + NAMECH + "{1,40}?)(?=\\s+(?:has|is|was|-|–|—|\\|)|[!.,:]|$)")
  ];
  var COMPANY_SUBJECT_LOOSE = [
    new RegExp("(?:challenge|assessment|test|invitation|interview)\\s+(?:from|for|by|with)\\s+([A-Z]" + NAMECH + "{1,40}?)(?=[!.,:]|$|\\s+[-–—|])"),
    new RegExp("^(?:your\\s+)?([A-Z]" + NAMECH + "{1,30}?)\\s+(?:online\\s+assessment|application|interview|assessment|coding)\\b"),
    new RegExp("^([A-Z]" + NAMECH + "{1,30}?)\\s*[-–—|:]\\s*(?:application|thank|thanks|your|interview|assessment|next steps)", "i")
  ];

  var GENERIC_WORDS = /^(your|the|our|this|a|an|update|application|thank|thanks|next|re|fwd)$/i;
  function tidyCompany(c) {
    c = String(c || "").replace(/[.!,:]+$/, "").replace(/\s+(?:inc|llc|ltd|corp)\.?$/i, "").trim();
    return c && c.length >= 2 && c.length <= 40 && !GENERIC_WORDS.test(c) && !PLATFORM_NAME.test(c) ? c : "";
  }

  function extractCompany(fromObj, subject) {
    var sub = String(subject || ""), i, m, c;
    for (i = 0; i < COMPANY_SUBJECT.length; i++) { m = sub.match(COMPANY_SUBJECT[i]); if (m && (c = tidyCompany(m[1]))) return c; }
    c = tidyCompany(cleanDisplayName(fromObj.name));
    if (c) return c;
    for (i = 0; i < COMPANY_SUBJECT_LOOSE.length; i++) { m = sub.match(COMPANY_SUBJECT_LOOSE[i]); if (m && (c = tidyCompany(m[1]))) return c; }
    if (fromObj.domain && !isAtsDomain(fromObj.domain) && !/(gmail|yahoo|outlook|hotmail|proton|icloud)\./i.test(fromObj.domain)) {
      var parts = fromObj.domain.split(".");
      var core = parts.length > 2 && /^(co|com|org|net|ac)$/.test(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2];
      if (core && core.length > 1 && !PLATFORM_NAME.test(core)) return core.charAt(0).toUpperCase() + core.slice(1);
    }
    return "";
  }

  var ROLE_WORDS = "Engineer|Developer|Intern|Scientist|Analyst|Researcher|Architect|SDE|SWE|Programmer|Associate|Consultant|Specialist|Trainee|Designer|Manager|Lead";
  var ROLE_PATTERNS = [
    new RegExp("\\b(?:for|as)\\s+(?:the\\s+|an?\\s+)?([A-Z][A-Za-z0-9/&+.,'’ \\-]{2,60}?)(?=\\s+(?:at|position|role|with|has|is|was|-|–|—|\\||\\()|[!.:]|$)"),
    new RegExp("(?:application(?:\\s+received)?|applying|interview|invitation|update|assessment)\\s*[:\\-–—]\\s*([A-Z][A-Za-z0-9/&+.,'’ \\-]{2,60}?)(?=\\s+at\\s+|\\s*[|(]|$)"),
    new RegExp("[-–—]\\s*([A-Z][A-Za-z0-9/&+.,' ]{1,50}(?:" + ROLE_WORDS + ")[A-Za-z0-9/&+.,' ]{0,20})\\s*$")
  ];
  function extractRole(subject, company) {
    var sub = String(subject || ""), i, m, r;
    for (i = 0; i < ROLE_PATTERNS.length; i++) {
      m = sub.match(ROLE_PATTERNS[i]);
      if (!m) continue;
      r = m[1].replace(/[.!,:\s]+$/, "").trim();
      if (r.length >= 3 && r.length <= 70 && new RegExp("\\b(?:" + ROLE_WORDS + "|Software|Data|ML|AI|Backend|Frontend|Full|Machine|Product|Research)\\b", "i").test(r) &&
          (!company || r.toLowerCase() !== company.toLowerCase())) return r;
    }
    return "";
  }

  /* -> { type, company, role, d, id, subj } or null (not a job email) */
  function classifyEmail(m) {
    var from = parseFrom(m.from), subject = String(m.subject || ""), snippet = String(m.snippet || "");
    if (NOISE.test(subject)) return null;
    var subL = subject.toLowerCase(), snipL = snippet.toLowerCase(), fullL = subL + " " + snipL, type = null;
    /* Strongest signal wins. Offer and rejection are trusted anywhere in the mail. Assessment and
       interview must be in the subject, or be an explicit invitation in the body - confirmations
       often say "we may contact you to schedule an interview", which is not an interview. "Received"
       is the weakest signal and is only the fallback. */
    var inv = snipL.match(INVITE), invTxt = inv ? inv[0] : "";
    if (RX.offer.test(fullL)) type = "offer";
    else if (RX.rejected.test(fullL)) type = "rejected";
    else if (RX.assessment.test(subL) || (invTxt && INVITE_ASSESS.test(invTxt))) type = "assessment";
    else if (RX.interview.test(subL) || (invTxt && INVITE_INTERVIEW.test(invTxt))) type = "interview";
    else if (RX.received.test(fullL)) type = "received";
    if (!type) return null;
    /* an unfamiliar sender must say something clearly job-related in the subject itself */
    if (!isAtsDomain(from.domain) && !RX[type].test(subL) && !/application|interview|assessment|offer|candidate/.test(subL)) return null;
    var company = extractCompany(from, subject);
    if (!company) return null;
    return { type: type, company: company, role: extractRole(subject, company), d: isoOf(+m.date || Date.now()), ts: +m.date || 0, id: m.id || "", subj: clip(subject, 100) };
  }

  /* ---------- matching ---------- */
  var CO_SUFFIX = /\b(inc|llc|ltd|limited|pvt|private|corp|corporation|co|company|technologies|technology|tech|labs?|software|systems|solutions|group|india|global|holdings)\b/g;
  function normCo(s) { return String(s || "").toLowerCase().replace(/&/g, " and ").replace(CO_SUFFIX, " ").replace(/[^a-z0-9]+/g, " ").trim(); }
  function sameCompany(a, b) {
    var x = normCo(a), y = normCo(b);
    if (!x || !y) return false;
    if (x === y) return true;
    var s = x.length < y.length ? x : y, l = x.length < y.length ? y : x;
    return s.length >= 4 && (" " + l + " ").indexOf(" " + s + " ") >= 0;
  }
  function roleOverlap(a, b) {
    var t = function (s) { return String(s || "").toLowerCase().split(/[^a-z0-9+#]+/).filter(function (w) { return w.length > 1 && !/^(and|the|of|for|at|i|ii|iii)$/.test(w); }); };
    var x = t(a), y = t(b);
    if (!x.length || !y.length) return 0;
    var hit = x.filter(function (w) { return y.indexOf(w) >= 0; }).length;
    return hit / Math.min(x.length, y.length);
  }
  var lastTouch = function (j) { var e = j.events || []; return e.length ? e[e.length - 1].d : j.dt || ""; };

  function findMatch(jobs, c) {
    var cand = jobs.filter(function (j) { return sameCompany(j.co, c.company); });
    if (!cand.length) return null;
    if (c.type === "received") {
      if (c.role) {
        var best = null, bo = 0;
        cand.forEach(function (j) { var o = roleOverlap(j.role, c.role); if (o > bo) { bo = o; best = j; } });
        return bo >= 0.5 ? best : null;                  // same company, different role -> a new application
      }
      var near = cand.filter(function (j) { return j.pipeline === "saved" || Math.abs(dayNum(j.dt) - dayNum(c.d)) <= 3; });
      return near.length ? near[near.length - 1] : null;
    }
    var pick = null, po = 0;
    if (c.role) cand.forEach(function (j) { var o = roleOverlap(j.role, c.role); if (o > po) { po = o; pick = j; } });
    if (pick && po >= 0.5) return pick;
    var open = cand.filter(function (j) { return !CLOSED[j.pipeline]; });
    var pool = open.length ? open : cand;
    pool.sort(function (a, b) { return lastTouch(a) < lastTouch(b) ? -1 : 1; });
    return pool[pool.length - 1];
  }

  /* Apply emails oldest-first so later mail overrides earlier.
     Rules: a confirmation never moves a row backwards; a rejection always closes it;
     assessment/interview/offer only move it forward - unless the row was closed
     earlier and this mail is dated after that closure (a reopened process). */
  function closedOn(j) {
    var d = "";
    (j.events || []).forEach(function (e) { if (CLOSED[e.t] && e.d > d) d = e.d; });
    return d;
  }
  function ingestEmails(jobs, classified, newId) {
    var created = [], touched = [], events = 0;
    var list = classified.slice().sort(function (a, b) { return a.ts - b.ts; });
    list.forEach(function (c) {
      var j = findMatch(jobs, c), fresh = false;
      if (!j) {
        j = normalizeJob({ id: newId(), co: c.company, role: c.role || "Role not stated", dt: c.d, sal: "", url: "", source: "Gmail", pipeline: "applied", auto: true, events: [] }, c.d);
        j.events = [{ d: c.d, t: "applied", src: "gmail", note: c.type === "received" ? "" : "Applied date unknown - first seen in your inbox" }];
        jobs.unshift(j); created.push(j); fresh = true;
      }
      if (c.id && j.events.some(function (e) { return e.id === c.id; })) return;         // this mail is already recorded
      var reopenedAfter = closedOn(j);
      var ev = { d: c.d, t: c.type, src: "gmail", id: c.id, subj: c.subj };
      if (c.ai) ev.ai = 1;
      j.events.push(ev);
      events++;
      if (c.role && (!j.role || j.role === "Role not stated")) j.role = c.role;

      var was = j.pipeline, next = was;
      if (c.type === "received") {
        if (was === "saved") { next = "applied"; j.dt = c.d; }
      } else if (c.type === "rejected") {
        next = "rejected";
      } else if (!CLOSED[was]) {
        if (ORDER[c.type] > ORDER[was]) next = c.type;
      } else if (c.d > reopenedAfter) {
        next = c.type;
      }
      if (next !== was) { j.pipeline = next; j.stage = LABEL[next]; j.status = statusOf(next); }
      if (touched.indexOf(j) < 0) touched.push(j);
    });
    return { added: created.length, updated: touched.length - created.filter(function (j) { return touched.indexOf(j) >= 0; }).length, events: events, touched: touched };
  }

  /* ---------- funnel: the numbers the advice is built on ---------- */
  function funnel(jobs, todayIso) {
    var applied = jobs.filter(function (j) { return j.pipeline !== "saved"; });
    /* applied = every application sent; stages = where they are now (kept apart so they can't collide) */
    var f = { applied: applied.length, saved: jobs.length - applied.length, stages: { applied: 0, assessment: 0, interview: 0, offer: 0, rejected: 0, withdrawn: 0 }, waiting: 0, stale21d: 0 };
    var replied = 0, days = [], by = {};
    applied.forEach(function (j) {
      if (f.stages[j.pipeline] != null) f.stages[j.pipeline]++;
      var first = (j.events || []).filter(function (e) { return REPLY[e.t]; }).sort(function (a, b) { return a.d < b.d ? -1 : 1; })[0];
      var src = j.source || "Direct";
      by[src] = by[src] || { applied: 0, replied: 0 };
      by[src].applied++;
      if (first) {
        replied++; by[src].replied++;
        var dd = dayNum(first.d) - dayNum(j.dt);
        if (dd >= 0 && dd < 200) days.push(dd);
      } else if (!CLOSED[j.pipeline]) {
        f.waiting++;
        if (todayIso && dayNum(todayIso) - dayNum(j.dt) >= 21) f.stale21d++;
      }
    });
    f.responseRate = f.applied ? Math.round(replied / f.applied * 100) : 0;
    days.sort(function (a, b) { return a - b; });
    f.medianDaysToReply = days.length ? days[Math.floor(days.length / 2)] : null;
    f.bySource = Object.keys(by).sort(function (a, b) { return by[b].applied - by[a].applied; }).slice(0, 5)
      .reduce(function (o, k) { o[k] = by[k]; return o; }, {});
    return f;
  }

  /* ---------- inbox review: correct what the classifier did ---------- */
  var MAIL_TYPES = ["received", "assessment", "interview", "offer", "rejected"];
  var isMailEvt = function (e) { return e && e.src === "gmail" && e.id; };

  /* Rebuild a row's stage by replaying its timeline in date order, using the same rules as ingestEmails.
     Used only after the user corrects an email, so a wrong stage set by a wrong email is undone. */
  function replay(j) {
    var evs = (j.events || []).map(function (e, i) { return { e: e, i: i }; })
      .sort(function (a, b) { return a.e.d < b.e.d ? -1 : a.e.d > b.e.d ? 1 : a.i - b.i; });
    var p = evs.length && evs[0].e.t === "saved" ? "saved" : "applied", closedAt = "";
    evs.forEach(function (x) {
      var e = x.e, t = e.t;
      if (t === "note") return;
      if (isMailEvt(e)) {
        if (t === "received") { if (p === "saved") p = "applied"; }
        else if (t === "rejected") p = "rejected";
        else if (!CLOSED[p]) { if (ORDER[t] > ORDER[p]) p = t; }
        else if (e.d > closedAt) p = t;
      } else if (ORDER[t] != null || CLOSED[t]) p = t;
      if (CLOSED[p]) closedAt = e.d;
    });
    j.pipeline = p; j.stage = LABEL[p]; j.status = statusOf(p);
    return j;
  }

  /* An application Nexus created from an email has nothing worth keeping once all its emails are gone. */
  function isEmptyAuto(j) {
    return !!j.auto && !(j.events || []).some(function (e) { return isMailEvt(e) || (e.src === "manual" && e.t !== "applied"); });
  }
  function dropIfEmpty(jobs, j) {
    if (!isEmptyAuto(j)) return false;
    var at = jobs.indexOf(j);
    if (at >= 0) jobs.splice(at, 1);
    return true;
  }

  /* every email-derived entry, newest first: [{job, ev, i}] */
  function mailEvents(jobs) {
    var out = [];
    jobs.forEach(function (j) { (j.events || []).forEach(function (e, i) { if (isMailEvt(e)) out.push({ job: j, ev: e, i: i }); }); });
    return out.sort(function (a, b) { return a.ev.d < b.ev.d ? 1 : a.ev.d > b.ev.d ? -1 : 0; });
  }
  function setMailType(j, i, type) {
    var e = (j.events || [])[i];
    if (!isMailEvt(e) || MAIL_TYPES.indexOf(type) < 0) return false;
    e.t = type; e.ok = true;
    replay(j);
    return true;
  }
  /* remove one email from its application; returns {id, removedJob} so the caller can remember the mail as "not a job email" */
  function dropMail(jobs, j, i) {
    var e = (j.events || [])[i];
    if (!isMailEvt(e)) return null;
    j.events.splice(i, 1);
    var gone = dropIfEmpty(jobs, j);
    if (!gone) replay(j);
    return { id: e.id, removedJob: gone };
  }
  function moveMail(jobs, from, i, to) {
    var e = (from.events || [])[i];
    if (!isMailEvt(e) || !to || to === from) return null;
    from.events.splice(i, 1);
    e.ok = true;
    to.events.push(e);
    replay(to);
    var gone = dropIfEmpty(jobs, from);
    if (!gone) replay(from);
    return { removedJob: gone };
  }
  function unreviewed(jobs) { return mailEvents(jobs).filter(function (x) { return !x.ev.ok; }).length; }

  /* ---------- optional AI pass for emails the rules could not place (the user must switch it on) ---------- */
  var JOBISH = /application|applied|applicant|candidate|candidacy|interview|assessment|offer|position|hiring|recruit|opportunity|shortlist|next\s+steps|your\s+profile/i;
  function needsAI(m) {
    var subject = String(m.subject || "");
    if (NOISE.test(subject) || classifyEmail(m)) return false;
    var f = parseFrom(m.from);
    return isAtsDomain(f.domain) || JOBISH.test(subject);
  }
  /* what would be sent: sender NAME and DOMAIN (never the address), subject, Gmail's snippet - nothing else */
  function aiPayload(msgs) {
    return { emails: msgs.map(function (m) {
      var f = parseFrom(m.from);
      return { from: clip((f.name ? f.name + " " : "") + "(" + f.domain + ")", 90), subject: clip(m.subject, 140), snippet: clip(m.snippet, 240) };
    }) };
  }
  /* turn the model's answer into classified mails; anything malformed or implausible is dropped */
  function fromAI(results, msgs) {
    var out = [], seen = {};
    (Array.isArray(results) ? results : []).forEach(function (r) {
      if (!r || typeof r !== "object") return;
      var i = +r.i, m = msgs[i];
      if (!m || seen[i] || MAIL_TYPES.indexOf(r.type) < 0) return;
      var company = tidyCompany(clip(r.company, 60));
      if (company.length < 2 || PLATFORM_ANY.test(company) || PLATFORM_NAME.test(company)) return;
      seen[i] = 1;
      out.push({ type: r.type, company: company, role: clip(r.role, 80), d: isoOf(+m.date || Date.now()), ts: +m.date || 0, id: m.id || "", subj: clip(m.subject, 100), ai: true });
    });
    return out;
  }

  window.NXTracker = {
    ORDER: ORDER, LABEL: LABEL, CLOSED: CLOSED, statusOf: statusOf, isoOf: isoOf, dayNum: dayNum,
    normalizeJob: normalizeJob, setPipeline: setPipeline, classifyEmail: classifyEmail, parseFrom: parseFrom,
    extractCompany: extractCompany, extractRole: extractRole, sameCompany: sameCompany, normCo: normCo,
    findMatch: findMatch, ingestEmails: ingestEmails, funnel: funnel,
    MAIL_TYPES: MAIL_TYPES, replay: replay, mailEvents: mailEvents, setMailType: setMailType, dropMail: dropMail, moveMail: moveMail, unreviewed: unreviewed,
    needsAI: needsAI, aiPayload: aiPayload, fromAI: fromAI
  };

  if (!window.NEXUS) return;
  /* ================= Part 2: portal UI (see tracker-ui.js) ================= */
  window.NXTracker._ready = true;
})();
