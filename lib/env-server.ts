import "server-only";
import { ENV_SOURCE_NAMES, parseEnv, type Env, type EnvSource } from "./env";

/**
 * Typed server-side environment (V2-03 03-01, P1-15). Server code reads configuration only through `serverEnv()`;
 * `process.env` reads are confined to `lib/env*.ts`, `next.config.ts` and `instrumentation.ts` (03-04 lints it).
 *
 * The result is memoised on the current values of the schema's names, so it parses once per configuration rather
 * than once per call, and a value changed at runtime (a test's `vi.stubEnv`) is seen on the next call. An invalid
 * environment throws `EnvConfigError` (keys and rules, never values); boot already refused it in a real deployment.
 */
let cached: { fingerprint: string; env: Env } | null = null;

function currentSource(): { source: EnvSource; fingerprint: string } {
  const source: EnvSource = {};
  for (const name of ENV_SOURCE_NAMES) source[name] = process.env[name];
  return { source, fingerprint: JSON.stringify(ENV_SOURCE_NAMES.map((name) => source[name] ?? null)) };
}

export function serverEnv(): Env {
  const { source, fingerprint } = currentSource();
  if (cached && cached.fingerprint === fingerprint) return cached.env;
  const env = parseEnv(source);
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
