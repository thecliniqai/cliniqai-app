import "server-only";

import { getSystemDb, type SystemDb } from "@/lib/supabase/system";
import { createHash } from "node:crypto";
import { downloadFile, getSignedUrl, SupabaseStorageProvider, VIEW_LINK_TTL_SECONDS } from "@/lib/storage";
import { isTenantScopedStoragePath, isWellFormedStorageKey } from "@/lib/storage/tenant-path";
import { compileAndGenerateReceiptPdf } from "@/features/billing/pdf/generator";
import { notifyAppointmentRescheduled } from "@/features/appointments/system";
import type { DocumentShareResourceType } from "@/lib/db/types";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

/**
 * Privileged steps of the public share links (P0-04; ADR-0005 D2/D3, plan 01-04 ruling C1). This is the only module
 * on the public-link path that holds the service-role client, and it never looks a record up by a caller-supplied
 * id: every step starts from the token and a token-scoped RPC (000020) that binds the resource to the token's
 * tenant and `resource_type`.
 *
 * - `signSharedObject` / `resolveSharedObject`: a short-lived signed URL for the object behind a valid token. The storage path must sit under
 *   the token's tenant prefix (`tenants/<tenantId>/` or `<tenantId>/`) and be a well-formed key (`isTenantStoragePath`). A prescription is signed only
 *   after its bytes match the recorded SHA-256 (V2-09a 09A-06a, review S-5): a mismatch is refused and audited, and a prescription whose signed version
 *   is not archived yet answers "being prepared" (never a stale or unverified object).
 * - `renderSharedReceiptPdf`: on-demand receipt PDF for an invoice token, compiled for the token's tenant.
 * - `notifySelfServiceReschedule`: patient confirmation + webhook after `consume_reschedule_token` succeeded.
 *
 * `server-only`, never `"use server"`.
 */

interface ShareObjectTarget {
  tenant_id: string;
  resource_type: DocumentShareResourceType;
  resource_id: string;
  bucket: string;
  /** Null only for a prescription whose signed version is not archived yet (000111). */
  storage_path: string | null;
  original_filename: string | null;
  /** The prescription's recorded SHA-256 (000111, review S-5); null for other kinds or a prescription not archived yet. */
  sha256: string | null;
}

type RpcResult = { data: unknown; error: { code?: string } | null };

/**
 * Service-role call of a token-scoped RPC that is granted to service_role only (000020). Each exported step acquires
 * the system client once, with its own reason, and passes it down (one `db.system_acquired` line per step).
 */
function systemRpc(db: SystemDb, name: "share_token_object" | "reschedule_token_visit", args: Record<string, unknown>) {
  const rpc = db as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<RpcResult> };
  return rpc.rpc(name, args);
}

const BUCKETS = new Set(["clinic-records", "prescriptions"]);

async function shareTokenObject(
  db: SystemDb,
  token: string,
  kinds: DocumentShareResourceType[]
): Promise<ShareObjectTarget | null> {
  const { data, error } = await systemRpc(db, "share_token_object", { p_token: token, p_kinds: kinds });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
  const t = data as unknown as ShareObjectTarget;
  // A prescription token resolves with no path while its signed version is not archived yet (resolveSharedObject answers "pending").
  if (!t.tenant_id || !t.resource_id || !t.bucket || (!t.storage_path && t.resource_type !== "prescription")) return null;
  // V2-05 05-10a (SUB-02, R-28): nothing of a clinic whose access level is not `full` is signed or rendered. The RPC
  // refuses such a token too (000090); this second check uses the service-role access function, never billing_internal.
  if (!(await clinicIsFull(db, t.tenant_id))) return null;
  return t;
}

/** R-28: the clinic's access level through `tenant_access_for_system` (service role only); fail closed. */
export async function clinicIsFull(db: SystemDb, tenantId: string): Promise<boolean> {
  const { data, error } = await db.rpc("tenant_access_for_system", { p_tenant: tenantId });
  return !error && data === "full";
}

/**
 * True only for a well-formed storage key (`isWellFormedStorageKey`: [A-Za-z0-9_./-], no empty or dot segments, so no
 * `%2e%2e` that a URL parser would collapse to `..`; AR2-H1) under the given tenant's prefix (`tenants/<tenantId>/` or
 * `<tenantId>/`).
 */
export function isTenantStoragePath(tenantId: string, path: string): boolean {
  if (!tenantId || !isWellFormedStorageKey(path)) return false;
  if (isTenantScopedStoragePath(tenantId, path)) return true;
  const legacyPrefix = `${tenantId}/`;
  return path.startsWith(legacyPrefix) && path.length > legacyPrefix.length;
}

/**
 * What a share link can serve (09A-06a, review S-5):
 *  - `ok`: a signed URL of the object (a prescription only after its bytes matched the recorded SHA-256);
 *  - `pending`: a prescription whose signed version is not archived yet (for example right after an amendment's finalize): a fixed "being prepared"
 *    answer, never the previous version's object;
 *  - `unverified`: a prescription whose stored bytes do not match the recorded hash (refused and audited as an integrity failure), or whose archive
 *    cannot be read (refused, not audited as tampering);
 *  - null: the token does not resolve, the path is outside the token's tenant, or storage cannot sign it.
 */
