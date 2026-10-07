"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const createClinicSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Clinic name must be at least 2 characters")
    .max(100, "Clinic name must be under 100 characters"),
});

export type CreateClinicResult =
  | { success: true; tenantId: string }
  | { success: false; error: string };

/**
 * Creates a clinic tenant and the caller's owner membership atomically in the DB.
 */
export async function createClinic(formData: FormData): Promise<CreateClinicResult> {
  const rawName = formData.get("name");
  const parsed = createClinicSchema.safeParse({ name: rawName });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid clinic name",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to create a clinic",
    };
  }

  // Call the atomic database security-definer function
  const { data: tenantId, error: dbError } = await (
    supabase.rpc as unknown as (
      name: string,
      args: { p_name: string }
    ) => Promise<{ data: string | null; error: { message: string } | null }>
  )("create_clinic_with_owner", {
    p_name: parsed.data.name,
  });

  if (dbError) {
    return {
      success: false,
      error: dbError.message.includes("unique")
        ? "Clinic creation conflict. Please try again."
        : dbError.message,
    };
  }

  return {
    success: true,
    tenantId: tenantId as string,
  };
}
