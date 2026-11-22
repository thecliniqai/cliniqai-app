/**
 * Fixed synthetic payloads for the prescription PDF specs (V2-09c 09C-04): the golden files, the content checks and the print view all render these. Every
 * name, number and date is made up; the visit and prescription ids are constants so a render is reproducible byte for byte.
 */
import type { PrescriptionPdfPayload } from "@/features/prescriptions/pdf/types";

const SIGNED_AT = "2026-11-20T10:30:00.000Z"; // 16:00 on 20 Nov 2026 in Asia/Kolkata, 05:30 on 20 Nov in Pacific/Honolulu... (the clinic's zone decides the date)

export function basePayload(over: Partial<PrescriptionPdfPayload> = {}): PrescriptionPdfPayload {
  return {
    tenant_id: "00000000-0000-4000-8000-0000000000a1",
    visit_id: "11111111-2222-4333-8444-555555555555",
    prescription_id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
    version: 1,
    letterhead_mode: "blank_paper",
    paper_size: "A4",
    letterhead_margins: { top: 114, bottom: 60 },
    timezone: "Asia/Kolkata",
    signed_at: SIGNED_AT,
    clinic: {
      name: "Synthetic Care Clinic",
      address: "12 Example Road, Sample Nagar",
      phone: "+91 90000 00000",
      registration_number: "SYN-1234",
      clinical_establishment_reg_no: "CEA-SYN-001",
      state_medical_council_reg_no: null,
      gstin: null,
      drug_license_no: null,
    },
    doctor: { name: "Asha Example", qualifications: "MBBS, MD", medical_council_reg_no: "SMC-0001" },
    patient: { full_name: "Ravi Synthetic", age: 41, sex: "male", phone: "+91 90000 11111", address: null, abha_id: null, uhid: "AB12CD34" },
    visit: {
      visit_date: "2026-11-20",
      vitals: { systolic: 124, diastolic: 82, pulse: 76, temperature: 99.1, spo2: 98, weight: 72, height: 172 },
      chief_complaints: [
        { symptom: "Fever", duration_val: 3, duration_unit: "days" },
        { symptom: "Cough" },
      ],
      clinical_notes: "Synthetic note.",
      specialty: "general_physician",
      exam: { general: "Pallor", abnormal: ["RS: Crepts, Wheeze (Right) · Basal"], normal: "General, CVS, PA" },
    },
    diagnoses: [{ diagnosis_name: "Viral fever", icd11_code: "MG26" }, { diagnosis_name: "Acute bronchitis" }],
    medications: [
      { medicine_name: "Paracetamol 650", generic_name: "Paracetamol", dose_form: "Tablet", dosage: "1-0-1", timing: "After food", duration: "5 days" },
      { medicine_name: "Cetirizine 10", dosage: "0-0-1", timing: null, duration: "5 days", special_instructions: "May cause drowsiness" },
      { medicine_name: "Ambroxol syrup", dose_form: "Syrup", dosage: "SOS", timing: "With food", duration: "Continue" },
    ],
    investigations_advised: ["CBC", "Chest X-ray"],
    advice: ["Plenty of fluids", "Steam inhalation twice a day"],
    follow_up_date: "2026-11-27",
    ...over,
  };
}

/** Twenty-four lines with notes: the Rx runs onto a second page (the continuation line and the page numbers). */
export function longPayload(): PrescriptionPdfPayload {
  return basePayload({
    medications: Array.from({ length: 24 }, (_, i) => ({
      medicine_name: `Synthetic Medicine ${String(i + 1).padStart(2, "0")}`,
      generic_name: i % 3 === 0 ? `Syntheticol ${i + 1}` : null,
      dose_form: i % 2 === 0 ? "Tablet" : null,
      dosage: i % 2 === 0 ? "1-0-1" : "0-0-1",
      timing: i % 4 === 0 ? null : "After food",
      duration: `${3 + (i % 5)} days`,
      special_instructions: i % 5 === 0 ? "Take with a full glass of water" : null,
    })),
    advice: Array.from({ length: 6 }, (_, i) => `Synthetic advice line number ${i + 1} that is long enough to be a real sentence for the printed page.`),
  });
}
