import { z } from "zod";
import type { PrescriptionItem } from "@/lib/db/types";
import { clinicalContent } from "@/lib/db/clinical-notes";
import type { ConsultationDiagnosisItem } from "@/features/terminology/schema";
import type {
  Vitals,
  ChiefComplaintItem,
  ClinicalSpecialty,
  SpecialtyData,
  FollowUpInput,
} from "./schema";
import { parseAssistContext, type AssistContext } from "./assist-ranking";
import { parsePatientSnapshot, type PatientSnapshot } from "./snapshot";
import { recordState, type RecordState } from "./record-state";
import type { DoctorMacro } from "./macros";
import type { PastVisitEncounter } from "./service";
import {
  parseRxAllergyContext,
  type RxAllergyContext,
} from "@/features/prescriptions/allergy";
import type { PrescriptionItemInput } from "@/features/prescriptions/schema";
import type { ConsultDocument } from "@/features/labs/consult-documents";

/**
 * The consult's one read as the screen uses it (V2-09e 09E-05, R-8, R-9): `public.consult_screen(tenant, visit)` answers one jsonb with every part the
 * consult page used to read in 14 sequential calls; this module parses it (zod, a part that is not the documented shape is dropped, never guessed) and
 * builds the view model the workspace takes. Pure: no I/O, no React, safe to import from a client component (types) and from the server page.
 *
 * The record-state rules stay in TypeScript (`recordState`): the learned order, the macros and the follow-up instants are applied again here for an
 * editable record only (the database reads them for the same predicate; the page's rule is the one that decides what the screen shows).
 */

/** The doctor's own lists, held in the consult's query (memory only) for its lifetime (R-8). Nothing here is another doctor's. */
export interface ConsultLists {
  custom_medicines: Array<{
    medicine_name: string;
    generic_name: string | null;
    dose_form: string | null;
    default_dosage: string | null;
    default_timing: string | null;
    default_duration: string | null;
    use_count: number;
  }>;
  custom_diagnoses: Array<{
    diagnosis_name: string;
    specialty: string | null;
    use_count: number;
  }>;
  templates: ConsultTemplate[];
}

/** One saved prescription template (`doctor_prescription_templates`): what `getDoctorProtocolTemplates` returns. */
export interface ConsultTemplate {
  id: string;
  template_name: string;
  specialty: string | null;
  items: PrescriptionItemInput[];
  created_at: string;
}

/** What the consult's query holds: the doctor's lists and the reads that rank them. Updated with `setQueryData` from each save's result. */
export interface ConsultQueryData {
  /** `null`: the role keeps no lists (a nurse); the Templates sheet then shows none. */
  lists: ConsultLists | null;
  macros: DoctorMacro[];
  assistContext: AssistContext | null;
  rxAssistContext: AssistContext | null;
}

export interface ConsultVisitView {
  id: string;
  patient_id: string;
  doctor_id: string;
  status: string;
  scheduled_at: string | null;
  token_number: number | null;
  vitals: Vitals | null;
  chief_complaints: ChiefComplaintItem[] | null;
  clinical_notes: string | null;
  specialty: ClinicalSpecialty;
  specialty_data: SpecialtyData | null;
  investigations_advised: string[];
  advice: string[];
  follow_up: FollowUpInput | null;
  diagnoses: ConsultationDiagnosisItem[];
  prescription_items: PrescriptionItem[];
  signed_at: string | null;
  current_revision: number;
  draft_version: number;
  prescription_version: number | null;
  amendment_reason: string | null;
  amendment_opened_at: string | null;
}

export interface ConsultPatientView {
  id: string;
  full_name: string;
  phone: string;
  whatsapp_opt_out: boolean;
  gender: "male" | "female" | "other" | null;
  date_of_birth: string | null;
  age: number | null;
  allergies: string[] | null;
  chronic_conditions: string[];
  uhid: string | null;
}

