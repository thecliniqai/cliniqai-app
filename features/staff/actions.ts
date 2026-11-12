"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { generateInviteToken, hashInviteToken } from "./invite";
import { resolveServiceContext } from "@/lib/auth/context";
import { MultipleClinicsSelectionRequiredError, NoClinicMembershipError } from "@/lib/auth/tenant";
import { clientErrorMessage } from "@/lib/errors/client-message";
import * as staffService from "./service";
import type { TenantDoctorInfo, TenantStaffInfo } from "./service";
import { UserRole } from "@/lib/db/types";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

const inviteStaffSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  role: z.enum(["admin", "doctor", "receptionist", "nurse"] as const, {
    errorMap: () => ({ message: "Please select a valid role." }),
  }),
});

export type InviteStaffResult =
  | { success: true; inviteId: string }
  | { success: false; error: string };

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

    // 2. Generate cryptographically safe token
    const { tokenHash, expiresAt } = generateInviteToken(7);

    // 3. Insert invite row (RLS policy requires membership with owner/admin)
    const { data, error } = await (supabase.from("invitations") as any)
      .insert({
        tenant_id: session.tenantId,
        role: role as UserRole,
        invited_address: email.toLowerCase().trim(),
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: session.userId,
      })
      .select("id")
      .single();

    if (error || !data) {
      log.error({ event: "staff.invite_insert.failed", code: errorTag(error), requestId: await getRequestId() });
      return {
        success: false,
        error: "Unable to create staff invitation. Please try again.",
      };
    }

    // The raw token is never returned or logged: invitation delivery arrives with AUTH-06 (AUTH_REDESIGN §6).
    return {
      success: true,
      inviteId: (data as { id: string }).id,
    };
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

export type { TenantDoctorInfo, TenantStaffInfo } from "./service";

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
