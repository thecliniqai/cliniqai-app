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
  | "invoice.payment_recorded"
  | "invoice.generate_receipt_pdf"
  | "schedule_block.create"
  | "schedule_block.delete"
  | "vitals.record";

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
    | "schedule_block";
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

/**
 * Records an immutable audit log entry.
 * Actor identity and tenant boundary are derived strictly server-side.
 * Failure to write audit logs throws an error rather than silently proceeding,
 * guaranteeing audit integrity on sensitive paths.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

export async function recordAudit(
  params: RecordAuditParams,
  clientOverride?: SupabaseClient<Database>,
  membershipOverride?: { userId: string; tenantId: string; role?: string }
): Promise<void> {
  const membership = membershipOverride || (await getActiveMembership());
  const supabase = clientOverride || (await createClient());

  const safeMetadata = filterMetadata(params.metadata);

  const { error } = await (
    supabase.from("audit_logs") as unknown as {
      insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    }
  ).insert({
    tenant_id: membership.tenantId,
    actor_id: membership.userId,
    actor_role: membership.role || "owner",
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