/** The view model of the consult: every prop the workspace reads from the database. */
export interface ConsultScreen {
  visit: ConsultVisitView;
  patient: ConsultPatientView;
  pastEncounters: PastVisitEncounter[];
  assist: Record<string, boolean>;
  assistContext: AssistContext | null;
  rxAssistContext: AssistContext | null;
  snapshot: PatientSnapshot | null;
  macros: DoctorMacro[];
  upcomingVisits: string[];
  documents: ConsultDocument[] | null;
  allergyContext: RxAllergyContext | null;
  lists: ConsultLists | null;
}

// The parts, parsed ------------------------------------------------------------------------------------------------------------------------

const nullableString = z.string().nullable();
const jsonBlob = z.unknown();

const visitSchema = z.object({
  id: z.string(),
  patient_id: z.string(),
  doctor_id: z.string(),
  status: z.string(),
  scheduled_at: nullableString,
  specialty: nullableString,
  signed_at: nullableString,
  current_revision: z.number().nullable(),
});

const patientSchema = z.object({
  id: z.string(),
  full_name: z.string(),
  phone: z.string(),
  whatsapp_opt_out: z.boolean().nullable(),
  sex: nullableString,
  date_of_birth: nullableString,
  age: z.number().nullable(),
  allergies: z.array(z.string()).nullable(),
  chronic_conditions: z.array(z.string()).nullable(),
  national_health_id: nullableString,
});

const diagnosisRowSchema = z.object({
  id: z.string(),
  visit_id: z.string(),
  patient_id: z.string(),
  diagnosis_name: z.string(),
  snomed_concept_id: nullableString,
  icd11_code: nullableString,
  is_custom: z.boolean(),
  is_chronic: z.boolean(),
  notes: nullableString,
  created_at: z.string(),
});

const historyItemSchema = z
  .object({
    id: z.string(),
    prescription_id: z.string(),
    medicine_name: z.string(),
    dosage: z.string(),
    sort_order: z.number(),
  })
  .passthrough();

const historyEncounterSchema = z.object({
  id: z.string(),
  scheduled_at: nullableString,
  created_at: z.string(),
  status: z.string(),
  signed_at: nullableString,
  specialty: z.string(),
  notes: z
    .object({
      vitals: jsonBlob,
      chief_complaints: jsonBlob,
      clinical_notes: z.string().nullable(),
      advice: jsonBlob,
    })
    .nullable(),
  diagnoses: z.array(
    z
      .object({
        id: z.string(),
        diagnosis_name: z.string(),
        icd11_code: nullableString,
        snomed_concept_id: nullableString,
        is_chronic: z.boolean(),
      })
      .passthrough()
  ),
  prescriptions: z.array(
    z.object({
      id: z.string(),
      version: z.number(),
      items: z.array(historyItemSchema),
    })
  ),
});

const macroSchema = z.object({
  id: z.string().uuid(),
  shortcut: z.string(),
  expansion: z.string(),
});

const documentSchema = z.object({
  id: z.string(),
  visit_id: nullableString,
  title: z.string(),
  original_filename: z.string(),
  mime_type: z.string(),
  file_size_bytes: z.number(),
  report_date: z.string(),
  created_at: z.string(),
});

const listsSchema = z.object({
  custom_medicines: z.array(
    z.object({
      medicine_name: z.string(),
      generic_name: nullableString,
      dose_form: nullableString,
      default_dosage: nullableString,
      default_timing: nullableString,
      default_duration: nullableString,
      use_count: z.number(),
    })
  ),
  custom_diagnoses: z.array(
    z.object({
      diagnosis_name: z.string(),
      specialty: nullableString,
      use_count: z.number(),
    })
  ),
  templates: z.array(
    z.object({
      id: z.string(),
      template_name: z.string(),
      specialty: nullableString,
      items: z.array(z.unknown()),
      created_at: z.string(),
    })
  ),
});

