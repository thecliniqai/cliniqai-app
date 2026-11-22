import "server-only";
import { serverEnv } from "@/lib/env-server";

import { createShareToken } from "@/features/sharing/tokens";
import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { PrescriptionItem } from "@/lib/db/types";
import { enqueueMessage } from "@/lib/jobs/enqueue";
import { z } from "zod";
import {
  PrescriptionItemInput,
  protocolTemplateSchema,
  ProtocolTemplateInput,
  MedicineSearchResult,
  MEDICINE_QUERY_MAX,
  MEDICINE_SEARCH_LIMIT,
  changePrescriptionSchema,
  repeatVisitPlanSchema,
  type ChangePrescriptionInput,
  type RepeatVisitPlanInput,
} from "./schema";
import { callCommand } from "@/lib/commands/call-command";
import { ALLERGY_MATCH_MESSAGE, type RxAllergyContext } from "./allergy";
import type { AppError } from "@/lib/errors/app-error";
import { isArchivable, resolvePrescriptionPdf } from "./pdf/generator";
import { loadPrescriptionPdfSource } from "./pdf/payload";
import { getSignedUrl, getStorageProviderForDb, VIEW_LINK_TTL_SECONDS } from "@/lib/storage";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import type { DbErrorMessages } from "@/lib/db/errors";
import { clientErrorMessage } from "@/lib/errors/client-message";
import { SIGNED_CONSULTATION_MESSAGE } from "@/features/consultation/record-state";
import { getVisitDiagnoses } from "@/features/terminology/service";
import type { ConsultationDiagnosisItem } from "@/features/terminology/schema";

// Prescription use-cases. Tenant and actor come only from `ctx` (ADR-0005 D1); each use-case checks the permission
// its server action checked before the move. `notifyPrescriptionIssued` was deleted (P0-01). Since 04-07a (M-RXEVENT)
// no use-case here enqueues `prescription.issued`: in the app it is queued only when the prescription is signed
// (features/consultation/service.ts, key `:signed`), and the public API queues its own (app/api/v1/prescriptions,
// key `:created`); a draft never sends it.

// Specialty slugs are interpolated into a PostgREST `.or()` filter, so only plain slug characters are accepted.
const SPECIALTY_SLUG = /^[a-z0-9_]{1,50}$/;

export type SearchMedicinesResult =
  | { success: true; results: MedicineSearchResult[] }
  | { success: false; error: string };

const searchRowSchema = z.object({
  id: z.string(),
  kind: z.enum(["cdci", "custom"]),
  medicine_name: z.string(),
  generic_name: z.string().nullable(),
  dose_form: z.string().nullable(),
  substance_ids: z.array(z.string()).nullable(),
  dosage: z.string().nullable(),
  timing: z.string().nullable(),
  duration: z.string().nullable(),
});

/**
 * The medicine typeahead (V2-09c R-3): `public.search_medicines` on the caller's own client (INVOKER, RLS applies) over the CDCI catalogue and the calling
 * doctor's own custom medicines (the doctor is `auth.uid()` in the database, never a parameter). The query is trimmed and capped at 60 characters; `%`, `_` and
 * `\` in it match themselves (the database escapes them). Needs `prescriptions:edit`. A failed read answers a fixed text, never the driver's.
 */
export async function searchMedicines(ctx: ServiceContext, query: string, limit = MEDICINE_SEARCH_LIMIT): Promise<SearchMedicinesResult> {
  try {
    assertPerm(ctx.role, "prescriptions:edit");
    const cleanQuery = query.trim().slice(0, MEDICINE_QUERY_MAX).trim();
    if (cleanQuery === "") return { success: true, results: [] };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.db as any).rpc("search_medicines", {
      p_tenant_id: ctx.tenantId,
      p_query: cleanQuery,
      p_limit: Math.min(Math.max(Math.trunc(limit), 1), MEDICINE_SEARCH_LIMIT),
    });
    if (error) throw error;
    const rows = z.array(searchRowSchema).safeParse(data ?? []);
    if (!rows.success) throw new Error("search_medicines returned an unexpected shape");
    return {
      success: true,
      results: rows.data.map((r) => ({
        id: r.id,
        kind: r.kind,
        medicine_name: r.medicine_name,
        generic_name: r.generic_name,
        dose_form: r.dose_form,
        substance_ids: r.substance_ids ?? [],
        dosage: r.dosage,
        timing: r.timing,
        duration: r.duration,
      })),
    };
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "Failed to search medicines.", "prescriptions.medicine_search.failed") };
  }
}

