/**
 * V2-09a 09A-06a, the 09A-05 UI review (09A-REVIEW-B.md), on REAL rows: visits seeded and signed (and reopened, finalized) through the commands, then
 * read back the way the consultation page reads them and rendered with react-dom/server. Each case fails without its fix:
 *   - B-7 / B-1 / B-6: a sealed consultation with vitals, a complaint, an investigation, an advice item, a follow-up and specialty data (one visit per
 *     specialty): every input and select is disabled, the notes are read-only (not disabled), no vitals editor, and every button left enabled is one
 *     that changes nothing on the record;
 *   - B-7: a cancelled visit is read-only with no Save Draft and no Complete & Sign;
 *   - B-2: a consultation with no prescription shows the signed version from `current_revision` (1 by default; one ahead while amending);
 *   - B-5: a failed follow-up write fails the draft save, which is one transaction since V2-09b (so Finalize amendment, which saves first, stops).
 * The in-session transitions (B-1 after a refresh, B-3 focus, B-4 the held dialog) are tests/e2e/a11y/amendment-screens.spec.ts. Synthetic data only.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { withFault } from "../helpers/fault";
import { callFinalize, finalizeArgs, reopenVisitAs, seedClinicalVisit, signVisitAs } from "../helpers/clinical-commands";
import { clinicalContent, clinicalNotesEmbed, embeddedClinicalNotes } from "@/lib/db/clinical-notes";
import type { Json } from "@/lib/db/types";
import { recordState, signedVersionOf } from "@/features/consultation/record-state";
import { saveDraftAs } from "../helpers/consult-draft";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }) }));

const { ConsultationWorkspace } = await import("@/components/consultation/consultation-workspace");
type Props = import("@/components/consultation/consultation-workspace").ConsultationWorkspaceProps;

const admin = getAdminClient();
let owner: SeededTenant;
let doctor: SeededTenant;

beforeAll(async () => {
  owner = await seedTenantWithOwner("Synthetic Workspace Review Clinic");
  doctor = await addMemberToTenant(owner.tenantId, "doctor");
}, 90_000);

const SPECIALTY_DATA = {
  general_physician: {
    specialty: "general_physician",
    general_exam: { pallor: true, icterus: false, cyanosis: false, clubbing: false, lymphadenopathy: false, edema: false },
    systemic: { cvs: "S1 S2 heard", rs: "Clear", pa: "Soft", cns: "NAD" },
  },
  dental: { specialty: "dental", odontogram: [{ tooth_number: 16, condition_tags: ["decay"], notes: "Synthetic" }], general_notes: "Synthetic dental note" },
  pediatrics: {
    specialty: "pediatrics",
    birth_history: { gestational_age_weeks: 39, birth_weight_kg: 3.1, delivery_type: "normal", complications: null },
    head_circumference_cm: 45,
    immunizations_given: ["BCG"],
  },
} satisfies Record<string, Record<string, unknown>>;

/** A visit of the doctor with every section filled, then signed by the doctor through the command. */
async function seedPopulatedSealed(specialty: keyof typeof SPECIALTY_DATA): Promise<string> {
  const visit = await seedClinicalVisit(owner, { doctorId: doctor.userId, diagnosis: true, prescriptions: 1 });
  const ok = (r: { error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`${what} failed: ${r.error.message}`);
  };
  ok(await admin.from("visits").update({ specialty }).eq("id", visit.visitId), "specialty");
  ok(
    await admin
      .from("clinical_notes")
      .update({
        vitals: { systolic: 122, diastolic: 78, pulse: 76, temperature: 98.6, spo2: 98, weight: 64, height: 168, bmi: 22.7 },
        chief_complaints: [{ id: "c1", symptom: "Synthetic cough", duration_val: 3, duration_unit: "days", notes: null }],
        clinical_notes: "Synthetic signed note with enough text to scroll.",
        specialty_data: SPECIALTY_DATA[specialty] as unknown as NonNullable<Json>,
        investigations_advised: ["CBC"],
        advice: ["Synthetic advice: rest"],
      })
      .eq("visit_id", visit.visitId),
    "notes"
  );
  ok(
    await admin.from("prescription_items").insert({
      tenant_id: owner.tenantId,
      prescription_id: visit.prescriptionIds[0],
      medicine_name: "Synthetic Med Sealed",
      dosage: "1-0-1",
      duration: "5 days",
      sort_order: 0,
    }),
    "item"
  );
  ok(
    await admin.from("follow_ups").insert({
      tenant_id: owner.tenantId,
      patient_id: visit.patientId,
      visit_id: visit.visitId,
      doctor_id: doctor.userId,
      follow_up_date: "2031-03-01",
      status: "scheduled",
    }),
    "follow-up"
  );
  await signVisitAs(doctor, visit.visitId);
  return visit.visitId;
}