export type SharedObjectResult =
  | { status: "ok"; signedUrl: string; resourceType: DocumentShareResourceType }
  | { status: "pending" | "unverified"; resourceType: DocumentShareResourceType };

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The integrity incident of a shared prescription, written by the system (no member acted; no PHI: ids, the recorded hash and the key). */
async function auditSharedIntegrityFailure(db: SystemDb, target: ShareObjectTarget): Promise<void> {
  const { error } = await (
    db.from("audit_logs") as unknown as { insert: (row: Record<string, unknown>) => Promise<{ error: { code?: string } | null }> }
  ).insert({
    tenant_id: target.tenant_id,
    actor_id: null,
    actor_role: "system",
    action: "prescription.pdf_integrity_failed",
    entity_type: "prescription",
    entity_id: target.resource_id,
    metadata: { sha256: target.sha256, storage_path: target.storage_path, reason: "SHARE_LINK_HASH_MISMATCH" },
  });
  if (error) log.warn({ event: "sharing.integrity_audit.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: target.tenant_id });
}

export async function resolveSharedObject(token: string, kinds: DocumentShareResourceType[]): Promise<SharedObjectResult | null> {
  const db = getSystemDb("share.sign");
  const target = await shareTokenObject(db, token, kinds);
  if (!target || !BUCKETS.has(target.bucket)) return null;

  if (target.resource_type === "prescription" && (!target.storage_path || !target.sha256)) {
    // Not archived yet (or a legacy path with no recorded hash, which is never trusted).
    return { status: "pending", resourceType: target.resource_type };
  }
  if (!target.storage_path || !isTenantStoragePath(target.tenant_id, target.storage_path)) return null;

  const provider = new SupabaseStorageProvider({ defaultBucket: target.bucket, client: db });

  if (target.resource_type === "prescription") {
    let bytes: Buffer;
    try {
      bytes = await downloadFile({ path: target.storage_path, bucket: target.bucket }, provider);
    } catch (readErr) {
      log.warn({ event: "sharing.rx_archive_read.failed", code: errorTag(readErr), requestId: await getRequestId(), tenantId: target.tenant_id });
      return { status: "unverified", resourceType: target.resource_type };
    }
    if (sha256Hex(bytes) !== target.sha256) {
      log.error({ event: "sharing.rx_integrity_failed", code: "HASH_MISMATCH", requestId: await getRequestId(), tenantId: target.tenant_id });
      await auditSharedIntegrityFailure(db, target);
      return { status: "unverified", resourceType: target.resource_type };
    }
  }

  try {
    const { signedUrl } = await getSignedUrl(
      {
        path: target.storage_path,
        bucket: target.bucket,
        // 06-09b (N-1): 5 minutes (was 10). The pages load it at once; their Download buttons re-sign via the route.
        expiresInSeconds: VIEW_LINK_TTL_SECONDS, // R-29 (05-10a): share views are views (SUB §7.2), the 300 s cap
        downloadFilename: target.original_filename ?? undefined,
      },
      provider
    );
    return signedUrl ? { status: "ok", signedUrl, resourceType: target.resource_type } : null;
  } catch {
    return null;
  }
}

/**
 * Signs the object behind a valid token of one of `kinds` (see {@link resolveSharedObject}). Returns null when the token does not resolve, the path is
 * outside the token's tenant, storage cannot sign it (e.g. the object was never uploaded), or a prescription is pending or failed its hash check.
 */
export async function signSharedObject(
  token: string,
  kinds: DocumentShareResourceType[]
): Promise<{ signedUrl: string; resourceType: DocumentShareResourceType } | null> {
  const res = await resolveSharedObject(token, kinds);
  return res?.status === "ok" ? { signedUrl: res.signedUrl, resourceType: res.resourceType } : null;
}

/** Receipt PDF for a valid invoice token, compiled for the token's tenant and invoice only. */
export async function renderSharedReceiptPdf(token: string): Promise<Buffer | null> {
  const db = getSystemDb("share.receipt_pdf");
  const target = await shareTokenObject(db, token, ["invoice"]);
  if (!target || target.resource_type !== "invoice") return null;
  const res = await compileAndGenerateReceiptPdf(target.resource_id, db, target.tenant_id);
  return res?.buffer ?? null;
}

/**
 * After `consume_reschedule_token` returned ok: the visit comes from the consumed token (service-role-only RPC
 * `reschedule_token_visit`), never from the request. Best effort: a failure here does not undo the reschedule.
 */
export async function notifySelfServiceReschedule(token: string): Promise<void> {
  const admin = getSystemDb("share.reschedule_notify");
  const { data, error } = await systemRpc(admin, "reschedule_token_visit", { p_token: token });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return;
  const visitId = (data as { visit_id?: string }).visit_id;
  if (!visitId) return;
  try {
    await notifyAppointmentRescheduled({ db: admin, reason: "patient_self_service_reschedule" }, visitId);
  } catch (err) {
    log.warn({ event: "sharing.reschedule_notify.failed", code: errorTag(err), requestId: await getRequestId() });
  }
}
