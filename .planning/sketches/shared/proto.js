/* V2-DX throw-away prototype helpers (vanilla JS, no network, no storage of any data).
   Exposes window.Proto. Synthetic data only. */
(function () {
  "use strict";

  const ICONS = {
    today:
      '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    wallet:
      '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5M16 13H8M16 17H8M10 9H8"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    booked:
      '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5M16 2v4M8 2v4M3 10h5"/><circle cx="16" cy="16" r="6"/><path d="M16 14v2l1 1"/>',
    waiting:
      '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
    doctor:
      '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>',
    rupee: '<path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3M9 13c6.67 0 6.67-10 0-10"/>',
    done: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    noshow:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 5 5M22 8l-5 5"/>',
    cancelled: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
    allergy: '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86Z"/><path d="M12 8v4M12 16h.01"/>',
    warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    vitals:
      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    sparkles:
      '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0Z"/><path d="M20 3v4M22 5h-4"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    wifioff:
      '<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M2 2l20 20"/>',
    refresh:
      '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"/>',
    printer:
      '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    phone:
      '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
    addsquare: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>',
    shield:
      '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7ZM8.5 8.5l7 7"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
    panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    building:
      '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
    smartphone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    note: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    flask: '<path d="M9 2v7.31L3.5 19a2 2 0 0 0 1.74 3h13.52a2 2 0 0 0 1.74-3L15 9.31V2M8.5 2h7M7 16h10"/>',
  };

  function icon(name, cls) {
    return (
      '<svg class="icon ' +
      (cls || "") +
      '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      (ICONS[name] || "") +
      "</svg>"
    );
  }

  /* Brand mark (PO-19 default: teal tile, white "Q"). Same geometry as 002-icon/icon.svg. */
  function mark(size) {
    const s = size || 36;
    return (
      '<svg class="mark" width="' +
      s +
      '" height="' +
      s +
      '" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="var(--pwa-icon-tile)"/>' +
      '<circle cx="246" cy="242" r="112" fill="none" stroke="#fff" stroke-width="58"/>' +
      '<path d="M300 298 372 370" stroke="#fff" stroke-width="58" stroke-linecap="round"/></svg>'
    );
  }

  const inr = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  /* Money is integer paise (DESIGN_SYSTEM §7.7). */
  function formatINR(paise) {
    const abs = Math.abs(paise);
    const v = abs % 100 ? inr2.format(abs / 100) : inr.format(abs / 100);
    return paise < 0 ? "−" + v : v;
  }
  function formatWait(min) {
    if (min < 60) return min + " min";
    const h = Math.floor(min / 60);
    const m = String(min % 60).padStart(2, "0");
    return h + " h " + m + " min";
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------------------------------------------------------- live region + toasts */
  let live;
  function announce(text) {
    if (!live) return;
    live.textContent = "";
    window.setTimeout(function () {
      live.textContent = text;
    }, 30);
  }
  function toast(text, opts) {
    const host = document.getElementById("toasts");
    if (!host) return;
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.innerHTML = "<span>" + esc(text) + "</span>";
    if (opts && opts.undo) {
      const b = document.createElement("button");
      b.className = "btn";
      b.type = "button";
      b.textContent = "Undo";
      b.addEventListener("click", function () {
        opts.undo();
        t.remove();
      });
      t.appendChild(b);
    }
    host.appendChild(t);
    window.setTimeout(function () {
      t.remove();
    }, opts && opts.undo ? 8000 : 4000);
  }

  /* ---------------------------------------------------------------- sheets (dialog semantics) */
  const stack = [];
  function trap(e) {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeSheet();
      return;
    }
    if (e.key !== "Tab") return;
    const f = Array.from(
      top.el.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(function (n) {
      return n.offsetParent !== null;
    });
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  function openSheet(opts) {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    const el = document.createElement("div");
    el.className = "sheet" + (opts.wide ? " sheet-wide" : "");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    const id = "sheet-title-" + (stack.length + 1) + "-" + Date.now();
    el.setAttribute("aria-labelledby", id);
    el.innerHTML =
      '<div class="sheet-head"><div class="grow"><h2 class="title-2" id="' +
      id +
      '">' +
      esc(opts.title) +
      "</h2>" +
      (opts.context ? '<p class="body-sm muted">' + opts.context + "</p>" : "") +
      '</div><button type="button" class="icon-btn" data-close aria-label="Close">' +
      icon("x") +
      '</button></div><div class="sheet-body">' +
      opts.body +
      "</div>" +
      (opts.foot ? '<div class="sheet-foot">' + opts.foot + "</div>" : "");
    document.body.appendChild(scrim);
    document.body.appendChild(el);
    const entry = { el: el, scrim: scrim, restore: document.activeElement, onClose: opts.onClose };
    stack.push(entry);
    el.querySelector("[data-close]").addEventListener("click", closeSheet);
    scrim.addEventListener("click", function () {
      if (!opts.dirty || !opts.dirty()) closeSheet();
    });
    const target = opts.focus ? el.querySelector(opts.focus) : el.querySelector("input, button:not([data-close])");
    if (target) target.focus();
    return el;
  }
  function closeSheet() {
    const top = stack.pop();
    if (!top) return;
    top.el.remove();
    top.scrim.remove();
    if (top.onClose) top.onClose();
    if (top.restore && document.contains(top.restore)) top.restore.focus();
  }
  function sheetOpen() {
    return stack.length > 0;
  }

  /* ---------------------------------------------------------------- menus */
  let openMenuEl = null;
  function closeMenu(restore) {
    if (!openMenuEl) return;
    const btn = openMenuEl._btn;
    openMenuEl.remove();
    openMenuEl = null;
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (restore && btn) btn.focus();
  }
  function menu(btn, items) {
    closeMenu(false);
    const m = document.createElement("div");
    m.className = "menu";
    m.setAttribute("role", "menu");
    m.innerHTML = items
      .map(function (it, i) {
        if (it === "-") return "<hr>";
        return (
          '<button type="button" role="menuitem" tabindex="-1" data-i="' +
          i +
          '" class="' +
          (it.danger ? "danger" : "") +
          '">' +
          (it.icon ? icon(it.icon) : "") +
          esc(it.label) +
          "</button>"
        );
      })
      .join("");
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    const w = 220;
    m.style.top = window.scrollY + r.bottom + 4 + "px";
    m.style.left = Math.max(8, Math.min(window.scrollX + r.right - w, window.innerWidth - w - 8)) + "px";
    m.style.width = w + "px";
    m._btn = btn;
    btn.setAttribute("aria-expanded", "true");
    openMenuEl = m;
    const buttons = Array.from(m.querySelectorAll("button"));
    buttons[0].focus();
    m.addEventListener("keydown", function (e) {
      const i = buttons.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        buttons[(i + 1) % buttons.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        buttons[(i - 1 + buttons.length) % buttons.length].focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeMenu(true);
      }
    });
    m.addEventListener("click", function (e) {
      const b = e.target.closest("button");
      if (!b) return;
      const it = items[Number(b.dataset.i)];
      closeMenu(false);
      if (it && it.run) it.run();
    });
  }
  document.addEventListener("click", function (e) {
    if (openMenuEl && !openMenuEl.contains(e.target) && e.target !== openMenuEl._btn && !openMenuEl._btn.contains(e.target))
      closeMenu(false);
  });

  /* ---------------------------------------------------------------- shell */
  const NAV = [
    { id: "today", label: "Today", icon: "today", href: "../003-today/index.html", count: "" },
    { id: "schedule", label: "Schedule", icon: "calendar", href: "#" },
    { id: "patients", label: "Patients", icon: "users", href: "#" },
    { id: "collections", label: "Collections", icon: "wallet", href: "#" },
  ];
  const NAV2 = [
    { id: "records", label: "Records", icon: "file", href: "#" },
    { id: "reports", label: "Reports", icon: "chart", href: "#" },
    { id: "settings", label: "Settings", icon: "settings", href: "../005-surfaces/settings-billing.html" },
  ];
  function navLink(n, active, cls) {
    return (
      '<a class="' +
      (cls || "") +
      '" href="' +
      n.href +
      '"' +
      (n.id === active ? ' aria-current="page"' : "") +
      ">" +
      icon(n.icon) +
      "<span>" +
      n.label +
      "</span>" +
      (n.count ? '<span class="count">' + n.count + "</span>" : "") +
      "</a>"
    );
  }
  function shell(opts) {
    const active = opts.active || "today";
    const user = opts.user || { initials: "PN", name: "Pooja N", role: "Front desk" };
    const side =
      '<nav class="nav-side" aria-label="Primary"><div class="clinic-block">' +
      mark(36) +
      "<div><b>" +
      esc(opts.clinic || "Asha Clinic") +
      "</b><span>Kothrud, Pune</span></div></div>" +
      NAV.map(function (n) {
        return navLink(n, active);
      }).join("") +
      "<hr>" +
      NAV2.map(function (n) {
        return navLink(n, active);
      }).join("") +
      '<div class="grow"></div><button type="button" class="btn btn-primary" data-action="new" style="margin:0 0 12px">' +
      icon("plus") +
      "New</button>" +
      '<div class="user"><span class="avatar">' +
      user.initials +
      "</span><div><b>" +
      esc(user.name) +
      "</b><span>" +
      esc(user.role) +
      "</span></div></div></nav>";
    const rail =
      '<nav class="nav-rail" aria-label="Primary">' +
      mark(36) +
      NAV.map(function (n) {
        return (
          '<a href="' +
          n.href +
          '" aria-label="' +
          n.label +
          '"' +
          (n.id === active ? ' aria-current="page"' : "") +
          ">" +
          icon(n.icon) +
          "</a>"
        );
      }).join("") +
      '<button type="button" class="plus" data-action="new" aria-label="New: walk-in, book, register, collect">' +
      icon("plus") +
      '</button><span class="spacer"></span>' +
      NAV2.slice(2).map(function (n) {
        return '<a href="' + n.href + '" aria-label="' + n.label + '">' + icon(n.icon) + "</a>";
      }).join("") +
      "</nav>";
    const bottom =
      '<nav class="bottombar" aria-label="Primary">' +
      navLink(NAV[0], active) +
      navLink(NAV[1], active) +
      '<button type="button" class="plus" data-action="new" aria-label="New: walk-in, book, register, collect">' +
      icon("plus") +
      "</button>" +
      navLink(NAV[2], active) +
      '<button type="button" data-action="more">' +
      icon("menu") +
      "<span>More</span></button></nav>";
    const root = document.getElementById("app");
    root.className = "shell" + (opts.focusMode ? " focus-mode" : "");
    root.innerHTML =
      '<a class="skip" href="#main">Skip to content</a>' +
      side +
      rail +
      '<div class="col">' +
      (opts.banner || "") +
      '<header class="topbar">' +
      (opts.topbar || "") +
      "</header>" +
      '<main id="main" class="main" tabindex="-1">' +
      (opts.main || "") +
      "</main></div>" +
      (opts.hideBottom ? "" : bottom);
    if (!document.getElementById("toasts")) {
      const t = document.createElement("div");
      t.id = "toasts";
      t.className = "toasts";
      document.body.appendChild(t);
    }
    if (!live) {
      live = document.createElement("div");
      live.className = "sr-only";
      live.setAttribute("aria-live", "polite");
      document.body.appendChild(live);
    }
    document.querySelectorAll('[href="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        toast("Not part of this prototype");
      });
    });
  }
  function topbarIcons(user) {
    const u = user || { initials: "PN" };
    return (
      '<button type="button" class="icon-btn bell" aria-label="Notifications, 2 unread">' +
      icon("bell") +
      '<span class="dot" aria-hidden="true">2</span></button>' +
      '<button type="button" class="icon-btn" aria-label="' +
      u.initials +
      ', account menu"><span class="avatar">' +
      u.initials +
      "</span></button>"
    );
  }

  function inField() {
    const a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
  }
  function param(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  window.Proto = {
    icon: icon,
    mark: mark,
    formatINR: formatINR,
    formatWait: formatWait,
    esc: esc,
    toast: toast,
    announce: announce,
    openSheet: openSheet,
    closeSheet: closeSheet,
    sheetOpen: sheetOpen,
    menu: menu,
    closeMenu: closeMenu,
    shell: shell,
    topbarIcons: topbarIcons,
    inField: inField,
    param: param,
  };
  document.addEventListener("keydown", trap, true);
  /* Static pages: <i data-icon="name"></i> becomes the inline SVG; [data-mark] becomes the brand mark. */
  function hydrate() {
    document.querySelectorAll("i[data-icon]").forEach(function (el) {
      el.outerHTML = icon(el.getAttribute("data-icon"), el.className);
    });
    document.querySelectorAll("[data-mark]").forEach(function (el) {
      el.outerHTML = mark(Number(el.getAttribute("data-mark")) || 36);
    });
  }
  window.Proto.hydrate = hydrate;
  hydrate();
  /* Colour direction B (?dir=b): load the semantic override after the base tokens. */
  if (param("dir") === "b") {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "../themes/direction-b.css";
    document.head.appendChild(l);
    document.documentElement.setAttribute("data-dir", "b");
  }
  /* Font trial (?font=inter|geist): load the font override after the base tokens. Default = IBM Plex. */
  const font = param("font");
  if (font === "inter" || font === "geist") {
    const f = document.createElement("link");
    f.rel = "stylesheet";
    f.href = "../themes/font-" + font + ".css";
    document.head.appendChild(f);
    document.documentElement.setAttribute("data-font", font);
  }
})();
