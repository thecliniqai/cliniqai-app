/**
 * Server-side network guard for the e2e app server (V2-02 plan 02-03a, ruling RL-16). Preloaded into `next build`
 * and `next start` (and every worker they fork) through `NODE_OPTIONS=--require`, set by
 * tests/e2e/support/app-env.ts. Same rules as the Vitest worker guard (tests/setup/worker-guard.ts):
 *   - every TCP/TLS socket (fetch/undici, node:http/https, AWS SDK, websockets) may connect only to loopback;
 *   - `fetch` to a non-loopback host is rejected up front with a readable error;
 *   - DNS lookups of non-loopback names never reach a resolver: they return a fixed public test address, which the
 *     socket block then refuses.
 * Every block is also written to stderr (`[e2e-net-guard] blocked …`) so the run log names the host.
 */
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS preload module (NODE_OPTIONS=--require) */

const dns = require("node:dns");
const net = require("node:net");
const { syncBuiltinESMExports } = require("node:module");
const { isLoopbackHost } = require("../../setup/loopback.cjs");

/** Fixed public address (never contacted: sockets to it are refused). */
const TEST_PUBLIC_ADDRESS = "93.184.216.34";

class NonLocalNetworkError extends Error {
  constructor(host) {
    super(`e2e server blocked a network request to non-local host "${host}" (V2-02: the e2e server never leaves 127.0.0.1)`);
    this.name = "NonLocalNetworkError";
  }
}

function report(host) {
  process.stderr.write(`[e2e-net-guard] blocked non-loopback connection to "${host}"\n`);
}

// --- sockets ----------------------------------------------------------------------------------------------------
const realConnect = net.Socket.prototype.connect;
function connectTarget(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === "object") {
    return { host: first.path ? undefined : (first.host ?? "localhost"), path: first.path };
  }
  if (typeof first === "string" && Number.isNaN(Number(first))) return { path: first };
  return { host: typeof args[1] === "string" ? args[1] : "localhost" };
}
net.Socket.prototype.connect = function guardedConnect(...args) {
  const target = connectTarget(args);
  if (!target.path && !isLoopbackHost(target.host)) {
    report(target.host);
    const err = new NonLocalNetworkError(String(target.host));
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return realConnect.apply(this, args);
};

// --- DNS --------------------------------------------------------------------------------------------------------
const fakeAnswer = (all) =>
  all ? [{ address: TEST_PUBLIC_ADDRESS, family: 4 }] : { address: TEST_PUBLIC_ADDRESS, family: 4 };

const realPromiseLookup = dns.promises.lookup.bind(dns.promises);
dns.promises.lookup = async (hostname, options) => {
  if (isLoopbackHost(hostname) || net.isIP(hostname)) return realPromiseLookup(hostname, options);
  const all = typeof options === "object" && options !== null && options.all;
  return fakeAnswer(all);
};

const realLookup = dns.lookup.bind(dns);
dns.lookup = (hostname, options, callback) => {
  const cb = typeof options === "function" ? options : callback;
  const opts = typeof options === "function" ? undefined : options;
  if (isLoopbackHost(hostname) || net.isIP(hostname)) return realLookup(hostname, opts ?? {}, cb);
  const all = typeof opts === "object" && opts !== null && opts.all;
  process.nextTick(() => (all ? cb(null, fakeAnswer(true)) : cb(null, TEST_PUBLIC_ADDRESS, 4)));
};
syncBuiltinESMExports();

// --- fetch (readable error before any socket work) ----------------------------------------------------------------
function requestHost(input) {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const realFetch = globalThis.fetch;
if (realFetch && !realFetch.__localOnly) {
  const localOnlyFetch = (input, init) => {
    const host = requestHost(input);
    if (!isLoopbackHost(host)) {
      report(host);
      return Promise.reject(new NonLocalNetworkError(String(host)));
    }
    return realFetch(input, init);
  };
  localOnlyFetch.__localOnly = true;
  globalThis.fetch = localOnlyFetch;
}
