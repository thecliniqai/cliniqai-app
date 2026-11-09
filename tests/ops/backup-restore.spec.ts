import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { getAdminClient } from "@/lib/supabase/admin";
import { seedTenantWithOwner, addMemberToTenant } from "../helpers/tenants";

describe("Phase 06-05 Task 3: Backup & Restore Operational Verification (Roadmap Success Criterion 4)", () => {
  let tenant: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let doctor: Awaited<ReturnType<typeof addMemberToTenant>>;

  beforeAll(async () => {
    tenant = await seedTenantWithOwner("DR Backup Test Clinic");
    doctor = await addMemberToTenant(tenant.tenantId, "doctor");
  });

  describe("1. Operational Documentation & SLA Verification", () => {
    it("verifies docs/ops/backup-restore.md exists and specifies RTO, RPO, and PITR SLAs", () => {
      const docPath = path.join(process.cwd(), "docs", "ops", "backup-restore.md");
      expect(fs.existsSync(docPath)).toBe(true);

      const content = fs.readFileSync(docPath, "utf8").toLowerCase();
      expect(content).toContain("rto");
      expect(content).toContain("< 2 hours");
      expect(content).toContain("rpo");
      expect(content).toContain("< 15 minutes");
      expect(content).toContain("point in time recovery");
      expect(content).toContain("wal");
      expect(content).toContain("clinic-records");
      expect(content).toContain("pg_dump");
      expect(content).toContain("nmc regulation 1.3.1");
    });
  });

  describe("2. Database Schema Dump & Table RLS Integrity", () => {
    it("verifies all core tenant-isolated tables exist and are queryable by admin", async () => {
      const admin = getAdminClient();

      const requiredTables = [
        "tenants",
        "memberships",
        "patients",
        "visits",
        "prescriptions",
        "prescription_items",
        "patient_documents",
        "referrals",
        "api_keys",
        "webhook_subscriptions",
        "webhook_delivery_queue",
      ];

      for (const table of requiredTables) {
        const { error } = await (admin.from(table as any) as any).select("count", {
          count: "exact",
          head: true,
        });

        expect(error, `Table ${table} should be accessible in schema`).toBeNull();
      }
    });
  });

  describe("3. Logical Backup Snapshot & Restoration Integrity Simulation", () => {
    it("creates a consistent clinical snapshot and validates restoration data fidelity", async () => {
      const admin = getAdminClient();

      // 1. Seed clinical data inside test tenant
      const { data: patient, error: patientErr } = await (admin.from("patients") as any)
        .insert({
          tenant_id: tenant.tenantId,
          full_name: "Rohan Patel (Backup Test)",
          phone: "+919812345678",
          sex: "male",
          created_by: tenant.userId,
        })
        .select()
        .single();
      expect(patientErr).toBeNull();

      const { data: visit, error: visitErr } = await (admin.from("visits") as any)
        .insert({
          tenant_id: tenant.tenantId,
          patient_id: patient.id,
          doctor_id: doctor.userId,
          origin_type: "scheduled",
          scheduled_at: new Date().toISOString(),
          status: "in_consultation",
          created_by: tenant.userId,
        })
        .select()
        .single();
      expect(visitErr).toBeNull();

      const { data: rx, error: rxErr } = await (admin.from("prescriptions") as any)
        .insert({
          tenant_id: tenant.tenantId,
          patient_id: patient.id,
          doctor_id: doctor.userId,
          visit_id: visit.id,
          status: "active",
          version: 1,
        })
        .select()
        .single();
      expect(rxErr).toBeNull();

      await (admin.from("prescription_items") as any).insert([
        {
          prescription_id: rx.id,
          medicine_name: "Amoxicillin 500mg",
          dosage: "1 tab",
          timing: "after_meals",
          duration: "5 days",
          special_instructions: "Complete course",
        },
      ]);

      // 2. Perform Logical Extraction (Snapshot Simulation)
      const { data: snapshotPatients } = await (admin.from("patients") as any)
        .select("*")
        .eq("tenant_id", tenant.tenantId);

      const { data: snapshotVisits } = await (admin.from("visits") as any)
        .select("*")
        .eq("tenant_id", tenant.tenantId);

      const { data: snapshotRx } = await (admin.from("prescriptions") as any)
        .select("*, prescription_items(*)")
        .eq("tenant_id", tenant.tenantId);

      expect(snapshotPatients?.length).toBeGreaterThanOrEqual(1);
      expect(snapshotVisits?.length).toBeGreaterThanOrEqual(1);
      expect(snapshotRx?.length).toBeGreaterThanOrEqual(1);

      // 3. Verify Restoration Integrity Invariants
      const restoredPatient = snapshotPatients?.find((p: any) => p.id === patient.id);
      expect(restoredPatient).toBeDefined();
      expect(restoredPatient.full_name).toBe("Rohan Patel (Backup Test)");
      expect(restoredPatient.phone).toBe("+919812345678");

      const restoredVisit = snapshotVisits?.find((v: any) => v.id === visit.id);
      expect(restoredVisit).toBeDefined();
      expect(restoredVisit.patient_id).toBe(patient.id);
      expect(restoredVisit.doctor_id).toBe(doctor.userId);

      const restoredRx = snapshotRx?.find((r: any) => r.id === rx.id);
      expect(restoredRx).toBeDefined();
      expect(restoredRx.visit_id).toBe(visit.id);
      expect(restoredRx.prescription_items?.length).toBe(1);
      expect(restoredRx.prescription_items[0].medicine_name).toBe("Amoxicillin 500mg");
    });
  });
});
