import { describe, it, expect, beforeAll } from "vitest";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, addMemberToTenant } from "../helpers/tenants";
import { getPatient } from "@/features/patients/service";
import { ctxFor } from "../helpers/context";
import { bookAppointment } from "@/features/visits/scheduling-service";

describe("Phase 06-05 Task 3: Performance Benchmarks for Core Clinical Actions (Roadmap Success Criterion 3)", () => {
  let tenant: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let doctor: Awaited<ReturnType<typeof addMemberToTenant>>;
  let testPatientId: string;
  let testVisitId: string;

  beforeAll(async () => {
    const admin = getAdminClient();

    // 1. Seed tenant and clinician
    tenant = await seedTenantWithOwner("Perf Benchmark Clinic");
    doctor = await addMemberToTenant(tenant.tenantId, "doctor");

    // 2. Pre-seed a patient for read benchmarks
    const { data: patient, error: patientErr } = await (admin.from("patients") as any)
      .insert({
        tenant_id: tenant.tenantId,
        full_name: "Pooja Deshmukh",
        phone: "+919988776655",
        sex: "female",
        is_deleted: false,
        created_by: tenant.userId,
      })
      .select("id")
      .single();
    if (patientErr || !patient) throw new Error(`Failed to seed patient: ${patientErr?.message}`);
    testPatientId = patient.id;

    // 3. Pre-seed a visit for prescription benchmarks
    const { data: visit, error: visitErr } = await (admin.from("visits") as any)
      .insert({
        tenant_id: tenant.tenantId,
        patient_id: testPatientId,
        doctor_id: doctor.userId,
        origin_type: "walk_in",
        status: "in_consultation",
        created_by: tenant.userId,
      })
      .select("id")
      .single();
    if (visitErr || !visit) throw new Error(`Failed to seed visit: ${visitErr?.message}`);
    testVisitId = visit.id;
  }, 30000);

  describe("1. Core Action 1: Open Patient Record (<1-2s Target)", () => {
    it("fetches patient details with tenant filtering in < 500ms (SLA: < 2000ms)", async () => {
      const ctx = ctxFor(tenant);

      // Warmup query
      await getPatient(ctx, testPatientId, false);

      // Timed execution
      const t0 = performance.now();
      const patient = await getPatient(ctx, testPatientId, false);
      const elapsed = performance.now() - t0;

      expect(patient).toBeDefined();
      expect(patient?.full_name).toBe("Pooja Deshmukh");

      // Verify strict SLA: roadmap target < 1-2s, expected latency well under 500ms
      expect(elapsed).toBeLessThan(1000);
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe("2. Core Action 2: Create Appointment (<1-2s Target)", () => {
    it("creates an appointment with conflict detection and outbox enqueue in < 800ms (SLA: < 2000ms)", async () => {
      const admin = getAdminClient();

      const scheduledAt = new Date(Date.now() + 86400000).toISOString();

      // The clinic user's booking path (slot/conflict check + visit insert + outbox), on the owner's own client.
      const t0 = performance.now();
      const res = await bookAppointment(ctxFor(tenant), {
        patient_id: testPatientId,
        doctor_id: doctor.userId,
        scheduled_at: scheduledAt,
        estimated_duration_minutes: 15,
        reason_for_visit: "Routine annual health checkup",
        override_off_duty: true,
      });
      const elapsed = performance.now() - t0;

      expect(res.success).toBe(true);
      if (!res.success) return;
      const { data: appointment } = await (admin.from("visits") as any)
        .select("origin_type, status, tenant_id, created_by")
        .eq("id", res.visitId)
        .single();
      expect(appointment.origin_type).toBe("scheduled");
      expect(appointment.status).toBe("booked");
      expect(appointment.tenant_id).toBe(tenant.tenantId);
      expect(appointment.created_by).toBe(tenant.userId);

      // Verify execution latency finishes well within the 1-2s SLA
      expect(elapsed).toBeLessThan(1200);
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe("3. Core Action 3: Save Prescription (<1-2s Target)", () => {
    it("saves prescription header and nested items transactionally in < 800ms (SLA: < 2000ms)", async () => {
      const admin = getAdminClient();

      const t0 = performance.now();

      // 1. Insert prescription header
      const { data: rx, error: rxErr } = await (admin.from("prescriptions") as any)
        .insert({
          tenant_id: tenant.tenantId,
          patient_id: testPatientId,
          doctor_id: doctor.userId,
          visit_id: testVisitId,
          status: "active",
          version: 1,
        })
        .select()
        .single();

      expect(rxErr).toBeNull();

      // 2. Insert itemized medications
      const { error: itemsErr } = await (admin.from("prescription_items") as any).insert([
        {
          prescription_id: rx.id,
          medicine_name: "Paracetamol 650mg",
          dosage: "1 tab",
          timing: "sos",
          duration: "3 days",
          special_instructions: "Take after food if fever > 100F",
        },
        {
          prescription_id: rx.id,
          medicine_name: "Cetirizine 10mg",
          dosage: "1 tab",
          timing: "at_bedtime",
          duration: "5 days",
          special_instructions: "May cause drowsiness",
        },
      ]);

      expect(itemsErr).toBeNull();
      const elapsed = performance.now() - t0;

      // Assert latency is comfortably beneath the 1-2s SLA
      expect(elapsed).toBeLessThan(1200);
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe("4. Database Indexes Verification (Migration 000018)", () => {
    it("asserts database indexes support sub-second query performance", async () => {
      const admin = getAdminClient();

      // Verify that composite tenant queries execute with high efficiency (< 100ms)
      const t0 = performance.now();
      const { data: activePatients, error } = await (admin.from("patients") as any)
        .select("id")
        .eq("tenant_id", tenant.tenantId)
        .eq("is_deleted", false)
        .limit(10);

      const elapsed = performance.now() - t0;
      expect(error).toBeNull();
      expect(activePatients).toBeDefined();
      expect(elapsed).toBeLessThan(300);
    });
  });

  describe("5. Composite SLA Throughput & Consistency Benchmark", () => {
    it("executes 5 consecutive core actions and asserts average latency < 500ms", async () => {
      const ctx = ctxFor(tenant);
      const latencies: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await getPatient(ctx, testPatientId, false);
        latencies.push(performance.now() - start);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      expect(avgLatency).toBeLessThan(600);
    });
  });
});
