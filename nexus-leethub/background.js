/* ============================================================
   Background worker - owns the GitHub token and does the pushing.
   Classic script (no modules) so the same file works as a Chrome
   service worker and a Firefox event page.
   ============================================================ */
const api = globalThis.browser || globalThis.chrome;

const DEFAULTS = {
  ghToken: "", ghRepo: "leetcode-solutions", ghPrivate: false,
  autoPush: true, solves: {}, log: [],
};

const get = (keys) => new Promise((r) => api.storage.local.get(keys, r));
const set = (obj) => new Promise((r) => api.storage.local.set(obj, r));
async function cfg() {
  const s = await get(Object.keys(DEFAULTS));
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = s[k] === undefined ? DEFAULTS[k] : s[k];
  return out;
}

/* ---------- helpers ---------- */
const LANG_EXT = {
  python: "py", python3: "py", py: "py", "c++": "cpp", cpp: "cpp", c: "c", java: "java",
  javascript: "js", js: "js", typescript: "ts", ts: "ts", "c#": "cs", csharp: "cs",
  go: "go", golang: "go", rust: "rs", kotlin: "kt", swift: "swift", ruby: "rb",
  scala: "scala", php: "php", sql: "sql", mysql: "sql", dart: "dart", racket: "rkt",
  erlang: "erl", elixir: "ex",
};
const COMMENT = { py: "#", rb: "#", sql: "--", rkt: ";", erl: "%" };
const extOf = (l) => LANG_EXT[String(l || "").toLowerCase()] || "txt";
const lineOf = (e) => COMMENT[e] || "//";
const slugify = (s) => String(s || "").toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "misc";
const pad4 = (n) => String(n || 0).padStart(4, "0");
const NL = String.fromCharCode(10);

const b64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
/* cheap content fingerprint - only used to spot unchanged re-solves */
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/* ---------- GitHub ---------- */
async function gh(path, opts) {
  const o = opts || {};
  const r = await fetch("https://api.github.com" + path, {
    method: o.method || "GET",
    headers: Object.assign({
      Authorization: "Bearer " + o.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    }, o.body ? { "Content-Type": "application/json" } : {}),
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.message || "GitHub HTTP " + r.status);
    err.status = r.status;
    err.path = path;
    throw err;
  }
  return j;
}

/* GitHub's wording is accurate but not actionable - say what to change. */
function explain(e, repo) {
  const m = String(e.message || "");
  if (/not accessible by personal access token|must have admin rights|resource not accessible/i.test(m)) {
    return "Token lacks write access. Edit the token on GitHub: Repository access must "
         + "include \"" + repo + "\", and Permissions > Contents must be "
         + "\"Read and write\" (not Read-only). Save, then push again.";
  }
  if (/bad credentials|requires authentication/i.test(m)) {
    return "Token is invalid or expired. Create a new fine-grained token and paste it into the extension options.";
  }
  if (e.status === 404 && /\/user\/repos/.test(e.path || "")) {
    return "Cannot create the repo. Either create \"" + repo + "\" on GitHub yourself, "
         + "or grant the token Administration: Read and write.";
  }
  if (e.status === 404) {
    return "Repo \"" + repo + "\" not found for this token. Check the name in options, and make sure "
         + "the token's Repository access includes it.";
  }
  if (e.status === 409) {
    return "The repo changed while pushing. Press push again.";
  }
  if (/rate limit/i.test(m)) return "GitHub rate limit hit. Wait a minute and push again.";
  return m;
}
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

/* A repo with no commits answers GET /contents with 409 "This repository is
   empty." rather than 404, so treat both as "the file is not there yet". */
const NO_FILE = /not found|repository is empty/i;
async function getFile(owner, repo, path, token) {
  try {
    return await gh("/repos/" + owner + "/" + repo + "/contents/" + encPath(path), { token });
  } catch (e) {
    if (NO_FILE.test(e.message)) return null;
    throw e;
  }
}
const putFile = (owner, repo, path, content, message, token, sha) =>
  gh("/repos/" + owner + "/" + repo + "/contents/" + encPath(path), {
    method: "PUT", token,
    body: Object.assign({ message, content: b64(content) }, sha ? { sha } : {}),
  });

async function ensureRepo(owner, repo, token, priv) {
  try {
    return await gh("/repos/" + owner + "/" + repo, { token });
  } catch (e) {
    if (!/not found/i.test(e.message)) throw e;
    return gh("/user/repos", {
      method: "POST", token,
      body: {
        name: repo, private: !!priv, auto_init: true,
        description: "LeetCode solutions - auto-committed by Nexus OS",
      },
    });
  }
}

/* ---------- repo index, shared with the Nexus OS dashboard ---------- */
async function readIndex(owner, repo, token) {
  const f = await getFile(owner, repo, "solutions/index.json", token);
  if (!f || !f.content) return { sha: null, entries: {} };
  try {
    const clean = f.content.replace(/\s/g, "");
    const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
    const j = JSON.parse(new TextDecoder().decode(bytes));
    return { sha: f.sha, entries: j.entries || {} };
  } catch (e) {
    return { sha: f.sha, entries: {} };
  }
}

