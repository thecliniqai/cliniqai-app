import "server-only";

import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { isUuid } from "@/lib/utils/filter-values";
import { clientErrorMessage } from "@/lib/errors/client-message";
import { Tenant, Membership, ScheduleBlock } from "@/lib/db/types";
import {
  clinicSettingsSchema,
  ClinicSettingsInput,
  statutorySettingsSchema,
  StatutorySettingsInput,
  userProfileSchema,
  UserProfileInput,
  staffEditSchema,
  StaffEditInput,
  doctorWeeklyScheduleSchema,
  slotDurationSchema,
  MIN_SLOT_DURATION_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from "./schema";

// Clinic, profile and staff settings use-cases. Tenant and actor come only from `ctx` (ADR-0005 D1); each use-case
// checks the permission its server action checked before the move (some only require a clinic membership).

function toFieldErrors(issues: { path: (string | number)[]; message: string }[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = issue.path[0]?.toString() || "form";
    fieldErrors[field] = fieldErrors[field] || [];
    fieldErrors[field].push(issue.message);
  }
  return fieldErrors;
}

/** Maps a change_member_role error (000019) to a message safe to show; never echoes database text. */
function roleChangeErrorMessage(err: { message?: string; code?: string }): string {
  const msg = err.message ?? "";
  if (msg.includes("last_owner")) {
    return "Cannot change role of the sole clinic owner. Assign another owner first.";
  }
  if (msg.includes("owner_required")) {
    return "Only a clinic owner can grant or change the owner and admin roles.";
  }
  if (msg.includes("not_found")) {
    return "Staff member not found or access denied.";
  }
  if (msg.includes("forbidden") || err.code === "42501") {
    return "You do not have permission to change staff roles.";
  }
  return "Failed to update staff member role.";
}

const OWNER_ADMIN = new Set(["owner", "admin"]);

/** Equal after trimming, with null/undefined/"" treated as the same empty value. */
function sameText(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return norm(a) === norm(b);
}

function canManageOthers(ctx: ServiceContext): boolean {
  return ctx.role === "owner" || ctx.role === "admin";
}

export type UpdateClinicSettingsResult =
  | { success: true; tenant: Tenant }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateClinicSettings(
  ctx: ServiceContext,
  input: ClinicSettingsInput
): Promise<UpdateClinicSettingsResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "clinic:manage");
    const session = ctx;

    const parseResult = clinicSettingsSchema.safeParse(input);
    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error.issues[0]?.message ?? "Invalid settings input.",
        fieldErrors: toFieldErrors(parseResult.error.issues),
      };
    }
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
        clinical_establishment_reg_no: data.clinical_establishment_reg_no?.trim() || null,
        state_medical_council_reg_no: data.state_medical_council_reg_no?.trim() || null,
        gstin: data.gstin?.trim() || null,
        drug_license_no: data.drug_license_no?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.tenantId)
      .select("*")
      .single();

    if (updateError || !updatedTenant) {
      console.error("[features/settings/service] Failed to update clinic settings:", updateError);
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

    await recordAudit(ctx, {
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
          ...(data.clinical_establishment_reg_no || data.state_medical_council_reg_no || data.gstin || data.drug_license_no
            ? ["statutory_registrations"]
            : []),
          ...(data.doctor_name ? ["owner_doctor_credentials"] : []),
        ],
      },
    });

    return { success: true, tenant: updatedTenant as Tenant };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to update settings.", "features/settings/service updateClinicSettings"),
    };
  }
}

export type UpdateStatutorySettingsResult =
  | { success: true; tenant: Tenant }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Persists official statutory registration numbers (CEA, SMC, GSTIN, Drug License)
 * to public.tenants with full compliance audit logging under DPDP/NMC regulations (D-16).
 */
