/* ============================================================
   Nexus OS: small inline SVG icon set (24px grid, 1.5px stroke,
   square caps and mitred joins). Drawn for this project; only
   functional icons live here (navigation, actions, state).
     NXI.svg("menu", 16)  -> "<svg ...>...</svg>"
     NXI.has("menu")      -> true
   ============================================================ */
(function () {
  var P = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    "arrow-right": '<path d="M4 12h16M14 6l6 6-6 6"/>',
    "arrow-left": '<path d="M20 12H4M10 6l-6 6 6 6"/>',
    "arrow-up-right": '<path d="M7 17L17 7M8 7h9v9"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    refresh: '<path d="M19 9A8 8 0 0 0 5 8M5 4v4h4M5 15a8 8 0 0 0 14 1M19 20v-4h-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7v13h12V7M10 11v6M14 11v6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    checks: '<path d="M3 12l4 4 6-8M13 15l2 2 6-8"/>',
    alert: '<path d="M12 4L2.5 20h19zM12 10v5M12 17.5v1"/>',
    eye: '<path d="M2 12c3-5 6-7 10-7s7 2 10 7c-3 5-6 7-10 7s-7-2-10-7z"/><circle cx="12" cy="12" r="3"/>',
    "eye-off": '<path d="M2 12c3-5 6-7 10-7s7 2 10 7c-3 5-6 7-10 7s-7-2-10-7z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    monitor: '<path d="M3 4h18v12H3zM9 20h6M12 16v4"/>',
    mail: '<path d="M3 5h18v14H3z"/><path d="M3 6l9 7 9-7"/>',
    send: '<path d="M21 3L3 10.5l7 3 3 7zM10 13.5L21 3"/>',
    file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6"/>',
    logout: '<path d="M10 4H4v16h6M15 8l4 4-4 4M19 12H9"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 10.5 3.8 3.8 0 0 1 17.5 18z"/>',
    "cloud-off": '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 10.5 3.8 3.8 0 0 1 17.5 18z"/><path d="M4 4l16 16"/>',
    dot: '<circle cx="12" cy="12" r="3"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5"/>',
    settings: '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><path d="M13 6h4v4h-4zM7 14h4v4H7z"/>',
    dashboard: '<path d="M3 3h8v8H3zM13 3h8v5h-8zM13 11h8v10h-8zM3 14h8v7H3z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
    terminal: '<path d="M3 5h18v14H3z"/><path d="M7 10l3 2-3 2M12 15h5"/>',
    branch: '<path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a5 5 0 0 1-5 5H9"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
    box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
    columns: '<path d="M3 4h18v16H3zM9 4v16M15 4v16"/>',
    chart: '<path d="M3 3v18h18M7 15l4-4 3 3 6-7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1c0-3 3-5 8-5s8 2 8 5v1"/>',
    message: '<path d="M4 4h16v12H9l-5 4z"/>'
  };

  function svg(name, size, cls) {
    var p = P[name];
    if (!p) return "";
    var s = size || 16;
    return '<svg class="ico' + (cls ? " " + cls : "") + '" width="' + s + '" height="' + s +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">' + p + "</svg>";
  }
  /* <span data-ico="menu" data-size="18"></span>  ->  filled with the icon */
  function hydrate(root) {
    var list = (root || document).querySelectorAll("[data-ico]");
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.getAttribute("data-hydrated")) continue;
      n.insertAdjacentHTML("afterbegin", svg(n.getAttribute("data-ico"), +n.getAttribute("data-size") || 16));
      n.setAttribute("data-hydrated", "1");
    }
  }
  window.NXI = { svg: svg, hydrate: hydrate, has: function (n) { return Object.prototype.hasOwnProperty.call(P, n); }, names: Object.keys(P) };
})();
