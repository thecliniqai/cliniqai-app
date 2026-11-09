import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { validateDoctorAssignment } from "@/lib/api/doctor-guard";
import { GET as getVisits, POST as createVisit } from "@/app/api/v1/visits/route";
import { GET as getVisitById, PATCH as patchVisitById } from "@/app/api/v1/visits/[id]/route";
import { GET as getPrescriptions, POST as createPrescription } from "@/app/api/v1/prescriptions/route";
import { GET as getPrescriptionById } from "@/app/api/v1/prescriptions/[id]/route";
import { seedTenantWithOwner, addMemberToTenant, createUnlinkedUser } from "../helpers/tenants";
import { createApiKeySecret } from "@/lib/api/auth";
import { getAdminClient } from "@/lib/supabase/admin";

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
      const res1 = await validateDoctorAssignment(clinicA.tenantId, "");
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain("required");

      const res2 = await validateDoctorAssignment(clinicA.tenantId, "   ");
      expect(res2.valid).toBe(false);
    });

    it("returns false if user is not a member of the clinic", async () => {
      const res = await validateDoctorAssignment(clinicA.tenantId, unlinkedUser.userId);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("not found");
    });

    it("returns false if user belongs to another clinic (tenant isolation)", async () => {
      const res = await validateDoctorAssignment(clinicA.tenantId, doctorB.userId);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("not found");
    });

    it("returns false if user has receptionist or nurse role (T-06-05)", async () => {
      const resRecep = await validateDoctorAssignment(clinicA.tenantId, receptionistA.userId);
      expect(resRecep.valid).toBe(false);
      expect(resRecep.error).toContain("receptionist");

      const resNurse = await validateDoctorAssignment(clinicA.tenantId, nurseA.userId);
      expect(resNurse.valid).toBe(false);
      expect(resNurse.error).toContain("nurse");
    });

    it("returns true if user has doctor or owner role", async () => {
      const resDoc = await validateDoctorAssignment(clinicA.tenantId, doctorA.userId);
      expect(resDoc.valid).toBe(true);

      const resOwner = await validateDoctorAssignment(clinicA.tenantId, clinicA.userId);
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
});
