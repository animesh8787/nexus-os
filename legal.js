/* Fills the operator's name and contact address into the privacy policy / terms from
   firebase-config.js, so the legal pages are never published with placeholder text.
   If they haven't been set, the page says so visibly (the operator must fix that before launch). */
(function () {
  if (window.NXI) NXI.hydrate();
  var c = window.NEXUS_CONFIG || {};
  var email = String(c.contactEmail || "").trim(), operator = String(c.operatorName || "").trim();
  var okEmail = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email);

  [].forEach.call(document.querySelectorAll("[data-contact]"), function (n) {
    if (okEmail) {
      var a = document.createElement("a");
      a.href = "mailto:" + email; a.textContent = email;
      n.textContent = ""; n.appendChild(a);
    } else {
      n.textContent = "[contact address not configured]";
      n.className += " legal-missing";
    }
  });
  [].forEach.call(document.querySelectorAll("[data-operator]"), function (n) {
    if (operator) n.textContent = operator;
    else { n.textContent = "[operator name not configured]"; n.className += " legal-missing"; }
  });
  if (!okEmail || !operator) {
    var b = document.getElementById("legalWarn");
    if (b) b.hidden = false;
  }
  var d = document.getElementById("legalYear");
  if (d) d.textContent = new Date().getFullYear();
})();
