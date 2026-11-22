import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import type { ServiceContext } from "@/lib/auth/context";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

/**
 * Every audit action the app writes. The user path (`log_audit`) accepts exactly these, without the reserved prefixes
 * `dpdp.`, `auth.`, `billing.`, `ops.` (except `dpdp.data_export`, which needs exports:create), and refuses anything else
 * (V2-05 05-11b, INT L-5, migration 000074 `private.audit_client_actions()`; parity: tests/audit/log-audit-allowlist.spec.ts).
 *
 * V2-07 07-04a (migration 000099, F-1): the actions only an atomic command writes are NOT in this list: `visit.complete_and_sign`,
 * `visit.reopen_for_amendment`, `visit.amend_finalized`, `invoice.create`, `queue.check_in`, and (V2-08 08-01b) `visit.consultation_start`, `visit.complete_at_desk`, and (V2-08 08-04a) `visit.reschedule`, `visit.no_show`, `visit.cancel`, `visit.confirm`, `visit.auto_promoted_from_waitlist`, `waitlist.add`, `waitlist.promote`, and (V2-08 08-06a, migration 000106) `visit.create`, and (V2-09b 09B-01, migration 000112) `consultation.draft_save`, and (V2-09c 09C-01, migration 000117) `prescription.lines_change` (see {@link COMMAND_ONLY_AUDIT_ACTIONS}). The API-key path's own actions are in {@link API_KEY_ONLY_AUDIT_ACTIONS}.
 * The commands write them through `private.log_command_audit`; `log_audit` refuses them, so no member can forge them.
 */
export const AUDIT_ACTIONS = [
  "patient.create",
  "patient.view",
  "patient.update",
  "patient.consent.granted",
  "patient.consent.withdrawn",
  "clinic.profile.update",
  "consultation.complete_sign",
  "consultation.amend",
  "diagnosis.add",
  "diagnosis.remove",
  "diagnosis.update_note",
  "prescription.template_save",
  "prescription.generate_pdf",
  "prescription.pdf_integrity_failed",
  "clinic.settings.update",
  "user.profile.update",
  "staff.member.update",
  "invoice.item_add",
  "invoice.item_remove",
  "invoice.payment_recorded",
  "invoice.generate_receipt_pdf",
  "schedule_block.create",
  "schedule_block.delete",
  "vitals.record",
  "patient_document.upload",
  "patient_document.generate_share_token",
  "patient_document.delete",
  "referral.create",
  "referral.acknowledge",
  "referral.close_loop",
  "prescription.share_whatsapp",
  "patient_document.share_whatsapp",
  "referral.share_whatsapp",
  "invoice.share_whatsapp",
  "consultation.share_consolidated_whatsapp",
  "dpdp.patient_erasure",
  "dpdp.data_export",
  "api_key.create",
  "api_key.revoke",
  "webhook.create",
  "webhook.delete",
  "appointment.create",
  "lab_order.create",
  "prescription.create",
] as const;

/** Written only inside the atomic commands (`private.log_command_audit`, 000099); `public.log_audit` refuses them. */
export const COMMAND_ONLY_AUDIT_ACTIONS = [
  "visit.complete_and_sign",
  "visit.reopen_for_amendment",
  "visit.amend_finalized",
  "invoice.create",
  "queue.check_in",
  "visit.consultation_start",
  "visit.complete_at_desk",
  "visit.reschedule",
  "visit.no_show",
  "visit.cancel",
  "visit.confirm",
  "visit.auto_promoted_from_waitlist",
  "waitlist.add",
  "waitlist.promote",
  "visit.create",
  // V2-09b 09B-01 (migration 000112): one row per draft save, written inside save_consultation_draft.
  "consultation.draft_save",
  // V2-09c 09C-01 (migration 000117): one row per Rx change, written inside change_prescription (counts only); replaces the app-side
  // prescription.item_add and prescription.item_remove.
  "prescription.lines_change",
] as const;

/**
 * Written by the API-key path only (V2-08 08-06a, S-5): the service client inserts `audit_logs` directly and does not consult
 * the user allow-list, and no member may forge these through `log_audit`. They are valid {@link AuditAction}s for `recordAudit`
 * with an API-key context; `visit.create` is also written by the commands (it is in {@link COMMAND_ONLY_AUDIT_ACTIONS}).
 */
export const API_KEY_ONLY_AUDIT_ACTIONS = [
  "visit.create",
  "visit.status_update",
  "appointment.reschedule",
  "appointment.cancel",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number] | (typeof API_KEY_ONLY_AUDIT_ACTIONS)[number];

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

/**
 * The metadata keys an audit row may carry (everything else is dropped here). `log_audit` refuses any other key, and
 * also `actor_type` / `api_key_id`, which only the API-key path writes (V2-05 05-11b, migration 000074
 * `private.audit_metadata_keys()`; parity: tests/audit/log-audit-allowlist.spec.ts).
 */
export const AUDIT_METADATA_KEYS = [
  "fields_changed",
  "draft_version",
  "conflict_overwrite",
  "added",
  "updated",
  "removed",
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
  "late_arrival",
  "old_scheduled_at",
  "new_scheduled_at",
  "is_custom",
  "is_chronic",
  "template_name",
  "dose_form",
  "letterhead_mode",
  "version",
  "storage_path",
  "sha256",
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
] as const;

const ALLOWED_METADATA_KEYS = new Set<string>(AUDIT_METADATA_KEYS);

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
