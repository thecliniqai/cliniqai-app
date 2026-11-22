import "server-only";

import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { z } from "zod";
import { cleanQuery, expandQuery } from "./abbreviations";
import type { DiagnosisHit } from "./search";
import {
  searchDiagnosesSchema,
  SearchDiagnosesInput,
  addConsultationDiagnosisSchema,
  AddConsultationDiagnosisInput,
  updateDiagnosisNoteSchema,
  ConsultationDiagnosisItem,
} from "./schema";
import type { SubstanceHit } from "./substances";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { unaffectedRowsError } from "@/lib/db/errors";
import { clientErrorMessage } from "@/lib/errors/client-message";
import { isSealedRefusal, SIGNED_CONSULTATION_MESSAGE } from "@/features/consultation/record-state";

export type SearchDiagnosesResult =
  { success: true; results: DiagnosisHit[] } | { success: false; error: string };

const searchRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  icd11_code: z.string().nullable(),
  snomed_concept_id: z.string().nullable(),
  is_chronic: z.boolean().nullable(),
  is_custom: z.boolean().nullable(),
});

/**
 * The diagnosis typeahead (V2-09b R-11, AI-07): `public.search_diagnoses` on the caller's own client (INVOKER: RLS applies) over the curated Indian OPD
 * catalogue and the calling doctor's own custom diagnoses. The tenant is the session's. With `expand` (the clinic is entitled to `assist.terminology`,
 * resolved by the caller from the session) the typed query is searched together with its abbreviation expansions (features/terminology/abbreviations.ts);
 * without it only the typed words are searched. Needs `consultations:view`. A failed read answers a fixed text, never the driver's.
 */
export async function searchDiagnoses(
  ctx: ServiceContext,
  input: SearchDiagnosesInput
): Promise<SearchDiagnosesResult> {
  const parseResult = searchDiagnosesSchema.safeParse(input);
  if (!parseResult.success) {
    return { success: false, error: "Invalid search query." };
  }

  try {
    assertPerm(ctx.role, "consultations:view");
    const { query, specialty, limit, expand } = parseResult.data;
    const terms = expand ? expandQuery(query) : [cleanQuery(query)];
    if (terms.length === 0 || terms[0].length < 2) return { success: true, results: [] };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.db as any).rpc("search_diagnoses", {
      p_tenant_id: ctx.tenantId,
      p_terms: terms,
      p_specialty: specialty ?? null,
      p_limit: limit,
    });
    if (error) throw error;
    const rows = z.array(searchRowSchema).safeParse(data ?? []);
    if (!rows.success) throw new Error("search_diagnoses returned an unexpected shape");
    return {
      success: true,
      results: rows.data.map((r) => ({
        id: r.id,
        name: r.name,
        icd11: r.icd11_code,
        snomed: r.snomed_concept_id,
        chronic: r.is_chronic ?? false,
        custom: r.is_custom ?? false,
      })),
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to search diagnoses.", "terminology.search_diagnoses.failed"),
    };
  }
}

export type AddConsultationDiagnosisResult =
  { success: true; diagnosisId: string } | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Adds a diagnosis to an active consultation visit.
 * If marked as custom, upserts to doctor_custom_diagnoses for future autocomplete.
 * If marked as chronic, updates the patient's persistent profile chronic_conditions list.
 */
