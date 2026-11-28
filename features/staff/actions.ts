"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { acceptInvite as acceptInviteFlow, type AcceptInviteResult } from "@/features/auth/invite-flows";
import { resolveServiceContext } from "@/lib/auth/context";
import { forgetSessionContext, MultipleClinicsSelectionRequiredError, NoClinicMembershipError } from "@/lib/auth/tenant";
import { clientErrorMessage } from "@/lib/errors/client-message";
import * as staffService from "./service";
import type { RemoveStaffResult, TenantDoctorInfo, TenantStaffInfo } from "./service";
import { removeStaffSchema } from "./schema";
import { UserRole } from "@/lib/db/types";
import { errorTag, log, logWord } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { mapDbError, type DbErrorMessages } from "@/lib/db/errors";
import { markAction } from "@/lib/observability/db-timing";

const inviteStaffSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  role: z.enum(["admin", "doctor", "receptionist", "nurse"] as const, {
    errorMap: () => ({ message: "Please select a valid role." }),
  }),
});

/**
 * What the invitation call did (V2-05 05-12, M-REINVITE), so the owner is told which happened:
 *   - `sent`: a new invitation, emailed;
 *   - `replaced`: a pending invitation to the same address for another role (`previousRole`) was revoked and a new
 *     one, for the role asked, was emailed;
 *   - `already_pending`: an invitation for the same address is still pending; nothing new was sent.
 * `role` is the role the invitation in the database carries (000094, re-verification N-2), never the role requested: when
 * two invitations to one address race, the pending one may carry another role, and the owner is told that role. It is
 * absent only when the database did not name it (a database older than 000094); the notice then names no role.
 */
export type InviteStaffOutcome = "sent" | "replaced" | "already_pending";

export type InviteStaffResult =
  | { success: true; inviteId: string; outcome: InviteStaffOutcome; role?: UserRole; previousRole?: UserRole }
  | { success: false; error: string };

const STAFF_ROLES: readonly UserRole[] = ["owner", "admin", "doctor", "receptionist", "nurse"];

/** Fixed texts for the `invite_staff` refusals (V2-05 05-07a); never database text. */
const INVITE_STAFF_MESSAGES: DbErrorMessages = {
  ALREADY_MEMBER: "This person is already a member of the clinic.",
  INPUT_INVALID: "Please enter a valid email address and role.",
  FORBIDDEN: "You do not have permission to invite staff.",
  INTERNAL: "Unable to create staff invitation. Please try again.",
};

