const api = globalThis.browser || globalThis.chrome;
const $ = (id) => document.getElementById(id);

const ago = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

api.runtime.sendMessage({ type: "GET_STATE" }, (c) => {
  if (!c) return;
  $("repoLine").textContent = c.ghToken
    ? c.ghRepo
    : "no token set - open Options";
  $("autoState").innerHTML = c.autoPush
    ? '<span class="pill on">ON</span>'
    : '<span class="pill off">OFF</span>';

  const solves = Object.values(c.solves || {});
  $("count").textContent = solves.length;
  $("pushed").textContent = solves.filter((s) => s.pushed).length;

  const log = c.log || [];
  $("log").innerHTML = log.length
    ? log.slice(0, 12).map((e) => {
        const label = e.ok
          ? '<span class="k good">pushed</span>'
          : '<span class="k bad">' + esc(e.error || "failed") + "</span>";
        const title = e.ok && e.url
          ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.title) + "</a>"
          : esc(e.title);
        return '<div class="row"><span class="t">' + title + "</span>" +
               label + '<span class="k" style="color:#6f6f88">' + ago(e.at) + "</span></div>";
      }).join("")
    : '<div class="empty">No pushes yet. Solve something.</div>';
});

$("opts").addEventListener("click", () => api.runtime.openOptionsPage());

$("push").addEventListener("click", () => {
  api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !/leetcode\.com\/problems\//.test(tab.url || "")) {
      $("repoLine").textContent = "open a LeetCode problem tab first";
      return;
    }
    api.tabs.sendMessage(tab.id, { type: "PUSH_CURRENT" }, () => {
      if (api.runtime.lastError) {
        $("repoLine").textContent = "reload the LeetCode tab, then retry";
        return;
      }
      window.close();
    });
  });
});
