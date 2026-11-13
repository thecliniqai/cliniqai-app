/**
 * Test environment loader and guard (V2-01a, P0-10 / TEST_STRATEGY T-01).
 *
 * - The test lane NEVER reads `.env`. It reads `.env.test` (committed, local-stack values only) and fills only
 *   variables that are not already set, so a value exported in the shell still wins — and is then checked.
 * - `assertLocalTestEnv` refuses to run unless every Supabase URL points at the local stack, every external
 *   provider is pinned to its offline mode, and no real-credential variable is present. It is called when the
 *   Vitest config loads (before any test file is imported), again in globalSetup, and again in every worker.
 *
 * Plain Node only (no Vite/Vitest imports) so `vitest.config.ts` can import it.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const TEST_ENV_FILE = ".env.test";

/** Hosts the test lane may talk to. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Variables that must hold exactly these values (offline providers). */
const PINNED: Record<string, string[]> = {
  MESSAGING_PROVIDER: ["dev"],
  AI_PROVIDER: ["mock"],
};

/**
 * V2-03 03-01 (R-11): the env-schema tier of each lane. Vitest (and the seed/Playwright runner processes that share
 * this loader) run as `test`; the e2e app server as `e2e`. `loadTestEnv` fills `APP_ENV=test` when unset.
 */
export const TEST_APP_ENV = "test";
export const E2E_APP_ENV = "e2e";

/**
 * V2-03 03-09b: the synthetic error-sink ingest key of every local lane. Global setup (Vitest and Playwright) installs
 * its SHA-256 as the local vault secret `ops_error_ingest_key_sha256`; the e2e app server and the sink specs use it.
 * A test lane may carry no other value (a real staging/production key would mean hosted config leaked in).
 */
export const LOCAL_ERROR_INGEST_KEY = "not-real-ingest-key-".repeat(2);

/**
 * V2-03 03-11b: the synthetic Send Email hook secret of every local lane (`v1,whsec_<base64>` of a 32-byte placeholder,
 * assembled at runtime). Specs sign synthetic hook payloads with it; the e2e app server verifies with it. A test lane
 * may carry no other value; the env schema refuses it in staging and production.
 */
export const LOCAL_SEND_EMAIL_HOOK_SECRET = `v1,whsec_${Buffer.from("not-real-send-email-hook-secret!").toString("base64")}`;
/**
 * V2-04 04-02 (RL-23, R-18): the synthetic `/api/jobs/run` bearer of every local lane (64 printable characters, built
 * at run time). The e2e app server runs with it; Vitest leaves the name unset (the route then refuses every call) and
 * specs stub random secrets after this guard ran. A test lane may carry no other value (a real one would mean hosted
 * config leaked in); the rotation slot JOBS_RUNNER_SECRET_NEXT is never set from the shell.
 */
export const LOCAL_JOBS_RUNNER_SECRET = ["not", "real", "jobs", "runner", "secret", "0123"].join("-").repeat(2);
/** V2-03 03-11b: the local stack's Mailpit API (the CLI default port). */
export const LOCAL_MAILPIT_API_URL = "http://127.0.0.1:54324";

/**
 * V2-03 03-12a (FT-05): the e2e app server's breached-password check points at the loopback fake range API that
 * Playwright's global setup starts (tests/e2e/support/pwned-range-server.ts). Fixed port, next to the e2e server.
 */
export const E2E_PWNED_RANGE_PORT = 3101;
export const E2E_PWNED_API_BASE_URL = `http://127.0.0.1:${E2E_PWNED_RANGE_PORT}`;

/**
 * V2-03 03-12c (C43, R-22): Cloudflare's documented Turnstile test site keys (the same list as
 * `TURNSTILE_TEST_SITE_KEYS` in lib/env.ts; tests/setup/test-env-guard.spec.ts keeps them equal). A test lane may set
 * only these; the e2e app server builds with the always-pass key and the browser gets the script from a local stub
 * (tests/e2e/support/turnstile-stub.js). Local GoTrue keeps CAPTCHA off (supabase/config.toml).
 */
