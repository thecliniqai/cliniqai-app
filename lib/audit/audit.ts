import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import type { ServiceContext } from "@/lib/auth/context";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

export type AuditAction =
  | "patient.create"
  | "patient.view"
  | "patient.update"
  | "patient.consent.granted"
  | "patient.consent.withdrawn"
  | "clinic.profile.update"
  | "visit.create"
  | "visit.status_update"
  | "visit.confirm"
  | "visit.cancel"
  | "visit.auto_promoted_from_waitlist"
  | "queue.check_in"
  | "queue.transition"
  | "waitlist.add"
  | "waitlist.promote"
  | "consultation.draft_save"
  | "consultation.complete_sign"
  | "consultation.amend"
  | "follow_up.record"
  | "diagnosis.add"
  | "diagnosis.remove"
  | "diagnosis.update_note"
  | "prescription.item_add"
  | "prescription.item_remove"
  | "prescription.template_save"
  | "prescription.generate_pdf"
  | "visit.complete_and_sign"
  | "visit.reopen_for_amendment"
  | "visit.amend_finalized"
  | "clinic.settings.update"
  | "user.profile.update"
  | "staff.member.update"
  | "invoice.create"
  | "invoice.item_add"
  | "invoice.item_remove"
  | "invoice.payment_recorded"
  | "invoice.generate_receipt_pdf"
  | "schedule_block.create"
  | "schedule_block.delete"
  | "vitals.record"
  | "patient_document.upload"
  | "patient_document.generate_share_token"
  | "patient_document.delete"
  | "referral.create"
  | "referral.acknowledge"
  | "referral.close_loop"
  | "prescription.share_whatsapp"
  | "patient_document.share_whatsapp"
  | "referral.share_whatsapp"
  | "invoice.share_whatsapp"
  | "consultation.share_consolidated_whatsapp"
  | "dpdp.patient_erasure"
  | "dpdp.data_export"
  | "api_key.create"
  | "api_key.revoke"
  | "webhook.create"
  | "webhook.delete"
  | "appointment.create"
  | "appointment.reschedule"
  | "appointment.cancel"
  | "lab_order.create"
  | "prescription.create";

export interface RecordAuditParams {
  action: AuditAction;
  entityType:
    | "patient"
    | "clinic"
    | "membership"
    | "consent"
    | "visit"
    | "queue_token"
    | "waitlist"
    | "consultation"
    | "prescription"
    | "invoice"
    | "payment"
    | "diagnosis"
    | "follow_up"
    | "schedule_block"
    | "patient_document"
    | "referral"
    | "api_key"
    | "webhook"
    | "appointment"
    | "lab_order"
    | "dpdp";
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

const ALLOWED_METADATA_KEYS = new Set([
  "fields_changed",
  "reason",
  "consent_type",
  "view_context",
  "is_initial_grant",
  "token_number",
  "origin_type",
  "old_status",
  "new_status",
  "priority",
  "promoted_from_waitlist_id",
  "promoted_visit_id",
  "target_date",
  "is_overbooked",
  "specialty",
  "revision_number",
  "amendment_reason",
  "follow_up_date",
  "items_count",
  "is_custom",
  "is_chronic",
  "template_name",
  "dose_form",
  "letterhead_mode",
  "version",
  "storage_path",
  "invoice_number",
  "total_amount",
  "payment_method",
  "invoice_id",
  "referral_type",
  "urgency",
  "target_tenant_id",
  "patient_consents_history_sharing",
  "retention_policy",
  "erased_at",
  "status",
  "format",
  "actor_type",
  "api_key_id",
  "correlation_id",
]);

/**
 * Validates metadata to ensure NO clinical notes, diagnosis, or patient PII
 * are leaked into the audit trail (T-1-09, AGENTS.md §9, §10).
 */
function filterMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | null {
  if (!metadata) return null;
  const filtered: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (ALLOWED_METADATA_KEYS.has(key)) {
      filtered[key] = value;
    }
  }

  return Object.keys(filtered).length > 0 ? filtered : null;
}

type AuditMembership = { userId: string; tenantId: string; role?: string };

async function failAudit(tenantId: string, error: unknown): Promise<never> {
  log.error({ event: "audit.record.failed", code: errorTag(error), requestId: await getRequestId(), tenantId });
  // Mandatory audit guarantee: fail the transaction/action if audit cannot be recorded
  throw new Error("Audit log recording failed. Action was aborted to preserve compliance trail.");
}

/**
 * API-key path (V2-03 03-04): `db` is the `getSystemDb("api_v1")` client, which keeps INSERT on `audit_logs`; the row
 * names the key and the key's acting member.
 */
async function insertApiKeyAuditRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database, any, any>,
  membership: AuditMembership,
  apiKeyId: string | null,
  params: RecordAuditParams
): Promise<void> {
  const { error } = await (
    supabase.from("audit_logs") as unknown as {
      insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    }
  ).insert({
    tenant_id: membership.tenantId,
    actor_id: membership.userId,
    actor_role: membership.role || "owner",
    actor_type: "api_key",
    api_key_id: apiKeyId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId || null,
    metadata: filterMetadata(params.metadata),
  });
  if (error) await failAudit(membership.tenantId, error);
}

/**
 * User path (V2-05 05-02c, R-20, T-05-12): `public.log_audit` on the caller's JWT client. A user can no longer insert
 * into `audit_logs` (INSERT revoked); the database takes the actor and role from the session and refuses a tenant that
 * is not the session's active clinic, so nothing here can name another actor.
 */
async function logUserAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database, any, any>,
  tenantId: string,
  params: RecordAuditParams
): Promise<void> {
  const { error } = await supabase.rpc("log_audit", {
    p_tenant: tenantId,
    p_action: params.action,
    p_entity_type: params.entityType,
    // The generated type marks every argument non-null; SQL accepts NULL for an action without an entity or metadata.
    p_entity_id: (params.entityId || null) as unknown as string,
    p_metadata: filterMetadata(params.metadata) as unknown as Json,
  });
  if (error) await failAudit(tenantId, error);
}

/**
 * Records an immutable audit log entry.
 * The actor, role, tenant and actor type come only from the service context, which is derived from the session
 * (ADR-0005 D1) — never from params. Failure to write audit logs throws rather than silently proceeding,
 * guaranteeing audit integrity on sensitive paths.
 */
export async function recordAudit(
  ctx: Pick<ServiceContext, "userId" | "tenantId" | "role" | "actorType" | "apiKeyId" | "db">,
  params: RecordAuditParams
): Promise<void> {
  if (ctx.actorType === "api_key") {
    await insertApiKeyAuditRow(ctx.db, { userId: ctx.userId, tenantId: ctx.tenantId, role: ctx.role }, ctx.apiKeyId ?? null, params);
    return;
  }
  await logUserAudit(ctx.db, ctx.tenantId, params);
}
