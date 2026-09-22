/* Assemble the public site.
 *
 *   node scripts/build-site.mjs            build into ./public   (what Vercel runs)
 *   node scripts/build-site.mjs --check    build into a temp dir, verify, delete it (what CI runs)
 *
 * Only the files the site serves are copied, so tests, the Worker, the browser extension and
 * .github never end up on the public host. The build then reads every published page and script
 * and FAILS if one refers to a local file that was not copied - the classic "works on my machine,
 * 404 in production" mistake when a new script is added but not listed here.
 * Imports only node: built-ins, so there is nothing to install.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const FILES = [
  "index.html", "auth.html", "app.html", "privacy.html", "terms.html", "404.html",
  "styles.css", "site.css", "portal.css",
  "theme-boot.js", "boot.js", "legal.js", "icons.js", "sri.js", "a11y.js", "prompts.js",
  "firebase-config.js", "auth-core.js", "auth.js", "site.js",
  "sync-engine.js", "sync.js", "app.js", "ai.js", "profile.js", "tracker.js", "tracker-ui.js",
  "jobs-feed.json"
];

const isLocal = (u) => u && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);   // not http:, data:, mailto:, //cdn, #anchor
const strip = (u) => u.split("#")[0].split("?")[0].replace(/^\.\//, "");

export function build(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const missingSource = FILES.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missingSource.length) throw new Error("Listed in build-site.mjs but not in the repo: " + missingSource.join(", "));
  for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(outDir, f));

  /* every local reference in the published pages and scripts must resolve inside the output */
  const problems = [];
  const has = (name) => fs.existsSync(path.join(outDir, name));
  for (const f of FILES.filter((x) => x.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(outDir, f), "utf8");
    for (const m of html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)) {
      const u = m[1];
      if (isLocal(u) && !has(strip(u))) problems.push(f + " -> " + u);
    }
  }
  for (const f of FILES.filter((x) => x.endsWith(".js"))) {
    const js = fs.readFileSync(path.join(outDir, f), "utf8");
    for (const m of js.matchAll(/["'`]((?:\.\/)?[A-Za-z0-9_-]+\.(?:html|json|js|css))(?:[?#][^"'`]*)?["'`]/g)) {
      /* scripts mention plenty of names that aren't ours ("Node.js", CDN files); only a file that
         exists in the repo but was left out of FILES is a real 404 waiting to happen */
      const name = strip(m[1]);
      if (!has(name) && fs.existsSync(path.join(ROOT, name))) problems.push(f + " mentions " + m[1] + " (exists in the repo but is not in FILES)");
    }
  }
  if (problems.length) throw new Error("The site refers to files that would 404:\n  " + [...new Set(problems)].join("\n  "));
  return FILES.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const out = check ? fs.mkdtempSync(path.join(os.tmpdir(), "nexus-site-")) : path.join(ROOT, "public");
  try {
    const n = build(out);
    console.log((check ? "site check ok: " : "built " + path.relative(ROOT, out) + "/ : ") + n + " files");
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    if (check) fs.rmSync(out, { recursive: true, force: true });
  }
}
