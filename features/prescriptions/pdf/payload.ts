import "server-only";

import type { ServiceContext } from "@/lib/auth/context";
import { clinicalNotesEmbed, withClinicalNotes } from "@/lib/db/clinical-notes";
import { resolveTimeZone, ymdOf } from "@/lib/datetime";
import { examPrintLines } from "@/features/consultation/exam-text";
import type { PrescriptionPdfPayload, RxPaperSize } from "./types";

/**
 * The one builder of a prescription PDF's content (V2-09a 09A-03, R-12): the archive at sign-off and at finalize, the PDF route and the
 * in-app preview all render the same payload, so the bytes archived are what every reader would render. It replaces three private copies
 * (`features/consultation/service.ts`, the route, `features/prescriptions/service.ts`).
 *
 * Differences from the copies it replaces, on purpose:
 *  - the doctor's name is the membership's own `full_name` for the visit's doctor (the route used the signed-in caller's name when the
 *    membership had none, which made the bytes depend on who opened the PDF; the two service copies printed the literal "Doctor"); the
 *    fallback is "Doctor" and never the caller;
 *  - the clinic's statutory registration fields are read here (the generator used to enrich a payload that lacked them), so rendering is pure;
 *  - `signed_at` is the header's own signature (the version's), then the visit's.
 */

/** The header row the payload was built for, with what the archive and the read path need to decide what to do. */
export interface PrescriptionPdfHeader {
  id: string;
  version: number;
  status: string;
  signed_at: string | null;
  letterhead_mode: "blank_paper" | "preprinted_letterhead";
  /** The paper the version was created for (frozen at its creation, 000117). */
  paper_size: RxPaperSize;
  pdf_storage_path: string | null;
  pdf_sha256: string | null;
}

export interface PrescriptionPdfSource {
  payload: PrescriptionPdfPayload;
  /** The header the payload is about: the one named by `prescriptionId`, else the visit's latest version; null when the visit has none. */
  header: PrescriptionPdfHeader | null;
  /** `signed_by`: the visit's signer, the only one who archives its Rx (ruling R-A, 09A-06a). */
  visit: { status: string; signed_at: string | null; signed_by: string | null };
}

export interface PrescriptionPdfSourceOptions {
  /** A specific header of the visit (the in-app preview names one); default: the latest version. */
  prescriptionId?: string;
  /** Another letterhead than the header's: a print variant, rendered on demand and never archived. */
  letterhead?: "blank_paper" | "preprinted_letterhead";
  /** Another paper than the header's: a print variant, rendered on demand and never archived (V2-09c R-12). */
  paper?: RxPaperSize;
  /** When given, the result is null unless the header is at this version (a replayed command whose version has been superseded). */
  version?: number;
}

/**
 * Loads the visit's prescription and everything the PDF prints, under the caller's own client (RLS applies). Null when the visit is not
 * visible in the acting clinic, or when `version` is given and the header is at another one.
 */
