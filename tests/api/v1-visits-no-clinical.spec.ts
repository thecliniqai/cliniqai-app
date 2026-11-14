/**
 * `/api/v1/visits/*` carries no clinical content (V2-05 05a review M-APINOTES: IND M5, RLS L-2; ruling R-9; plan
 * 05-11c). API keys are created by admins (`clinic:manage`), and admins hold no clinical permission (R-9): the key
 * principal is treated as having none either until P1-37 decides a clinical API scope. So:
 *   - GET (list and by id) return the visit without vitals, complaints, notes, specialty data, investigations or advice
 *     (before: embedded from `clinical_notes` on the service-role client, so an admin's key read every note);
 *   - POST and PATCH refuse a body that carries any of those fields with 403 CLINICAL_ACCESS_DENIED and write nothing
 *     (before: written to `clinical_notes`);
 *   - PATCH refuses `status: "completed"` the same way: completing signs the visit, a clinical act (before: signed with
 *     `signed_by` = the key's creator, IND M4).
 * The non-clinical fields still work (create, status changes, reads). Local stack; `/api/v1` switched on for this
 * file. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getVisits, POST as postVisit } from "@/app/api/v1/visits/route";
import { GET as getVisitById, PATCH as patchVisit } from "@/app/api/v1/visits/[id]/route";
import { createApiKeySecret } from "@/lib/api/auth";
import { enableApiV1ForFile } from "../helpers/api-v1";
import { clinicalNotesOf, seedClinicalNotes } from "../helpers/clinical-notes";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

enableApiV1ForFile();

const CLINICAL_FIELDS = ["vitals", "chief_complaints", "clinical_notes", "specialty_data", "investigations_advised", "advice"];
const NOTE_TEXT = "Synthetic confidential note 05-11c";
const COMPLAINT_TEXT = "Synthetic confidential complaint 05-11c";

describe("/api/v1/visits carries no clinical content (05-11c, M-APINOTES, R-9)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let rawKey: string;
  let patientId: string;
  let visitId: string;

  async function seedVisit(status = "waiting"): Promise<string> {
    const { data, error } = await admin
      .from("visits")
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patientId,
        doctor_id: doctor.userId,
        origin_type: "walk_in",
        status,
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to seed the visit: ${error?.code}`);
    await seedClinicalNotes(data.id, {
      clinical_notes: NOTE_TEXT,
      chief_complaints: [{ complaint: COMPLAINT_TEXT }],
      vitals: { bp: "120/80" },
      advice: ["Synthetic advice"],
      investigations_advised: ["Synthetic investigation"],
    });
    return data.id;
  }

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic No Clinical API Clinic");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    const secret = createApiKeySecret();
    const { error: keyErr } = await admin.from("api_keys").insert({
      tenant_id: owner.tenantId,
      name: "Synthetic no-clinical key",
      key_prefix: secret.keyPrefix,
      key_hash: secret.keyHash,
      created_by: owner.userId,
    });
    if (keyErr) throw new Error(`Failed to seed the API key: ${keyErr.code}`);
    rawKey = secret.rawToken;
    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic No Clinical Patient", phone: "+919000008813", created_by: owner.userId })
      .select("id")
      .single();
    if (pErr || !patient) throw new Error(`Failed to seed the patient: ${pErr?.code}`);
    patientId = patient.id;
    visitId = await seedVisit();
  });

  function req(path: string, method = "GET", body?: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: { authorization: `Bearer ${rawKey}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  function expectNoClinical(visit: Record<string, unknown>) {
    for (const field of CLINICAL_FIELDS) expect(visit, field).not.toHaveProperty(field);
    expect(visit).not.toHaveProperty("notes");
    const text = JSON.stringify(visit);
    expect(text).not.toContain(NOTE_TEXT);
    expect(text).not.toContain(COMPLAINT_TEXT);
  }

  it("GET /api/v1/visits lists visits without clinical fields", async () => {
    const res = await getVisits(req(`/api/v1/visits?patient_id=${patientId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((v: { id: string }) => v.id)).toContain(visitId);
    for (const v of body.data) expectNoClinical(v);
  });

  it("GET /api/v1/visits/:id returns the visit without clinical fields", async () => {
    const res = await getVisitById(req(`/api/v1/visits/${visitId}`), { params: Promise.resolve({ id: visitId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: visitId, status: "waiting", patient_id: patientId });
    expectNoClinical(body.data);
  });

  it("POST /api/v1/visits with chief_complaints → 403 CLINICAL_ACCESS_DENIED, nothing stored", async () => {
    const before = await admin.from("visits").select("id", { count: "exact", head: true }).eq("tenant_id", owner.tenantId);
    const res = await postVisit(
      req("/api/v1/visits", "POST", { patient_id: patientId, doctor_id: doctor.userId, chief_complaints: ["Synthetic cough"] })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CLINICAL_ACCESS_DENIED");
    const after = await admin.from("visits").select("id", { count: "exact", head: true }).eq("tenant_id", owner.tenantId);
    expect(after.count).toBe(before.count);
  });

  it("POST /api/v1/visits without clinical fields creates the visit; the response has none", async () => {
    const res = await postVisit(req("/api/v1/visits", "POST", { patient_id: patientId, doctor_id: doctor.userId, reason_for_visit: "Synthetic reason" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ patient_id: patientId, status: "waiting", reason_for_visit: "Synthetic reason" });
    expectNoClinical(body.data);
  });

  it.each([
    ["clinical_notes", { clinical_notes: "tamper" }],
    ["chief_complaints", { chief_complaints: "tamper" }],
    ["vitals", { vitals: { bp: "200/120" } }],
    ["advice", { advice: ["tamper"] }],
    ["investigations_advised", { investigations_advised: ["tamper"] }],
    ["specialty_data", { specialty_data: { x: 1 } }],
    ["a clinical field next to a status change", { status: "in_consultation", clinical_notes: "tamper" }],
    ["completing (signing) the visit", { status: "completed" }],
  ])("PATCH with %s → 403 CLINICAL_ACCESS_DENIED, nothing changes", async (_name, patch) => {
    const notesBefore = await clinicalNotesOf(visitId);
    const { data: visitBefore } = await admin.from("visits").select("status, signed_at, signed_by, updated_at").eq("id", visitId).single();
    const res = await patchVisit(req(`/api/v1/visits/${visitId}`, "PATCH", patch), { params: Promise.resolve({ id: visitId }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CLINICAL_ACCESS_DENIED");
    expect(await clinicalNotesOf(visitId)).toEqual(notesBefore);
    const { data: visitAfter } = await admin.from("visits").select("status, signed_at, signed_by, updated_at").eq("id", visitId).single();
    expect(visitAfter).toEqual(visitBefore);
  });

  it("PATCH status in_consultation → 200; the response has no clinical fields and the notes are untouched", async () => {
    const notesBefore = await clinicalNotesOf(visitId);
    const res = await patchVisit(req(`/api/v1/visits/${visitId}`, "PATCH", { status: "in_consultation" }), {
      params: Promise.resolve({ id: visitId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: visitId, status: "in_consultation" });
    expectNoClinical(body.data);
    expect(await clinicalNotesOf(visitId)).toEqual(notesBefore);
  });
});
