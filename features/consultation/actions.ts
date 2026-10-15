"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { Database } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  saveConsultationDraftSchema,
  SaveConsultationDraftInput,
  Vitals,
  ChiefComplaintItem,
} from "./schema";

export type SaveConsultationDraftResult =
  | { success: true; visitId: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Saves or auto-saves an in-progress consultation draft.
 * Updates the SOAP clinical sections, specialty data, and creates or updates follow-ups.
 */
export async function saveConsultationDraft(
  input: SaveConsultationDraftInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<SaveConsultationDraftResult> {
  const parseResult = saveConsultationDraftSchema.safeParse(input);
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
    const { data: visit, error: visitFetchErr } = await (
      supabase.from("visits") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              single: () => Promise<{
                data: { id: string; patient_id: string; status: string } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      }
    )
      .select("id, patient_id, status")
      .eq("id", data.visit_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (visitFetchErr || !visit) {
      return {
        success: false,
        error: "Visit record not found or access denied.",
      };
    }

    // 2. Determine new status: if waiting, transition to in_consultation
    const updatedStatus = visit.status === "waiting" ? "in_consultation" : undefined;

    // 3. Update the visit row with draft SOAP clinical data
    const updatePayload: Record<string, unknown> = {
      vitals: data.vitals ?? {},
      chief_complaints: data.chief_complaints ?? [],
      clinical_notes: data.clinical_notes ?? null,
      specialty: data.specialty,
      specialty_data: data.specialty_data ?? {},
      investigations_advised: data.investigations_advised ?? [],
      advice: data.advice ?? [],
      updated_at: new Date().toISOString(),
    };

    if (updatedStatus) {
      updatePayload.status = updatedStatus;
    }

    const { error: updateErr } = await (
      supabase.from("visits") as unknown as {
        update: (vals: Record<string, unknown>) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
          };
        };
      }
    )
      .update(updatePayload)
      .eq("id", data.visit_id)
      .eq("tenant_id", session.tenantId);

    if (updateErr) {
      return { success: false, error: `Failed to save draft: ${updateErr.message}` };
    }

    // 4. Handle follow-up record if provided
    if (data.follow_up?.follow_up_date) {
      await recordFollowUp(
        {
          visitId: data.visit_id,
          patientId: visit.patient_id,
          followUpDate: data.follow_up.follow_up_date,
          notes: data.follow_up.notes ?? undefined,
        },
        supabase as any,
        session
      );
    }

    // 5. Record audit log
    await recordAudit(
      {
        action: "consultation.draft_save",
        entityType: "visit",
        entityId: data.visit_id,
        metadata: {
          specialty: data.specialty,
          fields_changed: [
            "vitals",
            "chief_complaints",
            "clinical_notes",
            "specialty_data",
            "advice",
          ],
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath(`/consultation/${data.visit_id}`);
      revalidatePath("/queue");
    } catch {
      // Testing environment safely ignores revalidation
    }

    return { success: true, visitId: data.visit_id };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred saving draft.",
    };
  }
}

export interface RecordFollowUpInput {
  visitId: string;
  patientId: string;
  doctorId?: string;
  followUpDate: string;
  notes?: string;
}

export type RecordFollowUpResult =
  | { success: true; followUpId: string }
  | { success: false; error: string };

/**
 * Persists a follow-up appointment date for the patient.
 */
export async function recordFollowUp(
  input: RecordFollowUpInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<RecordFollowUpResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));

    // Check if an existing follow-up is already tied to this visit
    const { data: existing } = await (
      supabase.from("follow_ups") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: { id: string } | null }>;
            };
          };
        };
      }
    )
      .select("id")
      .eq("tenant_id", session.tenantId)
      .eq("visit_id", input.visitId)
      .maybeSingle();

    let followUpId: string;

    if (existing?.id) {
      // Update existing follow-up
      followUpId = existing.id;
      const { error: updateErr } = await (
        supabase.from("follow_ups") as unknown as {
          update: (vals: Record<string, unknown>) => {
            eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
          };
        }
      )
        .update({
          follow_up_date: input.followUpDate,
          notes: input.notes ?? null,
        })
        .eq("id", followUpId);

      if (updateErr) throw new Error(updateErr.message);
    } else {
      // Insert new follow-up
      const { data: inserted, error: insertErr } = await (
        supabase.from("follow_ups") as unknown as {
          insert: (row: Record<string, unknown>) => {
            select: (cols: string) => {
              single: () => Promise<{
                data: { id: string } | null;
                error: { message: string } | null;
              }>;
            };
          };
        }
      )
        .insert({
          tenant_id: session.tenantId,
          patient_id: input.patientId,
          visit_id: input.visitId,
          doctor_id: input.doctorId || session.userId,
          follow_up_date: input.followUpDate,
          notes: input.notes ?? null,
          status: "scheduled",
        })
        .select("id")
        .single();

      if (insertErr || !inserted) throw new Error(insertErr?.message || "Failed to create follow-up");
      followUpId = inserted.id;
    }

    await recordAudit(
      {
        action: "follow_up.record",
        entityType: "follow_up",
        entityId: followUpId,
        metadata: {
          follow_up_date: input.followUpDate,
        },
      },
      clientOverride,
      session
    );

    return { success: true, followUpId };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to record follow-up.",
    };
  }
}

