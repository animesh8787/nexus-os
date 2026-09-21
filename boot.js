/* Portal start-up. Gate the portal: signed-in users (or local mode) only. guard() sends everyone
   else to auth.html and never resolves, so nothing below runs for them.
   (An external file rather than an inline script, so the page can enforce a strict CSP.) */
NexusAuth.guard().then(function (user) {
  NEXUS.actions["sign-out"] = function () { NexusAuth.signOut(); };
  NexusAuth.watch();
  NXI.hydrate();
  NEXUS.start(user);
  document.documentElement.classList.remove("booting");
  if (!user.local && !user.verified) {
    NEXUS.toast("Verify your email to secure your account and unlock AI + cloud sync - we sent you a link.", "");
  }
}).catch(function (e) {
  document.documentElement.classList.remove("booting");
  var box = document.getElementById("content");
  box.textContent = "";
  var card = document.createElement("div");
  card.className = "card";
  var title = document.createElement("div");
  title.className = "card-title";
  title.textContent = "Could not start";
  var msg = document.createElement("p");
  msg.className = "mut";
  msg.style.marginTop = "8px";
  msg.textContent = String((e && e.message) || e);      // textContent: never interpret the error as HTML
  card.appendChild(title); card.appendChild(msg); box.appendChild(card);
});
