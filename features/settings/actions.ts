"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { getActiveMembership } from "@/lib/auth/tenant";
import { recordAudit } from "@/lib/audit/audit";
import { Tenant, Membership, Database } from "@/lib/db/types";
import {
  clinicSettingsSchema,
  ClinicSettingsInput,
  userProfileSchema,
  UserProfileInput,
  staffEditSchema,
  StaffEditInput,
} from "./schema";
import type { SupabaseClient } from "@supabase/supabase-js";

export type UpdateClinicSettingsResult =
  | { success: true; tenant: Tenant }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateClinicSettings(
  input: ClinicSettingsInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<UpdateClinicSettingsResult> {
  const parseResult = clinicSettingsSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return {
      success: false,
      error: parseResult.error.issues[0]?.message ?? "Invalid settings input.",
      fieldErrors,
    };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission(supabase, "clinic:manage"));
    const data = parseResult.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedTenant, error: updateError } = await (supabase.from("tenants") as any)
      .update({
        name: data.name.trim(),
        address: data.address?.trim() ?? null,
        specialties: data.specialties,
        timezone: data.timezone,
        owner_is_practicing_doctor: data.owner_is_practicing_doctor,
        default_consultation_fee: data.default_consultation_fee,
        default_followup_fee: data.default_followup_fee,
        accepted_payment_methods: data.accepted_payment_methods,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.tenantId)
      .select("*")
      .single();

    if (updateError || !updatedTenant) {
      console.error("[features/settings/actions] Failed to update clinic settings:", updateError);
      return { success: false, error: "Failed to update clinic profile in database." };
    }

    // If owner is a practicing doctor, also update owner's membership credentials
    if (data.owner_is_practicing_doctor && data.doctor_name) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("memberships") as any)
        .update({
          full_name: data.doctor_name.trim(),
          phone: data.doctor_phone?.trim() ?? null,
          qualifications: data.qualifications?.trim() ?? null,
          medical_council_reg_no: data.medical_council_reg_no?.trim() ?? null,
          default_specialty: data.default_specialty ?? "general_physician",
        })
        .eq("tenant_id", session.tenantId)
        .eq("user_id", session.userId);

      try {
        await supabase.auth.updateUser({
          data: {
            full_name: data.doctor_name.trim(),
            phone: data.doctor_phone?.trim(),
          },
        });
      } catch (authSyncErr) {
        console.warn("[updateClinicSettings] Could not sync user metadata:", authSyncErr);
      }
    }

    await recordAudit(
      {
        action: "clinic.settings.update",
        entityType: "clinic",
        entityId: session.tenantId,
        metadata: {
          fields_changed: [
            "name",
            "address",
            "specialties",
            "timezone",
            "owner_is_practicing_doctor",
            "default_consultation_fee",
            "default_followup_fee",
            "accepted_payment_methods",
            ...(data.doctor_name ? ["owner_doctor_credentials"] : []),
          ],
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/settings/clinic");
      revalidatePath("/profile");
      revalidatePath("/staff");
      revalidatePath("/cabin");
      revalidatePath("/");
    } catch {
      // Ignore in testing environments
    }

    return { success: true, tenant: updatedTenant as Tenant };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update settings.",
    };
  }
}

export type UpdateUserProfileResult =
  | { success: true; membership: Membership }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateUserProfile(
  input: UserProfileInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<UpdateUserProfileResult> {
  const parseResult = userProfileSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return {
      success: false,
      error: parseResult.error.issues[0]?.message ?? "Invalid profile input.",
      fieldErrors,
    };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await getActiveMembership());
    const data = parseResult.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatePayload: Record<string, any> = {
      full_name: data.full_name.trim(),
      phone: data.phone?.trim() ?? null,
      qualifications: data.qualifications?.trim() ?? null,
      medical_council_reg_no: data.medical_council_reg_no?.trim() ?? null,
      default_specialty: data.default_specialty ?? "general_physician",
    };

    if (data.default_slot_duration_minutes !== undefined) {
      updatePayload.default_slot_duration_minutes = data.default_slot_duration_minutes;
    }
    if (data.availability_schedule !== undefined) {
      updatePayload.availability_schedule = data.availability_schedule;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedMembership, error: updateError } = await (supabase.from("memberships") as any)
      .update(updatePayload)
      .eq("tenant_id", session.tenantId)
      .eq("user_id", session.userId)
      .select("*")
      .single();

    if (updateError || !updatedMembership) {
      console.error("[updateUserProfile] Error updating membership:", updateError);
      return { success: false, error: "Failed to update profile in database." };
    }

    try {
      await supabase.auth.updateUser({
        data: {
          full_name: data.full_name.trim(),
          phone: data.phone?.trim(),
        },
      });
    } catch (authErr) {
      console.warn("[updateUserProfile] Could not sync auth user metadata:", authErr);
    }

    await recordAudit(
      {
        action: "user.profile.update",
        entityType: "membership",
        entityId: updatedMembership.id,
        metadata: {
          full_name: data.full_name,
          has_qualifications: Boolean(data.qualifications),
          has_reg_no: Boolean(data.medical_council_reg_no),
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/profile");
      revalidatePath("/settings/clinic");
      revalidatePath("/staff");
      revalidatePath("/cabin");
    } catch {
      // Ignore during testing
    }

    return { success: true, membership: updatedMembership as Membership };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update profile.",
    };
  }
}