export interface PastVisitEncounter {
  visitId: string;
  date: string;
  status: string;
  specialty: string;
  vitals?: Vitals | null;
  chiefComplaints: ChiefComplaintItem[];
  clinicalNotes?: string | null;
  advice: string[];
  diagnoses: {
    id: string;
    diagnosis_name: string;
    icd11_code?: string | null;
    snomed_concept_id?: string | null;
    is_chronic: boolean;
  }[];
  prescriptions: {
    id: string;
    version: number;
    items: {
      id: string;
      medicine_name: string;
      generic_name?: string | null;
      dose_form?: string | null;
      dosage: string;
      timing?: string | null;
      duration: string;
      special_instructions?: string | null;
    }[];
  }[];
}

/**
 * Loads longitudinal patient consultation history for the history slide-over drawer.
 */
export async function getPatientConsultationHistory(
  patientId: string,
  currentVisitId?: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: true; encounters: PastVisitEncounter[] } | { success: false; error: string }> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:view"));

    // 1. Fetch visits for this patient in this tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let visitQuery = (supabase as any)
      .from("visits")
      .select("id, scheduled_at, created_at, status, specialty, vitals, chief_complaints, clinical_notes, advice")
      .eq("tenant_id", session.tenantId)
      .eq("patient_id", patientId)
      .in("status", ["completed", "in_consultation"])
      .order("created_at", { ascending: false });

    if (currentVisitId) {
      visitQuery = visitQuery.neq("id", currentVisitId);
    }

    const { data: visits, error: visitsErr } = await visitQuery;
    if (visitsErr) throw new Error(visitsErr.message);

    if (!visits || visits.length === 0) {
      return { success: true, encounters: [] };
    }

    const visitIds = visits.map((v: { id: string }) => v.id);

    // 2. Fetch diagnoses for these visits
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: diagnoses, error: diagErr } = await (supabase as any)
      .from("consultation_diagnoses")
      .select("id, visit_id, diagnosis_name, icd11_code, snomed_concept_id, is_chronic")
      .in("visit_id", visitIds);

    if (diagErr) throw new Error(diagErr.message);

    // 3. Fetch prescriptions for these visits
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rxList, error: rxErr } = await (supabase as any)
      .from("prescriptions")
      .select("id, visit_id, version, status")
      .in("visit_id", visitIds)
      .eq("status", "active");

    if (rxErr) throw new Error(rxErr.message);

    const rxIds = (rxList || []).map((rx: { id: string }) => rx.id);
    let itemsByRx: Record<string, unknown[]> = {};

    if (rxIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: items, error: itemsErr } = await (supabase as any)
        .from("prescription_items")
        .select("id, prescription_id, medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, sort_order")
        .in("prescription_id", rxIds)
        .order("sort_order", { ascending: true });

      if (itemsErr) throw new Error(itemsErr.message);

      itemsByRx = (items || []).reduce((acc: Record<string, unknown[]>, item: { prescription_id: string }) => {
        acc[item.prescription_id] = acc[item.prescription_id] || [];
        acc[item.prescription_id].push(item);
        return acc;
      }, {});
    }

    // 4. Group data per visit encounter
    const encounters: PastVisitEncounter[] = visits.map((v: {
      id: string;
      created_at: string;
      scheduled_at?: string;
      status: string;
      specialty: string;
      vitals?: Vitals;
      chief_complaints?: ChiefComplaintItem[];
      clinical_notes?: string;
      advice?: string[];
    }) => {
      const vDiag = (diagnoses || []).filter((d: { visit_id: string }) => d.visit_id === v.id);
      const vRx = (rxList || [])
        .filter((r: { visit_id: string }) => r.visit_id === v.id)
        .map((r: { id: string; version: number }) => ({
          id: r.id,
          version: r.version,
          items: (itemsByRx[r.id] || []) as PastVisitEncounter["prescriptions"][0]["items"],
        }));

      return {
        visitId: v.id,
        date: v.scheduled_at || v.created_at,
        status: v.status,
        specialty: v.specialty,
        vitals: v.vitals || null,
        chiefComplaints: v.chief_complaints || [],
        clinicalNotes: v.clinical_notes || null,
        advice: v.advice || [],
        diagnoses: vDiag.map((d: { id: string; diagnosis_name: string; icd11_code?: string; snomed_concept_id?: string; is_chronic: boolean }) => ({
          id: d.id,
          diagnosis_name: d.diagnosis_name,
          icd11_code: d.icd11_code || null,
          snomed_concept_id: d.snomed_concept_id || null,
          is_chronic: d.is_chronic,
        })),
        prescriptions: vRx,
      };
    });

    return { success: true, encounters };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load patient consultation history.",
    };
  }
}
