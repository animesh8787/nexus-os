/* ============================================================
   Nexus OS — landing + sign-in page behaviour (no dependencies).
   ============================================================ */
(function () {
  var root = document.documentElement;
  root.classList.add("site-page");

  /* icons */
  if (window.NXI) NXI.hydrate();

  /* theme toggle: light <-> dark, shared with the portal through "nexus-theme" */
  function paintThemeBtns() {
    var dark = root.getAttribute("data-theme") === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.innerHTML = window.NXI ? NXI.svg(dark ? "sun" : "moon", 15) : (dark ? "☀" : "☾");
      b.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    });
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-theme-toggle]");
    if (!t) return;
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("nexus-theme", next); } catch (err) {}
    paintThemeBtns();
  });
  paintThemeBtns();

  /* nav: solid background once scrolled; mobile drawer */
  var nav = document.querySelector(".s-nav");
  function onScroll() { if (nav) nav.classList.toggle("scrolled", window.scrollY > 16); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var burger = document.querySelector(".s-burger"), drawer = document.querySelector(".s-drawer");
  if (burger && drawer) {
    burger.addEventListener("click", function () {
      var open = drawer.classList.toggle("open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    drawer.addEventListener("click", function (e) {
      if (e.target.closest("a")) { drawer.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); }
    });
  }

  /* reveal on scroll */
  var items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    items.forEach(function (n) { io.observe(n); });
  } else {
    items.forEach(function (n) { n.classList.add("in"); });
  }

  /* cursor glare on feature cards */
  if (matchMedia("(pointer: fine)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.addEventListener("mousemove", function (e) {
      var c = e.target.closest && e.target.closest(".feat");
      if (!c) return;
      var r = c.getBoundingClientRect();
      c.style.setProperty("--glare-x", ((e.clientX - r.left) / r.width) * 100 + "%");
      c.style.setProperty("--glare-y", ((e.clientY - r.top) / r.height) * 100 + "%");
    }, { passive: true });
  }

  /* after "delete my account" the portal sends people here with ?deleted=1 */
  if (/[?&]deleted=1\b/.test(location.search)) {
    var bar = document.createElement("div");
    bar.className = "notice-bar"; bar.setAttribute("role", "status");
    bar.textContent = "Your account and data have been deleted.";
    document.body.appendChild(bar);
    if (history.replaceState) history.replaceState(null, "", location.pathname);
  }

  /* signed-in visitors get "Open portal" instead of "Sign in" - only when Firebase restores a session cheaply */
  if (window.NexusAuth) {
    NexusAuth.current().then(function (u) {
      if (!u) return;
      document.querySelectorAll("[data-auth-link]").forEach(function (a) {
        a.setAttribute("href", "app.html");
        var l = a.querySelector(".lbl"); if (l) l.textContent = "Open portal";
      });
    }).catch(function () {});
  }
})();
