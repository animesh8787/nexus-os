/* ============================================================
   NEXUS OS  —  app.js  (classic script, runs from file:// )
   ============================================================ */
(function () {
"use strict";

/* ---------- tiny helpers ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (v, max) => (max > 0 ? clamp(Math.round((v / max) * 100), 0, 100) : 0);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : n);
const pad4 = (n) => String(n || 0).padStart(4, "0");
const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "misc";
const titleCase = (s) => String(s || "").replace(/(^|[-\s])(\w)/g, (_, a, b) => a + b.toUpperCase()).replace(/-/g, " ");

const LANG_EXT = {
  python: "py", python3: "py", py: "py", "c++": "cpp", cpp: "cpp", c: "c", java: "java",
  javascript: "js", js: "js", typescript: "ts", ts: "ts", "c#": "cs", csharp: "cs",
  go: "go", golang: "go", rust: "rs", kotlin: "kt", swift: "swift", ruby: "rb",
  scala: "scala", php: "php", sql: "sql", mysql: "sql", dart: "dart", racket: "rkt",
  erlang: "erl", elixir: "ex",
};
const LANG_COMMENT = { py: "#", rb: "#", sql: "--", rkt: ";", erl: "%" }; // default "//"
const langExt = (l) => LANG_EXT[String(l || "").toLowerCase()] || "txt";
const langLine = (ext) => LANG_COMMENT[ext] || "//";

/* base64 that survives UTF-8 */
const b64enc = (str) => btoa(unescape(encodeURIComponent(str)));
const b64dec = (str) => { try { return decodeURIComponent(escape(atob(str))); } catch (e) { return atob(str); } };

/* minimal markdown -> html for AI Coach output */
function mdToHtml(md) {
  const E = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => E(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = String(md || "").split("\n");
  let html = "", inList = false, inCode = false, code = "";
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const raw of lines) {
    if (raw.trim().startsWith("```")) {
      if (inCode) { html += `<pre><code>${E(code)}</code></pre>`; code = ""; inCode = false; }
      else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { code += raw + "\n"; continue; }
    const h = raw.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeList(); const n = h[1].length + 2; html += `<h${n}>${inline(h[2])}</h${n}>`; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(raw)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(raw.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`;
      continue;
    }
    if (raw.trim() === "") { closeList(); continue; }
    closeList(); html += `<p>${inline(raw)}</p>`;
  }
  closeList();
  if (inCode) html += `<pre><code>${E(code)}</code></pre>`;
  return html;
}

const iso = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const toMins = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const fmtDate = (d) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const ago = (ts) => {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};

/* ---------- toast ---------- */
function toast(msg, kind = "") {
  const box = el("toasts");
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.innerHTML = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(6px)"; }, 3200);
  setTimeout(() => t.remove(), 3600);
}

/* ============================================================
   DEFAULT DATA
   ============================================================ */
const DEFAULT_SCHEDULE = [
  { icon: "🌅", label: "Wake Up",            st: "05:00", en: "05:10" },
  { icon: "💪", label: "Morning Workout",    st: "05:10", en: "06:40" },
  { icon: "🚿", label: "Bath + Breakfast",   st: "06:40", en: "07:20" },
  { icon: "🎓", label: "DSA Lecture",        st: "07:20", en: "08:40" },
  { icon: "⚡", label: "DSA / LeetCode",     st: "08:40", en: "13:20" },
  { icon: "🍱", label: "Lunch",              st: "13:30", en: "14:10" },
  { icon: "⚡", label: "DSA / LeetCode",     st: "14:10", en: "15:10" },
  { icon: "🤖", label: "Project Dev",        st: "15:10", en: "17:20" },
  { icon: "🏋️", label: "Evening Gym",        st: "17:35", en: "18:50" },
  { icon: "💻", label: "Full Stack Session", st: "19:10", en: "20:00" },
  { icon: "🍽️", label: "Dinner",             st: "20:00", en: "20:40" },
  { icon: "💻", label: "Full Stack Session", st: "20:50", en: "21:20" },
  { icon: "🐙", label: "GitHub + LinkedIn",  st: "21:20", en: "21:45" },
  { icon: "🧠", label: "AI / ML Concepts",   st: "21:45", en: "22:30" },
  { icon: "🌙", label: "Wind Down",          st: "22:30", en: "23:00" },
  { icon: "💤", label: "Sleep",              st: "23:00", en: "05:00" },
];

const DEFAULT_TASKS = [
  { id: "wake",    icon: "🌅", label: "Wake up at 5:00 AM",        cat: "Routine" },
  { id: "wm",      icon: "💪", label: "Morning workout",           cat: "Fitness" },
  { id: "dsa_lec", icon: "🎓", label: "DSA lecture",               cat: "Study" },
  { id: "dsa",     icon: "⚡", label: "DSA / LeetCode solving",    cat: "Study" },
  { id: "proj",    icon: "🤖", label: "Project development",       cat: "Build" },
  { id: "gym",     icon: "🏋️", label: "Evening gym",               cat: "Fitness" },
  { id: "fs",      icon: "💻", label: "Full stack session",        cat: "Study" },
  { id: "github",  icon: "🐙", label: "GitHub commit + LinkedIn",  cat: "Career" },
  { id: "ai",      icon: "🧠", label: "AI / ML revision",          cat: "Study" },
  { id: "sleep",   icon: "💤", label: "Sleep by 11:00 PM",         cat: "Routine" },
];

const DEFAULT_PROJECTS = [
  { id: uid(), emoji: "🤖", name: "AI Desktop Assistant", desc: "JARVIS-style AI for Windows",
    tech: ["Python", "PyQt5", "OpenAI"],
    tasks: ["Voice recognition module", "LLM integration", "Assistant UI", "System command executor", "File management", "Packaging & deploy"].map((t) => ({ t, done: false })) },
  { id: uid(), emoji: "📄", name: "AI Resume Ranker", desc: "NLP resume scoring system",
    tech: ["Python", "NLP", "FastAPI"],
    tasks: ["Resume parsing", "Skill extraction (NLP)", "Ranking algorithm", "REST API", "Frontend dashboard"].map((t) => ({ t, done: false })) },
  { id: uid(), emoji: "🌱", name: "Carbon Track + Time Bank", desc: "Sustainability gamification platform",
    tech: ["React", "Node.js", "MongoDB"],
    tasks: ["Architecture design", "Carbon calc engine", "Time bank system", "Dashboard UI", "Gamification"].map((t) => ({ t, done: false })) },
];

const DEFAULT_SKILLS = {
  fullstack: ["HTML & CSS", "JavaScript (Adv.)", "React.js", "Node + Express", "MongoDB / SQL", "REST APIs", "Auth & Security", "Deployment / CI-CD"].map((n) => ({ n, v: 0 })),
  aiml: ["ML Fundamentals", "Neural Nets (ANN)", "CNN + Vision", "LLM Concepts", "Embeddings", "Vector DBs", "LangChain", "RAG Systems"].map((n) => ({ n, v: 0 })),
};

/* ============================================================
   JOB FEED — verified sources
   Every board below was probed live; `in` = India-located roles at probe time.
   ============================================================ */
const DEFAULT_BOARDS = [
  { ats: "greenhouse", slug: "databricks",                     name: "Databricks",     on: true },
  { ats: "greenhouse", slug: "mongodb",                        name: "MongoDB",        on: true },
  { ats: "ashby",      slug: "sarvam",                         name: "Sarvam AI",      on: true },
  { ats: "greenhouse", slug: "zscaler",                        name: "Zscaler",        on: true },
  { ats: "greenhouse", slug: "stripe",                         name: "Stripe",         on: true },
  { ats: "greenhouse", slug: "gitlab",                         name: "GitLab",         on: true },
  { ats: "greenhouse", slug: "rubrik",                         name: "Rubrik",         on: true },
  { ats: "greenhouse", slug: "squarepointcapital",             name: "Squarepoint",    on: true },
  { ats: "greenhouse", slug: "elastic",                        name: "Elastic",        on: true },
  { ats: "greenhouse", slug: "razorpaysoftwareprivatelimited", name: "Razorpay",       on: true },
  { ats: "greenhouse", slug: "coinbase",                       name: "Coinbase",       on: true },
  { ats: "greenhouse", slug: "twilio",                         name: "Twilio",         on: true },
  { ats: "greenhouse", slug: "towerresearchcapital",           name: "Tower Research", on: true },
  { ats: "greenhouse", slug: "imc",                            name: "IMC Trading",    on: true },
  { ats: "greenhouse", slug: "worldquant",                     name: "WorldQuant",     on: true },
  { ats: "greenhouse", slug: "groww",                          name: "Groww",          on: true },
  { ats: "greenhouse", slug: "postman",                        name: "Postman",        on: true },
  { ats: "greenhouse", slug: "anthropic",                      name: "Anthropic",      on: true },
  { ats: "greenhouse", slug: "airbnb",                         name: "Airbnb",         on: true },
  { ats: "greenhouse", slug: "cloudflare",                     name: "Cloudflare",     on: true },
  { ats: "greenhouse", slug: "samsara",                        name: "Samsara",        on: true },
  { ats: "greenhouse", slug: "jumptrading",                    name: "Jump Trading",   on: true },
  { ats: "greenhouse", slug: "janestreet",                     name: "Jane Street",    on: true },
  { ats: "greenhouse", slug: "figma",                          name: "Figma",          on: false },
  { ats: "greenhouse", slug: "vercel",                         name: "Vercel",         on: false },
  { ats: "greenhouse", slug: "scaleai",                        name: "Scale AI",       on: false },
  { ats: "greenhouse", slug: "pinterest",                      name: "Pinterest",      on: false },
  { ats: "greenhouse", slug: "robinhood",                      name: "Robinhood",      on: false },
  { ats: "greenhouse", slug: "affirm",                         name: "Affirm",         on: false },
  { ats: "greenhouse", slug: "brex",                           name: "Brex",           on: false },
  { ats: "greenhouse", slug: "slice",                          name: "Slice",          on: false },
  { ats: "ashby",      slug: "perplexity",                     name: "Perplexity",     on: false },
  { ats: "ashby",      slug: "notion",                         name: "Notion",         on: false },
  { ats: "ashby",      slug: "ramp",                           name: "Ramp",           on: false },
  { ats: "ashby",      slug: "confluent",                      name: "Confluent",      on: false },
  { ats: "ashby",      slug: "linear",                         name: "Linear",         on: false },
  { ats: "ashby",      slug: "supabase",                       name: "Supabase",       on: false },
  { ats: "ashby",      slug: "navi",                           name: "Navi",           on: false },
];

/* aggregate boards — all verified CORS-open */
const DEFAULT_AGGREGATORS = {
  wwr:       { name: "We Work Remotely", on: true },
  remotive:  { name: "Remotive",         on: true },
  remoteok:  { name: "Remote OK",        on: true },
  jobicy:    { name: "Jobicy",           on: true },
  arbeitnow: { name: "Arbeitnow",        on: false },
  themuse:   { name: "The Muse",         on: false },
  hn:        { name: "HN Who's Hiring",  on: true },
  agent:     { name: "Agent file",       on: true },   // jobs-feed.json from feed-agent.mjs
};

/* profile-derived matching, editable in the UI */
const DEFAULT_FILTERS = {
  include: ["machine learning", "deep learning", "artificial intelligence", "ai", "ai/ml", "genai",
            "generative", "llm", "nlp", "computer vision", "data scien", "data engineer",
            "python", "pytorch", "tensorflow", "software engineer", "sde", "swe", "backend",
            "full stack", "fullstack", "react", "typescript", "fastapi", "research engineer",
            "quantitative", "quant", "platform engineer", "applied scientist"],
  exclude: ["senior", "sr ", "sr.", "staff ", "principal", "director", "head of", " vp ",
            "vice president", "manager", "architect", "lead ", " lead", "sales", "marketing",
            "recruiter", "driver", "nurse", "warehouse", "picker", "accountant", "teacher",
            "designer", "10+ years", "8+ years", "phd or postdoc", "postdoc",
            "ai trainer", "annotation", "annotator", "transcription", "transcriber",
            "data collection", "voice recording", "video recording", "content analyst",
            "survey", "rater", "tutor"],
  levels:  ["intern", "internship", "new grad", "new graduate", "university", "campus", "graduate",
            "entry level", "entry-level", "junior", "associate", "trainee", "fresher",
            "early career", "0-2 years", "1-3 years"],
  locations: ["india", "bengaluru", "bangalore", "hyderabad", "pune", "gurgaon", "gurugram",
              "noida", "mumbai", "delhi", "chennai", "remote", "anywhere"],
  minScore: 2,
  indiaOnly: false,
};

/* ============================================================
   STATE  +  PERSISTENCE
   ============================================================ */
const LS_KEY = "nexus-os:v2";

let S = freshState();

function freshState() {
  return {
    settings: {
      leetcode: "", github: "", lcGoal: 400, theme: "system",
      ghToken: "", ghRepo: "leetcode-solutions", ghPushEnabled: false, ghPrivate: false,
      groqKey: "", groqModel: "",
      autoLog: true,
    },
    lc: null,                    // synced LeetCode payload
    gh: null,                    // synced GitHub payload
    practice: { log: [] },       // [{date, diff}]  local practice log (non-LeetCode)
    solves: [],                  // [{id, slug, title, qid, difficulty, topics, lang, date, code, notes, source, pushed, pushUrl, pushPath}]
    pmeta: {},                   // slug -> {qid, difficulty, topics}  cache
    ai: { history: [] },         // [{kind, date, text}]
    jobfeed: {
      boards: clone(DEFAULT_BOARDS),
      aggregators: clone(DEFAULT_AGGREGATORS),
      filters: clone(DEFAULT_FILTERS),
      cache: [],                 // normalized jobs from last fetch
      seen: {},                  // jobId -> true (already shown once)
      dismissed: {},             // jobId -> true
      tracked: {},               // jobId -> true (sent to Job Tracker)
      lastFetch: 0,
      errors: [],
    },
    tasks: {},                   // { 'YYYY-MM-DD': { taskId:true } }
    taskDefs: clone(DEFAULT_TASKS),
    schedule: clone(DEFAULT_SCHEDULE),
    projects: clone(DEFAULT_PROJECTS),
    skills: clone(DEFAULT_SKILLS),
    jobs: [],
  };
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    S = Object.assign(freshState(), p);
    S.settings = Object.assign(freshState().settings, p.settings || {});
    if (!Array.isArray(S.taskDefs) || !S.taskDefs.length) S.taskDefs = clone(DEFAULT_TASKS);
    if (!Array.isArray(S.schedule) || !S.schedule.length) S.schedule = clone(DEFAULT_SCHEDULE);
    if (!Array.isArray(S.projects)) S.projects = clone(DEFAULT_PROJECTS);
    if (!S.skills || !S.skills.fullstack) S.skills = clone(DEFAULT_SKILLS);
    if (!S.practice || !Array.isArray(S.practice.log)) S.practice = { log: [] };
    if (!Array.isArray(S.jobs)) S.jobs = [];
    if (!S.tasks) S.tasks = {};
    if (!Array.isArray(S.solves)) S.solves = [];
    if (!S.pmeta || typeof S.pmeta !== "object") S.pmeta = {};
    if (!S.ai || !Array.isArray(S.ai.history)) S.ai = { history: [] };
    const jfDefault = freshState().jobfeed;
    S.jobfeed = Object.assign(jfDefault, p.jobfeed || {});
    if (!Array.isArray(S.jobfeed.boards) || !S.jobfeed.boards.length) S.jobfeed.boards = clone(DEFAULT_BOARDS);
    S.jobfeed.aggregators = Object.assign(clone(DEFAULT_AGGREGATORS), S.jobfeed.aggregators || {});
    S.jobfeed.filters = Object.assign(clone(DEFAULT_FILTERS), S.jobfeed.filters || {});
    for (const k of ["seen", "dismissed", "tracked"]) if (!S.jobfeed[k]) S.jobfeed[k] = {};
    if (!Array.isArray(S.jobfeed.cache)) S.jobfeed.cache = [];
  } catch (e) { console.warn("load failed", e); }
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); }
  catch (e) { toast("Could not save — storage may be full", "err"); }
  updateChrome();
}

/* ============================================================
   DERIVED  (practice log -> stats + streak)
   ============================================================ */
function practiceStats() {
  const by = { easy: 0, medium: 0, hard: 0 }, cal = {};
  const t = iso();
  for (const e of S.practice.log) {
    if (by[e.diff] != null) by[e.diff]++;
    cal[e.date] = (cal[e.date] || 0) + 1;
  }
  return {
    total: S.practice.log.length, ...by,
    today: S.practice.log.filter((e) => e.date === t).length,
    cal,
  };
}
function streakFrom(cal) {
  let s = 0, d = new Date();
  if (!cal[iso(d)]) d = addDays(d, -1);
  while (cal[iso(d)]) { s++; d = addDays(d, -1); }
  return s;
}
/* combined activity calendar: local practice + logged solves + leetcode submissions */
function activityCal() {
  const { cal } = practiceStats();
  const out = Object.assign({}, cal);
  for (const s of S.solves) if (s.date) out[s.date] = (out[s.date] || 0) + 1;
  if (S.lc && S.lc.calendar) for (const k in S.lc.calendar) out[k] = Math.max(out[k] || 0, S.lc.calendar[k]);
  return out;
}
function solvedTotal() {
  if (S.lc && typeof S.lc.solved === "number") return S.lc.solved;
  return S.solves.length || practiceStats().total;
}
function last7(cal) {
  return [...Array(7)].map((_, i) => cal[iso(addDays(new Date(), -(6 - i)))] || 0);
}
function skillAvg(key) {
  const l = S.skills[key] || [];
  return l.length ? Math.round(l.reduce((a, s) => a + s.v, 0) / l.length) : 0;
}
/* per-topic / per-difficulty breakdown from the solve log */
function solveStats() {
  const byTopic = {}, byDifficulty = { Easy: 0, Medium: 0, Hard: 0 };
  for (const s of S.solves) {
    const t = (s.topics && s.topics[0]) || "misc";
    byTopic[t] = (byTopic[t] || 0) + 1;
    if (byDifficulty[s.difficulty] != null) byDifficulty[s.difficulty]++;
  }
  const topics = Object.entries(byTopic).sort((a, b) => b[1] - a[1]);
  const thinTopics = topics.slice(-4).map((x) => x[0]);
  return {
    count: S.solves.length,
    pushed: S.solves.filter((s) => s.pushed).length,
    readyToPush: S.solves.filter((s) => !s.pushed && (s.code || "").trim()).length,
    needCode: S.solves.filter((s) => s.source === "sync" && !(s.code || "").trim()).length,
    byTopic, byDifficulty, topics, thinTopics,
  };
}
function todayTaskState() {
  const t = S.tasks[iso()] || {};
  const done = S.taskDefs.filter((d) => t[d.id]).length;
  return { map: t, done, total: S.taskDefs.length, pct: pct(done, S.taskDefs.length) };
}

/* ============================================================
   THEME
   ============================================================ */
function effectiveTheme() {
  const t = S.settings.theme;
  if (t === "light" || t === "dark") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme() {
  document.documentElement.setAttribute("data-theme", effectiveTheme());
  const b = el("themeBtn");
  if (b) b.textContent = S.settings.theme === "system" ? "◐" : S.settings.theme === "dark" ? "○" : "●";
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (S.settings.theme === "system") { applyTheme(); rerender(); }
});

/* ============================================================
   SVG WIDGETS
   ============================================================ */
function ring(pctVal, opts = {}) {
  const size = opts.size || 118, sw = opts.stroke || 11;
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - clamp(pctVal, 0, 100) / 100);
  const col = opts.color || "var(--accent)";
  return `<svg class="ring" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${sw}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}"
      stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
      transform="rotate(-90 ${size / 2} ${size / 2})" style="transition:stroke-dashoffset .8s cubic-bezier(.4,0,.2,1)"/>
  </svg>`;
}
function barChart(rows, opts = {}) {
  // rows: [{label, value, target?}]
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.target || 0)));
  return `<div class="bars">${rows.map((r) => {
    const h = Math.round((r.value / max) * 100);
    const th = r.target ? Math.round((r.target / max) * 100) : 0;
    return `<div class="bar-col">
      <div class="bar-track">
        ${r.target ? `<div class="bar target" style="height:${th}%;position:absolute;inset:auto 0 0 0"></div>` : ""}
        <div class="bar" style="height:${h}%;background:${opts.color || "var(--accent)"}"></div>
      </div>
      <div class="bar-label">${esc(r.label)}</div>
    </div>`;
  }).join("")}</div>`;
}
function heatmap(cal, opts = {}) {
  const weeks = opts.weeks || 26;
  const pal = opts.palette || ["var(--hm0)", "var(--hm1)", "var(--hm2)", "var(--hm3)", "var(--hm4)"];
  const today = new Date();
  let start = addDays(today, -(weeks * 7 - 1));
  start = addDays(start, -start.getDay());          // back to Sunday
  const vals = Object.values(cal).filter((v) => v > 0);
  const max = Math.max(1, ...vals);
  const level = (v) => v <= 0 ? 0
    : v >= max * 0.75 ? 4 : v >= max * 0.5 ? 3 : v >= max * 0.25 ? 2 : 1;
  let cells = "", cur = new Date(start);
  while (cur <= today || cur.getDay() !== 0) {
    const k = iso(cur), future = cur > today, v = cal[k] || 0;
    cells += `<div class="hm-cell" title="${k}: ${v}" style="background:${future ? "transparent" : pal[level(v)]}"></div>`;
    cur = addDays(cur, 1);
    if (cur > addDays(today, 7)) break;
  }
  return `<div class="heatmap">${cells}</div>
    <div class="hm-legend"><span>Less</span>
      ${pal.map((c) => `<i style="background:${c}"></i>`).join("")}
      <span>More</span></div>`;
}

/* reusable bits */
const stat = (label, value, sub, opts = {}) => `
  <div class="stat">
    ${opts.icon ? `<span class="stat-ico">${opts.icon}</span>` : ""}
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value" style="color:${opts.color || "var(--text)"}">${value}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
  </div>`;
const progress = (v, max, opts = {}) =>
  `<div class="progress ${opts.sm ? "sm" : ""}"><div class="progress-fill" style="width:${pct(v, max)}%;background:${opts.color || "var(--accent)"}"></div></div>`;
const empty = (ico, title, sub) =>
  `<div class="empty"><div class="e-ico">${ico}</div><div class="e-title">${esc(title)}</div><div class="e-sub">${esc(sub)}</div></div>`;

/* ============================================================
   API  LAYER
   ============================================================ */
async function fetchJSON(url, timeout = 11000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}
function calFromUnix(objOrStr) {
  let obj = objOrStr;
  if (typeof obj === "string") { try { obj = JSON.parse(obj); } catch (e) { obj = {}; } }
  const out = {};
  for (const k in (obj || {})) {
    const d = iso(new Date(Number(k) * 1000));
    out[d] = (out[d] || 0) + Number(obj[k] || 0);
  }
  return out;
}
function normLC(d, source) {
  const n = (x) => (typeof x === "number" ? x : parseInt(x) || 0);
  return {
    source,
    solved: n(d.totalSolved),
    easy: n(d.easySolved), medium: n(d.mediumSolved), hard: n(d.hardSolved),
    totalQ: n(d.totalQuestions),
    ranking: n(d.ranking),
    acceptance: d.acceptanceRate != null ? Math.round(n(d.acceptanceRate) * 100) / 100 : null,
    calendar: calFromUnix(d.submissionCalendar),
    recent: Array.isArray(d.recentSubmissions)
      ? d.recentSubmissions.slice(0, 30).map((r) => ({
          title: r.title, slug: r.titleSlug, status: r.statusDisplay || r.status,
          lang: r.lang, ts: Number(r.timestamp) * 1000 }))
      : [],
    lastSync: Date.now(),
  };
}
function normTashif(d) {
  const ac = {};
  ((d.submitStats && d.submitStats.acSubmissionNum) || []).forEach((x) => (ac[String(x.difficulty).toLowerCase()] = x.count));
  return {
    source: "tashif.codes",
    solved: ac.all || (ac.easy || 0) + (ac.medium || 0) + (ac.hard || 0),
    easy: ac.easy || 0, medium: ac.medium || 0, hard: ac.hard || 0,
    totalQ: 0,
    ranking: (d.profile && d.profile.ranking) || 0,
    acceptance: null,
    calendar: calFromUnix(d.submissionCalendar),
    recent: Array.isArray(d.recentSubmissions)
      ? d.recentSubmissions.slice(0, 30).map((r) => ({
          title: r.title, slug: r.titleSlug, status: r.statusDisplay || "Accepted",
          lang: r.lang, ts: Number(r.timestamp) * 1000 }))
      : [],
    lastSync: Date.now(),
  };
}
async function fetchLeetCode(user) {
  const u = encodeURIComponent(user.trim());
  const sources = [
    async () => normLC(await fetchJSON(`https://leetcode-api-faisalshohag.vercel.app/${u}`), "faisalshohag"),
    async () => {
      const d = await fetchJSON(`https://leetcode-stats.tashif.codes/${u}/profile`);
      if (d.status === "error" || d.status === "fail") throw new Error(d.message || "not found");
      return normTashif(d);
    },
    async () => {
      const a = await fetchJSON(`https://alfa-leetcode-api.onrender.com/${u}/solved`);
      return normLC({
        totalSolved: a.solvedProblem, easySolved: a.easySolved,
        mediumSolved: a.mediumSolved, hardSolved: a.hardSolved,
      }, "alfa-leetcode-api");
    },
  ];
  let lastErr;
  for (const fn of sources) {
    try {
      const r = await fn();
      if (r && r.solved != null && !Number.isNaN(r.solved)) return r;
      throw new Error("empty response");
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all sources failed");
}
async function fetchGitHub(user) {
  const u = encodeURIComponent(user.trim());
  const prof = await fetchJSON(`https://api.github.com/users/${u}`);
  if (prof.message === "Not Found") throw new Error("user not found");
  if (prof.message && /rate limit/i.test(prof.message)) throw new Error("GitHub rate limit — try later");
  const repos = await fetchJSON(`https://api.github.com/users/${u}/repos?per_page=100&sort=pushed`).catch(() => []);
  const events = await fetchJSON(`https://api.github.com/users/${u}/events/public?per_page=30`).catch(() => []);
  let contributions = [], contribTotal = 0;
  try {
    const c = await fetchJSON(`https://github-contributions-api.jogruber.de/v4/${u}?y=last`);
    contributions = (c.contributions || []).map((x) => ({ date: x.date, count: x.count }));
    contribTotal = Object.values(c.total || {}).reduce((a, b) => a + b, 0);
  } catch (e) { /* optional */ }

  const langCount = {};
  (repos || []).forEach((r) => { if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1; });
  const topRepos = (repos || [])
    .filter((r) => !r.fork)
    .sort((a, b) => b.stargazers_count - a.stargazers_count || new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, 6)
    .map((r) => ({ name: r.name, url: r.html_url, stars: r.stargazers_count, lang: r.language, desc: r.description, pushed: r.pushed_at }));

  return {
    profile: {
      login: prof.login, name: prof.name, avatar: prof.avatar_url, url: prof.html_url,
      bio: prof.bio, followers: prof.followers, following: prof.following,
      publicRepos: prof.public_repos, created: prof.created_at,
    },
    stars: (repos || []).reduce((a, r) => a + r.stargazers_count, 0),
    langs: Object.entries(langCount).sort((a, b) => b[1] - a[1]).slice(0, 6),
    topRepos,
    contributions, contribTotal,
    events: (events || []).slice(0, 14).map((e) => ({ type: e.type, repo: e.repo && e.repo.name, ts: new Date(e.created_at).getTime(), payload: e.payload })),
    lastSync: Date.now(),
  };
}

/* ---------- problem metadata (difficulty + topic), cached forever ---------- */
async function fetchProblemMeta(slug) {
  if (S.pmeta[slug]) return S.pmeta[slug];
  try {
    const d = await fetchJSON(`https://alfa-leetcode-api.onrender.com/select?titleSlug=${encodeURIComponent(slug)}`, 9000);
    const meta = {
      qid: parseInt(d.questionFrontendId || d.questionId) || 0,
      difficulty: d.difficulty || "Unknown",
      topics: Array.isArray(d.topicTags) ? d.topicTags.map((t) => t.slug || slugify(t.name)) : [],
    };
    S.pmeta[slug] = meta;
    return meta;
  } catch (e) {
    return { qid: 0, difficulty: "Unknown", topics: [] };
  }
}

/* ---------- auto-log accepted submissions coming back from a sync ---------- */
async function ingestRecentSolves(recent) {
  if (!S.settings.autoLog || !Array.isArray(recent)) return 0;
  const known = new Set(S.solves.map((s) => s.slug));
  const fresh = [];
  for (const r of recent) {
    if (!r.slug || !/accept/i.test(r.status || "")) continue;
    if (known.has(r.slug)) continue;
    known.add(r.slug);
    fresh.push(r);
  }
  let added = 0;
  for (const r of fresh.slice(0, 25)) {
    const meta = await fetchProblemMeta(r.slug);
    S.solves.push({
      id: uid(), slug: r.slug, title: r.title || titleCase(r.slug),
      qid: meta.qid, difficulty: meta.difficulty, topics: meta.topics,
      lang: r.lang || "", date: iso(new Date(r.ts || Date.now())),
      code: "", notes: "", source: "sync", pushed: false,
    });
    added++;
    await new Promise((res) => setTimeout(res, 120)); // be gentle on the meta API
  }
  if (added) { S.solves.sort((a, b) => (a.date < b.date ? 1 : -1)); save(); }
  return added;
}

/* ============================================================
   GITHUB  PUSH  (piece 2)  — needs a fine-grained PAT
   ============================================================ */
async function ghApi(path, { method = "GET", token, body } = {}) {
  const r = await fetch("https://api.github.com" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || "GitHub HTTP " + r.status);
  return j;
}
const ghWhoAmI = (token) => ghApi("/user", { token });
async function ghGetFile(owner, repo, path, token) {
  try {
    return await ghApi(`/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, { token });
  } catch (e) {
    /* 404 = no such file; 409 "This repository is empty." = repo has no commits */
    if (/not found|repository is empty/i.test(e.message)) return null;
    throw e;
  }
}
const ghPutFile = (owner, repo, path, content, message, token, sha) =>
  ghApi(`/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT", token,
    body: { message, content: b64enc(content), ...(sha ? { sha } : {}) },
  });
async function ghEnsureRepo(owner, repo, token, priv) {
  try { return await ghApi(`/repos/${owner}/${repo}`, { token }); }
  catch (e) {
    if (!/not found/i.test(e.message)) throw e;
    return ghApi("/user/repos", {
      method: "POST", token,
      body: { name: repo, private: !!priv, auto_init: true, description: "LeetCode solutions — auto-committed by Nexus OS" },
    });
  }
}
async function ghTestConnection() {
  const st = S.settings;
  if (!st.ghToken) throw new Error("no token");
  const me = await ghWhoAmI(st.ghToken);
  const repo = await ghEnsureRepo(me.login, st.ghRepo, st.ghToken, st.ghPrivate);
  return { login: me.login, repo: repo.full_name, url: repo.html_url };
}

function solveHeader(s) {
  const ext = langExt(s.lang);
  const c = langLine(ext);
  const L = [
    `${s.qid ? s.qid + ". " : ""}${s.title}`,
    `Difficulty: ${s.difficulty}   Solved: ${s.date}`,
    `https://leetcode.com/problems/${s.slug}/`,
  ];
  if ((s.notes || "").trim()) L.push("", ...s.notes.trim().split("\n"));
  return L.map((line) => (line ? `${c} ${line}` : c)).join("\n") + "\n";
}
/* solutions/index.json is the shared source of truth between this dashboard
   and the browser extension, so neither can clobber the other's entries. */
async function ghReadIndex(owner, repo, token) {
  const f = await ghGetFile(owner, repo, "solutions/index.json", token);
  if (!f || !f.content) return { sha: null, entries: {} };
  try {
    const bytes = Uint8Array.from(atob(f.content.replace(/\s/g, "")), (c) => c.charCodeAt(0));
    const j = JSON.parse(new TextDecoder().decode(bytes));
    return { sha: f.sha, entries: j.entries || {} };
  } catch (e) { return { sha: f.sha, entries: {} }; }
}
function indexEntryFor(s, path) {
  return {
    slug: s.slug, title: s.title, qid: s.qid,
    difficulty: s.difficulty, topic: slugify((s.topics && s.topics[0]) || "misc"),
    ext: langExt(s.lang), path, solvedAt: s.date, lang: s.lang,
  };
}
/* local stand-in for the repo index, used only for the on-screen preview */
function localIndexEntries() {
  const out = {};
  for (const x of S.solves) {
    const path = x.pushPath ||
      `solutions/${slugify((x.topics && x.topics[0]) || "misc")}/${pad4(x.qid)}-${x.slug}.${langExt(x.lang)}`;
    out[x.slug] = indexEntryFor(x, path);
  }
  return out;
}
function buildReadme(entries) {
  const list = Object.values(entries || {});
  const byT = {};
  for (const e of list.sort((a, b) => (a.qid || 0) - (b.qid || 0))) {
    const t = e.topic || "misc";
    (byT[t] = byT[t] || []).push(e);
  }
  const count = { Easy: 0, Medium: 0, Hard: 0 };
  list.forEach((e) => { if (count[e.difficulty] != null) count[e.difficulty]++; });

  let md = `# LeetCode Solutions

`;
  md += `> Auto-committed by Nexus OS. Updated ${iso()}.

`;
  md += `**${list.length}** solutions · Easy ${count.Easy} · Medium ${count.Medium} · Hard ${count.Hard}

`;
  for (const topic of Object.keys(byT).sort()) {
    md += `## ${titleCase(topic)} (${byT[topic].length})

`;
    md += `| # | Problem | Difficulty | Solution |
|---|---|---|---|
`;
    for (const e of byT[topic]) {
      md += `| ${e.qid || ""} | [${e.title}](https://leetcode.com/problems/${e.slug}/) | ${e.difficulty || "—"} | [${e.ext}](${e.path}) |
`;
    }
    md += `
`;
  }
  return md;
}
/* merge the given solves into solutions/index.json, then rebuild the README
   from the merged set so extension-pushed entries are never dropped */
async function refreshRepoIndex(owner, repo, token, solves) {
  const idx = await ghReadIndex(owner, repo, token);
  for (const s of solves) {
    if (!s.pushPath) continue;
    idx.entries[s.slug] = indexEntryFor(s, s.pushPath);
  }
  const json = JSON.stringify({ updated: new Date().toISOString(), entries: idx.entries }, null, 1);
  await ghPutFile(owner, repo, "solutions/index.json", json, "Update solution index", token, idx.sha);
  const rm = await ghGetFile(owner, repo, "README.md", token);
  await ghPutFile(owner, repo, "README.md", buildReadme(idx.entries), "Update README index", token, rm && rm.sha);
  return idx.entries;
}

/* pull whatever the extension (or another machine) has already pushed */
async function pullRepoIndex() {
  const st = S.settings;
  if (!st.ghToken || !st.ghRepo) throw new Error("Add a GitHub repo + token in Settings");
  const me = await ghWhoAmI(st.ghToken);
  const idx = await ghReadIndex(me.login, st.ghRepo, st.ghToken);
  const entries = Object.values(idx.entries);
  let added = 0, updated = 0;
  for (const e of entries) {
    const cur = S.solves.find((x) => x.slug === e.slug);
    if (cur) {
      if (!cur.pushed) { cur.pushed = true; updated++; }
      cur.pushPath = e.path;
      if (!cur.qid && e.qid) cur.qid = e.qid;
      if ((!cur.difficulty || cur.difficulty === "Unknown") && e.difficulty) cur.difficulty = e.difficulty;
      if ((!cur.topics || !cur.topics.length) && e.topic) cur.topics = [e.topic];
    } else {
      S.solves.push({
        id: uid(), slug: e.slug, title: e.title || titleCase(e.slug), qid: e.qid || 0,
        difficulty: e.difficulty || "Unknown", topics: e.topic ? [e.topic] : [],
        lang: e.lang || "", date: (e.solvedAt || "").slice(0, 10) || iso(),
        code: "", notes: "", source: "repo", pushed: true, pushPath: e.path,
      });
      added++;
    }
  }
  S.solves.sort((a, b) => (a.date < b.date ? 1 : -1));
  save();
  return { total: entries.length, added, updated };
}

let pushBusy = false;
async function pushSolve(id, opts = {}) {
  const st = S.settings;
  const s = S.solves.find((x) => x.id === id);
  if (!s) return;
  if (!st.ghToken || !st.ghRepo) throw new Error("Add a GitHub repo + token in Settings");
  if (!(s.code || "").trim()) throw new Error("Add your solution code first");
  const me = await ghWhoAmI(st.ghToken);
  await ghEnsureRepo(me.login, st.ghRepo, st.ghToken, st.ghPrivate);
  const ext = langExt(s.lang);
  const topic = (s.topics && s.topics[0]) || "misc";
  const path = `solutions/${slugify(topic)}/${pad4(s.qid)}-${s.slug}.${ext}`;
  const content = solveHeader(s) + "\n" + s.code.trim() + "\n";
  const existing = await ghGetFile(me.login, st.ghRepo, path, st.ghToken);
  const res = await ghPutFile(me.login, st.ghRepo, path, content,
    `Solve: ${s.qid ? s.qid + ". " : ""}${s.title} (${s.difficulty})`, st.ghToken, existing && existing.sha);
  s.pushed = true;
  s.pushPath = path;
  s.pushUrl = res.commit && res.commit.html_url;
  save();
  if (!opts.skipReadme) await refreshRepoIndex(me.login, st.ghRepo, st.ghToken, [s]);
  return res;
}
async function backfillPush() {
  if (pushBusy) return;
  const list = S.solves.filter((s) => !s.pushed && (s.code || "").trim());
  if (!list.length) return toast("Nothing to push — add code to your solve entries first");
  pushBusy = true;
  let ok = 0, fail = 0;
  for (const s of list) {
    try { await pushSolve(s.id, { skipReadme: true }); ok++; }
    catch (e) { fail++; toast(`${s.title}: ${e.message}`, "err"); }
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    const me = await ghWhoAmI(S.settings.ghToken);
    await refreshRepoIndex(me.login, S.settings.ghRepo, S.settings.ghToken, list.filter((x) => x.pushed));
  } catch (e) { /* index update is best-effort */ }
  pushBusy = false;
  toast(`Pushed ${ok} solution${ok === 1 ? "" : "s"}${fail ? `, ${fail} failed` : ""}`, fail ? "err" : "ok");
  rerender();
}

/* ============================================================
   AI  COACH  (piece 4)  — Groq, OpenAI-compatible
   ============================================================ */
/* Groq retires model ids periodically, so the id is never hard-coded:
   it is resolved from the account's own /models list and re-resolved
   automatically if the stored one gets decommissioned. */
async function groqModels() {
  const st = S.settings;
  if (!st.groqKey) throw new Error("Add your Groq API key in Settings");
  const r = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: "Bearer " + st.groqKey },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || "Groq HTTP " + r.status);
  return (j.data || []).map((m) => m.id)
    .filter((id) => !/whisper|tts|guard|embedding|playai|moderation/i.test(id));
}
/* prefer big general chat models, avoid preview/specialised builds */
function rankModel(id) {
  const s = String(id).toLowerCase();
  let n = 0;
  if (/120b|70b|maverick|kimi-k2/.test(s)) n += 100;
  else if (/32b|scout|17b/.test(s)) n += 60;
  else if (/20b|8b|instant/.test(s)) n += 30;
  if (/versatile|instruct/.test(s)) n += 10;
  if (/preview|deprecated|specdec/.test(s)) n -= 40;
  return n;
}
const pickModel = (ids) =>
  [...ids].sort((a, b) => rankModel(b) - rankModel(a) || a.localeCompare(b))[0];

async function ensureModel() {
  if (S.settings.groqModel) return S.settings.groqModel;
  const ids = await groqModels();
  if (!ids.length) throw new Error("No chat models available for this API key");
  S.settings.groqModel = pickModel(ids);
  save();
  return S.settings.groqModel;
}

async function groqChat(messages, opts = {}, retried = false) {
  const st = S.settings;
  if (!st.groqKey) throw new Error("Add your Groq API key in Settings");
  const model = await ensureModel();
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + st.groqKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages, temperature: opts.temp != null ? opts.temp : 0.4,
      max_tokens: opts.max || 900,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || "Groq HTTP " + r.status;
    if (!retried && /does not exist|decommissioned|model_not_found|not found/i.test(msg)) {
      const ids = await groqModels();
      if (ids.length) {
        S.settings.groqModel = pickModel(ids);
        save();
        toast("Model retired - switched to " + S.settings.groqModel, "ok");
        return groqChat(messages, opts, true);
      }
    }
    throw new Error(msg);
  }
  return (j.choices && j.choices[0] && j.choices[0].message.content) || "";
}
function coachContext() {
  const cal = activityCal();
  const ss = solveStats();
  return {
    date: iso(),
    solvedTotal: solvedTotal(),
    goal: S.settings.lcGoal,
    daysToGoalAt5PerDay: Math.max(0, Math.ceil((S.settings.lcGoal - solvedTotal()) / 5)),
    difficultySplit: S.lc ? { easy: S.lc.easy, medium: S.lc.medium, hard: S.lc.hard } : ss.byDifficulty,
    currentStreakDays: streakFrom(cal),
    solvedLast7Days: last7(cal),
    solvedThisWeek: last7(cal).reduce((a, b) => a + b, 0),
    solvesByTopic: ss.byTopic,
    thinnestTopics: ss.thinTopics,
    recentSolves: S.solves.slice(0, 12).map((s) => ({ title: s.title, difficulty: s.difficulty, topic: (s.topics || [])[0] || "misc", date: s.date })),
    githubContributionsThisYear: S.gh ? S.gh.contribTotal : null,
    tasksTodayPercent: todayTaskState().pct,
    skillMastery: { fullStack: skillAvg("fullstack"), aiml: skillAvg("aiml") },
  };
}
const NEETCODE = [
  ["two-sum", "Two Sum", "arrays-hashing", "Easy"], ["valid-anagram", "Valid Anagram", "arrays-hashing", "Easy"],
  ["contains-duplicate", "Contains Duplicate", "arrays-hashing", "Easy"], ["group-anagrams", "Group Anagrams", "arrays-hashing", "Medium"],
  ["top-k-frequent-elements", "Top K Frequent Elements", "arrays-hashing", "Medium"], ["product-of-array-except-self", "Product of Array Except Self", "arrays-hashing", "Medium"],
  ["longest-consecutive-sequence", "Longest Consecutive Sequence", "arrays-hashing", "Medium"],
  ["valid-palindrome", "Valid Palindrome", "two-pointers", "Easy"], ["3sum", "3Sum", "two-pointers", "Medium"],
  ["container-with-most-water", "Container With Most Water", "two-pointers", "Medium"],
  ["best-time-to-buy-and-sell-stock", "Best Time to Buy and Sell Stock", "sliding-window", "Easy"],
  ["longest-substring-without-repeating-characters", "Longest Substring Without Repeating Characters", "sliding-window", "Medium"],
  ["longest-repeating-character-replacement", "Longest Repeating Character Replacement", "sliding-window", "Medium"],
  ["minimum-window-substring", "Minimum Window Substring", "sliding-window", "Hard"],
  ["valid-parentheses", "Valid Parentheses", "stack", "Easy"], ["min-stack", "Min Stack", "stack", "Medium"],
  ["daily-temperatures", "Daily Temperatures", "stack", "Medium"], ["car-fleet", "Car Fleet", "stack", "Medium"],
  ["binary-search", "Binary Search", "binary-search", "Easy"], ["search-a-2d-matrix", "Search a 2D Matrix", "binary-search", "Medium"],
  ["koko-eating-bananas", "Koko Eating Bananas", "binary-search", "Medium"], ["find-minimum-in-rotated-sorted-array", "Find Minimum in Rotated Sorted Array", "binary-search", "Medium"],
  ["search-in-rotated-sorted-array", "Search in Rotated Sorted Array", "binary-search", "Medium"],
  ["reverse-linked-list", "Reverse Linked List", "linked-list", "Easy"], ["merge-two-sorted-lists", "Merge Two Sorted Lists", "linked-list", "Easy"],
  ["linked-list-cycle", "Linked List Cycle", "linked-list", "Easy"], ["reorder-list", "Reorder List", "linked-list", "Medium"],
  ["remove-nth-node-from-end-of-list", "Remove Nth Node From End of List", "linked-list", "Medium"], ["lru-cache", "LRU Cache", "linked-list", "Medium"],
  ["invert-binary-tree", "Invert Binary Tree", "trees", "Easy"], ["maximum-depth-of-binary-tree", "Maximum Depth of Binary Tree", "trees", "Easy"],
  ["diameter-of-binary-tree", "Diameter of Binary Tree", "trees", "Easy"], ["balanced-binary-tree", "Balanced Binary Tree", "trees", "Easy"],
  ["same-tree", "Same Tree", "trees", "Easy"], ["lowest-common-ancestor-of-a-binary-search-tree", "Lowest Common Ancestor of a BST", "trees", "Medium"],
  ["binary-tree-level-order-traversal", "Binary Tree Level Order Traversal", "trees", "Medium"], ["validate-binary-search-tree", "Validate Binary Search Tree", "trees", "Medium"],
  ["kth-smallest-element-in-a-bst", "Kth Smallest Element in a BST", "trees", "Medium"], ["construct-binary-tree-from-preorder-and-inorder-traversal", "Construct Tree from Preorder and Inorder", "trees", "Medium"],
  ["binary-tree-maximum-path-sum", "Binary Tree Maximum Path Sum", "trees", "Hard"], ["serialize-and-deserialize-binary-tree", "Serialize and Deserialize Binary Tree", "trees", "Hard"],
  ["implement-trie-prefix-tree", "Implement Trie", "tries", "Medium"], ["design-add-and-search-words-data-structure", "Design Add and Search Words", "tries", "Medium"],
  ["word-search-ii", "Word Search II", "tries", "Hard"],
  ["kth-largest-element-in-a-stream", "Kth Largest Element in a Stream", "heap", "Easy"], ["last-stone-weight", "Last Stone Weight", "heap", "Easy"],
  ["k-closest-points-to-origin", "K Closest Points to Origin", "heap", "Medium"], ["find-median-from-data-stream", "Find Median from Data Stream", "heap", "Hard"],
  ["subsets", "Subsets", "backtracking", "Medium"], ["combination-sum", "Combination Sum", "backtracking", "Medium"],
  ["permutations", "Permutations", "backtracking", "Medium"], ["word-search", "Word Search", "backtracking", "Medium"],
  ["number-of-islands", "Number of Islands", "graphs", "Medium"], ["clone-graph", "Clone Graph", "graphs", "Medium"],
  ["pacific-atlantic-water-flow", "Pacific Atlantic Water Flow", "graphs", "Medium"], ["course-schedule", "Course Schedule", "graphs", "Medium"],
  ["rotting-oranges", "Rotting Oranges", "graphs", "Medium"], ["graph-valid-tree", "Graph Valid Tree", "graphs", "Medium"],
  ["climbing-stairs", "Climbing Stairs", "1d-dp", "Easy"], ["house-robber", "House Robber", "1d-dp", "Medium"],
  ["house-robber-ii", "House Robber II", "1d-dp", "Medium"], ["longest-palindromic-substring", "Longest Palindromic Substring", "1d-dp", "Medium"],
  ["palindromic-substrings", "Palindromic Substrings", "1d-dp", "Medium"], ["decode-ways", "Decode Ways", "1d-dp", "Medium"],
  ["coin-change", "Coin Change", "1d-dp", "Medium"], ["maximum-product-subarray", "Maximum Product Subarray", "1d-dp", "Medium"],
  ["word-break", "Word Break", "1d-dp", "Medium"], ["longest-increasing-subsequence", "Longest Increasing Subsequence", "1d-dp", "Medium"],
  ["unique-paths", "Unique Paths", "2d-dp", "Medium"], ["longest-common-subsequence", "Longest Common Subsequence", "2d-dp", "Medium"],
  ["edit-distance", "Edit Distance", "2d-dp", "Medium"],
  ["maximum-subarray", "Maximum Subarray", "greedy", "Medium"], ["jump-game", "Jump Game", "greedy", "Medium"],
  ["insert-interval", "Insert Interval", "intervals", "Medium"], ["merge-intervals", "Merge Intervals", "intervals", "Medium"],
  ["non-overlapping-intervals", "Non-overlapping Intervals", "intervals", "Medium"],
  ["single-number", "Single Number", "bit-manipulation", "Easy"], ["number-of-1-bits", "Number of 1 Bits", "bit-manipulation", "Easy"],
  ["counting-bits", "Counting Bits", "bit-manipulation", "Easy"], ["reverse-bits", "Reverse Bits", "bit-manipulation", "Easy"],
  ["missing-number", "Missing Number", "bit-manipulation", "Easy"],
];
function nextProblemPool() {
  const done = new Set(S.solves.map((s) => s.slug));
  const thin = new Set(solveStats().thinTopics);
  return NEETCODE.filter((p) => !done.has(p[0]))
    .map((p) => ({ slug: p[0], title: p[1], topic: p[2], difficulty: p[3], weakBoost: thin.has(p[2]) }))
    .sort((a, b) => (b.weakBoost - a.weakBoost))
    .slice(0, 24);
}

const COACH = {
  brief: {
    label: "Daily briefing", icon: "🗒️",
    build: () => [
      { role: "system", content: "You are a concise, no-fluff coding-interview coach. Reply in short markdown: a one-line status read, then 3-5 bullet actions for TODAY, then one sentence of encouragement. No preamble." },
      { role: "user", content: "My stats:\n" + JSON.stringify(coachContext(), null, 1) + "\n\nGive me today's plan." },
    ],
  },
  next: {
    label: "What to solve next", icon: "🎯",
    build: () => [
      { role: "system", content: "You are a coding-interview coach. From the candidate pool, pick the best 3 next problems given the student's weak topics and level. For each: **name** (topic, difficulty) then one line why. Markdown list only." },
      { role: "user", content: "Weak/thin topics: " + JSON.stringify(solveStats().thinTopics) + "\nAlready solved this week: " + last7(activityCal()).reduce((a, b) => a + b, 0) +
        "\nCandidate pool:\n" + nextProblemPool().map((p) => `- ${p.title} (${p.topic}, ${p.difficulty})`).join("\n") },
    ],
  },
  retro: {
    label: "Weekly retro", icon: "📅",
    build: () => [
      { role: "system", content: "You are a coding-interview coach running a weekly retrospective. Reply in markdown with: **What went well**, **What slipped**, **Next week's 3 targets**. Be specific and reference the numbers." },
      { role: "user", content: "This week's data:\n" + JSON.stringify(coachContext(), null, 1) },
    ],
  },
};
async function runCoach(kind) {
  const spec = COACH[kind];
  if (!spec) return;
  const box = el("coachOut");
  if (box) box.innerHTML = `<div class="faint"><span class="spin"></span> thinking…</div>`;
  try {
    const text = await groqChat(spec.build(), { max: 800 });
    S.ai.history.unshift({ kind, date: new Date().toISOString(), text });
    S.ai.history = S.ai.history.slice(0, 30);
    save();
    if (current === "coach") rerender(); else go("coach");
  } catch (e) {
    if (box) box.innerHTML = `<div class="badge b-red">${esc(e.message)}</div>`;
    else toast(e.message, "err");
  }
}
async function reviewSolution() {
  const codeEl = el("revCode"), out = el("revOut");
  const code = (codeEl && codeEl.value || "").trim();
  const prob = (el("revProb") && el("revProb").value || "").trim();
  if (!code) return toast("Paste your solution first");
  if (out) out.innerHTML = `<div class="faint"><span class="spin"></span> reviewing…</div>`;
  try {
    const text = await groqChat([
      { role: "system", content: "You are a senior interviewer reviewing a LeetCode solution. Give: **Time / space complexity**, **Correctness & edge cases** (list any missed), **Cleaner approach** (only if meaningfully better — short code ok), **Verdict** (is this the optimal approach for an interview?), **Next 2 problems** to reinforce. Do NOT rewrite the whole thing unless it's wrong. Markdown, tight." },
      { role: "user", content: (prob ? "Problem: " + prob + "\n\n" : "") + "```\n" + code.slice(0, 6000) + "\n```" },
    ], { max: 900 });
    if (out) out.innerHTML = `<div class="md-body">${mdToHtml(text)}</div>
      <div style="margin-top:10px"><button class="btn btn-sm" data-action="review-save">Save to a solve entry's notes</button></div>`;
    window._lastReview = text;
  } catch (e) {
    if (out) out.innerHTML = `<div class="badge b-red">${esc(e.message)}</div>`;
  }
}

/* ============================================================
   JOB FEED — fetch · normalize · score
   ============================================================ */
const jid = (src, id) => src + ":" + id;
const stripTags = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
const jobDate = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : Date.now(); };

/* --- per-source normalizers --- */
const NORM = {
  greenhouse: (d, b) => (d.jobs || []).map((x) => ({
    id: jid("gh", b.slug + "-" + x.id), src: "greenhouse", srcLabel: b.name,
    company: b.name, title: x.title || "",
    loc: (x.location && x.location.name) || "", url: x.absolute_url,
    posted: jobDate(x.updated_at || x.first_published), tags: [], salary: "",
  })),
  lever: (d, b) => (Array.isArray(d) ? d : []).map((x) => ({
    id: jid("lv", b.slug + "-" + x.id), src: "lever", srcLabel: b.name,
    company: b.name, title: x.text || "",
    loc: (x.categories && x.categories.location) || "", url: x.hostedUrl,
    posted: jobDate(x.createdAt), salary: "",
    tags: [x.categories && x.categories.team, x.categories && x.categories.commitment].filter(Boolean),
  })),
  ashby: (d, b) => (d.jobs || []).map((x) => ({
    id: jid("ab", b.slug + "-" + x.id), src: "ashby", srcLabel: b.name,
    company: b.name, title: x.title || "",
    loc: x.location || "", url: x.jobUrl || x.applyUrl,
    posted: jobDate(x.publishedAt), salary: "",
    tags: [x.department, x.employmentType].filter(Boolean),
  })),
  remotive: (d) => (d.jobs || []).map((x) => ({
    id: jid("rmv", x.id), src: "remotive", srcLabel: "Remotive",
    company: x.company_name || "", title: x.title || "",
    loc: x.candidate_required_location || "Remote", url: x.url,
    posted: jobDate(x.publication_date), salary: x.salary || "",
    tags: [x.category, x.job_type].filter(Boolean),
  })),
  remoteok: (d) => (Array.isArray(d) ? d : []).filter((x) => x && x.id && x.position).map((x) => ({
    id: jid("rok", x.id), src: "remoteok", srcLabel: "Remote OK",
    company: x.company || "", title: x.position || "",
    loc: x.location || "Remote", url: x.apply_url || x.url,
    posted: jobDate(x.date), tags: (x.tags || []).slice(0, 6),
    salary: x.salary_min ? `$${Math.round(x.salary_min / 1000)}k–${Math.round((x.salary_max || 0) / 1000)}k` : "",
  })),
  jobicy: (d) => (d.jobs || []).map((x) => ({
    id: jid("jby", x.id), src: "jobicy", srcLabel: "Jobicy",
    company: x.companyName || "", title: x.jobTitle || "",
    loc: x.jobGeo || "Remote", url: x.url, posted: jobDate(x.pubDate),
    tags: [].concat(x.jobIndustry || [], x.jobType || []).slice(0, 5),
    salary: x.annualSalaryMin ? `${x.salaryCurrency || ""}${x.annualSalaryMin}+` : "",
  })),
  arbeitnow: (d) => (d.data || []).map((x) => ({
    id: jid("abn", x.slug), src: "arbeitnow", srcLabel: "Arbeitnow",
    company: x.company_name || "", title: x.title || "",
    loc: x.location || (x.remote ? "Remote" : ""), url: x.url,
    posted: jobDate((x.created_at || 0) * 1000),
    tags: (x.tags || []).slice(0, 5), salary: "",
  })),
  themuse: (d) => (d.results || []).map((x) => ({
    id: jid("muse", x.id), src: "themuse", srcLabel: "The Muse",
    company: (x.company && x.company.name) || "", title: x.name || "",
    loc: (x.locations || []).map((l) => l.name).join(", "), url: x.refs && x.refs.landing_page,
    posted: jobDate(x.publication_date), salary: "",
    tags: (x.categories || []).map((c) => c.name).concat((x.levels || []).map((l) => l.name)).slice(0, 4),
  })),
};

function parseWWR(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const pick = (it, tag) => { const n = it.getElementsByTagName(tag)[0]; return n ? n.textContent.trim() : ""; };
  return [...doc.getElementsByTagName("item")].map((it) => {
    const raw = pick(it, "title");
    const ix = raw.indexOf(":");
    const company = ix > 0 ? raw.slice(0, ix).trim() : "";
    const title = ix > 0 ? raw.slice(ix + 1).trim() : raw;
    const link = pick(it, "link");
    return {
      id: jid("wwr", link || raw), src: "wwr", srcLabel: "We Work Remotely",
      company, title, loc: pick(it, "region") || "Remote", url: link,
      posted: jobDate(pick(it, "pubDate")), salary: "",
      tags: [pick(it, "category"), pick(it, "type")].filter(Boolean),
      desc: stripTags(pick(it, "skills")),
    };
  });
}

async function fetchHN() {
  const s = await fetchJSON("https://hn.algolia.com/api/v1/search?tags=story,author_whoishiring&query=hiring&hitsPerPage=5", 12000);
  const story = (s.hits || []).filter((h) => /who is hiring/i.test(h.title || ""))
    .sort((a, b) => b.created_at_i - a.created_at_i)[0];
  if (!story) return [];
  const thread = await fetchJSON(`https://hn.algolia.com/api/v1/items/${story.objectID}`, 15000);
  return (thread.children || []).filter((c) => c && c.text).slice(0, 200).map((c) => {
    const text = stripTags(c.text);
    const first = text.split("|").map((s2) => s2.trim());
    return {
      id: jid("hn", c.id), src: "hn", srcLabel: "HN Who's Hiring",
      company: first[0] ? first[0].slice(0, 60) : "(see post)",
      title: first.slice(1, 3).join(" · ").slice(0, 90) || text.slice(0, 90),
      loc: /remote/i.test(text) ? "Remote" : "", url: `https://news.ycombinator.com/item?id=${c.id}`,
      posted: jobDate((c.created_at_i || 0) * 1000), tags: ["HN"], salary: "", desc: text.slice(0, 400),
    };
  });
}

/* --- scoring ---
   Terms are matched on word boundaries, so "lead" hits "Lead, Engineering"
   but not "Leadership", and "sr" hits "Sr." but not "SRE".            */
const IN_CITY = /\b(india|bengaluru|bangalore|hyderabad|pune|gurgaon|gurugram|noida|mumbai|delhi|chennai|kolkata)\b/;
const normTerm = (s) => " " + String(s || "").toLowerCase().replace(/[^a-z0-9+#]+/g, " ").replace(/\s+/g, " ").trim() + " ";
/* seniority markers get written as "Staff+" / "Senior+", so exclude-matching
   runs on a variant with +/# stripped; include-matching keeps them for c++/c#. */
const normPlain = (s) => normTerm(String(s || "").replace(/[+#]/g, " "));
const hasTerm = (hay, term) => { const t = normTerm(term); return t.length > 2 && hay.includes(t); };

function scoreJob(job, f) {
  const title = normTerm(job.title);
  const titlePlain = normPlain(job.title);
  const hay = normTerm([job.title, (job.tags || []).join(" "), job.desc || ""].join(" "));
  const loc = (job.loc || "").toLowerCase();

  for (const bad of f.exclude) if (hasTerm(titlePlain, bad) || hasTerm(title, bad)) return -1;
  if (f.indiaOnly && !IN_CITY.test(loc)) return -1;

  /* a role must match at least one skill keyword — location and seniority
     are modifiers, never qualifiers on their own */
  let skill = 0, hits = [];
  for (const k of f.include) {
    if (hasTerm(title, k)) { skill += 3; hits.push(k.trim()); }
    else if (hasTerm(hay, k)) { skill += 1; hits.push(k.trim()); }
  }
  if (skill === 0) return -1;

  let score = skill;
  for (const lv of f.levels) if (hasTerm(title, lv)) { score += 4; hits.push(lv.trim()); break; }
  if (IN_CITY.test(loc)) score += 3;
  else if (/\b(remote|anywhere|worldwide)\b/.test(loc)) score += 1;
  if (Date.now() - job.posted < 7 * 864e5) score += 2;
  job.hits = [...new Set(hits)].slice(0, 5);
  return score;
}

let feedBusy = false;
async function refreshFeed(opts = {}) {
  if (feedBusy) return;
  feedBusy = true;
  const jf = S.jobfeed;
  const errs = [];
  setSync("busy", `<span class="spin"></span> Fetching jobs…`);
  if (!opts.silent) rerender();

  const tasks = [];
  for (const b of jf.boards.filter((x) => x.on)) {
    const url = b.ats === "greenhouse" ? `https://boards-api.greenhouse.io/v1/boards/${b.slug}/jobs`
      : b.ats === "lever" ? `https://api.lever.co/v0/postings/${b.slug}?mode=json`
      : `https://api.ashbyhq.com/posting-api/job-board/${b.slug}`;
    tasks.push(fetchJSON(url, 15000).then((d) => NORM[b.ats](d, b))
      .catch(() => { errs.push(b.name); return []; }));
  }
  const agg = jf.aggregators;
  if (agg.remotive.on) tasks.push(fetchJSON("https://remotive.com/api/remote-jobs?limit=200", 15000).then(NORM.remotive).catch(() => { errs.push("Remotive"); return []; }));
  if (agg.remoteok.on) tasks.push(fetchJSON("https://remoteok.com/api", 15000).then(NORM.remoteok).catch(() => { errs.push("Remote OK"); return []; }));
  if (agg.jobicy.on) tasks.push(fetchJSON("https://jobicy.com/api/v2/remote-jobs?count=100", 15000).then(NORM.jobicy).catch(() => { errs.push("Jobicy"); return []; }));
  if (agg.arbeitnow.on) tasks.push(fetchJSON("https://www.arbeitnow.com/api/job-board-api", 15000).then(NORM.arbeitnow).catch(() => { errs.push("Arbeitnow"); return []; }));
  if (agg.themuse.on) tasks.push(fetchJSON("https://www.themuse.com/api/public/jobs?page=1", 15000).then(NORM.themuse).catch(() => { errs.push("The Muse"); return []; }));
  if (agg.wwr.on) tasks.push(fetch("https://weworkremotely.com/remote-jobs.rss").then((r) => r.text()).then(parseWWR).catch(() => { errs.push("We Work Remotely"); return []; }));
  if (agg.hn.on) tasks.push(fetchHN().catch(() => { errs.push("HN"); return []; }));
  /* jobs-feed.json written by feed-agent.mjs — carries the CORS-blocked boards.
     Absent on a fresh checkout, so a miss is silent rather than an error. */
  if (agg.agent.on) tasks.push(
    fetchJSON("./jobs-feed.json?t=" + Date.now(), 8000)
      .then((d) => (d.jobs || []).map((j) => Object.assign({}, j, { srcLabel: j.srcLabel || "Agent" })))
      .catch(() => []));

  const batches = await Promise.all(tasks);
  const f = jf.filters;
  const byId = new Map();
  for (const list of batches) {
    for (const job of list) {
      if (!job || !job.url || !job.title) continue;
      if (jf.dismissed[job.id]) continue;
      const sc = scoreJob(job, f);
      if (sc < (f.minScore || 0)) continue;
      job.score = sc;
      job.isNew = !jf.seen[job.id];
      if (!byId.has(job.id)) byId.set(job.id, job);
    }
  }
  const jobs = [...byId.values()].sort((a, b) =>
    (b.isNew - a.isNew) || (b.score - a.score) || (b.posted - a.posted));

  jf.cache = jobs.slice(0, 800);
  jf.errors = errs;
  jf.lastFetch = Date.now();
  save();
  feedBusy = false;
  const fresh = jobs.filter((j) => j.isNew).length;
  setSync(errs.length ? "err" : "ok", (errs.length ? "Partial " : "Synced ") + ago(Date.now()));
  if (!opts.silent) {
    toast(`${jobs.length} matches · ${fresh} new${errs.length ? ` · ${errs.length} source(s) failed` : ""}`, errs.length ? "err" : "ok");
    rerender();
  }
  return fresh;
}
function markFeedSeen() {
  for (const j of S.jobfeed.cache) { S.jobfeed.seen[j.id] = true; j.isNew = false; }
  save();
}

let syncing = false;
async function syncAll(opts = {}) {
  if (syncing) return;
  const wantLC = !!S.settings.leetcode, wantGH = !!S.settings.github;
  if (!wantLC && !wantGH) {
    if (!opts.silent) toast("Add your LeetCode / GitHub username in Settings first");
    return;
  }
  syncing = true;
  setSync("busy", `<span class="spin"></span> Syncing…`);
  const results = [];
  let newSolves = 0;
  if (wantLC) {
    try {
      S.lc = await fetchLeetCode(S.settings.leetcode);
      results.push("LeetCode ✓");
      try { newSolves = await ingestRecentSolves(S.lc.recent); } catch (e) { /* non-fatal */ }
    }
    catch (e) { results.push("LeetCode ✗"); if (!opts.silent) toast("LeetCode sync failed — " + e.message + ". You can enter numbers manually on the LeetCode page.", "err"); }
  }
  if (wantGH) {
    try { S.gh = await fetchGitHub(S.settings.github); results.push("GitHub ✓"); }
    catch (e) { results.push("GitHub ✗"); if (!opts.silent) toast("GitHub sync failed — " + e.message, "err"); }
  }
  syncing = false;
  save();
  const ok = results.every((r) => r.includes("✓"));
  setSync(ok ? "ok" : "err", (ok ? "Synced " : "Partial ") + ago(Date.now()));
  if (!opts.silent && ok) toast(results.join("  ·  "), "ok");
  if (newSolves > 0) toast(`${newSolves} new solve${newSolves === 1 ? "" : "s"} logged from LeetCode`, "ok");
  rerender();
}
function setSync(kind, html) {
  const c = el("syncChip");
  if (c) { c.className = "sync-chip " + kind; c.innerHTML = html; }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
const NAV = [
  { group: "Overview", items: [
    { id: "overview", label: "Dashboard", icon: "▚" },
    { id: "schedule", label: "Schedule", icon: "◷" },
    { id: "daily", label: "Daily Tracker", icon: "✔" },
  ]},
  { group: "Tracking", items: [
    { id: "leetcode", label: "LeetCode", icon: "λ" },
    { id: "solves", label: "Solutions", icon: "❯" },
    { id: "github", label: "GitHub", icon: "⑂" },
  ]},
  { group: "AI", items: [
    { id: "coach", label: "Coach", icon: "✦" },
  ]},
  { group: "Build", items: [
    { id: "skills", label: "Skills", icon: "▤" },
    { id: "projects", label: "Projects", icon: "◆" },
  ]},
  { group: "Career", items: [
    { id: "jobfeed", label: "Job Feed", icon: "◎" },
    { id: "jobs", label: "Job Tracker", icon: "▦" },
  ]},
  { group: "System", items: [
    { id: "analytics", label: "Analytics", icon: "▮" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ]},
];
const TITLES = {};
NAV.forEach((g) => g.items.forEach((i) => (TITLES[i.id] = i.label)));

let current = "overview";
function buildNav() {
  el("nav").innerHTML = NAV.map((g) => `
    <div class="nav-group">${g.group}</div>
    ${g.items.map((i) => `
      <button class="nav-item" data-action="nav" data-view="${i.id}">
        <span class="ni-icon">${i.icon}</span>${i.label}
      </button>`).join("")}
  `).join("");
}
function go(view) {
  if (!ROUTES[view]) view = "overview";
  current = view;
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  el("pageTitle").textContent = TITLES[view] || "Dashboard";
  el("content").innerHTML = `<div class="view">${ROUTES[view]()}</div>`;
  ROUTES_AFTER[view] && ROUTES_AFTER[view]();
  el("app").classList.remove("nav-open");
  window.scrollTo(0, 0);
  location.hash = view;
}
function rerender() { go(current); updateChrome(); }

/* ============================================================
   VIEWS
   ============================================================ */
const ROUTES = {};
const ROUTES_AFTER = {};

/* ---------- Dashboard ---------- */
ROUTES.overview = function () {
  const ps = practiceStats();
  const cal = activityCal();
  const streak = streakFrom(cal);
  const solved = solvedTotal();
  const goal = S.settings.lcGoal;
  const tt = todayTaskState();
  const now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
  const cur = S.schedule.find((s) => {
    const a = toMins(s.st), b = toMins(s.en);
    return a < b ? nowM >= a && nowM < b : nowM >= a || nowM < b;
  });
  const week = [...Array(7)].map((_, i) => {
    const d = addDays(now, -(6 - i));
    return { label: d.toLocaleDateString("en", { weekday: "short" })[0], value: cal[iso(d)] || 0, target: 5 };
  });
  const connected = S.lc || S.gh;

  return `
  <div class="topline" style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
    <div>
      <div class="page-title">Mission Control</div>
      <div class="page-sub">Your engineering grind, one dashboard.</div>
    </div>
    <div style="text-align:right">
      <div class="clock" id="dashClock">--:--</div>
      <div class="faint" style="font-size:12px">${fmtDate(now)}</div>
    </div>
  </div>

  ${!S.settings.leetcode && !S.settings.github ? `
    <div class="card" style="border-color:color-mix(in srgb,var(--accent) 30%,transparent);background:var(--accent-weak)">
      <div class="card-head" style="margin-bottom:8px"><div class="card-title">👋 Connect your accounts</div></div>
      <p class="mut" style="font-size:13px;margin-bottom:12px">Add your LeetCode and GitHub usernames to pull real solved counts, streaks and contribution graphs automatically.</p>
      <button class="btn btn-primary" data-action="nav" data-view="settings">Open Settings →</button>
    </div>` : ""}

  ${cur ? `<div class="now-strip">
    <span class="pulse"></span>
    <span class="faint" style="font-size:10.5px;letter-spacing:1.5px;text-transform:uppercase">Now</span>
    <span style="font-size:15px">${cur.icon}</span>
    <strong style="font-size:14px">${esc(cur.label)}</strong>
    <span class="right faint tabnum" style="font-size:12px">${cur.st} – ${cur.en}</span>
  </div>` : ""}

  <div class="grid g-4" style="margin-bottom:14px">
    ${stat("Problems Solved", solved, `of ${goal} goal · ${pct(solved, goal)}%`, { icon: "λ", color: solved ? "var(--accent)" : "var(--faint)" })}
    ${stat("Day Streak", streak || 0, streak ? "keep it alive 🔥" : "solve today to start", { icon: streak ? "🔥" : "·", color: streak ? "var(--amber)" : "var(--faint)" })}
    ${stat("Tasks Today", tt.done + "/" + tt.total, tt.pct + "% complete", { icon: "✔", color: tt.done ? "var(--green)" : "var(--faint)" })}
    ${stat("Solved Today", ps.today, ps.today >= 5 ? "target hit 🎯" : "target: 5/day", { icon: "📈", color: ps.today ? "var(--accent)" : "var(--faint)" })}
  </div>

  <div class="grid g-2" style="margin-bottom:14px">
    <div class="card">
      <div class="card-head"><div class="card-title">Problem goal</div><span class="badge b-accent">${pct(solved, goal)}%</span></div>
      <div class="ring-wrap">
        <div class="ring-center">
          ${ring(pct(solved, goal))}
          <div class="rc-text"><div class="rc-big">${solved}</div><div class="rc-small">of ${goal}</div></div>
        </div>
        <div style="flex:1">
          <div class="split" style="margin-bottom:10px">
            <div class="cell"><div class="cv" style="color:var(--green)">${S.lc ? S.lc.easy : ps.easy}</div><div class="cl">Easy</div></div>
            <div class="cell"><div class="cv" style="color:var(--amber)">${S.lc ? S.lc.medium : ps.medium}</div><div class="cl">Medium</div></div>
            <div class="cell"><div class="cv" style="color:var(--red)">${S.lc ? S.lc.hard : ps.hard}</div><div class="cl">Hard</div></div>
          </div>
          ${solved ? `<div class="faint" style="font-size:12px">~${Math.ceil((goal - solved) / 5)} days left at 5/day</div>` : `<div class="faint" style="font-size:12px">Log a problem to get moving</div>`}
          <div style="margin-top:10px"><button class="btn btn-sm" data-action="nav" data-view="leetcode">Open LeetCode →</button></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">This week</div>
        <span class="faint tabnum" style="font-size:12px">${week.reduce((a, d) => a + d.value, 0)} solved</span></div>
      ${week.some((d) => d.value) ? barChart(week) : empty("📊", "No activity yet", "Sync LeetCode or log practice to fill this in")}
    </div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="card-head"><div class="card-title">Activity · last 26 weeks</div>
      ${S.lc ? `<span class="badge b-muted">LeetCode + practice</span>` : `<span class="badge b-muted">practice log</span>`}</div>
    ${Object.keys(cal).length ? heatmap(cal, { weeks: 26 }) : empty("🟩", "Nothing here yet", "Your activity graph lights up as you solve")}
  </div>

  ${(() => {
    const ssd = solveStats();
    const bits = [];
    if (ssd.needCode) bits.push(`<button class="btn btn-sm" data-action="nav" data-view="solves">✎ ${ssd.needCode} synced solve${ssd.needCode === 1 ? "" : "s"} need code</button>`);
    if (ssd.readyToPush && S.settings.ghToken) bits.push(`<button class="btn btn-sm btn-primary" data-action="solve-backfill">⬆ Push ${ssd.readyToPush} to GitHub</button>`);
    if (S.settings.groqKey) bits.push(`<button class="btn btn-sm" data-action="coach-run" data-kind="brief">✦ Daily briefing</button>`);
    return bits.length ? `<div class="card" style="margin-bottom:14px"><div class="wrap" style="align-items:center">
      <span class="section-label" style="margin:0">Quick actions</span>${bits.join("")}</div><div id="coachOut"></div></div>` : "";
  })()}

  ${S.gh ? `<div class="card">
    <div class="card-head"><div class="card-title">GitHub · ${esc(S.gh.profile.login)}</div>
      <span class="faint tabnum" style="font-size:12px">${S.gh.contribTotal || 0} contributions / yr</span></div>
    ${S.gh.contributions.length ? heatmap(calFromContrib(S.gh.contributions), { weeks: 26, palette: ["var(--gh0)", "var(--gh1)", "var(--gh2)", "var(--gh3)", "var(--gh4)"] }) : empty("⑂", "No contribution data", "")}
  </div>` : ""}
  `;
};
ROUTES_AFTER.overview = startDashClock;

function calFromContrib(arr) {
  const o = {};
  arr.forEach((x) => (o[x.date] = x.count));
  return o;
}

/* ---------- Schedule ---------- */
ROUTES.schedule = function () {
  const now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
  const state = (s) => {
    const a = toMins(s.st), b = toMins(s.en);
    const live = a < b ? (nowM >= a && nowM < b) : (nowM >= a || nowM < b);
    if (live) return "live";
    return (a < b ? nowM >= b : false) ? "past" : "future";
  };
  const cur = S.schedule.find((s) => state(s) === "live");
  return `
  <div class="page-title">Daily Schedule</div>
  <div class="page-sub">Your routine, block by block. Edit any row — it's yours to shape.</div>

  <div class="card" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <div><div class="section-label" style="margin:0 0 4px">Current time</div>
      <div class="clock" id="schClock">--:--</div></div>
    ${cur ? `<div style="text-align:right"><div class="section-label" style="margin:0 0 4px">Active block</div>
      <div style="font-weight:700">${cur.icon} ${esc(cur.label)}</div>
      <div class="sched-time">${cur.st} – ${cur.en}</div></div>` : `<span class="badge b-muted">Off schedule</span>`}
  </div>

  <div class="card">
    <div class="card-head"><div class="card-title">Blocks</div>
      <button class="btn btn-sm" data-action="sched-add">+ Add block</button></div>
    <div class="stack" style="gap:4px">
      ${S.schedule.map((s, i) => {
        const st = state(s);
        return `<div class="sched-item ${st}">
          <span class="sched-ico">${s.icon}</span>
          <input class="input" style="max-width:130px;padding:5px 8px" value="${esc(s.label)}" data-action="sched-edit" data-i="${i}" data-k="label">
          <input class="input tabnum" style="max-width:70px;padding:5px 6px" value="${s.st}" data-action="sched-edit" data-i="${i}" data-k="st">
          <span class="faint">–</span>
          <input class="input tabnum" style="max-width:70px;padding:5px 6px" value="${s.en}" data-action="sched-edit" data-i="${i}" data-k="en">
          ${st === "live" ? `<span class="badge b-accent right">LIVE</span>` : st === "past" ? `<span class="right faint">✓</span>` : `<span class="right"></span>`}
          <button class="icon-btn" style="width:26px;height:26px;font-size:12px" data-action="sched-del" data-i="${i}" title="Remove">✕</button>
        </div>`;
      }).join("")}
    </div>
  </div>`;
};
ROUTES_AFTER.schedule = startSchClock;

/* ---------- Daily Tracker ---------- */
ROUTES.daily = function () {
  const tt = todayTaskState();
  const ps = practiceStats();
  return `
  <div class="page-title">Daily Tracker</div>
  <div class="page-sub">Check off each block as you finish. Resets every calendar day.</div>

  <div class="card" style="margin-bottom:14px">
    <div class="card-head">
      <div><div class="card-title">Today's completion</div>
        <div class="faint" style="font-size:12px">${tt.done} of ${tt.total} done</div></div>
      <div class="num" style="font-size:30px;color:${tt.pct === 100 ? "var(--green)" : "var(--accent)"}">${tt.pct}%</div>
    </div>
    ${progress(tt.done, tt.total, { color: tt.pct === 100 ? "var(--green)" : "var(--accent)" })}
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="card-head"><div class="card-title">Blocks</div>
      <button class="btn btn-sm" data-action="task-add">+ Add task</button></div>
    <div class="stack" style="gap:2px">
      ${S.taskDefs.map((t) => {
        const done = !!tt.map[t.id];
        return `<div class="row-item ${done ? "done" : ""}" data-action="task-toggle" data-id="${t.id}">
          <span class="check">${done ? "✓" : ""}</span>
          <span class="ri-ico">${t.icon}</span>
          <span class="ri-text">${esc(t.label)}</span>
          <span class="badge b-muted">${esc(t.cat)}</span>
          <button class="icon-btn" style="width:24px;height:24px;font-size:11px" data-action="task-del" data-id="${t.id}" title="Remove">✕</button>
        </div>`;
      }).join("")}
    </div>
  </div>

  <div class="card">
    <div class="card-head"><div class="card-title">Log practice problems</div>
      <span class="faint tabnum" style="font-size:12px">Today: ${ps.today} · Total: ${ps.total}</span></div>
    <p class="faint" style="font-size:11.5px;margin-bottom:12px">Use this if you solve outside LeetCode (books, Codeforces, mock interviews). LeetCode syncs separately.</p>
    <div class="grid g-3" style="gap:8px;margin-bottom:12px">
      <button class="btn" data-action="practice-add" data-diff="easy">✅ + Easy</button>
      <button class="btn" data-action="practice-add" data-diff="medium">⭐ + Medium</button>
      <button class="btn" data-action="practice-add" data-diff="hard">🔥 + Hard</button>
    </div>
    <div style="display:flex;gap:12px;align-items:center">
      <div style="flex:1">${progress(ps.today, 5, { color: ps.today >= 5 ? "var(--green)" : "var(--accent)" })}
        <div class="faint" style="font-size:11.5px;margin-top:5px">${ps.today >= 5 ? "Daily target reached ✅" : `${5 - ps.today} more to hit 5/day`}</div></div>
      <button class="btn btn-sm" data-action="practice-undo">Undo last</button>
    </div>
  </div>`;
};

/* ---------- LeetCode ---------- */
ROUTES.leetcode = function () {
  const set = S.settings, lc = S.lc, ps = practiceStats();
  const goal = set.lcGoal;
  const solved = lc ? lc.solved : ps.total;
  const cal = lc ? lc.calendar : ps.cal;
  const e = lc ? lc.easy : ps.easy, m = lc ? lc.medium : ps.medium, h = lc ? lc.hard : ps.hard;

  return `
  <div class="page-title">LeetCode</div>
  <div class="page-sub">${lc ? `Synced from <strong>${esc(lc.source)}</strong> · ${ago(lc.lastSync)}` : "Not synced — connect your username or enter numbers manually."}</div>

  <div class="card" style="margin-bottom:14px">
    <div class="card-head"><div class="card-title">Account</div>
      ${lc ? `<span class="badge b-green">connected</span>` : `<span class="badge b-muted">offline</span>`}</div>
    <div class="connect">
      <div class="field"><label class="field-label">LeetCode username</label>
        <input class="input" id="lcUser" placeholder="e.g. john_doe" value="${esc(set.leetcode)}"></div>
      <button class="btn btn-primary" data-action="lc-connect">${lc ? "Re-sync" : "Connect & sync"}</button>
      ${lc ? `<button class="btn btn-ghost" data-action="lc-disconnect">Disconnect</button>` : ""}
    </div>
    <div class="hr"></div>
    <div class="section-label" style="margin-bottom:8px">Manual override</div>
    <p class="faint" style="font-size:11.5px;margin-bottom:10px">If the API is down, type your counts here. Manual values fill in until the next successful sync.</p>
    <div class="grid g-4" style="gap:8px">
      <div><label class="field-label">Easy</label><input class="input" type="number" min="0" id="mE" value="${e || ""}"></div>
      <div><label class="field-label">Medium</label><input class="input" type="number" min="0" id="mM" value="${m || ""}"></div>
      <div><label class="field-label">Hard</label><input class="input" type="number" min="0" id="mH" value="${h || ""}"></div>
      <div style="display:flex;align-items:flex-end"><button class="btn" style="width:100%;justify-content:center" data-action="lc-manual">Save manual</button></div>
    </div>
  </div>

  <div class="grid g-4" style="margin-bottom:14px">
    ${stat("Total Solved", solved, "goal " + goal, { icon: "λ", color: "var(--accent)" })}
    ${stat("Easy", e, "", { icon: "🟢", color: "var(--green)" })}
    ${stat("Medium", m, "", { icon: "🟡", color: "var(--amber)" })}
    ${stat("Hard", h, "", { icon: "🔴", color: "var(--red)" })}
  </div>

  ${lc ? `<div class="grid g-4" style="margin-bottom:14px">
    ${stat("Ranking", lc.ranking ? "#" + lc.ranking.toLocaleString() : "—", "global", { icon: "🏆" })}
    ${stat("Acceptance", lc.acceptance != null ? lc.acceptance + "%" : "—", "", { icon: "✓" })}
    ${stat("Total Questions", lc.totalQ ? lc.totalQ.toLocaleString() : "—", "on LeetCode", { icon: "Σ" })}
    ${stat("Streak", streakFrom(cal) + "d", "consecutive", { icon: "🔥", color: "var(--amber)" })}
  </div>` : ""}

  <div class="card" style="margin-bottom:14px">
    <div class="card-head"><div class="card-title">Goal progress</div><span class="badge b-accent">${pct(solved, goal)}%</span></div>
    ${progress(solved, goal)}
    <div style="display:flex;justify-content:space-between;margin-top:8px" class="faint">
      <span style="font-size:12px">Goal: ${goal} <button class="btn btn-sm" style="margin-left:6px" data-action="lc-goal">Edit</button></span>
      <span class="num" style="font-size:12px;color:var(--accent)">${solved}/${goal}</span>
    </div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="card-head"><div class="card-title">Submission calendar</div></div>
    ${Object.keys(cal).length ? heatmap(cal, { weeks: 30 }) : empty("🟩", "No submissions yet", "Sync your account or log practice")}
  </div>

  ${lc && lc.recent.length ? `<div class="card">
    <div class="card-head"><div class="card-title">Recent submissions</div></div>
    <table class="mini-table"><thead><tr><th>Problem</th><th>Result</th><th>Lang</th><th>When</th></tr></thead><tbody>
      ${lc.recent.map((r) => `<tr>
        <td><a href="https://leetcode.com/problems/${esc(r.slug)}/" target="_blank" rel="noopener">${esc(r.title)}</a></td>
        <td><span class="badge ${/accept/i.test(r.status) ? "b-green" : "b-red"}">${esc(r.status)}</span></td>
        <td class="mut">${esc(r.lang || "")}</td>
        <td class="faint">${ago(r.ts)}</td></tr>`).join("")}
    </tbody></table>
  </div>` : ""}
  `;
};

/* ---------- Solutions (solve log + GitHub push) ---------- */
let _openSolve = null, _showSolveForm = false, _showReadme = false;
const DIFF_BADGE = { Easy: "b-green", Medium: "b-amber", Hard: "b-red", Unknown: "b-muted" };

ROUTES.solves = function () {
  const st = S.settings, ss = solveStats();
  const connected = !!(st.ghToken && st.ghRepo);
  const list = [...S.solves].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.qid || 0) - (a.qid || 0)));

  return `
  <div class="page-title">Solutions</div>
  <div class="page-sub">Every solve you log here can be committed to a GitHub repo — your contribution graph grows with your practice.</div>

  <div class="grid g-4" style="margin-bottom:14px">
    ${stat("Logged", ss.count, "solve entries", { icon: "❯", color: ss.count ? "var(--accent)" : "var(--faint)" })}
    ${stat("On GitHub", ss.pushed, ss.count ? Math.round(ss.pushed / ss.count * 100) + "% of log" : "none yet", { icon: "⬆", color: ss.pushed ? "var(--green)" : "var(--faint)" })}
    ${stat("Ready to push", ss.readyToPush, "code saved here", { icon: "•", color: ss.readyToPush ? "var(--amber)" : "var(--faint)" })}
    ${stat("Older solves", ss.needCode, "no code stored", { icon: "⏱", color: "var(--faint)" })}
  </div>

  ${ss.needCode ? `<div class="note-line">
    <strong>${ss.needCode}</strong> of these were pulled from your LeetCode history, so no code is stored for them.
    They can't be committed from here — open one on LeetCode and press <em>Push to GitHub</em>, or just leave them as a record.
  </div>` : ""}

  <div class="card" style="margin-bottom:14px">
    <div class="card-head"><div class="card-title">GitHub push</div>
      ${connected ? `<span class="badge b-green">repo set</span>` : `<span class="badge b-muted">not set up</span>`}</div>
    ${connected
      ? `<div class="mut" style="font-size:12.5px">Committing to <strong>${esc(st.ghRepo)}</strong>. Each solve writes <code>solutions/&lt;topic&gt;/&lt;id&gt;-&lt;slug&gt;.&lt;ext&gt;</code> plus a README index — one commit each.</div>
         <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
           <button class="btn btn-primary" data-action="solve-backfill">⬆ Push all with code (${ss.readyToPush})</button>
           <button class="btn" data-action="repo-pull" title="Import what the browser extension already pushed">↓ Pull from repo</button>
           <button class="btn" data-action="readme-toggle">${_showReadme ? "Hide" : "Preview"} README</button>
           <button class="btn btn-ghost" data-action="nav" data-view="settings">Push settings</button>
         </div>
         ${_showReadme ? `<div class="hr"></div>
           <div class="faint" style="font-size:11.5px;margin-bottom:6px">Preview from local entries. The committed README is rebuilt from <code>solutions/index.json</code>, which also holds anything the extension pushed.</div>
           <pre class="readme-preview">${esc(buildReadme(localIndexEntries()))}</pre>` : ""}`
      : `<p class="mut" style="font-size:12.5px;margin-bottom:12px">Add a repo name and a fine-grained GitHub token in Settings to enable one-click commits.</p>
         <button class="btn btn-primary" data-action="nav" data-view="settings">Set up in Settings →</button>`}
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="card-head"><div class="card-title">Solve log</div>
      <button class="btn btn-sm" data-action="solve-form">${_showSolveForm ? "✕ Cancel" : "+ Log a solve"}</button></div>
    <p class="faint" style="font-size:11.5px;margin:-4px 0 12px">
      Solutions arrive here on their own once the
      <a href="./nexus-leethub/README.md" target="_blank" rel="noopener">browser extension</a>
      is installed — or press <strong>↓ Pull from repo</strong> above.
    </p>

    ${_showSolveForm ? `<div class="card" style="background:var(--surface-2);margin-bottom:12px">
      <div class="grid g-2" style="gap:10px;margin-bottom:10px">
        <div><label class="field-label">Problem URL or slug *</label><input class="input" id="nsSlug" placeholder="two-sum or https://leetcode.com/problems/two-sum/"></div>
        <div><label class="field-label">Title</label><input class="input" id="nsTitle" placeholder="Two Sum (auto if blank)"></div>
        <div><label class="field-label">Difficulty</label>
          <select id="nsDiff"><option>Easy</option><option selected>Medium</option><option>Hard</option><option>Unknown</option></select></div>
        <div><label class="field-label">Language</label><input class="input" id="nsLang" placeholder="python / cpp / java" value="${esc(S.solves[0] && S.solves[0].lang || "")}"></div>
      </div>
      <label class="field-label">Solution code</label>
      <textarea id="nsCode" rows="7" class="code-area" placeholder="paste your accepted solution"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-primary" data-action="solve-add">Save entry</button>
        <button class="btn" data-action="solve-add" data-push="1">Save &amp; push</button>
      </div>
    </div>` : ""}

    ${!list.length ? empty("❯", "No solves logged yet", "Sync LeetCode to auto-import, or log one manually")
      : `<div class="stack" style="gap:4px">${list.map((s) => solveRow(s, connected)).join("")}</div>`}
  </div>`;
};

function solveRow(s, connected) {
  const open = _openSolve === s.id;
  const dbadge = DIFF_BADGE[s.difficulty] || "b-muted";
  const topic = (s.topics && s.topics[0]) || "misc";
  const hasCode = !!(s.code || "").trim();
  const state = s.pushed
    ? `<a class="badge b-green" href="${esc(s.pushUrl || "#")}" target="_blank" rel="noopener" onclick="event.stopPropagation()">pushed ✓</a>`
    : hasCode ? `<span class="badge b-amber">ready</span>`
    : `<span class="badge b-muted">no code</span>`;

  return `<div class="solve-row${open ? " open" : ""}${s.pushed ? " is-pushed" : ""}">
    <div class="solve-head" data-action="solve-expand" data-id="${s.id}">
      <span class="sh-id">${s.qid ? "#" + s.qid : "—"}</span>
      <a class="sh-title" href="https://leetcode.com/problems/${esc(s.slug)}/" target="_blank"
         rel="noopener" onclick="event.stopPropagation()" title="${esc(s.title)}">${esc(s.title)}</a>
      <span class="badge ${dbadge}">${esc(s.difficulty || "?")}</span>
      <span class="badge b-muted sh-topic" title="${esc(titleCase(topic))}">${esc(titleCase(topic))}</span>
      <span class="sh-date">${esc(s.date)}</span>
      <span class="sh-state">${state}</span>
    </div>
    ${open ? `<div class="solve-body">
      ${!hasCode ? `<div class="hint-row">
        <span>No code stored — solved before the extension was set up.</span>
        <a class="btn btn-sm btn-primary" href="https://leetcode.com/problems/${esc(s.slug)}/"
           target="_blank" rel="noopener">Open on LeetCode &amp; push ↗</a>
      </div>` : ""}
      <div class="grid g-2" style="gap:10px;margin-bottom:10px">
        <div><label class="field-label">Language</label><input class="input" id="lang-${s.id}" value="${esc(s.lang || "")}" placeholder="python / cpp / java"></div>
        <div><label class="field-label">Topic folder</label><input class="input" id="topic-${s.id}" value="${esc(topic)}"></div>
      </div>
      <label class="field-label">Solution code</label>
      <textarea id="code-${s.id}" rows="10" class="code-area" placeholder="paste your accepted solution, or push it from LeetCode with the extension">${esc(s.code || "")}</textarea>
      <label class="field-label" style="margin-top:10px">Notes (go into the file header)</label>
      <textarea id="notes-${s.id}" rows="2" class="code-area">${esc(s.notes || "")}</textarea>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-primary" data-action="solve-save" data-id="${s.id}">Save</button>
        <button class="btn" data-action="solve-save" data-id="${s.id}" data-push="1" ${connected ? "" : "disabled"}>Save &amp; push</button>
        <button class="btn btn-ghost" data-action="coach-review-fill" data-id="${s.id}">Send to Coach review</button>
        <button class="btn btn-danger right" data-action="solve-del" data-id="${s.id}">Delete</button>
      </div>
    </div>` : ""}
  </div>`;
}

function feedSourcesPanel() {
  const jf = S.jobfeed;
  const f = jf.filters;
  return `<div class="hr"></div>
  <div class="section-label">Aggregators</div>
  <div class="wrap" style="margin-bottom:14px">
    ${Object.entries(jf.aggregators).map(([k, a]) => `
      <button class="btn btn-sm ${a.on ? "btn-primary" : "btn-ghost"}" data-action="feed-agg" data-k="${k}">${a.on ? "✓ " : ""}${esc(a.name)}</button>`).join("")}
  </div>

  <div class="section-label">Company boards <span class="faint">— ${jf.boards.filter((b) => b.on).length} of ${jf.boards.length} on</span></div>
  <div class="wrap" style="margin-bottom:10px">
    ${jf.boards.map((b, i) => `
      <button class="btn btn-sm ${b.on ? "btn-primary" : "btn-ghost"}" data-action="feed-board" data-i="${i}" title="${esc(b.ats)}/${esc(b.slug)}">${b.on ? "✓ " : ""}${esc(b.name)}</button>`).join("")}
  </div>
  <div class="connect" style="margin-bottom:14px">
    <div class="field"><label class="field-label">Add a company board</label>
      <input class="input" id="nbSlug" placeholder="ATS slug, e.g. databricks"></div>
    <select id="nbAts" style="max-width:140px"><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="ashby">Ashby</option></select>
    <button class="btn" data-action="feed-board-add">Verify &amp; add</button>
  </div>
  <div id="nbOut" style="margin-bottom:14px"></div>

  <div class="section-label">Matching</div>
  <div class="grid g-2" style="gap:12px">
    <div><label class="field-label">Include keywords (comma separated)</label>
      <textarea id="fIncl" rows="3" class="code-area">${esc(f.include.join(", "))}</textarea></div>
    <div><label class="field-label">Exclude keywords</label>
      <textarea id="fExcl" rows="3" class="code-area">${esc(f.exclude.join(", "))}</textarea></div>
  </div>
  <div class="grid g-2" style="gap:12px;margin-top:10px">
    <div><label class="field-label">Minimum match score</label>
      <input class="input" type="number" min="0" max="20" id="fMin" value="${f.minScore}"></div>
    <div style="display:flex;align-items:flex-end">
      <label class="checkline"><input type="checkbox" id="fIndia" ${f.indiaOnly ? "checked" : ""}> India-located roles only</label></div>
  </div>
  <div style="display:flex;gap:8px;margin-top:12px">
    <button class="btn btn-primary" data-action="feed-filters-save">Save filters</button>
    <button class="btn btn-ghost" data-action="feed-filters-reset">Reset to profile defaults</button>
  </div>`;
}

/* ---------- Job Feed ---------- */
/* _feedTab null = follow the feed: New while anything is unseen, otherwise All.
   Clicking a tab pins it. */
let _feedTab = null;
let _showSources = false;

const FEED_TABS = [
  { t: "new",   label: "New" },
  { t: "india", label: "India" },
  { t: "entry", label: "Entry level" },
  { t: "all",   label: "All" },
];

function feedFilterTab(jobs, tab, f) {
  if (tab === "new")   return jobs.filter((j) => j.isNew);
  if (tab === "india") return jobs.filter((j) => IN_CITY.test((j.loc || "").toLowerCase()));
  if (tab === "entry") return jobs.filter((j) => {
    const t = normTerm(j.title);
    return f.levels.some((lv) => hasTerm(t, lv));
  });
  return jobs;
}

function feedCard(j) {
  const inIndia = IN_CITY.test((j.loc || "").toLowerCase());
  const tracked = !!S.jobfeed.tracked[j.id];
  return `
  <div class="job-card${j.isNew ? " is-new" : ""}">
    <div class="job-main">
      <div class="job-top">
        <a class="job-title" href="${esc(j.url)}" target="_blank" rel="noopener"
           data-action="feed-open" data-id="${esc(j.id)}">${esc(j.title)}</a>
        ${j.isNew ? `<span class="badge b-green">NEW</span>` : ""}
        ${tracked ? `<span class="badge b-muted">tracked</span>` : ""}
      </div>
      <div class="job-meta">
        <strong>${esc(j.company || j.srcLabel || "—")}</strong>
        <span class="${inIndia ? "job-loc-in" : ""}">${esc(j.loc || "Location not listed")}</span>
        ${j.salary ? `<span style="color:var(--green);font-weight:600">${esc(j.salary)}</span>` : ""}
        ${j.srcLabel ? `<span class="faint">via ${esc(j.srcLabel)}</span>` : ""}
        ${j.posted ? `<span class="faint">${ago(j.posted)}</span>` : ""}
        ${(j.hits && j.hits.length) ? `<span class="mut">matched: ${esc(j.hits.join(", "))}</span>` : ""}
      </div>
    </div>
    <div class="job-actions">
      <span class="job-score" title="match score">${j.score}</span>
      <a class="btn btn-sm btn-primary" href="${esc(j.url)}" target="_blank" rel="noopener"
         data-action="feed-open" data-id="${esc(j.id)}">Apply ↗</a>
      <button class="btn btn-sm" data-action="feed-track" data-id="${esc(j.id)}" ${tracked ? "disabled" : ""}>${tracked ? "Tracked" : "Track"}</button>
      <button class="icon-btn" style="width:26px;height:26px;font-size:11px" data-action="feed-dismiss" data-id="${esc(j.id)}" title="Hide this posting forever">✕</button>
    </div>
  </div>`;
}

ROUTES.jobfeed = function () {
  const jf = S.jobfeed;
  const f = jf.filters;
  const all = jf.cache || [];
  const counts = {
    new:   feedFilterTab(all, "new", f).length,
    india: feedFilterTab(all, "india", f).length,
    entry: feedFilterTab(all, "entry", f).length,
    all:   all.length,
  };
  const tab = _feedTab || (counts.new ? "new" : "all");
  const jobs = feedFilterTab(all, tab, f).slice(0, 200);
  const errs = jf.errors || [];

  return `
  <div class="page-title">Job Feed</div>
  <div class="page-sub">Live postings matched to your profile — apply on the employer's own page.</div>

  <div class="grid g-4" style="margin-bottom:14px">
    ${stat("Matches", counts.all, "after your filters", { icon: "◎", color: counts.all ? "var(--accent)" : "var(--faint)" })}
    ${stat("New", counts.new, "since last check", { icon: "✦", color: counts.new ? "var(--green)" : "var(--faint)" })}
    ${stat("In India", counts.india, "on-site or hybrid", { icon: "📍", color: counts.india ? "var(--accent)" : "var(--faint)" })}
    ${stat("Entry level", counts.entry, "intern / new grad", { icon: "🌱", color: counts.entry ? "var(--green)" : "var(--faint)" })}
  </div>

  <div class="card" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div class="wrap">
        ${FEED_TABS.map((x) => `
          <button class="btn btn-sm ${tab === x.t ? "btn-primary" : "btn-ghost"}" data-action="feed-tab" data-t="${x.t}">
            ${x.label} <span class="tabnum">${counts[x.t]}</span>
          </button>`).join("")}
      </div>
      <div class="wrap">
        <button class="btn btn-sm btn-primary" data-action="feed-refresh">↻ Fetch jobs</button>
        ${counts.new ? `<button class="btn btn-sm btn-ghost" data-action="feed-seen">Mark all seen</button>` : ""}
        <button class="btn btn-sm btn-ghost" data-action="feed-sources">${_showSources ? "✕ Close" : "⚙ Sources &amp; filters"}</button>
      </div>
    </div>
    <div class="faint" style="font-size:11.5px;margin-top:8px">
      Last fetch ${ago(jf.lastFetch)} · ${jf.boards.filter((b) => b.on).length} company boards ·
      ${Object.values(jf.aggregators).filter((a) => a.on).length} aggregators
      ${errs.length ? ` · <span class="badge b-amber">${errs.length} source(s) failed</span> <span class="mut">${esc(errs.slice(0, 6).join(", "))}${errs.length > 6 ? "…" : ""}</span>` : ""}
    </div>
    ${_showSources ? feedSourcesPanel() : ""}
  </div>

  ${!all.length
    ? `<div class="card">${empty("◎", "No jobs loaded yet", "Press “↻ Fetch jobs” to pull live postings from your boards")}</div>`
    : !jobs.length
    ? `<div class="card">${empty("✓", "Nothing in this tab", "You're caught up here — try “All”, or loosen your filters under Sources & filters")}</div>`
    : `<div class="stack">${jobs.map(feedCard).join("")}</div>`}
  `;
};

/* ---------- Jobs ---------- */
let showJobForm = false;
ROUTES.jobs = function () {
  const j = S.jobs;
  const total = j.length;
  const resp = j.filter((x) => x.status === "response").length;
  const rej = j.filter((x) => x.status === "rejected").length;
  const rr = total ? Math.round((resp / total) * 100) : 0;
  const badgeFor = (s) => s === "response" ? "b-green" : s === "rejected" ? "b-red" : "b-accent";
  return `
  <div class="page-title">Job Tracker</div>
  <div class="page-sub">Log every application. The numbers keep you honest.</div>

  <div class="grid g-4" style="margin-bottom:14px">
    ${stat("Applied", total, "total sent", { icon: "📤", color: total ? "var(--accent)" : "var(--faint)" })}
    ${stat("Responses", resp, "interviews / OA", { icon: "💬", color: resp ? "var(--green)" : "var(--faint)" })}
    ${stat("Rejected", rej, "data, not failure", { icon: "📊", color: "var(--faint)" })}
    ${stat("Response Rate", rr + "%", "industry avg ~10%", { icon: "📈", color: rr > 10 ? "var(--green)" : "var(--faint)" })}
  </div>

  <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
    <button class="btn btn-primary btn-sm" data-action="job-form">${showJobForm ? "✕ Cancel" : "+ Add application"}</button>
  </div>

  ${showJobForm ? `<div class="card" style="margin-bottom:14px;border-color:color-mix(in srgb,var(--accent) 26%,transparent)">
    <div class="section-label">New application</div>
    <div class="grid g-2" style="gap:10px;margin-bottom:12px">
      <div><label class="field-label">Company *</label><input class="input" id="jCo" placeholder="Google"></div>
      <div><label class="field-label">Role *</label><input class="input" id="jRole" placeholder="SWE Intern"></div>
      <div><label class="field-label">Compensation</label><input class="input" id="jSal" placeholder="₹1.5L/mo"></div>
      <div><label class="field-label">Stage</label><input class="input" id="jStage" placeholder="OA pending" value="Applied"></div>
      <div><label class="field-label">Status</label>
        <select id="jStatus"><option value="applied">Applied</option><option value="response">Response / Interview</option><option value="rejected">Rejected</option></select></div>
      <div><label class="field-label">Date</label><input class="input" type="date" id="jDate" value="${iso()}"></div>
    </div>
    <button class="btn btn-primary" style="width:100%;justify-content:center" data-action="job-save">Save application</button>
  </div>` : ""}

  ${!total ? `<div class="card">${empty("🎯", "No applications yet", "Track every send — momentum compounds")}</div>` : `
  <div class="card">
    <table class="mini-table"><thead><tr><th>Company</th><th>Role</th><th>Date</th><th>Stage</th><th>Comp</th><th></th></tr></thead><tbody>
      ${j.map((x) => `<tr>
        <td style="font-weight:700">${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.co)}</a>` : esc(x.co)}</td>
        <td class="mut">${esc(x.role)}</td>
        <td class="faint">${esc((x.dt || "").slice(5))}</td>
        <td><span class="badge ${badgeFor(x.status)}">${esc(x.stage)}</span></td>
        <td style="color:var(--green);font-weight:600">${esc(x.sal || "—")}</td>
        <td><button class="icon-btn" style="width:24px;height:24px;font-size:11px" data-action="job-del" data-id="${x.id}">✕</button></td>
      </tr>`).join("")}
    </tbody></table>
  </div>`}
  `;
};

/* ---------- Analytics ---------- */
ROUTES.analytics = function () {
  const ps = practiceStats();
  const cal = activityCal();
  const solved = solvedTotal();
  const goal = S.settings.lcGoal;
  const streak = streakFrom(cal);
  const fsAvg = Math.round(S.skills.fullstack.reduce((a, s) => a + s.v, 0) / S.skills.fullstack.length) || 0;
  const aiAvg = Math.round(S.skills.aiml.reduce((a, s) => a + s.v, 0) / S.skills.aiml.length) || 0;
  const tt = todayTaskState();
  const week = [...Array(7)].map((_, i) => {
    const d = addDays(new Date(), -(6 - i));
    return { label: d.toLocaleDateString("en", { weekday: "short" })[0], value: cal[iso(d)] || 0 };
  });
  const projDone = S.projects.reduce((a, p) => a + p.tasks.filter((t) => t.done).length, 0);
  const projTotal = S.projects.reduce((a, p) => a + p.tasks.length, 0);

  const rows = [
    ["Problems solved", solved, "of " + goal, "var(--accent)"],
    ["Best streak", streak + "d", "consecutive days", "var(--amber)"],
    ["Solved this week", week.reduce((a, d) => a + d.value, 0), "last 7 days", "var(--accent)"],
    ["Tasks today", tt.done + "/" + tt.total, tt.pct + "%", tt.done ? "var(--green)" : "var(--faint)"],
    ["Full-stack mastery", fsAvg + "%", "avg across modules", "var(--accent)"],
    ["AI/ML mastery", aiAvg + "%", "avg across topics", "var(--green)"],
    ["Project tasks", projDone + "/" + projTotal, pct(projDone, projTotal) + "%", "var(--accent)"],
    ["Applications", S.jobs.length, S.jobs.filter((x) => x.status === "response").length + " responses", "var(--accent)"],
  ];

  return `
  <div class="page-title">Analytics</div>
  <div class="page-sub">Your real numbers — nothing here is faked.</div>

  <div class="grid g-4" style="margin-bottom:14px">
    ${stat("Solved", solved, pct(solved, goal) + "% of goal", { icon: "λ", color: "var(--accent)" })}
    ${stat("Streak", streak + "d", "current", { icon: "🔥", color: streak ? "var(--amber)" : "var(--faint)" })}
    ${stat("FS Mastery", fsAvg + "%", "full stack", { icon: "💻", color: fsAvg ? "var(--accent)" : "var(--faint)" })}
    ${stat("AI/ML Mastery", aiAvg + "%", "avg", { icon: "🧠", color: aiAvg ? "var(--green)" : "var(--faint)" })}
  </div>

  <div class="grid g-2" style="margin-bottom:14px">
    <div class="card">
      <div class="card-head"><div class="card-title">Last 7 days</div></div>
      ${week.some((d) => d.value) ? barChart(week) : empty("📈", "No data yet", "Log or sync problems")}
    </div>
    <div class="card">
      <div class="card-head"><div class="card-title">Snapshot</div></div>
      ${rows.map((r) => `<div class="list-line"><span class="ri-text mut">${r[0]}</span>
        <span class="num right" style="color:${r[3]}">${r[1]}</span>
        <span class="faint" style="font-size:11px;min-width:110px;text-align:right">${r[2]}</span></div>`).join("")}
    </div>
  </div>

  <div class="card">
    <div class="card-head"><div class="card-title">Projections (at current pace)</div></div>
    ${[
      [`Problem goal (${goal})`, solved > 0 ? `~${Math.ceil((goal - solved) / 5)} days` : "—", "⚡"],
      ["Full stack → 80%", fsAvg > 0 ? `~${Math.max(0, Math.ceil((80 - fsAvg) * 1.5))} days` : "—", "💻"],
      ["AI/ML → 70%", aiAvg > 0 ? `~${Math.max(0, Math.ceil((70 - aiAvg) * 2))} days` : "—", "🧠"],
      ["10 applications", `${Math.max(0, 10 - S.jobs.length)} to go`, "🎯"],
    ].map((r) => `<div class="list-line"><span>${r[2]}</span><span class="ri-text">${r[0]}</span>
      <span class="num right" style="color:var(--accent)">${r[1]}</span></div>`).join("")}
  </div>`;
};

/* ---------- Settings ---------- */
ROUTES.settings = function () {
  const s = S.settings;
  return `
  <div class="page-title">Settings</div>
  <div class="page-sub">Accounts, goals and your data.</div>

  <div class="card" style="margin-bottom:14px">
    <div class="section-label">Connected accounts</div>
    <div class="grid g-2" style="gap:12px">
      <div><label class="field-label">LeetCode username</label>
        <input class="input" id="setLc" value="${esc(s.leetcode)}" placeholder="username"></div>
      <div><label class="field-label">GitHub username</label>
        <input class="input" id="setGh" value="${esc(s.github)}" placeholder="username"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-primary" data-action="settings-save">Save & sync</button>
      <button class="btn btn-ghost" data-action="sync-all">↻ Sync now</button>
    </div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="section-label">Goals</div>
    <label class="field-label">Problem-solving target</label>
    <input class="input" type="number" min="1" id="setGoal" value="${s.lcGoal}" style="max-width:160px">
    <label class="checkline" style="margin-top:12px"><input type="checkbox" id="setAutoLog" ${s.autoLog ? "checked" : ""}> Auto-log accepted LeetCode submissions on each sync</label>
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="section-label">GitHub auto-push</div>
    <p class="faint" style="font-size:12px;margin-bottom:12px">Commits your logged solutions to a repo so your contribution graph tracks your practice.
      Use a <strong>fine-grained PAT</strong> scoped to <em>one repo</em>, permission <strong>Contents: read/write</strong> only
      (add <em>Administration: write</em> only if you want the app to create the repo). The token is stored in this browser and sent only to api.github.com —
      don't enable this on a shared/public deployment.</p>
    <div class="grid g-2" style="gap:12px">
      <div><label class="field-label">Solutions repo name</label>
        <input class="input" id="setGhRepo" value="${esc(s.ghRepo)}" placeholder="leetcode-solutions"></div>
      <div><label class="field-label">Fine-grained token</label>
        <input class="input" type="password" id="setGhToken" value="${esc(s.ghToken)}" placeholder="github_pat_…" autocomplete="off"></div>
    </div>
    <label class="checkline" style="margin-top:10px"><input type="checkbox" id="setGhPrivate" ${s.ghPrivate ? "checked" : ""}> Create the repo as private if it doesn't exist</label>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-primary" data-action="settings-save">Save</button>
      <button class="btn" data-action="gh-test">Test connection</button>
      <a class="btn btn-ghost" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create token ↗</a>
    </div>
    <div id="ghTestOut" style="margin-top:10px"></div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="section-label">AI Coach — Groq</div>
    <p class="faint" style="font-size:12px;margin-bottom:12px">Free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>.
      Stored in this browser, sent only to api.groq.com. Only your study stats are sent — no name, email or code unless you paste it into a review.</p>
    <div class="grid g-2" style="gap:12px">
      <div><label class="field-label">Groq API key</label>
        <input class="input" type="password" id="setGroqKey" value="${esc(s.groqKey)}" placeholder="gsk_…" autocomplete="off"></div>
      <div><label class="field-label">Model <span class="faint">- leave blank to auto-pick</span></label>
        <input class="input" id="setGroqModel" value="${esc(s.groqModel)}" placeholder="auto"></div>
    </div>
    <div id="groqModelOut" style="margin-top:10px"></div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-primary" data-action="settings-save">Save</button>
      <button class="btn" data-action="groq-models">Load available models</button>
    </div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="section-label">Appearance</div>
    <div style="display:flex;gap:8px">
      ${["system", "light", "dark"].map((t) => `<button class="btn ${s.theme === t ? "btn-primary" : ""}" data-action="set-theme" data-t="${t}" style="text-transform:capitalize">${t}</button>`).join("")}
    </div>
  </div>

  <div class="card">
    <div class="section-label">Data</div>
    <p class="faint" style="font-size:12px;margin-bottom:12px">Everything lives in this browser's local storage. Export a backup or move it to another machine.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" data-action="data-export">⬇ Export JSON</button>
      <button class="btn" data-action="data-import">⬆ Import JSON</button>
      <button class="btn btn-danger" data-action="data-reset">Reset everything</button>
    </div>
  </div>`;
};

/* ============================================================
   LIVE CLOCKS
   ============================================================ */
let clockTimer = null;
function tickClocks() {
  const n = new Date();
  const H = String(n.getHours()).padStart(2, "0");
  const M = String(n.getMinutes()).padStart(2, "0");
  const Sp = String(n.getSeconds()).padStart(2, "0");
  const d = el("dashClock");
  if (d) d.innerHTML = `${H}<span class="blink">:</span>${M}<span style="font-size:.5em;color:var(--faint)"> ${Sp}</span>`;
  const sc = el("schClock");
  if (sc) sc.innerHTML = `${H}<span class="blink">:</span>${M}`;
  if (!d && !sc && clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}
function startDashClock() { if (clockTimer) clearInterval(clockTimer); tickClocks(); clockTimer = setInterval(tickClocks, 1000); }
function startSchClock() { startDashClock(); }

/* ============================================================
   CHROME  (sidebar streak + today bar + date)
   ============================================================ */
function updateChrome() {
  const cal = activityCal();
  const streak = streakFrom(cal);
  const fl = el("streakFlame"), nu = el("streakNum"), su = el("streakSub");
  if (nu) {
    if (streak > 0) {
      fl.textContent = "🔥"; nu.textContent = streak + " day" + (streak > 1 ? "s" : "");
      su.textContent = "keep it going"; nu.style.color = "var(--amber)";
    } else {
      fl.textContent = "⚡"; nu.textContent = "No streak yet";
      su.textContent = "log practice to start"; nu.style.color = "var(--text)";
    }
  }
  const tt = todayTaskState();
  const tf = el("todayFill"), tp = el("todayPct");
  if (tf) tf.style.width = tt.pct + "%";
  if (tp) tp.textContent = tt.pct + "%";
  const td = el("todayDate");
  if (td) td.textContent = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const lsn = el("lastSyncNote");
  if (lsn) {
    const last = Math.max(S.lc ? S.lc.lastSync : 0, S.gh ? S.gh.lastSync : 0);
    lsn.textContent = last ? "last synced " + ago(last) : "never synced";
  }
}

/* ============================================================
   EVENTS
   ============================================================ */
document.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-action]");
  if (!t) return;
  const a = t.dataset.action;
  const D = t.dataset;

  switch (a) {
    case "nav": go(D.view); break;
    case "open-sidebar": el("app").classList.add("nav-open"); break;
    case "close-sidebar": el("app").classList.remove("nav-open"); break;
    case "sync-all": syncAll(); break;
    case "cycle-theme": {
      const order = ["system", "light", "dark"];
      S.settings.theme = order[(order.indexOf(S.settings.theme) + 1) % 3];
      save(); applyTheme(); rerender();
      toast("Theme: " + S.settings.theme); break;
    }
    case "set-theme": S.settings.theme = D.t; save(); applyTheme(); rerender(); break;

    /* practice */
    case "practice-add":
      S.practice.log.push({ date: iso(), diff: D.diff }); save(); rerender(); break;
    case "practice-undo": {
      const today = iso();
      for (let i = S.practice.log.length - 1; i >= 0; i--) {
        if (S.practice.log[i].date === today) { S.practice.log.splice(i, 1); break; }
      }
      save(); rerender(); break;
    }

    /* daily tasks */
    case "task-toggle": {
      const k = iso();
      if (!S.tasks[k]) S.tasks[k] = {};
      S.tasks[k][D.id] = !S.tasks[k][D.id];
      save(); rerender(); break;
    }
    case "task-add": {
      const label = prompt("Task name:");
      if (label) { S.taskDefs.push({ id: uid(), icon: "•", label: label.trim(), cat: "Custom" }); save(); rerender(); }
      break;
    }
    case "task-del":
      S.taskDefs = S.taskDefs.filter((x) => x.id !== D.id); save(); rerender(); break;

    /* schedule */
    case "sched-add":
      S.schedule.push({ icon: "•", label: "New block", st: "12:00", en: "13:00" }); save(); rerender(); break;
    case "sched-del":
      S.schedule.splice(+D.i, 1); save(); rerender(); break;

    /* leetcode */
    case "lc-connect": {
      const v = (el("lcUser").value || "").trim();
      if (!v) return toast("Enter a username first");
      S.settings.leetcode = v; save();
      setSync("busy", `<span class="spin"></span> Syncing…`);
      fetchLeetCode(v).then((r) => { S.lc = r; save(); toast("LeetCode synced ✓", "ok"); rerender(); })
        .catch((e) => { toast("Sync failed — " + e.message + ". Use manual entry below.", "err"); rerender(); });
      break;
    }
    case "lc-disconnect": S.lc = null; S.settings.leetcode = ""; save(); rerender(); break;
    case "lc-manual": {
      const e = +el("mE").value || 0, m = +el("mM").value || 0, h = +el("mH").value || 0;
      S.lc = Object.assign({
        source: "manual", ranking: 0, acceptance: null, totalQ: 0, recent: [],
        calendar: (S.lc && S.lc.calendar) || {},
      }, { solved: e + m + h, easy: e, medium: m, hard: h, lastSync: Date.now() });
      save(); toast("Manual counts saved", "ok"); rerender(); break;
    }
    case "lc-goal": {
      const g = prompt("Problem goal:", S.settings.lcGoal);
      if (g && +g > 0) { S.settings.lcGoal = +g; save(); rerender(); }
      break;
    }

    /* github */
    case "gh-connect": {
      const v = (el("ghUser").value || "").trim();
      if (!v) return toast("Enter a username first");
      S.settings.github = v; save();
      setSync("busy", `<span class="spin"></span> Syncing…`);
      fetchGitHub(v).then((r) => { S.gh = r; save(); toast("GitHub synced ✓", "ok"); rerender(); })
        .catch((e) => { toast("GitHub sync failed — " + e.message, "err"); rerender(); });
      break;
    }
    case "gh-disconnect": S.gh = null; S.settings.github = ""; save(); rerender(); break;

    /* skills */
    case "skill-add": {
      const n = prompt("Skill name:");
      if (n) { S.skills[D.g].push({ n: n.trim(), v: 0 }); save(); rerender(); }
      break;
    }
    case "skill-del": S.skills[D.g].splice(+D.i, 1); save(); rerender(); break;

    /* projects */
    case "proj-add": {
      const n = prompt("Project name:");
      if (!n) break;
      S.projects.push({ id: uid(), emoji: "🚀", name: n.trim(), desc: "New project", tech: [], tasks: [] });
      save(); rerender(); break;
    }
    case "proj-del":
      if (confirm("Delete this project?")) { S.projects = S.projects.filter((p) => p.id !== D.id); save(); rerender(); }
      break;
    case "proj-task": {
      const p = S.projects.find((x) => x.id === D.id);
      if (p) { p.tasks[+D.i].done = !p.tasks[+D.i].done; save(); rerender(); }
      break;
    }
    case "proj-task-add": {
      const p = S.projects.find((x) => x.id === D.id);
      const tn = prompt("Task:");
      if (p && tn) { p.tasks.push({ t: tn.trim(), done: false }); save(); rerender(); }
      break;
    }

    /* job feed */
    case "feed-refresh": refreshFeed(); break;
    case "feed-seen": markFeedSeen(); rerender(); break;
    case "feed-sources": _showSources = !_showSources; rerender(); break;
    case "feed-tab": _feedTab = D.t; rerender(); break;
    case "feed-agg": {
      const a = S.jobfeed.aggregators[D.k];
      if (a) { a.on = !a.on; save(); rerender(); }
      break;
    }
    case "feed-board": {
      const b = S.jobfeed.boards[+D.i];
      if (b) { b.on = !b.on; save(); rerender(); }
      break;
    }
    case "feed-board-add": {
      const slug = (el("nbSlug").value || "").trim().toLowerCase();
      const ats = el("nbAts").value;
      const out = el("nbOut");
      if (!slug) return toast("Enter an ATS slug");
      if (S.jobfeed.boards.some((b) => b.slug === slug && b.ats === ats)) return toast("Already on the list");
      if (out) out.innerHTML = `<span class="spin"></span> verifying…`;
      const url = ats === "greenhouse" ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
        : ats === "lever" ? `https://api.lever.co/v0/postings/${slug}?mode=json`
        : `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
      fetchJSON(url, 15000).then((d) => {
        const n = Array.isArray(d) ? d.length : (d.jobs || []).length;
        if (!n) throw new Error("board exists but has no open roles");
        S.jobfeed.boards.push({ ats, slug, name: titleCase(slug), on: true });
        save();
        toast(`Added ${slug} — ${n} open roles`, "ok");
        rerender();
      }).catch((e) => { if (out) out.innerHTML = `<span class="badge b-red">${esc(slug)}: ${esc(e.message)}</span>`; });
      break;
    }
    case "feed-open":
      S.jobfeed.seen[D.id] = true; save(); break;   // let the link navigate
    case "feed-dismiss":
      S.jobfeed.dismissed[D.id] = true;
      S.jobfeed.cache = S.jobfeed.cache.filter((j) => j.id !== D.id);
      save(); rerender(); break;
    case "feed-track": {
      const j = S.jobfeed.cache.find((x) => x.id === D.id);
      if (!j) break;
      S.jobs.unshift({
        id: uid(), co: j.company || j.srcLabel, role: j.title,
        sal: j.salary || "", stage: "Found", status: "applied",
        dt: iso(), url: j.url, source: j.srcLabel,
      });
      S.jobfeed.tracked[j.id] = true;
      S.jobfeed.seen[j.id] = true;
      save(); toast(`Added ${j.title} to Job Tracker`, "ok"); rerender();
      break;
    }
    case "feed-filters-save": {
      const f = S.jobfeed.filters;
      const split = (v) => v.split(",").map((x) => x.trim()).filter(Boolean);
      if (el("fIncl")) f.include = split(el("fIncl").value);
      if (el("fExcl")) f.exclude = split(el("fExcl").value);
      if (el("fMin")) f.minScore = clamp(+el("fMin").value || 0, 0, 20);
      if (el("fIndia")) f.indiaOnly = el("fIndia").checked;
      save(); toast("Filters saved — re-fetching", "ok"); refreshFeed();
      break;
    }
    case "feed-filters-reset":
      S.jobfeed.filters = clone(DEFAULT_FILTERS); save(); toast("Filters reset"); rerender(); break;

    /* jobs */
    case "job-form": showJobForm = !showJobForm; rerender(); break;
    case "job-save": {
      const co = (el("jCo").value || "").trim(), role = (el("jRole").value || "").trim();
      if (!co || !role) return toast("Company and role are required");
      S.jobs.unshift({
        id: uid(), co, role,
        sal: (el("jSal").value || "").trim(),
        stage: (el("jStage").value || "Applied").trim(),
        status: el("jStatus").value, dt: el("jDate").value || iso(),
      });
      showJobForm = false; save(); rerender(); break;
    }
    case "job-del": S.jobs = S.jobs.filter((x) => x.id !== D.id); save(); rerender(); break;

    /* settings / data */
    case "settings-save": {
      const g0 = (id) => { const e = el(id); return e ? e.value : undefined; };
      const gc = (id) => { const e = el(id); return e ? e.checked : undefined; };
      if (g0("setLc") !== undefined) S.settings.leetcode = g0("setLc").trim();
      if (g0("setGh") !== undefined) S.settings.github = g0("setGh").trim();
      const g = +g0("setGoal"); if (g > 0) S.settings.lcGoal = g;
      if (gc("setAutoLog") !== undefined) S.settings.autoLog = gc("setAutoLog");
      if (g0("setGhRepo") !== undefined) S.settings.ghRepo = g0("setGhRepo").trim() || "leetcode-solutions";
      if (g0("setGhToken") !== undefined) S.settings.ghToken = g0("setGhToken").trim();
      if (gc("setGhPrivate") !== undefined) S.settings.ghPrivate = gc("setGhPrivate");
      S.settings.ghPushEnabled = !!(S.settings.ghToken && S.settings.ghRepo);
      if (g0("setGroqKey") !== undefined) S.settings.groqKey = g0("setGroqKey").trim();
      const sel = el("setGroqModelSel");
      if (sel && sel.value) S.settings.groqModel = sel.value;
      else if (g0("setGroqModel") !== undefined) S.settings.groqModel = g0("setGroqModel").trim();
      save(); toast("Saved", "ok");
      if (S.settings.leetcode || S.settings.github) syncAll(); else rerender();
      break;
    }
    case "groq-models": {
      const out = el("groqModelOut");
      if (el("setGroqKey")) S.settings.groqKey = el("setGroqKey").value.trim();
      save();
      if (out) out.innerHTML = `<span class="spin"></span> loading models...`;
      groqModels().then((ids) => {
        if (!out) return;
        if (!ids.length) { out.innerHTML = `<span class="badge b-amber">no chat models for this key</span>`; return; }
        const best = pickModel(ids);
        const cur = S.settings.groqModel || best;
        out.innerHTML = `<label class="field-label">Available on your key (${ids.length})</label>
          <select id="setGroqModelSel">${ids.sort().map((i) =>
            `<option value="${esc(i)}"${i === cur ? " selected" : ""}>${esc(i)}${i === best ? "  (recommended)" : ""}</option>`).join("")}</select>
          <div class="faint" style="font-size:11.5px;margin-top:6px">Pick one and press Save.</div>`;
      }).catch((e) => { if (out) out.innerHTML = `<span class="badge b-red">${esc(e.message)}</span>`; });
      break;
    }
    case "gh-test": {
      const out = el("ghTestOut");
      if (el("setGhToken")) S.settings.ghToken = el("setGhToken").value.trim();
      if (el("setGhRepo")) S.settings.ghRepo = el("setGhRepo").value.trim() || "leetcode-solutions";
      if (el("setGhPrivate")) S.settings.ghPrivate = el("setGhPrivate").checked;
      save();
      if (out) out.innerHTML = `<span class="spin"></span> testing…`;
      ghTestConnection()
        .then((r) => { if (out) out.innerHTML = `<span class="badge b-green">OK — ${esc(r.login)} · <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.repo)}</a></span>`; })
        .catch((e) => { if (out) out.innerHTML = `<span class="badge b-red">${esc(e.message)}</span>`; });
      break;
    }

    /* solves */
    case "solve-form": _showSolveForm = !_showSolveForm; rerender(); break;
    case "solve-expand":
      _openSolve = _openSolve === D.id ? null : D.id; rerender(); break;
    case "readme-toggle": _showReadme = !_showReadme; rerender(); break;
    case "solve-add": {
      const raw = (el("nsSlug").value || "").trim();
      if (!raw) return toast("Problem URL or slug required");
      const m = raw.match(/problems\/([a-z0-9-]+)/i);
      const slug = (m ? m[1] : raw).toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (!slug) return toast("Could not read a slug");
      if (S.solves.some((s) => s.slug === slug)) return toast("Already logged");
      const entry = {
        id: uid(), slug, title: (el("nsTitle").value || "").trim() || titleCase(slug),
        qid: (S.pmeta[slug] && S.pmeta[slug].qid) || 0,
        difficulty: el("nsDiff").value, topics: (S.pmeta[slug] && S.pmeta[slug].topics) || [],
        lang: (el("nsLang").value || "").trim(), date: iso(),
        code: (el("nsCode").value || ""), notes: "", source: "manual", pushed: false,
      };
      S.solves.unshift(entry);
      _showSolveForm = false;
      save();
      fetchProblemMeta(slug).then((meta) => {
        if (!entry.qid && meta.qid) entry.qid = meta.qid;
        if ((!entry.topics || !entry.topics.length) && meta.topics.length) entry.topics = meta.topics;
        save();
      });
      const wantPush = D.push;
      rerender();
      if (wantPush) pushSolve(entry.id).then(() => { toast("Pushed ✓", "ok"); rerender(); }).catch((e) => toast(e.message, "err"));
      break;
    }
    case "solve-save": {
      const s = S.solves.find((x) => x.id === D.id);
      if (!s) break;
      const cv = el("code-" + D.id), lv = el("lang-" + D.id), tv = el("topic-" + D.id), nv = el("notes-" + D.id);
      if (cv) s.code = cv.value;
      if (lv) s.lang = lv.value.trim();
      if (tv && tv.value.trim()) s.topics = [slugify(tv.value)];
      if (nv) s.notes = nv.value;
      save();
      if (D.push) {
        toast("Pushing…");
        pushSolve(s.id).then(() => { toast("Pushed ✓", "ok"); rerender(); }).catch((e) => toast(e.message, "err"));
      } else { toast("Saved", "ok"); rerender(); }
      break;
    }
    case "solve-del":
      S.solves = S.solves.filter((x) => x.id !== D.id);
      if (_openSolve === D.id) _openSolve = null;
      save(); rerender(); break;
    case "solve-backfill": backfillPush(); break;
    case "repo-pull":
      toast("Reading solutions/index.json…");
      pullRepoIndex()
        .then((r) => { toast(`Repo has ${r.total} solutions — ${r.added} new, ${r.updated} marked pushed`, "ok"); rerender(); })
        .catch((e) => toast(e.message, "err"));
      break;

    /* coach */
    case "coach-run": runCoach(D.kind); break;
    case "coach-review": reviewSolution(); break;
    case "coach-review-fill": {
      const s = S.solves.find((x) => x.id === D.id);
      if (!s) break;
      go("coach");
      setTimeout(() => {
        if (el("revProb")) el("revProb").value = s.title;
        if (el("revCode")) { el("revCode").value = s.code || ""; el("revCode").focus(); }
      }, 30);
      break;
    }
    case "review-save": {
      const t = window._lastReview;
      if (!t) break;
      const target = prompt("Save this review into which solve's notes? Type the problem title:");
      if (!target) break;
      const s = S.solves.find((x) => x.title.toLowerCase().includes(target.toLowerCase()));
      if (!s) return toast("No matching solve entry");
      s.notes = (s.notes ? s.notes + "\n\n" : "") + "--- AI review ---\n" + t;
      save(); toast("Saved to " + s.title, "ok");
      break;
    }
    case "coach-clear":
      if (confirm("Clear coach history?")) { S.ai.history = []; save(); rerender(); }
      break;
    case "coach-del":
      S.ai.history.splice(+D.i, 1); save(); rerender(); break;
    case "data-export": exportData(); break;
    case "data-import": el("importFile").click(); break;
    case "data-reset":
      if (confirm("This wipes ALL local data. Continue?")) { localStorage.removeItem(LS_KEY); S = freshState(); save(); applyTheme(); go("overview"); toast("Reset done"); }
      break;
  }
});

/* live edits (text inputs / ranges) */
document.addEventListener("input", (ev) => {
  const t = ev.target.closest("[data-action]");
  if (!t) return;
  const a = t.dataset.action, D = t.dataset, v = t.value;
  if (a === "skill-range") {
    S.skills[D.g][+D.i].v = clamp(+v, 0, 100);
    const lbl = el(`sv-${D.g}-${D.i}`); if (lbl) lbl.textContent = v + "%";
    saveDebounced();
  }
});
document.addEventListener("change", (ev) => {
  const t = ev.target.closest("[data-action]");
  if (!t) return;
  const a = t.dataset.action, D = t.dataset, v = t.value.trim();
  if (a === "sched-edit") { S.schedule[+D.i][D.k] = v; save(); if (D.k !== "label") rerender(); }
  else if (a === "skill-name") { S.skills[D.g][+D.i].n = v; save(); }
  else if (a === "skill-range") { save(); }
  else if (a === "proj-name") { const p = S.projects.find((x) => x.id === D.id); if (p) { p.name = v; save(); } }
  else if (a === "proj-desc") { const p = S.projects.find((x) => x.id === D.id); if (p) { p.desc = v; save(); } }
});
let sdTimer = null;
function saveDebounced() { clearTimeout(sdTimer); sdTimer = setTimeout(save, 400); }

/* ============================================================
   IMPORT / EXPORT
   ============================================================ */
function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nexus-os-backup-${iso()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Backup downloaded", "ok");
}
el("importFile").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data || typeof data !== "object") throw new Error("bad file");
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      loadState(); applyTheme(); buildNav(); go("overview");
      toast("Data imported ✓", "ok");
    } catch (err) { toast("Import failed — " + err.message, "err"); }
  };
  r.readAsText(f);
  e.target.value = "";
});

/* ============================================================
   INIT
   ============================================================ */
loadState();
applyTheme();
buildNav();
updateChrome();
go((location.hash || "").slice(1) || "overview");

window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1);
  if (v && v !== current && ROUTES[v]) go(v);
});

/* The extension pushes independently, so reconcile with the repo index on
   load - otherwise the dashboard reports 0 pushed while GitHub has plenty. */
(function autoPullRepo() {
  const st = S.settings;
  if (!st.ghToken || !st.ghRepo) return;
  const last = S.repoPulledAt || 0;
  if (Date.now() - last < 10 * 60 * 1000) return;
  setTimeout(() => {
    pullRepoIndex()
      .then((r) => {
        S.repoPulledAt = Date.now();
        save();
        if (r.added || r.updated) {
          toast(`Repo sync: ${r.added} new, ${r.updated} marked pushed`, "ok");
          rerender();
        }
      })
      .catch(() => { /* offline or token revoked - stay quiet, button still there */ });
  }, 1200);
})();

/* auto-sync on load if stale (> 30 min) and a username is set */
(function autoSync() {
  const last = Math.max(S.lc ? S.lc.lastSync : 0, S.gh ? S.gh.lastSync : 0);
  if ((S.settings.leetcode || S.settings.github) && Date.now() - last > 30 * 60 * 1000) {
    setTimeout(() => syncAll({ silent: true }), 800);
  } else if (last) {
    setSync("ok", "Synced " + ago(last));
  }
})();

})();
