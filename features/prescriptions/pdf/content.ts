import { clinicDateText, DEFAULT_CLINIC_TZ, isYmd, resolveTimeZone, ymdOf } from "@/lib/datetime";
import { formatAge } from "@/lib/ui/age";
import type { PrescriptionPdfPayload, RxPaperSize } from "./types";

/**
 * The words of a printed prescription (V2-09c 09C-04, R-12; DESIGN_SYSTEM §7.6 "Print: the same order and wording as on screen"). Pure and isomorphic: the PDF
 * document (`@react-pdf/renderer`) and the print view (HTML, `@media print`) both read this one structure, so the two renderings say the same thing in the
 * same order, and the golden text files of the PDF are also the contract of the print view.
 *
 * Nothing is invented. A medicine with no stored timing prints no timing (the retired template printed "After food"); a complaint prints a duration only when it
 * has one; the clinic's product name is the footer's existing line (Q-9 ruling: unchanged), and the page line "Rx v{n} · Page x of y" is added beside it.
 * Dates are read in the clinic's zone (ADR-016) from a fixed month table, so the same instant prints the same text on every server.
 */

export interface RxContentMedication {
  n: number;
  name: string;
  generic: string | null;
  note: string | null;
  dosage: string;
  timing: string;
  duration: string;
}

export interface RxContent {
  /** The version's document title and file base: never the patient's name (PWA D-7). */
  title: string;
  version: number;
  paper: RxPaperSize;
  preprinted: boolean;
  /** The "Regenerated copy" line (review S-8), when this is a regenerated copy. */
  regenerated: string | null;
  amendment: { title: string; reason: string | null } | null;
  /** The clinic and doctor block, printed on blank paper only (pre-printed stationery carries its own). */
  letterhead: { clinicName: string; address: string | null; contact: string; statutory: string | null; doctorName: string; doctorMeta: string } | null;
  patient: { line: string; date: string; contact: string; visitId: string };
  vitals: { label: string; value: string }[];
  complaints: string[];
  exam: { general: string | null; abnormal: string[]; normal: string | null } | null;
  diagnoses: string[];
  medications: RxContentMedication[];
  investigations: string[];
  advice: string[];
  followUp: string | null;
  signature: { doctor: string; reg: string | null; signedOn: string };
  /** The product line on the left of the footer (blank paper only); the page line on the right is `pageLine(page, total)`. */
  footerLeft: string;
  /** The continuation line of page 2 and later. */
  continuation: (page: number, total: number) => string;
  pageLine: (page: number, total: number) => string;
}

/** The file name a download carries: the visit's date and the version, no patient name (PWA D-7). */
export function rxFileName(payload: Pick<PrescriptionPdfPayload, "visit" | "version">): string {
  return `Prescription-${payload.visit.visit_date}-v${payload.version}.pdf`;
}

/**
 * 09C-06a (A-9): the printed age. From the date of birth at the Rx date (the signature's date in the clinic's zone, else the visit's date): "35y", below two
 * years in months ("8m"), below one month in days ("12d"). Only without a date of birth the age stored at registration ("35y"; a stored 0 is "under 1y",
 * never nothing). Null when neither is known.
 */
export function rxAgeText(p: Pick<PrescriptionPdfPayload["patient"], "age" | "date_of_birth">, rxDateYmd: string): string | null {
  if (p.date_of_birth && isYmd(p.date_of_birth)) {
    const text = formatAge(p.date_of_birth, rxDateYmd);
    if (text) return text.replace(" ", "");
  }
  if (typeof p.age === "number" && p.age >= 0) return p.age === 0 ? "under 1y" : `${p.age}y`;
  return null;
}

function patientLine(p: PrescriptionPdfPayload["patient"], age: string | null): string {
  const parts = [age, p.sex ? p.sex.toUpperCase() : null].filter(Boolean);
  return `Patient: ${p.full_name}${parts.length > 0 ? ` (${parts.join(" ")})` : ""}`;
}

/** "Patient name (35y MALE)" for the continuation line, as before. */
function continuationPatient(p: PrescriptionPdfPayload["patient"], age: string | null): string {
  return `${p.full_name}${age ? ` (${age}` : ""}${p.sex ? ` ${p.sex.toUpperCase()})` : age ? ")" : ""}`;
}