export async function updateStatutorySettings(
  ctx: ServiceContext,
  input: StatutorySettingsInput
): Promise<UpdateStatutorySettingsResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "clinic:manage");
    const session = ctx;

    const parseResult = statutorySettingsSchema.safeParse(input);
    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error.issues[0]?.message ?? "Invalid statutory registrations input.",
        fieldErrors: toFieldErrors(parseResult.error.issues),
      };
    }
    const data = parseResult.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedTenant, error: updateError } = await (supabase.from("tenants") as any)
      .update({
        clinical_establishment_reg_no: data.clinical_establishment_reg_no?.trim() || null,
        state_medical_council_reg_no: data.state_medical_council_reg_no?.trim() || null,
        gstin: data.gstin?.trim() || null,
        drug_license_no: data.drug_license_no?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.tenantId)
      .select("*")
      .single();

    if (updateError || !updatedTenant) {
      console.error("[features/settings/service] Failed to update statutory settings:", updateError);
      return { success: false, error: "Failed to persist statutory registrations in database." };
    }

    await recordAudit(ctx, {
      action: "clinic.settings.update",
      entityType: "clinic",
      entityId: session.tenantId,
      metadata: {
        fields_changed: ["statutory_registrations"],
      },
    });

    return { success: true, tenant: updatedTenant as Tenant };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to update statutory settings.", "features/settings/service updateStatutorySettings"),
    };
  }
}

export type UpdateUserProfileResult =
  | { success: true; membership: Membership }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/** Updates the signed-in user's own membership profile (any clinic member). */
export async function updateUserProfile(ctx: ServiceContext, input: UserProfileInput): Promise<UpdateUserProfileResult> {
  const supabase = ctx.db;

  try {
    const session = ctx;

    const parseResult = userProfileSchema.safeParse(input);
    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error.issues[0]?.message ?? "Invalid profile input.",
        fieldErrors: toFieldErrors(parseResult.error.issues),
      };
    }
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

    await recordAudit(ctx, {
      action: "user.profile.update",
      entityType: "membership",
      entityId: updatedMembership.id,
      metadata: {
        full_name: data.full_name,
        has_qualifications: Boolean(data.qualifications),
        has_reg_no: Boolean(data.medical_council_reg_no),
      },
    });

    return { success: true, membership: updatedMembership as Membership };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to update profile.", "features/settings/service updateUserProfile"),
    };
  }
}

