import "server-only";

import { randomUUID } from "node:crypto";
import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { memberOfTenant, visitInTenant } from "@/lib/auth/tenant-refs";
import {
  saveConsultationDraftSchema,
  SaveConsultationDraftInput,
  Vitals,
  ChiefComplaintItem,
} from "./schema";
import { generateAndArchivePrescriptionPdf } from "../prescriptions/pdf/generator";
import { PrescriptionPdfPayload } from "../prescriptions/pdf/prescription-document";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { unaffectedRowsError, type DbErrorMessages } from "@/lib/db/errors";
import { callCommand } from "@/lib/commands/call-command";
import { clientRequestIdSchema } from "@/lib/commands/request-id";
import type { AppError } from "@/lib/errors/app-error";
import { z } from "zod";
import { clinicalNotesEmbed, embeddedClinicalNotes, updateClinicalNotes, withClinicalNotes } from "@/lib/db/clinical-notes";
import { resolveTimeZone, ymdOf } from "@/lib/datetime";
import { clientErrorMessage } from "@/lib/errors/client-message";

// Consultation use-cases. Tenant and actor come only from `ctx` (ADR-0005 D1); each use-case checks the permission
// its server action checked before the move, and service->service calls (saveConsultationDraft -> recordFollowUp)
// pass the same context so the callee's own check applies.

const SIGNED_CONSULTATION_MESSAGE =
  "This consultation is already signed. Reopen it for amendment to make changes.";

/** The draft was saved but the visit's follow-up could not be cleared (V2-05 05-04: never reported as done). */
const FOLLOW_UP_CLEAR_FAILED_MESSAGE = "Draft saved, but the follow-up could not be cleared. Please try again.";

/** Completed, cancelled, or signed and not reopened for amendment (reopened = signed_at set, status in_consultation). */
function isDraftLocked(visit: { status?: string | null; signed_at?: string | null }): boolean {
  if (visit.status === "completed" || visit.status === "cancelled") return true;
  return Boolean(visit.signed_at) && visit.status !== "in_consultation";
}

// The measured vitals fields; `recorded_by` / `recorded_at` are attribution, not measurements.
const VITALS_MEASUREMENTS = [
  "systolic",
  "diastolic",
  "pulse",
  "temperature",
  "spo2",
  "weight",
  "height",
  "respiratory_rate",
  "bmi",
] as const;

function sameMeasurements(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined) {
  return VITALS_MEASUREMENTS.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));
}

function hasAnyMeasurement(v: Record<string, unknown> | null | undefined) {
  return VITALS_MEASUREMENTS.some((k) => v?.[k] != null);
}

/**
 * The recorder of the vitals is never caller-chosen (V2-01 F6, SEC-02). When the draft carries the same
 * measurements as the stored row, the stored attribution is kept (a doctor saving a draft does not re-attribute a
 * nurse's reading); when the measurements change, the acting user becomes the recorder.
 */
function attributeVitals(
  ctx: ServiceContext,
  incoming: Vitals | null | undefined,
  stored: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const vitals: Record<string, unknown> = { ...(incoming ?? {}) };
  delete vitals.recorded_by;
  if (!hasAnyMeasurement(vitals)) {
    return vitals;
  }
  if (stored && sameMeasurements(vitals, stored) && typeof stored.recorded_by === "string") {
    vitals.recorded_by = stored.recorded_by;
  } else {
    vitals.recorded_by = ctx.userId;
  }
  return vitals;
}

