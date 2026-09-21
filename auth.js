/* ============================================================
   Nexus OS — sign-in page controller.
   modes: signin | signup | reset
   ============================================================ */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var qs = new URLSearchParams(location.search);
  var next = NexusAuth.safeNext(qs.get("next"));
  var mode = qs.get("mode") === "signup" ? "signup" : "signin";
  var busy = false;

  var COPY = {
    signin: { eyebrow: "Authentication", title: "Welcome back.", lead: "Sign in to open your portal.", submit: "Sign in", pw: "current-password" },
    signup: { eyebrow: "Create account", title: "Start your grind.", lead: "Free while in early access. Your data stays under your account.", submit: "Create account", pw: "new-password" },
    reset:  { eyebrow: "Reset password", title: "Forgot it?", lead: "Enter your email and we'll send you a link to choose a new password.", submit: "Send reset link", pw: "current-password" }
  };

  function say(id, msg) {
    var e = $(id);
    e.textContent = msg || "";
    e.classList.toggle("show", !!msg);
  }
  function clearMsgs() { say("err", ""); say("ok", ""); }

  function render() {
    var c = COPY[mode];
    $("modeEyebrow").textContent = c.eyebrow;
    $("modeTitle").textContent = c.title;
    $("modeLead").textContent = c.lead;
    $("submit").textContent = c.submit;
    $("pw").setAttribute("autocomplete", c.pw);
    $("nameFld").hidden = mode !== "signup";
    $("pwFld").hidden = mode === "reset";
    $("seg").hidden = mode === "reset";
    $("altArea").hidden = mode === "reset";
    document.querySelectorAll("#seg button").forEach(function (b) {
      var on = b.dataset.mode === mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    var f = $("forgotBtn");
    f.hidden = mode === "signup";
    f.textContent = mode === "reset" ? "Back to sign in" : "Forgot password?";
    $("switchHint").textContent = "";
    clearMsgs();
    document.title = (mode === "signup" ? "Create account" : mode === "reset" ? "Reset password" : "Sign in") + " — Nexus OS";
  }

  function setBusy(v, label) {
    busy = v;
    var b = $("submit");
    b.disabled = v;
    b.textContent = v ? label : COPY[mode].submit;
    $("googleBtn").disabled = v;
  }

  function go() { location.replace(next); }

  /* ---------- not configured: offer local mode ---------- */
  if (!NexusAuth.configured) {
    $("setupNote").hidden = false;
    $("formArea").hidden = true;
    $("localBtn").addEventListener("click", function () { NexusAuth.enterLocalMode(); go(); });
    if (NexusAuth.isLocal()) go();
    return;
  }

  /* ---------- wiring ---------- */
  $("seg").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-mode]");
    if (!b || busy) return;
    mode = b.dataset.mode; render();
  });
  $("forgotBtn").addEventListener("click", function () {
    if (busy) return;
    mode = mode === "reset" ? "signin" : "reset"; render();
  });
  $("eye").addEventListener("click", function () {
    var pw = $("pw"), show = pw.type === "password";
    pw.type = show ? "text" : "password";
    this.setAttribute("aria-pressed", show ? "true" : "false");
    this.setAttribute("aria-label", show ? "Hide password" : "Show password");
    this.innerHTML = NXI.svg(show ? "eye-off" : "eye", 16);
  });

  $("form").addEventListener("submit", async function (e) {
    e.preventDefault();
    if (busy) return;
    clearMsgs();
    var email = $("email").value.trim(), pw = $("pw").value, name = $("name").value.trim();
    if (!email) return say("err", "Enter your email address.");
    if (mode !== "reset" && !pw) return say("err", "Enter your password.");
    if (mode === "signup" && pw.length < 6) return say("err", "Choose a password of at least 6 characters.");

    try {
      if (mode === "reset") {
        setBusy(true, "Sending...");
        await NexusAuth.reset(email);
        say("ok", "If an account exists for " + email + ", a reset link is on its way.");
      } else if (mode === "signup") {
        setBusy(true, "Creating account...");
        await NexusAuth.signUp(name, email, pw);
        go();
        return;
      } else {
        setBusy(true, "Signing in...");
        await NexusAuth.signIn(email, pw);
        go();
        return;
      }
    } catch (err) {
      say("err", NexusAuth.friendly(err));
    }
    setBusy(false);
  });

  $("googleBtn").addEventListener("click", async function () {
    if (busy) return;
    clearMsgs();
    setBusy(true, "Waiting for Google...");
    try { await NexusAuth.google(); go(); return; }
    catch (err) { say("err", NexusAuth.friendly(err)); }
    setBusy(false);
  });

  render();
  /* already signed in? straight to the portal */
  NexusAuth.current().then(function (u) { if (u) go(); }).catch(function () {});
})();
