import "server-only";

import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import {
  saveDraftCommandSchema,
  Vitals,
  ChiefComplaintItem,
  type SaveDraftCommandInput,
} from "./schema";
import { archivePrescriptionPdf, isArchivable, isVisitSigner } from "../prescriptions/pdf/generator";
import { loadPrescriptionPdfSource } from "../prescriptions/pdf/payload";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import type { DbErrorMessages } from "@/lib/db/errors";
import { callCommand } from "@/lib/commands/call-command";
import { clientRequestIdSchema } from "@/lib/commands/request-id";
import type { AppError } from "@/lib/errors/app-error";
import { z } from "zod";
import { clinicalNotesEmbed, embeddedClinicalNotes, withClinicalNotes } from "@/lib/db/clinical-notes";
import { clientErrorMessage } from "@/lib/errors/client-message";
import { SIGNED_CONSULTATION_MESSAGE } from "./record-state";
import type { DraftFields, ServerDraft } from "./draft";

// Consultation use-cases. Tenant and actor come only from `ctx` (ADR-0005 D1); each use-case checks the permission
// its server action checked before the move.

/**
 * The AI provenance a draft save may write to `visits.metadata` (V2-08 08-06a, S-3; the database allows exactly these two keys on a
 * direct write): `ai_assisted` (boolean) and `ai_sections_used` (up to 20 short strings). Anything else the caller sent is dropped.
 */
export function draftProvenance(raw: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  const out: Record<string, unknown> = {};
  if (typeof raw.ai_assisted === "boolean") out.ai_assisted = raw.ai_assisted;
  if (Array.isArray(raw.ai_sections_used)) {
    out.ai_sections_used = raw.ai_sections_used.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 40).slice(0, 20);
  }
  return Object.keys(out).length > 0 ? out : null;
}

const saveDraftRpcResultSchema = z.object({
  visit_id: z.string().uuid(),
  draft_version: z.number().int().min(0),
  started: z.boolean(),
  replayed: z.boolean(),
});

/** Fixed, data-free texts of the draft save (the driver message never reaches the caller). */
const DRAFT_SAVE_MESSAGES = {
  NOT_FOUND: "Visit record not found or access denied.",
  FORBIDDEN: "You do not have permission to change this consultation.",
  LOCK_TIMEOUT: "This consultation is being updated. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  DRAFT_CONFLICT: "This consultation was changed in another tab or device.",
  DRAFT_LOCKED: SIGNED_CONSULTATION_MESSAGE,
  INTERNAL: "Failed to save draft. Please try again.",
} as const satisfies DbErrorMessages;

export type SaveConsultationDraftResult =
  | { success: true; visitId: string; draftVersion: number; started: boolean; replayed: boolean }
  | { success: false; error: string; code?: AppError["code"]; reason?: string; fieldErrors?: Record<string, string[]> };

/**
 * Saves the consult draft as one atomic command (`public.save_consultation_draft`, V2-09b R-3): the keys present in `patch` are written to
 * the notes, the visit's specialty and the visit's follow-up, a waiting visit is started, and the audit row is written, in one transaction.
 * `expected_version` is the `draft_version` the client last saw; a stale one is `CONFLICT` / `DRAFT_CONFLICT` with no data (the client reads
 * the server copy with `getConsultationDraft` and rebases). A signed, completed or cancelled visit is `DRAFT_LOCKED` with the fixed signed
 * text. The same `client_request_id` replays the first result.
 */
export async function saveConsultationDraft(
  ctx: ServiceContext,
  input: SaveDraftCommandInput
): Promise<SaveConsultationDraftResult> {
  try {
    assertPerm(ctx.role, "consultations:edit");
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "An unexpected error occurred saving draft.", "consultation.save_consultation_draft.failed") };
  }

  const parsed = saveDraftCommandSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.filter((p) => p !== "patch")[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    const issueSummary = parsed.error.issues.map((i) => `${i.path.join(".") || "field"}: ${i.message}`).join("; ");
    return { success: false, error: `Validation error: ${issueSummary}`, code: "VALIDATION_FAILED", fieldErrors };
  }

  const { visit_id: visitId, expected_version: expectedVersion, client_request_id: clientRequestId } = parsed.data;
  const patch: Record<string, unknown> = { ...parsed.data.patch };
  if ("provenance" in patch) {
    const provenance = draftProvenance(patch.provenance as Record<string, unknown> | null);
    if (provenance) patch.provenance = provenance;
    else delete patch.provenance;
  }
  if (Object.keys(patch).filter((k) => k !== "conflict_overwrite").length === 0) {
    return { success: false, error: "Nothing to save.", code: "VALIDATION_FAILED" };
  }

  const outcome = await callCommand(
    ctx,
    "save_consultation_draft",
    { p_visit_id: visitId, p_expected_version: expectedVersion, p_patch: patch, p_client_request_id: clientRequestId },
    saveDraftRpcResultSchema,
    DRAFT_SAVE_MESSAGES,
    { event: "consultation.draft_save.failed" }
  );
  if (!outcome.ok) return commandFailure(outcome.error);
  return {
    success: true,
    visitId,
    draftVersion: outcome.value.draft_version,
    started: outcome.value.started,
    replayed: outcome.value.replayed,
  };
}

