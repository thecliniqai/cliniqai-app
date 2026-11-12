#!/usr/bin/env node
/**
 * Hosted auth-config drift check (V2-03 03-11a, AUTH-02, AUTH_REDESIGN §7 "Config drift"; ruling A00-4/A00-5).
 *
 * READ-ONLY. `GET https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF_STAGING}/config/auth` with the
 * fine-grained token `SUPABASE_ACCESS_TOKEN_STAGING_RO` (permission `auth_config_read`, PO action E11), then compares
 * every mapped field with the `staging` column of `supabase/auth-policy.json`.
 *   - An expected field missing from the response fails (pin the mapping from the first real response, assumption A4).
 *   - Secret-bearing fields (CAPTCHA secret, SMTP password, hook secrets, provider keys) are never mapped, compared
 *     or printed; the report contains only the mapped fields (threat T-03-10). Template bodies are reported as a hash
 *     and a length.
 *   - `{{STAGING_ORIGIN}}` in policy values is resolved from `STAGING_ORIGIN` (https origin, PO action E0).
 * Refuses to run without the token. Agents never have it: it runs only in the `staging-readonly` GitHub Environment
 * (`drift.yml`, wired by 03-08).
 *
 * Usage: node scripts/drift/auth-config-hosted.mjs [--env staging] [--out <report.json>] [--policy <file>]
 * Exit codes: 0 no drift, 1 drift or a missing field, 2 refused / usage / API error (nothing compared).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PolicyError, SECRET_FIELD, compareHosted, readPolicy, resolvePlaceholders } from "../ci/auth-policy-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const API_BASE = "https://api.supabase.com";
const TIMEOUT_MS = 20_000;

/** Per hosted environment: where its token, project ref and origin come from. Only staging is wired in V2-03. */
export const HOSTED_TARGETS = {
  staging: {
    tokenVar: "SUPABASE_ACCESS_TOKEN_STAGING_RO",
    refVar: "SUPABASE_PROJECT_REF_STAGING",
    originVar: "STAGING_ORIGIN",
  },
};

const PROJECT_REF = /^[a-z0-9]{20}$/;

function originProblem(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return "must be https";
    if (u.origin !== value) return "must be a bare origin (scheme and host, no path or trailing slash)";
    return null;
  } catch {
    return "is not a URL";
  }
}

/**
 * Runs the check. `vars` is the environment, `fetchImpl` the HTTP client (injected by the tests; never a real
 * request from the test lane). Returns `{ exitCode, lines, report }`; `report` is null when nothing was compared.
 *
 * @param {{ env?: string, vars?: Record<string, string | undefined>, fetchImpl?: typeof fetch, policyPath?: string,
 *   root?: string, now?: () => Date }} [options]
 */
export async function checkHostedAuthConfig({
  env = "staging",
  vars = process.env,
  fetchImpl = globalThis.fetch,
  policyPath = path.join(REPO_ROOT, "supabase/auth-policy.json"),
  root = REPO_ROOT,
  now = () => new Date(),
} = {}) {
  const lines = [];
  const refuse = (msg) => ({ exitCode: 2, lines: [...lines, `auth-config-hosted: REFUSED ${msg}`], report: null });

  const target = HOSTED_TARGETS[env];
  if (!target) return refuse(`unknown environment ${JSON.stringify(env)} (wired: ${Object.keys(HOSTED_TARGETS).join(", ")})`);
  const token = vars[target.tokenVar];
  if (typeof token !== "string" || token.trim() === "") {
    return refuse(`${target.tokenVar} is not set. This check runs only in the read-only GitHub Environment (PO action E11).`);
  }
  const ref = vars[target.refVar];
  if (typeof ref !== "string" || !PROJECT_REF.test(ref)) return refuse(`${target.refVar} must be a 20-character project ref`);
  const origin = vars[target.originVar];
  const badOrigin = typeof origin === "string" ? originProblem(origin) : "is not set";
  if (badOrigin) return refuse(`${target.originVar} ${badOrigin}`);

  let policy;
  try {
    policy = readPolicy(policyPath);
  } catch (e) {
    return refuse(e instanceof Error ? e.message : String(e));
  }

  const endpoint = `/v1/projects/${ref}/config/auth`;
  let body;
  try {
    const res = await fetchImpl(`${API_BASE}${endpoint}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Status only: an error body may echo request details.
    if (!res.ok) return refuse(`GET ${endpoint} returned HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    return refuse(`GET ${endpoint} failed (${e instanceof Error ? e.name : "error"})`);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(`GET ${endpoint} did not return a JSON object`);

  const placeholderVars = { [target.originVar]: origin };
  const missing = [];
  const mismatches = [];
  const matched = [];
  for (const row of policy.settings) {
    if (row.hosted === null) continue;
    if (SECRET_FIELD.test(row.hosted)) continue; // validatePolicy already rejects these; never read one
    const { value: expected, missing: unresolved } = resolvePlaceholders(row[env], placeholderVars);
    if (unresolved.length) return refuse(`policy row ${row.id} needs ${unresolved.join(", ")}`);
    if (!Object.prototype.hasOwnProperty.call(body, row.hosted)) {
      missing.push({ field: row.hosted, id: row.id, expected });
      continue;
    }
    const cmp = compareHosted(row, expected, body[row.hosted], root);
    if (cmp.ok) matched.push(row.hosted);
    else mismatches.push({ field: row.hosted, id: row.id, toml: row.toml, expected: cmp.expected, actual: cmp.actual });
  }

  for (const m of missing) {
    lines.push(`auth-config-hosted: MISSING ${m.field} (${m.id}): not in the API response; pin the mapping (A4)`);
  }
  for (const m of mismatches) {
    lines.push(`auth-config-hosted: DRIFT ${m.field} (${m.id}): hosted ${JSON.stringify(m.actual)}, policy (${env}) wants ${JSON.stringify(m.expected)}`);
  }
  const ok = missing.length === 0 && mismatches.length === 0;
  lines.push(
    ok
      ? `auth-config-hosted: PASS (${matched.length} fields match the ${env} policy column)`
      : `auth-config-hosted: FAIL (${mismatches.length} drifted, ${missing.length} missing, ${matched.length} match)`,
  );
  const report = {
    environment: env,
    project_ref: ref,
    endpoint,
    checked_at: now().toISOString(),
    policy: path.relative(root, policyPath),
    ok,
    compared: matched.length + mismatches.length,
    matched,
    mismatches,
    missing,
  };
  return { exitCode: ok ? 0 : 1, lines, report };
}

function parseArgs(argv) {
  const opts = { env: "staging", out: null, policyPath: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new PolicyError(`${a} needs a value`);
      return v;
    };
    if (a === "--env") opts.env = next();
    else if (a === "--out") opts.out = path.resolve(next());
    else if (a === "--policy") opts.policyPath = path.resolve(next());
    else throw new PolicyError(`unknown argument ${a}`);
  }
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`auth-config-hosted: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const { exitCode, lines, report } = await checkHostedAuthConfig({ env: opts.env, policyPath: opts.policyPath });
  for (const l of lines) (exitCode === 0 ? console.log : console.error)(l);
  if (report) {
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (opts.out) {
      fs.mkdirSync(path.dirname(opts.out), { recursive: true });
      fs.writeFileSync(opts.out, json);
      console.log(`auth-config-hosted: report written to ${path.relative(process.cwd(), opts.out)}`);
    } else {
      process.stdout.write(json);
    }
  }
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
