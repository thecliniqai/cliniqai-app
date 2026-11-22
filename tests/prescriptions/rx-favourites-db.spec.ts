/**
 * V2-09c 09C-03 (R-9, T-09C-04; AI-08, SA-02): the Rx favourites and "your usual" of `consult_assist_context` through the service, on real rows with the caller's
 * own client (RLS applies). Roadmap acceptance 4: SA-02 never returns another doctor's Rx. The retired library (`getDoctorFrequentPrescriptions`) ranked every
 * doctor's lines of the clinic for a diagnosis, counted an unsigned visit and filled a missing timing with "1-0-1"; the same rows were run through it once before
 * its deletion and returned doctor B's signed and unsigned medicines to doctor A (recorded in 09C-NOTES.md). The pgTAP file `rx_assist.test.sql` covers the
 * function's ranking and thresholds; this spec covers the service and the rows the app writes (the Rx lines come from `change_prescription`). Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getConsultAssistContext } from "@/features/consultation/service";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedClinicalVisit, signVisitAs } from "../helpers/clinical-commands";
import { addRxLinesAs, rxLine } from "../helpers/rx-lines";

const admin = getAdminClient();
let tenantA: SeededTenant;
let tenantB: SeededTenant;
let doctorA: SeededTenant;
let doctorB: SeededTenant;
let nurse: SeededTenant;

/** A visit of `doctor` with the diagnosis and lines, written through the command and signed (or left as a draft). */
async function visitWith(doctor: SeededTenant, clinic: SeededTenant, diagnosis: string, lines: ReturnType<typeof rxLine>[], signed = true) {
  const visit = await seedClinicalVisit(clinic, { doctorId: doctor.userId, status: "in_consultation", notes: "Synthetic note", prescriptions: 0 });
  const dx = await admin.from("consultation_diagnoses").insert({ tenant_id: clinic.tenantId, visit_id: visit.visitId, patient_id: visit.patientId, diagnosis_name: diagnosis });
  if (dx.error) throw new Error(dx.error.message);
  await addRxLinesAs(ctxFor(doctor), visit.visitId, lines);
  if (signed) await signVisitAs(doctor, visit.visitId);
  return visit;
}

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Rx Favourites Clinic A");
  tenantB = await seedTenantWithOwner("CI Rx Favourites Clinic B");
  doctorA = await addMemberToTenant(tenantA.tenantId, "doctor");
  doctorB = await addMemberToTenant(tenantA.tenantId, "doctor");
  nurse = await addMemberToTenant(tenantA.tenantId, "nurse");
  // Doctor A: three signed Viral fever visits (Alpha Syrup each time, Beta Tablet twice with a null timing) and one unsigned draft.
  for (let i = 0; i < 3; i++) {
    await visitWith(doctorA, tenantA, "Viral fever", [
      rxLine({ medicine_name: "Alpha Syrup", dosage: "1-0-1", timing: "After food", duration: "5 days" }),
      ...(i < 2 ? [rxLine({ medicine_name: "Beta Tablet", dosage: "0-0-1", timing: null, duration: "3 days" })] : []),
    ]);
  }
  await visitWith(doctorA, tenantA, "Viral fever", [rxLine({ medicine_name: "Draft Only Gamma" })], false);
  // Doctor B (the same clinic): the same diagnosis with other medicines, signed twice, and one unsigned draft.
  for (let i = 0; i < 2; i++) await visitWith(doctorB, tenantA, "Viral fever", [rxLine({ medicine_name: "Doctor B Only Delta", dosage: "1-1-1", timing: "With food", duration: "4 days" })]);
  await visitWith(doctorB, tenantA, "Viral fever", [rxLine({ medicine_name: "Doctor B Draft Epsilon" })], false);
  // Another clinic's owner: the same diagnosis, a medicine of their own.
  await visitWith(tenantB, tenantB, "Viral fever", [rxLine({ medicine_name: "Clinic B Only Zeta" })]);
}, 240_000);

const names = (list: readonly { name: string }[] | undefined) => (list ?? []).map((e) => e.name);

describe("SA-02: the Rx favourites and the bundle are the calling doctor's own", () => {
  it("doctor A's favourites hold A's signed medicines, most prescribed first, and nothing of B's, of the drafts or of another clinic", async () => {
    const context = await getConsultAssistContext(ctxFor(doctorA));
    expect(names(context?.rx_favourites)).toEqual(["Alpha Syrup", "Beta Tablet"]);
  });

  it("doctor B's favourites hold only B's medicine", async () => {
    const context = await getConsultAssistContext(ctxFor(doctorB));
    expect(names(context?.rx_favourites)).toEqual(["Doctor B Only Delta"]);
  });

  it("the same diagnosis gives each doctor their own bundle (B's identical diagnosis never reaches A)", async () => {
    const a = await getConsultAssistContext(ctxFor(doctorA));
    const b = await getConsultAssistContext(ctxFor(doctorB));
    expect(names(a?.diagnoses.find((d) => d.name === "Viral fever")?.rx)).toEqual(["Alpha Syrup", "Beta Tablet"]);
    expect(names(b?.diagnoses.find((d) => d.name === "Viral fever")?.rx)).toEqual(["Doctor B Only Delta"]);
  });

  it("the usual dose is what A stored: a null timing stays null, nothing is filled in", async () => {
    const a = await getConsultAssistContext(ctxFor(doctorA));
    expect(a?.rx_favourites.find((e) => e.name === "Beta Tablet")?.usual).toEqual({ dosage: "0-0-1", timing: null, duration: "3 days" });
    expect(a?.rx_favourites.find((e) => e.name === "Alpha Syrup")?.usual).toEqual({ dosage: "1-0-1", timing: "After food", duration: "5 days" });
    expect(a?.rx_favourites.find((e) => e.name === "Alpha Syrup")?.n).toBe(3);
  });

  it("another clinic's owner sees only their own, and a nurse sees nothing", async () => {
    expect(names((await getConsultAssistContext(ctxFor(tenantB)))?.rx_favourites)).toEqual(["Clinic B Only Zeta"]);
    // A nurse holds no consultations:edit: the service answers null (no assist) and never another doctor's history.
    expect(await getConsultAssistContext(ctxFor(nurse))).toBeNull();
  });

  it("the answer carries no patient, visit, prescription or item id and no clinical text beyond the medicine names", async () => {
    const a = await getConsultAssistContext(ctxFor(doctorA));
    const text = JSON.stringify([a?.rx_favourites, a?.diagnoses.map((d) => d.rx)]);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(text).not.toContain("Synthetic Billing Patient");
  });
});
