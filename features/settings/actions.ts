"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { Tenant, Database } from "@/lib/db/types";
import { clinicSettingsSchema, ClinicSettingsInput } from "./schema";
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
          ],
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/settings/clinic");
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
