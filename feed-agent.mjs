#!/usr/bin/env node
/* ============================================================
   Nexus OS — job feed agent
   Fetches the sources a browser can't reach (CORS-blocked) and
   writes jobs-feed.json next to index.html. Nexus OS merges that
   file into the Job Feed on refresh.

   Run:  node feed-agent.mjs            (writes + prints digest)
         node feed-agent.mjs --quiet    (writes only)
   ============================================================ */
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "jobs-feed.json");
const QUIET = process.argv.includes("--quiet");
const UA = "Mozilla/5.0 (compatible; NexusOS-JobAgent/1.0)";

/* ---------- CORS-blocked sources (server-side only) ----------
   SkipTheDrive was dropped: its /feed/ now serves HTML, not RSS.
   Himalayas caps every response at 20 rows, so it is paged.        */
const SOURCES = [
  { key: "himalayas",     name: "Himalayas",      kind: "paged", pages: 6,
    url: (o) => `https://himalayas.app/jobs/api?limit=20&offset=${o * 20}` },
  { key: "workingnomads", name: "Working Nomads", kind: "json", url: "https://www.workingnomads.com/api/exposed_jobs/" },
  { key: "jobspresso",    name: "Jobspresso",     kind: "rss",  url: "https://jobspresso.co/?feed=job_feed" },
  { key: "nodesk",        name: "NoDesk",         kind: "rss",  url: "https://nodesk.co/remote-jobs/index.xml" },
];

/* Company ATS boards — the highest-yield channel. Watched server-side so the
   digest catches new postings even when the dashboard isn't open.            */
const BOARDS = [
  ["greenhouse", "databricks", "Databricks"], ["greenhouse", "mongodb", "MongoDB"],
  ["ashby", "sarvam", "Sarvam AI"], ["greenhouse", "zscaler", "Zscaler"],
  ["greenhouse", "stripe", "Stripe"], ["greenhouse", "gitlab", "GitLab"],
  ["greenhouse", "rubrik", "Rubrik"], ["greenhouse", "squarepointcapital", "Squarepoint"],
  ["greenhouse", "elastic", "Elastic"], ["greenhouse", "razorpaysoftwareprivatelimited", "Razorpay"],
  ["greenhouse", "coinbase", "Coinbase"], ["greenhouse", "twilio", "Twilio"],
  ["greenhouse", "towerresearchcapital", "Tower Research"], ["greenhouse", "imc", "IMC Trading"],
  ["greenhouse", "worldquant", "WorldQuant"], ["greenhouse", "groww", "Groww"],
  ["greenhouse", "postman", "Postman"], ["greenhouse", "anthropic", "Anthropic"],
  ["greenhouse", "airbnb", "Airbnb"], ["greenhouse", "cloudflare", "Cloudflare"],
  ["greenhouse", "samsara", "Samsara"], ["greenhouse", "jumptrading", "Jump Trading"],
  ["greenhouse", "janestreet", "Jane Street"], ["greenhouse", "figma", "Figma"],
  ["greenhouse", "vercel", "Vercel"], ["greenhouse", "scaleai", "Scale AI"],
  ["greenhouse", "pinterest", "Pinterest"], ["greenhouse", "robinhood", "Robinhood"],
  ["greenhouse", "affirm", "Affirm"], ["greenhouse", "brex", "Brex"],
  ["greenhouse", "slice", "Slice"], ["ashby", "perplexity", "Perplexity"],
  ["ashby", "notion", "Notion"], ["ashby", "ramp", "Ramp"],
  ["ashby", "confluent", "Confluent"], ["ashby", "linear", "Linear"],
  ["ashby", "supabase", "Supabase"], ["ashby", "navi", "Navi"],
];

const BOARD_URL = (ats, slug) =>
  ats === "greenhouse" ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
  : ats === "lever" ? `https://api.lever.co/v0/postings/${slug}?mode=json`
  : `https://api.ashbyhq.com/posting-api/job-board/${slug}`;

