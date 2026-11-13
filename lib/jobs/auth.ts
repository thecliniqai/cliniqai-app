/**
 * Job runner authentication (V2-04 04-02; RL-23, R-18, R-49; threats T-04-01, T-04-02). `POST /api/jobs/run` accepts
 * only `Authorization: Bearer v1.<unix_ts>.<hex hmac_sha256(key = secret, data = "jobs-run|v1|" + unix_ts)>`, the
 * token `ops.kick_job_runner()` builds in SQL (migration 000034) from the Vault copy of `JOBS_RUNNER_SECRET`. The secret
 * itself is never sent: pg_net's queue is readable by every database login role (R-49).
 *
 * - The token is accepted only when `|now − ts| ≤ 120 s` (stale and future tokens are refused) and its HMAC matches the
 *   current secret or, during a rotation, `JOBS_RUNNER_SECRET_NEXT`.
 * - Constant time: the HMAC is compared as two 32-byte buffers with `timingSafeEqual`, against every configured secret
 *   with no early exit. A malformed header is refused before any comparison (its shape is public, not secret).
 * - No current secret → always `false` (also when only the rotation slot is set).
 * - Accepted residual (R-49): a token read from the queue can be replayed within its 120 s window; a replay only runs
 *   the idempotent runner over due work.
 *
 * Every refusal is the same `false`; the route answers 401 with no detail.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface RunnerSecrets {
  current?: string;
  next?: string;
}

/** How far the token's timestamp may be from this server's clock, either way. */
export const RUNNER_TOKEN_MAX_SKEW_SECONDS = 120;

const BEARER = "Bearer ";
/** `v1.<unix seconds, canonical: no sign, no leading zero>.<64 lower-case hex>`. */
const TOKEN = /^v1\.([1-9][0-9]{0,11})\.([0-9a-f]{64})$/;

function mac(secret: string, ts: number): Buffer {
  return createHmac("sha256", secret).update(`jobs-run|v1|${ts}`, "utf8").digest();
}

/** The token for `secret` at `nowSeconds` (what the SQL kick sends; operators and tests use it for manual calls). */
export function mintRunnerToken(secret: string, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  const ts = Math.floor(nowSeconds);
  return `v1.${ts}.${mac(secret, ts).toString("hex")}`;
}

export function isAuthorisedRunner(
  header: string | null | undefined,
  secrets: RunnerSecrets,
  nowSeconds: number = Date.now() / 1000,
): boolean {
  const { current, next } = secrets;
  if (typeof current !== "string" || current.length === 0) return false;
  if (typeof header !== "string" || !header.startsWith(BEARER)) return false;
  const match = TOKEN.exec(header.slice(BEARER.length));
  if (!match) return false;
  const ts = Number(match[1]);
  if (!Number.isSafeInteger(ts) || Math.abs(nowSeconds - ts) > RUNNER_TOKEN_MAX_SKEW_SECONDS) return false;

  const given = Buffer.from(match[2], "hex");
  let matched = timingSafeEqual(given, mac(current, ts));
  if (typeof next === "string" && next.length > 0) {
    // Evaluated whatever the first result was: the time taken does not say which secret (if any) matched.
    matched = timingSafeEqual(given, mac(next, ts)) || matched;
  }
  return matched;
}