const changeRpcResultSchema = z.object({
  prescription_id: z.string().uuid(),
  added_item_ids: z.array(z.string().uuid()),
  replayed: z.boolean(),
});

/** Fixed, data-free texts of the Rx change command (the driver message never reaches the caller). */
const RX_CHANGE_MESSAGES = {
  NOT_FOUND: "This medicine is no longer on the prescription.",
  FORBIDDEN: "You do not have permission to change this prescription.",
  LOCK_TIMEOUT: "This prescription is being updated. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  VALIDATION_FAILED: "Check the medicine details and try again.",
  DRAFT_LOCKED: SIGNED_CONSULTATION_MESSAGE,
  // V2-09c 09C-02 (R-7): the database refused a medicine that matches a recorded allergy; the doctor gives a reason.
  ALLERGY_MATCH: ALLERGY_MATCH_MESSAGE,
  INTERNAL: "Failed to update the prescription. Please try again.",
} as const satisfies DbErrorMessages;

export type ChangePrescriptionResult =
  | { success: true; prescriptionId: string; addedItemIds: string[]; replayed: boolean }
  | { success: false; error: string; code?: AppError["code"]; reason?: string; fieldErrors?: Record<string, string[]> };

/**
 * Every Rx change as one atomic command (`public.change_prescription`, V2-09c R-2, ADR-004): the lines to add, the dose fields to update and the items to
 * remove are applied in one transaction with the audit row, and the same `client_request_id` replays the first result. `prescriptions:edit`. A sealed,
 * an unsigned completed or a cancelled visit is `DRAFT_LOCKED` (the fixed signed text, V2-09a R-17); an item that is not on the visit's prescription is
 * `NOT_FOUND`. The tenant is the session's.
 */
export async function changePrescription(ctx: ServiceContext, input: ChangePrescriptionInput): Promise<ChangePrescriptionResult> {
  try {
    assertPerm(ctx.role, "prescriptions:edit");
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "Failed to update the prescription.", "prescriptions.change.failed") };
  }
  const parsed = changePrescriptionSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.filter((p) => p !== "changes").map(String).join(".") || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return { success: false, error: RX_CHANGE_MESSAGES.VALIDATION_FAILED, code: "VALIDATION_FAILED", fieldErrors };
  }

  const { visit_id: visitId, changes, client_request_id: clientRequestId } = parsed.data;
  const payload: Record<string, unknown> = {};
  if (changes.add?.length) payload.add = changes.add;
  if (changes.update?.length) payload.update = changes.update;
  if (changes.remove?.length) payload.remove = changes.remove;
  if (changes.allergy_override_reason) payload.allergy_override_reason = changes.allergy_override_reason;

  const outcome = await callCommand(
    ctx,
    "change_prescription",
    { p_visit_id: visitId, p_changes: payload, p_client_request_id: clientRequestId },
    changeRpcResultSchema,
    RX_CHANGE_MESSAGES,
    { event: "prescriptions.change.failed" }
  );
  if (!outcome.ok) {
    return { success: false, error: outcome.error.message, code: outcome.error.code, reason: outcome.error.reason };
  }
  return { success: true, prescriptionId: outcome.value.prescription_id, addedItemIds: outcome.value.added_item_ids, replayed: outcome.value.replayed };
}

const repeatRpcResultSchema = z.object({
  prescription_id: z.string().uuid().nullable(),
  added_item_ids: z.array(z.string().uuid()),
  skipped_item_ids: z.array(z.string().uuid()),
  diagnoses_added: z.number().int().min(0),
  replayed: z.boolean(),
});

