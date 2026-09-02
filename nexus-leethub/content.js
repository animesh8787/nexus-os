/* ============================================================
   Isolated-world content script on leetcode.com/problems/*
   - injects inject.js into the page realm
   - on an Accepted verdict, pulls the code and problem metadata
   - renders an in-page "Push to GitHub" button
   ============================================================ */
const api = globalThis.browser || globalThis.chrome;

/* inject the page hook */
(function injectHook() {
  const s = document.createElement("script");
  s.src = api.runtime.getURL("inject.js");
  s.onload = function () { this.remove(); };
  (document.head || document.documentElement).appendChild(s);
})();

/* Brave Shields (or a strict CSP) can stop the injected script from running.
   Ping it once so failures can be reported precisely instead of looking
   like an empty editor. */
let hookAlive = false;
window.addEventListener("message", (ev) => {
  if (ev.source === window && ev.data && ev.data.source === "NEXUS_LEETHUB_PONG") hookAlive = true;
});
function pingHook(tries) {
  const n = tries == null ? 8 : tries;
  if (hookAlive || n <= 0) return;
  window.postMessage({ source: "NEXUS_LEETHUB_PING" }, "*");
  setTimeout(() => pingHook(n - 1), 400);
}
setTimeout(() => pingHook(), 300);

const slugOf = () => (location.pathname.match(/problems\/([^/]+)/) || [])[1] || "";

function titleOf() {
  return (document.title || "")
    .replace(/\s*-\s*LeetCode.*$/, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}
function difficultyOf() {
  const nodes = document.querySelectorAll("div,span");
  for (const n of nodes) {
    const t = (n.textContent || "").trim();
    if (t === "Easy" || t === "Medium" || t === "Hard") return t;
  }
  return "";
}
/* topic tags live behind a collapsed "Topics" control; read them if open */
function topicsOf() {
  const out = [];
  document.querySelectorAll('a[href^="/tag/"]').forEach((a) => {
    const t = (a.textContent || "").trim();
    if (t) out.push(t.toLowerCase().replace(/\s+/g, "-"));
  });
  return [...new Set(out)];
}

function askPageForCode(timeout = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const onMsg = (ev) => {
      if (ev.source !== window || !ev.data || ev.data.source !== "NEXUS_LEETHUB_CODE") return;
      done = true;
      window.removeEventListener("message", onMsg);
      resolve({ code: ev.data.code || "", lang: ev.data.lang || "" });
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "NEXUS_LEETHUB_GET_CODE" }, "*");
    setTimeout(() => {
      if (done) return;
      window.removeEventListener("message", onMsg);
      resolve({ code: "", lang: "" });
    }, timeout);
  });
}

/* ------------------------------------------------------------
   In-page button. This is the whole point: one click, right here,
   no clipboard and no switching to the dashboard.
   ------------------------------------------------------------ */
let btn = null, btnLabel = null, hidden = false;

const BTN_CSS = [
  "position:fixed", "right:18px", "bottom:18px", "z-index:2147483646",
  "display:flex", "align-items:center", "gap:8px",
  "padding:10px 15px", "border-radius:10px", "border:0", "cursor:pointer",
  "font:650 13px/1.2 system-ui,-apple-system,Segoe UI,sans-serif",
  "color:#fff", "background:#4f46e5",
  "box-shadow:0 6px 22px rgba(79,70,229,.45)",
  "transition:background .15s,opacity .15s",
].join(";");

function ensureButton() {
  if (hidden || btn || !document.body) return;
  btn = document.createElement("button");
  btn.setAttribute("style", BTN_CSS);
  btn.title = "Commit this solution to your GitHub repo";

  btnLabel = document.createElement("span");
  btnLabel.textContent = "Push to GitHub";
  btn.appendChild(btnLabel);

  const close = document.createElement("span");
  close.textContent = "✕";
  close.setAttribute("style", "opacity:.55;font-size:11px;padding-left:2px");
  close.title = "Hide until the next page load";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    hidden = true;
    btn.remove();
    btn = null;
  });
  btn.appendChild(close);

  btn.addEventListener("click", () => pushNow(true));
  document.body.appendChild(btn);
}

function setBtn(text, colour, disabled) {
  if (!btn || !btnLabel) return;
  btnLabel.textContent = text;
  btn.style.background = colour || "#4f46e5";
  btn.style.opacity = disabled ? ".75" : "1";
  btn.disabled = !!disabled;
}
function resetBtnSoon(ms) {
  setTimeout(() => setBtn("Push to GitHub", "#4f46e5", false), ms || 4000);
}

function banner(msg, kind) {
  const d = document.createElement("div");
  d.textContent = msg;
  d.setAttribute("style",
    "position:fixed;z-index:2147483647;right:18px;bottom:68px;padding:11px 16px;border-radius:10px;" +
    "font:600 13px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.35);" +
    "max-width:340px;background:" +
    (kind === "err" ? "#dc2626" : kind === "warn" ? "#d97706" : "#4f46e5"));
  document.body.appendChild(d);
  setTimeout(() => d.remove(), kind === "err" ? 6500 : 4000);
}

/* ------------------------------------------------------------
   The one path everything goes through: auto-detect and the
   button both land here.
   ------------------------------------------------------------ */
let busy = false, lastAuto = 0;

