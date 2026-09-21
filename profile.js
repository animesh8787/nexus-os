/* ============================================================
   Nexus OS — Profile: resume parsing + editable preferences that drive
   the Job Feed.

   Flow:  file / pasted text -> extractLocal() (always, instant, offline)
          -> optionally improved by the AI -> a DRAFT the user reviews
          -> "Apply" merges it into S.profile -> filtersFromProfile()
          rewrites the feed's matching rules.

   Pure helpers are exported on window.NXProfile so they can be tested
   without the portal. The UI part only runs when window.NEXUS exists.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- pure: skill dictionary ---------- */
  var SKILLS = {
    "python": ["python", "python3"], "java": ["java"], "javascript": ["javascript", "ecmascript", "es6"],
    "typescript": ["typescript"], "c++": ["c++", "cpp"], "c#": ["c#", "csharp"], "golang": ["golang"],
    "rust": ["rust"], "kotlin": ["kotlin"], "swift": ["swift"], "php": ["php"], "ruby": ["ruby"], "scala": ["scala"],
    "sql": ["sql"], "bash": ["bash", "shell scripting"], "matlab": ["matlab"], "dart": ["dart"],
    "html": ["html", "html5"], "css": ["css", "css3"],
    "react": ["react", "react.js", "reactjs"], "next.js": ["next.js", "nextjs"], "vue": ["vue", "vue.js", "vuejs"],
    "angular": ["angular", "angularjs"], "node.js": ["node.js", "nodejs", "node js"], "express": ["express.js", "expressjs", "express js"],
    "django": ["django"], "flask": ["flask"], "fastapi": ["fastapi"], "spring boot": ["spring boot", "springboot", "spring framework"],
    "tailwind": ["tailwind", "tailwindcss"], "redux": ["redux"], "graphql": ["graphql"],
    "rest apis": ["rest api", "rest apis", "restful", "restful apis"], "websockets": ["websocket", "websockets"],
    "machine learning": ["machine learning", "ml"], "deep learning": ["deep learning"],
    "nlp": ["nlp", "natural language processing"], "computer vision": ["computer vision", "opencv"],
    "pytorch": ["pytorch"], "tensorflow": ["tensorflow"], "keras": ["keras"], "scikit-learn": ["scikit-learn", "sklearn", "scikit learn"],
    "pandas": ["pandas"], "numpy": ["numpy"], "llm": ["llm", "llms", "large language model", "large language models"],
    "genai": ["genai", "generative ai", "gen ai"], "langchain": ["langchain"], "rag": ["rag", "retrieval augmented generation", "retrieval-augmented generation"],
    "hugging face": ["hugging face", "huggingface"], "openai": ["openai"], "prompt engineering": ["prompt engineering"],
    "data science": ["data science"], "data analysis": ["data analysis", "data analytics"], "statistics": ["statistics", "statistical modeling"],
    "xgboost": ["xgboost"], "spark": ["spark", "pyspark", "apache spark"], "airflow": ["airflow"], "kafka": ["kafka"],
    "etl": ["etl"], "data engineering": ["data engineering"], "tableau": ["tableau"], "power bi": ["power bi", "powerbi"],
    "postgresql": ["postgresql", "postgres"], "mysql": ["mysql"], "mongodb": ["mongodb"], "redis": ["redis"], "sqlite": ["sqlite"],
    "elasticsearch": ["elasticsearch"], "firebase": ["firebase"], "supabase": ["supabase"], "dynamodb": ["dynamodb"],
    "vector databases": ["vector database", "vector databases", "pinecone", "faiss", "chromadb"],
    "aws": ["aws", "amazon web services"], "gcp": ["gcp", "google cloud"], "azure": ["azure"], "docker": ["docker"],
    "kubernetes": ["kubernetes", "k8s"], "terraform": ["terraform"], "ci/cd": ["ci/cd", "github actions", "jenkins", "gitlab ci"],
    "linux": ["linux"], "git": ["git", "github"], "nginx": ["nginx"],
    "data structures": ["data structures"], "algorithms": ["algorithms", "dsa"], "system design": ["system design"],
    "oop": ["oop", "object oriented", "object-oriented"], "microservices": ["microservices"], "distributed systems": ["distributed systems"],
    "operating systems": ["operating systems"], "android": ["android"], "flutter": ["flutter"], "react native": ["react native"],
    "pytest": ["pytest"], "junit": ["junit"], "selenium": ["selenium"], "unity": ["unity3d", "unity engine"]
  };

  var ALIAS_RX = (function () {
    var out = [];
    Object.keys(SKILLS).forEach(function (canon) {
      var alts = SKILLS[canon].map(function (a) { return a.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&"); });
      out.push({ canon: canon, rx: new RegExp("(?<![a-z0-9+#])(?:" + alts.join("|") + ")(?![a-z0-9+#])", "g") });
    });
    return out;
  })();

  /* role inference: [title, skills that suggest it, min matches] */
  var ROLE_RULES = [
    ["machine learning engineer", ["machine learning", "deep learning", "pytorch", "tensorflow", "scikit-learn", "keras", "nlp", "computer vision"], 2],
    ["ai engineer", ["llm", "genai", "langchain", "rag", "openai", "prompt engineering", "hugging face"], 1],
    ["data scientist", ["data science", "pandas", "statistics", "scikit-learn", "data analysis", "xgboost"], 2],
    ["data engineer", ["spark", "airflow", "kafka", "etl", "data engineering", "sql"], 2],
    ["backend engineer", ["node.js", "express", "django", "flask", "fastapi", "spring boot", "postgresql", "mongodb", "rest apis", "java", "golang", "microservices"], 2],
    ["full stack developer", ["react", "node.js", "javascript", "typescript", "mongodb", "html", "css", "next.js"], 3],
    ["frontend engineer", ["react", "vue", "angular", "typescript", "css", "next.js", "tailwind", "redux"], 3],
    ["devops engineer", ["docker", "kubernetes", "terraform", "aws", "ci/cd", "linux"], 3],
    ["android developer", ["android", "kotlin", "flutter", "react native"], 1]
  ];

  var CITIES = ["bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "delhi", "gurgaon", "gurugram", "noida", "chennai", "kolkata",
    "ahmedabad", "india", "san francisco", "new york", "london", "singapore", "berlin", "toronto", "dubai", "remote"];

  var TYPE_TERMS = {
    "internship": ["intern", "internship"],
    "new-grad": ["new grad", "new graduate", "graduate", "university", "campus", "entry level", "entry-level", "junior", "associate", "trainee", "fresher", "early career"],
    "contract": ["contract", "contractor"],
    "full-time": []
  };
  var WEIGHT = { 1: 0.7, 2: 1, 3: 1.4 };
  var SENIOR_TERMS = ["senior", "sr ", "sr.", "staff ", " lead", "lead ", "principal", "architect", "10+ years", "8+ years"];

  var uniq = function (a) { var s = {}, o = []; a.forEach(function (x) { var k = String(x).toLowerCase(); if (x && !s[k]) { s[k] = 1; o.push(x); } }); return o; };
  var clip = function (v, n) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); };
  var clampW = function (w) { w = Math.round(+w || 1); return w < 1 ? 1 : w > 3 ? 3 : w; };

  function blank() {
    return {
      name: "", headline: "", summary: "", level: "student", years: 0,
      skills: [], roles: [], jobTypes: ["internship", "new-grad"],
      locations: [], remote: true, indiaOnly: false, education: [], links: {},
      resumeName: "", resumeText: "", parsedAt: 0, source: "", draft: null,
      autoFeed: true, feedDirty: false
    };
  }

  /* ---------- pure: local extraction (no network, no AI) ---------- */
  function extractLocal(text, now) {
    var raw = String(text || "").replace(/\r/g, "");
    var low = raw.toLowerCase();
    var year = (now instanceof Date ? now : new Date()).getFullYear();

    var skills = [];
    ALIAS_RX.forEach(function (a) {
      a.rx.lastIndex = 0;
      var n = (low.match(a.rx) || []).length;
      if (n) skills.push({ n: a.canon, w: n >= 4 ? 3 : n >= 2 ? 2 : 1, _c: n });
    });
    skills.sort(function (x, y) { return y._c - x._c; });
    skills = skills.slice(0, 30).map(function (s) { return { n: s.n, w: s.w }; });

    var have = {};
    skills.forEach(function (s) { have[s.n] = 1; });
    var roles = ["software engineer"];
    ROLE_RULES.forEach(function (r) {
      var hits = r[1].filter(function (k) { return have[k]; }).length;
      if (hits >= r[2]) roles.push(r[0]);
    });

    /* experience years: "3 years", "2+ years" */
    var years = 0, m, ry = /(\d{1,2}(?:\.\d)?)\s*\+?\s*years?/g;
    while ((m = ry.exec(low))) { var y = parseFloat(m[1]); if (y > years && y <= 30) years = y; }

    /* graduation: latest 20xx on a line that mentions a degree */
    var grad = 0, isStudent = /pursuing|expected|currently (?:a |an )?(?:student|studying)|final[- ]year|pre-?final|third[- ]year/.test(low);
    raw.split("\n").forEach(function (ln) {
      if (/b\.?tech|b\.?e\b|b\.?sc|bachelor|m\.?tech|m\.?sc|master|mba|ph\.?d|university|college|institute/i.test(ln)) {
        (ln.match(/20\d\d/g) || []).forEach(function (yy) { if (+yy > grad) grad = +yy; });
      }
    });
    if (grad && grad >= year) isStudent = true;

    var level = years >= 5 ? "senior" : years >= 2 ? "mid" : isStudent ? "student" : "entry";
    var jobTypes = level === "student" ? ["internship", "new-grad"] : level === "entry" ? ["new-grad", "full-time"] : ["full-time"];

    var head = low.slice(0, 700);
    var locations = uniq(CITIES.filter(function (c) { return head.indexOf(c) >= 0; })
      .map(function (c) { return c === "bangalore" ? "bengaluru" : c === "gurgaon" ? "gurugram" : c; })).slice(0, 4);

    var name = "";
    var first = raw.split("\n").map(function (l) { return l.trim(); }).filter(Boolean)[0] || "";
    if (/^[A-Za-z][A-Za-z.'\- ]{2,40}$/.test(first) && first.split(/\s+/).length <= 4) name = first;

    var gh = raw.match(/github\.com\/([A-Za-z0-9-]+)/i), li = raw.match(/linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/i);
    var links = { github: gh ? gh[1] : "", linkedin: li ? li[1] : "", portfolio: "" };

    var education = [];
    raw.split("\n").forEach(function (ln) {
      var d = ln.match(/(b\.?\s?tech|b\.?\s?e\.?|b\.?\s?sc|bachelor[^,;\n]{0,30}|m\.?\s?tech|m\.?\s?sc|master[^,;\n]{0,30}|mba|ph\.?d)/i);
      if (d && education.length < 3 && ln.length < 160) {
        var yr = ln.match(/20\d\d/g);
        education.push({ school: clip(ln, 90), degree: clip(d[0], 40), year: yr ? yr[yr.length - 1] : "" });
      }
    });

    return {
      name: name, headline: "", summary: "", level: level, years: years,
      skills: skills, roles: roles.slice(0, 6), jobTypes: jobTypes,
      locations: locations.filter(function (l) { return l !== "remote"; }), remote: true,
      education: education, links: links
    };
  }

  /* ---------- pure: make an AI reply safe to store ---------- */
  function sanitizeAI(ai) {
    ai = ai && typeof ai === "object" ? ai : {};
    var arr = function (v) { return Array.isArray(v) ? v : []; };
    var skills = arr(ai.skills).map(function (s) {
      var n = typeof s === "string" ? s : s && s.name;
      return n ? { n: clip(n, 40).toLowerCase(), w: clampW(s && s.weight) } : null;
    }).filter(Boolean).slice(0, 30);
    var lv = ["student", "entry", "mid", "senior"].indexOf(ai.level) >= 0 ? ai.level : "";
    var types = arr(ai.job_types).filter(function (t) { return TYPE_TERMS[t]; });
    var lk = ai.links && typeof ai.links === "object" ? ai.links : {};
    return {
      name: clip(ai.name, 60), headline: clip(ai.headline, 90), summary: clip(ai.summary, 280),
      years: Math.max(0, Math.min(30, +ai.years_experience || 0)), level: lv,
      skills: skills, roles: uniq(arr(ai.roles).map(function (r) { return clip(r, 50).toLowerCase(); })).slice(0, 6),
      jobTypes: types, locations: uniq(arr(ai.locations).map(function (l) { return clip(l, 40).toLowerCase(); })).slice(0, 5),
      education: arr(ai.education).slice(0, 3).map(function (e) {
        return { school: clip(e && e.school, 90), degree: clip(e && e.degree, 60), year: clip(e && e.year, 8) };
      }),
      links: { github: clip(lk.github, 60), linkedin: clip(lk.linkedin, 80), portfolio: clip(lk.portfolio, 120) }
    };
  }

  /* AI result is primary; anything only the local scan found is kept at low weight */
  function mergeAI(ai, local) {
    var out = {}, k;
    for (k in local) out[k] = local[k];
    var have = {};
    var skills = (ai.skills || []).slice();
    skills.forEach(function (s) { have[s.n] = 1; });
    (local.skills || []).forEach(function (s) { if (!have[s.n]) skills.push({ n: s.n, w: 1 }); });
    out.skills = skills.slice(0, 36);
    ["name", "headline", "summary", "level"].forEach(function (f) { if (ai[f]) out[f] = ai[f]; });
    if (ai.years) out.years = ai.years;
    if (ai.roles && ai.roles.length) out.roles = ai.roles;
    if (ai.jobTypes && ai.jobTypes.length) out.jobTypes = ai.jobTypes;
    if (ai.locations && ai.locations.length) out.locations = ai.locations;
    if (ai.education && ai.education.length) out.education = ai.education;
    var l = {}; ["github", "linkedin", "portfolio"].forEach(function (f) { l[f] = (ai.links && ai.links[f]) || (local.links && local.links[f]) || ""; });
    out.links = l;
    return out;
  }

  /* fold a reviewed draft into the live profile: skills union (keep the higher weight), lists union */
  function applyDraft(profile, d) {
    var p = profile;
    var by = {};
    p.skills.forEach(function (s) { by[s.n.toLowerCase()] = s; });
    (d.skills || []).forEach(function (s) {
      var e = by[s.n.toLowerCase()];
      if (e) e.w = Math.max(e.w, s.w); else { var c = { n: s.n, w: s.w }; p.skills.push(c); by[s.n.toLowerCase()] = c; }
    });
    p.skills.sort(function (a, b) { return b.w - a.w; });
    p.roles = uniq((d.roles || []).concat(p.roles)).slice(0, 8);
    p.locations = uniq((p.locations || []).concat(d.locations || [])).slice(0, 8);
    if (d.jobTypes && d.jobTypes.length) p.jobTypes = uniq(d.jobTypes.concat(p.jobTypes));
    ["name", "headline", "summary", "level"].forEach(function (f) { if (d[f]) p[f] = d[f]; });
    if (d.years != null) p.years = d.years;
    if (d.education && d.education.length) p.education = d.education;
    if (d.links) p.links = Object.assign({}, p.links, d.links);
    p.parsedAt = Date.now();
    return p;
  }

  /* profile -> the Job Feed's matching rules */
  function filtersFromProfile(p, cur) {
    var skills = p.skills.slice().sort(function (a, b) { return b.w - a.w; });
    var weights = {};
    skills.forEach(function (s) { weights[s.n.toLowerCase()] = WEIGHT[s.w] || 1; });
    (p.roles || []).forEach(function (r) { weights[r.toLowerCase()] = weights[r.toLowerCase()] || 1.2; });
    var include = uniq(skills.map(function (s) { return s.n; }).concat(p.roles || []));

    var levels = [];
    (p.jobTypes || []).forEach(function (t) { levels = levels.concat(TYPE_TERMS[t] || []); });

    /* seniority words are excluded by default (aimed at students); a senior profile wants them back */
    var exclude = (cur.exclude || []).slice();
    if (p.level === "senior") exclude = exclude.filter(function (x) { return SENIOR_TERMS.indexOf(x) < 0; });
    var locs = uniq((p.locations || []).concat(p.remote ? ["remote", "anywhere"] : []));
    return Object.assign({}, cur, {
      include: include.length ? include : cur.include, weights: weights,
      levels: levels, exclude: uniq(exclude), locations: locs,
      indiaOnly: !!p.indiaOnly, remoteOk: !!p.remote
    });
  }

  window.NXProfile = {
    SKILLS: SKILLS, TYPE_TERMS: TYPE_TERMS, blank: blank, extractLocal: extractLocal,
    sanitizeAI: sanitizeAI, mergeAI: mergeAI, applyDraft: applyDraft, filtersFromProfile: filtersFromProfile
  };

  /* ============================================================
     UI (portal only)
     ============================================================ */
  var N = window.NEXUS;
  if (!N) return;
  var esc = N.esc, icon = N.icon, S = function () { return N.S; };

  var busy = "", errMsg = "", pasteOpen = false;

  function P() { var s = S(); if (!s.profile) s.profile = blank(); return s.profile; }
  function hasProfile() { var p = S().profile; return !!(p && p.skills && p.skills.length); }

  N.profileBrief = function () {
    var p = S().profile;
    if (!p || !p.skills.length) return null;
    return { level: p.level, years: p.years, skills: p.skills.slice(0, 12).map(function (s) { return s.n; }),
      roles: p.roles.slice(0, 4), jobTypes: p.jobTypes, locations: p.locations.slice(0, 3) };
  };

  /* ---------- text extraction ---------- */
  /* pdf.js and mammoth are loaded with Subresource Integrity (see sri.js): a tampered CDN file won't run */
  function loadScript(url) {
    return NXSRI.script(url).catch(function () { throw new Error("Couldn't load a helper library - check your connection, or paste the text instead."); });
  }
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  async function pdfText(buf) {
    await loadScript(PDFJS + "pdf.min.js");
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      /* a cross-origin worker URL is blocked; load the script text into a same-origin blob instead */
      var w = await NXSRI.text(PDFJS + "pdf.worker.min.js");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([w], { type: "text/javascript" }));
    }
    var pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    var out = [];
    for (var i = 1; i <= Math.min(pdf.numPages, 8); i++) {
      var content = await (await pdf.getPage(i)).getTextContent();
      var line = "", lastY = null;
      content.items.forEach(function (it) {
        var y = it.transform ? it.transform[5] : 0;
        if (lastY !== null && Math.abs(y - lastY) > 2) { out.push(line.trim()); line = ""; }
        line += it.str + (it.hasEOL ? "\n" : " ");
        lastY = y;
      });
      if (line.trim()) out.push(line.trim());
    }
    return out.join("\n");
  }
  async function docxText(buf) {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
    return (await window.mammoth.extractRawText({ arrayBuffer: buf })).value;
  }
  async function fileText(file) {
    var n = file.name.toLowerCase();
    if (file.size > 5 * 1024 * 1024) throw new Error("That file is over 5 MB - export a smaller PDF, or paste the text.");
    if (/\.pdf$/.test(n) || file.type === "application/pdf") return pdfText(await file.arrayBuffer());
    if (/\.docx$/.test(n)) return docxText(await file.arrayBuffer());
    if (/\.(txt|md)$/.test(n) || file.type.indexOf("text/") === 0) return file.text();
    throw new Error("Use a PDF, DOCX or TXT file - or paste your resume text.");
  }

  /* ---------- parse -> draft ---------- */
  async function parse(text, name) {
    text = String(text || "").replace(/ /g, "").trim();
    if (text.length < 120) throw new Error("Couldn't read much text from that. If it's a scanned PDF, paste the text instead.");
    var p = P();
    p.resumeName = name || "pasted text";
    p.resumeText = text.slice(0, 30000);
    var local = extractLocal(text), draft, source = "local";
    if (NXAI.available()) {
      try {
        busy = "Reading your resume with AI...";
        paint();
        draft = mergeAI(sanitizeAI(NXAI.parseJson(await NXAI.run("parse_resume", { text: text }))), local);
        source = "ai";
      } catch (e) {
        errMsg = "AI parsing failed (" + e.message.replace(/\.$/, "") + ") - showing what was found locally.";
      }
    }
    if (!draft) draft = local;
    draft.source = source;
    p.draft = draft;
    p.source = source;
    N.save();
  }

  async function handleFile(file) {
    if (!file || busy) return;
    errMsg = ""; busy = "Reading " + file.name + "...";
    paint();
    try { await parse(await fileText(file), file.name); }
    catch (e) { errMsg = e.message; }
    busy = "";
    paint();
  }

  /* ---------- feed rules ---------- */
  function rescoreCache() {
    var jf = S().jobfeed, f = jf.filters;
    var keep = [];
    jf.cache.forEach(function (j) {
      var sc = N.scoreJob(j, f);
      if (sc >= (f.minScore || 0)) { j.score = sc; keep.push(j); }
    });
    keep.sort(function (a, b) { return (b.isNew - a.isNew) || (b.score - a.score) || (b.posted - a.posted); });
    jf.cache = keep;
  }
  function syncFeed() {
    var p = P();
    if (!p.skills.length) return;
    S().jobfeed.filters = filtersFromProfile(p, S().jobfeed.filters);
    rescoreCache();
    p.feedDirty = true;
  }
  function touch() {
    if (P().autoFeed) syncFeed();
    N.save();
    paint();
  }

  /* ---------- rendering ---------- */
  var LEVELS = [["student", "Student"], ["entry", "Recent grad / entry"], ["mid", "2-5 years"], ["senior", "5+ years"]];
  var TYPES = [["internship", "Internship"], ["new-grad", "New grad / entry"], ["full-time", "Full-time"], ["contract", "Contract"]];

  function chip(label, del, extra) {
    return '<span class="chip">' + (extra || "") + '<span class="chip-t">' + esc(label) + '</span>' +
      (del ? '<button class="chip-x" ' + del + ' aria-label="Remove ' + esc(label) + '">' + icon("x", 11) + '</button>' : "") + "</span>";
  }
  function skillChip(s, i) {
    return '<span class="chip w' + s.w + '"><button class="chip-w" data-action="prof-skill-w" data-i="' + i +
      '" title="Importance: ' + ["", "listed", "used", "core"][s.w] + ' - click to change">' + "●".repeat(s.w) + "</button>" +
      '<span class="chip-t">' + esc(s.n) + '</span><button class="chip-x" data-action="prof-skill-del" data-i="' + i +
      '" aria-label="Remove ' + esc(s.n) + '">' + icon("x", 11) + "</button></span>";
  }

  function draftCard(p) {
    var d = p.draft;
    if (!d) return "";
    return '<div class="card draft-card" style="margin-bottom:14px">' +
      '<div class="card-head"><div><div class="card-title">Review what we found</div>' +
      '<div class="faint" style="font-size:12px">' + (d.source === "ai" ? "Extracted with AI" : "Extracted locally (no AI)") + ' from ' + esc(p.resumeName || "your resume") +
      '. Nothing changes until you apply it.</div></div><span class="badge b-amber">draft</span></div>' +
      '<div class="section-label">Skills (' + d.skills.length + ')</div><div class="chips">' +
      (d.skills.length ? d.skills.map(function (s) { return chip(s.n, "", '<span class="chip-w static">' + "●".repeat(s.w) + "</span>"); }).join("") : '<span class="faint">No known skills detected - add them below.</span>') +
      '</div>' +
      '<div class="grid g-2" style="gap:14px;margin-top:14px">' +
        '<div><div class="section-label">Roles</div><div class="chips">' + d.roles.map(function (r) { return chip(r); }).join("") + '</div></div>' +
        '<div><div class="section-label">Looks like</div><div class="chips">' +
          chip((LEVELS.filter(function (l) { return l[0] === d.level; })[0] || ["", d.level])[1]) +
          (d.years ? chip(d.years + " yrs experience") : "") +
          d.jobTypes.map(function (t) { return chip((TYPES.filter(function (x) { return x[0] === t; })[0] || ["", t])[1]); }).join("") +
          d.locations.map(function (l) { return chip(l); }).join("") + '</div></div></div>' +
      '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
        '<button class="btn btn-primary" data-action="prof-apply">' + icon("check", 13) + ' Apply to my profile</button>' +
        '<button class="btn btn-ghost" data-action="prof-discard">Discard</button></div></div>';
  }

  function uploadCard(p) {
    return '<div class="card" style="margin-bottom:14px">' +
      '<div class="card-head"><div class="card-title">Your resume</div>' +
      (p.resumeName ? '<span class="badge b-green">' + icon("file", 11) + " " + esc(p.resumeName) + "</span>" : '<span class="badge b-muted">none yet</span>') + "</div>" +
      '<label class="dropzone' + (busy ? " busy" : "") + '" id="pfDrop">' +
        '<input type="file" id="pfFile" accept=".pdf,.docx,.txt,.md,application/pdf" data-action="prof-file" hidden' + (busy ? " disabled" : "") + '>' +
        (busy ? '<span class="spin"></span><span>' + esc(busy) + "</span>"
          : '<span class="dz-ico">' + icon("upload", 26) + '</span><span class="dz-t">Drop your resume here, or click to browse</span>' +
            '<span class="dz-s">PDF, DOCX or TXT · read in your browser · up to 5 MB</span>') +
      "</label>" +
      (errMsg ? '<div class="auth-err show" style="margin-top:12px" role="alert">' + esc(errMsg) + "</div>" : "") +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        '<button class="btn btn-sm btn-ghost" data-action="prof-paste-toggle">' + (pasteOpen ? "Hide pasted text" : "Paste text instead") + "</button>" +
        (p.resumeText ? '<button class="btn btn-sm btn-ghost" data-action="prof-reparse" ' + (busy ? "disabled" : "") + ">" + icon("refresh", 12) + " Re-parse</button>" +
          '<button class="btn btn-sm btn-danger" data-action="prof-clear-resume">Delete resume text</button>' : "") +
        '<span class="faint" style="font-size:11.5px;margin-left:auto">' + (NXAI.available() ? "AI will improve the extraction. Resume text is sent only when you parse." : "Works offline. Add an AI key in Settings for a smarter read.") + "</span></div>" +
      (pasteOpen ? '<div style="margin-top:12px"><textarea id="pfPaste" rows="7" class="code-area" placeholder="Paste your resume text here"></textarea>' +
        '<div style="margin-top:8px"><button class="btn btn-primary btn-sm" data-action="prof-parse-paste">Parse this text</button></div></div>' : "") +
      "</div>";
  }

  function editor(p) {
    var lvl = '<select data-action="prof-field" data-k="level">' + LEVELS.map(function (l) {
      return '<option value="' + l[0] + '"' + (p.level === l[0] ? " selected" : "") + ">" + l[1] + "</option>"; }).join("") + "</select>";
    return '<div class="grid g-2" style="margin-bottom:14px;align-items:start">' +
      '<div class="card"><div class="card-head"><div class="card-title">About you</div></div>' +
        '<div class="stack" style="gap:12px">' +
        '<div><label class="field-label">Name</label><input class="input" data-action="prof-field" data-k="name" value="' + esc(p.name) + '" placeholder="Your name"></div>' +
        '<div><label class="field-label">Headline</label><input class="input" data-action="prof-field" data-k="headline" value="' + esc(p.headline) + '" placeholder="Final-year CS student - ML &amp; backend"></div>' +
        '<div class="grid g-2" style="gap:10px"><div><label class="field-label">Experience level</label>' + lvl + "</div>" +
        '<div><label class="field-label">Years of experience</label><input class="input" type="number" min="0" max="30" step="0.5" data-action="prof-field" data-k="years" value="' + esc(p.years || 0) + '"></div></div>' +
        "</div></div>" +
      '<div class="card"><div class="card-head"><div class="card-title">What you\'re looking for</div></div>' +
        '<div class="section-label">Job type</div><div class="wrap" style="margin-bottom:14px">' +
          TYPES.map(function (t) { var on = p.jobTypes.indexOf(t[0]) >= 0;
            return '<button class="btn btn-sm ' + (on ? "btn-primary" : "") + '" data-action="prof-type" data-t="' + t[0] + '" aria-pressed="' + on + '">' + (on ? "✓ " : "") + t[1] + "</button>"; }).join("") + "</div>" +
        '<div class="section-label">Locations</div><div class="chips" style="margin-bottom:8px">' +
          (p.locations.length ? p.locations.map(function (l, i) { return chip(l, 'data-action="prof-loc-del" data-i="' + i + '"'); }).join("") : '<span class="faint" style="font-size:12px">Anywhere</span>') + "</div>" +
        '<div class="add-row"><input class="input" id="pfLocIn" data-enter="prof-loc-add" placeholder="Add a city or country"><button class="btn btn-sm" data-action="prof-loc-add">Add</button></div>' +
        '<div class="wrap" style="margin-top:12px">' +
          '<label class="checkline"><input type="checkbox" data-action="prof-flag" data-k="remote" ' + (p.remote ? "checked" : "") + '> Open to remote roles</label>' +
          '<label class="checkline"><input type="checkbox" data-action="prof-flag" data-k="indiaOnly" ' + (p.indiaOnly ? "checked" : "") + '> Only roles located in India</label></div>' +
      "</div></div>";
  }

  function skillsCard(p) {
    return '<div class="card" style="margin-bottom:14px"><div class="card-head"><div><div class="card-title">Skills</div>' +
      '<div class="faint" style="font-size:12px">The dots show importance - click them to cycle. Core skills weigh most when ranking jobs.</div></div>' +
      '<span class="badge b-accent">' + p.skills.length + "</span></div>" +
      '<div class="chips" style="margin-bottom:12px">' + (p.skills.length ? p.skills.map(skillChip).join("") : '<span class="faint" style="font-size:12.5px">No skills yet - upload your resume above or add them here.</span>') + "</div>" +
      '<div class="add-row"><input class="input" id="pfSkillIn" data-enter="prof-skill-add" placeholder="Add a skill, e.g. pytorch"><button class="btn btn-sm" data-action="prof-skill-add">Add skill</button></div></div>' +
      '<div class="card" style="margin-bottom:14px"><div class="card-head"><div class="card-title">Target roles</div></div>' +
      '<div class="chips" style="margin-bottom:12px">' + (p.roles.length ? p.roles.map(function (r, i) { return chip(r, 'data-action="prof-role-del" data-i="' + i + '"'); }).join("") : '<span class="faint" style="font-size:12.5px">No roles yet.</span>') + "</div>" +
      '<div class="add-row"><input class="input" id="pfRoleIn" data-enter="prof-role-add" placeholder="Add a role, e.g. ml engineer"><button class="btn btn-sm" data-action="prof-role-add">Add role</button></div></div>';
  }

  function feedCard(p) {
    var n = S().jobfeed.cache.length;
    return '<div class="card"><div class="card-head"><div class="card-title">Your job feed</div>' +
      '<label class="checkline"><input type="checkbox" data-action="prof-flag" data-k="autoFeed" ' + (p.autoFeed ? "checked" : "") + '> Keep the feed in sync with my profile</label></div>' +
      '<div class="mut" style="font-size:13px;margin-bottom:12px">' + (p.skills.length
        ? "Matching on <strong>" + p.skills.length + "</strong> skills and <strong>" + p.roles.length + "</strong> roles. " + n + " jobs are loaded right now."
        : "Add skills to start ranking jobs against your profile.") + "</div>" +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-primary" data-action="prof-refresh">' + icon("refresh", 13) + " " + (p.feedDirty ? "Refresh feed with these changes" : "Refresh feed") + "</button>" +
        '<button class="btn" data-action="nav" data-view="jobfeed">Open Job Feed ' + icon("arrow-right", 13) + "</button></div></div>";
  }

  function body() {
    var p = P();
    return '<div class="page-title">Profile</div>' +
      '<div class="page-sub">Your resume becomes a profile you control. The Job Feed ranks live postings against it - edit any skill or preference and the ranking follows.</div>' +
      uploadCard(p) + draftCard(p) + editor(p) + skillsCard(p) + feedCard(p);
  }
  function paint() {
    var r = document.getElementById("pfRoot");
    if (r) r.innerHTML = body();
  }

  N.NAV.forEach(function (g) {
    if (g.group === "Career") g.items.unshift({ id: "profile", label: "Profile", icon: "user" });
  });
  N.ROUTES.profile = function () { return '<div id="pfRoot">' + body() + "</div>"; };

  /* ---------- actions ---------- */
  var A = N.actions, C = N.changes;
  C["prof-file"] = function (t) { var f = t.files && t.files[0]; t.value = ""; handleFile(f); };
  A["prof-paste-toggle"] = function () { pasteOpen = !pasteOpen; paint(); };
  A["prof-parse-paste"] = async function () {
    var ta = document.getElementById("pfPaste"); if (!ta || busy) return;
    errMsg = ""; busy = "Reading your text..."; paint();
    try { await parse(ta.value, "pasted text"); pasteOpen = false; } catch (e) { errMsg = e.message; }
    busy = ""; paint();
  };
  A["prof-reparse"] = async function () {
    var p = P(); if (!p.resumeText || busy) return;
    errMsg = ""; busy = "Re-reading your resume..."; paint();
    try { await parse(p.resumeText, p.resumeName); } catch (e) { errMsg = e.message; }
    busy = ""; paint();
  };
  A["prof-clear-resume"] = function () {
    var p = P(); p.resumeText = ""; p.resumeName = ""; p.draft = null; N.save(); N.toast("Resume text deleted", "ok"); paint();
  };
  A["prof-apply"] = function () {
    var p = P(); if (!p.draft) return;
    applyDraft(p, p.draft); p.draft = null;
    syncFeed(); N.save(); paint();
    N.toast("Profile updated - refresh the feed to re-rank live jobs", "ok");
  };
  A["prof-discard"] = function () { P().draft = null; N.save(); paint(); };

  A["prof-skill-add"] = function () {
    var i = document.getElementById("pfSkillIn"), v = clip(i && i.value, 40).toLowerCase();
    if (!v) return;
    var p = P();
    if (!p.skills.some(function (s) { return s.n.toLowerCase() === v; })) p.skills.push({ n: v, w: 2 });
    touch(); var n = document.getElementById("pfSkillIn"); if (n) n.focus();
  };
  A["prof-skill-w"] = function (D) { var s = P().skills[+D.i]; if (s) { s.w = s.w >= 3 ? 1 : s.w + 1; touch(); } };
  A["prof-skill-del"] = function (D) { P().skills.splice(+D.i, 1); touch(); };
  A["prof-role-add"] = function () {
    var i = document.getElementById("pfRoleIn"), v = clip(i && i.value, 50).toLowerCase();
    if (!v) return;
    var p = P(); if (p.roles.indexOf(v) < 0) p.roles.push(v);
    touch(); var n = document.getElementById("pfRoleIn"); if (n) n.focus();
  };
  A["prof-role-del"] = function (D) { P().roles.splice(+D.i, 1); touch(); };
  A["prof-loc-add"] = function () {
    var i = document.getElementById("pfLocIn"), v = clip(i && i.value, 40).toLowerCase();
    if (!v) return;
    var p = P(); if (p.locations.indexOf(v) < 0) p.locations.push(v);
    touch(); var n = document.getElementById("pfLocIn"); if (n) n.focus();
  };
  A["prof-loc-del"] = function (D) { P().locations.splice(+D.i, 1); touch(); };
  A["prof-type"] = function (D) {
    var p = P(), i = p.jobTypes.indexOf(D.t);
    if (i >= 0) p.jobTypes.splice(i, 1); else p.jobTypes.push(D.t);
    touch();
  };
  C["prof-flag"] = function (t, D) { P()[D.k] = !!t.checked; touch(); };
  C["prof-field"] = function (t, D) {
    var p = P(), v = t.value;
    p[D.k] = D.k === "years" ? Math.max(0, Math.min(30, +v || 0)) : D.k === "level" ? v : clip(v, 90);
    if (D.k === "level" && !p.jobTypes.length) p.jobTypes = v === "student" ? ["internship", "new-grad"] : v === "entry" ? ["new-grad", "full-time"] : ["full-time"];
    touch();
  };
  A["prof-refresh"] = function () { P().feedDirty = false; N.save(); N.refreshFeed(); };

  /* Enter in an add-box submits it */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var t = e.target;
    if (t && t.dataset && t.dataset.enter && A[t.dataset.enter]) { e.preventDefault(); A[t.dataset.enter](t.dataset, t, e); }
  });

  /* drag & drop onto the drop zone */
  ["dragenter", "dragover"].forEach(function (ev) {
    document.addEventListener(ev, function (e) { var z = e.target.closest && e.target.closest("#pfDrop"); if (z) { e.preventDefault(); z.classList.add("over"); } });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var z = e.target.closest && e.target.closest("#pfDrop");
      if (!z) return;
      z.classList.remove("over");
      if (ev === "drop") { e.preventDefault(); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); }
    });
  });

  /* ---------- Job Feed: show what it's ranking for ---------- */
  var origFeed = N.ROUTES.jobfeed;
  N.ROUTES.jobfeed = function () {
    var p = S().profile, banner;
    if (p && p.skills && p.skills.length) {
      banner = '<div class="card match-banner" style="margin-bottom:14px"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:220px"><div class="section-label" style="margin-bottom:8px">Ranked for ' + esc(p.name || "your profile") + '</div>' +
        '<div class="chips">' + p.skills.slice(0, 7).map(function (s) { return chip(s.n); }).join("") +
        (p.skills.length > 7 ? '<span class="faint" style="font-size:12px;align-self:center">+' + (p.skills.length - 7) + " more</span>" : "") + "</div>" +
        '<div class="faint" style="font-size:12px;margin-top:8px">' + esc(p.jobTypes.join(" · ") || "any type") + (p.locations.length ? " · " + esc(p.locations.slice(0, 3).join(", ")) : "") + (p.remote ? " · remote ok" : "") + "</div></div>" +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          (p.feedDirty ? '<button class="btn btn-primary btn-sm" data-action="prof-refresh">' + icon("refresh", 12) + " Refresh with changes</button>" : "") +
          '<button class="btn btn-sm" data-action="nav" data-view="profile">Edit profile</button></div></div></div>';
    } else {
      banner = '<div class="card match-banner" style="margin-bottom:14px"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
        '<span style="color:var(--accent)">' + icon("file", 22) + '</span><div style="flex:1;min-width:220px"><div class="card-title">Rank this feed against your resume</div>' +
        '<div class="faint" style="font-size:12.5px;margin-top:3px">Upload your resume and Nexus extracts your skills, roles and level - then orders these jobs by fit.</div></div>' +
        '<button class="btn btn-primary btn-sm" data-action="nav" data-view="profile">Upload resume ' + icon("arrow-right", 12) + "</button></div></div>";
    }
    return banner + origFeed();
  };

  N.onStart.push(function () { P(); });
})();
