import { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase/admin";
import { Database } from "@/lib/db/types";

export interface DoctorValidationResult {
  valid: boolean;
  doctorName?: string;
  error?: string;
}

/**
 * Validates doctor assignment for clinical mutations (D-05, T-06-05).
 * Queries public.memberships to verify:
 * 1. user_id matches doctorId
 * 2. tenant_id matches the active clinic session
 * 3. role is strictly 'doctor' or 'owner'
 *
 * Non-clinical roles (nurse, receptionist, admin without doctor credential)
 * or users from other clinics are rejected with descriptive 403-appropriate errors.
 */
export async function validateDoctorAssignment(
  tenantId: string,
  doctorId: string,
  clientOverride?: SupabaseClient<Database>
): Promise<DoctorValidationResult> {
  if (!doctorId || typeof doctorId !== "string" || !doctorId.trim()) {
    return {
      valid: false,
      error: "Field 'doctor_id' is required.",
    };
  }

  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    return {
      valid: false,
      error: "Tenant ID is required.",
    };
  }

  const supabase = clientOverride || getAdminClient();

  const { data: membership, error } = await (supabase.from("memberships") as any)
    .select("id, role, user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", doctorId.trim())
    .maybeSingle();

  if (error || !membership) {
    return {
      valid: false,
      error: "Assigned doctor not found in the active clinic.",
    };
  }

  if (!["doctor", "owner"].includes(membership.role)) {
    return {
      valid: false,
      error: `User with role '${membership.role}' cannot be assigned as a clinician. Clinical mutations require 'doctor' or 'owner' role.`,
    };
  }

  return {
    valid: true,
  };
}
