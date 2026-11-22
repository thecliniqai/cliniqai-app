/**
 * V2-09c 09C-04 (R-12): the clinic's "Prescription printing" settings. `updateRxPrintSettings` writes the default paper size and letterhead mode and the margins of
 * the pre-printed stationery (millimetres in, points stored) with `clinic:manage` only; the values are validated before anything is written (ranges, the total that
 * leaves room on the page) and the database refuses the rest (CHECKs); the paper and the letterhead are FROZEN on a prescription when its header is created, so a
 * change applies to the prescriptions started after it and never to one already started; the PDF payload reads the margins, the paper and the clinic's zone.
 * Real database, the caller's own client. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateRxPrintSettings } from "@/features/settings/service";
import { mmToPoints, pointsToMm, rxPrintSettingsSchema } from "@/features/settings/schema";
import { loadPrescriptionPdfSource } from "@/features/prescriptions/pdf/payload";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { auditRows } from "../helpers/billing-commands";
import { seedClinicalVisit } from "../helpers/clinical-commands";
import { addRxLinesAs, rxLine } from "../helpers/rx-lines";

const admin = getAdminClient();
let owner: SeededTenant;
let doctor: SeededTenant;
let receptionist: SeededTenant;

beforeAll(async () => {
  owner = await seedTenantWithOwner("CI Rx Print Settings Clinic");
  doctor = await addMemberToTenant(owner.tenantId, "doctor");
  receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
}, 120_000);
afterAll(() => undefined);

const valid = { rx_paper_size: "A5", rx_letterhead_mode: "preprinted_letterhead", letterhead_top_margin_mm: 40, letterhead_bottom_margin_mm: 20 } as const;

async function tenantRow() {
  const { data } = await admin.from("tenants").select("rx_paper_size, rx_letterhead_mode, letterhead_top_margin, letterhead_bottom_margin").eq("id", owner.tenantId).single();
  return data;
}

describe("unit conversions and the schema", () => {
  it("millimetres to whole points and back", () => {
    expect(mmToPoints(40)).toBe(113);
    expect(mmToPoints(0)).toBe(0);
    expect(mmToPoints(105)).toBe(298);
    expect(pointsToMm(113)).toBe(39.9);
    expect(pointsToMm(110)).toBe(38.8);
  });

  it.each([
    ["a negative margin", { ...valid, letterhead_top_margin_mm: -1 }, /cannot be negative/],
    ["a top margin over 105 mm", { ...valid, letterhead_top_margin_mm: 106 }, /at most 105/],
    ["margins that leave no room together", { ...valid, letterhead_top_margin_mm: 100, letterhead_bottom_margin_mm: 100 }, /together can be at most 132 mm/],
    ["an unknown paper", { ...valid, rx_paper_size: "Letter" }, /./],
    ["an unknown letterhead", { ...valid, rx_letterhead_mode: "fancy" }, /./],
    ["a text for a margin", { ...valid, letterhead_top_margin_mm: "wide" }, /millimetres/],
  ])("%s is refused", (_name, input, message) => {
    const parsed = rxPrintSettingsSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map((i) => i.message).join(" ")).toMatch(message);
  });

  it("accepts the boundaries: 105 mm and 0 mm, and 132 mm in total", () => {
    expect(rxPrintSettingsSchema.safeParse({ ...valid, letterhead_top_margin_mm: 0, letterhead_bottom_margin_mm: 0 }).success).toBe(true);
    expect(rxPrintSettingsSchema.safeParse({ ...valid, letterhead_top_margin_mm: 105, letterhead_bottom_margin_mm: 27 }).success).toBe(true);
  });
});

describe("updateRxPrintSettings", () => {
  it("the owner saves; the columns hold points; the audit row names the field group and no value", async () => {
    const res = await updateRxPrintSettings(ctxFor(owner), valid);
    expect(res.success).toBe(true);
    expect(await tenantRow()).toEqual({ rx_paper_size: "A5", rx_letterhead_mode: "preprinted_letterhead", letterhead_top_margin: 113, letterhead_bottom_margin: 57 });
    const rows = await auditRows(owner.tenantId, "clinic.settings.update", owner.tenantId);
    expect(rows.some((r) => JSON.stringify(r.metadata) === JSON.stringify({ fields_changed: ["rx_print_settings"] }))).toBe(true);
  });

  it.each([["doctor"], ["receptionist"]] as const)("a %s is refused before anything is read or written", async (who) => {
    const before = await tenantRow();
    const res = await updateRxPrintSettings(ctxFor(who === "doctor" ? doctor : receptionist), { ...valid, rx_paper_size: "A4" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/permission/i);
    expect(await tenantRow()).toEqual(before);
  });

  it("an invalid value is a field error and writes nothing", async () => {
    const before = await tenantRow();
    const res = await updateRxPrintSettings(ctxFor(owner), { ...valid, letterhead_top_margin_mm: 500 });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.fieldErrors?.letterhead_top_margin_mm?.[0]).toMatch(/at most 105/);
    expect(await tenantRow()).toEqual(before);
  });

  it("the database refuses what the service would not (the CHECKs: paper, letterhead, margins 0 to 300)", async () => {
    for (const bad of [{ rx_paper_size: "Letter" }, { rx_letterhead_mode: "x" }, { letterhead_top_margin: 301 }, { letterhead_bottom_margin: -1 }]) {
      const { error } = await owner.client.from("tenants").update(bad).eq("id", owner.tenantId);
      expect(error?.code, JSON.stringify(bad)).toBe("23514");
    }
  });
});

describe("the paper and the letterhead are frozen on a prescription when its header is created", () => {
  it("a header made before a change keeps its paper; one made after takes the new settings; the PDF payload reads the paper, the margins and the zone", async () => {
    await updateRxPrintSettings(ctxFor(owner), { ...valid, rx_paper_size: "A4", rx_letterhead_mode: "blank_paper", letterhead_top_margin_mm: 38.8, letterhead_bottom_margin_mm: 21.2 });
    const early = await seedClinicalVisit(owner, { doctorId: doctor.userId, status: "in_consultation", notes: null, prescriptions: 0 });
    await addRxLinesAs(ctxFor(doctor), early.visitId, [rxLine({ medicine_name: "Early line" })]);

    await updateRxPrintSettings(ctxFor(owner), valid);
    const late = await seedClinicalVisit(owner, { doctorId: doctor.userId, status: "in_consultation", notes: null, prescriptions: 0 });
    await addRxLinesAs(ctxFor(doctor), late.visitId, [rxLine({ medicine_name: "Late line" })]);
    // A second line on the early visit does not recreate its header.
    await addRxLinesAs(ctxFor(doctor), early.visitId, [rxLine({ medicine_name: "Early second line" })]);

    const headers = async (visitId: string) => (await admin.from("prescriptions").select("paper_size, letterhead_mode").eq("visit_id", visitId)).data;
    expect(await headers(early.visitId)).toEqual([{ paper_size: "A4", letterhead_mode: "blank_paper" }]);
    expect(await headers(late.visitId)).toEqual([{ paper_size: "A5", letterhead_mode: "preprinted_letterhead" }]);

    const lateSource = await loadPrescriptionPdfSource(ctxFor(doctor), late.visitId);
    expect(lateSource?.payload).toMatchObject({ paper_size: "A5", letterhead_mode: "preprinted_letterhead", letterhead_margins: { top: 113, bottom: 57 }, timezone: "Asia/Kolkata" });
    expect(lateSource?.header).toMatchObject({ paper_size: "A5" });
    const earlySource = await loadPrescriptionPdfSource(ctxFor(doctor), early.visitId);
    expect(earlySource?.payload).toMatchObject({ paper_size: "A4", letterhead_mode: "blank_paper" });
    // A print variant: another paper for the same version (rendered on demand, never stored).
    const variant = await loadPrescriptionPdfSource(ctxFor(doctor), early.visitId, { paper: "A5" });
    expect(variant?.payload.paper_size).toBe("A5");
    expect(variant?.header?.paper_size).toBe("A4");
  });

  it("the payload carries the visit's structured exam as print lines, the clinic's zone date and nothing of the exam when none was entered", async () => {
    const v = await seedClinicalVisit(owner, { doctorId: doctor.userId, status: "in_consultation", notes: null, prescriptions: 0 });
    await addRxLinesAs(ctxFor(doctor), v.visitId, [rxLine({ medicine_name: "Exam line" })]);
    expect((await loadPrescriptionPdfSource(ctxFor(doctor), v.visitId))?.payload.visit.exam).toBeNull();
    await admin
      .from("clinical_notes")
      .update({
        specialty_data: {
          specialty: "general_physician",
          general_exam: { pallor: true },
          exam: {
            template_id: "fever",
            systems: { gen: { abnormal: false, findings: [], side: null, note: null }, rs: { abnormal: true, findings: ["Crepts"], side: "Right", note: null } },
          },
        },
      })
      .eq("visit_id", v.visitId)
      .throwOnError();
    const source = await loadPrescriptionPdfSource(ctxFor(doctor), v.visitId);
    expect(source?.payload.visit.exam).toEqual({ general: "Pallor", abnormal: ["RS: Crepts (Right)"], normal: "General" });
    expect(source?.payload.visit.visit_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the paper of a header cannot be changed by a member after its creation (no UPDATE privilege on the column)", async () => {
    const v = await seedClinicalVisit(owner, { doctorId: doctor.userId, status: "in_consultation", notes: null, prescriptions: 0 });
    await addRxLinesAs(ctxFor(doctor), v.visitId, [rxLine({ medicine_name: `Frozen ${randomUUID().slice(0, 6)}` })]);
    const { error } = await doctor.client.from("prescriptions").update({ paper_size: "A4" }).eq("visit_id", v.visitId);
    expect(error?.code).toBe("42501");
  });
});