export type SaveConsultationDraftResult =
  | { success: true; visitId: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Saves or auto-saves an in-progress consultation draft.
 * Updates the SOAP clinical sections, specialty data, and creates or updates follow-ups.
 */
export async function saveConsultationDraft(
  ctx: ServiceContext,
  input: SaveConsultationDraftInput
): Promise<SaveConsultationDraftResult> {
  try {
    assertPerm(ctx.role, "consultations:edit");
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "An unexpected error occurred saving draft.", "consultation.save_consultation_draft.failed") };
  }

  const parseResult = saveConsultationDraftSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    const issueSummary = parseResult.error.issues
      .map((i) => `${i.path.join(".") || "field"}: ${i.message}`)
      .join("; ");
    return {
      success: false,
      error: `Validation error: ${issueSummary}`,
      fieldErrors,
    };
  }

  const supabase = ctx.db;

  try {
    const data = parseResult.data;

    // 1. Verify visit exists and belongs to this tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visit, error: visitFetchErr } = await (supabase.from("visits") as any)
      .select(`id, patient_id, status, signed_at, ${clinicalNotesEmbed(["vitals"])}`)
      .eq("id", data.visit_id)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (visitFetchErr || !visit) {
      return {
        success: false,
        error: "Visit record not found or access denied.",
      };
    }

    // A signed consultation is read-only (review finding AR-Info I3; same lock as sign-off and the /api/v1 PATCH
    // guard). The one exception is a visit reopened for amendment (reopenVisitForAmendment): it keeps signed_at but is
    // back in 'in_consultation' until finalizeVisitAmendment re-signs it. The lock is repeated in the UPDATE filter.
    if (isDraftLocked(visit)) {
      return { success: false, error: SIGNED_CONSULTATION_MESSAGE };
    }

    // 2. A waiting visit is moved to in_consultation after the draft is saved, through the start_consultation command
    // (V2-08 08-04a: `status` is not a column a request path writes any more).
    const startsConsultation = visit.status === "waiting";

    // 3. Update the visit row (specialty, metadata), then the draft SOAP content in clinical_notes (V2-05 05-02a). The
    // visit write carries the sign-off lock in its filter and goes first, so a draft never lands on a visit that was
    // signed before this save began; a sign-off racing in between the two writes is the residual V2-09a closes with
    // the record-immutability rules (R-21).
    const updatePayload: Record<string, unknown> = {
      specialty: data.specialty,
      updated_at: new Date().toISOString(),
    };

    if (data.metadata) {
      updatePayload.metadata = data.metadata;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedRows, error: updateErr } = await (supabase.from("visits") as any)
      .update(updatePayload)
      .eq("id", data.visit_id)
      .eq("tenant_id", ctx.tenantId)
      .not("status", "in", "(completed,cancelled)")
      .or("signed_at.is.null,status.eq.in_consultation")
      .select("id");

    if (updateErr) {
      log.error({ event: "consultation.draft_save.failed", code: errorTag(updateErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to save draft. Please try again." };
    }
    if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
      // Signed (or closed) between the read above and this write.
      return { success: false, error: SIGNED_CONSULTATION_MESSAGE };
    }

    const { error: notesErr, raw: notesRaw } = await updateClinicalNotes(supabase, ctx.tenantId, data.visit_id, {
      vitals: attributeVitals(ctx, data.vitals, embeddedClinicalNotes(visit)?.vitals),
      chief_complaints: (data.chief_complaints ?? []) as unknown as Array<Record<string, unknown>>,
      clinical_notes: data.clinical_notes ?? null,
      specialty_data: (data.specialty_data ?? {}) as Record<string, unknown>,
      investigations_advised: data.investigations_advised ?? [],
      advice: data.advice ?? [],
    });
    if (notesErr) {
      if (notesErr.code === "FORBIDDEN") {
        log.warn({ event: "consultation.draft_save.refused", reason: notesErr.reason === "ROW_NOT_AFFECTED" ? "row_not_affected" : "forbidden", requestId: await getRequestId(), tenantId: ctx.tenantId });
        return { success: false, error: notesErr.message };
      }
      log.error({ event: "consultation.draft_save.failed", code: errorTag(notesRaw), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to save draft. Please try again." };
    }

    if (startsConsultation) {
      // Best effort: the draft is saved either way; a refusal (a role without appointments:edit, a state that moved on)
      // leaves the status as it was and the sign-off accepts a waiting visit too.
      const started = await callCommand(
        ctx,
        "start_consultation",
        { p_visit_id: data.visit_id, p_client_request_id: randomUUID() },
        z.object({ visit_id: z.string().uuid() }).passthrough(),
        {},
        { event: "consultation.draft_save_start.failed" }
      );
      if (!started.ok) {
        log.warn({ event: "consultation.draft_save_start.refused", reason: "start_refused", requestId: await getRequestId(), tenantId: ctx.tenantId });
      }
    }

    // 4. Handle follow-up record if provided
    if (data.follow_up?.follow_up_date) {
      await recordFollowUp(ctx, {
        visitId: data.visit_id,
        patientId: visit.patient_id,
        followUpDate: data.follow_up.follow_up_date,
        notes: data.follow_up.notes ?? undefined,
      });
    } else {
      // If doctor selected None / N/A, delete any existing follow_up for this visit. RLS may filter the delete
      // (V2-05 05-04): compare the deleted rows with the visible ones, so a follow-up that is still there is reported.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: visibleFollowUps, error: followUpReadErr } = await (supabase.from("follow_ups") as any)
        .select("id")
        .eq("visit_id", data.visit_id)
        .eq("tenant_id", ctx.tenantId);
      if (followUpReadErr) {
        log.error({ event: "consultation.follow_up_clear.failed", code: errorTag(followUpReadErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
        return { success: false, error: FOLLOW_UP_CLEAR_FAILED_MESSAGE };
      }
      const visibleCount = Array.isArray(visibleFollowUps) ? visibleFollowUps.length : 0;
      if (visibleCount > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: deletedFollowUps, error: followUpDeleteErr } = await (supabase.from("follow_ups") as any)
          .delete()
          .eq("visit_id", data.visit_id)
          .eq("tenant_id", ctx.tenantId)
          .select("id");
        if (followUpDeleteErr) {
          log.error({ event: "consultation.follow_up_clear.failed", code: errorTag(followUpDeleteErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
          return { success: false, error: FOLLOW_UP_CLEAR_FAILED_MESSAGE };
        }
        if (unaffectedRowsError(deletedFollowUps, visibleCount)) {
          log.warn({ event: "consultation.follow_up_clear.refused", reason: "row_not_affected", requestId: await getRequestId(), tenantId: ctx.tenantId });
          return { success: false, error: FOLLOW_UP_CLEAR_FAILED_MESSAGE };
        }
      }
    }

    // 5. Record audit log
    await recordAudit(ctx, {
      action: "consultation.draft_save",
      entityType: "visit",
      entityId: data.visit_id,
      metadata: {
        specialty: data.specialty,
        fields_changed: ["vitals", "chief_complaints", "clinical_notes", "specialty_data", "advice"],
      },
    });

    return { success: true, visitId: data.visit_id };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "An unexpected error occurred saving draft.", "consultation.save_consultation_draft.failed"),
    };
  }
}

export interface RecordFollowUpInput {
  visitId: string;
  patientId: string;
  /** Target doctor for the follow-up (defaults to the acting user). */
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
export async function recordFollowUp(ctx: ServiceContext, input: RecordFollowUpInput): Promise<RecordFollowUpResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "consultations:edit");

    // The visit (and its patient) and any doctor must belong to the caller's clinic (P0-13: the FKs and RLS do not
    // check this).
    if (!(await visitInTenant(ctx, input.visitId, input.patientId))) {
      return { success: false, error: "Visit not found or access denied." };
    }
    if (input.doctorId && !(await memberOfTenant(ctx, input.doctorId))) {
      return { success: false, error: "Doctor not found in this clinic." };
    }

    // Check if an existing follow-up is already tied to this visit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase.from("follow_ups") as any)
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("visit_id", input.visitId)
      .maybeSingle();

    let followUpId: string;

    if (existing?.id) {
      // Update existing follow-up
      followUpId = existing.id;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateErr } = await (supabase.from("follow_ups") as any)
        .update({
          follow_up_date: input.followUpDate,
          notes: input.notes ?? null,
        })
        .eq("id", followUpId)
        .eq("tenant_id", ctx.tenantId);

      if (updateErr) throw updateErr;
    } else {
      // Insert new follow-up
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: inserted, error: insertErr } = await (supabase.from("follow_ups") as any)
        .insert({
          tenant_id: ctx.tenantId,
          patient_id: input.patientId,
          visit_id: input.visitId,
          doctor_id: input.doctorId || ctx.userId,
          follow_up_date: input.followUpDate,
          notes: input.notes ?? null,
          status: "scheduled",
        })
        .select("id")
        .single();

      if (insertErr || !inserted) throw insertErr ?? new Error("Failed to create follow-up");
      followUpId = inserted.id;
    }

    await recordAudit(ctx, {
      action: "follow_up.record",
      entityType: "follow_up",
      entityId: followUpId,
      metadata: {
        follow_up_date: input.followUpDate,
      },
    });

    return { success: true, followUpId };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to record follow-up.", "consultation.record_follow_up.failed"),
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

export type GetPatientConsultationHistoryResult =
  | { success: true; encounters: PastVisitEncounter[] }
  | { success: false; error: string };

/**
 * Loads longitudinal patient consultation history for the history slide-over drawer.
 */
export async function getPatientConsultationHistory(
  ctx: ServiceContext,
  patientId: string,
  currentVisitId?: string
): Promise<GetPatientConsultationHistoryResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "consultations:view");

    // 1. Fetch visits for this patient in this tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let visitQuery = (supabase as any)
      .from("visits")
      .select(`id, scheduled_at, created_at, status, specialty, ${clinicalNotesEmbed(["vitals", "chief_complaints", "clinical_notes", "advice"])}`)
      .eq("tenant_id", ctx.tenantId)
      .eq("patient_id", patientId)
      .in("status", ["completed", "in_consultation"])
      .order("created_at", { ascending: false });

    if (currentVisitId) {
      visitQuery = visitQuery.neq("id", currentVisitId);
    }

    const { data: visitRows, error: visitsErr } = await visitQuery;
    if (visitsErr) throw visitsErr;
    // Clinical content from clinical_notes (05-02a); absent (null) where RLS hides it.
    const visits = (visitRows ?? []).map(withClinicalNotes);

    if (!visits || visits.length === 0) {
      return { success: true, encounters: [] };
    }

    const visitIds = visits.map((v: { id: string }) => v.id);

    // 2. Fetch diagnoses for these visits
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: diagnoses, error: diagErr } = await (supabase as any)
      .from("consultation_diagnoses")
      .select("id, visit_id, diagnosis_name, icd11_code, snomed_concept_id, is_chronic")
      .in("visit_id", visitIds)
      .eq("tenant_id", ctx.tenantId);

    if (diagErr) throw diagErr;

    // 3. Fetch prescriptions for these visits
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rxList, error: rxErr } = await (supabase as any)
      .from("prescriptions")
      .select("id, visit_id, version, status")
      .in("visit_id", visitIds)
      .eq("tenant_id", ctx.tenantId)
      .eq("status", "active");

    if (rxErr) throw rxErr;

    const rxIds = (rxList || []).map((rx: { id: string }) => rx.id);
    let itemsByRx: Record<string, unknown[]> = {};

    if (rxIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: items, error: itemsErr } = await (supabase as any)
        .from("prescription_items")
        .select("id, prescription_id, medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, sort_order")
        .in("prescription_id", rxIds)
        .order("sort_order", { ascending: true });

      if (itemsErr) throw itemsErr;

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
      error: clientErrorMessage(err, "Failed to load patient consultation history.", "consultation.get_patient_consultation_history.failed"),
    };
  }
}