/** Fixed, data-free texts of "Same as last visit" (the driver message never reaches the caller). */
const REPEAT_MESSAGES = {
  NOT_FOUND: "The previous visit could not be found. Refresh and try again.",
  FORBIDDEN: "You do not have permission to repeat the last visit.",
  LOCK_TIMEOUT: "This visit is being updated. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  VALIDATION_FAILED: "Choose what to repeat and try again.",
  DRAFT_LOCKED: SIGNED_CONSULTATION_MESSAGE,
  INTERNAL: "Failed to repeat the last visit. Please try again.",
} as const satisfies DbErrorMessages;

export type RepeatVisitPlanResult =
  | {
      success: true;
      prescriptionId: string | null;
      addedItemIds: string[];
      /** Source item ids of the lines NOT copied because they match a recorded allergy (the screen opens them flagged). */
      skippedItemIds: string[];
      /** The source lines behind `skippedItemIds` (stored values, read by their ids under RLS), so the screen can open each in the dose builder. */
      skippedItems: PrescriptionItem[];
      diagnosesAdded: number;
      replayed: boolean;
      /** The visit's lines and diagnoses as the database holds them now (the command decides what was copied, so the screen takes its answer). */
      items: PrescriptionItem[];
      diagnoses: ConsultationDiagnosisItem[];
    }
  | { success: false; error: string; code?: AppError["code"]; reason?: string; fieldErrors?: Record<string, string[]> };

/** The source lines the repeat left for the doctor (an allergy match), by id, under the caller's RLS; a failed read is an empty list (the ids are still returned). */
async function readSkippedItems(ctx: ServiceContext, ids: string[]): Promise<PrescriptionItem[]> {
  if (ids.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db.from("prescription_items") as any)
    .select("id, prescription_id, medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, cdci_brand_id, cdci_generic_id, sort_order, created_at")
    .eq("tenant_id", ctx.tenantId)
    .in("id", ids)
    .order("sort_order", { ascending: true });
  if (error) {
    log.error({ event: "prescriptions.repeat_skipped_read.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }
  return (data ?? []) as PrescriptionItem[];
}

/**
 * "Same as last visit" as ONE command (`public.repeat_visit_plan`, V2-09c R-10, ADR-004): the signed source visit's diagnoses and/or prescription lines are
 * copied by the database onto this visit (a diagnosis or medicine already there is skipped; a line that matches a recorded allergy is not copied and is
 * reported by its source item id). `prescriptions:edit` and `consultations:edit`. The tenant is the session's; only ids and the parts are sent.
 */
export async function repeatVisitPlan(ctx: ServiceContext, input: RepeatVisitPlanInput): Promise<RepeatVisitPlanResult> {
  try {
    assertPerm(ctx.role, "prescriptions:edit");
    assertPerm(ctx.role, "consultations:edit");
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "Failed to repeat the last visit.", "prescriptions.repeat.failed") };
  }
  const parsed = repeatVisitPlanSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: REPEAT_MESSAGES.VALIDATION_FAILED, code: "VALIDATION_FAILED" };
  const { visit_id: visitId, source_visit_id: sourceVisitId, parts, client_request_id: clientRequestId } = parsed.data;

  const outcome = await callCommand(
    ctx,
    "repeat_visit_plan",
    { p_visit_id: visitId, p_source_visit_id: sourceVisitId, p_parts: [...new Set(parts)], p_client_request_id: clientRequestId },
    repeatRpcResultSchema,
    REPEAT_MESSAGES,
    { event: "prescriptions.repeat.failed" }
  );
  if (!outcome.ok) return { success: false, error: outcome.error.message, code: outcome.error.code, reason: outcome.error.reason };

  // The screen takes what the database now holds (it, not the screen, decided what was copied).
  const [rx, dx, skippedItems] = await Promise.all([
    getVisitPrescription(ctx, visitId),
    getVisitDiagnoses(ctx, visitId),
    readSkippedItems(ctx, outcome.value.skipped_item_ids),
  ]);
  return {
    success: true,
    prescriptionId: outcome.value.prescription_id,
    addedItemIds: outcome.value.added_item_ids,
    skippedItemIds: outcome.value.skipped_item_ids,
    skippedItems,
    diagnosesAdded: outcome.value.diagnoses_added,
    replayed: outcome.value.replayed,
    items: rx.success && rx.prescription ? [...rx.prescription.items].sort((a, b) => a.sort_order - b.sort_order) : [],
    diagnoses: dx.success ? (dx.diagnoses as ConsultationDiagnosisItem[]) : [],
  };
}

