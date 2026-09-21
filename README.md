# NEXUS OS

A job-hunt portal for engineers: a **resume-matched job feed**, an **application tracker that fills itself from your inbox**, an **AI coach**, and the LeetCode/GitHub tracking it grew out of.

```
index.html  landing page  ->  auth.html  sign in / sign up (Firebase)  ->  app.html  the portal
```

No framework and nothing to install: static files hosted on Vercel, plus one optional Cloudflare Worker that holds the shared Groq key.

## Run it locally

```bash
python -m http.server 8000
```

Open <http://localhost:8000>. With `firebase-config.js` still empty the app runs in **local mode**: click *Continue in local mode* on the sign-in page and everything works, with data kept in this browser. (Serve over `http://localhost` rather than opening the file directly — sign-in and some browser APIs need it.)

| File | Role |
|---|---|
| `index.html`, `site.css`, `site.js` | landing page |
| `auth.html`, `auth.js`, `auth-core.js` | Firebase sign-in (email/password + Google), portal gate |
| `app.html`, `app.js`, `styles.css`, `portal.css` | the portal shell, core views, design system |
| `profile.js` | resume upload/parse, profile editor, feed rules |
| `tracker.js`, `tracker-ui.js` | pipeline logic + email classifier; board, drawer, Gmail sync |
| `ai.js`, `prompts.js` | AI layer; every prompt lives in `prompts.js` (shared with the Worker) |
| `sync-engine.js`, `sync.js` | cross-device sync (Firestore) + account deletion |
| `a11y.js`, `sri.js` | focus trap / accessible dialog; Subresource-Integrity hashes for every CDN script |
| `privacy.html`, `terms.html`, `legal.js` | Privacy Policy and Terms (operator + contact come from config) |
| `theme-boot.js`, `boot.js` | start-up scripts (external files so the pages can enforce a strict CSP) |
| `vercel.json`, `.vercelignore`, `scripts/build-site.mjs` | Vercel deployment: what gets published, response headers, and the missing-file check |
| `firebase-config.js` | **your deployment settings** — fill this in |
| `firestore.rules`, `firebase.json` | Firestore security rules |
| `worker/` | Cloudflare Worker: the Groq proxy |
| `nexus-leethub/` | browser extension: LeetCode → GitHub |
| `feed-agent.mjs` | daily job-board crawler (GitHub Actions) |
| `tests/`, `worker/test/`, `e2e/` | unit tests (`node --test`) and browser tests (Playwright) |

## Set it up for real users

Do these once. Each step is independent — the portal degrades gracefully if you skip one.

### 1. Firebase sign-in