export const TURNSTILE_TEST_SITE_KEYS = [
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
] as const;
/** The e2e build's site key: visible widget, always passes. */
export const E2E_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
/** Cloudflare's visible always-blocks test key (the stub fails the widget and issues no token, as Cloudflare does). */
export const TURNSTILE_ALWAYS_FAIL_SITE_KEY = "2x00000000000000000000AB";

/** Variables that may be unset or must hold one of these values. */
const PINNED_IF_SET: Record<string, string[]> = {
  STORAGE_PROVIDER: ["supabase"],
  AI_EVAL_LIVE: ["false", "0"],
  NODE_ENV: ["test"],
  ENABLE_DEV_AUTH_LOGS: ["false", "0"],
  // V2-02 (02-03a): the AI kill switch stays off in every test lane, Vitest and the e2e app server alike. Specs that
  // exercise the switch stub it per test (`vi.stubEnv`), after this guard has run.
  AI_ENABLED: ["false", "0"],
  // V2-03 03-11b: auth email never goes to SES from a test lane; specs stub `ses` only with an injected client.
  // V2-04 04-00b: nor to Resend; specs stub `resend` after this guard ran, with a synthetic key built at run time and
  // a transport that reaches only a loopback fake (tests/auth/resend-sender.spec.ts, send-email-hook-resend.spec.ts).
  EMAIL_PROVIDER: ["disabled", "mailpit"],
  // V2-03 03-12c: no real Turnstile widget from a test lane (a real key would load Cloudflare's challenge).
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: [...TURNSTILE_TEST_SITE_KEYS],
};

/**
 * Credentials that code under test reads directly (e.g. a provider constructed by name, bypassing the pinned
 * provider). They may be unset or hold an obvious placeholder, never a real value.
 */
const PLACEHOLDER_ONLY = ["MSG91_AUTH_KEY", "AI_API_KEY"];
const PLACEHOLDER_PATTERN = /^x$|-not-real$/;

/** Proxy settings could route even loopback-looking traffic elsewhere; the lane runs without them. */
const PROXY_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NODE_USE_ENV_PROXY"];

/**
 * Real-credential or hosted-only variables that must not be present at all in a test run. Their presence means
 * the shell (or a stray file) carries production/hosted config into the test lane.
 */
export const FORBIDDEN_VARS = [
  // V2-03 03-01 (R-K, R-32): retired names. The lane uses NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY.
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MESSAGING_WEBHOOK_SECRET",
  "SUPABASE_ACCESS_TOKEN",
  // V2-03 03-11a (AUTH-02): the read-only Management API token for the hosted auth-config drift check lives only in
  // the `staging-readonly` GitHub Environment; scripts/drift/auth-config-hosted.mjs refuses to run without it.
  "SUPABASE_ACCESS_TOKEN_STAGING_RO",
  "SUPABASE_DB_PASSWORD",
  "DATABASE_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "AI_BASE_URL",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GUPSHUP_API_KEY",
  "GUPSHUP_APP_NAME",
  "GUPSHUP_SRC_PHONE",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_PHONE",
  "TWILIO_WHATSAPP_FROM",
  "MSG91_DLT_TE_ID",
  "MSG91_SENDER_ID",
  // V2-03 03-11b (R-31): no AWS or SES credential in a test lane; the SES sender is tested with an injected client.
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "SES_ACCESS_KEY_ID",
  "SES_SECRET_ACCESS_KEY",
  // V2-04 04-00b: no Resend key in a test lane (specs build a synthetic one at run time, after the guard), and never a
  // public name for it.
  "RESEND_API_KEY",
  "NEXT_PUBLIC_RESEND_API_KEY",
] as const;

/** Variables whose value is a URL that must be loopback. */
const URL_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "PLAYWRIGHT_TEST_BASE_URL",
  "MAILPIT_API_URL",
  // 03-12a: the range API of the breached-password check is a loopback fake in every test lane.
  "PWNED_API_BASE_URL",
];

/**
 * V2-04 04-00 (review A L-8, R-47): every name of the staging lane (`STAGING_DB_URL`, `STAGING_DB_URL_RO`,
 * `STAGING_SECRET_KEY`, `STAGING_SEED_PASSWORD`, `STAGING_PUBLISHABLE_KEY` and any later one) is refused by prefix: a
 * staging credential never belongs in a test lane, whatever its value looks like.
 */
