/**
 * Resolver and UDP block shared by every test-lane network guard (V2-02 02-06, AR-L5): the Vitest worker guard
 * (tests/setup/worker-guard.ts) and the e2e app-server guard (tests/e2e/support/server-net-guard.cjs).
 *
 * The guards already answer `dns.lookup` offline and refuse non-loopback TCP/TLS sockets. Two paths stayed open:
 *   - the c-ares resolver (`dns.resolve*`, `dns.reverse`, `dns.Resolver`, and the `dns.promises` equivalents) sends a
 *     UDP query for the name to the system resolver, so a hostname could still leave the machine;
 *   - `dgram` sockets can send UDP anywhere.
 * Every resolver method now refuses a non-loopback name (callback error / rejected promise) without querying, and a
 * dgram `send`/`connect` to a non-loopback address fails with the same error. Loopback stays allowed.
 *
 * CommonJS so the server guard can load it through `NODE_OPTIONS=--require`; Vitest loads it with Node's `require`.
 */
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS module shared with the NODE_OPTIONS=--require server guard */

const dns = require("node:dns");
const dgram = require("node:dgram");
const { syncBuiltinESMExports } = require("node:module");
const { isLoopbackHost } = require("./loopback.cjs");

const RESOLVER_METHODS = [
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTlsa",
  "resolveTxt",
  "reverse",
];

function blockedError(label, host) {
  const err = new Error(`${label} blocked a DNS/UDP request to non-local host "${host}" (V2-02: tests never leave 127.0.0.1)`);
  err.name = "NonLocalNetworkError";
  err.code = "ECONNREFUSED";
  return err;
}

/** Wraps a callback-style resolver method: non-loopback → callback(error) on the next tick, no query sent. */
function guardCallback(target, name, label, onBlock) {
  const real = target[name];
  if (typeof real !== "function" || real.__localOnly) return;
  const guarded = function guardedResolve(host, ...rest) {
    if (isLoopbackHost(host)) return real.call(this, host, ...rest);
    onBlock(String(host));
    const cb = rest.reverse().find((a) => typeof a === "function");
    const err = blockedError(label, host);
    if (cb) process.nextTick(() => cb(err));
    else throw err;
    return undefined;
  };
  guarded.__localOnly = true;
  target[name] = guarded;
}

/** Wraps a promise-style resolver method: non-loopback → rejected promise, no query sent. */
function guardPromise(target, name, label, onBlock) {
  const real = target[name];
  if (typeof real !== "function" || real.__localOnly) return;
  const guarded = function guardedResolve(host, ...rest) {
    if (isLoopbackHost(host)) return real.call(this, host, ...rest);
    onBlock(String(host));
    return Promise.reject(blockedError(label, host));
  };
  guarded.__localOnly = true;
  target[name] = guarded;
}

/** The address a dgram send/connect targets (first string argument after the message; loopback when omitted). */
function dgramAddress(args, fromIndex) {
  const s = args.slice(fromIndex).find((a) => typeof a === "string");
  return s === undefined ? "localhost" : s;
}

function installDnsUdpGuard(label, onBlock = () => {}) {
  for (const name of RESOLVER_METHODS) {
    guardCallback(dns, name, label, onBlock);
    guardCallback(dns.Resolver.prototype, name, label, onBlock);
    guardPromise(dns.promises, name, label, onBlock);
    guardPromise(dns.promises.Resolver.prototype, name, label, onBlock);
  }

  const proto = dgram.Socket.prototype;
  if (!proto.send.__localOnly) {
    const realSend = proto.send;
    const send = function guardedSend(msg, ...rest) {
      // A connected socket sends to its connected peer, which `connect` below already checked.
      const connected = (() => {
        try {
          return Boolean(this.remoteAddress());
        } catch {
          return false;
        }
      })();
      const host = connected ? null : dgramAddress(rest, 0);
      if (host === null || isLoopbackHost(host)) return realSend.call(this, msg, ...rest);
      onBlock(host);
      const err = blockedError(label, host);
      const cb = rest.reverse().find((a) => typeof a === "function");
      if (cb) process.nextTick(() => cb(err));
      else process.nextTick(() => this.emit("error", err));
      return undefined;
    };
    send.__localOnly = true;
    proto.send = send;
  }
  if (!proto.connect.__localOnly) {
    const realConnect = proto.connect;
    const connect = function guardedConnect(port, ...rest) {
      const host = dgramAddress(rest, 0);
      if (isLoopbackHost(host)) return realConnect.call(this, port, ...rest);
      onBlock(host);
      const err = blockedError(label, host);
      process.nextTick(() => this.emit("error", err));
      return undefined;
    };
    connect.__localOnly = true;
    proto.connect = connect;
  }
  syncBuiltinESMExports();
}

module.exports = { installDnsUdpGuard };