1. [Firebase console](https://console.firebase.google.com) → create a project → **Build → Authentication → Get started**.
2. Enable the **Email/Password** and **Google** providers.
3. **Authentication → Settings → Authorised domains**: add your site's domain (`your-project.vercel.app` and any custom domain). `localhost` is there by default.
4. **Project settings → Your apps → Web app** → copy the config into `firebase-config.js` (`apiKey`, `authDomain`, `projectId`, `appId`, …). These values are public identifiers, not secrets.

New email/password accounts must **verify their email** (Nexus sends the link on sign-up) before they can use the AI features or cloud sync. Google sign-ins are already verified.

Each account's data is namespaced in the browser (`nexus-os:v3:<uid>`). The first account to sign in on a browser that already had the old single-user data adopts it.

### 2. Cloud sync (Firestore) — so data survives clearing the browser and follows you between devices

1. Firebase console → **Build → Firestore Database → Create database** (production mode, any region).
2. **Rules** tab → paste the contents of [`firestore.rules`](firestore.rules) → **Publish** (or `firebase deploy --only firestore:rules`).
3. In the Rules Playground check that an unauthenticated read is **denied** and that reading another user's path is **denied**. The rules have not been run against the emulator in this repo, so do this once.

Each account's data lives under `users/{uid}/…` and only that account can read or change it. Writes also require a verified email and a fixed record shape. Nothing else is stored.

What syncs: applications, solutions, profile, resume text, feed rules, schedule, habits, projects, settings, coach history. **What never syncs:** your GitHub token and Groq key, the job-feed cache, and the GitHub API payload — they stay on the device where you entered them.

How merging works: every document/item is compared against what that device last synced. Only-local changes are pushed, only-remote changes are pulled, and if both sides changed the *later edit wins* (the losing local copy is backed up in the browser first). A delete on one device removes the item on the others, but an edit made elsewhere *after* a delete wins, so nothing is silently lost. A device pulls before it ever pushes, so a fresh device can't overwrite your real data with defaults. This logic is in `sync-engine.js` and has its own tests.

Cost: Firestore's free tier (50k reads / 20k writes per day) is plenty for personal use. A full sync reads every document once; the app does one on start, one when you return to the tab after 5+ minutes, and small pushes after edits. Turn it off with `sync: false` in `firebase-config.js`.

### 3. The AI proxy (so users don't need their own Groq key)

A key placed in a web page is readable by anyone, so it lives in a Worker that only accepts Firebase-signed-in users and builds the prompts itself.

```bash
cd worker
# edit wrangler.toml: FIREBASE_PROJECT_ID and ALLOWED_ORIGINS (your site's origin, e.g. https://your-project.vercel.app - no path, no trailing slash; comma-separate several)
npx wrangler deploy
npx wrangler secret put GROQ_API_KEY        # paste your key when prompted
```

Copy the printed `https://nexus-os-ai.<you>.workers.dev` URL into `firebase-config.js` as `api`. Users then get the coach, resume parsing and job advice with no key. Anyone who prefers can still paste their own Groq key in Settings.

What the Worker enforces:

- **Identity:** RS256 signature check against Google's keys, `aud`/`iss`/`exp` claims, and a **verified email** (`email_verified` must be exactly `true`). Anonymous sign-ins and throwaway-mail domains (a built-in list, extendable with `BLOCKED_EMAIL_DOMAINS`) are refused.
- **Limits:** per user per minute and per day (`MINUTE_LIMIT`, `DAILY_LIMIT`), per **IP** per minute (`IP_MINUTE_LIMIT`), and a **global daily ceiling** (`GLOBAL_DAILY_LIMIT`) that bounds what the key can ever cost. Checks run before anything is counted, so a refused request never burns a quota.
- **No free chatbot:** a client sends `{action, data}`, never a prompt; the prompts live in `prompts.js`. Origin allow-list, 90 KB body cap, provider errors never forwarded.

Why verified-email rather than a CAPTCHA on sign-up: sign-up goes straight to Firebase's public API, so a bot can skip any widget on our page. The checks that can't be bypassed are the ones the Worker makes on every call.

Optional: bind a KV namespace named `RATE` (see `wrangler.toml`) so counters survive restarts. Each call does two KV writes and Cloudflare's free plan allows ~1,000 writes/day, i.e. ~500 AI calls/day in total; for more, use the $5 Workers plan.

### 4. Gmail sync (the tracker fills itself)

Read-only, in the browser, no server involved. Google's sign-in gives the page a ~1-hour access token that is kept **in memory only**; Nexus reads the sender, subject, date and Gmail's short snippet of job-related mail.

1. [Google Cloud console](https://console.cloud.google.com) → use the project behind your Firebase app.
2. **APIs & Services → Library → Gmail API → Enable.**
3. **OAuth consent screen**: add the scope `.../auth/gmail.readonly`; while the app is in *Testing*, add each user's Google address under **Test users**.
4. **Credentials → Create credentials → OAuth client ID → Web application.** Add your site's origin (and `http://localhost:8000` for development) under **Authorised JavaScript origins**.
5. Put that client ID in `firebase-config.js` as `googleClientId`.

**Inbox review.** The classifier is rule-based and can be wrong, so the Job Tracker has an *Inbox review* card listing every email Nexus filed. For each one you can change what it is (confirmation / assessment / interview / offer / rejection), move it to another application, confirm it (*Looks right*), or remove it with *Not a job email*. Removed mail is remembered by its Gmail id and never filed again (*Restore* undoes that). Stages are recomputed from the timeline after every correction, and an application Nexus created from a single email disappears with it.

**Optional AI check for unclear emails.** Emails the rules can't place can be sent to Groq to be classified - but only if the user turns it on. It is **off by default**; turning it on opens a dialog that lists exactly what is sent (sender name + domain, subject, Gmail's snippet - never the address, bodies or attachments; at most 20 per check) and the user must agree. It works through the Worker (`email_triage` in `prompts.js`) or the user's own Groq key, results are validated in `tracker.js` (`fromAI`), and anything it files is labelled *AI-suggested* in Inbox review. `privacy.html` and `terms.html` describe it. Before launch, read Groq's current data-retention and training terms for API traffic and make sure the sentence in the Privacy Policy about Groq still matches them; Google's *Limited Use* rules only allow this transfer because the feature is user-facing, prominently disclosed and opt-in.

Things to know:

- `gmail.readonly` is a Google **restricted scope**. Up to 100 test users can use it as-is (they see an "unverified app" screen). Opening it to the public requires Google's app verification and a security assessment — plan for that before a public launch.
- The token lasts about an hour. Nexus rechecks every 10 minutes while the portal is open, then asks the user to reconnect. Checking while the page is closed would need a server holding refresh tokens; that isn't built.

### 5. Privacy Policy and Terms

`privacy.html` and `terms.html` are written against what the code actually does (what is read from Gmail, what goes to Groq, what never syncs, how to delete). Set `operatorName` and `contactEmail` in `firebase-config.js`: until you do, both pages show a visible "setup needed" banner and `[contact address not configured]` — Google's app verification checks for a real policy and contact. **They're a solid draft, not legal advice: read them, and adjust anything that doesn't match how you run the service.**

### 6. Deploy

The site is deployed by **Vercel**; GitHub Actions only tests.

1. On [vercel.com](https://vercel.com): **Add New → Project → import this repo**. The settings come from [`vercel.json`](vercel.json) (Framework: Other, build command `node scripts/build-site.mjs`, output `public`), so just press **Deploy**.
2. Add the resulting origin (`https://<project>.vercel.app`, plus your custom domain if you add one) to: Firebase **Authorised domains**, the Worker's `ALLOWED_ORIGINS` (then `npx wrangler deploy`), and the Google OAuth client's **Authorised JavaScript origins**. Missing one of these is the usual reason sign-in, the AI or Gmail fail on a new domain.
3. Every push to the default branch (`master`) deploys to production; branches and pull requests get preview URLs (add those origins too if you want to test sign-in on a preview).

[`scripts/build-site.mjs`](scripts/build-site.mjs) copies only the site's files into `public/` (no tests, Worker or extension) and **fails if any page refers to a file that wasn't copied** - so adding a new script means adding it to `FILES` in that script. `vercel.json` also sets response headers (`frame-ancestors 'none'`, `nosniff`, referrer and permissions policies).

[`ci-and-feed.yml`](.github/workflows/ci-and-feed.yml) runs **every test suite** on each push and pull request (unit, Worker, the site-build check, pinned-script hashes, browser). It publishes nothing. Note that Vercel deploys a push whether or not those tests pass, so look at the Actions tab; for a hard gate, set Vercel's *Production Branch* to a `release` branch and only merge `master` into it when Actions is green. Once a day (08:00 IST) it also refreshes `jobs-feed.json` and commits it, which makes Vercel redeploy the fresh feed.

## What's inside

**Profile & job feed.** Upload a PDF/DOCX/TXT (text is extracted in your browser) or paste it. A local scanner always runs; with AI available it's enriched. You review the extracted skills/roles/level as a *draft* and apply it. Then edit anything — skill importance, job types, locations, remote/India-only — and the feed re-ranks. Core skills outweigh listed ones. Sources: 38 company boards (Greenhouse/Lever/Ashby), aggregators, and the agent's `jobs-feed.json`.

**Job Tracker.** A board — Saved → Applied → Assessment → Interview → Offer → Closed — with drag-and-drop and a per-application dated timeline. Applications arrive three ways: press **Apply** in the feed and Nexus asks "Did you apply?" when you return; **Track** saves a job for later; and Gmail sync turns confirmation, assessment, interview, offer and rejection emails into dated events (creating the application if it wasn't tracked). Nexus never applies on your behalf.

**AI coach** (Groq). Daily briefing, next problems, weekly retro, solution review, **"What can I do better?"** on a pushed solution (code feedback plus job-search advice grounded in your real funnel), and **Job-search advice** from the tracker's numbers.

**LeetCode → GitHub.** Sync LeetCode/GitHub, auto-log accepted solves, and commit solutions to a repo — from the dashboard or, with zero clicks, from the [`nexus-leethub`](nexus-leethub/README.md) extension. Both merge into `solutions/index.json`.

**Also:** schedule, habit checklist, streaks, skills, projects, analytics, export/import.

## Data & privacy

- Portal data lives in `localStorage`, namespaced per account, and — when signed in and Firestore is set up — is synced to that account's private area (see step 2). Settings → Export/Import JSON for backups.
- **Delete my account and data** (Settings → Danger zone) re-checks your password, then erases the Firestore copy, revokes Gmail access, clears this device and deletes the Firebase account. A wrong password aborts before anything is removed. Other browsers where you used the portal keep their local copy until you clear their site data — Nexus can't reach into them.
- Resume text goes to the AI provider only when you press Parse. Nothing is applied to your profile until you confirm the draft.
- Gmail: read-only, job-related mail only, headers + snippet only, token in memory only, *Disconnect* revokes it.
- The GitHub token (for pushing solutions) is stored in the browser and sent only to `api.github.com` — use a fine-grained token scoped to one repo.
- Sites with no public API (LinkedIn, Indeed, Naukri, …) can't be read directly. Their job-alert emails and confirmations are picked up by Gmail sync instead. Never put job-site passwords into anything.

## Security notes

- **Content-Security-Policy** on every page (a `<meta>` tag, so it works on any static host; `vercel.json` adds `frame-ancestors` and other headers a meta tag can't): no inline scripts, scripts only from `self` and the CDNs/Google hosts we use, no `<object>`, `base-uri`/`form-action` locked. If Google sign-in ever fails after a change, check the console for "Refused to load…" and adjust the tag.
- **Subresource Integrity** on Firebase, pdf.js and mammoth (hashes in `sri.js`; regenerate with `python scripts/sri.py` after bumping a version). A tampered CDN file will not run. Google Identity Services is unversioned, so it is covered by the CSP instead.
- Every string from a third party (job titles, email subjects, problem names, AI output) is escaped before display; toasts are plain text.
- The GitHub token and Groq key you type are stored in your browser only and are never synced.

## Tests

```bash
node --test tests/*.test.js             # resume parsing, email classification, pipeline, funnel, sync merge, auth
cd worker && node --test test/*.test.js # token verification, verified-email + abuse limits, CORS, prompt ownership
cd e2e && npm ci && npx playwright install chromium && npx playwright test    # real-browser flows
python scripts/sri.py --check           # pinned script hashes still match the CDN (needs network)
```

The browser tests run the real pages in Chromium. Signed-in behaviour uses a stand-in for Firebase and an in-memory Firestore that enforces the same rules as `firestore.rules`, shared between two browser contexts — so two-device sync, verified-email gating and account deletion are exercised through the real UI. They also fail on any CSP violation. CI runs everything before every deploy.

Not covered by automated tests (do these once after setup): the real Firebase sign-in success path, real Google/Gmail consent, real Groq calls, and the security rules against the Firestore emulator.

## The daily job agent

`feed-agent.mjs` fetches sources a browser can't reach (Himalayas, Working Nomads, Jobspresso, NoDesk) plus all company boards and writes `jobs-feed.json`, which the feed merges in.

```bash
node feed-agent.mjs
gh workflow run "tests + job feed"     # run it now on GitHub
```
