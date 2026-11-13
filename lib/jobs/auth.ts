/**
 * Job runner authentication (V2-04 04-02; RL-23, R-18; threat T-04-01). `POST /api/jobs/run` accepts only
 * `Authorization: Bearer <JOBS_RUNNER_SECRET>` (pg_cron sends it through pg_net from the Vault copy), or the rotation
 * slot `JOBS_RUNNER_SECRET_NEXT` while Vault moves to a new value.
 *
 * Constant time over SHA-256 digests (the shipped pattern of `verifyMsg91WebhookSecret` and `/api/diag/error`): both
 * sides are 32 bytes, so `timingSafeEqual` never throws and neither the secret's length nor a matching prefix leaks.
 * The given value is compared with every configured secret, with no early exit. No current secret → always `false`
 * (fail closed, also when only the rotation slot is set). The header must start with `Bearer ` exactly.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export interface RunnerSecrets {
  current?: string;
  next?: string;
}

const BEARER = "Bearer ";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isAuthorisedRunner(header: string | null | undefined, secrets: RunnerSecrets): boolean {
  const { current, next } = secrets;
  if (typeof current !== "string" || current.length === 0) return false;
  if (typeof header !== "string" || !header.startsWith(BEARER)) return false;
  const given = digest(header.slice(BEARER.length));
  let matched = timingSafeEqual(given, digest(current));
  if (typeof next === "string" && next.length > 0) {
    // Evaluated whatever the first result was: the time taken does not say which secret (if any) matched.
    matched = timingSafeEqual(given, digest(next)) || matched;
  }
  return matched;
}
