import "server-only";

import type { ServiceContext } from "@/lib/auth/context";
import { formatDoctorDisplayName, formatStaffDisplayName } from "./formatters";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { appError, type Result } from "@/lib/errors/app-error";
import { mapDbError, type DbErrorMessages } from "@/lib/db/errors";
import type { RemoveStaffInput } from "./schema";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TenantDoctorInfo {
  id: string; // user_id
  membershipId: string;
  name: string; // e.g. "Dr. Sarah Jenkins"
  fullName: string | null;
  role: string;
  specialty: string;
  default_slot_duration_minutes: number;
  availability_schedule: any | null;
}

/**
 * The clinic's doctors. By default only ACTIVE memberships (pickers and booking: a removed or suspended doctor is not
 * offered, V2-05 05-05); `includeInactive` keeps them, for name lookups of past records (`getTenantDoctorMap`).
 */
export async function getTenantDoctorDirectory(
  ctx: ServiceContext,
  options: { includeInactive?: boolean } = {}
): Promise<TenantDoctorInfo[]> {
  try {
    const supabase = ctx.db as any;
    const session = ctx;

    const { data: tenant } = await (supabase.from("tenants") as any)
      .select("owner_is_practicing_doctor")
      .eq("id", session.tenantId)
      .single();

    let query = (supabase.from("memberships") as any)
      .select(
        "id, user_id, tenant_id, role, full_name, default_specialty, default_slot_duration_minutes, availability_schedule, qualifications, medical_council_reg_no"
      )
      .eq("tenant_id", session.tenantId);
    if (!options.includeInactive) query = query.eq("status", "active");
    const { data: memberRows, error } = await query;

    if (error || !memberRows) {
      log.error({ event: "staff.doctor_directory_query.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return [];
    }

    const ownerPracticing = tenant?.owner_is_practicing_doctor ?? true;

    // Doctors: role == 'doctor' OR (owner when practicing) OR (admin with doctor qualifications/specialty)
    const doctorMembers = memberRows.filter((m: any) => {
      if (m.role === "doctor") return true;
      if (m.role === "owner" && ownerPracticing) return true;
      if (m.role === "admin" && (m.qualifications || m.medical_council_reg_no)) return true;
      return false;
    });

    return doctorMembers.map((m: any, index: number) => ({
      id: m.user_id,
      membershipId: m.id,
      name: formatDoctorDisplayName(m.full_name, index + 1),
      fullName: m.full_name || null,
      role: m.role,
      specialty: m.default_specialty || "general_physician",
      default_slot_duration_minutes: m.default_slot_duration_minutes || 15,
      availability_schedule: m.availability_schedule || null,
    }));
  } catch (err) {
    log.error({ event: "staff.doctor_directory.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }
}

export interface TenantStaffInfo {
  id: string; // user_id
  membershipId: string;
  name: string;
  fullName: string | null;
  role: string;
  specialty?: string;
}

export async function getTenantStaffDirectory(ctx: ServiceContext): Promise<TenantStaffInfo[]> {
  try {
    const supabase = ctx.db as any;
    const session = ctx;

    // Active staff only (V2-05 05-05): a removed member is not part of the clinic's staff any more.
    const { data: memberRows, error } = await (supabase.from("memberships") as any)
      .select("id, user_id, tenant_id, role, full_name, default_specialty")
      .eq("tenant_id", session.tenantId)
      .eq("status", "active");

    if (error || !memberRows) {
      log.error({ event: "staff.directory_query.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return [];
    }

    return memberRows.map((m: any, index: number) => ({
      id: m.user_id,
      membershipId: m.id,
      name: formatStaffDisplayName(m.full_name, m.role, index + 1),
      fullName: m.full_name || null,
      role: m.role,
      specialty: m.default_specialty,
    }));
  } catch (err) {
    log.error({ event: "staff.directory.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }
}

export async function getTenantDoctorMap(ctx: ServiceContext): Promise<Record<string, string>> {
  // Names for past records too: a removed doctor's visits still show who saw the patient.
  const doctors = await getTenantDoctorDirectory(ctx, { includeInactive: true });
  const map: Record<string, string> = {};
  for (const doc of doctors) {
    map[doc.id] = doc.name;
  }
  return map;
}

// ---------------------------------------------------------------------------------------------------------------------
// AUTH-05 staff removal (V2-05 05-05)
// ---------------------------------------------------------------------------------------------------------------------

export interface RemoveStaffResult {
  userId: string;
  keysRevoked: number;
  invitesRevoked: number;
  /** null when the database refused to end the sessions (hosted privilege, R-43): the 15-minute token is the bound. */
  sessionsRevoked: number | null;
}

/** Fixed texts for the `remove_member` refusals; never database text. */
export const REMOVE_STAFF_MESSAGES: DbErrorMessages = {
  MEMBER_NOT_FOUND: "Staff member not found.",
  STAFF_REMOVE_FORBIDDEN: "You do not have permission to remove staff.",
  OWNER_REQUIRED: "Only a clinic owner can remove an owner or an admin.",
  LAST_OWNER: "The clinic's only owner cannot be removed. Make someone else an owner first.",
  SELF_REMOVAL: "You cannot remove yourself from the clinic.",
  MEMBER_NOT_ACTIVE: "This staff member has already been removed.",
  INPUT_INVALID: "Give a valid reason for removing this staff member.",
  FORBIDDEN: "You do not have permission to remove staff.",
  NOT_FOUND: "Staff member not found.",
  INTERNAL: "Failed to remove the staff member. Please try again.",
};

/**
 * Removes a staff member through `remove_member` on the caller's user client (AUTH-05): the RPC takes the clinic from
 * the target row and refuses anything outside the active clinic, checks staff:invite / owner-only / last owner / self,
 * revokes the member's API keys and pending invitations and ends their sessions, and writes the audit row. The service
 * passes only the membership id and the reason; it never names a tenant or an actor.
 */
export async function removeStaff(ctx: ServiceContext, input: RemoveStaffInput): Promise<Result<RemoveStaffResult>> {
  const { data, error } = await (
    ctx.db.rpc as unknown as (
      name: "remove_member",
      args: { p_membership_id: string; p_reason: string }
    ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
  )("remove_member", { p_membership_id: input.membershipId, p_reason: input.reason });

  if (error) {
    // 42501 keeps no reason in mapDbError (FORBIDDEN by SQLSTATE); the owner-only refusal gets its own fixed text.
    if (error.code === "42501" && error.message === "OWNER_REQUIRED") {
      return { ok: false, error: appError("FORBIDDEN", { message: REMOVE_STAFF_MESSAGES.OWNER_REQUIRED, reason: "OWNER_REQUIRED" }) };
    }
    const mapped = mapDbError(error, REMOVE_STAFF_MESSAGES);
    if (mapped.code === "INTERNAL") {
      log.error({ event: "staff.remove.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    }
    return { ok: false, error: mapped };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  const userId = typeof row.user_id === "string" ? row.user_id : null;
  const keys = count(row.keys_revoked);
  const invites = count(row.invites_revoked);
  if (!userId || keys === null || invites === null || (row.sessions_revoked !== null && count(row.sessions_revoked) === null)) {
    log.error({ event: "staff.remove.failed", code: "result_shape", requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { ok: false, error: appError("INTERNAL", { message: REMOVE_STAFF_MESSAGES.INTERNAL }) };
  }
  return {
    ok: true,
    value: { userId, keysRevoked: keys, invitesRevoked: invites, sessionsRevoked: count(row.sessions_revoked) },
  };
}
