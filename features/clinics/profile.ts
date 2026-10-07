"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { Tenant } from "@/lib/db/types";

import { ALLOWED_SPECIALTIES } from "./constants";

const updateProfileSchema = z.object({
  name: z.string().min(2, "Clinic name must be at least 2 characters."),
  address: z.string().optional().nullable(),
  specialties: z.array(z.string()).default([]),
  timezone: z.string().default("Asia/Kolkata"),
  working_hours: z.record(
    z.object({
      open: z.string(),
      close: z.string(),
      closed: z.boolean().optional(),
    })
  ).default({}),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export async function getClinicProfile(): Promise<Tenant | null> {
  const supabase = await createClient();
  const session = await requirePermission(supabase, "clinic:view");

  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", session.tenantId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Tenant;
}

export type UpdateProfileResult =
  | { success: true; tenant: Tenant }
  | { success: false; error: string };

export async function updateClinicProfile(input: UpdateProfileInput): Promise<UpdateProfileResult> {
  const parseResult = updateProfileSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();

  try {
    const session = await requirePermission(supabase, "clinic:manage");

    const { data, error } = await (supabase.from("tenants") as any)
      .update({
        name: parseResult.data.name.trim(),
        address: parseResult.data.address?.trim() ?? null,
        specialties: parseResult.data.specialties,
        timezone: parseResult.data.timezone,
        working_hours: parseResult.data.working_hours,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.tenantId)
      .select("*")
      .single();

    if (error || !data) {
      console.error("[features/clinics/profile] Failed to update profile:", error);
      return { success: false, error: "Unable to update clinic profile." };
    }

    return { success: true, tenant: data as Tenant };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update profile.",
    };
  }
}