export type GetConsultationDraftResult = { success: true; draft: ServerDraft } | { success: false; error: string; code?: AppError["code"] };

/**
 * The server copy of a consult draft, for the client's conflict rebase (V2-09b R-5): the draft fields, the follow-up, the specialty, `draft_version`
 * and the record state it was read in. consultations:view; the tenant is the session's.
 */
export async function getConsultationDraft(ctx: ServiceContext, visitId: string): Promise<GetConsultationDraftResult> {
  try {
    assertPerm(ctx.role, "consultations:view");
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "Failed to load the consultation.", "consultation.get_consultation_draft.failed") };
  }
  if (!z.string().uuid().safeParse(visitId).success) {
    return { success: false, error: "Invalid request.", code: "VALIDATION_FAILED" };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visit, error: visitErr } = await (ctx.db.from("visits") as any)
      .select(
        `id, status, signed_at, specialty, notes:clinical_notes(vitals, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice, draft_version)`
      )
      .eq("id", visitId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    if (visitErr) throw visitErr;
    const notes = embeddedClinicalNotes(visit) as (Record<string, unknown> & { draft_version?: number }) | null;
    if (!visit || !notes) return { success: false, error: "Visit record not found or access denied.", code: "NOT_FOUND" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: followUp, error: followUpErr } = await (ctx.db.from("follow_ups") as any)
      .select("follow_up_date, notes")
      .eq("visit_id", visitId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    if (followUpErr) throw followUpErr;

    const fields: DraftFields = {
      vitals: (notes.vitals as Vitals | null) ?? null,
      chief_complaints: (notes.chief_complaints as ChiefComplaintItem[] | null) ?? [],
      clinical_notes: (notes.clinical_notes as string | null) ?? "",
      specialty_data: (notes.specialty_data as DraftFields["specialty_data"]) ?? null,
      investigations_advised: (notes.investigations_advised as string[] | null) ?? [],
      advice: (notes.advice as string[] | null) ?? [],
      specialty: (visit.specialty as DraftFields["specialty"]) ?? "general_physician",
      follow_up: followUp ? { follow_up_date: followUp.follow_up_date as string, notes: (followUp.notes as string | null) ?? null } : null,
    };
    return {
      success: true,
      draft: { fields, draftVersion: notes.draft_version ?? 0, status: visit.status as string, signedAt: (visit.signed_at as string | null) ?? null },
    };
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "Failed to load the consultation.", "consultation.get_consultation_draft.failed") };
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
  RX_ARCHIVE_PENDING:
    "The signed prescription PDF has not been archived yet. The doctor who signed it must open the prescription first; then try again.",
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

  // After the commit (R-4). A replay means the first call's response may have been lost after the commit, so the archive is made then too when it is
  // missing (V2-07 07-04a F-7); the archive is idempotent (V2-09a R-12), so a first call and a replay take the same step.
  await archiveSealedPrescriptionPdf(ctx, visitId);

  return { success: true, visitId, replayed: outcome.value.replayed };
}

/**
 * Archives the signed version of the visit's prescription (V2-09a R-12), rendered and stored AFTER the commit (R-4: no external call inside a
 * transaction), best-effort: the record is already signed whatever happens here, and the signer's next open of the PDF archives it if it is missing.
 * Used by the sign-off, by Sign & Bill (`complete_and_bill`, V2-07 07-03), by the amendment's finalize (with the new `version`) and before a reopen.
 * It does nothing for a visit that is not sealed, for a header with no signature, for a header whose PDF is already archived (the pair is write-once),
 * and (09A-06a ruling R-A) for a caller who is not the visit's signer: only the signer archives, the database refuses anyone else.
 */
export async function archiveSealedPrescriptionPdf(
  ctx: ServiceContext,
  visitId: string,
  options: { version?: number } = {}
): Promise<void> {
  try {
    const source = await loadPrescriptionPdfSource(ctx, visitId, { version: options.version });
    if (!source?.header || source.header.pdf_sha256 || !isArchivable(ctx, source) || !isVisitSigner(ctx, source)) return;
    await archivePrescriptionPdf(ctx, source.payload);
  } catch (pdfErr) {
    log.warn({ event: "consultation.rx_pdf_archive.failed", code: errorTag(pdfErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
  }
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

  // The signed version is archived first: once the visit is reopened it is no longer sealed, and the database refuses an archive of an open amendment.
  // The snapshot the reopen takes then holds the signed version's path and hash. Only the signer can archive it (R-A); if it is still missing the
  // command refuses with RX_ARCHIVE_PENDING (09A-06a, review A-3) and the caller gets the fixed retry text.
  await archiveSealedPrescriptionPdf(ctx, visitId);

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
  // Archive the amended version (v2, v3), after the commit; the header holds no PDF pair until then (finalize cleared it). A replay may mean the first call's
  // response was lost after the commit: the archive is idempotent, so the same step covers it (F-7). The reason printed on the PDF is the header's own.
  await archiveSealedPrescriptionPdf(ctx, visitId, { version });

  return { success: true, visitId, version, replayed };
}
