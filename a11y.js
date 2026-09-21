/* ============================================================
   Nexus OS — small accessibility helpers.

     NXA11y.trap(getRoot, { onClose })   keep Tab inside a dialog, Escape closes,
                                         returns release() that restores focus
     NXA11y.remember() / .restore(mem)   keep keyboard focus across an innerHTML re-render
     NXA11y.dialog({...})                accessible modal with optional inputs -> Promise
   ============================================================ */
(function () {
  "use strict";
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  function focusables(root) {
    return [].filter.call(root.querySelectorAll(FOCUSABLE), function (el) { return !el.hidden && (el.offsetParent !== null || el === document.activeElement); });
  }

  /* getRoot is a function because the drawer's DOM is replaced on every re-render */
  function trap(getRoot, opts) {
    opts = opts || {};
    var prev = document.activeElement;
    function onKey(e) {
      var root = getRoot();
      if (!root) return;
      if (e.key === "Escape" && opts.onClose) { e.preventDefault(); e.stopPropagation(); opts.onClose(); return; }
      if (e.key !== "Tab") return;
      var f = focusables(root);
      if (!f.length) { e.preventDefault(); root.focus(); return; }
      var first = f[0], last = f[f.length - 1], inside = root.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey, true);
    var root = getRoot();
    if (root) {
      if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
      var start = (opts.initial && root.querySelector(opts.initial)) || focusables(root)[0] || root;
      start.focus();
    }
    return function release(restore) {
      document.removeEventListener("keydown", onKey, true);
      if (restore !== false && prev && document.contains(prev) && prev.focus) prev.focus();
    };
  }

  /* --- keep focus when a view re-renders itself --- */
  function keyOf(d) { return (d.id || "") + "|" + (d.s || "") + "|" + (d.k || "") + "|" + (d.i || ""); }
  function remember() {
    var a = document.activeElement;
    if (!a || a === document.body) return null;
    var d = a.dataset || {};
    return { id: a.id || "", action: d.action || "", key: keyOf(d), sel: a.selectionStart };
  }
  function restore(mem, scope) {
    if (!mem) return;
    var root = scope || document, el = mem.id ? document.getElementById(mem.id) : null;
    if (!el && mem.action) {
      el = [].slice.call(root.querySelectorAll('[data-action="' + mem.action + '"]')).filter(function (c) { return keyOf(c.dataset) === mem.key; })[0];
    }
    if (el && el.focus) { el.focus(); if (mem.sel != null && el.setSelectionRange) { try { el.setSelectionRange(mem.sel, mem.sel); } catch (e) {} } }
  }

  /* --- dialog ---
     dialog({ title, bodyHtml, confirmLabel, danger, fields:[{id,label,type,placeholder,autocomplete}],
              enableWhen(values)->bool })  ->  Promise<{ ok, values }>                              */
  function dialog(o) {
    return new Promise(function (resolve) {
      var uid = "dlg" + Math.random().toString(36).slice(2, 7), fields = o.fields || [];
      var back = document.createElement("div");
      back.className = "dlg-back";
      back.innerHTML =
        '<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="' + uid + 't" aria-describedby="' + uid + 'b">' +
        '<h2 class="dlg-t" id="' + uid + 't">' + esc(o.title) + '</h2>' +
        '<div class="dlg-b" id="' + uid + 'b">' + (o.bodyHtml || "") + '</div>' +
        fields.map(function (f) {
          return '<div class="dlg-f"><label for="' + uid + f.id + '" class="field-label">' + esc(f.label) + '</label>' +
            '<input class="input" id="' + uid + f.id + '" data-f="' + esc(f.id) + '" type="' + esc(f.type || "text") + '" placeholder="' + esc(f.placeholder || "") +
            '" autocomplete="' + esc(f.autocomplete || "off") + '"></div>';
        }).join("") +
        '<div class="dlg-actions"><button type="button" class="btn btn-ghost" data-dlg="cancel">Cancel</button>' +
        '<button type="button" class="btn ' + (o.danger ? "btn-danger-solid" : "btn-primary") + '" data-dlg="ok"' + (o.enableWhen ? " disabled" : "") + '>' + esc(o.confirmLabel || "OK") + '</button></div></div>';
      document.body.appendChild(back);

      var box = back.querySelector(".dlg"), ok = back.querySelector('[data-dlg="ok"]');
      function values() { var v = {}; [].forEach.call(back.querySelectorAll("[data-f]"), function (i) { v[i.getAttribute("data-f")] = i.value; }); return v; }
      function refresh() { if (o.enableWhen) ok.disabled = !o.enableWhen(values()); }
      var release = trap(function () { return box; }, { onClose: function () { done(false); }, initial: "[data-f]" });
      function done(yes) {
        var v = values();
        release(true); back.remove();
        resolve({ ok: !!yes, values: v });
      }
      back.addEventListener("input", refresh);
      back.addEventListener("click", function (e) {
        var b = e.target.closest("[data-dlg]");
        if (b) done(b.getAttribute("data-dlg") === "ok");
        else if (e.target === back) done(false);
      });
      back.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT" && !ok.disabled) { e.preventDefault(); done(true); } });
    });
  }

  window.NXA11y = { trap: trap, remember: remember, restore: restore, dialog: dialog, focusables: focusables };
})();
