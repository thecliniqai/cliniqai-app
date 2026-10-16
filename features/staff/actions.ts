"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { generateInviteToken, hashInviteToken } from "./invite";
import { formatDoctorDisplayName, formatStaffDisplayName } from "./formatters";
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

export async function getTenantDoctorDirectory(
  clientOverride?: any,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<TenantDoctorInfo[]> {
  try {
    const supabase = clientOverride || (await createClient());
    let session = sessionOverride;
    if (!session) {
      const { getActiveMembership } = await import("@/lib/auth/tenant");
      const active = await getActiveMembership();
      session = { userId: active.userId, tenantId: active.tenantId };
    }

    const { data: tenant } = await (supabase.from("tenants") as any)
      .select("owner_is_practicing_doctor")
      .eq("id", session.tenantId)
      .single();

    const { data: memberRows, error } = await (supabase.from("memberships") as any)
      .select("id, user_id, tenant_id, role, full_name, default_specialty, default_slot_duration_minutes, availability_schedule, qualifications, medical_council_reg_no")
      .eq("tenant_id", session.tenantId);

    if (error || !memberRows) {
      console.error("[getTenantDoctorDirectory] Error fetching members:", error ? { message: error.message, code: error.code, details: error.details, hint: error.hint } : "No rows returned");
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
    console.error("[getTenantDoctorDirectory] Unexpected error:", err);
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

export async function getTenantStaffDirectory(
  clientOverride?: any,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<TenantStaffInfo[]> {
  try {
    const supabase = clientOverride || (await createClient());
    let session = sessionOverride;
    if (!session) {
      const { getActiveMembership } = await import("@/lib/auth/tenant");
      const active = await getActiveMembership();
      session = { userId: active.userId, tenantId: active.tenantId };
    }

    const { data: memberRows, error } = await (supabase.from("memberships") as any)
      .select("id, user_id, tenant_id, role, full_name, default_specialty")
      .eq("tenant_id", session.tenantId);

    if (error || !memberRows) {
      console.error("[getTenantStaffDirectory] Error fetching members:", error ? { message: error.message, code: error.code, details: error.details, hint: error.hint } : "No rows returned");
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
    console.error("[getTenantStaffDirectory] Unexpected error:", err);
    return [];
  }
}

export async function getTenantDoctorMap(
  clientOverride?: any,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<Record<string, string>> {
  const doctors = await getTenantDoctorDirectory(clientOverride, sessionOverride);
  const map: Record<string, string> = {};
  for (const doc of doctors) {
    map[doc.id] = doc.name;
  }
  return map;
}

