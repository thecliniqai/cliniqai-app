import type { ExamPrintLines } from "@/features/consultation/exam-text";

/**
 * The content of a printed prescription (V2-09a 09A-03, V2-09c 09C-04): one payload, built by `loadPrescriptionPdfSource`, read by the PDF document, the
 * print view and the content builder. Pure data, isomorphic: nothing here imports a renderer.
 */
export type RxPaperSize = "A4" | "A5";

export interface PrescriptionPdfPayload {
  tenant_id: string;
  visit_id: string;
  prescription_id: string;
  version: number;
  letterhead_mode: "blank_paper" | "preprinted_letterhead";
  /**
   * V2-09c 09C-04 (R-12): the paper the version was created for (`prescriptions.paper_size`, frozen at its creation); A4 when absent. A print variant on another
   * paper is rendered on demand and never archived, like another letterhead.
   */
  paper_size?: RxPaperSize;
  /**
   * V2-09c 09C-04 (R-12): the clinic's pre-printed stationery margins in points (`tenants.letterhead_top_margin`, `letterhead_bottom_margin`): nothing is printed
   * inside them in pre-printed mode. Null/absent: the defaults (110 and 60). Read at render time: they describe the clinic's paper, not the document.
   */
  letterhead_margins?: { top: number; bottom: number } | null;
  /** The clinic's IANA zone (`tenants.timezone`): every date the Rx prints is read in it (ADR-016), never in the zone of the server. */
  timezone?: string;
  amended_at?: string | null;
  amendment_reason?: string | null;
  signed_at?: string | null;
  /**
   * V2-09a 09A-06a (review S-8): set only on an on-demand render served in place of a missing or failed archive; printed as a visible line so the copy
   * is never mistaken for the archived signed original. Never set on an archived rendering.
   */
  regenerated_notice?: string | null;

  clinic: {
    name: string;
    address?: string | null;
    phone?: string | null;
    registration_number?: string | null;
    logo_url?: string | null;
    clinical_establishment_reg_no?: string | null;
    state_medical_council_reg_no?: string | null;
    gstin?: string | null;
    drug_license_no?: string | null;
  };

  doctor: {
    name: string;
    qualifications?: string | null;
    medical_council_reg_no?: string | null;
    signature_url?: string | null;
  };

  patient: {
    full_name: string;
    /** The age stored at registration: printed only when there is no date of birth (09C-06a, A-9). */
    age?: number | null;
    /** `YYYY-MM-DD`: the printed age is computed from it at the Rx date in the clinic's zone (09C-06a, A-9). */
    date_of_birth?: string | null;
    sex?: "male" | "female" | "other" | null;
    phone?: string | null;
    address?: string | null;
    abha_id?: string | null;
    uhid?: string | null;
  };

  visit: {
    visit_date: string;
    vitals?: {
      systolic?: number | null;
      diastolic?: number | null;
      pulse?: number | null;
      temperature?: number | null;
      spo2?: number | null;
      weight?: number | null;
      height?: number | null;
      bmi?: number | null;
    } | null;
    chief_complaints?: {
      symptom: string;
      duration_val?: number;
      duration_unit?: string;
    }[];
    clinical_notes?: string | null;
    specialty?: string;
    specialty_notes?: string | null;
    /** V2-09c 09C-04 (09B R-14): the structured exam as print lines (`examPrintLines`); null when nothing was entered. */
    exam?: ExamPrintLines | null;
  };

  diagnoses: {
    diagnosis_name: string;
    icd11_code?: string | null;
    snomed_concept_id?: string | null;
  }[];

  medications: {
    medicine_name: string;
    generic_name?: string | null;
    dose_form?: string | null;
    dosage: string;
    timing?: string | null;
    duration: string;
    special_instructions?: string | null;
    quantity?: number | string | null;
  }[];

  investigations_advised?: string[];
  advice?: string[];
  follow_up_date?: string | null;
}