export type UpdateStaffMemberResult =
  | { success: true; membership: Membership }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateStaffMember(
  input: StaffEditInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<UpdateStaffMemberResult> {
  const parseResult = staffEditSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return {
      success: false,
      error: parseResult.error.issues[0]?.message ?? "Invalid staff input.",
      fieldErrors,
    };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission(supabase, "clinic:manage"));
    const data = parseResult.data;

    // Check membership exists and belongs to tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await (supabase.from("memberships") as any)
      .select("*")
      .eq("id", data.membership_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (fetchErr || !existing) {
      return { success: false, error: "Staff member not found or access denied." };
    }

    // Guard: Do not allow demoting the last owner
    if (existing.role === "owner" && data.role !== "owner") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await (supabase.from("memberships") as any)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", session.tenantId)
        .eq("role", "owner");

      if ((count ?? 0) <= 1) {
        return {
          success: false,
          error: "Cannot change role of the sole clinic owner. Assign another owner first.",
        };
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatePayload: Record<string, any> = {
      full_name: data.full_name.trim(),
      phone: data.phone?.trim() ?? null,
      role: data.role,
      qualifications: data.qualifications?.trim() ?? null,
      medical_council_reg_no: data.medical_council_reg_no?.trim() ?? null,
      default_specialty: data.default_specialty ?? "general_physician",
    };

    if (data.default_slot_duration_minutes !== undefined) {
      updatePayload.default_slot_duration_minutes = data.default_slot_duration_minutes;
    }
    if (data.availability_schedule !== undefined) {
      updatePayload.availability_schedule = data.availability_schedule;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateErr } = await (supabase.from("memberships") as any)
      .update(updatePayload)
      .eq("id", data.membership_id)
      .eq("tenant_id", session.tenantId)
      .select("*")
      .single();

    if (updateErr || !updated) {
      console.error("[updateStaffMember] Error updating staff member:", updateErr);
      return { success: false, error: "Failed to update staff member in database." };
    }

    await recordAudit(
      {
        action: "staff.member.update",
        entityType: "membership",
        entityId: data.membership_id,
        metadata: {
          target_user_id: existing.user_id,
          role: data.role,
          full_name: data.full_name,
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/staff");
      revalidatePath("/settings/clinic");
      revalidatePath("/cabin");
    } catch {
      // Ignore during testing
    }

    return { success: true, membership: updated as Membership };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update staff member.",
    };
  }
}

export async function getMyProfile() {
  const supabase = await createClient();
  const membership = await getActiveMembership();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: member } = await (supabase.from("memberships") as any)
    .select("id, user_id, tenant_id, role, full_name, phone, qualifications, medical_council_reg_no, default_specialty, default_slot_duration_minutes, availability_schedule, created_at")
    .eq("tenant_id", membership.tenantId)
    .eq("user_id", membership.userId)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tenant } = await (supabase.from("tenants") as any)
    .select("id, name")
    .eq("id", membership.tenantId)
    .single();

  return {
    user: {
      id: user?.id || membership.userId,
      email: user?.email || "",
      fullName: member?.full_name || user?.user_metadata?.full_name || "",
      phone: member?.phone || user?.phone || user?.user_metadata?.phone || "",
    },
    membership: (member || {
      id: "",
      user_id: membership.userId,
      tenant_id: membership.tenantId,
      role: membership.role,
      created_at: new Date().toISOString(),
    }) as Membership,
    tenant: (tenant || { id: membership.tenantId, name: "Clinic" }) as { id: string; name: string },
  };
}