export type UpdateStaffMemberResult =
  | { success: true; membership: Membership }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateStaffMember(ctx: ServiceContext, input: StaffEditInput): Promise<UpdateStaffMemberResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "clinic:manage");
    const session = ctx;

    const parseResult = staffEditSchema.safeParse(input);
    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error.issues[0]?.message ?? "Invalid staff input.",
        fieldErrors: toFieldErrors(parseResult.error.issues),
      };
    }
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

    const roleChanging = data.role !== existing.role;
    const isSelf = existing.user_id === session.userId;
    const isOwner = ctx.role === "owner";

    // Owner/admin grants and changes to an owner/admin row are owner-only (change_member_role enforces it too); refuse
    // before any write so a refused role change never leaves a half-applied edit (IR-L3).
    if (roleChanging && !isOwner && (OWNER_ADMIN.has(data.role) || OWNER_ADMIN.has(existing.role))) {
      return { success: false, error: roleChangeErrorMessage({ message: "owner_required" }) };
    }

    // Profile columns only: `role`, `tenant_id` and `user_id` are not writable by `authenticated` (000019).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatePayload: Record<string, any> = {
      full_name: data.full_name.trim(),
      phone: data.phone?.trim() ?? null,
      qualifications: data.qualifications?.trim() ?? null,
      medical_council_reg_no: data.medical_council_reg_no?.trim() ?? null,
      default_specialty: data.default_specialty ?? "general_physician",
    };

    // AR-L4 (enforced in the database by memberships_profile_update_guard, 000021): medical credentials are changed
    // only by the member or an owner; an owner's or admin's name and phone likewise. Unchanged values are left out of
    // the payload; a submitted change is refused with a clear message.
    if (!isSelf && !isOwner) {
      const newQual = updatePayload.qualifications as string | null;
      const newReg = updatePayload.medical_council_reg_no as string | null;
      if (
        (newQual && !sameText(newQual, existing.qualifications)) ||
        (newReg && !sameText(newReg, existing.medical_council_reg_no))
      ) {
        return {
          success: false,
          error: "Only the clinic owner or the staff member can change medical credentials.",
        };
      }
      delete updatePayload.qualifications;
      delete updatePayload.medical_council_reg_no;

      if (OWNER_ADMIN.has(existing.role)) {
        if (
          !sameText(updatePayload.full_name, existing.full_name) ||
          !sameText(updatePayload.phone, existing.phone)
        ) {
          return { success: false, error: "Only a clinic owner can edit an owner's or admin's profile." };
        }
        delete updatePayload.full_name;
        delete updatePayload.phone;
      }
    }

    if (data.default_slot_duration_minutes !== undefined) {
      updatePayload.default_slot_duration_minutes = data.default_slot_duration_minutes;
    }
    if (data.availability_schedule !== undefined) {
      updatePayload.availability_schedule = data.availability_schedule;
    }

    // The profile update runs first: it is reversible and the more likely to fail (validation, RLS), so a failure
    // here leaves the role unchanged (IR-L3).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateErr } = await (supabase.from("memberships") as any)
      .update(updatePayload)
      .eq("id", data.membership_id)
      .eq("tenant_id", session.tenantId)
      .select("*")
      .single();

    if (updateErr || !updated) {
      console.error("[updateStaffMember] Error updating staff member:", updateErr?.code ?? "no_row");
      return { success: false, error: "Failed to update staff member in database." };
    }

    // Role changes go only through the change_member_role RPC (P0-02): it re-derives the tenant from the target row,
    // allows owner/admin grants to owners only, enforces the last-owner guard under a lock and audits the change.
    let membership = updated as Membership;
    if (roleChanging) {
      const { data: roleRow, error: roleErr } = await (
        supabase.rpc as unknown as (
          name: "change_member_role",
          args: { p_membership_id: string; p_role: string }
        ) => Promise<{ data: Membership | null; error: { message?: string; code?: string } | null }>
      )("change_member_role", { p_membership_id: data.membership_id, p_role: data.role });

      if (roleErr) {
        return {
          success: false,
          error: `Profile details were saved, but the role was not changed: ${roleChangeErrorMessage(roleErr)}`,
        };
      }
      if (roleRow) membership = roleRow;
    }

    await recordAudit(ctx, {
      action: "staff.member.update",
      entityType: "membership",
      entityId: data.membership_id,
      metadata: {
        target_user_id: existing.user_id,
        role: data.role,
        full_name: data.full_name,
      },
    });

    return { success: true, membership };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to update staff member.", "features/settings/service updateStaffMember"),
    };
  }
}

export type UpdateDoctorAvailabilityInput = { membership_id: string; availability_schedule: unknown };
export type UpdateDoctorAvailabilityResult =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { success: true; availability_schedule: any }
  | { success: false; error: string };

/**
 * Updates a doctor's weekly availability. Any member may update their own; updating another member's schedule
 * requires the owner or admin role (T-03.3-03).
 */
export async function updateDoctorAvailability(
  ctx: ServiceContext,
  input: UpdateDoctorAvailabilityInput
): Promise<UpdateDoctorAvailabilityResult> {
  const supabase = ctx.db;

  try {
    const session = ctx;

    const parseResult = doctorWeeklyScheduleSchema.safeParse(input?.availability_schedule);
    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error.issues[0]?.message || "Invalid availability schedule data",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: targetMember, error: fetchErr } = await (supabase.from("memberships") as any)
      .select("id, user_id, tenant_id, role")
      .eq("id", input.membership_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (fetchErr || !targetMember) {
      return { success: false, error: "Staff member not found or access denied." };
    }

    // T-03.3-03: Authorization check (the caller's role comes from the session membership)
    if (targetMember.user_id !== session.userId && !canManageOthers(ctx)) {
      return {
        success: false,
        error: "Only clinic admins or owners can update other doctors' schedules.",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateErr } = await (supabase.from("memberships") as any)
      .update({
        availability_schedule: parseResult.data,
      })
      .eq("id", input.membership_id)
      .eq("tenant_id", session.tenantId)
      .select("availability_schedule")
      .single();

    if (updateErr || !updated) {
      console.error("[updateDoctorAvailability] Update error:", updateErr);
      return { success: false, error: "Failed to update doctor availability." };
    }

    await recordAudit(ctx, {
      action: "staff.member.update",
      entityType: "membership",
      entityId: input.membership_id,
      metadata: {
        field: "availability_schedule",
        target_user_id: targetMember.user_id,
      },
    });

    return { success: true, availability_schedule: updated.availability_schedule };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to update doctor availability.", "features/settings/service updateDoctorAvailability"),
    };
  }
}