export async function addConsultationDiagnosis(
  ctx: ServiceContext,
  input: AddConsultationDiagnosisInput
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

  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "consultations:edit");
    const session = ctx;
    const data = parseResult.data;

    // 1. Verify visit exists and belongs to this tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visit, error: visitErr } = await (supabase.from("visits") as any)
      .select("id, patient_id")
      .eq("id", data.visit_id)
      .eq("tenant_id", session.tenantId)
      .single();

    // The patient must be the visit's own patient: a caller-supplied patient_id could otherwise point at another
    // tenant's patient (P0-13: the FK and RLS do not check this).
    if (visitErr || !visit || visit.patient_id !== data.patient_id) {
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

    // A signed consultation's diagnoses are sealed with it (000107): a fixed text, never the driver's (V2-09a R-17).
    if (isSealedRefusal(insertErr)) return { success: false, error: SIGNED_CONSULTATION_MESSAGE };
    if (insertErr || !inserted) {
      log.error({ event: "terminology.diagnosis_insert.failed", code: errorTag(insertErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
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
    await recordAudit(ctx, {
      action: "diagnosis.add",
      entityType: "diagnosis",
      entityId: inserted.id,
      metadata: {
        is_custom: data.is_custom,
        is_chronic: data.is_chronic,
      },
    });

    return { success: true, diagnosisId: inserted.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to add diagnosis.", "terminology.add_consultation_diagnosis.failed"),
    };
  }
}

export type RemoveConsultationDiagnosisResult = { success: true } | { success: false; error: string };

/**
 * Removes a diagnosis from a consultation visit.
 * If it was marked as chronic, optionally removes it from the patient's chronic_conditions array.
 */
export async function removeConsultationDiagnosis(
  ctx: ServiceContext,
  diagnosisId: string,
  visitId: string
): Promise<RemoveConsultationDiagnosisResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "consultations:edit");
    const session = ctx;

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
    const { data: deleted, error: deleteErr } = await (supabase.from("consultation_diagnoses") as any)
      .delete()
      .eq("id", diagnosisId)
      .eq("tenant_id", session.tenantId)
      .select("id");

    if (isSealedRefusal(deleteErr)) return { success: false, error: SIGNED_CONSULTATION_MESSAGE };
    if (deleteErr) {
      return { success: false, error: "Failed to delete diagnosis." };
    }
    // RLS may filter the delete to 0 rows (V2-05 05-04): refuse the no-op before touching the patient's profile.
    const refused = unaffectedRowsError(deleted);
    if (refused) {
      log.warn({ event: "terminology.diagnosis_remove.refused", reason: "row_not_affected", requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: refused.message };
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
        const updated = (patientRow.chronic_conditions as string[]).filter((c) => c !== diagRow.diagnosis_name);
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
    await recordAudit(ctx, {
      action: "diagnosis.remove",
      entityType: "diagnosis",
      entityId: diagnosisId,
    });

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to remove diagnosis.", "terminology.remove_consultation_diagnosis.failed"),
    };
  }
}

export type UpdateDiagnosisNoteResult = { success: true } | { success: false; error: string };

/**
 * Updates an optional inline clinical note for a consultation diagnosis.
 */
export async function updateDiagnosisNote(
  ctx: ServiceContext,
  diagnosisId: string,
  visitId: string,
  notes: string | null
): Promise<UpdateDiagnosisNoteResult> {
  const parseResult = updateDiagnosisNoteSchema.safeParse({ diagnosis_id: diagnosisId, visit_id: visitId, notes });
  if (!parseResult.success) {
    return { success: false, error: "Note exceeds 500 characters." };
  }

  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "consultations:edit");
    const session = ctx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (supabase.from("consultation_diagnoses") as any)
      .update({ notes: notes?.trim() || null })
      .eq("id", diagnosisId)
      .eq("tenant_id", session.tenantId)
      .eq("visit_id", visitId);

    if (isSealedRefusal(updateErr)) return { success: false, error: SIGNED_CONSULTATION_MESSAGE };
    if (updateErr) {
      return { success: false, error: "Failed to update diagnosis note." };
    }

    await recordAudit(ctx, {
      action: "diagnosis.update_note",
      entityType: "diagnosis",
      entityId: diagnosisId,
    });

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to update diagnosis note.", "terminology.update_diagnosis_note.failed"),
    };
  }
}

export type GetVisitDiagnosesResult =
  { success: true; diagnoses: ConsultationDiagnosisItem[] } | { success: false; error: string };

/**
 * Fetches all diagnoses recorded for a specific visit.
 */
export async function getVisitDiagnoses(ctx: ServiceContext, visitId: string): Promise<GetVisitDiagnosesResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "consultations:view");
    const session = ctx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (supabase.from("consultation_diagnoses") as any)
      .select(
        "id, visit_id, patient_id, diagnosis_name, snomed_concept_id, icd11_code, is_custom, is_chronic, notes, created_at"
      )
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
      error: clientErrorMessage(err, "Failed to load diagnoses.", "terminology.get_visit_diagnoses.failed"),
    };
  }
}

export type SearchSubstancesResult = { success: true; results: SubstanceHit[] } | { success: false; error: string };

const substanceRowSchema = z.object({ id: z.string(), substance_name: z.string() });

/**
 * The allergy typeahead (V2-09c 09C-02, R-6): `public.search_substances` on the caller's own client (INVOKER: RLS applies) over the CDCI substances. The
 * query is trimmed and capped at 60 characters; `%`, `_` and `\` in it match themselves. consultations:view; the tenant is the session's. A failed read
 * answers a fixed text, never the driver's.
 */
export async function searchSubstances(ctx: ServiceContext, query: string, limit = 12): Promise<SearchSubstancesResult> {
  try {
    assertPerm(ctx.role, "consultations:view");
    const clean = cleanQuery(query).slice(0, 60).trim();
    if (clean === "") return { success: true, results: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.db as any).rpc("search_substances", { p_tenant_id: ctx.tenantId, p_query: clean, p_limit: Math.min(Math.max(Math.trunc(limit), 1), 12) });
    if (error) throw error;
    const rows = z.array(substanceRowSchema).safeParse(data ?? []);
    if (!rows.success) throw new Error("search_substances returned an unexpected shape");
    return { success: true, results: rows.data.map((r) => ({ id: r.id, name: r.substance_name })) };
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "Failed to search substances.", "terminology.search_substances.failed") };
  }
}
