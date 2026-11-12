import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { validateDoctorAssignment } from "@/lib/api/doctor-guard";
import { GET as getVisits, POST as createVisit } from "@/app/api/v1/visits/route";
import { GET as getVisitById, PATCH as patchVisitById } from "@/app/api/v1/visits/[id]/route";
import { GET as getPrescriptions, POST as createPrescription } from "@/app/api/v1/prescriptions/route";
import { GET as getPrescriptionById } from "@/app/api/v1/prescriptions/[id]/route";
import { GET as getLabOrders, POST as createLabOrder } from "@/app/api/v1/lab-orders/route";
import { GET as getLabOrderById } from "@/app/api/v1/lab-orders/[id]/route";
import { GET as getReferrals, POST as createReferral } from "@/app/api/v1/referrals/route";
import { GET as getReferralById, PATCH as patchReferralById } from "@/app/api/v1/referrals/[id]/route";
import { seedTenantWithOwner, addMemberToTenant, createUnlinkedUser } from "../helpers/tenants";
import { createApiKeySecret } from "@/lib/api/auth";
import { getAdminClient } from "../helpers/supabase-admin";
import { enableApiV1ForFile } from "../helpers/api-v1";

enableApiV1ForFile();

describe("Clinical Doctor Guard & Visits REST API (D-02, D-05, D-06, D-08, T-06-05, T-06-07)", () => {
  let clinicA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let clinicB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let doctorA: Awaited<ReturnType<typeof addMemberToTenant>>;
  let receptionistA: Awaited<ReturnType<typeof addMemberToTenant>>;
  let nurseA: Awaited<ReturnType<typeof addMemberToTenant>>;
  let doctorB: Awaited<ReturnType<typeof addMemberToTenant>>;
  let unlinkedUser: Awaited<ReturnType<typeof createUnlinkedUser>>;
  let keyA: { rawToken: string; id: string };
  let keyB: { rawToken: string; id: string };
  let patientA: { id: string };

  beforeAll(async () => {
    const admin = getAdminClient();

    // 1. Seed two clinics
    clinicA = await seedTenantWithOwner("Doctor Guard Clinic Alpha");
    clinicB = await seedTenantWithOwner("Doctor Guard Clinic Beta");

    // 2. Add roles to Clinic A
    doctorA = await addMemberToTenant(clinicA.tenantId, "doctor");
    receptionistA = await addMemberToTenant(clinicA.tenantId, "receptionist");
    nurseA = await addMemberToTenant(clinicA.tenantId, "nurse");

    // 3. Add doctor to Clinic B
    doctorB = await addMemberToTenant(clinicB.tenantId, "doctor");

    // 4. Create unlinked user
    unlinkedUser = await createUnlinkedUser();

    // 5. Create API keys
    const secretA = createApiKeySecret();
    const { data: recordA } = await admin
      .from("api_keys")
      .insert({
        tenant_id: clinicA.tenantId,
        name: "Key Alpha",
        key_prefix: secretA.keyPrefix,
        key_hash: secretA.keyHash,
        created_by: clinicA.userId,
      })
      .select("id")
      .single();
    keyA = { rawToken: secretA.rawToken, id: recordA!.id };

    const secretB = createApiKeySecret();
    const { data: recordB } = await admin
      .from("api_keys")
      .insert({
        tenant_id: clinicB.tenantId,
        name: "Key Beta",
        key_prefix: secretB.keyPrefix,
        key_hash: secretB.keyHash,
        created_by: clinicB.userId,
      })
      .select("id")
      .single();
    keyB = { rawToken: secretB.rawToken, id: recordB!.id };

    // 6. Create test patient in Clinic A
    const { data: patA } = await admin
      .from("patients")
      .insert({
        tenant_id: clinicA.tenantId,
        full_name: "Ramesh Sharma",
        phone: "+919876543210",
        created_by: clinicA.userId,
      })
      .select("id")
      .single();
    patientA = patA!;
  });

  describe("1. validateDoctorAssignment Validator Function", () => {
    it("returns false if doctorId is empty or whitespace", async () => {
      const res1 = await validateDoctorAssignment(getAdminClient(), clinicA.tenantId, "");
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain("required");

      const res2 = await validateDoctorAssignment(getAdminClient(), clinicA.tenantId, "   ");
      expect(res2.valid).toBe(false);
    });

    it("returns false if user is not a member of the clinic", async () => {
      const res = await validateDoctorAssignment(getAdminClient(), clinicA.tenantId, unlinkedUser.userId);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("not found");
    });

    it("returns false if user belongs to another clinic (tenant isolation)", async () => {
      const res = await validateDoctorAssignment(getAdminClient(), clinicA.tenantId, doctorB.userId);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("not found");
    });

    it("returns false if user has receptionist or nurse role (T-06-05)", async () => {
      const resRecep = await validateDoctorAssignment(getAdminClient(), clinicA.tenantId, receptionistA.userId);
      expect(resRecep.valid).toBe(false);
      expect(resRecep.error).toContain("receptionist");

      const resNurse = await validateDoctorAssignment(getAdminClient(), clinicA.tenantId, nurseA.userId);
      expect(resNurse.valid).toBe(false);
      expect(resNurse.error).toContain("nurse");
    });

    it("returns true if user has doctor or owner role", async () => {
      const resDoc = await validateDoctorAssignment(getAdminClient(), clinicA.tenantId, doctorA.userId);
      expect(resDoc.valid).toBe(true);

      const resOwner = await validateDoctorAssignment(getAdminClient(), clinicA.tenantId, clinicA.userId);
      expect(resOwner.valid).toBe(true);
    });
  });

  describe("2. POST /api/v1/visits (Encounter Creation with Doctor Guard)", () => {
    it("rejects request missing doctor_id with 400", async () => {
      const req = new NextRequest("http://localhost/api/v1/visits", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientA.id,
          reason_for_visit: "Routine checkup",
        }),
      });

      const res = await createVisit(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(json.error.message).toContain("doctor_id");
    });

    it("rejects request with receptionist as doctor_id with 403 FORBIDDEN_CLINICIAN", async () => {
      const req = new NextRequest("http://localhost/api/v1/visits", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientA.id,
          doctor_id: receptionistA.userId,
          reason_for_visit: "Fever",
        }),
      });

      const res = await createVisit(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error.code).toBe("FORBIDDEN_CLINICIAN");
      expect(json.error.message).toContain("receptionist");
    });

    it("rejects request assigning Doctor B from Clinic B with 403 FORBIDDEN_CLINICIAN", async () => {
      const req = new NextRequest("http://localhost/api/v1/visits", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientA.id,
          doctor_id: doctorB.userId,
          reason_for_visit: "Cross-clinic attempt",
        }),
      });

      const res = await createVisit(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error.code).toBe("FORBIDDEN_CLINICIAN");
    });

    it("creates walk-in visit with valid doctor and verified created_by FK", async () => {
      const req = new NextRequest("http://localhost/api/v1/visits", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientA.id,
          doctor_id: doctorA.userId,
          origin_type: "walk_in",
          reason_for_visit: "Seasonal Allergies",
          chief_complaints: ["Sneezing", "Runny nose"],
        }),
      });

      const res = await createVisit(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.id).toBeDefined();
      expect(json.data.origin_type).toBe("walk_in");
      expect(json.data.status).toBe("waiting");
      expect(json.data.doctor_id).toBe(doctorA.userId);
      expect(json.data.patient_id).toBe(patientA.id);
      expect(json.data.created_by).toBe(clinicA.userId);
      expect(res.headers.get("x-ratelimit-remaining")).toBeDefined();
    });
  });

  describe("3. GET /api/v1/visits (Query & Filtering)", () => {
    it("returns paginated visits scoped to tenant", async () => {
      const req = new NextRequest(
        `http://localhost/api/v1/visits?patient_id=${patientA.id}&page=1&limit=10`,
        {
          headers: {
            authorization: `Bearer ${keyA.rawToken}`,
          },
        }
      );

      const res = await getVisits(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThan(0);
      expect(json.meta.page).toBe(1);
      expect(json.meta.limit).toBe(10);
      expect(json.meta.total).toBeGreaterThanOrEqual(1);
    });

    it("returns empty array when Key B queries without records in Clinic B", async () => {
      const req = new NextRequest("http://localhost/api/v1/visits", {
        headers: {
          authorization: `Bearer ${keyB.rawToken}`,
        },
      });

      const res = await getVisits(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.length).toBe(0);
      expect(json.meta.total).toBe(0);
    });
  });

  describe("4. PATCH /api/v1/visits/[id] (Clinical Safety & Completion Guard)", () => {
    let activeVisitId: string;

    beforeAll(async () => {
      const admin = getAdminClient();
      const { data: v } = await admin
        .from("visits")
        .insert({
          tenant_id: clinicA.tenantId,
          patient_id: patientA.id,
          doctor_id: doctorA.userId,
          origin_type: "walk_in",
          status: "in_consultation",
          created_by: clinicA.userId,
        })
        .select("id")
        .single();
      activeVisitId = v!.id;
    });

    it("rejects transitioning status to 'completed' without diagnosis or clinical notes (T-06-07)", async () => {
      const req = new NextRequest(`http://localhost/api/v1/visits/${activeVisitId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: "completed",
        }),
      });

      const res = await patchVisitById(req, { params: Promise.resolve({ id: activeVisitId }) });
      const json = await res.json();

      expect(res.status).toBe(422);
      expect(json.error.code).toBe("CLINICAL_SAFETY_VIOLATION");
      expect(json.error.message).toContain("diagnosis or clinical note");
    });

    it("permits completion when clinical notes are supplied in the patch body", async () => {
      const req = new NextRequest(`http://localhost/api/v1/visits/${activeVisitId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: "completed",
          clinical_notes: "Patient advised complete rest and adequate hydration.",
        }),
      });

      const res = await patchVisitById(req, { params: Promise.resolve({ id: activeVisitId }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.status).toBe("completed");
      expect(json.data.clinical_notes).toBe("Patient advised complete rest and adequate hydration.");
      expect(json.data.signed_at).toBeDefined();
      expect(json.data.signed_by).toBe(clinicA.userId);
    });

    // V2-01 01-05 (DB-13/API-04, R10): completed or signed visits are read-only through the API.
    function patchReq(visitId: string, body: Record<string, unknown>) {
      return new NextRequest(`http://localhost/api/v1/visits/${visitId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    }

    async function readVisit(visitId: string) {
      const { data } = await getAdminClient()
        .from("visits")
        .select("status, clinical_notes, signed_at, signed_by, updated_at")
        .eq("id", visitId)
        .single();
      return data;
    }

    it("rejects any PATCH of the completed visit with 409 VISIT_LOCKED and leaves the row unchanged", async () => {
      const before = await readVisit(activeVisitId);
      expect(before?.status).toBe("completed");

      for (const body of [
        { clinical_notes: "tamper" },
        { status: "waiting" },
        { status: "completed", clinical_notes: "re-sign attempt" },
        { status: "cancelled" },
        {},
      ]) {
        const res = await patchVisitById(patchReq(activeVisitId, body), {
          params: Promise.resolve({ id: activeVisitId }),
        });
        const json = await res.json();
        expect(res.status).toBe(409);
        expect(json.error.code).toBe("VISIT_LOCKED");
      }

      expect(await readVisit(activeVisitId)).toEqual(before);
    });

    it("rejects a PATCH of a signed visit reopened for amendment (signed_at set, in_consultation)", async () => {
      const admin = getAdminClient();
      const signedAt = "2026-11-01T09:00:00.000Z";
      const { data: v } = await admin
        .from("visits")
        .insert({
          tenant_id: clinicA.tenantId,
          patient_id: patientA.id,
          doctor_id: doctorA.userId,
          origin_type: "walk_in",
          status: "in_consultation",
          clinical_notes: "Signed synthetic note.",
          signed_at: signedAt,
          signed_by: doctorA.userId,
          created_by: clinicA.userId,
        })
        .select("id")
        .single();
      const reopenedId = v!.id;
      const before = await readVisit(reopenedId);

      const res = await patchVisitById(patchReq(reopenedId, { clinical_notes: "tamper" }), {
        params: Promise.resolve({ id: reopenedId }),
      });
      const json = await res.json();
      expect(res.status).toBe(409);
      expect(json.error.code).toBe("VISIT_LOCKED");

      const after = await readVisit(reopenedId);
      expect(after).toEqual(before);
      expect(after?.clinical_notes).toBe("Signed synthetic note.");
      expect(after?.signed_by).toBe(doctorA.userId);
    });

    it("still patches an open visit, and rejects an unknown status value with 422", async () => {
      const admin = getAdminClient();
      const { data: v } = await admin
        .from("visits")
        .insert({
          tenant_id: clinicA.tenantId,
          patient_id: patientA.id,
          doctor_id: doctorA.userId,
          origin_type: "walk_in",
          status: "waiting",
          created_by: clinicA.userId,
        })
        .select("id")
        .single();
      const openId = v!.id;

      const ok = await patchVisitById(patchReq(openId, { status: "in_consultation", clinical_notes: "Open note." }), {
        params: Promise.resolve({ id: openId }),
      });
      expect(ok.status).toBe(200);
      const after = await readVisit(openId);
      expect(after?.status).toBe("in_consultation");
      expect(after?.clinical_notes).toBe("Open note.");
      expect(after?.signed_at).toBeNull();

      const bad = await patchVisitById(patchReq(openId, { status: "archived" }), {
        params: Promise.resolve({ id: openId }),
      });
      expect(bad.status).toBe(422);
      expect((await readVisit(openId))?.status).toBe("in_consultation");
    });

    it("Key B cannot read or patch Clinic A visit (returns 404)", async () => {
      const getReq = new NextRequest(`http://localhost/api/v1/visits/${activeVisitId}`, {
        headers: {
          authorization: `Bearer ${keyB.rawToken}`,
        },
      });

      const getRes = await getVisitById(getReq, { params: Promise.resolve({ id: activeVisitId }) });
      expect(getRes.status).toBe(404);

      const patchReq = new NextRequest(`http://localhost/api/v1/visits/${activeVisitId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${keyB.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "waiting" }),
      });

      const patchRes = await patchVisitById(patchReq, { params: Promise.resolve({ id: activeVisitId }) });
      expect(patchRes.status).toBe(404);
    });
  });

  describe("5. Prescriptions REST API Grounded in Schema & Versioning (D-05, T-06-05, uq_prescriptions_visit_version)", () => {
    let visitForPrescription: string;

    beforeAll(async () => {
      const admin = getAdminClient();
      const { data: v } = await admin
        .from("visits")
        .insert({
          tenant_id: clinicA.tenantId,
          patient_id: patientA.id,
          doctor_id: doctorA.userId,
          origin_type: "walk_in",
          status: "in_consultation",
          created_by: clinicA.userId,
        })
        .select("id")
        .single();
      visitForPrescription = v!.id;
    });

    it("rejects prescription creation when doctor_id is missing or holds non-doctor role (403)", async () => {
      const req = new NextRequest("http://localhost/api/v1/prescriptions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientA.id,
          doctor_id: receptionistA.userId,
          visit_id: visitForPrescription,
          items: [
            {
              medicine_name: "Amoxicillin 500mg",
              dosage: "1 tablet",
              duration: "5 days",
              timing: "after_meals",
              special_instructions: "Take with full glass of water",
            },
          ],
        }),
      });

      const res = await createPrescription(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error.code).toBe("FORBIDDEN_CLINICIAN");
    });

    it("creates prescription v1 with nested items using timing and special_instructions", async () => {
      const req = new NextRequest("http://localhost/api/v1/prescriptions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientA.id,
          doctor_id: doctorA.userId,
          visit_id: visitForPrescription,
          items: [
            {
              medicine_name: "Paracetamol 650mg",
              generic_name: "Acetaminophen",
              dose_form: "tablet",
              dosage: "1 tablet",
              timing: "sos",
              duration: "3 days",
              special_instructions: "Take only if fever exceeds 100 F",
            },
            {
              medicine_name: "Cetirizine 10mg",
              dosage: "1 tablet",
              timing: "at_bedtime",
              duration: "5 days",
            },
          ],
        }),
      });

      const res = await createPrescription(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.id).toBeDefined();
      expect(json.data.version).toBe(1);
      expect(json.data.status).toBe("active");
      expect(json.data.visit_id).toBe(visitForPrescription);
      expect(json.data.prescription_items).toHaveLength(2);
      expect(json.data.prescription_items[0].timing).toBe("sos");
      expect(json.data.prescription_items[0].special_instructions).toBe("Take only if fever exceeds 100 F");
    });

    it("consecutive prescription creation for same visit increments version to 2", async () => {
      const req = new NextRequest("http://localhost/api/v1/prescriptions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientA.id,
          doctor_id: doctorA.userId,
          visit_id: visitForPrescription,
          items: [
            {
              medicine_name: "Azithromycin 500mg",
              dosage: "1 tablet",
              timing: "before_breakfast",
              duration: "3 days",
            },
          ],
        }),
      });

      const res = await createPrescription(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.version).toBe(2);
      expect(json.data.prescription_items).toHaveLength(1);
    });

    it("GET /api/v1/prescriptions returns paginated list with nested items", async () => {
      const req = new NextRequest(
        `http://localhost/api/v1/prescriptions?visit_id=${visitForPrescription}&page=1&limit=10`,
        {
          headers: {
            authorization: `Bearer ${keyA.rawToken}`,
          },
        }
      );

      const res = await getPrescriptions(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toHaveLength(2);
      expect(json.meta.total).toBe(2);
      expect(json.data[0].prescription_items).toBeDefined();
    });

    it("GET /api/v1/prescriptions/[id] returns detail and verifies tenant isolation", async () => {
      // First get prescription id
      const listReq = new NextRequest(
        `http://localhost/api/v1/prescriptions?visit_id=${visitForPrescription}`,
        {
          headers: {
            authorization: `Bearer ${keyA.rawToken}`,
          },
        }
      );
      const listRes = await getPrescriptions(listReq);
      const listJson = await listRes.json();
      const prescriptionId = listJson.data[0].id;

      // Key A can read
      const getReqA = new NextRequest(`http://localhost/api/v1/prescriptions/${prescriptionId}`, {
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
        },
      });
      const getResA = await getPrescriptionById(getReqA, { params: Promise.resolve({ id: prescriptionId }) });
      const getJsonA = await getResA.json();

      expect(getResA.status).toBe(200);
      expect(getJsonA.data.id).toBe(prescriptionId);
      expect(Array.isArray(getJsonA.data.prescription_items)).toBe(true);

      // Key B cannot read (returns 404)
      const getReqB = new NextRequest(`http://localhost/api/v1/prescriptions/${prescriptionId}`, {
        headers: {
          authorization: `Bearer ${keyB.rawToken}`,
        },
      });
      const getResB = await getPrescriptionById(getReqB, { params: Promise.resolve({ id: prescriptionId }) });
      expect(getResB.status).toBe(404);
    });
  });

  describe("6. Lab Orders REST API Grounded in patient_documents (D-02, D-08, 000013)", () => {
    let createdLabDocId: string;

    it("creates lab order document using patient_documents schema", async () => {
      const req = new NextRequest("http://localhost/api/v1/lab-orders", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientA.id,
          title: "Complete Blood Count (CBC)",
          original_filename: "cbc_report_2026.pdf",
          storage_path: `tenants/${clinicA.tenantId}/patients/${patientA.id}/labs/cbc_report.pdf`,
          file_size_bytes: 245760,
          mime_type: "application/pdf",
          report_date: "2026-11-09",
          notes: "Hemoglobin slightly low, all other parameters within normal limits.",
          is_abnormal: true,
        }),
      });

      const res = await createLabOrder(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.id).toBeDefined();
      expect(json.data.document_type).toBe("lab_report");
      expect(json.data.title).toBe("Complete Blood Count (CBC)");
      expect(json.data.storage_path).toContain("cbc_report.pdf");
      expect(json.data.file_size_bytes).toBe(245760);
      expect(json.data.is_abnormal).toBe(true);
      expect(json.data.uploaded_by).toBe(clinicA.userId);
      createdLabDocId = json.data.id;
    });

    // V2-01 01-05 P0-05 (ARC-06): the storage key must sit under the key's tenant and the body's patient.
    it("rejects storage paths outside tenants/<tenant>/patients/<patient>/ with 422 and writes no row", async () => {
      const otherPatientId = "00000000-0000-4000-8000-0000000000f1";
      const badPaths = [
        `tenants/${clinicB.tenantId}/patients/${patientA.id}/labs/x.pdf`, // other tenant
        `${clinicA.tenantId}/patients/${patientA.id}/labs/x.pdf`, // legacy form, no tenants/ prefix
        `labs/x.pdf`, // no prefix at all
        `/tenants/${clinicA.tenantId}/patients/${patientA.id}/labs/x.pdf`, // absolute
        `tenants/${clinicA.tenantId}/patients/${patientA.id}/../../../${clinicB.tenantId}/x.pdf`, // traversal
        `tenants/${clinicA.tenantId}/patients/${patientA.id}/labs/%2e%2e/x.pdf`, // encoded traversal
        `tenants/${clinicA.tenantId}/patients/${patientA.id}//x.pdf`, // empty segment
        `tenants/${clinicA.tenantId}/patients/${patientA.id}\\..\\x.pdf`, // backslash
        `tenants/${clinicA.tenantId}/patients/${otherPatientId}/labs/x.pdf`, // other patient
        `tenants/${clinicA.tenantId}/patients/${patientA.id}/`, // prefix only
      ];

      for (const storage_path of badPaths) {
        const title = `Path probe ${badPaths.indexOf(storage_path)}`;
        const req = new NextRequest("http://localhost/api/v1/lab-orders", {
          method: "POST",
          headers: {
            authorization: `Bearer ${keyA.rawToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ patient_id: patientA.id, title, storage_path }),
        });

        const res = await createLabOrder(req);
        const json = await res.json();
        expect(res.status, storage_path).toBe(422);
        expect(json.error.code).toBe("VALIDATION_ERROR");

        const { data: rows } = await getAdminClient()
          .from("patient_documents")
          .select("id")
          .eq("tenant_id", clinicA.tenantId)
          .eq("title", title);
        expect(rows ?? []).toHaveLength(0);
      }
    });

    it("rejects an invalid body (non-uuid patient_id, unknown mime type, bad report_date) with 422", async () => {
      const validPath = `tenants/${clinicA.tenantId}/patients/${patientA.id}/labs/probe.pdf`;
      for (const body of [
        { patient_id: "not-a-uuid", title: "Probe", storage_path: validPath },
        { patient_id: patientA.id, title: "Probe", storage_path: validPath, mime_type: "text/html" },
        { patient_id: patientA.id, title: "Probe", storage_path: validPath, report_date: "09/11/2026" },
        { patient_id: patientA.id, title: "", storage_path: validPath },
        { patient_id: patientA.id, title: "Probe" },
      ]) {
        const req = new NextRequest("http://localhost/api/v1/lab-orders", {
          method: "POST",
          headers: {
            authorization: `Bearer ${keyA.rawToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const res = await createLabOrder(req);
        expect(res.status).toBe(422);
      }
    });

    it("does not copy the storage path into the lab_order.create audit metadata", async () => {
      const { data: audit } = await getAdminClient()
        .from("audit_logs")
        .select("metadata")
        .eq("entity_id", createdLabDocId)
        .eq("action", "lab_order.create")
        .single();
      expect(JSON.stringify(audit?.metadata ?? {})).not.toContain("cbc_report.pdf");
    });

    it("GET /api/v1/lab-orders returns paginated list of lab documents", async () => {
      const req = new NextRequest(
        `http://localhost/api/v1/lab-orders?patient_id=${patientA.id}&page=1&limit=10`,
        {
          headers: {
            authorization: `Bearer ${keyA.rawToken}`,
          },
        }
      );

      const res = await getLabOrders(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThan(0);
      expect(json.data[0].document_type).toBe("lab_report");
      expect(json.meta.total).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/v1/lab-orders/[id] returns detail and enforces tenant isolation", async () => {
      // Key A can read
      const getReqA = new NextRequest(`http://localhost/api/v1/lab-orders/${createdLabDocId}`, {
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
        },
      });
      const getResA = await getLabOrderById(getReqA, { params: Promise.resolve({ id: createdLabDocId }) });
      const getJsonA = await getResA.json();

      expect(getResA.status).toBe(200);
      expect(getJsonA.data.id).toBe(createdLabDocId);

      // Key B cannot read (returns 404)
      const getReqB = new NextRequest(`http://localhost/api/v1/lab-orders/${createdLabDocId}`, {
        headers: {
          authorization: `Bearer ${keyB.rawToken}`,
        },
      });
      const getResB = await getLabOrderById(getReqB, { params: Promise.resolve({ id: createdLabDocId }) });
      expect(getResB.status).toBe(404);
    });
  });

  describe("7. Referrals REST API Grounded in referrals Schema & Consent (D-05, T-06-05, T-06-08)", () => {
    let createdReferralId: string;

    it("rejects referral creation if referring_doctor_id is not a doctor (403)", async () => {
      const req = new NextRequest("http://localhost/api/v1/referrals", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientA.id,
          referring_doctor_id: receptionistA.userId,
          referred_to_name: "Dr. Suresh Mehta",
          reason_for_referral: "Cardiology Evaluation",
        }),
      });

      const res = await createReferral(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error.code).toBe("FORBIDDEN_CLINICIAN");
    });

    it("rejects in-network referral without explicit patient consent (T-06-08)", async () => {
      const req = new NextRequest("http://localhost/api/v1/referrals", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientA.id,
          referring_doctor_id: doctorA.userId,
          referral_type: "in_network",
          target_tenant_id: clinicB.tenantId,
          referred_to_name: "Dr. Arvind Gupta",
          reason_for_referral: "Specialized Orthopedic Consultation",
          patient_consents_history_sharing: false,
        }),
      });

      const res = await createReferral(req);
      const json = await res.json();

      expect(res.status).toBe(422);
      expect(json.error.code).toBe("CONSENT_REQUIRED");
      expect(json.error.message).toContain("patient consent");
    });

    it("creates in-network referral when patient consent is granted", async () => {
      const req = new NextRequest("http://localhost/api/v1/referrals", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientA.id,
          referring_doctor_id: doctorA.userId,
          referral_type: "in_network",
          target_tenant_id: clinicB.tenantId,
          referred_to_name: "Dr. Arvind Gupta",
          referred_to_specialty: "Orthopedics",
          reason_for_referral: "Persistent knee pain post trauma",
          urgency: "priority",
          patient_consents_history_sharing: true,
          clinical_summary: "Patient had right knee swelling for 3 weeks.",
        }),
      });

      const res = await createReferral(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.data.id).toBeDefined();
      expect(json.data.referral_type).toBe("in_network");
      expect(json.data.referred_to_name).toBe("Dr. Arvind Gupta");
      expect(json.data.referred_to_specialty).toBe("Orthopedics");
      expect(json.data.reason_for_referral).toBe("Persistent knee pain post trauma");
      expect(json.data.patient_consents_history_sharing).toBe(true);
      expect(json.data.status).toBe("sent");
      createdReferralId = json.data.id;
    });

    it("PATCH /api/v1/referrals/[id] updates status to acknowledged and completed", async () => {
      // 1. Acknowledge
      const ackReq = new NextRequest(`http://localhost/api/v1/referrals/${createdReferralId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: "acknowledged",
        }),
      });

      const ackRes = await patchReferralById(ackReq, { params: Promise.resolve({ id: createdReferralId }) });
      const ackJson = await ackRes.json();

      expect(ackRes.status).toBe(200);
      expect(ackJson.data.status).toBe("acknowledged");
      expect(ackJson.data.acknowledged_at).toBeDefined();

      // 2. Complete with closure notes
      const compReq = new NextRequest(`http://localhost/api/v1/referrals/${createdReferralId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: "completed",
          closure_notes: "Patient attended consultation and MRI was ordered.",
        }),
      });

      const compRes = await patchReferralById(compReq, { params: Promise.resolve({ id: createdReferralId }) });
      const compJson = await compRes.json();

      expect(compRes.status).toBe(200);
      expect(compJson.data.status).toBe("completed");
      expect(compJson.data.completed_at).toBeDefined();
      expect(compJson.data.closed_by).toBe(clinicA.userId);
      expect(compJson.data.closure_notes).toBe("Patient attended consultation and MRI was ordered.");
    });

    it("GET /api/v1/referrals returns paginated list and enforces tenant isolation", async () => {
      const listReqA = new NextRequest(
        `http://localhost/api/v1/referrals?patient_id=${patientA.id}&page=1&limit=10`,
        {
          headers: {
            authorization: `Bearer ${keyA.rawToken}`,
          },
        }
      );
      const listResA = await getReferrals(listReqA);
      const listJsonA = await listResA.json();

      expect(listResA.status).toBe(200);
      expect(listJsonA.data.length).toBeGreaterThan(0);

      // Key B cannot read Clinic A referral directly (returns 404)
      const getReqB = new NextRequest(`http://localhost/api/v1/referrals/${createdReferralId}`, {
        headers: {
          authorization: `Bearer ${keyB.rawToken}`,
        },
      });
      const getResB = await getReferralById(getReqB, { params: Promise.resolve({ id: createdReferralId }) });
      expect(getResB.status).toBe(404);
    });
  });
});
