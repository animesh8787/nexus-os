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

Firefox needs its own manifest, and it only loads a file named `manifest.json`. Build a
Firefox copy instead of renaming files in the repo:

1. ```bash
   cp -r nexus-leethub nexus-leethub-firefox
   cp nexus-leethub-firefox/manifest.firefox.json nexus-leethub-firefox/manifest.json
   ```
2. Go to `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on**.
3. Pick `manifest.json` inside `nexus-leethub-firefox`.
4. Firefox treats MV3 host access as opt-in: open `about:addons` → Nexus OS → **Permissions**
   and allow access to `leetcode.com` and `api.github.com`, otherwise nothing is detected or pushed.

> Firefox unloads temporary add-ons when it restarts; load it again from the same page.
> The Firefox build has not been tested end to end; the Chromium build is the supported one.

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
| Push | One commit (Git Data API: tree, commit, branch update) containing `solutions/<topic>/<id>-<slug>.<ext>`, the updated `solutions/index.json` and the regenerated `README.md`. |
| Result | A toast on the LeetCode page confirms the commit. |

**Push rule: first Accept per problem.** Re-solving the same problem only commits
again if the code actually changed, so repeat submissions don't spam your history.

The only automatic trigger is the network hook on the submission check response. The
popup has a **Push current solution** button as a manual backstop if LeetCode changes
that endpoint.

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
| `content.js` | Isolated world: injects the hook, assembles the solve |
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
