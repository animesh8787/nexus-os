const api = globalThis.browser || globalThis.chrome;
const $ = (id) => document.getElementById(id);
const out = $("out");

const DEFAULTS = {
  ghToken: "", ghRepo: "leetcode-solutions", ghPrivate: false, autoPush: true,
};

api.storage.local.get(Object.keys(DEFAULTS), (s) => {
  $("repo").value = s.ghRepo === undefined ? DEFAULTS.ghRepo : s.ghRepo;
  $("token").value = s.ghToken || "";
  $("autoPush").checked = s.autoPush === undefined ? true : !!s.autoPush;
  $("ghPrivate").checked = !!s.ghPrivate;
});

/* build the status line from nodes, never from strings: messages can echo server text */
function show(cls, text, extra) {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  if (extra) s.appendChild(extra);
  out.replaceChildren(s);
}

function save() {
  return new Promise((res) => {
    api.storage.local.set({
      ghRepo: $("repo").value.trim() || "leetcode-solutions",
      ghToken: $("token").value.trim(),
      autoPush: $("autoPush").checked,
      ghPrivate: $("ghPrivate").checked,
    }, res);
  });
}

$("save").addEventListener("click", async () => {
  await save();
  show("ok", "Saved.");
});

$("test").addEventListener("click", async () => {
  await save();
  out.textContent = "Testing...";
  api.runtime.sendMessage({ type: "TEST_GH" }, (r) => {
    if (api.runtime.lastError) {
      show("err", api.runtime.lastError.message);
      return;
    }
    if (r && r.ok) {
      const a = document.createElement("a");
      a.href = r.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = r.repo;
      show("ok", "Connected as " + r.login + " — ", a);
    } else {
      show("err", (r && r.error) || "failed");
    }
  });
});
