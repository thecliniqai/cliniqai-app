import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { GET as getPatients, POST as createPatient } from "@/app/api/v1/patients/route";
import { GET as getPatientById, PUT as updatePatientById } from "@/app/api/v1/patients/[id]/route";
import { GET as getAppointments, POST as createAppointment } from "@/app/api/v1/appointments/route";
import {
  GET as getAppointmentById,
  PATCH as rescheduleAppointmentById,
  DELETE as cancelAppointmentById,
} from "@/app/api/v1/appointments/[id]/route";
import { seedTenantWithOwner, addMemberToTenant } from "../helpers/tenants";
import { createApiKeySecret } from "@/lib/api/auth";
import { getAdminClient } from "../helpers/supabase-admin";
import { enableApiV1ForFile } from "../helpers/api-v1";

enableApiV1ForFile();

describe("External REST API CRUD & Schema Verification (REQ-api-access, D-03, D-05, D-06, D-08)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let doctorA: Awaited<ReturnType<typeof addMemberToTenant>>;
  let doctorB: Awaited<ReturnType<typeof addMemberToTenant>>;
  let keyA: { rawToken: string; id: string };
  let keyB: { rawToken: string; id: string };

  beforeAll(async () => {
    const admin = getAdminClient();

    // 1. Seed two separate clinics
    tenantA = await seedTenantWithOwner("CRUD Test Clinic Alpha");
    tenantB = await seedTenantWithOwner("CRUD Test Clinic Beta");

    // 2. Add doctors to each clinic
    doctorA = await addMemberToTenant(tenantA.tenantId, "doctor");
    doctorB = await addMemberToTenant(tenantB.tenantId, "doctor");

    // 3. Create API keys for each clinic
    const secretA = createApiKeySecret();
    const { data: recordA } = await admin
      .from("api_keys")
      .insert({
        tenant_id: tenantA.tenantId,
        name: "Key Alpha",
        key_prefix: secretA.keyPrefix,
        key_hash: secretA.keyHash,
        created_by: tenantA.userId,
      })
      .select("id")
      .single();
    keyA = { rawToken: secretA.rawToken, id: recordA!.id };

    const secretB = createApiKeySecret();
    const { data: recordB } = await admin
      .from("api_keys")
      .insert({
        tenant_id: tenantB.tenantId,
        name: "Key Beta",
        key_prefix: secretB.keyPrefix,
        key_hash: secretB.keyHash,
        created_by: tenantB.userId,
      })
      .select("id")
      .single();
    keyB = { rawToken: secretB.rawToken, id: recordB!.id };
  });

  describe("1. Patients Collection: GET & POST", () => {
    let createdPatientId: string;

    it("POST /api/v1/patients returns 422 VALIDATION_ERROR for invalid payload", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/patients", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          full_name: "", // Invalid empty name
          phone: "123", // Invalid phone
        }),
      });

      const res = await createPatient(req);
      expect(res.status).toBe(422);

      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("POST /api/v1/patients creates a patient with created_by=session.userId and audits action", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/patients", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          full_name: "Aarav Sharma",
          phone: "9876543210",
          sex: "male",
          age: 32,
          allergies: ["Penicillin"],
        }),
      });

      const res = await createPatient(req);
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(json.data.full_name).toBe("Aarav Sharma");
      expect(json.data.created_by).toBe(tenantA.userId); // auth.users FK compliance
      expect(json.data.tenant_id).toBe(tenantA.tenantId);
      createdPatientId = json.data.id;

      // Verify audit trail
      const admin = getAdminClient();
      const { data: auditLogs } = await (admin.from("audit_logs") as any)
        .select("*")
        .eq("entity_id", createdPatientId)
        .eq("action", "patient.create");

      expect(auditLogs && auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].actor_type).toBe("api_key");
      expect(auditLogs[0].api_key_id).toBe(keyA.id);
    });

    it("GET /api/v1/patients returns uniform { data, meta } envelope and excludes is_deleted patients", async () => {
      const admin = getAdminClient();

      // Seed a soft-deleted patient
      await (admin.from("patients") as any).insert({
        tenant_id: tenantA.tenantId,
        full_name: "Erased Patient Doe",
        phone: "9876543219",
        is_deleted: true,
        status: "erased",
        created_by: tenantA.userId,
      });

      const req = new NextRequest("http://localhost:3000/api/v1/patients?page=1&limit=20", {
        method: "GET",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
        },
      });

      const res = await getPatients(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.meta).toBeDefined();
      expect(json.meta.page).toBe(1);
      expect(json.meta.limit).toBe(20);
      expect(json.meta.total).toBeGreaterThanOrEqual(1);

      // Verify active patient is present and erased patient is excluded
      const names = json.data.map((p: { full_name: string }) => p.full_name);
      expect(names).toContain("Aarav Sharma");
      expect(names).not.toContain("Erased Patient Doe");
    });
  });

  describe("2. Patients Detail: GET & PUT", () => {
    let patientId: string;

    beforeAll(async () => {
      const admin = getAdminClient();
      const { data } = await (admin.from("patients") as any)
        .insert({
          tenant_id: tenantA.tenantId,
          full_name: "Pooja Verma",
          phone: "9812345678",
          created_by: tenantA.userId,
        })
        .select("id")
        .single();
      patientId = data.id;
    });

    it("GET /api/v1/patients/[id] returns detail or 404 for nonexistent id", async () => {
      // 1. Existing ID
      const req = new NextRequest(`http://localhost:3000/api/v1/patients/${patientId}`, {
        headers: { authorization: `Bearer ${keyA.rawToken}` },
      });
      const res = await getPatientById(req, { params: Promise.resolve({ id: patientId }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.full_name).toBe("Pooja Verma");

      // 2. Nonexistent ID
      const fakeReq = new NextRequest("http://localhost:3000/api/v1/patients/00000000-0000-0000-0000-000000000000", {
        headers: { authorization: `Bearer ${keyA.rawToken}` },
      });
      const fakeRes = await getPatientById(fakeReq, {
        params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
      });
      expect(fakeRes.status).toBe(404);
    });

    it("PUT /api/v1/patients/[id] updates patient fields and logs audit event", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/patients/${patientId}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        // Demographics only: allergies and chronic conditions are refused for API keys (05-11d, N-6;
        // tests/api/v1-patients-no-clinical.spec.ts).
        body: JSON.stringify({
          full_name: "Synthetic Updated Name",
          age: 41,
        }),
      });

      const res = await updatePatientById(req, { params: Promise.resolve({ id: patientId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.full_name).toBe("Synthetic Updated Name");
      expect(json.data.age).toBe(41);

      // Check audit log
      const admin = getAdminClient();
      const { data: logs } = await (admin.from("audit_logs") as any)
        .select("*")
        .eq("entity_id", patientId)
        .eq("action", "patient.update");

      expect(logs && logs.length).toBeGreaterThan(0);
      expect(logs[0].actor_type).toBe("api_key");
      expect(logs[0].api_key_id).toBe(keyA.id);
    });
  });

  describe("3. Appointments CRUD Grounded in Visits Schema", () => {
    let patientId: string;
    let appointmentId: string;
    const baseSlot = "2026-11-20T05:00:00.000Z";
    const nextSlot = "2026-11-20T06:00:00.000Z";

    beforeAll(async () => {
      const admin = getAdminClient();
      const { data } = await (admin.from("patients") as any)
        .insert({
          tenant_id: tenantA.tenantId,
          full_name: "Vikram Malhotra",
          phone: "9823456789",
          created_by: tenantA.userId,
        })
        .select("id")
        .single();
      patientId = data.id;
    });

    it("POST /api/v1/appointments creates visit record with origin_type='scheduled', status='booked'", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/appointments", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorA.userId,
          scheduled_at: baseSlot,
          estimated_duration_minutes: 20,
          reason_for_visit: "General Checkup",
        }),
      });

      const res = await createAppointment(req);
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(json.data.origin_type).toBe("scheduled");
      expect(json.data.status).toBe("booked");
      expect(json.data.doctor_id).toBe(doctorA.userId);
      expect(json.data.created_by).toBe(tenantA.userId);
      appointmentId = json.data.id;
    });

    it("POST /api/v1/appointments rejects booking if slot conflicts with existing visit (409)", async () => {
      // Attempt to book the exact same slot for the same doctor
      const req = new NextRequest("http://localhost:3000/api/v1/appointments", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorA.userId,
          scheduled_at: baseSlot,
          estimated_duration_minutes: 20,
        }),
      });

      const res = await createAppointment(req);
      expect(res.status).toBe(409);

      const json = await res.json();
      expect(json.error.code).toBe("SLOT_CONFLICT");
      expect(json.error.details.conflicting_visit_id).toBe(appointmentId);
    });

    it("GET /api/v1/appointments returns paginated visits filtered by doctor_id and date range", async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/v1/appointments?doctor_id=${doctorA.userId}&start_date=2026-11-20T00:00:00.000Z&end_date=2026-11-20T23:59:59.000Z`,
        {
          headers: { authorization: `Bearer ${keyA.rawToken}` },
        }
      );

      const res = await getAppointments(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(1);
      expect(json.data[0].id).toBe(appointmentId);
      expect(json.data[0].origin_type).toBe("scheduled");
    });

    it("GET /api/v1/appointments/[id] returns appointment details", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/appointments/${appointmentId}`, {
        headers: { authorization: `Bearer ${keyA.rawToken}` },
      });

      const res = await getAppointmentById(req, { params: Promise.resolve({ id: appointmentId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.id).toBe(appointmentId);
      expect(json.data.reason_for_visit).toBe("General Checkup");
    });

    it("PATCH /api/v1/appointments/[id] updates scheduled_at and records audit log", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          scheduled_at: nextSlot,
          reason: "Patient requested afternoon reschedule",
        }),
      });

      const res = await rescheduleAppointmentById(req, {
        params: Promise.resolve({ id: appointmentId }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(new Date(json.data.scheduled_at).toISOString()).toBe(nextSlot);

      // Verify audit log
      const admin = getAdminClient();
      const { data: logs } = await (admin.from("audit_logs") as any)
        .select("*")
        .eq("entity_id", appointmentId)
        .eq("action", "appointment.reschedule");

      expect(logs && logs.length).toBeGreaterThan(0);
      expect(logs[0].actor_type).toBe("api_key");
    });

    it("DELETE /api/v1/appointments/[id] cancels appointment and returns success envelope", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/appointments/${appointmentId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${keyA.rawToken}` },
      });

      const res = await cancelAppointmentById(req, {
        params: Promise.resolve({ id: appointmentId }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.status).toBe("cancelled");

      // Verify database record status
      const admin = getAdminClient();
      const { data: visit } = await (admin.from("visits") as any)
        .select("status")
        .eq("id", appointmentId)
        .single();

      expect(visit?.status).toBe("cancelled");
    });
  });

  describe("4. Cross-Tenant Isolation Enforcement", () => {
    let patientBId: string;
    let appointmentBId: string;

    beforeAll(async () => {
      const admin = getAdminClient();
      // Create patient and appointment in Tenant B
      const { data: pB } = await (admin.from("patients") as any)
        .insert({
          tenant_id: tenantB.tenantId,
          full_name: "Tenant B Patient",
          phone: "9988776655",
          created_by: tenantB.userId,
        })
        .select("id")
        .single();
      patientBId = pB.id;

      const { data: appB } = await (admin.from("visits") as any)
        .insert({
          tenant_id: tenantB.tenantId,
          patient_id: patientBId,
          doctor_id: doctorB.userId,
          origin_type: "scheduled",
          scheduled_at: "2026-11-25T14:00:00.000Z",
          status: "booked",
          created_by: tenantB.userId,
        })
        .select("id")
        .single();
      appointmentBId = appB.id;
    });

    it("Key A cannot read Tenant B patient (returns 404)", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/patients/${patientBId}`, {
        headers: { authorization: `Bearer ${keyA.rawToken}` },
      });

      const res = await getPatientById(req, { params: Promise.resolve({ id: patientBId }) });
      expect(res.status).toBe(404);
    });

    it("Key A cannot update Tenant B patient (returns 404)", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/patients/${patientBId}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ full_name: "Hacked Name" }),
      });

      const res = await updatePatientById(req, { params: Promise.resolve({ id: patientBId }) });
      expect(res.status).toBe(404);
    });

    it("Key A cannot read Tenant B appointment (returns 404)", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/appointments/${appointmentBId}`, {
        headers: { authorization: `Bearer ${keyA.rawToken}` },
      });

      const res = await getAppointmentById(req, {
        params: Promise.resolve({ id: appointmentBId }),
      });
      expect(res.status).toBe(404);
    });

    it("Key A cannot cancel Tenant B appointment (returns 404)", async () => {
      const req = new NextRequest(`http://localhost:3000/api/v1/appointments/${appointmentBId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${keyA.rawToken}` },
      });

      const res = await cancelAppointmentById(req, {
        params: Promise.resolve({ id: appointmentBId }),
      });
      expect(res.status).toBe(404);
    });

    it("Key A cannot create appointment for Tenant B patient (returns 404)", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/appointments", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: patientBId, // Cross-tenant patient
          doctor_id: doctorA.userId,
          scheduled_at: "2026-11-26T10:00:00.000Z",
        }),
      });

      const res = await createAppointment(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.message).toContain("Patient not found in active clinic");
    });

    it("Key A cannot assign Doctor B from Tenant B (returns 403)", async () => {
      // Create local patient in Tenant A
      const admin = getAdminClient();
      const { data: pA } = await (admin.from("patients") as any)
        .insert({
          tenant_id: tenantA.tenantId,
          full_name: "Local Patient A",
          phone: "9876543200",
          created_by: tenantA.userId,
        })
        .select("id")
        .single();

      const req = new NextRequest("http://localhost:3000/api/v1/appointments", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          patient_id: pA.id,
          doctor_id: doctorB.userId, // Cross-tenant doctor!
          scheduled_at: "2026-11-26T10:00:00.000Z",
        }),
      });

      const res = await createAppointment(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
      expect(json.error.message).toContain("Assigned doctor is not a registered doctor or owner");
    });
  });
});
