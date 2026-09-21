/* Runs before first paint (loaded as a blocking script in <head>): sets the theme so dark
   mode never flashes light, and marks the page as JS-enabled for the reveal animations.
   Kept as a file, not inline, so the pages can use a Content-Security-Policy without 'unsafe-inline'. */
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  try {
    var t = localStorage.getItem("nexus-theme");
    if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    root.setAttribute("data-theme", t);
  } catch (e) {}
})();
