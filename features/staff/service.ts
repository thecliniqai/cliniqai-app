import "server-only";

import type { ServiceContext } from "@/lib/auth/context";
import { formatDoctorDisplayName, formatStaffDisplayName } from "./formatters";

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

export async function getTenantDoctorDirectory(ctx: ServiceContext): Promise<TenantDoctorInfo[]> {
  try {
    const supabase = ctx.db as any;
    const session = ctx;

    const { data: tenant } = await (supabase.from("tenants") as any)
      .select("owner_is_practicing_doctor")
      .eq("id", session.tenantId)
      .single();

    const { data: memberRows, error } = await (supabase.from("memberships") as any)
      .select(
        "id, user_id, tenant_id, role, full_name, default_specialty, default_slot_duration_minutes, availability_schedule, qualifications, medical_council_reg_no"
      )
      .eq("tenant_id", session.tenantId);

    if (error || !memberRows) {
      console.error(
        "[getTenantDoctorDirectory] Error fetching members:",
        error
          ? { message: error.message, code: error.code, details: error.details, hint: error.hint }
          : "No rows returned"
      );
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

export async function getTenantStaffDirectory(ctx: ServiceContext): Promise<TenantStaffInfo[]> {
  try {
    const supabase = ctx.db as any;
    const session = ctx;

    const { data: memberRows, error } = await (supabase.from("memberships") as any)
      .select("id, user_id, tenant_id, role, full_name, default_specialty")
      .eq("tenant_id", session.tenantId);

    if (error || !memberRows) {
      console.error(
        "[getTenantStaffDirectory] Error fetching members:",
        error
          ? { message: error.message, code: error.code, details: error.details, hint: error.hint }
          : "No rows returned"
      );
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

export async function getTenantDoctorMap(ctx: ServiceContext): Promise<Record<string, string>> {
  const doctors = await getTenantDoctorDirectory(ctx);
  const map: Record<string, string> = {};
  for (const doc of doctors) {
    map[doc.id] = doc.name;
  }
  return map;
}