export type UpdateDoctorSlotDurationInput = { membership_id: string; default_slot_duration_minutes: number };
export type UpdateDoctorSlotDurationResult =
  | { success: true; default_slot_duration_minutes: number }
  | { success: false; error: string };

/**
 * Updates a doctor's default slot duration (5–120 minutes, slotDurationSchema). Any member may update their own; updating another
 * member's requires the owner or admin role.
 */
export async function updateDoctorSlotDuration(
  ctx: ServiceContext,
  input: UpdateDoctorSlotDurationInput
): Promise<UpdateDoctorSlotDurationResult> {
  const supabase = ctx.db;

  try {
    const session = ctx;

    const durationParse = slotDurationSchema.safeParse(input?.default_slot_duration_minutes);
    if (!durationParse.success) {
      return {
        success: false,
        error: `Slot duration must be between ${MIN_SLOT_DURATION_MINUTES} and ${MAX_SLOT_DURATION_MINUTES} minutes.`,
      };
    }
    const duration = durationParse.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: targetMember, error: fetchErr } = await (supabase.from("memberships") as any)
      .select("id, user_id, tenant_id, role")
      .eq("id", input.membership_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (fetchErr || !targetMember) {
      return { success: false, error: "Staff member not found or access denied." };
    }

    if (targetMember.user_id !== session.userId && !canManageOthers(ctx)) {
      return {
        success: false,
        error: "Only clinic admins or owners can update other doctors' slot duration.",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateErr } = await (supabase.from("memberships") as any)
      .update({
        default_slot_duration_minutes: duration,
      })
      .eq("id", input.membership_id)
      .eq("tenant_id", session.tenantId)
      .select("default_slot_duration_minutes")
      .single();

    if (updateErr || !updated) {
      console.error("[updateDoctorSlotDuration] Update error:", updateErr);
      return { success: false, error: "Failed to update slot duration." };
    }

    return {
      success: true,
      default_slot_duration_minutes: updated.default_slot_duration_minutes,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to update slot duration.", "features/settings/service updateDoctorSlotDuration"),
    };
  }
}

/**
 * Lists the clinic's schedule blocks, optionally only one doctor's plus clinic-wide ones (any clinic member).
 * A doctor id that is not a uuid yields an empty list: it never reaches the PostgREST filter string (R7).
 */
export async function getDoctorScheduleBlocks(ctx: ServiceContext, doctorId?: string): Promise<ScheduleBlock[]> {
  const supabase = ctx.db;

  try {
    const session = ctx;
    const filterByDoctor = Boolean(doctorId && doctorId !== "all");
    if (filterByDoctor && !isUuid(doctorId)) {
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from("schedule_blocks") as any)
      .select("*")
      .eq("tenant_id", session.tenantId)
      .order("start_time", { ascending: true });

    if (filterByDoctor) {
      query = query.or(`doctor_id.eq.${doctorId},doctor_id.is.null`);
    }

    const { data, error } = await query;
    if (error || !data) {
      console.error("[getDoctorScheduleBlocks] Error:", error);
      return [];
    }

    return data as ScheduleBlock[];
  } catch (err) {
    console.error("[getDoctorScheduleBlocks] Unexpected error:", err);
    return [];
  }
}