export const FORBIDDEN_VAR_PREFIXES = ["STAGING_"] as const;

/**
 * Fragments that identify hosted services anywhere in any variable's value. 04-00 (L-8): the opaque hosted key
 * prefixes too: the lane loads the local stack's `supabase-demo` JWT keys, never an `sb_…` key (specs that need a
 * deploy-tier profile build prefixed keys at run time, after this guard has run).
 */
export const HOSTED_MARKERS = [
  ".supabase.co",
  ".supabase.in",
  ".supabase.net",
  "r2.cloudflarestorage.com",
  "pooler.supabase",
  // V2-04 04-00b: the Resend API is a constant in lib/email/resend.ts; no test-lane value may name it.
  "api.resend.com",
  ["sb", "secret", ""].join("_"),
  ["sb", "publishable", ""].join("_"),
];

/**
 * The environment the guard reads and fills: `process.env` or a plain map in the guard's own tests. Wider than
 * `NodeJS.ProcessEnv`, whose Next.js augmentation makes `NODE_ENV` required.
 */
export type EnvMap = Record<string, string | undefined>;

export class TestEnvGuardError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      "Refusing to run tests: the environment is not the local test stack.\n" +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\nThe test lane runs only against `npx supabase start` with `.env.test` (see docs/v2/TEST_STRATEGY.md §6.2).",
    );
    this.name = "TestEnvGuardError";
  }
}

/** Parse a dotenv-style file into key/value pairs (no interpolation, no multiline). */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().replace(/^export\s+/, "");
    const value = line.slice(idx + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    out[key] = value;
  }
  return out;
}

/**
 * Fill unset variables from `.env.test`. Never touches `.env`. Returns the parsed file so callers can compare.
 * Throws if `.env.test` is missing: the lane must not silently fall back to anything else.
 */
export function loadTestEnv(rootDir: string, env: EnvMap = process.env): Record<string, string> {
  const file = path.join(rootDir, TEST_ENV_FILE);
  if (!fs.existsSync(file)) {
    throw new TestEnvGuardError([`${TEST_ENV_FILE} not found at ${file}`]);
  }
  const parsed = parseEnvFile(fs.readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined || env[key] === "") env[key] = value;
  }
  if (env.APP_ENV === undefined || env.APP_ENV === "") env.APP_ENV = TEST_APP_ENV;
  return parsed;
}

/** JWT issuer of the public keys that `npx supabase start` uses for every local stack. */
export const LOCAL_KEY_ISSUER = "supabase-demo";

/** Decode a JWT payload without verifying it (only to read `iss` / `role`). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Read the local stack's anon and service-role keys from `npx supabase status -o env` and fill them, under the R-K
 * names `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` (legacy JWT values), if unset.
 * Keys are never written to disk or printed. Throws a guard error if the local stack is not running.
 */
export function loadLocalStackKeys(
  rootDir: string,
  env: EnvMap = process.env,
  readStatus: (cwd: string) => string = defaultReadStatus,
): void {
  if (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && env.SUPABASE_SECRET_KEY) return;
  let status: string;
  try {
    status = readStatus(rootDir);
  } catch {
    throw new TestEnvGuardError([
      "the local Supabase stack is not running (or the CLI is missing): run `npx supabase start` first",
    ]);
  }
  const parsed = parseEnvFile(status);
  const anon = parsed.ANON_KEY;
  const service = parsed.SERVICE_ROLE_KEY;
  if (!anon || !service) {
    throw new TestEnvGuardError(["`npx supabase status -o env` did not report ANON_KEY and SERVICE_ROLE_KEY"]);
  }
  if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = anon;
  if (!env.SUPABASE_SECRET_KEY) env.SUPABASE_SECRET_KEY = service;
}