/**
 * Builds a complete PrescriptionPdfPayload for a visit of the acting tenant.
 */
async function buildVisitPdfPayload(
  ctx: ServiceContext,
  visitId: string,
  overrideVersion?: number,
  overrideReason?: string | null
): Promise<PrescriptionPdfPayload | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = ctx.db as any;
  const tenantId = ctx.tenantId;

  const { data: visitRow } = await supabase
    .from("visits")
    .select(`*, ${clinicalNotesEmbed()}`)
    .eq("id", visitId)
    .eq("tenant_id", tenantId)
    .single();

  if (!visitRow) return null;
  // The clinical content comes from clinical_notes (V2-05 05-02a).
  const visit = withClinicalNotes(visitRow);

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, address, phone, registration_number, logo_url, timezone")
    .eq("id", tenantId)
    .single();

  const { data: patient } = await supabase
    .from("patients")
    .select("full_name, age, sex, phone, address, abha_id")
    .eq("id", visit.patient_id)
    .eq("tenant_id", tenantId)
    .single();

  const { data: doctorMember } = await supabase
    .from("memberships")
    .select("qualifications, medical_council_reg_no")
    .eq("tenant_id", tenantId)
    .eq("user_id", visit.doctor_id)
    .maybeSingle();

  const { data: diagnoses } = await supabase
    .from("consultation_diagnoses")
    .select("diagnosis_name, icd11_code, snomed_concept_id")
    .eq("visit_id", visitId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });

  const { data: rx } = await supabase
    .from("prescriptions")
    .select("id, version, letterhead_mode, amendment_reason, signed_at")
    .eq("visit_id", visitId)
    .eq("tenant_id", tenantId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let items: any[] = [];
  if (rx?.id) {
    const { data: rxItems } = await supabase
      .from("prescription_items")
      .select("medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, sort_order")
      .eq("prescription_id", rx.id)
      .order("sort_order", { ascending: true });
    items = rxItems || [];
  }

  const { data: followUp } = await supabase
    .from("follow_ups")
    .select("follow_up_date")
    .eq("visit_id", visitId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const version = overrideVersion ?? (rx?.version || 1);
  const amendmentReason = overrideReason !== undefined ? overrideReason : (rx?.amendment_reason || null);

  return {
    tenant_id: tenantId,
    visit_id: visit.id,
    prescription_id: rx?.id || "",
    version,
    letterhead_mode: rx?.letterhead_mode || "blank_paper",
    amendment_reason: amendmentReason,
    signed_at: visit.signed_at || new Date().toISOString(),
    clinic: {
      name: tenant?.name || "Clinic",
      address: tenant?.address || null,
      phone: tenant?.phone || null,
      registration_number: tenant?.registration_number || null,
      logo_url: tenant?.logo_url || null,
    },
    doctor: {
      name: "Doctor",
      qualifications: doctorMember?.qualifications || null,
      medical_council_reg_no: doctorMember?.medical_council_reg_no || null,
    },
    patient: {
      full_name: patient?.full_name || "Patient",
      age: patient?.age || null,
      sex: patient?.sex || null,
      phone: patient?.phone || null,
      address: typeof patient?.address === "string" ? patient.address : null,
      abha_id: patient?.abha_id || null,
      uhid: visit.patient_id.slice(0, 8).toUpperCase(),
    },
    visit: {
      visit_date: ymdOf(visit.scheduled_at || visit.created_at || new Date(), resolveTimeZone(tenant?.timezone)),
      vitals: visit.vitals || null,
      chief_complaints: (visit.chief_complaints || []) as PrescriptionPdfPayload["visit"]["chief_complaints"],
      clinical_notes: visit.clinical_notes || null,
      specialty: visit.specialty || "general_physician",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    diagnoses: (diagnoses || []).map((d: any) => ({
      diagnosis_name: d.diagnosis_name,
      icd11_code: d.icd11_code || null,
      snomed_concept_id: d.snomed_concept_id || null,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    medications: items.map((item: any) => ({
      medicine_name: item.medicine_name,
      generic_name: item.generic_name,
      dose_form: item.dose_form,
      dosage: item.dosage,
      timing: item.timing,
      duration: item.duration,
      special_instructions: item.special_instructions,
    })),
    investigations_advised: visit.investigations_advised || [],
    advice: visit.advice || [],
    follow_up_date: followUp?.follow_up_date || null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sign-off and amendment (V2-07 07-01). Each is one atomic command RPC (migration 000097): the visit is locked, the
// invariants are checked, the writes, the audit row and (sign-off) the webhook outbox rows are committed together or not
// at all, and the same `client_request_id` replays the first result. The PDF render and storage archive stay AFTER the
// commit (R-4), best-effort as before.
// ---------------------------------------------------------------------------------------------------------------------

/** A failed command in the services' `{ success: false }` shape, carrying the `AppError` code and reason for the actions. */
export interface CommandFailure {
  success: false;
  error: string;
  code?: AppError["code"];
  reason?: string;
}

function commandFailure(error: AppError): CommandFailure {
  return { success: false, error: error.message, code: error.code, reason: error.reason };
}

/** Fixed, data-free texts by reason or code for the clinical commands. The driver message never reaches the caller. */
export const CLINICAL_COMMAND_MESSAGES = {
  NOT_FOUND: "Visit not found or access denied.",
  FORBIDDEN: "You do not have permission to change this consultation.",
  LOCK_TIMEOUT: "This consultation is being updated. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  ALREADY_SIGNED: "This consultation is already signed.",
  SIGN_CONTENT_REQUIRED: "Cannot sign off consultation without recording at least one diagnosis or clinical note.",
  VISIT_NOT_SIGNABLE: "Check the patient in before signing this consultation.",
  VISIT_NOT_SIGNED: "Only signed, completed consultations can be reopened for amendment.",
  AMENDMENT_NOT_OPEN: "This consultation is not open for amendment.",
  AMENDMENT_REASON_INVALID:
    "A valid reason for amendment of at least 10 characters is required for medical audit compliance.",
} as const satisfies DbErrorMessages;

/** The amendment reason is 10 to 500 characters (the audit row holds it, whose values are bounded at 500; V2-07 07-04a F-11). */
export const AMENDMENT_REASON_TOO_SHORT_MESSAGE = CLINICAL_COMMAND_MESSAGES.AMENDMENT_REASON_INVALID;
export const AMENDMENT_REASON_TOO_LONG_MESSAGE = "The reason for amendment must be 500 characters or fewer.";

const signRpcResultSchema = z.object({
  visit_id: z.string().uuid(),
  signed_at: z.string(),
  sealed_prescriptions: z.number().int(),
  replayed: z.boolean(),
});

const reopenRpcResultSchema = z.object({
  visit_id: z.string().uuid(),
  revision_number: z.number().int(),
  replayed: z.boolean(),
});

// No free text in a stored command result (V2-07 07-04a F-5): the amendment reason stays in `visit_revisions`.
const finalizeRpcResultSchema = z.object({
  visit_id: z.string().uuid(),
  version: z.number().int(),
  replayed: z.boolean(),
});

export type CompleteAndSignConsultationResult =
  | { success: true; visitId: string; replayed: boolean }
  | CommandFailure;

/**
 * Completes the consultation and finalizes clinical documentation as one atomic command (`public.sign_consultation`):
 * at least one diagnosis or clinical note must exist; the visit is signed by the acting user, the active prescriptions
 * are sealed, the audit row and the `visit.completed` / `prescription.issued` outbox rows are written in the same
 * transaction. The initial archival PDF (v1) is rendered after the commit.
 */
export async function completeAndSignConsultation(
  ctx: ServiceContext,
  visitId: string,
  clientRequestId: string
): Promise<CompleteAndSignConsultationResult> {
  try {
    assertPerm(ctx.role, "consultations:edit");
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "Failed to complete and sign consultation.", "consultation.sign.failed") };
  }

  const ids = z.object({ visit: z.string().uuid(), request: clientRequestIdSchema }).safeParse({ visit: visitId, request: clientRequestId });
  if (!ids.success) {
    return { success: false, error: "Invalid request.", code: "VALIDATION_FAILED" };
  }

  const outcome = await callCommand(
    ctx,
    "sign_consultation",
    { p_visit_id: visitId, p_client_request_id: clientRequestId },
    signRpcResultSchema,
    { ...CLINICAL_COMMAND_MESSAGES, INTERNAL: "Failed to complete and sign consultation." },
    { event: "consultation.sign.failed" }
  );
  if (!outcome.ok) return commandFailure(outcome.error);

  // After the commit (R-4). A replay means the first call's response may have been lost after the commit, so the archive is
  // rendered then too when it is missing (V2-07 07-04a F-7).
  await archiveInitialPrescriptionPdf(ctx, visitId, outcome.value.replayed ? { onlyIfMissing: true } : {});

  return { success: true, visitId, replayed: outcome.value.replayed };
}

/**
 * The initial archival PDF (v1) of a just-signed consultation, rendered and stored AFTER the commit (R-4: no external
 * call inside a transaction), best-effort: the record is already signed whatever happens here. Shared by the sign-off
 * and by Sign & Bill (`complete_and_bill`, V2-07 07-03).
 */
export async function archiveInitialPrescriptionPdf(
  ctx: ServiceContext,
  visitId: string,
  options: { onlyIfMissing?: boolean } = {}
): Promise<void> {
  try {
    if (options.onlyIfMissing && (await prescriptionPdfArchived(ctx, visitId, 1))) return;
    const payload = await buildVisitPdfPayload(ctx, visitId, 1);
    if (payload) {
      await generateAndArchivePrescriptionPdf(ctx, payload);
    }
  } catch (pdfErr) {
    log.warn({ event: "consultation.sign_pdf_archive.failed", code: errorTag(pdfErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
  }
}

/**
 * True when the visit's latest prescription already records the archive of `version` (`pdf_storage_path` ends with
 * `rx_v<version>.pdf`, written by `generateAndArchivePrescriptionPdf` after the upload). A visit with no prescription row
 * has nothing to record the archive on, so it counts as not archived (the render is harmless: the upload overwrites).
 * Also true when the latest prescription is of another version: the command this replay belongs to has been superseded.
 */
async function prescriptionPdfArchived(ctx: ServiceContext, visitId: string, version: number): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (ctx.db.from("prescriptions") as any)
    .select("version, pdf_storage_path")
    .eq("visit_id", visitId)
    .eq("tenant_id", ctx.tenantId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  if (Number(data.version) !== version) return true;
  return typeof data.pdf_storage_path === "string" && data.pdf_storage_path.endsWith(`/rx_v${version}.pdf`);
}

export type ReopenVisitForAmendmentResult =
  | { success: true; visitId: string; revisionNumber: number; replayed: boolean }
  | CommandFailure;

/**
 * Reopens a completed consultation for post-sign-off clinical amendments as one atomic command
 * (`public.reopen_visit_for_amendment`): the amendment row in `visit_revisions` (its number and its immutable JSON
 * snapshot of the signed content are filled by the database), the visit back to 'in_consultation' and the audit row.
 */
export async function reopenVisitForAmendment(
  ctx: ServiceContext,
  visitId: string,
  reason: string,
  clientRequestId: string
): Promise<ReopenVisitForAmendmentResult> {
  try {
    assertPerm(ctx.role, "consultations:edit");
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "Failed to reopen visit for amendment.", "consultation.reopen_visit_for_amendment.failed") };
  }

  const cleanReason = (reason || "").trim();
  if (cleanReason.length < 10) {
    return { success: false, error: AMENDMENT_REASON_TOO_SHORT_MESSAGE, code: "VALIDATION_FAILED", reason: "AMENDMENT_REASON_INVALID" };
  }
  if (cleanReason.length > 500) {
    return { success: false, error: AMENDMENT_REASON_TOO_LONG_MESSAGE, code: "VALIDATION_FAILED", reason: "AMENDMENT_REASON_INVALID" };
  }
  const ids = z.object({ visit: z.string().uuid(), request: clientRequestIdSchema }).safeParse({ visit: visitId, request: clientRequestId });
  if (!ids.success) {
    return { success: false, error: "Invalid request.", code: "VALIDATION_FAILED" };
  }

  const outcome = await callCommand(
    ctx,
    "reopen_visit_for_amendment",
    { p_visit_id: visitId, p_reason: cleanReason, p_client_request_id: clientRequestId },
    reopenRpcResultSchema,
    { ...CLINICAL_COMMAND_MESSAGES, INTERNAL: "Failed to reopen visit for amendment." },
    { event: "consultation.amend_reopen.failed" }
  );
  if (!outcome.ok) return commandFailure(outcome.error);

  return { success: true, visitId, revisionNumber: outcome.value.revision_number, replayed: outcome.value.replayed };
}

export type FinalizeVisitAmendmentResult =
  | { success: true; visitId: string; version: number; replayed: boolean }
  | CommandFailure;

/**
 * Finalizes clinical amendments made to a reopened visit as one atomic command (`public.finalize_visit_amendment`):
 * the latest prescription gets the next version (v2, v3), the amendment reason and a new signature, the visit returns to
 * 'completed' re-signed by the caller, and the audit row is written. The amended PDF (watermark and doctor's rationale)
 * is rendered after the commit.
 */
export async function finalizeVisitAmendment(
  ctx: ServiceContext,
  visitId: string,
  clientRequestId: string
): Promise<FinalizeVisitAmendmentResult> {
  try {
    assertPerm(ctx.role, "consultations:edit");
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "Failed to finalize amendment.", "consultation.amend_finalize.failed") };
  }

  const ids = z.object({ visit: z.string().uuid(), request: clientRequestIdSchema }).safeParse({ visit: visitId, request: clientRequestId });
  if (!ids.success) {
    return { success: false, error: "Invalid request.", code: "VALIDATION_FAILED" };
  }

  const outcome = await callCommand(
    ctx,
    "finalize_visit_amendment",
    { p_visit_id: visitId, p_client_request_id: clientRequestId },
    finalizeRpcResultSchema,
    { ...CLINICAL_COMMAND_MESSAGES, INTERNAL: "Failed to finalize amendment." },
    { event: "consultation.amend_finalize.failed" }
  );
  if (!outcome.ok) return commandFailure(outcome.error);

  const { version, replayed } = outcome.value;
  // Regenerate and archive the stamped amended PDF (v2, v3), after the commit. A replay means the first call's response may
  // have been lost after the commit: the PDF is rendered then too when that version is not archived yet (F-7).
  try {
    if (!replayed || !(await prescriptionPdfArchived(ctx, visitId, version))) {
      // The reason is read back from the amendment row (the stored command result holds no free text, F-5).
      const amendmentReason = await latestAmendmentReason(ctx, visitId);
      const payload = await buildVisitPdfPayload(ctx, visitId, version, amendmentReason);
      if (payload) {
        await generateAndArchivePrescriptionPdf(ctx, payload);
      }
    }
  } catch (pdfErr) {
    log.warn({ event: "consultation.amend_pdf_regenerate.failed", code: errorTag(pdfErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
  }

  return { success: true, visitId, version, replayed };
}

/** The reason of the visit's latest amendment row (the reopen wrote it; the finalize stamps it on the amended PDF). */
async function latestAmendmentReason(ctx: ServiceContext, visitId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (ctx.db.from("visit_revisions") as any)
    .select("amendment_reason")
    .eq("visit_id", visitId)
    .eq("tenant_id", ctx.tenantId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return typeof data?.amendment_reason === "string" ? data.amendment_reason : null;
}
