# NEXUS OS — Engineering Grind Dashboard

A personal dashboard for a CS student grinding toward a software job. Tracks
**LeetCode** and **GitHub** automatically, auto-logs the problems you solve,
commits your solutions to GitHub, and has an **AI coach** — plus the daily
schedule, habit checklist, skills, projects and job tracker.

## Run it

Open **`index.html`** in a browser. No build step, no install.

| File | What it is |
|------|-----------|
| `index.html` | markup shell |
| `styles.css` | design system (light + dark) |
| `app.js`     | all logic, plain JavaScript |

> If the browser blocks the API calls when opening the file directly, serve the
> folder: `python -m http.server` then visit `http://localhost:8000`.

## Connect your accounts (Settings)

### LeetCode + GitHub
Enter your usernames → *Save & sync*. LeetCode has no official API, so it uses
public community proxies (`leetcode-api-faisalshohag`, `leetcode-stats.tashif.codes`,
`alfa-leetcode-api`) with automatic fallback, plus a manual override if they're all down.
GitHub uses the official API + a contributions-graph proxy.

### Auto-logged solves
On every sync, new **accepted** LeetCode submissions are turned into entries in
**Solutions** (difficulty + topic looked up automatically and cached). Toggle this
off in Settings → Goals if you don't want it. Only the last ~20 submissions are
visible to the proxy, so sync regularly.

### GitHub auto-push  *(optional, needs a token)*
Settings → **GitHub auto-push**: set a repo name and a **fine-grained PAT**.

- Scope the token to **that one repo**, permission **Contents: read/write** only.
  Add *Administration: write* only if you want the app to create the repo for you.
- Use a short expiry. The token is stored in this browser in plain text and is
  sent only to `api.github.com`. **Don't enable push on a shared/public deployment.**
- Each solve with code → one commit at `solutions/<topic>/<id>-<slug>.<ext>` plus a
  regenerated `README.md` index. These commits count toward your contribution graph.
- **Solutions** page: import your code (below), then *Save & push* — or *Push all
  with code* to backfill. *Test connection* in Settings checks the token.

### Getting your code in: the browser extension

Install **`nexus-leethub/`** once — Brave, Chrome, Edge and Firefox are all covered.
In Brave: `brave://extensions` → **Developer mode** → **Load unpacked** → pick the
`nexus-leethub` folder. See [nexus-leethub/README.md](nexus-leethub/README.md).

After that there is nothing to copy or paste:

- Solve on LeetCode. When the verdict is **Accepted**, the extension reads your code
  from the page and commits it. Zero clicks.
- Prefer to decide yourself? Turn auto-push off in the extension options and use the
  **Push to GitHub** button it places on the LeetCode page. One click, right there.

It pushes on the **first Accept per problem** and only re-commits when the code
changed, so repeat submissions don't spam your history. An explicit button press
always commits.

Both the extension and this dashboard merge into `solutions/index.json` in the repo,
so neither overwrites the other's entries. Press **Solutions → ↓ Pull from repo** to
import everything the extension has pushed.

## Job Feed

**Job Feed** polls live postings and links you straight to each employer's real
application page — you upload your resume and answer their questions there.

Tabs: **New** (unseen since last check) · **India** · **Entry level** · **All**.
Each card shows why it matched, a score, and three actions: **Apply ↗** (opens the
posting), **Track** (drops a pre-filled row into Job Tracker), **✕** (hide forever).

### Sources — all verified reachable from the browser

| Kind | Sources |
|---|---|
| Company ATS boards | 38 Greenhouse / Ashby boards, seeded with employers that hire in India (Databricks, Stripe, MongoDB, Razorpay, Sarvam AI, Tower Research, Squarepoint, IMC, Jane Street, GitLab, Rubrik, Groww, Postman …) |
| Aggregators | We Work Remotely, Remotive, Remote OK, Jobicy, Arbeitnow, The Muse, HN "Who is hiring" |

Add any company under **Sources & filters → Add a company board** — paste the ATS
slug, pick Greenhouse/Lever/Ashby, and it verifies before adding.

### Matching

Filters are seeded from your resume (ML/GenAI/NLP, Python, PyTorch, full-stack,
React/FastAPI, quant, plus intern / new-grad / junior levels) and are fully editable.
A role must match at least one **skill** keyword — location and seniority only adjust
the score, they never qualify a job on their own. Seniority terms and data-labelling
gig spam are excluded.

## The daily agent

`feed-agent.mjs` runs on your machine and covers what a browser can't: the
CORS-blocked boards (**Himalayas**, **Working Nomads**, **Jobspresso**, **NoDesk**)
plus all 38 company boards. It writes `jobs-feed.json`, which the dashboard merges
into the feed automatically, and appends a digest to `agent-log.txt`.

```bash
node feed-agent.mjs
```

A Windows scheduled task **`NexusOS-JobAgent`** is registered to run it daily at
**08:00**. Manage it with:

```bash
schtasks /Query /TN "NexusOS-JobAgent" /FO LIST
```

```bash
schtasks /Run /TN "NexusOS-JobAgent"
```

```bash
schtasks /Delete /TN "NexusOS-JobAgent" /F
```

> SkipTheDrive was dropped — its RSS feed now serves HTML.
> Stack Overflow Jobs shut down in 2022.

## Sites with no API — use their email alerts

**Wellfound, LinkedIn, Indeed, Naukri, Instahyre and Glassdoor** have no public API
and block scraping. Their own job alerts are the supported route:

1. Create a job alert on each site matching your target roles.
2. Point all of them at one dedicated inbox (e.g. `your-job-alerts@example.com`).
3. Check that inbox alongside the Job Feed.

Automated reading of that inbox would need a Gmail OAuth connector — **never** a
password. Don't put site logins into any script: it violates their terms, risks a
ban, and bot protection blocks it anyway.

## Your data

Everything is in this browser's `localStorage`. Nothing leaves your machine except
the read-only calls to LeetCode/GitHub/Groq/job boards and the commits you push.
Settings → **Export / Import JSON** for backups.
