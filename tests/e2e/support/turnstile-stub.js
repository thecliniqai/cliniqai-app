/*
 * Local stand-in for Cloudflare's Turnstile script (V2-03 03-12c, ruling R-22). The e2e browser never reaches
 * Cloudflare: tests/e2e/fixtures.ts answers https://challenges.cloudflare.com/turnstile/v0/api.js with this file and
 * keeps blocking every other non-loopback request. It implements the explicit-render API that
 * @marsidev/react-turnstile calls (render, reset, remove, getResponse, isExpired, execute, ready) and behaves as
 * Cloudflare documents for its test site keys:
 *   1x00000000000000000000AA / 1x00000000000000000000BB  pass: the callback receives a token;
 *   2x00000000000000000000AB / 2x00000000000000000000BB  block: the error callback fires and no token is issued;
 *   3x00000000000000000000FF                            interactive: a "Verify you are human" button issues a token.
 * Tokens are Cloudflare's dummy token with a sequence suffix, so a spec can tell a reset token from the previous one.
 *
 * Spec controls on `window.__turnstileStub`: `renders` (the parameters each render got), `issued` (every token, in
 * order), `expire(id?)` (fires the expired callback; auto-refreshes unless `autoRefresh` is false), `refresh(id?)`.
 * `window.__turnstileStubSiteKey`, when set before the page loads (page.addInitScript), replaces the site key the page
 * passed: the e2e build inlines one key, so a spec runs the stub as Cloudflare runs another test key.
 * Synthetic and offline; no network, no storage.
 */
(function () {
  "use strict";
  var PASS = ["1x00000000000000000000AA", "1x00000000000000000000BB"];
  var BLOCK = ["2x00000000000000000000AB", "2x00000000000000000000BB"];
  var INTERACTIVE = "3x00000000000000000000FF";
  var DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
  var DELAY_MS = 40;

  var script = document.currentScript;
  var params = new URL(script && script.src ? script.src : "https://challenges.cloudflare.com/turnstile/v0/api.js").searchParams;
  var widgets = {};
  var nextId = 0;
  var nextToken = 0;

  var control = {
    renders: [],
    issued: [],
    autoRefresh: true,
    expire: function (id) {
      var w = pick(id);
      if (!w || !w.token) return;
      var old = w.token;
      w.token = undefined;
      w.expired = true;
      draw(w, "Expired");
      call(w, "expired-callback", old);
      if (control.autoRefresh) later(function () { issue(w); });
    },
    refresh: function (id) {
      var w = pick(id);
      if (w) issue(w);
    },
  };

  function pick(id) {
    if (id && widgets[id]) return widgets[id];
    var ids = Object.keys(widgets);
    return ids.length ? widgets[ids[ids.length - 1]] : undefined;
  }

  function later(fn) {
    setTimeout(fn, DELAY_MS);
  }

  function call(w, name, arg) {
    var fn = w.params[name];
    if (typeof fn === "function") fn(arg);
  }

  function siteKeyOf(w) {
    return window.__turnstileStubSiteKey || w.params.sitekey;
  }

  function visible(w) {
    return w.params.appearance !== "interaction-only" && w.params.appearance !== "execute";
  }

  function draw(w, state, button) {
    var box = w.container;
    box.textContent = "";
    if (!visible(w) && !button) return;
    var panel = document.createElement("div");
    panel.setAttribute("data-turnstile-stub", state);
    panel.style.cssText =
      "box-sizing:border-box;min-width:300px;width:100%;height:65px;display:flex;align-items:center;gap:12px;" +
      "padding:0 16px;border:1px solid #d1d5db;border-radius:6px;background:#fafafa;color:#1f2937;" +
      "font:14px/1.4 system-ui,sans-serif";
    if (button) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = "Verify you are human";
      b.style.cssText = "min-height:44px;padding:0 12px;border:1px solid #6b7280;border-radius:4px;background:#fff;color:#111827";
      b.addEventListener("click", function () { issue(w, true); });
      panel.appendChild(b);
    } else {
      var label = document.createElement("span");
      label.textContent = "Security check (local test stub): " + state;
      panel.appendChild(label);
    }
    box.appendChild(panel);
  }

  function issue(w, clicked) {
    if (!widgets[w.id]) return;
    var key = siteKeyOf(w);
    w.expired = false;
    if (BLOCK.indexOf(key) !== -1) {
      w.token = undefined;
      draw(w, "Failed");
      later(function () { call(w, "error-callback", "600010"); });
      return;
    }
    if (key === INTERACTIVE && !clicked) {
      w.token = undefined;
      draw(w, "Waiting", true);
      return;
    }
    if (PASS.indexOf(key) === -1 && key !== INTERACTIVE) {
      // Not a test key: the stub only stands in for Cloudflare's documented test keys.
      w.token = undefined;
      draw(w, "Invalid site key");
      later(function () { call(w, "error-callback", "110100"); });
      return;
    }
    draw(w, "Verifying");
    later(function () {
      if (!widgets[w.id]) return;
      nextToken += 1;
      w.token = DUMMY_TOKEN + "-" + nextToken;
      control.issued.push(w.token);
      draw(w, "Success");
      call(w, "callback", w.token);
    });
  }

  function containerOf(target) {
    return typeof target === "string" ? document.querySelector(target) : target;
  }

  function idOf(target) {
    if (typeof target === "string" && widgets[target]) return target;
    var el = containerOf(target);
    for (var id in widgets) if (widgets[id].container === el) return id;
    return pick() ? pick().id : undefined;
  }

  window.turnstile = {
    ready: function (fn) { fn(); },
    render: function (target, renderParams) {
      var container = containerOf(target);
      if (!container) throw new Error("turnstile stub: container not found");
      nextId += 1;
      var w = { id: "stub-widget-" + nextId, container: container, params: renderParams || {}, token: undefined, expired: false };
      widgets[w.id] = w;
      control.renders.push({
        sitekey: w.params.sitekey,
        action: w.params.action,
        appearance: w.params.appearance,
        size: w.params.size,
      });
      issue(w);
      return w.id;
    },
    execute: function (target) {
      var id = idOf(target);
      if (id) issue(widgets[id]);
    },
    reset: function (target) {
      var id = idOf(target);
      if (!id) return;
      widgets[id].token = undefined;
      issue(widgets[id]);
    },
    remove: function (target) {
      var id = idOf(target);
      if (!id) return;
      widgets[id].container.textContent = "";
      delete widgets[id];
    },
    getResponse: function (target) {
      var id = idOf(target);
      return id ? widgets[id].token : undefined;
    },
    isExpired: function (target) {
      var id = idOf(target);
      return id ? widgets[id].expired : false;
    },
  };
  window.__turnstileStub = control;

  var onload = params.get("onload");
  if (onload && typeof window[onload] === "function") window[onload]();
})();
