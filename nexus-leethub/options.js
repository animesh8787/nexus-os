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
  out.innerHTML = '<span class="ok">Saved.</span>';
});

$("test").addEventListener("click", async () => {
  await save();
  out.textContent = "Testing...";
  api.runtime.sendMessage({ type: "TEST_GH" }, (r) => {
    if (api.runtime.lastError) {
      out.innerHTML = '<span class="err">' + api.runtime.lastError.message + "</span>";
      return;
    }
    if (r && r.ok) {
      out.innerHTML = '<span class="ok">Connected as ' + r.login +
        ' &mdash; <a href="' + r.url + '" target="_blank" rel="noopener">' + r.repo + "</a></span>";
    } else {
      out.innerHTML = '<span class="err">' + ((r && r.error) || "failed") + "</span>";
    }
  });
});
