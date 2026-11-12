#!/usr/bin/env node
/**
 * Staging target guard (V2-03 03-08, P1-35a; rulings R-9, R-21; threat T-03-09).
 *
 * Every staging script and workflow step that talks to the hosted staging project checks its target here first. A
 * target is accepted only when it is the staging project named by `SUPABASE_PROJECT_REF_STAGING` (a GitHub
 * Environment variable, PO action E10):
 *   - Supabase API URL:  `https://<ref>.supabase.co` (bare origin, no credentials, no port, no path);
 *   - database URL:      `postgres(ql)://<user>:<password>@db.<ref>.supabase.co[:port]/<db>` (direct connection), or
 *                        `postgres(ql)://<role>.<ref>:<password>@aws-<n>-<region>.pooler.supabase.com[:port]/<db>`
 *                        (Supavisor session pooler: the ref is in the user name, not the host; GitHub-hosted runners
 *                        have no IPv6, so the PO will normally use this form).
 * Everything else is refused: a loopback or private host, any IP literal, `localhost`, another project's ref, an
 * unknown scheme, a missing or malformed ref. Problems name the rule and at most the host, never a password.
 *
 * CLI (used by staging.yml / drift.yml):
 *   node scripts/staging/target-guard.mjs --var <ENV_NAME> [--mask]
 * reads the URL from the named environment variable and the ref from `SUPABASE_PROJECT_REF_STAGING`. `--mask` makes
 * a GitHub Actions runner mask the database password in every later log line of the job (`::add-mask::`), on top of
 * the masking GitHub already applies to the whole secret.
 * Exit 0 = accepted, 1 = refused, 2 = usage.
 */
import { pathToFileURL } from "node:url";

export const REF_VAR = "SUPABASE_PROJECT_REF_STAGING";
export const PROJECT_REF = /^[a-z0-9]{20}$/;
const POOLER_HOST = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;
const DB_SCHEMES = new Set(["postgres:", "postgresql:"]);
const LOCAL_NAMES = new Set(["localhost", "localhost.localdomain", "host.docker.internal", "kubernetes.docker.internal"]);

/** IPv4/IPv6 literal (the WHATWG URL parser normalises IPv4 forms such as `0x7f.1` and `2130706433`). */
function isIpLiteral(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
}

function isLocalName(hostname) {
  return (
    LOCAL_NAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".")
  );
}

/**
 * Problems with `value` as a staging target for project `ref`. Empty array = accepted.
 * @param {{ url: string | undefined, ref: string | undefined, kind?: "api" | "db" | "any" }} input
 * @returns {string[]}
 */
export function stagingTargetProblems({ url, ref, kind = "any" }) {
  const problems = [];
  if (typeof ref !== "string" || !PROJECT_REF.test(ref)) {
    problems.push(`${REF_VAR} must be a 20-character project ref ([a-z0-9])`);
  }
  if (typeof url !== "string" || url.trim() === "") {
    problems.push("the target URL is not set");
    return problems;
  }
  let u;
  try {
    u = new URL(url);
  } catch {
    problems.push("the target is not a URL");
    return problems;
  }
  const host = u.hostname.toLowerCase();
  if (isIpLiteral(host)) problems.push(`the target host is an IP address (${host}); staging is addressed by name only`);
  else if (isLocalName(host)) problems.push(`the target host "${host}" is loopback or local; staging scripts never run against a local stack`);
  if (problems.length) return problems;

  const isDb = DB_SCHEMES.has(u.protocol);
  const isApi = u.protocol === "https:";
  if (!isDb && !isApi) return [`the target scheme ${u.protocol} is neither https: (API) nor postgres(ql): (database)`];
  if (kind === "api" && !isApi) return ["an API target must be an https URL"];
  if (kind === "db" && !isDb) return ["a database target must be a postgres:// or postgresql:// URL"];

  if (isApi) {
    if (host !== `${ref}.supabase.co`) problems.push(`the API host "${host}" is not the staging project (${ref}.supabase.co)`);
    if (u.username || u.password) problems.push("an API URL must not carry credentials");
    if (u.port) problems.push("an API URL must not name a port");
    if (u.pathname !== "/" || u.search || u.hash) problems.push("an API URL must be a bare origin");
    return problems;
  }

  const user = decodeURIComponent(u.username);
  if (!u.password) problems.push("the database URL carries no password");
  if (host === `db.${ref}.supabase.co`) return problems;
  if (POOLER_HOST.test(host)) {
    if (!user.endsWith(`.${ref}`)) problems.push(`the pooler user name does not end in ".${ref}" (the staging project)`);
    return problems;
  }
  problems.push(`the database host "${host}" is neither db.${ref}.supabase.co nor a Supabase pooler host`);
  return problems;
}

/** The decoded password of a database URL, or null. */
export function urlPassword(url) {
  try {
    const u = new URL(url);
    return u.password ? decodeURIComponent(u.password) : null;
  } catch {
    return null;
  }
}

/** Replaces every occurrence of the URL and its password (raw and decoded) in `text`. */
export function redactUrl(text, url) {
  if (typeof url !== "string" || url === "") return text;
  let out = text.split(url).join("<staging-url>");
  try {
    const u = new URL(url);
    for (const secret of new Set([u.password, decodeURIComponent(u.password)])) {
      if (secret) out = out.split(secret).join("***");
    }
  } catch {
    // not a URL: the whole-string replacement above is all that applies
  }
  return out;
}

function main(argv, env) {
  const i = argv.indexOf("--var");
  const name = i > -1 ? argv[i + 1] : undefined;
  if (!name || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
    console.error("usage: node scripts/staging/target-guard.mjs --var <ENV_NAME> [--mask]");
    return 2;
  }
  const url = env[name];
  const problems = stagingTargetProblems({ url, ref: env[REF_VAR] });
  if (problems.length) {
    for (const p of problems) console.error(`target-guard: REFUSED ${name}: ${p}`);
    return 1;
  }
  if (argv.includes("--mask") && env.GITHUB_ACTIONS === "true") {
    const pw = urlPassword(url);
    if (pw) {
      console.log(`::add-mask::${pw}`);
      const raw = new URL(url).password;
      if (raw !== pw) console.log(`::add-mask::${raw}`);
    }
  }
  console.log(`target-guard: OK ${name} is the staging project ${env[REF_VAR]} (${new URL(url).hostname})`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2), process.env));
}
