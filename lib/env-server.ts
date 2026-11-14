import "server-only";
import { createHash } from "node:crypto";
import { ENV_SOURCE_NAMES, EnvConfigError, isDeployTier, parseEnv, type Env, type EnvSource } from "./env";

/**
 * Typed server-side environment (V2-03 03-01, P1-15). Server code reads configuration only through `serverEnv()`;
 * `process.env` reads are confined to `lib/env*.ts`, `next.config.ts` and `instrumentation.ts` (03-04 lints it).
 *
 * The result is memoised on the current values of the schema's names, so it parses once per configuration rather
 * than once per call, and a value changed at runtime (a test's `vi.stubEnv`) is seen on the next call. An invalid
 * environment throws `EnvConfigError` (keys and rules, never values); boot already refused it in a real deployment.
 */
let cached: { fingerprint: string; env: Env } | null = null;

/**
 * V2-04 04-00 (review A L-3, R-47): SHA-256 (hex) of the two fixed opaque keys the pinned Supabase CLI (2.120.0, see
 * `package.json`) prints for every local stack (`npx supabase status -o env`, its publishable and its secret key). They
 * pass the prefix rules (they carry the hosted prefixes), so the deploy tiers refuse them by digest; no key literal
 * enters the source. Computed by piping the status output straight into `shasum -a 256` (never printed). A CLI upgrade
 * that changes the defaults updates these in the same commit: `tests/config/env-boot.spec.ts` reads the live local
 * keys and fails otherwise. Server only (`node:crypto`): `lib/env.ts` is also bundled for the browser.
 */
export const LOCAL_STACK_OPAQUE_DIGESTS: readonly string[] = [
  "9705102db0d5f99ee08daa19a73e510d9877a2a9add9369da247cbbe6c2a0140",
  "c85debb55f2f204d868cc1552c42faa143b4c675f61363ab040dd50b5b5304cd",
];

const LOCAL_KEY_CHECKED_NAMES = ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"] as const;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** `KEY: rule` issues for a local-stack opaque key in a deploy tier (no value is ever included). */
export function localStackKeyIssues(env: Pick<Env, "APP_ENV" | (typeof LOCAL_KEY_CHECKED_NAMES)[number]>): string[] {
  if (!isDeployTier(env.APP_ENV)) return [];
  const issues: string[] = [];
  for (const name of LOCAL_KEY_CHECKED_NAMES) {
    const value = env[name];
    if (value && LOCAL_STACK_OPAQUE_DIGESTS.includes(sha256Hex(value.trim()))) {
      issues.push(`${name}: must not be a local-stack key in ${env.APP_ENV}`);
    }
  }
  return issues;
}

/**
 * The server parse: {@link parseEnv} plus the checks that need Node (04-00 L-3, the local-stack opaque keys). What
 * `serverEnv()` and the boot check in `instrumentation.ts` `register()` run; throws {@link EnvConfigError}.
 */
export function parseServerEnv(source: EnvSource): Env {
  const env = parseEnv(source);
  const issues = localStackKeyIssues(env);
  if (issues.length > 0) throw new EnvConfigError(issues, env.APP_ENV);
  return env;
}

/** The boot check of every server instance (`instrumentation.ts`): {@link parseServerEnv} on the given source. */
export function assertServerEnv(source: EnvSource): Env {
  return parseServerEnv(source);
}

function currentSource(): { source: EnvSource; fingerprint: string } {
  const source: EnvSource = {};
  for (const name of ENV_SOURCE_NAMES) source[name] = process.env[name];
  return { source, fingerprint: JSON.stringify(ENV_SOURCE_NAMES.map((name) => source[name] ?? null)) };
}

export function serverEnv(): Env {
  const { source, fingerprint } = currentSource();
  if (cached && cached.fingerprint === fingerprint) return cached.env;
  const env = parseServerEnv(source);
  cached = { fingerprint, env };
  return env;
}

const REGION_PATTERN = /^[a-z0-9]{2,12}$/;
const RELEASE_PATTERN = /^[0-9a-f]{7,40}$/;

/**
 * Where and what is running, for `/api/health` (R-26 release, R-30 region). Reads only the two platform names and
 * validates their shape, so the liveness probe never depends on the rest of the configuration.
 */
export function deploymentInfo(): { region: string | null; release: string | null } {
  const region = process.env.VERCEL_REGION;
  const release = process.env.VERCEL_GIT_COMMIT_SHA;
  return {
    region: region && REGION_PATTERN.test(region) ? region : null,
    release: release && RELEASE_PATTERN.test(release) ? release : null,
  };
}

const BUILD_STAMP_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * This build's stamp (V2-06 06-09a M-OFFLINE): `CLINICOS_BUILD_STAMP`, which `next.config.ts` computes once per
 * `next build` and the bundler inlines (`env`), so the running server reports the build it was compiled in. The service
 * worker route puts it in `/sw.js`, so every deploy installs a new worker. `null` outside a build (tests, `next dev`
 * before the first compile) or for an unexpected shape.
 */
export function buildStamp(): string | null {
  const stamp = process.env.CLINICOS_BUILD_STAMP;
  return stamp && BUILD_STAMP_PATTERN.test(stamp) ? stamp : null;
}
