/**
 * V2-09e 09E-08 (R-11): a medicine or a diagnosis outside the catalogue joins the doctor's own list in the consult's query when the database accepted it, the
 * way `change_prescription` (09C R-2) and `addConsultationDiagnosis` do in the database: no re-read of the lists.
 */
import { describe, expect, it } from "vitest";
import { withCustomDiagnosis, withCustomMedicine, type ConsultQueryData } from "@/features/consultation/screen";

const data = (): ConsultQueryData => ({
  lists: {
    custom_medicines: [
      { medicine_name: "Zeta syrup", generic_name: null, dose_form: null, default_dosage: "1-0-1", default_timing: null, default_duration: "5 days", use_count: 3 },
      { medicine_name: "Alpha drops", generic_name: null, dose_form: null, default_dosage: "1-0-0", default_timing: null, default_duration: "3 days", use_count: 1 },
    ],
    custom_diagnoses: [{ diagnosis_name: "Old dx", specialty: null, use_count: 2 }],
    templates: [],
  },
  macros: [],
  assistContext: null,
  rxAssistContext: null,
});
const line = (name: string, dosage = "1-1-1") => ({ medicine_name: name, generic_name: null, dose_form: null, dosage, timing: null, duration: "7 days" });

describe("withCustomMedicine", () => {
  it("a new medicine joins with use_count 1 and the line's dose, in the database's order (use count, then name)", () => {
    const next = withCustomMedicine(data(), line("Beta tabs"));
    expect(next.lists!.custom_medicines.map((m) => [m.medicine_name, m.use_count])).toEqual([["Zeta syrup", 3], ["Alpha drops", 1], ["Beta tabs", 1]]);
    expect(next.lists!.custom_medicines[2]).toMatchObject({ default_dosage: "1-1-1", default_duration: "7 days" });
  });

  it("a known medicine counts one more use and takes the line's dose", () => {
    const next = withCustomMedicine(data(), line("Alpha drops", "2-0-0"));
    expect(next.lists!.custom_medicines.find((m) => m.medicine_name === "Alpha drops")).toMatchObject({ use_count: 2, default_dosage: "2-0-0", default_duration: "7 days" });
  });

  it("a role that keeps no lists (a nurse) is left alone", () => {
    const none: ConsultQueryData = { ...data(), lists: null };
    expect(withCustomMedicine(none, line("X"))).toBe(none);
  });
});

describe("withCustomDiagnosis", () => {
  it("joins with use_count 1 (the add writes 1 on every add)", () => {
    const next = withCustomDiagnosis(data(), { diagnosis_name: " New dx ", specialty: null });
    expect(next.lists!.custom_diagnoses.map((d) => [d.diagnosis_name, d.use_count])).toEqual([["Old dx", 2], ["New dx", 1]]);
    expect(withCustomDiagnosis(next, { diagnosis_name: "Old dx", specialty: null }).lists!.custom_diagnoses.find((d) => d.diagnosis_name === "Old dx")?.use_count).toBe(1);
  });
});
