/**
 * Auth fault injection for the e2e app server (V2-06 06-09d, H-AUTHOUT-R1). Preloaded after the network guard through
 * `NODE_OPTIONS=--require` (tests/e2e/support/app-env.ts), in the e2e lane only; nothing in the app reads it.
 *
 * A spec that needs the SERVER's token refresh to fail for ONE device (a rate-limited `/token`, which no browser-side
 * `page.route` can reach: the proxy and route handlers refresh server-side) writes a rule file named after the
 * SHA-256 of that device's refresh token: `playwright/.auth/auth-faults/<sha256>.json` = `{ "status": 429, "body": {…},
 * "goTrue": true }`. While the file exists, every `POST /auth/v1/token?grant_type=refresh_token` carrying that token is
 * answered with the rule (with GoTrue's `X-Supabase-Api-Version` header when `goTrue` is set) and never reaches the
 * local stack; every other request, including every other device's refresh, is untouched. Each answer is written to
 * stderr as `[e2e-auth-faults] refresh answered <status>`, so a spec can prove the fault fired. Deleting the file ends
 * the fault. Tokens are only hashed, never written or logged. Synthetic sessions only.
 */
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS preload module (NODE_OPTIONS=--require) */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isLoopbackHost } = require("../../setup/loopback.cjs");

const FAULT_DIR = path.resolve(__dirname, "../../../playwright/.auth/auth-faults");

function refreshTokenOf(input, init) {
  let url;
  try {
    url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  } catch {
    return null;
  }
  // Loopback (the local stack) only: anything else is left to the network guard, which refuses it.
  if (!isLoopbackHost(url.hostname)) return null;
  if (!url.pathname.endsWith("/auth/v1/token") || url.searchParams.get("grant_type") !== "refresh_token") return null;
  if (!init || typeof init.body !== "string") return null;
  try {
    const body = JSON.parse(init.body);
    return typeof body.refresh_token === "string" ? body.refresh_token : null;
  } catch {
    return null;
  }
}

function ruleFor(token) {
  const file = path.join(FAULT_DIR, `${crypto.createHash("sha256").update(token).digest("hex")}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const innerFetch = globalThis.fetch;
if (innerFetch && !innerFetch.__authFaults) {
  const faultFetch = function faultFetch(input, init) {
    const token = refreshTokenOf(input, init);
    const rule = token ? ruleFor(token) : null;
    if (rule && Number.isInteger(rule.status)) {
      process.stderr.write(`[e2e-auth-faults] refresh answered ${rule.status}\n`);
      const headers = { "content-type": "application/json" };
      if (rule.goTrue) headers["x-supabase-api-version"] = "2024-01-01";
      return Promise.resolve(new Response(JSON.stringify(rule.body ?? {}), { status: rule.status, headers }));
    }
    return innerFetch(input, init);
  };
  faultFetch.__authFaults = true;
  if (innerFetch.__localOnly) faultFetch.__localOnly = true;
  globalThis.fetch = faultFetch;
}
