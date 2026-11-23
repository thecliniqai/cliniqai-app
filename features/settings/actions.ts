"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { forgetSessionContext, getActiveMembership, getSessionClaims } from "@/lib/auth/tenant";
import { resolveServiceContext } from "@/lib/auth/context";
import { Membership, ScheduleBlock } from "@/lib/db/types";
import { ClinicSettingsInput, StatutorySettingsInput, RxPrintSettingsInput, UserProfileInput, StaffEditInput } from "./schema";
import * as settingsService from "./service";
import * as schedulingService from "@/features/visits/scheduling-service";
import type {
  UpdateClinicSettingsResult,
  UpdateStatutorySettingsResult,
  UpdateRxPrintSettingsResult,
  UpdateUserProfileResult,
  UpdateStaffMemberResult,
  UpdateDoctorAvailabilityInput,
  UpdateDoctorAvailabilityResult,
  UpdateDoctorSlotDurationInput,
  UpdateDoctorSlotDurationResult,
} from "./service";

export type {
  UpdateClinicSettingsResult,
  UpdateStatutorySettingsResult,
  UpdateRxPrintSettingsResult,
  UpdateUserProfileResult,
  UpdateStaffMemberResult,
  UpdateDoctorAvailabilityInput,
  UpdateDoctorAvailabilityResult,
  UpdateDoctorSlotDurationInput,
  UpdateDoctorSlotDurationResult,
} from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.

function revalidate(...paths: string[]) {
  try {
    for (const path of paths) revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

export async function updateClinicSettings(input: ClinicSettingsInput): Promise<UpdateClinicSettingsResult> {
  const resolved = await resolveServiceContext("clinic:manage", "full", { sensitive: "clinic_settings.update" });
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await settingsService.updateClinicSettings(resolved.ctx, input);
  // V2-09d: the clinic's name or zone may have changed: the shell re-reads them (and the session context) in the render that follows.
  if (result.success) await forgetSessionContext();
  if (result.success) revalidate("/settings/clinic", "/profile", "/staff", "/today");
  return result;
}

/**
 * Persists official statutory registration numbers (CEA, SMC, GSTIN, Drug License)
 * to public.tenants with full compliance audit logging under DPDP/NMC regulations (D-16).
 */
export async function updateStatutorySettings(input: StatutorySettingsInput): Promise<UpdateStatutorySettingsResult> {
  const resolved = await resolveServiceContext("clinic:manage", "full", { sensitive: "clinic_settings.statutory" });
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await settingsService.updateStatutorySettings(resolved.ctx, input);
  if (result.success) revalidate("/settings/clinic");
  return result;
}

/**
 * "Prescription printing" (V2-09c 09C-04, R-12): the clinic's default paper size and letterhead mode and the margins of its pre-printed stationery.
 * `clinic:manage`; the tenant is the session's.
 */
export async function updateRxPrintSettings(input: RxPrintSettingsInput): Promise<UpdateRxPrintSettingsResult> {
  const resolved = await resolveServiceContext("clinic:manage", "full", { sensitive: "clinic_settings.rx_print" });
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await settingsService.updateRxPrintSettings(resolved.ctx, input);
  if (result.success) revalidate("/settings/clinic");
  return result;
}

export async function updateUserProfile(input: UserProfileInput): Promise<UpdateUserProfileResult> {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await settingsService.updateUserProfile(resolved.ctx, input);
  if (result.success) revalidate("/profile", "/settings/clinic", "/staff", "/today");
  return result;
}

export async function updateStaffMember(input: StaffEditInput): Promise<UpdateStaffMemberResult> {
  const resolved = await resolveServiceContext("clinic:manage", "full", { sensitive: "staff.role_edit" });
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await settingsService.updateStaffMember(resolved.ctx, input);
  // V2-09d: a role may have changed (the caller's own included): this device's session context is read again.
  if (result.success) await forgetSessionContext();
  if (result.success) revalidate("/staff", "/settings/clinic", "/today");
  return result;
}

export async function getMyProfile() {
  const supabase = await createClient();
  const membership = await getActiveMembership();
  // V2-09d: the verified session claims (no Auth round trip): email, phone and metadata are in the access token.
  const claims = await getSessionClaims();
  const metadata = claims.userMetadata as { full_name?: unknown; phone?: unknown };
  const user = {
    id: claims.userId,
    email: claims.email,
    phone: claims.phone,
    user_metadata: {
      full_name: typeof metadata.full_name === "string" ? metadata.full_name : undefined,
      phone: typeof metadata.phone === "string" ? metadata.phone : undefined,
    },
  };

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

export async function updateDoctorAvailability(
  input: UpdateDoctorAvailabilityInput
): Promise<UpdateDoctorAvailabilityResult> {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await settingsService.updateDoctorAvailability(resolved.ctx, input);
  if (result.success) revalidate("/profile", "/staff", "/schedule");
  return result;
}

export async function updateDoctorSlotDuration(
  input: UpdateDoctorSlotDurationInput
): Promise<UpdateDoctorSlotDurationResult> {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await settingsService.updateDoctorSlotDuration(resolved.ctx, input);
  if (result.success) revalidate("/profile", "/staff", "/schedule");
  return result;
}

/** An unauthenticated caller gets an empty list, as before. */
export async function getDoctorScheduleBlocks(doctorId?: string): Promise<ScheduleBlock[]> {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return [];
  return settingsService.getDoctorScheduleBlocks(resolved.ctx, doctorId);
}

/** Deletes a schedule block from the profile screen (same rules as the calendar's delete). */
export async function deleteDoctorScheduleBlock(blockId: string): Promise<{ success: boolean; error?: string }> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await schedulingService.deleteScheduleBlock(resolved.ctx, blockId);
  if (result.success) revalidate("/schedule");
  return result;
}
