/**
 * The one definition of "loopback" for every test-lane network guard (V2-01a worker guard, V2-02 e2e server guard).
 * CommonJS so `tests/e2e/support/server-net-guard.cjs` can load it through `NODE_OPTIONS=--require` before Next starts,
 * and so Vitest / Playwright load it with Node's own `require` (no transform).
 */
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS module shared with the NODE_OPTIONS=--require server guard */

const net = require("node:net");

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True only for names and addresses that cannot leave this machine. */
function isLoopbackHost(host) {
  if (!host) return false;
  const h = String(host).replace(/^\[|\]$/g, "").toLowerCase();
  if (LOOPBACK_NAMES.has(h) || h === "localhost.") return true;
  if (net.isIPv4(h)) return h.startsWith("127.");
  if (net.isIPv6(h)) return h === "::1" || /^::ffff:127\./.test(h);
  return false;
}

module.exports = { isLoopbackHost };