export async function loadPrescriptionPdfSource(
  ctx: ServiceContext,
  visitId: string,
  options: PrescriptionPdfSourceOptions = {}
): Promise<PrescriptionPdfSource | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = ctx.db as any;
  const tenantId = ctx.tenantId;

  const { data: visitRow } = await db
    .from("visits")
    .select(`*, ${clinicalNotesEmbed()}`)
    .eq("id", visitId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!visitRow) return null;
  // The clinical content comes from clinical_notes (V2-05 05-02a).
  const visit = withClinicalNotes(visitRow);

  let headerQuery = db
    .from("prescriptions")
    .select("id, version, status, letterhead_mode, paper_size, amendment_reason, signed_at, pdf_storage_path, pdf_sha256")
    .eq("visit_id", visitId)
    .eq("tenant_id", tenantId);
  if (options.prescriptionId) headerQuery = headerQuery.eq("id", options.prescriptionId);
  const { data: rx } = await headerQuery.order("version", { ascending: false }).limit(1).maybeSingle();
  if (options.prescriptionId && !rx) return null;
  if (options.version !== undefined && rx && Number(rx.version) !== options.version) return null;

  const [{ data: tenant }, { data: patient }, { data: doctorMember }, { data: diagnoses }, { data: followUp }] = await Promise.all([
    db
      .from("tenants")
      .select(
        "name, address, phone, registration_number, logo_url, timezone, letterhead_top_margin, letterhead_bottom_margin, clinical_establishment_reg_no, state_medical_council_reg_no, gstin, drug_license_no"
      )
      .eq("id", tenantId)
      .maybeSingle(),
    db
      .from("patients")
      .select("full_name, age, sex, phone, address, abha_id")
      .eq("id", visit.patient_id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    db
      .from("memberships")
      .select("full_name, qualifications, medical_council_reg_no")
      .eq("tenant_id", tenantId)
      .eq("user_id", visit.doctor_id)
      .maybeSingle(),
    db
      .from("consultation_diagnoses")
      .select("diagnosis_name, icd11_code, snomed_concept_id")
      .eq("visit_id", visitId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
    db.from("follow_ups").select("follow_up_date").eq("visit_id", visitId).eq("tenant_id", tenantId).maybeSingle(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let items: any[] = [];
  if (rx?.id) {
    const { data: rxItems } = await db
      .from("prescription_items")
      .select("medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, sort_order")
      .eq("prescription_id", rx.id)
      .order("sort_order", { ascending: true });
    items = rxItems || [];
  }

  const headerLetterhead: "blank_paper" | "preprinted_letterhead" =
    rx?.letterhead_mode === "preprinted_letterhead" ? "preprinted_letterhead" : "blank_paper";

  const headerPaper: RxPaperSize = rx?.paper_size === "A5" ? "A5" : "A4";
  const zone = resolveTimeZone(tenant?.timezone);

  const payload: PrescriptionPdfPayload = {
    tenant_id: tenantId,
    visit_id: visit.id,
    prescription_id: rx?.id || "",
    version: rx?.version || 1,
    letterhead_mode: options.letterhead ?? headerLetterhead,
    paper_size: options.paper ?? headerPaper,
    letterhead_margins:
      typeof tenant?.letterhead_top_margin === "number" && typeof tenant?.letterhead_bottom_margin === "number"
        ? { top: tenant.letterhead_top_margin, bottom: tenant.letterhead_bottom_margin }
        : null,
    timezone: zone,
    amendment_reason: rx?.amendment_reason || null,
    signed_at: rx?.signed_at || visit.signed_at || null,
    clinic: {
      name: tenant?.name || "Clinic",
      address: tenant?.address || null,
      phone: tenant?.phone || null,
      registration_number: tenant?.registration_number || null,
      logo_url: tenant?.logo_url || null,
      clinical_establishment_reg_no: tenant?.clinical_establishment_reg_no ?? null,
      state_medical_council_reg_no: tenant?.state_medical_council_reg_no ?? null,
      gstin: tenant?.gstin ?? null,
      drug_license_no: tenant?.drug_license_no ?? null,
    },
    doctor: {
      name: doctorMember?.full_name || "Doctor",
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
      uhid: String(visit.patient_id).slice(0, 8).toUpperCase(),
    },
    visit: {
      visit_date: ymdOf(visit.scheduled_at || visit.created_at || new Date(), zone),
      vitals: visit.vitals || null,
      chief_complaints: (visit.chief_complaints || []) as PrescriptionPdfPayload["visit"]["chief_complaints"],
      clinical_notes: visit.clinical_notes || null,
      specialty: visit.specialty || "general_physician",
      exam: examPrintLines(visit.specialty_data),
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

  return {
    payload,
    header: rx
      ? {
          id: rx.id,
          version: Number(rx.version),
          status: rx.status,
          signed_at: rx.signed_at ?? null,
          letterhead_mode: headerLetterhead,
          paper_size: headerPaper,
          pdf_storage_path: rx.pdf_storage_path ?? null,
          pdf_sha256: rx.pdf_sha256 ?? null,
        }
      : null,
    visit: { status: visit.status, signed_at: visit.signed_at ?? null, signed_by: visit.signed_by ?? null },
  };
}

/** The payload only (see {@link loadPrescriptionPdfSource}); null when the visit is not visible or `version` does not match. */
export async function buildPrescriptionPdfPayload(
  ctx: ServiceContext,
  visitId: string,
  options: PrescriptionPdfSourceOptions = {}
): Promise<PrescriptionPdfPayload | null> {
  return (await loadPrescriptionPdfSource(ctx, visitId, options))?.payload ?? null;
}
