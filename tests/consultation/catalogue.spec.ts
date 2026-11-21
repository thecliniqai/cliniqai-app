/**
 * V2-09b 09B-03 (R-9): catalogue integrity. The lists are static data the sections and the ranking read, so a typo or a duplicate is a defect that no
 * runtime check would catch: no duplicates (case-insensitively), every name fits the field it is stored in, every template system has a normal text
 * and findings, and the v1 strings that existing records and specs name are still offered.
 */
import { describe, expect, it } from "vitest";
import {
  ADVICE,
  COMPLAINTS,
  COMPLAINT_DURATIONS,
  DEFAULT_COMPLAINT_DURATION,
  FOLLOW_UP_INTERVALS,
  GENERAL_SIGNS,
  INVESTIGATIONS,
} from "@/features/consultation/catalogue";
import { EXAM_TEMPLATES, examTemplateById } from "@/features/consultation/exam-templates";
import { chiefComplaintItemSchema, examSchema, gpSpecialtySchema } from "@/features/consultation/schema";

const noDuplicates = (list: readonly string[]) => new Set(list.map((s) => s.trim().toLowerCase())).size === list.length;

describe("catalogue lists", () => {
  it.each([
    ["complaints", COMPLAINTS],
    ["investigations", INVESTIGATIONS],
    ["advice", ADVICE],
  ])("%s: no empty entry, no duplicate, no surrounding spaces", (_name, list) => {
    expect(list.every((s) => s.length > 0 && s === s.trim())).toBe(true);
    expect(noDuplicates(list)).toBe(true);
  });
  it("every complaint fits the stored symptom field (1 to 200 characters)", () => {
    for (const symptom of COMPLAINTS) {
      expect(chiefComplaintItemSchema.safeParse({ symptom, duration_val: DEFAULT_COMPLAINT_DURATION.val, duration_unit: DEFAULT_COMPLAINT_DURATION.unit }).success).toBe(true);
    }
  });
  it("keeps the v1 strings verbatim (specs and records name them)", () => {
    expect(ADVICE).toContain("Steam inhalation twice daily");
    expect(INVESTIGATIONS).toContain("Complete Blood Count (CBC)");
    expect(ADVICE.slice(0, 10)).toHaveLength(10);
    expect(INVESTIGATIONS.slice(0, 14)).toHaveLength(14);
    for (const v1 of ["Fever", "Cough", "Headache", "Weakness"]) expect(COMPLAINTS).toContain(v1);
  });
  it("durations map to a unit the schema accepts, and the default is one of the pills", () => {
    for (const d of COMPLAINT_DURATIONS) {
      expect(chiefComplaintItemSchema.safeParse({ symptom: "x", duration_val: d.val, duration_unit: d.unit }).success).toBe(true);
    }
    expect(COMPLAINT_DURATIONS.some((d) => d.val === DEFAULT_COMPLAINT_DURATION.val && d.unit === DEFAULT_COMPLAINT_DURATION.unit)).toBe(true);
    expect(noDuplicates(COMPLAINT_DURATIONS.map((d) => d.id))).toBe(true);
  });
  it("the general signs are exactly the six PICCLE keys of the stored object", () => {
    expect(GENERAL_SIGNS.map((s) => s.key)).toEqual(["pallor", "icterus", "cyanosis", "clubbing", "lymphadenopathy", "edema"]);
  });
  it("the follow-up intervals are unique and every non-custom one has a positive day count", () => {
    expect(new Set(FOLLOW_UP_INTERVALS.map((i) => i.id)).size).toBe(FOLLOW_UP_INTERVALS.length);
    for (const i of FOLLOW_UP_INTERVALS) {
      if (i.id === "none" || i.id === "custom") expect(i.days).toBeNull();
      else expect(i.days).toBeGreaterThan(0);
    }
  });
});

describe("exam templates", () => {
  it("ids and names are unique and the ids fit the stored template id", () => {
    expect(new Set(EXAM_TEMPLATES.map((t) => t.id)).size).toBe(EXAM_TEMPLATES.length);
    expect(noDuplicates(EXAM_TEMPLATES.map((t) => t.name))).toBe(true);
    for (const t of EXAM_TEMPLATES) expect(examSchema.shape.template_id.safeParse(t.id).success, t.id).toBe(true);
  });
  it("every system has a key the schema accepts, a normal text that fits `systemic`, and at least one finding", () => {
    for (const t of EXAM_TEMPLATES) {
      expect(t.systems.length).toBeGreaterThan(0);
      expect(noDuplicates(t.systems.map((s) => s.key))).toBe(true);
      for (const s of t.systems) {
        expect(s.normal.trim().length, `${t.id}/${s.key} normal`).toBeGreaterThan(0);
        expect(`Normal: ${s.normal}`.length).toBeLessThanOrEqual(500);
        expect(s.findings.length, `${t.id}/${s.key} findings`).toBeGreaterThan(0);
        expect(noDuplicates(s.findings), `${t.id}/${s.key} findings`).toBe(true);
        for (const f of s.findings) expect(f.length).toBeLessThanOrEqual(80);
        expect(/^[a-z0-9_]{1,16}$/.test(s.key)).toBe(true);
      }
    }
  });
  it("the template complaints it suits are complaints of the catalogue", () => {
    const complaints = new Set(COMPLAINTS.map((c) => c.toLowerCase()));
    for (const t of EXAM_TEMPLATES) for (const f of t.for) expect(complaints.has(f.toLowerCase()), `${t.id} for ${f}`).toBe(true);
  });
  it("only Dental and Child switch the specialty; the others are structured GP exams that validate", () => {
    expect(EXAM_TEMPLATES.filter((t) => t.specialty).map((t) => [t.id, t.specialty])).toEqual([["dental", "dental"], ["child", "pediatrics"]]);
    expect(examTemplateById("nope")).toBeNull();
    for (const t of EXAM_TEMPLATES.filter((x) => !x.specialty)) {
      const systems = Object.fromEntries(t.systems.map((s) => [s.key, { abnormal: false, findings: [] }]));
      expect(gpSpecialtySchema.safeParse({ specialty: "general_physician", exam: { template_id: t.id, systems } }).success).toBe(true);
    }
  });
});