/** The workspace's visit prop, read from the database the way app/(dashboard)/consultation/[id]/page.tsx reads it. */
async function workspaceVisit(visitId: string): Promise<Props["visit"]> {
  const { data: v, error } = await admin
    .from("visits")
    .select(`id, patient_id, doctor_id, status, scheduled_at, specialty, signed_at, current_revision, ${clinicalNotesEmbed()}`)
    .eq("id", visitId)
    .single();
  if (error || !v) throw new Error(`visit read failed: ${error?.message}`);
  const notes = clinicalContent(embeddedClinicalNotes(v));
  const [{ data: followUp }, { data: diagnoses }, { data: header }] = await Promise.all([
    admin.from("follow_ups").select("follow_up_date, notes").eq("visit_id", visitId).maybeSingle(),
    admin.from("consultation_diagnoses").select("*").eq("visit_id", visitId),
    admin.from("prescriptions").select("id, version").eq("visit_id", visitId).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const { data: items } = header
    ? await admin.from("prescription_items").select("*").eq("prescription_id", header.id).order("sort_order")
    : { data: [] };
  const { data: revision } = await admin
    .from("visit_revisions")
    .select("amendment_reason")
    .eq("visit_id", visitId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = v as unknown as Record<string, unknown>;
  return {
    id: visitId,
    patient_id: row.patient_id as string,
    doctor_id: row.doctor_id as string,
    status: row.status as Props["visit"]["status"],
    scheduled_at: (row.scheduled_at as string | null) ?? null,
    vitals: (notes.vitals as Props["visit"]["vitals"]) ?? null,
    chief_complaints: (notes.chief_complaints as Props["visit"]["chief_complaints"]) ?? null,
    clinical_notes: notes.clinical_notes,
    specialty: (row.specialty as Props["visit"]["specialty"]) ?? "general_physician",
    specialty_data: (notes.specialty_data as Props["visit"]["specialty_data"]) ?? null,
    investigations_advised: notes.investigations_advised ?? [],
    advice: notes.advice ?? [],
    follow_up: followUp ? { follow_up_date: followUp.follow_up_date, notes: followUp.notes } : null,
    diagnoses: (diagnoses ?? []) as unknown as Props["visit"]["diagnoses"],
    prescription_items: (items ?? []) as unknown as Props["visit"]["prescription_items"],
    signed_at: (row.signed_at as string | null) ?? null,
    current_revision: (row.current_revision as number | null) ?? 1,
    prescription_version: header?.version ?? null,
    amendment_reason: recordState(row as { status: string; signed_at: string | null }) === "amending" ? (revision?.amendment_reason ?? null) : null,
  };
}

const patient: Props["patient"] = { id: "00000000-0000-4000-8000-0000000000c1", full_name: "Synthetic Patient", phone: "+919000000000", gender: "female", date_of_birth: null, age: 6 };
const render = (visit: Props["visit"]) =>
  renderToStaticMarkup(createElement(ConsultationWorkspace, { visit, patient, pastEncounters: [], canAmend: true }));

const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].map((m) => m[0]);
const isDisabled = (tag: string) => /\sdisabled(=""|\s|>)/.test(tag);
const isReadOnly = (tag: string) => /\sreadonly(=""|\s|>)/i.test(tag);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** Every enabled button: its accessible name (aria-label, else its text). */
function enabledButtons(html: string): string[] {
  return [...html.matchAll(/(<button\b[^>]*>)([\s\S]*?)<\/button>/g)]
    .filter((m) => !isDisabled(m[1]))
    .map((m) => /aria-label="([^"]*)"/.exec(m[1])?.[1] ?? text(m[2]));
}
/**
 * Buttons that change nothing on the record: the section jump bar, the history drawer, the share of the signed Rx, opening the amendment, the referral
 * (its own record), the dentition view toggle, the growth calculator's sex toggle and the immunization milestones' expand/collapse headers.
 */
const NON_MUTATING =
  /^(Open patient history drawer|Amend|WhatsApp Rx & Bill|Rx & Bill Sent ✓|Vitals|Complaints & Notes|Specialty Exam|Diagnosis|Prescription \(℞\)|Investigations & Advice|Follow-Up|Refer Patient|\+ Refer to Specialist|Adult \(32 Teeth\)|Deciduous \(20 Teeth\)|Male|Female|Boy|Girl|.+ \d+ \/ \d+ given)$/;
/**
 * The pediatric growth calculator's own inputs (age in months, a weight and a height to look up a WHO percentile): local state of the calculator,
 * never saved to the record (components/consultation/specialty/pediatrics-tools.tsx). Every other input must be disabled.
 */
const isGrowthCalculatorInput = (t: string) =>
  t.includes('id="peds-calc-age"') || (t.includes('placeholder="kg"') && t.includes('max="40"')) || (t.includes('placeholder="cm"') && t.includes('max="140"'));

describe("B-7 / B-1 / B-6: a populated sealed consultation is read-only in every section (real rows)", () => {
  it.each(["general_physician", "dental", "pediatrics"] as const)("%s: no enabled input or select, notes read-only, no vitals editor, only non-mutating buttons", async (specialty) => {
    const visitId = await seedPopulatedSealed(specialty);
    const visit = await workspaceVisit(visitId);
    expect(recordState(visit)).toBe("sealed");
    const html = render(visit);
    // The seed reached the screen (vitals, complaint, investigation, advice).
    expect(text(html)).toContain("122");
    expect(text(html)).toContain("Synthetic cough");
    expect(text(html)).toContain("CBC");
    expect(text(html)).toContain("Synthetic advice: rest");

    const inputs = [...tags(html, "input"), ...tags(html, "select")].filter((t) => !/type="hidden"/.test(t));
    expect(inputs.length).toBeGreaterThan(3);
    expect(inputs.filter((t) => !isDisabled(t) && !isGrowthCalculatorInput(t))).toEqual([]);
    const textareas = tags(html, "textarea");
    expect(textareas.filter((t) => !isDisabled(t) && !isReadOnly(t))).toEqual([]);
    // B-6: the signed notes are read-only (focusable, scrollable) and not disabled.
    const notes = textareas.find((t) => t.includes('id="clinical-notes"'))!;
    expect(isReadOnly(notes)).toBe(true);
    expect(isDisabled(notes)).toBe(false);
    expect(notes).toContain('aria-readonly="true"');
    // B-1: no vitals editor and no editor toggle.
    expect(html).not.toContain('aria-label="Edit vitals"');
    // Every button still enabled is one that changes nothing on the record.
    expect(enabledButtons(html).filter((name) => !NON_MUTATING.test(name))).toEqual([]);
  }, 90_000);

  it("a cancelled visit is read-only too, with no Save Draft and no Complete & Sign (R-11)", async () => {
    const seeded = await seedClinicalVisit(owner, { doctorId: doctor.userId, status: "cancelled", prescriptions: 1 });
    const visit = await workspaceVisit(seeded.visitId);
    expect(visit.status).toBe("cancelled");
    const html = render(visit);
    const inputs = [...tags(html, "input"), ...tags(html, "select")].filter((t) => !/type="hidden"/.test(t));
    expect(inputs.filter((t) => !isDisabled(t) && !isGrowthCalculatorInput(t))).toEqual([]);
    expect(tags(html, "textarea").filter((t) => !isDisabled(t) && !isReadOnly(t))).toEqual([]);
    const buttons = enabledButtons(html);
    expect(buttons).not.toContain("Save draft");
    expect(buttons.some((b) => /Complete & Sign/.test(b))).toBe(false);
    expect(buttons).not.toContain("Amend");
    expect(buttons.filter((name) => !NON_MUTATING.test(name))).toEqual([]);
  }, 60_000);
});

describe("B-2: the signed version of a consultation with no prescription comes from current_revision (real rows)", () => {
  it("v1 when sealed, 'v1 to v2' while first amended, v2 when finalized, 'v2 to v3' while amended again", async () => {
    const seeded = await seedClinicalVisit(owner, { doctorId: doctor.userId, prescriptions: 0 });
    await signVisitAs(doctor, seeded.visitId);
    let visit = await workspaceVisit(seeded.visitId);
    expect(visit).toMatchObject({ current_revision: 1, prescription_version: null });
    expect(signedVersionOf(visit, recordState(visit))).toBe(1);

    await reopenVisitAs(doctor, seeded.visitId);
    visit = await workspaceVisit(seeded.visitId);
    expect(visit.current_revision).toBe(2);
    expect(signedVersionOf(visit, recordState(visit))).toBe(1);
    expect(text(render(visit))).toContain("Amending a signed consultation (v1 to v2)");

    expect((await callFinalize(doctor.client, finalizeArgs(owner, seeded.visitId))).error).toBeNull();
    visit = await workspaceVisit(seeded.visitId);
    expect(recordState(visit)).toBe("sealed");
    expect(signedVersionOf(visit, "sealed")).toBe(2);

    await reopenVisitAs(doctor, seeded.visitId);
    visit = await workspaceVisit(seeded.visitId);
    expect(visit.current_revision).toBe(3);
    expect(text(render(visit))).toContain("Amending a signed consultation (v2 to v3)");
  }, 90_000);
});

describe("B-5: a failed follow-up write fails the draft save, and nothing of it is kept", () => {
  it("on a reopened visit, a follow-up the database refuses fails the whole save (one transaction), so Finalize stops and the notes are unchanged", async () => {
    const seeded = await seedClinicalVisit(owner, { doctorId: doctor.userId, prescriptions: 0, notes: "Synthetic signed note" });
    await signVisitAs(doctor, seeded.visitId);
    await reopenVisitAs(doctor, seeded.visitId);
    const patch = { clinical_notes: "Synthetic amended note", follow_up: { interval: "1_week" as const, follow_up_date: "2031-06-01", notes: null } };
    await withFault({ table: "public.follow_ups", column: "visit_id", marker: seeded.visitId, event: "insert" }, async () => {
      const res = await saveDraftAs(ctxFor(doctor), seeded.visitId, patch);
      expect(res).toMatchObject({ success: false, code: "INTERNAL", error: "Failed to save draft. Please try again." });
    });
    const { data } = await admin.from("follow_ups").select("id").eq("visit_id", seeded.visitId);
    expect(data).toEqual([]);
    // V2-09b: the note is not saved either (before, the notes were written and only the follow-up failed).
    const { data: notes } = await admin.from("clinical_notes").select("clinical_notes").eq("visit_id", seeded.visitId).single();
    expect(notes?.clinical_notes).toBe("Synthetic signed note");
    // Control: without the fault the same save succeeds and writes the follow-up.
    expect((await saveDraftAs(ctxFor(doctor), seeded.visitId, patch)).success).toBe(true);
    const { data: after } = await admin.from("follow_ups").select("follow_up_date").eq("visit_id", seeded.visitId);
    expect(after).toEqual([{ follow_up_date: "2031-06-01" }]);
  }, 90_000);
});
