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
  ["lever", "meesho", "Meesho"], ["lever", "cred", "CRED"], ["lever", "zeta", "Zeta"],
  ["lever", "palantir", "Palantir"], ["lever", "spotify", "Spotify"], ["lever", "paytm", "Paytm"],
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

/* ---------- neutral pool ----------
   The agent deliberately knows nothing about any one person: no role, seniority or
   location preferences. It only drops data-labelling gig spam and keeps the newest
   postings from each source; the app ranks them against each user's own resume
   (scoreJob in app.js). */
const SPAM = ["ai trainer", "annotation", "annotator", "transcription", "transcriber", "data collection",
  "voice recording", "video recording", "no experience required", "survey", "rater", "freelance writer"];
/* company boards are also fetched live by the app, so a few of the newest postings each is plenty;
   the CORS-blocked aggregators only reach users through this file, so they get more room */
const PER_BOARD = 20, PER_AGGREGATOR = 60, TOTAL = 1000;

const norm = (s) => " " + String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " ";
const strip = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const isSpam = (job) => { const t = norm(job.title); return SPAM.some((k) => t.includes(norm(k))); };
/* only plain web links are ever published; the app re-checks, this keeps the file clean */
const isWebUrl = (u) => /^https?:\/\//i.test(String(u || ""));

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
    return { ok: true, board: true, name, jobs: normBoard(ats, slug, name, d) };
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
  const keep = r.jobs.filter((job) => isWebUrl(job.url) && job.title && !isSpam(job))
    .sort((a, b) => b.posted - a.posted).slice(0, r.board ? PER_BOARD : PER_AGGREGATOR);
  matched.push(...keep);
}
matched.sort((a, b) => b.posted - a.posted);
matched.splice(TOTAL);

/* never replace a good feed with an empty or mostly-failed one */
if (!matched.length || failed.length === results.length) {
  console.error("feed agent: " + (failed.length === results.length ? "every source failed" : "no jobs collected") + "; keeping the existing jobs-feed.json");
  process.exit(1);
}

/* diff against the previous run so the digest only shows genuinely new roles */
let prevIds = new Set(), prevJobs = null;
try {
  const prev = JSON.parse(await readFile(OUT, "utf8"));
  prevJobs = prev.jobs || [];
  prevIds = new Set(prevJobs.map((j) => j.id));
} catch { /* first run */ }
const fresh = matched.filter((j) => !prevIds.has(j.id));

/* identical job list: leave the file alone so the workflow has nothing to commit (the "generated" stamp alone is not a change) */
const unchanged = prevJobs && JSON.stringify(prevJobs) === JSON.stringify(matched);
if (!unchanged) await writeFile(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  sources: results.map((r) => ({ name: r.name, ok: r.ok, count: r.jobs.length, err: r.err || null })),
  total: matched.length,
  jobs: matched,
}, null, 1), "utf8");

if (!QUIET) {
  console.log(`\nNexus OS job agent - ${new Date().toLocaleString()}`);
  console.log(`${matched.length} postings | ${fresh.length} new`);
  if (failed.length) console.log(`unreachable: ${failed.map((f) => `${f.name} (${f.err})`).join(", ")}`);
  if (fresh.length) console.log("\n--- NEWEST ---");
  for (const j of fresh.slice(0, 15)) {
    console.log(`${j.title}`);
    console.log(`     ${j.company || j.srcLabel} | ${j.loc || "-"} | ${j.srcLabel}`);
    console.log(`     ${j.url}`);
  }
  if (!fresh.length) console.log("\n(nothing new since the last run)");
  console.log(`\nwrote ${OUT}`);
}

/* undici keeps sockets alive and would hold the event loop open,
   which also swallows buffered stdout when piped — exit explicitly. */
process.exit(0);