const screenSchema = z.object({
  visit: visitSchema,
  patient: patientSchema,
  notes: z.record(z.string(), z.unknown()).nullable().optional(),
  token_number: z.number().nullable().optional(),
  follow_up: z
    .object({ follow_up_date: z.string(), notes: nullableString })
    .nullable()
    .optional(),
  diagnoses: z.array(diagnosisRowSchema),
  prescription: z.object({
    items: z.array(z.record(z.string(), z.unknown())),
    latest_version: z.number().nullable(),
  }),
  amendment: z
    .object({ reason: nullableString, opened_at: nullableString })
    .nullable()
    .optional(),
  history: z.array(historyEncounterSchema),
  entitlements: z.record(z.string(), z.boolean()),
  assist_context: z.unknown().optional(),
  snapshot: z.unknown().optional(),
  macros: z.array(macroSchema).optional(),
  upcoming: z.array(z.string()).optional(),
  documents: z.array(documentSchema).optional(),
  allergy_context: z.unknown().optional(),
  my_lists: listsSchema.nullable().optional(),
});

/** A visit the learned order, the macros and the follow-up instants are read for: amending, or a draft that is not completed or cancelled. */
export function isEditableRecord(visit: {
  status: string;
  signed_at: string | null;
}): boolean {
  const state: RecordState = recordState(visit);
  return (
    state === "amending" ||
    (state !== "sealed" &&
      visit.status !== "completed" &&
      visit.status !== "cancelled")
  );
}

/** The history rows as the drawer's encounters (the shape `getPatientConsultationHistory` returns). */
function toEncounter(
  row: z.infer<typeof historyEncounterSchema>
): PastVisitEncounter {
  const notes = row.notes;
  return {
    visitId: row.id,
    date: row.scheduled_at || row.created_at,
    status: row.status,
    signedAt: row.signed_at ?? null,
    specialty: row.specialty,
    vitals: (notes?.vitals as Vitals | null | undefined) || null,
    chiefComplaints:
      (notes?.chief_complaints as ChiefComplaintItem[] | null | undefined) ||
      [],
    clinicalNotes: notes?.clinical_notes || null,
    advice: (notes?.advice as string[] | null | undefined) || [],
    diagnoses: row.diagnoses.map((d) => ({
      id: d.id,
      diagnosis_name: d.diagnosis_name,
      icd11_code: d.icd11_code || null,
      snomed_concept_id: d.snomed_concept_id || null,
      is_chronic: d.is_chronic,
    })),
    prescriptions: row.prescriptions.map((r) => ({
      id: r.id,
      version: r.version,
      items:
        r.items as unknown as PastVisitEncounter["prescriptions"][0]["items"],
    })),
  };
}

/**
 * Builds the consult's view model from `consult_screen`'s answer. `null` when the answer is NULL (the visit is not readable: the page answers 404) or not
 * the documented shape. `canEdit` is the role's `consultations:edit` (the page's own check, repeated: the learned order and the macros are only ever for
 * an editor on an editable record).
 */
