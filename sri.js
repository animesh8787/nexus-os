/* ============================================================
   Nexus OS — Subresource Integrity for every third-party script.

   The browser refuses to run a script whose bytes don't match the hash, so a
   compromised or tampered CDN can't inject code into the portal (which handles
   resumes, tracker data and a short-lived Gmail token).

   All URLs are version-pinned, so the bytes never legitimately change.
   Re-generate after bumping a version:   python scripts/sri.py
   Verify against the live files:         python scripts/sri.py --check

   Google Identity Services (accounts.google.com/gsi/client) is deliberately not
   listed: Google serves it unversioned, so a pinned hash would break on their
   next release. It is restricted by the page's Content-Security-Policy instead.
   ============================================================ */
(function () {
  var HASH = {
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js": "sha384-ZaR6mWzmJtrRibZ1Vm7SoHFr8OXjyAuGAXalGDKqbxFT18oi/z+oZLIRFkpeNor1",
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js": "sha384-I1LYojsZ5RM1cOda44Z2h42Qa6YfsQ1XkXxREnhp4ueYBR/4d1pG1K+NZM537Vsj",
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js": "sha384-Ke0FJhH7LyRqDxZ0wt+/OXV38yfQVu7g9VPEEGjYmB4RVOY/ta04uecRhsMwT7V3",
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js": "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e",
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js": "sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2",
    "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js": "sha384-nFoSjZIoH3CCp8W639jJyQkuPHinJ2NHe7on1xvlUA7SuGfJAfvMldrsoAVm6ECz"
  };

  var cache = {};

  /* Load a script, verifying its hash when we have one. Repeated calls share one load. */
  function script(url) {
    if (cache[url]) return cache[url];
    cache[url] = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = url; s.async = true;
      if (HASH[url]) { s.integrity = HASH[url]; s.crossOrigin = "anonymous"; }
      s.onload = function () { res(); };
      s.onerror = function () {
        delete cache[url];
        rej(new Error("Couldn't load " + url.split("/").pop() + " - check your connection" + (HASH[url] ? " (or the file failed its integrity check)" : "") + "."));
      };
      document.head.appendChild(s);
    });
    return cache[url];
  }

  /* fetch() a text file with the same integrity guarantee (used for the PDF worker) */
  function text(url) {
    var init = HASH[url] ? { integrity: HASH[url], mode: "cors" } : {};
    return fetch(url, init).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  window.NXSRI = { HASH: HASH, script: script, text: text };
})();