function normBoard(ats, slug, name, d) {
  if (ats === "greenhouse") return (d.jobs || []).map((x) => ({
    id: `gh:${slug}-${x.id}`, src: "greenhouse", srcLabel: name, company: name,
    title: x.title || "", loc: x.location?.name || "", url: x.absolute_url,
    posted: Date.parse(x.updated_at) || Date.now(), tags: [], desc: "", salary: "",
  }));
  if (ats === "lever") return (Array.isArray(d) ? d : []).map((x) => ({
    id: `lv:${slug}-${x.id}`, src: "lever", srcLabel: name, company: name,
    title: x.text || "", loc: x.categories?.location || "", url: x.hostedUrl,
    posted: x.createdAt || Date.now(),
    tags: [x.categories?.team, x.categories?.commitment].filter(Boolean), desc: "", salary: "",
  }));
  return (d.jobs || []).map((x) => ({
    id: `ab:${slug}-${x.id}`, src: "ashby", srcLabel: name, company: name,
    title: x.title || "", loc: x.location || "", url: x.jobUrl || x.applyUrl,
    posted: Date.parse(x.publishedAt) || Date.now(),
    tags: [x.department, x.employmentType].filter(Boolean), desc: "", salary: "",
  }));
}

/* ---------- matching (mirrors the in-app filter) ---------- */
const INCLUDE = ["machine learning", "deep learning", "artificial intelligence", "ai", "genai",
  "generative", "llm", "nlp", "computer vision", "data scien", "data engineer", "python",
  "pytorch", "tensorflow", "software engineer", "sde", "swe", "backend", "full stack",
  "fullstack", "react", "typescript", "fastapi", "research engineer", "quantitative", "quant",
  "platform engineer", "applied scientist"];
const EXCLUDE = ["senior", "sr", "staff", "principal", "director", "head of", "vp",
  "vice president", "manager", "architect", "lead", "sales", "marketing", "recruiter",
  "driver", "nurse", "warehouse", "picker", "accountant", "teacher", "designer", "postdoc",
  /* data-labelling gig noise that floods the remote boards */
  "ai trainer", "annotation", "annotator", "transcription", "transcriber", "data collection",
  "voice recording", "video recording", "no experience required", "content analyst",
  "survey", "rater", "tutor", "freelance writer"];
const LEVELS = ["intern", "internship", "new grad", "new graduate", "university", "campus",
  "graduate", "entry level", "junior", "associate", "trainee", "fresher", "early career"];
const IN_CITY = /\b(india|bengaluru|bangalore|hyderabad|pune|gurgaon|gurugram|noida|mumbai|delhi|chennai)\b/;

const norm = (s) => " " + String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " ";
const has = (hay, term) => { const t = norm(term); return t.length > 2 && hay.includes(t); };
const strip = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

function score(job) {
  const title = norm(job.title);
  const hay = norm([job.title, job.tags?.join(" "), job.desc].join(" "));
  const loc = (job.loc || "").toLowerCase();
  for (const bad of EXCLUDE) if (has(title, bad)) return -1;

  let skill = 0; const hits = [];
  for (const k of INCLUDE) {
    if (has(title, k)) { skill += 3; hits.push(k); }
    else if (has(hay, k)) { skill += 1; hits.push(k); }
  }
  if (skill === 0) return -1;                       // must match a real skill
  let s = skill;
  for (const lv of LEVELS) if (has(title, lv)) { s += 4; hits.push(lv); break; }
  if (IN_CITY.test(loc)) s += 3;
  else if (/\b(remote|anywhere|worldwide)\b/.test(loc)) s += 1;
  if (Date.now() - job.posted < 7 * 864e5) s += 2;
  job.hits = [...new Set(hits)].slice(0, 5);
  return s;
}