export async function inviteStaff(
  input: FormData | { email: string; role: string }
): Promise<InviteStaffResult> {
  await markAction("staff.invite_staff");
  const rawEmail = input instanceof FormData ? input.get("email") : input.email;
  const rawRole = input instanceof FormData ? input.get("role") : input.role;

  const parseResult = inviteStaffSchema.safeParse({
    email: rawEmail,
    role: rawRole,
  });

  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const { email, role } = parseResult.data;
  const supabase = await createClient();

  try {
    // 1. Enforce permission server-side
    const session = await requirePermission(supabase, "staff:invite", "full", { sensitive: "staff.invite" });

    // Owner/admin invitations are owner-only (P0-02). The invitations INSERT policy (000019) enforces the same rule.
    if (role === "admin" && session.role !== "owner") {
      return { success: false, error: "Only a clinic owner can invite an admin." };
    }

    // 2. V2-05 05-07a (AUTH-06): invitations are created only by the invite_staff RPC (the INSERT privilege is revoked).
    // The clinic is the session's (ctx.tenantId); the database accepts it only if the caller holds staff:invite there
    // (the active clinic), keeps owner/admin invitations owner-only, returns an existing pending invitation for the same
    // address (deduped) and enqueues the send job in the same transaction. No token exists until the email handler
    // mints it at send time (R-30), so none can be returned or logged here.
    const { data, error } = await (
      supabase.rpc as unknown as (
        name: "invite_staff",
        args: { p_tenant: string; p_email: string; p_role: UserRole }
      ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
    )("invite_staff", { p_tenant: session.tenantId, p_email: email, p_role: role as UserRole });

    if (error) {
      if (error.code === "42501" && error.message === "OWNER_REQUIRED") {
        // Inviting an admin, or (05-12) replacing a pending admin invitation with another role: both are owner-only.
        return { success: false, error: "Only a clinic owner can invite an admin or change a pending admin invitation." };
      }
      const mapped = mapDbError(error, INVITE_STAFF_MESSAGES);
      if (mapped.code === "INTERNAL") {
        log.error({ event: "staff.invite_insert.failed", code: errorTag(error), requestId: await getRequestId() });
      }
      return { success: false, error: mapped.message };
    }

    const row = (data ?? {}) as { id?: unknown; deduped?: unknown; role?: unknown; replaced_role?: unknown };
    const inviteId = row.id;
    if (typeof inviteId !== "string" || typeof row.deduped !== "boolean") {
      log.error({ event: "staff.invite_insert.failed", code: "result_shape", requestId: await getRequestId() });
      return { success: false, error: INVITE_STAFF_MESSAGES.INTERNAL as string };
    }
    // N-2 (000094): the stored role, as the database answered it; never the requested `role`.
    const stored = typeof row.role === "string" && STAFF_ROLES.includes(row.role as UserRole) ? (row.role as UserRole) : undefined;
    const withRole = stored ? { role: stored } : {};
    if (row.deduped) return { success: true, inviteId, outcome: "already_pending", ...withRole };
    if (typeof row.replaced_role === "string" && STAFF_ROLES.includes(row.replaced_role as UserRole)) {
      return { success: true, inviteId, outcome: "replaced", ...withRole, previousRole: row.replaced_role as UserRole };
    }
    return { success: true, inviteId, outcome: "sent", ...withRole };
  } catch (err: unknown) {
    // Session and permission refusals keep their fixed text; anything else gets a fixed message (IR-L2).
    const known =
      err instanceof NoClinicMembershipError ||
      err instanceof MultipleClinicsSelectionRequiredError ||
      (err instanceof Error && err.message === "Unauthenticated");
    return {
      success: false,
      error: known
        ? (err as Error).message
        : clientErrorMessage(err, "Failed to invite staff.", "staff.invite.failed"),
    };
  }
}

/**
 * Production-hardened action alias for staff invitations.
 */
export const inviteStaffMemberAction = inviteStaff;

export type { AcceptInviteResult } from "@/features/auth/invite-flows";

/**
 * The signed-in invitee accepts (AUTH-06): `consume_invitation` binds the membership to `auth.uid()`, and only a
 * confirmed account whose email is the invited address may redeem (000071/000088). The flow lives in
 * features/auth/invite-flows.ts (05-07b); this action keeps its manifest entry.
 */
export async function acceptInvite(rawToken: string): Promise<AcceptInviteResult> {
  await markAction("staff.accept_invite");
  return acceptInviteFlow(rawToken);
}

export type InvitationActionResult =
  | { success: true; invitationId: string; expiresAt: string }
  | { success: false; error: string };
export type RevokeInvitationActionResult =
  | { success: true; invitationId: string; revokedAt: string }
  | { success: false; error: string };

/** Fixed texts for the resend/revoke refusals (05-07a reasons); never database text. */
const INVITATION_MANAGE_MESSAGES: DbErrorMessages = {
  OWNER_REQUIRED: "Only a clinic owner can manage an owner or admin invitation.",
  INVITATION_NOT_FOUND: "Invitation not found.",
  INVITATION_NOT_PENDING: "This invitation is no longer pending.",
  NOT_FOUND: "Invitation not found.",
  FORBIDDEN: "You do not have permission to manage invitations.",
  CONFLICT: "This invitation is no longer pending.",
  INPUT_INVALID: "Invalid invitation.",
  INTERNAL: "Unable to update the invitation. Please try again.",
};

const invitationIdSchema = z.object({ invitationId: z.string().uuid("Invalid invitation.") });

type InvitationRpc = (
  name: "resend_invitation" | "revoke_invitation",
  args: { p_invitation_id: string },
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

async function manageInvitation(
  fn: "resend_invitation" | "revoke_invitation",
  input: { invitationId: string },
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  // 09D-01a (ruling R-S): invitation management is on the closed list of sensitive actions.
  const resolved = await resolveServiceContext("staff:invite", "full", {
    sensitive: fn === "resend_invitation" ? "staff.invite.resend" : "staff.invite.revoke",
  });
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const parsed = invitationIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invitation." };

  // The RPC re-derives the clinic from the invitation row and binds it to the active clinic (05-07a); the session's
  // role there must hold staff:invite, and owner/admin invitations need an owner. A resend mints nothing here: it bumps
  // token_version (the old link is dead) and enqueues one email.invite job for the new version.
  const { data, error } = await (resolved.ctx.db.rpc as unknown as InvitationRpc)(fn, {
    p_invitation_id: parsed.data.invitationId,
  });
  if (error) {
    if (error.code === "42501" && error.message === "OWNER_REQUIRED") {
      return { ok: false, error: INVITATION_MANAGE_MESSAGES.OWNER_REQUIRED as string };
    }
    const mapped = mapDbError(error, INVITATION_MANAGE_MESSAGES);
    if (mapped.code === "INTERNAL") {
      log.error({ event: "staff.invitation_manage.failed", action: logWord(fn), code: errorTag(error), requestId: await getRequestId() });
    }
    return { ok: false, error: mapped.message };
  }
  if (data === null || typeof data !== "object") return { ok: false, error: INVITATION_MANAGE_MESSAGES.INTERNAL as string };
  return { ok: true, data: data as Record<string, unknown> };
}

/** AUTH-06 (05-07b): sends the invitation again with a new link (the previous link stops working at once). */
export async function resendInvite(input: { invitationId: string }): Promise<InvitationActionResult> {
  await markAction("staff.resend_invite");
  const result = await manageInvitation("resend_invitation", input);
  if (!result.ok) return { success: false, error: result.error };
  const { id, expires_at: expiresAt } = result.data;
  if (typeof id !== "string" || typeof expiresAt !== "string") {
    return { success: false, error: INVITATION_MANAGE_MESSAGES.INTERNAL as string };
  }
  return { success: true, invitationId: id, expiresAt };
}

/** AUTH-06 (05-07b): withdraws a pending invitation (its link stops working at once). */
export async function revokeInvite(input: { invitationId: string }): Promise<RevokeInvitationActionResult> {
  await markAction("staff.revoke_invite");
  const result = await manageInvitation("revoke_invitation", input);
  if (!result.ok) return { success: false, error: result.error };
  const { id, revoked_at: revokedAt } = result.data;
  if (typeof id !== "string" || typeof revokedAt !== "string") {
    return { success: false, error: INVITATION_MANAGE_MESSAGES.INTERNAL as string };
  }
  return { success: true, invitationId: id, revokedAt };
}

export type { RemoveStaffResult, TenantDoctorInfo, TenantStaffInfo } from "./service";

export type RemoveStaffActionResult = { success: true; result: RemoveStaffResult } | { success: false; error: string };

/**
 * AUTH-05 (V2-05 05-05): removes a staff member of the caller's active clinic. Authenticates and checks staff:invite
 * before reading the input; the clinic and the actor come only from the session (the RPC re-derives the clinic from the
 * target row and binds it to the active clinic). Backend only: the staff UI and journey J-A6 are V2-11's (R-31).
 */
export async function removeStaff(input: { membershipId: string; reason: string }): Promise<RemoveStaffActionResult> {
  await markAction("staff.remove_staff");
  let resolved = await resolveServiceContext("staff:invite", "full", { sensitive: "staff.remove" });
  if (!resolved.ok && resolved.reason === "locked") {
    // V2-05 05-12 (IND L-5): the OWNER of a locked or onboarding clinic may still remove staff, so a dismissed member
    // does not regain access on renewal. `remove_member` enforces the same rule (owner only, same checks, audited).
    const billing = await resolveServiceContext("staff:invite", "billing", { sensitive: "staff.remove" });
    if (billing.ok && billing.ctx.role === "owner") resolved = billing;
  }
  if (!resolved.ok) return { success: false, error: resolved.error };

  const parsed = removeStaffSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const removed = await staffService.removeStaff(resolved.ctx, parsed.data);
  if (!removed.ok) return { success: false, error: removed.error.message };
  // V2-09d: memberships changed: this device's session context is read again (the removed member's own device keeps
  // navigation for at most the cookie's 5 minutes; RLS refuses their data at once).
  await forgetSessionContext();
  return { success: true, result: removed.value };
}

// The acting tenant comes only from the session (ADR-0005 D1). A caller without a membership gets an empty
// directory, as before.
export async function getTenantDoctorDirectory(): Promise<TenantDoctorInfo[]> {
  await markAction("staff.get_tenant_doctor_directory");
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return [];
  return staffService.getTenantDoctorDirectory(resolved.ctx);
}

export async function getTenantStaffDirectory(): Promise<TenantStaffInfo[]> {
  await markAction("staff.get_tenant_staff_directory");
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return [];
  return staffService.getTenantStaffDirectory(resolved.ctx);
}

export async function getTenantDoctorMap(): Promise<Record<string, string>> {
  await markAction("staff.get_tenant_doctor_map");
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return {};
  return staffService.getTenantDoctorMap(resolved.ctx);
}