export function buildConsultScreen(
  raw: unknown,
  options: { canEdit: boolean }
): ConsultScreen | null {
  if (raw === null || raw === undefined) return null;
  const parsed = screenSchema.safeParse(raw);
  if (!parsed.success) return null;
  const s = parsed.data;

  const editable = isEditableRecord(s.visit);
  const state = recordState(s.visit);
  const assist = s.entitlements;
  const mayAssist = editable && options.canEdit;
  const wantsTerminology = mayAssist && assist["assist.terminology"] === true;
  const wantsRxAssist = mayAssist && assist["assist.frequent_rx"] === true;
  const learned =
    wantsTerminology || wantsRxAssist
      ? parseAssistContext(s.assist_context)
      : null;

  const notes = clinicalContent(
    s.notes as Parameters<typeof clinicalContent>[0]
  );
  const patient = s.patient;

  const visit: ConsultVisitView = {
    id: s.visit.id,
    patient_id: s.visit.patient_id,
    doctor_id: s.visit.doctor_id,
    status: s.visit.status,
    scheduled_at: s.visit.scheduled_at,
    token_number: s.token_number ?? null,
    vitals: (notes.vitals as Vitals | null) ?? null,
    chief_complaints:
      (notes.chief_complaints as ChiefComplaintItem[] | null) ?? null,
    clinical_notes: notes.clinical_notes,
    specialty: (s.visit.specialty as ClinicalSpecialty) ?? "general_physician",
    specialty_data: (notes.specialty_data as SpecialtyData | null) ?? null,
    investigations_advised: notes.investigations_advised ?? [],
    advice: notes.advice ?? [],
    follow_up: s.follow_up
      ? ({
          follow_up_date: s.follow_up.follow_up_date,
          notes: s.follow_up.notes,
        } as FollowUpInput)
      : null,
    diagnoses: s.diagnoses,
    prescription_items: s.prescription.items as unknown as PrescriptionItem[],
    signed_at: s.visit.signed_at ?? null,
    current_revision: s.visit.current_revision ?? 1,
    draft_version: (s.notes?.draft_version as number | undefined) ?? 0,
    prescription_version: s.prescription.latest_version ?? null,
    amendment_reason:
      state === "amending" ? (s.amendment?.reason ?? null) : null,
    amendment_opened_at:
      state === "amending" ? (s.amendment?.opened_at ?? null) : null,
  };

  return {
    visit,
    patient: {
      id: patient.id,
      full_name: patient.full_name,
      phone: patient.phone,
      whatsapp_opt_out: patient.whatsapp_opt_out === true,
      gender:
        patient.sex === "male" ||
        patient.sex === "female" ||
        patient.sex === "other"
          ? patient.sex
          : null,
      date_of_birth: patient.date_of_birth,
      age: patient.age,
      // `null` is "not recorded" and `[]` "recorded none": the allergy strip draws the two differently.
      allergies: patient.allergies ?? null,
      chronic_conditions: patient.chronic_conditions ?? [],
      uhid:
        patient.national_health_id ||
        (patient.id ? patient.id.slice(0, 8).toUpperCase() : null),
    },
    // The visit on screen is never in its own history (the database leaves it out; the filter is the old page's, kept).
    pastEncounters: s.history
      .filter((h) => h.id !== s.visit.id)
      .map(toEncounter),
    assist,
    assistContext: wantsTerminology ? learned : null,
    rxAssistContext: wantsRxAssist ? learned : null,
    snapshot:
      assist["assist.snapshot"] === true && s.snapshot != null
        ? parsePatientSnapshot(s.snapshot)
        : null,
    macros:
      mayAssist && assist["assist.shorthand"] === true ? (s.macros ?? []) : [],
    upcomingVisits:
      editable && assist["assist.followup"] === true ? (s.upcoming ?? []) : [],
    documents: s.documents ? (s.documents as ConsultDocument[]) : null,
    allergyContext:
      s.allergy_context != null
        ? parseRxAllergyContext(s.allergy_context)
        : null,
    lists: s.my_lists
      ? { ...s.my_lists, templates: s.my_lists.templates as ConsultTemplate[] }
      : null,
  };
}

/** The part of the view model the consult's query holds (the doctor's lists and what ranks them). */
export function consultQueryData(screen: ConsultScreen): ConsultQueryData {
  return {
    lists: screen.lists,
    macros: screen.macros,
    assistContext: screen.assistContext,
    rxAssistContext: screen.rxAssistContext,
  };
}

/** A saved template joins the list in name order, as the database lists them (the action's result, no re-read). */
export function withTemplate(
  data: ConsultQueryData,
  template: ConsultTemplate
): ConsultQueryData {
  const lists = data.lists ?? {
    custom_medicines: [],
    custom_diagnoses: [],
    templates: [],
  };
  const templates = [
    ...lists.templates.filter((t) => t.id !== template.id),
    template,
  ].sort((a, b) =>
    a.template_name < b.template_name
      ? -1
      : a.template_name > b.template_name
        ? 1
        : a.id < b.id
          ? -1
          : 1
  );
  return { ...data, lists: { ...lists, templates } };
}

/** The macro list after an edit (the macro dialog's own result). */
export function withMacros(
  data: ConsultQueryData,
  macros: DoctorMacro[]
): ConsultQueryData {
  return { ...data, macros };
}