/* ---------- tiny RSS parser (no deps) ---------- */
function parseRss(xml, srcName, key) {
  const items = xml.split(/<item[\s>]/i).slice(1);
  const tag = (blob, name) => {
    const m = blob.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
    if (!m) return "";
    return strip(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
  };
  return items.map((blob) => {
    const rawTitle = tag(blob, "title");
    const ix = rawTitle.indexOf(":");
    return {
      id: key + ":" + (tag(blob, "guid") || tag(blob, "link") || rawTitle),
      src: key, srcLabel: srcName,
      company: ix > 0 ? rawTitle.slice(0, ix).trim() : "",
      title: ix > 0 ? rawTitle.slice(ix + 1).trim() : rawTitle,
      loc: tag(blob, "region") || tag(blob, "location") || "Remote",
      url: tag(blob, "link"),
      posted: Date.parse(tag(blob, "pubDate")) || Date.now(),
      tags: [tag(blob, "category")].filter(Boolean),
      desc: tag(blob, "description").slice(0, 400),
      salary: "",
    };
  }).filter((j) => j.url && j.title);
}

/* ---------- per-source JSON normalizers ---------- */
const JSON_NORM = {
  himalayas: (d) => (d.jobs || d.data || []).map((x) => ({
    id: "himalayas:" + (x.guid || x.title), src: "himalayas", srcLabel: "Himalayas",
    company: x.companyName || "", title: x.title || "",
    loc: (Array.isArray(x.locationRestrictions) && x.locationRestrictions.length
      ? x.locationRestrictions.join(", ") : "Remote"),
    url: x.applicationLink || x.guid,
    posted: (typeof x.pubDate === "number" ? x.pubDate * 1000 : Date.parse(x.pubDate)) || Date.now(),
    tags: [].concat(x.categories || [], x.employmentType || []).slice(0, 5),
    desc: strip(x.excerpt || x.description).slice(0, 400),
    salary: x.minSalary ? `${x.currency || "$"}${x.minSalary}–${x.maxSalary || ""}` : "",
  })),
  workingnomads: (d) => (Array.isArray(d) ? d : []).map((x) => ({
    id: "wnomads:" + (x.slug || x.url), src: "workingnomads", srcLabel: "Working Nomads",
    company: x.company_name || "", title: x.title || "",
    loc: x.location || "Remote", url: x.url,
    posted: Date.parse(x.pub_date) || Date.now(),
    tags: String(x.tags || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5),
    desc: strip(x.description).slice(0, 400), salary: "",
  })),
};

async function getText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "*/*" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

async function grab(src) {
  try {
    if (src.kind === "paged") {
      const out = [];
      for (let p = 0; p < src.pages; p++) {
        const body = await getText(src.url(p));
        const page = JSON_NORM[src.key](JSON.parse(body));
        if (!page.length) break;
        out.push(...page);
      }
      const seen = new Set();
      return { ok: true, name: src.name, jobs: out.filter((j) => !seen.has(j.id) && seen.add(j.id)) };
    }
    const body = await getText(src.url);
    const jobs = src.kind === "json"
      ? JSON_NORM[src.key](JSON.parse(body))
      : parseRss(body, src.name, src.key);
    return { ok: true, name: src.name, jobs };
  } catch (e) {
    return { ok: false, name: src.name, err: e.message, jobs: [] };
  }
}

async function grabBoard([ats, slug, name]) {
  try {
    const d = JSON.parse(await getText(BOARD_URL(ats, slug)));
    return { ok: true, name, jobs: normBoard(ats, slug, name, d) };
  } catch (e) {
    return { ok: false, name, err: e.message, jobs: [] };
  }
}

/* ---------- main ---------- */
const results = [
  ...await Promise.all(SOURCES.map(grab)),
  ...await Promise.all(BOARDS.map(grabBoard)),
];
const failed = results.filter((r) => !r.ok);

const matched = [];
for (const r of results) {
  for (const job of r.jobs) {
    if (!job.url || !job.title) continue;
    const s = score(job);
    if (s < 2) continue;
    job.score = s;
    matched.push(job);
  }
}
matched.sort((a, b) => b.score - a.score || b.posted - a.posted);

/* diff against the previous run so the digest only shows genuinely new roles */
let prevIds = new Set();
try {
  const prev = JSON.parse(await readFile(OUT, "utf8"));
  prevIds = new Set((prev.jobs || []).map((j) => j.id));
} catch { /* first run */ }
const fresh = matched.filter((j) => !prevIds.has(j.id));

await writeFile(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  sources: results.map((r) => ({ name: r.name, ok: r.ok, count: r.jobs.length, err: r.err || null })),
  total: matched.length,
  jobs: matched.slice(0, 300),
}, null, 1), "utf8");

if (!QUIET) {
  const isIn = (j) => IN_CITY.test((j.loc || "").toLowerCase());
  const india = matched.filter(isIn);
  console.log(`\nNexus OS job agent - ${new Date().toLocaleString()}`);
  console.log(`${matched.length} matches | ${fresh.length} new | ${india.length} in India`);
  if (failed.length) console.log(`unreachable: ${failed.map((f) => `${f.name} (${f.err})`).join(", ")}`);

  const show = (label, list) => {
    if (!list.length) return;
    console.log(`\n--- ${label} ---`);
    for (const j of list) {
      console.log(`[${String(j.score).padStart(2)}] ${j.title}`);
      console.log(`     ${j.company || j.srcLabel} | ${j.loc || "-"} | ${j.srcLabel}`);
      console.log(`     ${j.url}`);
    }
  };
  show("NEW IN INDIA", fresh.filter(isIn).slice(0, 15));
  show("NEW ELSEWHERE", fresh.filter((j) => !isIn(j)).slice(0, 10));
  if (!fresh.length) console.log("\n(nothing new since the last run)");
  console.log(`\nwrote ${OUT}`);
}

/* undici keeps sockets alive and would hold the event loop open,
   which also swallows buffered stdout when piped — exit explicitly. */
process.exit(0);
