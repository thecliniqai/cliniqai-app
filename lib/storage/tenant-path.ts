/**
 * Pure storage-key checks (no provider imports, so routes and unit tests can use them directly).
 *
 * P0-05 (ARC-06): a caller-supplied object key must sit under the caller's tenant (`tenants/<tenantId>/`) and, for
 * patient documents, under that patient (`tenants/<tenantId>/patients/<patientId>/`). Traversal, absolute paths,
 * backslashes, empty or dot segments and every character outside [A-Za-z0-9_./-] (percent-encoding, control and
 * non-ASCII characters included) are refused outright, so the prefix check cannot be sidestepped by a key that a URL
 * parser or storage backend would normalise elsewhere.
 */

/**
 * AR2-H1: the only characters a key may contain. Anything else (`%`, backslash, spaces, control or non-ASCII characters)
 * could be decoded or normalised by a URL parser or storage backend into a different key. The database applies the
 * same rule (`public.is_safe_storage_key`, 000022).
 */
const KEY_CHARSET = /^[A-Za-z0-9_./-]+$/;

/** True when `path` is a relative key of [A-Za-z0-9_./-] with only non-empty, non-dot segments. */
export function isWellFormedStorageKey(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) return false;
  if (path.startsWith("/") || !KEY_CHARSET.test(path)) return false;
  const segments = path.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** True only for a well-formed key under `tenants/<tenantId>/` with at least one segment below the prefix. */
export function isTenantScopedStoragePath(tenantId: string, path: string): boolean {
  if (!tenantId || !isWellFormedStorageKey(path)) return false;
  const prefix = `tenants/${tenantId}/`;
  return path.startsWith(prefix) && path.length > prefix.length;
}

/**
 * The referral letter's key, derived from the referral's own tenant and id, never from a stored column (AR-M1; the
 * database derives the same key for share links in `share_token_resource`, 000021).
 */
export function referralLetterPath(tenantId: string, referralId: string): string {
  return `tenants/${tenantId}/referrals/${referralId}/referral_letter.pdf`;
}

/** True only for a well-formed key under `tenants/<tenantId>/patients/<patientId>/`. */
export function isPatientStoragePath(tenantId: string, patientId: string, path: string): boolean {
  if (!patientId || !isTenantScopedStoragePath(tenantId, path)) return false;
  const prefix = `tenants/${tenantId}/patients/${patientId}/`;
  return path.startsWith(prefix) && path.length > prefix.length;
}