export type SaveDoctorProtocolTemplateResult =
  | { success: true; templateId: string }
  | { success: false; error: string };

/**
 * Saves a named medication protocol template for the acting doctor.
 */
export async function saveDoctorProtocolTemplate(
  ctx: ServiceContext,
  input: ProtocolTemplateInput
): Promise<SaveDoctorProtocolTemplateResult> {
  try {
    assertPerm(ctx.role, "consultations:edit");
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "Failed to save protocol template.", "prescriptions.save_doctor_protocol_template.failed") };
  }

  const parseResult = protocolTemplateSchema.safeParse(input);
  if (!parseResult.success) {
    return { success: false, error: "Invalid protocol template details." };
  }

  const supabase = ctx.db;

  try {
    const data = parseResult.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error } = await (supabase.from("doctor_prescription_templates") as any)
      .insert({
        tenant_id: ctx.tenantId,
        doctor_id: ctx.userId,
        template_name: data.template_name,
        specialty: data.specialty || null,
        items: data.items,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      log.error({ event: "prescriptions.template_save.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to save protocol template." };
    }

    await recordAudit(ctx, {
      action: "prescription.template_save",
      entityType: "prescription",
      entityId: inserted.id,
      metadata: {
        template_name: data.template_name,
        items_count: data.items.length,
      },
    });

    return { success: true, templateId: inserted.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to save protocol template.", "prescriptions.save_doctor_protocol_template.failed"),
    };
  }
}

export interface DoctorProtocolTemplate {
  id: string;
  template_name: string;
  specialty: string | null;
  items: PrescriptionItemInput[];
  created_at: string;
}

export type GetDoctorProtocolTemplatesResult =
  | { success: true; templates: DoctorProtocolTemplate[] }
  | { success: false; error: string };

/**
 * Fetches the acting doctor's saved protocol templates for the active specialty.
 */
export async function getDoctorProtocolTemplates(
  ctx: ServiceContext,
  specialty?: string
): Promise<GetDoctorProtocolTemplatesResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "consultations:view");

    if (specialty && !SPECIALTY_SLUG.test(specialty)) {
      return { success: false, error: "Invalid specialty." };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from("doctor_prescription_templates") as any)
      .select("id, template_name, specialty, items, created_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("doctor_id", ctx.userId);

    if (specialty) {
      query = query.or(`specialty.eq.${specialty},specialty.is.null`);
    }

    const { data: rows, error } = await query.order("template_name", { ascending: true });

    if (error) {
      return { success: false, error: "Failed to fetch protocol templates." };
    }

    return { success: true, templates: rows ?? [] };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to load protocol templates.", "prescriptions.get_doctor_protocol_templates.failed"),
    };
  }
}

export interface VisitPrescriptionData {
  id: string;
  version: number;
  status: string;
  letterhead_mode: string;
  items: PrescriptionItem[];
}

export type GetVisitPrescriptionResult =
  | { success: true; prescription: VisitPrescriptionData | null }
  | { success: false; error: string };

/**
 * Fetches the active prescription and all medication items for a visit.
 */