export function buildRxContent(payload: PrescriptionPdfPayload): RxContent {
  const tz = resolveTimeZone(payload.timezone ?? DEFAULT_CLINIC_TZ);
  const preprinted = payload.letterhead_mode === "preprinted_letterhead";
  const isAmended = payload.version > 1 || Boolean(payload.amendment_reason);
  // A-9: the age at the Rx date (the signature's date in the clinic's zone, else the visit's date).
  const age = rxAgeText(payload.patient, payload.signed_at ? ymdOf(payload.signed_at, tz) : payload.visit.visit_date);

  const vitals = payload.visit.vitals;
  const vitalRows: { label: string; value: string }[] = [];
  if (vitals) {
    if (vitals.systolic != null && vitals.diastolic != null) vitalRows.push({ label: "BP", value: `${vitals.systolic}/${vitals.diastolic} mmHg` });
    if (vitals.pulse != null) vitalRows.push({ label: "Pulse", value: `${vitals.pulse} bpm` });
    if (vitals.temperature != null) vitalRows.push({ label: "Temp", value: `${vitals.temperature}°F` });
    if (vitals.spo2 != null) vitalRows.push({ label: "SpO2", value: `${vitals.spo2}%` });
    if (vitals.weight != null) vitalRows.push({ label: "Weight", value: `${vitals.weight} kg` });
    const bmi =
      vitals.bmi != null ? vitals.bmi.toFixed(1) : vitals.weight && vitals.height ? (vitals.weight / Math.pow(vitals.height / 100, 2)).toFixed(1) : null;
    if (bmi) vitalRows.push({ label: "BMI", value: bmi });
  }

  const c = payload.clinic;
  const statutory = [
    c.clinical_establishment_reg_no ? `CEA: ${c.clinical_establishment_reg_no}` : null,
    c.state_medical_council_reg_no ? `SMC: ${c.state_medical_council_reg_no}` : null,
    c.gstin ? `GSTIN: ${c.gstin}` : null,
    c.drug_license_no ? `DL: ${c.drug_license_no}` : null,
  ].filter(Boolean);

  const signedOn = payload.signed_at ? clinicDateText(payload.signed_at, tz) : payload.visit.visit_date;
  const visitDate = payload.visit.visit_date;

  return {
    title: `Prescription v${payload.version}`,
    version: payload.version,
    paper: payload.paper_size === "A5" ? "A5" : "A4",
    preprinted,
    regenerated: payload.regenerated_notice ?? null,
    amendment: isAmended
      ? {
          title: `AMENDED PRESCRIPTION (v${payload.version})${payload.amended_at ? ` • ${clinicDateText(payload.amended_at, tz)}` : ""}`,
          reason: payload.amendment_reason ? `Reason: ${payload.amendment_reason}` : null,
        }
      : null,
    letterhead: preprinted
      ? null
      : {
          clinicName: c.name,
          address: c.address ?? null,
          contact: `${c.phone ? `Phone: ${c.phone}` : ""}${c.registration_number ? ` • Reg No: ${c.registration_number}` : ""}`,
          statutory: statutory.length > 0 ? statutory.join(" | ") : null,
          doctorName: `Dr. ${payload.doctor.name}`,
          doctorMeta: `${payload.doctor.qualifications || "Consultant"}${payload.doctor.medical_council_reg_no ? ` • Reg No: ${payload.doctor.medical_council_reg_no}` : ""}`,
        },
    patient: {
      line: patientLine(payload.patient, age),
      date: `Date: ${visitDate}`,
      contact: `Phone: ${payload.patient.phone || "N/A"}${payload.patient.uhid ? ` • UHID: ${payload.patient.uhid}` : ""}${payload.patient.abha_id ? ` • ABHA: ${payload.patient.abha_id}` : ""}`,
      visitId: `Visit ID: ${payload.visit_id.slice(0, 8).toUpperCase()}`,
    },
    vitals: vitalRows,
    complaints: (payload.visit.chief_complaints ?? []).map((cc) => `${cc.symptom}${cc.duration_val ? ` (${cc.duration_val}${cc.duration_unit ? ` ${cc.duration_unit}` : ""})` : ""}`),
    exam: payload.visit.exam ?? null,
    diagnoses: (payload.diagnoses ?? []).map((d) => `${d.diagnosis_name}${d.icd11_code ? ` [ICD-11: ${d.icd11_code}]` : ""}`),
    medications: payload.medications.map((m, i) => ({
      n: i + 1,
      name: `${m.medicine_name}${m.dose_form ? ` (${m.dose_form})` : ""}`,
      generic: m.generic_name || null,
      note: m.special_instructions ? `Note: ${m.special_instructions}` : null,
      dosage: m.dosage,
      // Never a default: a timing the doctor did not choose prints as nothing (R-4, R-12).
      timing: m.timing ?? "",
      duration: m.duration,
    })),
    investigations: payload.investigations_advised ?? [],
    advice: payload.advice ?? [],
    followUp: payload.follow_up_date ? `Review on: ${payload.follow_up_date}` : null,
    signature: {
      doctor: `Dr. ${payload.doctor.name}`,
      reg: payload.doctor.medical_council_reg_no ? `Reg No: ${payload.doctor.medical_council_reg_no}` : null,
      signedOn: `Signed on ${signedOn}`,
    },
    // Q-9 ruling: the product line stays as it was on blank paper; pre-printed stationery never carried it.
    footerLeft: preprinted ? "" : "Generated by ClinicOS • Confidential Medical Record",
    continuation: (page, total) =>
      page > 1 ? `${c.name}  •  Rx Continuation  •  Patient: ${continuationPatient(payload.patient, age)}  •  Date: ${visitDate}  •  Page ${page} of ${total}` : "",
    pageLine: (page, total) => `Rx v${payload.version} · Page ${page} of ${total}`,
  };
}
