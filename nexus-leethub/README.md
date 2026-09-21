# Nexus OS — LeetCode to GitHub

A browser extension that commits your accepted LeetCode solutions to GitHub
automatically. Same repo layout the Nexus OS dashboard uses, so the two stay in sync.

This exists as an extension because a web page cannot observe another site. Only an
extension can run code on leetcode.com at the moment you submit.

## Install

### Brave / Chrome / Edge

All three are Chromium, so they share the same build — use `manifest.json` as shipped.

1. Open the extensions page:
   - Brave: `brave://extensions`
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `nexus-leethub` folder.

#### Brave notes

Brave works out of the box — Shields does not block extension requests to
`api.github.com`, and its default script setting allows the page hook to run.

Two things to know:

- If you have set Shields to **Block Scripts** on leetcode.com, the page hook cannot
  run and the button will say **Page script blocked**. Click the Shields icon in the
  address bar, allow scripts for leetcode.com, and reload.
- Brave suspends idle service workers just like Chrome. If a push ever reports
  *"Extension asleep - retry"*, press the button once more.

### After reloading the extension

Whenever you reload the unpacked extension (or change its options and Brave restarts
it), any LeetCode tab that was already open keeps running the **old** content script
and can no longer reach the extension. The button detects this and turns red saying
**Reload this tab** — refresh the page and it reconnects.

This only happens during development; a normally installed extension does not
reload underneath you.

### Firefox

1. Rename the manifests — Firefox needs its own:
   ```bash
   cd nexus-leethub && mv manifest.json manifest.chrome.json && mv manifest.firefox.json manifest.json
   ```
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and pick any file in this folder.

> Firefox unloads temporary add-ons when it restarts; reload it from the same page.
> Keep both manifest files — swap them back to use the Chrome build again.

## Set up

Open the extension's **Options** and fill in:

- **Repository name** — e.g. `leetcode-solutions` (created for you if missing).
- **Fine-grained token** — [create one](https://github.com/settings/personal-access-tokens/new)
  scoped to **that one repository**, permission **Contents: read and write**.
  Add *Administration: write* only if you want the repo created automatically.
  Use a short expiry.

Hit **Test connection** to confirm before your first solve.

The token is stored in this browser profile's extension storage and is only ever sent
to `api.github.com`.

## How it works

| Step | What happens |
|---|---|
| You submit on LeetCode | A page-realm hook watches the `/submissions/detail/<id>/check/` response. |
| Verdict is **Accepted** | The code is read from the page's own Monaco editor, with runtime and memory stats. |
| Push | Commits `solutions/<topic>/<id>-<slug>.<ext>`, updates `solutions/index.json`, regenerates `README.md`. |
| Result | A toast on the LeetCode page confirms the commit. |

**Push rule: first Accept per problem.** Re-solving the same problem only commits
again if the code actually changed, so repeat submissions don't spam your history.

Two independent detectors run — the network hook plus a DOM watcher — and the popup
has a **Push current solution** button as a manual backstop.

## Staying in sync with the dashboard

`solutions/index.json` in the repo is the shared source of truth. The extension and
the Nexus OS dashboard both merge into it rather than overwriting, so neither can
drop the other's entries.

In the dashboard, **Solutions → ↓ Pull from repo** imports everything the extension
has already pushed.

## Files

| File | Role |
|---|---|
| `inject.js` | Page-realm hook: patches `fetch`/XHR, reads Monaco |
| `content.js` | Isolated world: injects the hook, assembles the solve, DOM fallback detector |
| `background.js` | Holds the token, does the GitHub commits and index/README merge |
| `options.*` | Token and repo setup |
| `popup.*` | Status, recent pushes, manual push |

## Troubleshooting

- **"Token lacks write access"** — the fine-grained token is missing
  **Contents: Read and write**, or its *Repository access* does not include the repo.
  Edit the token on GitHub (permissions can be changed without regenerating it),
  save, then push again. No need to re-paste it into the extension.
- **"This repository is empty."** — fixed in v1.0.1. A repo created on GitHub without
  ticking *Add a README* has no commits, and GitHub answers `409` there instead of
  `404`. The first push now creates the initial commit itself. Reload the extension
  if you are on an older copy.

- **Nothing pushes** — open Options, click *Test connection*. Then check the popup's
  recent-push log for the error.
- **"reload the LeetCode tab, then retry"** — the content script loads at page load;
  reload any tab that was already open when you installed the extension.
- **Wrong topic folder** — the topic comes from LeetCode's tag list, which is only in
  the DOM when the *Topics* section has been expanded. Otherwise it lands in `misc/`;
  the dashboard lets you correct the folder before pushing.
