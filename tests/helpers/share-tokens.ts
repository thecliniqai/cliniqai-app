import { createHash } from "node:crypto";

/**
 * The stored form of a share-link token (000022, AR2-L1): SHA-256 of the token, lowercase hex. Tests use it to seed
 * token rows directly and to find the row behind a token returned by `create_share_token` / `create_reschedule_token`.
 */
export function shareTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