async function pushNow(manual, meta) {
  if (busy) return;
  const m = meta || {};

  /* LeetCode polls the check endpoint repeatedly - collapse the repeats */
  if (!manual) {
    if (Date.now() - lastAuto < 4000) return;
    lastAuto = Date.now();
  }

  busy = true;
  ensureButton();
  setBtn(manual ? "Pushing…" : "Auto-pushing…", "#6366f1", true);

  const { code, lang } = await askPageForCode();
  if (!code.trim()) {
    busy = false;
    if (!hookAlive) {
      setBtn("Page script blocked", "#dc2626", false);
      resetBtnSoon(8000);
      banner("Could not read the editor. In Brave, click the Shields icon and allow " +
             "scripts on leetcode.com, then reload.", "err");
    } else {
      setBtn("Editor is empty", "#d97706", false);
      resetBtnSoon();
      if (manual) banner("Nothing in the editor to push", "warn");
    }
    return;
  }

  const solve = {
    slug: slugOf(),
    title: titleOf(),
    difficulty: difficultyOf(),
    topics: topicsOf(),
    qid: Number(m.questionId) || 0,
    lang: lang || String(m.lang || "").toLowerCase(),
    runtime: m.runtime || "",
    memory: m.memory || "",
    code,
    url: "https://leetcode.com/problems/" + slugOf() + "/",
    solvedAt: new Date().toISOString(),
    force: !!manual,          // an explicit click always commits
  };
  if (!solve.slug) { busy = false; return; }

  /* Reloading an unpacked extension orphans the content scripts in tabs that
     were already open: sendMessage then throws synchronously. Catch it, say so
     plainly, and never leave the button stuck mid-push. */
  let settled = false;
  const finish = (fn) => { if (settled) return; settled = true; busy = false; fn(); };

  /* watchdog - the worker can be cold-started, but it should never hang */
  setTimeout(() => finish(() => {
    setBtn("Timed out - retry", "#dc2626", false);
    resetBtnSoon(6000);
  }), 30000);

  try {
    api.runtime.sendMessage({ type: "SOLVE_ACCEPTED", solve }, (res) => {
      const err = api.runtime.lastError;
      finish(() => {
        if (err) {
          setBtn("Reload this tab", "#dc2626", false);
          banner("The extension was reloaded after this page opened. Refresh the tab, then push again.", "err");
          resetBtnSoon(8000);
          return;
        }
        if (!res) { setBtn("No response", "#dc2626", false); resetBtnSoon(6000); return; }

        if (res.ok && res.action === "pushed") {
          setBtn("Pushed ✓", "#059669", false);
          banner("Pushed " + solve.title + " to GitHub");
          resetBtnSoon(6000);
        } else if (res.ok && res.action === "skipped") {
          setBtn("Already pushed ✓", "#059669", false);
          resetBtnSoon();
        } else if (res.ok && res.action === "saved") {
          setBtn("Saved (push off)", "#d97706", false);
          resetBtnSoon();
        } else {
          setBtn("Failed", "#dc2626", false);
          banner("Push failed: " + (res.error || "unknown"), "err");
          resetBtnSoon(6000);
        }
      });
    });
  } catch (e) {
    const stale = /context invalidated|receiving end does not exist/i.test(e.message || "");
    finish(() => {
      setBtn(stale ? "Reload this tab" : "Failed", "#dc2626", false);
      banner(stale
        ? "The extension was reloaded after this page opened. Refresh the tab, then push again."
        : "Push failed: " + e.message, "err");
      resetBtnSoon(8000);
    });
  }
}

/* --- detector 1: network verdict --- */
window.addEventListener("message", (ev) => {
  if (ev.source !== window || !ev.data || ev.data.source !== "NEXUS_LEETHUB_ACCEPTED") return;
  pushNow(false, ev.data.payload || {});
});

/* --- detector 2: DOM fallback, in case the endpoint shape changes --- */
const seenNodes = new WeakSet();
function watchDom() {
  new MutationObserver((muts) => {
    for (const mu of muts) {
      for (const node of mu.addedNodes) {
        if (node.nodeType !== 1) continue;
        const txt = (node.textContent || "").trim();
        if (txt === "Accepted" && !seenNodes.has(node)) {
          seenNodes.add(node);
          pushNow(false, {});
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

/* --- boot --- */
function boot() {
  ensureButton();
  watchDom();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

/* An orphaned content script loses runtime.id. Surface that on the button
   straight away rather than letting the next push discover it. */
function contextAlive() {
  try { return !!(api && api.runtime && api.runtime.id); }
  catch (e) { return false; }
}

/* LeetCode is a SPA - re-add the button when you move between problems */
let lastPath = location.pathname;
const tick = setInterval(() => {
  if (!contextAlive()) {
    clearInterval(tick);
    ensureButton();
    setBtn("Reload this tab", "#dc2626", false);
    if (btn) btn.title = "The extension was reloaded after this page opened - refresh to reconnect";
    return;
  }
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  hidden = false;
  if (btn) { btn.remove(); btn = null; }
  ensureButton();
}, 1200);

/* --- manual trigger from the toolbar popup --- */
api.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg && msg.type === "PUSH_CURRENT") {
    pushNow(true);
    reply({ ok: true });
  }
  return true;
});