function defaultReadStatus(cwd: string): string {
  return execFileSync("npx", ["supabase", "status", "-o", "env"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 60_000,
  });
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

export interface TestEnvRuleOptions {
  /** Extra `NODE_ENV` values allowed on top of `test` (the e2e app server runs `next start`, i.e. `production`). */
  allowNodeEnv?: string[];
  /** The `APP_ENV` tier the lane must declare (default `test`; the e2e app server uses `e2e`). */
  appEnv?: string;
  /** 03-09b (R-18): the e2e app server turns the diagnostic error route on; the Vitest lane keeps it off. */
  diagRoute?: boolean;
  /**
   * 03-12a (FT-05): the e2e app server turns the breached-password check on (against the loopback fake); the Vitest
   * lane keeps it off and specs stub it per test (`vi.stubEnv`) after this guard has run.
   */
  pwnedCheck?: boolean;
  /** 04-02 (R-32): the e2e app server runs the drill job kinds; the Vitest lane keeps them off (specs stub them). */
  drillJobs?: boolean;
}

/** Collect every reason the environment is not the local test stack. Empty array = safe. */
export function findTestEnvProblems(env: EnvMap, options: TestEnvRuleOptions = {}): string[] {
  const problems: string[] = [];
  const pinnedIfSet: Record<string, string[]> = {
    ...PINNED_IF_SET,
    NODE_ENV: [...PINNED_IF_SET.NODE_ENV, ...(options.allowNodeEnv ?? [])],
  };
  const pinned: Record<string, string[]> = { ...PINNED, APP_ENV: [options.appEnv ?? TEST_APP_ENV] };

  if (!env.NEXT_PUBLIC_SUPABASE_URL) problems.push("NEXT_PUBLIC_SUPABASE_URL is not set");

  for (const key of URL_VARS) {
    const value = env[key];
    if (!value) continue;
    const host = hostOf(value);
    if (host === null) problems.push(`${key} is not a valid URL`);
    else if (!LOOPBACK_HOSTS.has(host)) problems.push(`${key} points at non-local host "${host}"`);
  }

  for (const [key, allowed] of Object.entries(pinned)) {
    if (!allowed.includes(env[key] ?? "")) {
      problems.push(`${key} must be ${allowed.join(" or ")} (got ${env[key] ? `"${env[key]}"` : "unset"})`);
    }
  }
  for (const [key, allowed] of Object.entries(pinnedIfSet)) {
    const value = env[key];
    if (value !== undefined && value !== "" && !allowed.includes(value)) {
      problems.push(`${key} must be unset or ${allowed.join(" or ")} (got "${value}")`);
    }
  }

  // 03-09b: unset or the local synthetic key only; the value is never echoed (it would be a secret if it were real).
  if (env.ERROR_INGEST_KEY && env.ERROR_INGEST_KEY !== LOCAL_ERROR_INGEST_KEY) {
    problems.push("ERROR_INGEST_KEY must be unset or the local synthetic key (LOCAL_ERROR_INGEST_KEY) in the test lane");
  }
  // 03-11b: same rule for the Send Email hook secret.
  if (env.SEND_EMAIL_HOOK_SECRET && env.SEND_EMAIL_HOOK_SECRET !== LOCAL_SEND_EMAIL_HOOK_SECRET) {
    problems.push("SEND_EMAIL_HOOK_SECRET must be unset or the local synthetic secret (LOCAL_SEND_EMAIL_HOOK_SECRET) in the test lane");
  }
  const diagAllowed = options.diagRoute ? ["true", "false"] : ["false"];
  if (env.DIAG_ERROR_ROUTE_ENABLED && !diagAllowed.includes(env.DIAG_ERROR_ROUTE_ENABLED)) {
    problems.push(`DIAG_ERROR_ROUTE_ENABLED must be unset or ${diagAllowed.join(" or ")} in this lane`);
  }

  // 04-02: the runner bearer is unset or the local synthetic one; the rotation slot is never set from the shell.
  if (env.JOBS_RUNNER_SECRET && env.JOBS_RUNNER_SECRET !== LOCAL_JOBS_RUNNER_SECRET) {
    problems.push("JOBS_RUNNER_SECRET must be unset or the local synthetic secret (LOCAL_JOBS_RUNNER_SECRET) in the test lane");
  }
  if (env.JOBS_RUNNER_SECRET_NEXT) problems.push("JOBS_RUNNER_SECRET_NEXT must not be set in the test lane");
  const drillAllowed = options.drillJobs ? ["true", "false"] : ["false"];
  if (env.JOBS_DRILL_ENABLED && !drillAllowed.includes(env.JOBS_DRILL_ENABLED)) {
    problems.push(`JOBS_DRILL_ENABLED must be unset or ${drillAllowed.join(" or ")} in this lane`);
  }

  const pwnedAllowed = options.pwnedCheck ? ["on", "off"] : ["off"];
  if (env.PWNED_CHECK && !pwnedAllowed.includes(env.PWNED_CHECK)) {
    problems.push(`PWNED_CHECK must be unset or ${pwnedAllowed.join(" or ")} in this lane`);
  }
  if (env.PWNED_CHECK === "on" && !env.PWNED_API_BASE_URL) {
    problems.push("PWNED_CHECK=on needs PWNED_API_BASE_URL (the loopback fake range API) in this lane");
  }

  for (const key of PLACEHOLDER_ONLY) {
    const value = env[key];
    if (value && !PLACEHOLDER_PATTERN.test(value)) {
      problems.push(`${key} must be unset, "x" or end in "-not-real" in the test lane`);
    }
  }

  for (const key of PROXY_VARS) {
    if (env[key]) problems.push(`${key} must not be set in the test lane (unset proxies before running tests)`);
  }

  for (const key of FORBIDDEN_VARS) {
    if (env[key] !== undefined && env[key] !== "") problems.push(`${key} must not be set in the test lane`);
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== "" && FORBIDDEN_VAR_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      problems.push(`${key} must not be set in the test lane (staging names never reach a test lane)`);
    }
  }

  for (const [key, role] of [
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon"],
    ["SUPABASE_SECRET_KEY", "service_role"],
  ] as const) {
    const value = env[key];
    if (!value) {
      problems.push(`${key} is not set`);
      continue;
    }
    // Local stacks use JWT keys issued by "supabase-demo"; hosted projects issue "supabase" JWTs or
    // sb_publishable_/sb_secret_ keys. Anything else is refused.
    const payload = decodeJwtPayload(value);
    if (!payload || payload.iss !== LOCAL_KEY_ISSUER) {
      problems.push(`${key} is not a local-stack key (issuer must be "${LOCAL_KEY_ISSUER}")`);
    } else if (payload.role !== role) {
      problems.push(`${key} has the wrong role claim (must be "${role}")`);
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    const lower = value.toLowerCase();
    const marker = HOSTED_MARKERS.find((m) => lower.includes(m));
    if (marker) problems.push(`${key} references a hosted service ("${marker}")`);
  }

  return [...new Set(problems)];
}

/** Throw unless the environment is the local test stack. Never prints values of secrets. */
export function assertLocalTestEnv(env: EnvMap = process.env): void {
  const problems = findTestEnvProblems(env);
  if (problems.length) throw new TestEnvGuardError(problems);
}

/**
 * Problems with the environment of the e2e app server (V2-02 02-03a, ruling RL-16): the test-lane rules with
 * `NODE_ENV=production` allowed, plus the two Next.js switches the safe server depends on —
 * `__NEXT_PROCESSED_ENV=true` (Next loads no `.env*` file; pinned by tests/setup/next-env-flag.spec.ts) and
 * `NEXT_TELEMETRY_DISABLED=1` (no outbound telemetry).
 */
export function findAppServerEnvProblems(env: EnvMap): string[] {
  const problems = findTestEnvProblems(env, {
    allowNodeEnv: ["production"],
    appEnv: E2E_APP_ENV,
    diagRoute: true,
    pwnedCheck: true,
    drillJobs: true,
  });
  if (env.__NEXT_PROCESSED_ENV !== "true") {
    problems.push("__NEXT_PROCESSED_ENV must be \"true\" so Next loads no .env file into the e2e server");
  }
  if (env.NEXT_TELEMETRY_DISABLED !== "1") problems.push("NEXT_TELEMETRY_DISABLED must be \"1\" for the e2e server");
  return problems;
}

/** Throw unless `env` is a safe environment for the e2e app server (`next build` / `next start`). */
export function assertLocalAppServerEnv(env: EnvMap): void {
  const problems = findAppServerEnvProblems(env);
  if (problems.length) throw new TestEnvGuardError(problems);
}
