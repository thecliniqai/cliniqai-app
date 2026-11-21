/**
 * V2-09b 09B-03 (R-12, T-09B-05): `getConsultAssistContext`, the service over `public.consult_assist_context`, against the real database with the
 * caller's own client (RLS applies). Proves the doctor's own aggregates arrive parsed, that nobody else's do (another doctor, the owner, a nurse, another
 * clinic, a forged tenant id), and that the answer carries no identifier and no patient name. The function itself is covered by pgTAP
 * `consult_assist_context.test.sql`. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getConsultAssistContext } from "@/features/consultation/service";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedClinicalVisit, signVisitAs } from "../helpers/clinical-commands";

const admin = getAdminClient();
let tenantA: SeededTenant;
let tenantB: SeededTenant;
let doctor: SeededTenant;
let otherDoctor: SeededTenant;
let nurse: SeededTenant;
let receptionist: SeededTenant;
const patientIds: string[] = [];
const visitIds: string[] = [];

async function signedVisit(owner: SeededTenant, tenant: SeededTenant, complaints: string[], diagnosis: string, investigations: string[], advice: string[]) {
  const visit = await seedClinicalVisit(tenant, { doctorId: owner.userId, status: "in_consultation", notes: "Synthetic note", prescriptions: 0 });
  patientIds.push(visit.patientId);
  visitIds.push(visit.visitId);
  const { error } = await admin
    .from("clinical_notes")
    .update({
      chief_complaints: complaints.map((symptom) => ({ symptom, duration_val: 2, duration_unit: "days" })),
      investigations_advised: investigations,
      advice,
    })
    .eq("visit_id", visit.visitId);
  if (error) throw new Error(error.message);
  const dx = await admin.from("consultation_diagnoses").insert({
    tenant_id: tenant.tenantId,
    visit_id: visit.visitId,
    patient_id: visit.patientId,
    diagnosis_name: diagnosis,
  });
  if (dx.error) throw new Error(dx.error.message);
  await signVisitAs(owner, visit.visitId);
  return visit;
}

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Assist Clinic A");
  tenantB = await seedTenantWithOwner("CI Assist Clinic B");
  doctor = await addMemberToTenant(tenantA.tenantId, "doctor");
  otherDoctor = await addMemberToTenant(tenantA.tenantId, "doctor");
  nurse = await addMemberToTenant(tenantA.tenantId, "nurse");
  receptionist = await addMemberToTenant(tenantA.tenantId, "receptionist");
  await signedVisit(doctor, tenantA, ["Fever", "Cough"], "Viral fever", ["CBC"], ["Rest"]);
  await signedVisit(doctor, tenantA, ["fever"], "Viral fever", ["CBC", "Dengue NS1"], ["Rest", "Fluids"]);
  await signedVisit(otherDoctor, tenantA, ["Sciatica pain"], "Sciatica", ["MRI spine"], ["Physiotherapy"]);
  await signedVisit(tenantB, tenantB, ["Clinic B complaint"], "Clinic B diagnosis", [], []);
}, 180_000);

describe("getConsultAssistContext", () => {
  it("the doctor gets their own aggregates, parsed", async () => {
    const context = await getConsultAssistContext(ctxFor(doctor));
    expect(context).not.toBeNull();
    expect(context!.visits).toBe(2);
    expect(context!.complaints.map((c) => [c.name.toLowerCase(), c.n])).toEqual([
      ["fever", 2],
      ["cough", 1],
    ]);
    expect(context!.complaint_pairs.map((p) => [p.a.toLowerCase(), p.b.toLowerCase(), p.n])).toEqual([["cough", "fever", 1]]);
    expect(context!.diagnoses).toHaveLength(1);
    expect(context!.diagnoses[0]).toMatchObject({ name: "Viral fever", n: 2 });
    expect(context!.diagnoses[0].investigations).toEqual([
      { name: "CBC", n: 2 },
      { name: "Dengue NS1", n: 1 },
    ]);
    expect(context!.diagnoses[0].advice).toEqual([
      { name: "Rest", n: 2 },
      { name: "Fluids", n: 1 },
    ]);
  });

  it("another doctor of the same clinic gets their own, never the first doctor's", async () => {
    const context = await getConsultAssistContext(ctxFor(otherDoctor));
    expect(context!.visits).toBe(1);
    expect(context!.complaints.map((c) => c.name)).toEqual(["Sciatica pain"]);
    expect(JSON.stringify(context)).not.toMatch(/Viral fever|Dengue/);
  });

  it("the owner, who signed nothing, gets an empty context (not the doctors')", async () => {
    const context = await getConsultAssistContext(ctxFor(tenantA));
    expect(context).toMatchObject({ visits: 0, complaints: [], pairs: [], diagnoses: [], last_exam_template: null });
  });

  it("a nurse and a receptionist get null: the service refuses before the database is asked", async () => {
    expect(await getConsultAssistContext(ctxFor(nurse))).toBeNull();
    expect(await getConsultAssistContext(ctxFor(receptionist))).toBeNull();
  });

  it("another clinic's owner gets nothing of this clinic, and the clinic's doctor sees nothing of theirs", async () => {
    const b = await getConsultAssistContext(ctxFor(tenantB));
    expect(b).toMatchObject({ visits: 1, diagnoses: [expect.objectContaining({ name: "Clinic B diagnosis" })] });
    expect(JSON.stringify(b)).not.toMatch(/Viral fever|Sciatica/);
    const a = await getConsultAssistContext(ctxFor(doctor));
    expect(JSON.stringify(a)).not.toMatch(/Clinic B/);
  });

  it("a forged tenant id through the RPC gets the empty context, not the other clinic's data", async () => {
    // Clinic B's doctor asks for clinic A's id; clinic A's doctor asks for clinic B's id.
    const forgedB = await tenantB.client.rpc("consult_assist_context", { p_tenant_id: tenantA.tenantId });
    expect(forgedB.error).toBeNull();
    expect(forgedB.data).toMatchObject({ visits: 0, complaints: [], diagnoses: [] });
    const forgedA = await doctor.client.rpc("consult_assist_context", { p_tenant_id: tenantB.tenantId });
    expect(forgedA.error).toBeNull();
    expect(forgedA.data).toMatchObject({ visits: 0, complaints: [], diagnoses: [] });
  });

  it("the answer carries no patient or visit id and no patient name", async () => {
    const text = JSON.stringify(await getConsultAssistContext(ctxFor(doctor)));
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    for (const id of [...patientIds, ...visitIds]) expect(text).not.toContain(id);
    expect(text).not.toContain("Synthetic Billing Patient");
  });
});