export async function getVisitPrescription(ctx: ServiceContext, visitId: string): Promise<GetVisitPrescriptionResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "consultations:view");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rx, error: rxErr } = await (supabase.from("prescriptions") as any)
      .select(`
        id,
        version,
        status,
        letterhead_mode,
        items:prescription_items (
          id,
          prescription_id,
          medicine_name,
          generic_name,
          dose_form,
          dosage,
          timing,
          duration,
          special_instructions,
          cdci_brand_id,
          cdci_generic_id,
          sort_order,
          created_at
        )
      `)
      .eq("visit_id", visitId)
      .eq("tenant_id", ctx.tenantId)
      .eq("status", "active")
      .maybeSingle();

    if (rxErr) {
      log.error({ event: "prescriptions.fetch.failed", code: errorTag(rxErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to load prescription." };
    }

    if (!rx) {
      return { success: true, prescription: null };
    }

    const sortedItems = (rx.items || []).sort(
      (a: PrescriptionItem, b: PrescriptionItem) => a.sort_order - b.sort_order
    );

    return {
      success: true,
      prescription: {
        id: rx.id,
        version: rx.version,
        status: rx.status,
        letterhead_mode: rx.letterhead_mode,
        items: sortedItems,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to load prescription.", "prescriptions.get_visit_prescription.failed"),
    };
  }
}

export type GetPrescriptionPdfSignedUrlResult =
  | { success: true; signedUrl: string; version: number }
  | { success: false; error: string };

/**
 * Compiles and returns a time-limited signed storage URL (5-minute view link, `VIEW_LINK_TTL_SECONDS`)
 * for previewing and printing a prescription in the browser.
 */
export async function getPrescriptionPdfSignedUrl(
  ctx: ServiceContext,
  prescriptionId: string,
  letterheadMode: "blank_paper" | "preprinted_letterhead" = "blank_paper"
): Promise<GetPrescriptionPdfSignedUrlResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "prescriptions:view");

    // 1. Fetch the prescription record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rx, error: rxErr } = await (supabase.from("prescriptions") as any)
      .select("id, visit_id, version")
      .eq("id", prescriptionId)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (rxErr || !rx) {
      return { success: false, error: "Prescription not found or access denied." };
    }

    // 2. The payload every reader shares (V2-09a R-12), for this header and the requested letterhead.
    const source = await loadPrescriptionPdfSource(ctx, rx.visit_id, { prescriptionId: rx.id, letterhead: letterheadMode });
    if (!source) {
      return { success: false, error: "Visit encounter record not found." };
    }

    // 3. A sealed prescription at its own letterhead is read from the write-once archive (archived first when it is missing), its SHA-256 checked, and a
    // 5-minute signed URL of the archived object returned. A draft, an open amendment, a print variant and an archive that fails its check are rendered
    // on demand by the PDF route (no-store, never stored): the link is the route's, which the browser opens with the session.
    if (isArchivable(ctx, source)) {
      const served = await resolvePrescriptionPdf(ctx, source);
      if (served.storagePath) {
        const { signedUrl } = await getSignedUrl(
          { path: served.storagePath, expiresInSeconds: VIEW_LINK_TTL_SECONDS, bucket: "prescriptions" },
          getStorageProviderForDb(ctx.db, "prescriptions")
        );
        return { success: true, signedUrl, version: served.version };
      }
    }
    return {
      success: true,
      signedUrl: `/api/visits/${rx.visit_id}/prescription-pdf?letterhead=${letterheadMode}`,
      version: Number(rx.version),
    };
  } catch (err: unknown) {
    log.error({ event: "prescriptions.pdf_signed_url.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to generate prescription preview."),
    };
  }
}

export type SharePrescriptionViaWhatsAppResult = { success: boolean; shareUrl?: string; token?: string; error?: string };

/**
 * Shares an official prescription via WhatsApp with a 7-day secure tokenized link (/r/[token]).
 * Enqueues Event #6 (prescription_ready) outbox notification.
 */