function buildReadme(entries) {
  const list = Object.values(entries);
  const byTopic = {};
  const ordered = list.slice().sort((a, b) => (a.qid || 0) - (b.qid || 0));
  for (const e of ordered) {
    const t = e.topic || "misc";
    if (!byTopic[t]) byTopic[t] = [];
    byTopic[t].push(e);
  }
  const count = { Easy: 0, Medium: 0, Hard: 0 };
  list.forEach((e) => { if (count[e.difficulty] != null) count[e.difficulty]++; });

  let md = "# LeetCode Solutions" + NL + NL;
  md += "> Auto-committed by Nexus OS. Updated " + new Date().toISOString().slice(0, 10) + "." + NL + NL;
  md += "**" + list.length + "** solutions - Easy " + count.Easy +
        " - Medium " + count.Medium + " - Hard " + count.Hard + NL + NL;

  for (const topic of Object.keys(byTopic).sort()) {
    const rows = byTopic[topic];
    const pretty = topic.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
    md += "## " + pretty + " (" + rows.length + ")" + NL + NL;
    md += "| # | Problem | Difficulty | Solution |" + NL + "|---|---|---|---|" + NL;
    for (const e of rows) {
      md += "| " + (e.qid || "") +
            " | [" + e.title + "](https://leetcode.com/problems/" + e.slug + "/)" +
            " | " + (e.difficulty || "-") +
            " | [" + e.ext + "](" + e.path + ") |" + NL;
    }
    md += NL;
  }
  return md;
}

function header(solve, ext) {
  const c = lineOf(ext);
  const lines = [
    (solve.qid ? solve.qid + ". " : "") + solve.title,
    "Difficulty: " + (solve.difficulty || "Unknown") + "   Solved: " + solve.solvedAt.slice(0, 10),
  ];
  if (solve.runtime || solve.memory) {
    lines.push("Runtime: " + (solve.runtime || "-") + "   Memory: " + (solve.memory || "-"));
  }
  lines.push(solve.url);
  return lines.map((x) => c + " " + x).join(NL) + NL + NL;
}

/* ---------- the actual push ---------- */
async function pushSolve(solve) {
  const c = await cfg();
  if (!c.ghToken) throw new Error("Add a GitHub token in the extension options");

  const me = await gh("/user", { token: c.ghToken });
  await ensureRepo(me.login, c.ghRepo, c.ghToken, c.ghPrivate);

  const ext = extOf(solve.lang);
  const topic = slugify((solve.topics && solve.topics[0]) || "misc");
  const path = "solutions/" + topic + "/" + pad4(solve.qid) + "-" + solve.slug + "." + ext;
  const body = header(solve, ext) + solve.code.trim() + NL;

  const existing = await getFile(me.login, c.ghRepo, path, c.ghToken);
  const msg = "Solve: " + (solve.qid ? solve.qid + ". " : "") + solve.title +
              " (" + (solve.difficulty || "?") + ")";
  const res = await putFile(me.login, c.ghRepo, path, body, msg, c.ghToken,
    existing && existing.sha);

  /* merge into the shared index, then regenerate the README from it */
  const idx = await readIndex(me.login, c.ghRepo, c.ghToken);
  idx.entries[solve.slug] = {
    slug: solve.slug, title: solve.title, qid: solve.qid,
    difficulty: solve.difficulty, topic, ext, path,
    solvedAt: solve.solvedAt, lang: solve.lang,
  };
  const idxJson = JSON.stringify({ updated: new Date().toISOString(), entries: idx.entries }, null, 1);
  await putFile(me.login, c.ghRepo, "solutions/index.json", idxJson,
    "Update solution index", c.ghToken, idx.sha);

  const rm = await getFile(me.login, c.ghRepo, "README.md", c.ghToken);
  await putFile(me.login, c.ghRepo, "README.md", buildReadme(idx.entries),
    "Update README index", c.ghToken, rm && rm.sha);

  return { path, commit: res.commit && res.commit.html_url, owner: me.login, repo: c.ghRepo };
}

/* ---------- message handling ---------- */
async function onSolve(solve) {
  const c = await cfg();
  const prev = c.solves[solve.slug];
  const h = hash(solve.code);

  /* "first Accept per problem": a re-solve only recommits if the code changed.
     An explicit button click sets force and always commits. */
  if (!solve.force && prev && prev.pushed && prev.hash === h) {
    return { ok: true, action: "skipped" };
  }

  const record = {
    slug: solve.slug, title: solve.title, qid: solve.qid,
    difficulty: solve.difficulty, lang: solve.lang, topics: solve.topics,
    runtime: solve.runtime, memory: solve.memory, code: solve.code,
    url: solve.url, solvedAt: solve.solvedAt, hash: h, pushed: false,
  };

  if (!c.autoPush) {
    c.solves[solve.slug] = record;
    await set({ solves: c.solves });
    return { ok: true, action: "saved" };
  }

  try {
    const out = await pushSolve(solve);
    record.pushed = true;
    record.path = out.path;
    record.commit = out.commit;
    c.solves[solve.slug] = record;
    c.log.unshift({ at: Date.now(), title: solve.title, ok: true, url: out.commit });
    await set({ solves: c.solves, log: c.log.slice(0, 50) });
    return { ok: true, action: "pushed", commit: out.commit };
  } catch (e) {
    const msg = explain(e, c.ghRepo);
    c.solves[solve.slug] = record;
    c.log.unshift({ at: Date.now(), title: solve.title, ok: false, error: msg });
    await set({ solves: c.solves, log: c.log.slice(0, 50) });
    return { ok: false, error: msg };
  }
}

api.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg) return;
  if (msg.type === "SOLVE_ACCEPTED") { onSolve(msg.solve).then(reply); return true; }
  if (msg.type === "GET_STATE") { cfg().then(reply); return true; }
  if (msg.type === "TEST_GH") {
    (async () => {
      try {
        const c = await cfg();
        if (!c.ghToken) throw new Error("no token set");
        const me = await gh("/user", { token: c.ghToken });
        const repo = await ensureRepo(me.login, c.ghRepo, c.ghToken, c.ghPrivate);
        reply({ ok: true, login: me.login, repo: repo.full_name, url: repo.html_url });
      } catch (e) {
        const c = await cfg();
        reply({ ok: false, error: explain(e, c.ghRepo) });
      }
    })();
    return true;
  }
});
