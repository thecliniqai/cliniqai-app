"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { generateInviteToken, hashInviteToken } from "./invite";
import { UserRole } from "@/lib/db/types";

const inviteStaffSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  role: z.enum(["admin", "doctor", "receptionist", "nurse"] as const, {
    errorMap: () => ({ message: "Please select a valid role." }),
  }),
});

export type InviteStaffResult =
  | { success: true; inviteId: string; rawToken: string; inviteLink: string }
  | { success: false; error: string };

export async function inviteStaff(formData: FormData): Promise<InviteStaffResult> {
  const parseResult = inviteStaffSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
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

    // 2. Generate cryptographically safe token
    const { rawToken, tokenHash, expiresAt } = generateInviteToken(7);

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
      console.error("[features/staff/actions] Failed to create invitation:", error);
      return {
        success: false,
        error: "Unable to create staff invitation. Please try again.",
      };
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const inviteLink = `${baseUrl}/join?token=${rawToken}&email=${encodeURIComponent(email.toLowerCase().trim())}`;

    const { logDevAuthEvent } = await import("@/lib/auth/dev-logger");
    logDevAuthEvent({
      type: "STAFF_INVITATION",
      email: email.toLowerCase().trim(),
      role,
      link: inviteLink,
    });

    return {
      success: true,
      inviteId: (data as { id: string }).id,
      rawToken,
      inviteLink,
    };
  } catch (err: unknown) {
    console.error("[features/staff/actions] Unauthorized or error creating invitation:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to invite staff.",
    };
  }
}

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
      return { success: false, error: "Failed to accept invitation. " + (msg || "Please try again.") };
    }

    return {
      success: true,
      tenantId: tenantId as string,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to accept invitation.",
    };
  }
}
