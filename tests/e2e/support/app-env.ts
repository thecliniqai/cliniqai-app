/**
 * The e2e app server's environment (V2-02 plan 02-03a, ruling RL-16).
 *
 * `buildAppServerEnv()` returns a NEW object: it never spreads `process.env`. Only a handful of OS variables are
 * copied; everything the app reads is set explicitly to a local-stack or offline value, and the result must pass
 * `assertLocalAppServerEnv` (the test-lane rules with `NODE_ENV=production` allowed). `__NEXT_PROCESSED_ENV=true`
 * stops `@next/env` from filling anything from a developer's `.env*` files (pinned by
 * tests/setup/next-env-flag.spec.ts), and `NODE_OPTIONS` preloads the server-side socket guard. The local stack's
 * keys come from `npx supabase status` (never from the shell or a file).
 *
 * Plain Node + relative imports only: used by the Playwright config, `build.ts`/`serve.ts` (via tsx) and Vitest.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import {
  E2E_APP_ENV,
  LOCAL_ERROR_INGEST_KEY,
  assertLocalAppServerEnv,
  loadLocalStackKeys,
  type EnvMap,
} from "../../setup/test-env";

export const ROOT = path.resolve(__dirname, "../../..");

/** Never 3000, where a developer's `next dev` (which reads `.env`) may be running. */
export const E2E_HOST = "127.0.0.1";
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://${E2E_HOST}:${E2E_PORT}`;
export const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
/** The e2e server's cron bearer (synthetic); `POST /api/diag/error` authenticates with it (03-09b). */
export const E2E_CRON_SECRET = "e2e-not-real";

export const SERVER_NET_GUARD = path.join(ROOT, "tests/e2e/support/server-net-guard.cjs");
/** Written by `npm run e2e:build` after a guarded build passed the output scan; `serve.ts` refuses without it. */
export const BUILD_STAMP_FILE = path.join(ROOT, ".next/e2e-build-stamp.json");
export const BUILD_ID_FILE = path.join(ROOT, ".next/BUILD_ID");

/** OS variables the server needs to run at all. Nothing else is inherited. */
const INHERITED = ["PATH", "HOME", "TMPDIR", "LANG", "CI"] as const;

export interface LocalStackKeys {
  anonKey: string;
  serviceRoleKey: string;
}

/** The running local stack's keys, read from `npx supabase status -o env` into a private map. */
export function readLocalStackKeys(
  root: string = ROOT,
  readStatus?: (cwd: string) => string,
): LocalStackKeys {
  const keys: EnvMap = {};
  loadLocalStackKeys(root, keys, readStatus);
  return { anonKey: keys.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, serviceRoleKey: keys.SUPABASE_SECRET_KEY! };
}

export interface AppServerEnvOptions {
  /** Where the OS variables are copied from (default `process.env`). */
  source?: EnvMap;
  /** Local-stack keys (default: read from the running stack). */
  keys?: LocalStackKeys;
}

/** The complete, explicit environment for `next build` and `next start` in the e2e lane. Throws if unsafe. */
export function buildAppServerEnv(options: AppServerEnvOptions = {}): EnvMap {
  const source = options.source ?? process.env;
  const keys = options.keys ?? readLocalStackKeys();
  const env: EnvMap = {};
  for (const key of INHERITED) {
    const value = source[key];
    if (value) env[key] = value;
  }
  Object.assign(env, {
    NODE_ENV: "production",
    // V2-03 03-01 (R-11, K-6): a production build with offline providers and loopback URLs is the `e2e` tier.
    APP_ENV: E2E_APP_ENV,
    __NEXT_PROCESSED_ENV: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_URL,
    SUPABASE_URL: LOCAL_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: keys.anonKey,
    SUPABASE_SECRET_KEY: keys.serviceRoleKey,
    NEXT_PUBLIC_APP_URL: E2E_BASE_URL,
    MESSAGING_PROVIDER: "dev",
    MSG91_AUTH_KEY: "x",
    AI_ENABLED: "false",
    AI_PROVIDER: "mock",
    API_V1_ENABLED: "false",
    CRON_SECRET: E2E_CRON_SECRET,
    // V2-03 03-09b (R-18): the sink is on (synthetic key, its hash installed by global setup) and so is the
    // diagnostic error route that proves it end to end (tests/e2e/observability/error-sink.spec.ts).
    ERROR_INGEST_KEY: LOCAL_ERROR_INGEST_KEY,
    DIAG_ERROR_ROUTE_ENABLED: "true",
    NODE_OPTIONS: `--require "${SERVER_NET_GUARD}"`,
  } satisfies EnvMap);
  assertLocalAppServerEnv(env);
  return env;
}

/** Hash of every `NEXT_PUBLIC_*` value: those are inlined into the client bundle at build time. */
export function publicEnvHash(env: EnvMap): string {
  const entries = Object.entries(env)
    .filter(([key]) => key.startsWith("NEXT_PUBLIC_"))
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export interface BuildStamp {
  buildId: string;
  publicEnvHash: string;
  builtAt: string;
}

/** Why a stamp does not authorise serving the current `.next/` (empty = it does). */
export function stampProblems(stamp: BuildStamp | null, buildId: string | null, env: EnvMap): string[] {
  if (!stamp) return ["no e2e build stamp: run `npm run e2e:build` (the e2e lane serves only output it built)"];
  if (!buildId) return [".next/BUILD_ID is missing: run `npm run e2e:build`"];
  const problems: string[] = [];
  if (stamp.buildId !== buildId) {
    problems.push(".next/ was rebuilt after the e2e build (BUILD_ID differs from the stamp): run `npm run e2e:build`");
  }
  if (stamp.publicEnvHash !== publicEnvHash(env)) {
    problems.push("the public env differs from the one the e2e build inlined: run `npm run e2e:build`");
  }
  return problems;
}
