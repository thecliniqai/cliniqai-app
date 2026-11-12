import "server-only";

import { getSystemDb, type SystemDb } from "@/lib/supabase/system";
import { getSignedUrl, SupabaseStorageProvider } from "@/lib/storage";
import { isTenantScopedStoragePath, isWellFormedStorageKey } from "@/lib/storage/tenant-path";
import { compileAndGenerateReceiptPdf } from "@/features/billing/pdf/generator";
import { notifyAppointmentRescheduled } from "@/features/appointments/system";
import type { DocumentShareResourceType } from "@/lib/db/types";

/**
 * Privileged steps of the public share links (P0-04; ADR-0005 D2/D3, plan 01-04 ruling C1). This is the only module
 * on the public-link path that holds the service-role client, and it never looks a record up by a caller-supplied
 * id: every step starts from the token and a token-scoped RPC (000020) that binds the resource to the token's
 * tenant and `resource_type`.
 *
 * - `signSharedObject`: a short-lived signed URL for the object behind a valid token. The storage path must sit under
 *   the token's tenant prefix (`tenants/<tenantId>/` or `<tenantId>/`) and be a well-formed key (`isTenantStoragePath`).
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
  storage_path: string;
  original_filename: string | null;
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

const SIGNED_URL_TTL_SECONDS = 600;
const BUCKETS = new Set(["clinic-records", "prescriptions"]);

async function shareTokenObject(
  db: SystemDb,
  token: string,
  kinds: DocumentShareResourceType[]
): Promise<ShareObjectTarget | null> {
  const { data, error } = await systemRpc(db, "share_token_object", { p_token: token, p_kinds: kinds });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
  const t = data as unknown as ShareObjectTarget;
  if (!t.tenant_id || !t.resource_id || !t.bucket || !t.storage_path) return null;
  return t;
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
 * Signs the object behind a valid token of one of `kinds`. Returns null when the token does not resolve, the path is
 * outside the token's tenant, or storage cannot sign it (e.g. the object was never uploaded).
 */
export async function signSharedObject(
  token: string,
  kinds: DocumentShareResourceType[]
): Promise<{ signedUrl: string; resourceType: DocumentShareResourceType } | null> {
  const db = getSystemDb("share.sign");
  const target = await shareTokenObject(db, token, kinds);
  if (!target || !BUCKETS.has(target.bucket) || !isTenantStoragePath(target.tenant_id, target.storage_path)) {
    return null;
  }

  const provider = new SupabaseStorageProvider({ defaultBucket: target.bucket, client: db });

  try {
    const { signedUrl } = await getSignedUrl(
      {
        path: target.storage_path,
        bucket: target.bucket,
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
        downloadFilename: target.original_filename ?? undefined,
      },
      provider
    );
    return signedUrl ? { signedUrl, resourceType: target.resource_type } : null;
  } catch {
    return null;
  }
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
    console.warn("[features/sharing/system] reschedule follow-up failed:", err instanceof Error ? err.name : "error");
  }
}
