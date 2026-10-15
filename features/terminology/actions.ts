"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { Database } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  searchDiagnosesSchema,
  SearchDiagnosesInput,
  DiagnosisSearchResult,
  addConsultationDiagnosisSchema,
  AddConsultationDiagnosisInput,
  updateDiagnosisNoteSchema,
  ConsultationDiagnosisItem,
} from "./schema";

export type SearchDiagnosesResult =
  | { success: true; results: DiagnosisSearchResult[] }
  | { success: false; error: string };

/**
 * Searches the curated Indian OPD terminology catalog (~1,550 conditions)
 * merged with the active doctor's previously entered custom diagnoses.
 */
export async function searchDiagnoses(
  input: SearchDiagnosesInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<SearchDiagnosesResult> {
  const parseResult = searchDiagnosesSchema.safeParse(input);
  if (!parseResult.success) {
    return { success: false, error: "Invalid search query." };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:view"));
    const { query, specialty, limit } = parseResult.data;
    const cleanQuery = query.trim();

    // 1. Fetch matching doctor custom diagnoses for this tenant & doctor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: customMatches } = await (supabase.from("doctor_custom_diagnoses") as any)
      .select("id, diagnosis_name, specialty, use_count")
      .eq("tenant_id", session.tenantId)
      .eq("doctor_id", session.userId)
      .ilike("diagnosis_name", `%${cleanQuery}%`)
      .order("use_count", { ascending: false })
      .limit(10);

    // 2. Fetch matching central OPD diagnoses
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let centralQuery = (supabase.from("opd_diagnoses") as any)
      .select("id, name, icd11_code, snomed_concept_id, category, specialties, is_chronic")
      .ilike("name", `%${cleanQuery}%`)
      .limit(limit);

    if (specialty) {
      centralQuery = centralQuery.contains("specialties", [specialty]);
    }

    const { data: centralMatches, error: centralErr } = await centralQuery;
    if (centralErr) {
      console.error("[features/terminology/actions] Central diagnosis search error:", centralErr);
    }

    // 3. Merge & deduplicate, boosting custom/favorites to top
    const results: DiagnosisSearchResult[] = [];
    const seenNames = new Set<string>();

    if (customMatches) {
      for (const cm of customMatches) {
        const lower = cm.diagnosis_name.toLowerCase();
        if (!seenNames.has(lower)) {
          seenNames.add(lower);
          results.push({
            id: cm.id,
            name: cm.diagnosis_name,
            icd11_code: null,
            snomed_concept_id: null,
            category: "Custom Doctor Diagnosis",
            specialties: cm.specialty ? [cm.specialty] : [],
            is_chronic: false,
            is_custom: true,
            use_count: cm.use_count,
          });
        }
      }
    }

    if (centralMatches) {
      for (const cm of centralMatches) {
        const lower = cm.name.toLowerCase();
        if (!seenNames.has(lower)) {
          seenNames.add(lower);
          results.push({
            id: cm.id,
            name: cm.name,
            icd11_code: cm.icd11_code ?? null,
            snomed_concept_id: cm.snomed_concept_id ?? null,
            category: cm.category ?? null,
            specialties: cm.specialties ?? [],
            is_chronic: cm.is_chronic ?? false,
            is_custom: false,
          });
        }
      }
    }

    return { success: true, results };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to search diagnoses.",
    };
  }
}

export type AddConsultationDiagnosisResult =
  | { success: true; diagnosisId: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Adds a diagnosis to an active consultation visit.
 * If marked as custom, upserts to doctor_custom_diagnoses for future autocomplete.
 * If marked as chronic, updates the patient's persistent profile chronic_conditions list.
 */
export async function addConsultationDiagnosis(
  input: AddConsultationDiagnosisInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<AddConsultationDiagnosisResult> {
  const parseResult = addConsultationDiagnosisSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return {
      success: false,
      error: "Validation failed. Please correct the highlighted errors.",
      fieldErrors,
    };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));
    const data = parseResult.data;

    // 1. Verify visit exists and belongs to this tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visit, error: visitErr } = await (supabase.from("visits") as any)
      .select("id, patient_id")
      .eq("id", data.visit_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (visitErr || !visit) {
      return { success: false, error: "Visit not found or access denied." };
    }

    // 2. Insert into consultation_diagnoses
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: insertErr } = await (supabase.from("consultation_diagnoses") as any)
      .insert({
        tenant_id: session.tenantId,
        visit_id: data.visit_id,
        patient_id: data.patient_id,
        diagnosis_name: data.diagnosis_name,
        snomed_concept_id: data.snomed_concept_id || null,
        icd11_code: data.icd11_code || null,
        is_custom: data.is_custom,
        is_chronic: data.is_chronic,
        notes: data.notes || null,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("[features/terminology/actions] Insert error:", insertErr);
      return { success: false, error: "Failed to record consultation diagnosis." };
    }

    // 3. If custom diagnosis, upsert to doctor_custom_diagnoses for future autocomplete
    if (data.is_custom) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("doctor_custom_diagnoses") as any).upsert(
        {
          tenant_id: session.tenantId,
          doctor_id: session.userId,
          diagnosis_name: data.diagnosis_name,
          use_count: 1,
        },
        { onConflict: "tenant_id,doctor_id,diagnosis_name" }
      );
    }

    // 4. If chronic condition, sync to patient's long-term profile
    if (data.is_chronic) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: patientRow } = await (supabase.from("patients") as any)
        .select("chronic_conditions")
        .eq("id", data.patient_id)
        .eq("tenant_id", session.tenantId)
        .single();

      const existingConditions: string[] = patientRow?.chronic_conditions ?? [];
      if (!existingConditions.includes(data.diagnosis_name)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from("patients") as any)
          .update({
            chronic_conditions: [...existingConditions, data.diagnosis_name],
            updated_at: new Date().toISOString(),
          })
          .eq("id", data.patient_id)
          .eq("tenant_id", session.tenantId);
      }
    }

    // 5. Record audit trail
    await recordAudit(
      {
        action: "diagnosis.add",
        entityType: "diagnosis",
        entityId: inserted.id,
        metadata: {
          is_custom: data.is_custom,
          is_chronic: data.is_chronic,
        },
      },
      clientOverride,
      session
    );

    revalidatePath(`/consultation/${data.visit_id}`);
    return { success: true, diagnosisId: inserted.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to add diagnosis.",
    };
  }
}

export type RemoveConsultationDiagnosisResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Removes a diagnosis from a consultation visit.
 * If it was marked as chronic, optionally removes it from the patient's chronic_conditions array.
 */
export async function removeConsultationDiagnosis(
  diagnosisId: string,
  visitId: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<RemoveConsultationDiagnosisResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));

    // 1. Fetch diagnosis row to check if chronic & get patient info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: diagRow, error: fetchErr } = await (supabase.from("consultation_diagnoses") as any)
      .select("id, patient_id, diagnosis_name, is_chronic")
      .eq("id", diagnosisId)
      .eq("tenant_id", session.tenantId)
      .eq("visit_id", visitId)
      .single();

    if (fetchErr || !diagRow) {
      return { success: false, error: "Diagnosis record not found." };
    }

    // 2. Delete diagnosis row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: deleteErr } = await (supabase.from("consultation_diagnoses") as any)
      .delete()
      .eq("id", diagnosisId)
      .eq("tenant_id", session.tenantId);

    if (deleteErr) {
      return { success: false, error: "Failed to delete diagnosis." };
    }

    // 3. If chronic, remove from patient profile if present
    if (diagRow.is_chronic) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: patientRow } = await (supabase.from("patients") as any)
        .select("chronic_conditions")
        .eq("id", diagRow.patient_id)
        .eq("tenant_id", session.tenantId)
        .single();

      if (patientRow?.chronic_conditions) {
        const updated = (patientRow.chronic_conditions as string[]).filter(
          (c) => c !== diagRow.diagnosis_name
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from("patients") as any)
          .update({
            chronic_conditions: updated,
            updated_at: new Date().toISOString(),
          })
          .eq("id", diagRow.patient_id)
          .eq("tenant_id", session.tenantId);
      }
    }

    // 4. Record audit trail
    await recordAudit(
      {
        action: "diagnosis.remove",
        entityType: "diagnosis",
        entityId: diagnosisId,
      },
      clientOverride,
      session
    );

    revalidatePath(`/consultation/${visitId}`);
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to remove diagnosis.",
    };
  }
}

export type UpdateDiagnosisNoteResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Updates an optional inline clinical note for a consultation diagnosis.
 */
export async function updateDiagnosisNote(
  diagnosisId: string,
  visitId: string,
  notes: string | null,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<UpdateDiagnosisNoteResult> {
  const parseResult = updateDiagnosisNoteSchema.safeParse({ diagnosis_id: diagnosisId, visit_id: visitId, notes });
  if (!parseResult.success) {
    return { success: false, error: "Note exceeds 500 characters." };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (supabase.from("consultation_diagnoses") as any)
      .update({ notes: notes?.trim() || null })
      .eq("id", diagnosisId)
      .eq("tenant_id", session.tenantId)
      .eq("visit_id", visitId);

    if (updateErr) {
      return { success: false, error: "Failed to update diagnosis note." };
    }

    await recordAudit(
      {
        action: "diagnosis.update_note",
        entityType: "diagnosis",
        entityId: diagnosisId,
      },
      clientOverride,
      session
    );

    revalidatePath(`/consultation/${visitId}`);
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update diagnosis note.",
    };
  }
}

export type GetVisitDiagnosesResult =
  | { success: true; diagnoses: ConsultationDiagnosisItem[] }
  | { success: false; error: string };

/**
 * Fetches all diagnoses recorded for a specific visit.
 */
export async function getVisitDiagnoses(
  visitId: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GetVisitDiagnosesResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:view"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (supabase.from("consultation_diagnoses") as any)
      .select("id, visit_id, patient_id, diagnosis_name, snomed_concept_id, icd11_code, is_custom, is_chronic, notes, created_at")
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: true });

    if (error) {
      return { success: false, error: "Failed to fetch visit diagnoses." };
    }

    return { success: true, diagnoses: rows ?? [] };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load diagnoses.",
    };
  }
}
