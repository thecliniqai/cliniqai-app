"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { hashInviteToken } from "./invite";
import { resolveServiceContext } from "@/lib/auth/context";
import { MultipleClinicsSelectionRequiredError, NoClinicMembershipError } from "@/lib/auth/tenant";
import { clientErrorMessage } from "@/lib/errors/client-message";
import * as staffService from "./service";
import type { RemoveStaffResult, TenantDoctorInfo, TenantStaffInfo } from "./service";
import { removeStaffSchema } from "./schema";
import { UserRole } from "@/lib/db/types";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { mapDbError, type DbErrorMessages } from "@/lib/db/errors";

const inviteStaffSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  role: z.enum(["admin", "doctor", "receptionist", "nurse"] as const, {
    errorMap: () => ({ message: "Please select a valid role." }),
  }),
});

export type InviteStaffResult =
  | { success: true; inviteId: string }
  | { success: false; error: string };

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
    const session = await requirePermission(supabase, "staff:invite");

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
        return { success: false, error: "Only a clinic owner can invite an admin." };
      }
      const mapped = mapDbError(error, INVITE_STAFF_MESSAGES);
      if (mapped.code === "INTERNAL") {
        log.error({ event: "staff.invite_insert.failed", code: errorTag(error), requestId: await getRequestId() });
      }
      return { success: false, error: mapped.message };
    }

    const inviteId = (data as { id?: unknown } | null)?.id;
    if (typeof inviteId !== "string") {
      log.error({ event: "staff.invite_insert.failed", code: "result_shape", requestId: await getRequestId() });
      return { success: false, error: INVITE_STAFF_MESSAGES.INTERNAL as string };
    }
    return { success: true, inviteId };
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

export type AcceptInviteResult =
  | { success: true; tenantId: string }
  | { success: false; error: string };

export async function acceptInvite(rawToken: string): Promise<AcceptInviteResult> {
  if (!rawToken || rawToken.trim() === "") {
    return {
      success: false,
      error: "Missing or invalid invitation token.",
    };
  }

  const supabase = await createClient();
  const tokenHash = hashInviteToken(rawToken.trim());

  try {
    // Authenticate before any database call (ADR-0005 V1); the RPC re-checks auth.uid() and binds the membership to it.
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Sign in to accept this invitation." };
    }

    const { data: tenantId, error } = await (
      supabase.rpc as unknown as (
        name: string,
        args: { p_token_hash: string }
      ) => Promise<{ data: string | null; error: { message: string } | null }>
    )("consume_invitation", {
      p_token_hash: tokenHash,
    });

    if (error || !tenantId) {
      const msg = error?.message || "";
      if (msg.includes("already been used")) {
        return { success: false, error: "This invitation has already been used." };
      }
      if (msg.includes("expired")) {
        return { success: false, error: "This invitation has expired. Please ask for a new invite." };
      }
      if (msg.includes("Invalid invitation token")) {
        return { success: false, error: "Invalid invitation link." };
      }
      // V2-05 05-11b (H-INVITE, migration 000071): only the invited address may accept, once it is confirmed.
      if (msg.includes("INVITATION_EMAIL_MISMATCH")) {
        return {
          success: false,
          error: "This invitation was sent to a different email address. Sign in with that address to accept it.",
        };
      }
      if (msg.includes("INVITATION_EMAIL_UNCONFIRMED")) {
        return { success: false, error: "Confirm your email address first, then open the invitation link again." };
      }
      // V2-05 05-05 (migration 000087): an invitation revoked (e.g. by the inviter's removal) is dead.
      if (msg.includes("INVITATION_REVOKED")) {
        return { success: false, error: "This invitation has been withdrawn. Please ask for a new invite." };
      }
      return { success: false, error: "Failed to accept invitation. Please try again." };
    }

    return {
      success: true,
      tenantId: tenantId as string,
    };
  } catch {
    return {
      success: false,
      error: "Failed to accept invitation. Please try again.",
    };
  }
}

export type { RemoveStaffResult, TenantDoctorInfo, TenantStaffInfo } from "./service";

export type RemoveStaffActionResult = { success: true; result: RemoveStaffResult } | { success: false; error: string };

/**
 * AUTH-05 (V2-05 05-05): removes a staff member of the caller's active clinic. Authenticates and checks staff:invite
 * before reading the input; the clinic and the actor come only from the session (the RPC re-derives the clinic from the
 * target row and binds it to the active clinic). Backend only: the staff UI and journey J-A6 are V2-11's (R-31).
 */
export async function removeStaff(input: { membershipId: string; reason: string }): Promise<RemoveStaffActionResult> {
  const resolved = await resolveServiceContext("staff:invite");
  if (!resolved.ok) return { success: false, error: resolved.error };

  const parsed = removeStaffSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const removed = await staffService.removeStaff(resolved.ctx, parsed.data);
  if (!removed.ok) return { success: false, error: removed.error.message };
  return { success: true, result: removed.value };
}

// The acting tenant comes only from the session (ADR-0005 D1). A caller without a membership gets an empty
// directory, as before.
export async function getTenantDoctorDirectory(): Promise<TenantDoctorInfo[]> {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return [];
  return staffService.getTenantDoctorDirectory(resolved.ctx);
}

export async function getTenantStaffDirectory(): Promise<TenantStaffInfo[]> {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return [];
  return staffService.getTenantStaffDirectory(resolved.ctx);
}

export async function getTenantDoctorMap(): Promise<Record<string, string>> {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return {};
  return staffService.getTenantDoctorMap(resolved.ctx);
}
