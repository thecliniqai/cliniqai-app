import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { ServiceContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";

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

/** TEMP 01-01b/c: the legacy adapter still lets its callers state the actor type (v1 routes pass "api_key"). */
export interface LegacyRecordAuditParams extends RecordAuditParams {
  actorType?: "user" | "api_key";
  apiKeyId?: string | null;
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

async function insertAuditRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database, any, any>,
  membership: AuditMembership,
  actorType: "user" | "api_key",
  apiKeyId: string | null,
  params: RecordAuditParams
): Promise<void> {
  const safeMetadata = filterMetadata(params.metadata);

  const { error } = await (
    supabase.from("audit_logs") as unknown as {
      insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    }
  ).insert({
    tenant_id: membership.tenantId,
    actor_id: membership.userId,
    actor_role: membership.role || "owner",
    actor_type: actorType,
    api_key_id: apiKeyId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId || null,
    metadata: safeMetadata,
  });

  if (error) {
    console.error("[lib/audit/audit] Failed to record audit log:", error);
    // Mandatory audit guarantee: fail the transaction/action if audit cannot be recorded
    throw new Error("Audit log recording failed. Action was aborted to preserve compliance trail.");
  }
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
  await insertAuditRow(
    ctx.db,
    { userId: ctx.userId, tenantId: ctx.tenantId, role: ctx.role },
    ctx.actorType,
    ctx.actorType === "api_key" ? ctx.apiKeyId ?? null : null,
    params
  );
}

/**
 * TEMP 01-01c: old override signature for the domains not yet moved to services (prescriptions, consultation,
 * billing, api-keys, webhooks, dpdp, `/api/v1`). Delete with the last caller; new code must call
 * `recordAudit(ctx, params)`.
 */
export async function recordAuditLegacy(
  params: LegacyRecordAuditParams,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  membershipOverride?: AuditMembership
): Promise<void> {
  const membership = membershipOverride || (await getActiveMembership());
  const supabase = clientOverride || (await createClient());
  await insertAuditRow(supabase, membership, params.actorType || "user", params.apiKeyId || null, params);
}
