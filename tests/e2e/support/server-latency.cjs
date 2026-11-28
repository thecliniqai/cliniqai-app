/**
 * Latency injection for the e2e app server (V2-09e 09E-01, ruling R-3). Preloaded after the network guard and the auth-fault hook
 * through `NODE_OPTIONS=--require` (tests/e2e/support/app-env.ts), in the e2e lane only; nothing in the app reads it.
 *
 * While the rule file `playwright/.auth/latency.json` = `{ "ms": N, "record": "<path>" }` exists, every `fetch` to the local Supabase
 * origin (loopback, port 54321) waits N ms before it is sent, and, once the response has arrived, appends one JSON line
 * `{ "t0", "t1", "ms", "method", "path" }` (epoch ms; `ms` the injected wait, so a call's moment at the local stack is `t0 + ms`; the path without ids or query string) to the record file. Anything else (another
 * origin, another loopback port, any call made while no rule file exists) is untouched and unrecorded. The rule file is checked with
 * a `stat` on every Supabase call and re-read only when its mtime changes, so a spec starts and ends the injection without a restart.
 * An optional `"extra": { "<METHOD> <path>": M }` (the path as recorded) adds M ms to those calls only, so a spec can make one call the slow one of a batch
 * (the recorded `ms` is then N + M).
 * Deleting the file ends it. Synthetic data only; no header, body or id is ever written.
 */
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS preload module (NODE_OPTIONS=--require) */

const fs = require("node:fs");
const path = require("node:path");
const { isLoopbackHost } = require("../../setup/loopback.cjs");

const RULE_FILE = process.env.E2E_LATENCY_RULE_FILE || path.resolve(__dirname, "../../../playwright/.auth/latency.json");
const SUPABASE_PORT = "54321";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

let cached = { mtimeMs: -1, rule: null };

/** The optional per-path additions (`{ "<METHOD> <path>": ms }`, the path as recorded): only finite, non-negative values; anything else is none. */
function extraOf(value) {
  const extra = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, ms] of Object.entries(value)) if (Number.isFinite(ms) && ms >= 0) extra[key] = ms;
  }
  return extra;
}

/** The current rule, or null (no file, an unreadable file, or a bad value). */
function currentRule() {
  let stat;
  try {
    stat = fs.statSync(RULE_FILE);
  } catch {
    cached = { mtimeMs: -1, rule: null };
    return null;
  }
  if (stat.mtimeMs !== cached.mtimeMs) {
    let rule = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(RULE_FILE, "utf8"));
      if (Number.isFinite(parsed.ms) && parsed.ms >= 0 && typeof parsed.record === "string" && parsed.record) rule = { ms: parsed.ms, record: parsed.record, extra: extraOf(parsed.extra) };
    } catch {
      rule = null;
    }
    cached = { mtimeMs: stat.mtimeMs, rule };
  }
  return cached.rule;
}

/** `{ method, path }` of a call to the local Supabase origin; null for anything else. */
function supabaseCall(input, init) {
  let url;
  try {
    url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  } catch {
    return null;
  }
  if (!isLoopbackHost(url.hostname) || url.port !== SUPABASE_PORT) return null;
  const method = String((init && init.method) || (typeof input === "object" && input && input.method) || "GET").toUpperCase();
  return { method, path: url.pathname.replace(UUID, ":id").replace(/\/\d+(?=\/|$)/g, "/:n") };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

function record(rule, line) {
  try {
    fs.appendFileSync(rule.record, `${JSON.stringify(line)}\n`);
  } catch {
    // The record directory is gone (a run ended): the call itself is never failed by the recorder.
  }
}

const innerFetch = globalThis.fetch;
if (innerFetch && !innerFetch.__latency) {
  const latencyFetch = async function latencyFetch(input, init) {
    const rule = currentRule();
    const call = rule ? supabaseCall(input, init) : null;
    if (!rule || !call) return innerFetch(input, init);
    const t0 = Date.now();
    const ms = rule.ms + (rule.extra[`${call.method} ${call.path}`] ?? 0);
    let sent = false;
    try {
      await sleep(ms, (init && init.signal) || (typeof input === "object" && input && input.signal) || undefined);
      sent = true;
      return await innerFetch(input, init);
    } finally {
      // A call aborted during its wait never reached the local stack: it is not a call (Kong never saw it), so it is not recorded.
      if (sent) record(rule, { t0, t1: Date.now(), ms, method: call.method, path: call.path });
    }
  };
  latencyFetch.__latency = true;
  if (innerFetch.__localOnly) latencyFetch.__localOnly = true;
  if (innerFetch.__authFaults) latencyFetch.__authFaults = true;
  globalThis.fetch = latencyFetch;
}
