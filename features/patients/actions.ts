"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { patientSchema, PatientInput } from "./schema";
import { Patient } from "@/lib/db/types";

export type CreatePatientResult =
  | { success: true; patientId: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createPatient(input: PatientInput): Promise<CreatePatientResult> {
  const parseResult = patientSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return {
      success: false,
      error: "Please correct the highlighted errors.",
      fieldErrors,
    };
  }

  const supabase = await createClient();

  try {
    const session = await requirePermission("patients:edit");
    const data = parseResult.data;

    // 1. Insert patient under RLS
    const { data: newPatient, error: insertError } = await (supabase.from("patients") as any)
      .insert({
        tenant_id: session.tenantId,
        full_name: data.full_name,
        phone: data.phone,
        date_of_birth: data.date_of_birth,
        sex: data.sex || null,
        address: data.address || null,
        abha_id: data.abha_id,
        created_by: session.userId,
      })
      .select("id")
      .single();

    if (insertError || !newPatient) {
      console.error("[features/patients/actions] Failed to insert patient:", insertError);
      return { success: false, error: "Failed to register patient in clinic database." };
    }

    // 2. Audit record creation
    await recordAudit({
      action: "patient.create",
      entityType: "patient",
      entityId: newPatient.id,
      metadata: {
        fields_changed: ["created"],
      },
    });

    revalidatePath("/patients");
    return { success: true, patientId: newPatient.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to register patient.",
    };
  }
}

export type UpdatePatientResult =
  | { success: true; patient: Patient }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updatePatient(
  patientId: string,
  input: PatientInput
): Promise<UpdatePatientResult> {
  const parseResult = patientSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      success: false,
      error: "Please correct the highlighted errors.",
    };
  }

  const supabase = await createClient();

  try {
    const session = await requirePermission("patients:edit");
    const data = parseResult.data;

    // 1. Read existing row to track changed fields
    const { data: existing, error: readError } = await (supabase.from("patients") as any)
      .select("*")
      .eq("id", patientId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (readError || !existing) {
      return { success: false, error: "Patient record not found." };
    }

    const changedFields: string[] = [];
    if (existing.full_name !== data.full_name) changedFields.push("full_name");
    if (existing.phone !== data.phone) changedFields.push("phone");
    if (existing.date_of_birth !== data.date_of_birth) changedFields.push("date_of_birth");
    if (existing.sex !== data.sex) changedFields.push("sex");
    if (existing.abha_id !== data.abha_id) changedFields.push("abha_id");

    // 2. Update under RLS
    const { data: updated, error: updateError } = await (supabase.from("patients") as any)
      .update({
        full_name: data.full_name,
        phone: data.phone,
        date_of_birth: data.date_of_birth,
        sex: data.sex || null,
        address: data.address || null,
        abha_id: data.abha_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", patientId)
      .eq("tenant_id", session.tenantId)
      .select("*")
      .single();

    if (updateError || !updated) {
      return { success: false, error: "Failed to update patient record." };
    }

    // 3. Record audit with only changed field names (no PII/clinical values)
    await recordAudit({
      action: "patient.update",
      entityType: "patient",
      entityId: patientId,
      metadata: {
        fields_changed: changedFields.length > 0 ? changedFields : ["no_changes"],
      },
    });

    revalidatePath(`/patients/${patientId}`);
    revalidatePath("/patients");
    return { success: true, patient: updated as Patient };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update patient.",
    };
  }
}

export async function getPatient(patientId: string): Promise<Patient | null> {
  const supabase = await createClient();
  const session = await requirePermission("patients:view");

  const { data, error } = await (supabase.from("patients") as any)
    .select("*")
    .eq("id", patientId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (error || !data) {
    return null;
  }

  // Record view access in audit log
  await recordAudit({
    action: "patient.view",
    entityType: "patient",
    entityId: patientId,
  });

  return data as Patient;
}