export async function sharePrescriptionViaWhatsApp(
  ctx: ServiceContext,
  prescriptionId: string
): Promise<SharePrescriptionViaWhatsAppResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "prescriptions:view");

    // 1. Fetch prescription record joined with patient and tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { data: rx, error: rxErr } = await (supabase.from("prescriptions") as any)
      .select("*, patient:patients(id, full_name, phone), tenant:tenants(name, phone)")
      .eq("id", prescriptionId)
      .eq("tenant_id", ctx.tenantId)
      .single();

    if (rxErr || !rx) {
      // Fallback: Check if prescriptionId is actually visitId
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rxByVisit } = await (supabase.from("prescriptions") as any)
          .select("*, patient:patients(id, full_name, phone), tenant:tenants(name, phone)")
          .eq("visit_id", prescriptionId)
          .eq("tenant_id", ctx.tenantId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (rxByVisit) {
          rx = rxByVisit;
          prescriptionId = rxByVisit.id;
          rxErr = null;
        }
      } catch {
        // Ignore fallback lookup error
      }
    }

    if (rxErr || !rx) {
      return { success: false, error: "Prescription not found." };
    }

    if (!rx.patient?.phone) {
      return { success: false, error: "Patient does not have a phone number registered." };
    }

    // 2. Secure 64-character token via create_share_token (tenant from the prescription row, P0-04)
    const created = await createShareToken(supabase, "prescription", rx.id ?? prescriptionId);
    if (!created) {
      return { success: false, error: "Failed to generate secure share link." };
    }
    const { token } = created;

    const baseUrl = serverEnv().NEXT_PUBLIC_APP_URL;
    const shareUrl = `${baseUrl}/r/${token}`;

    // 3. Enqueue Event #6 (prescription_ready)
    // V2-04 04-03a: queued through the enqueue RPC; the job runner sends it (per-row key, R-24).
    await enqueueMessage(ctx, {
      patientId: rx.patient_id,
      channel: "whatsapp",
      messageType: "prescription_ready",
      templateId: "prescription_ready",
      templateParams: {
        patient_name: rx.patient.full_name || "Patient",
        clinic_name: rx.tenant?.name || "Clinic",
        document_url: shareUrl,
      },
      recipientPhone: rx.patient.phone,
      // No token in metadata (AR3-N1); the link in template_params and buttons is redacted after sending.
      metadata: {
        prescription_id: prescriptionId,
        buttons: [
          {
            id: "btn_view_rx",
            text: "View Prescription",
            url: shareUrl,
          },
        ],
      },
    });

    // 4. Record audit log (no token or phone in the audit trail)
    await recordAudit(ctx, {
      action: "prescription.share_whatsapp",
      entityType: "prescription",
      entityId: prescriptionId,
    });

    return { success: true, shareUrl, token };
  } catch (err: unknown) {
    log.error({ event: "prescriptions.whatsapp_share.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to share prescription."),
    };
  }
}

const allergyContextSchema = z.object({
  state: z.enum(["not_recorded", "none", "known"]),
  entitled: z.boolean(),
  allergies: z.array(z.object({ text: z.string(), substance_ids: z.array(z.string()) })),
  items: z.array(z.object({ id: z.string().uuid(), matches: z.array(z.string()), checked_by: z.enum(["substance", "name"]), overridden: z.boolean(), override_reason: z.string().nullable() })),
});

export type GetRxAllergyContextResult = { success: true; context: RxAllergyContext | null } | { success: false; error: string };

/**
 * The allergy picture of a consult (V2-09c 09C-02, R-7): `public.rx_allergy_context` on the caller's own client (INVOKER: RLS applies). `null` when the visit
 * is not in the session's clinic or the caller may not read it. consultations:view; the tenant is the session's.
 */
export async function getRxAllergyContext(ctx: ServiceContext, visitId: string): Promise<GetRxAllergyContextResult> {
  try {
    assertPerm(ctx.role, "consultations:view");
    if (!z.string().uuid().safeParse(visitId).success) return { success: true, context: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.db as any).rpc("rx_allergy_context", { p_tenant_id: ctx.tenantId, p_visit_id: visitId });
    if (error) throw error;
    if (data == null) return { success: true, context: null };
    const parsed = allergyContextSchema.safeParse(data);
    if (!parsed.success) throw new Error("rx_allergy_context returned an unexpected shape");
    return {
      success: true,
      context: {
        state: parsed.data.state,
        entitled: parsed.data.entitled,
        allergies: parsed.data.allergies.map((a) => ({ text: a.text, substanceIds: a.substance_ids })),
        items: parsed.data.items.map((i) => ({ id: i.id, matches: i.matches, checkedBy: i.checked_by, overridden: i.overridden, overrideReason: i.override_reason })),
      },
    };
  } catch (err: unknown) {
    return { success: false, error: clientErrorMessage(err, "Failed to load the allergy check.", "prescriptions.allergy_context.failed") };
  }
}
