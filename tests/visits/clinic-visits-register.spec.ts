/**
 * Clinic visits register and filters (Plan 03.2-02 / REQ-diagnosis-visit-management).
 *
 * The `computeDateRange` cases are pure unit tests. The register and doctor-list cases were rewritten in V2-02
 * 02-04 (TEST_STRATEGY T-12, E-5) from a mocked client, whose "isolation" check only proved the service called
 * `.eq("tenant_id", ...)`, into tests on the local stack: two tenants are seeded and the services run with real JWT
 * clients (RLS applies), including a user who is a member of both tenants.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { computeDateRange } from "@/features/visits/schema";
import { getClinicVisitsRegister, getActiveClinicDoctors } from "@/features/visits/service";
import { randomUUID } from "node:crypto";
import {
  addMemberToTenant,
  createDualMembershipUser,
  seedTenantWithOwner,
  type DualMemberUser,
  type SeededTenant,
} from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { insertReturningId, type IdTable } from "../helpers/db";
import type { TablesInsert } from "@/types/database";

function insertRow<T extends IdTable>(table: T, row: TablesInsert<T>): Promise<string> {
  return insertReturningId(getAdminClient(), table, row);
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe("Clinic Visits Register & Filters (Plan 03.2-02 / REQ-diagnosis-visit-management)", () => {
  describe("computeDateRange (clinic days in the tenant zone, half-open; V2-03 03-05)", () => {
    // 20:00 IST on 16 Oct 2026.
    const fixedNow = new Date("2026-10-16T14:30:00.000Z");
    const IST = "Asia/Kolkata";

    it("today is the IST day [15 Oct 18:30Z, 16 Oct 18:30Z)", () => {
      expect(computeDateRange("today", null, null, IST, fixedNow)).toEqual({
        startIso: "2026-10-15T18:30:00.000Z",
        endIsoExclusive: "2026-10-16T18:30:00.000Z",
      });
    });

    it("yesterday is the previous IST day", () => {
      expect(computeDateRange("yesterday", null, null, IST, fixedNow)).toEqual({
        startIso: "2026-10-14T18:30:00.000Z",
        endIsoExclusive: "2026-10-15T18:30:00.000Z",
      });
    });

    it("last_7_days covers exactly 7 IST calendar days ending today", () => {
      const { startIso, endIsoExclusive } = computeDateRange("last_7_days", null, null, IST, fixedNow);
      expect(startIso).toBe("2026-10-09T18:30:00.000Z");
      expect(endIsoExclusive).toBe("2026-10-16T18:30:00.000Z");
      expect((Date.parse(endIsoExclusive) - Date.parse(startIso)) / 86_400_000).toBe(7);
    });

    it("this_month runs from 1 Oct to 1 Nov (IST midnights)", () => {
      expect(computeDateRange("this_month", null, null, IST, fixedNow)).toEqual({
        startIso: "2026-09-30T18:30:00.000Z",
        endIsoExclusive: "2026-10-31T18:30:00.000Z",
      });
    });

    it("accepts custom date range boundaries as whole IST days; an invalid date falls back to today", () => {
      expect(computeDateRange("custom", "2026-10-01", "2026-10-10", IST, fixedNow)).toEqual({
        startIso: "2026-09-30T18:30:00.000Z",
        endIsoExclusive: "2026-10-10T18:30:00.000Z",
      });
      expect(computeDateRange("custom", "not-a-date", null, IST, fixedNow)).toEqual(
        computeDateRange("today", null, null, IST, fixedNow)
      );
    });
  });

  describe("getClinicVisitsRegister and getActiveClinicDoctors (local stack, two tenants)", () => {
    // "last_7_days" rather than "today" so a run that crosses the clinic's midnight after seeding still sees every visit.
    const filter = { datePreset: "last_7_days" as const };

    let ownerA: SeededTenant;
    let doctorA1: SeededTenant;
    let doctorA2: SeededTenant;
    let ownerB: SeededTenant;
    let doctorB: SeededTenant;
    let dual: DualMemberUser;
    let v1: string;
    let v2: string;
    let v3: string;
    let visitB: string;

    beforeAll(async () => {
      const admin = getAdminClient();
      const suffix = randomUUID().slice(0, 8);

      ownerA = await seedTenantWithOwner(`Register Clinic A ${suffix}`);
      doctorA1 = await addMemberToTenant(ownerA.tenantId, "doctor");
      doctorA2 = await addMemberToTenant(ownerA.tenantId, "doctor");
      ownerB = await seedTenantWithOwner(`Register Clinic B ${suffix}`);
      doctorB = await addMemberToTenant(ownerB.tenantId, "doctor");
      dual = await createDualMembershipUser(ownerA.tenantId, "doctor", ownerB.tenantId, "receptionist");

      const { error: profileErr } = await admin
        .from("memberships")
        .update({ full_name: "Dr. Synthetic Raj", qualifications: "MBBS, MD" })
        .eq("user_id", doctorA1.userId)
        .eq("tenant_id", ownerA.tenantId);
      if (profileErr) throw new Error(`doctor profile seed failed: ${profileErr.message}`);

      const p1 = await insertRow("patients", {
        tenant_id: ownerA.tenantId,
        full_name: "Synthetic Register Patient One",
        phone: "+919800000301",
        sex: "male",
        age: 32,
        created_by: ownerA.userId,
      });
      const p2 = await insertRow("patients", {
        tenant_id: ownerA.tenantId,
        full_name: "Synthetic Register Patient Two",
        phone: "+919800000302",
        sex: "female",
        age: 28,
        created_by: ownerA.userId,
      });
      const pB = await insertRow("patients", {
        tenant_id: ownerB.tenantId,
        full_name: "Synthetic Register Patient B",
        phone: "+919800000303",
        sex: "female",
        age: 45,
        created_by: ownerB.userId,
      });

      const visit = (
        row: Omit<TablesInsert<"visits">, "origin_type" | "specialty"> &
          Partial<Pick<TablesInsert<"visits">, "origin_type" | "specialty">>,
      ) =>
        insertRow("visits", { origin_type: "walk_in", specialty: "general_physician", ...row });
      v1 = await visit({
        tenant_id: ownerA.tenantId,
        patient_id: p1,
        doctor_id: doctorA1.userId,
        status: "completed",
        created_at: minutesAgo(30),
        reason_for_visit: "Synthetic cough",
        created_by: ownerA.userId,
      });
      v2 = await visit({
        tenant_id: ownerA.tenantId,
        patient_id: p1,
        doctor_id: doctorA1.userId,
        origin_type: "scheduled",
        status: "in_consultation",
        scheduled_at: minutesAgo(20),
        created_at: minutesAgo(20),
        reason_for_visit: "Synthetic follow-up",
        created_by: ownerA.userId,
      });
      v3 = await visit({
        tenant_id: ownerA.tenantId,
        patient_id: p2,
        doctor_id: doctorA2.userId,
        status: "waiting",
        created_at: minutesAgo(10),
        reason_for_visit: "Synthetic rash",
        created_by: ownerA.userId,
      });
      visitB = await visit({
        tenant_id: ownerB.tenantId,
        patient_id: pB,
        doctor_id: doctorB.userId,
        status: "completed",
        created_at: minutesAgo(15),
        reason_for_visit: "Synthetic tenant B visit",
        created_by: ownerB.userId,
      });

      await insertRow("queue_tokens", { tenant_id: ownerA.tenantId, visit_id: v1, token_number: 1 });
      await insertRow("queue_tokens", { tenant_id: ownerA.tenantId, visit_id: v2, token_number: 2 });
      await insertRow("consultation_diagnoses", {
        tenant_id: ownerA.tenantId,
        visit_id: v1,
        patient_id: p1,
        diagnosis_name: "Viral Bronchitis",
        icd11_code: "CA42",
      });
      const rxId = await insertRow("prescriptions", {
        tenant_id: ownerA.tenantId,
        visit_id: v1,
        patient_id: p1,
        doctor_id: doctorA1.userId,
        version: 1,
        status: "active",
        letterhead_mode: "blank_paper",
        signed_at: minutesAgo(25),
      });
      await insertRow("prescription_items", {
        tenant_id: ownerA.tenantId,
        prescription_id: rxId,
        medicine_name: "Azithromycin 500mg",
        dosage: "1-0-0",
        timing: "Before food",
        duration: "3 days",
      });

      const invoice = (tenantId: string, patientId: string, visitId: string, amount: number, status: string) =>
        insertRow("invoices", {
          tenant_id: tenantId,
          patient_id: patientId,
          visit_id: visitId,
          invoice_number: `INV-REG-${suffix}-${visitId.slice(0, 8)}`,
          subtotal: amount,
          total_amount: amount,
          status,
        });
      const inv1 = await invoice(ownerA.tenantId, p1, v1, 600, "paid");
      await invoice(ownerA.tenantId, p1, v2, 400, "draft");
      // Tenant B's revenue must never reach tenant A's metrics.
      await invoice(ownerB.tenantId, pB, visitB, 999, "issued");
      await insertRow("payments", {
        tenant_id: ownerA.tenantId,
        invoice_id: inv1,
        amount: 600,
        payment_method: "cash",
        recorded_by: ownerA.userId,
        recorded_at: minutesAgo(25),
      });
    });

    it("returns only the active tenant's visits, newest first, with summary metrics and joined data", async () => {
      const result = await getClinicVisitsRegister(ctxFor(ownerA), filter);

      expect(result.visits.map((v) => v.id)).toEqual([v3, v2, v1]);
      expect(result.totalCount).toBe(3);
      expect(result.metrics).toEqual({
        totalVisits: 3,
        completedVisits: 1,
        inProgressVisits: 1,
        waitingVisits: 1,
        totalBilledRevenue: 1000, // 600 + 400; tenant B's 999 excluded
      });

      const first = result.visits.find((v) => v.id === v1);
      expect(first?.patient.full_name).toBe("Synthetic Register Patient One");
      expect(first?.doctor.full_name).toBe("Dr. Synthetic Raj");
      expect(first?.token_number).toBe(1);
      expect(first?.diagnoses.map((d) => d.diagnosis_name)).toEqual(["Viral Bronchitis"]);
      expect(first?.prescription?.item_count).toBe(1);
      expect(first?.invoice?.status).toBe("paid");
      expect(first?.invoice?.balance_due).toBe(0);
    });

    it("scopes the register to the context's tenant even for a user whose RLS reaches both tenants", async () => {
      // Each context's client names its clinic in x-clinicos-tenant, as the app's createClient() does (R-42; the
      // policies are bound to the active clinic since 05-02b).
      const clientInA = await signInActingIn(dual.userEmail, ownerA.tenantId);
      const clientInB = await signInActingIn(dual.userEmail, ownerB.tenantId);
      const inA = ctxFor({ userId: dual.userId, tenantId: ownerA.tenantId, role: dual.roleInA, client: clientInA });
      const inB = ctxFor({ userId: dual.userId, tenantId: ownerB.tenantId, role: dual.roleInB, client: clientInB });

      const asA = await getClinicVisitsRegister(inA, filter);
      expect(asA.visits.map((v) => v.id)).toEqual([v3, v2, v1]);
      // A doctor reads only the invoices of their own visits (05-02b, PO-3 / R-7): none of these are theirs.
      expect(asA.metrics.totalBilledRevenue).toBe(0);
      expect(asA.visits.every((v) => v.invoice === null || v.invoice === undefined)).toBe(true);

      // The same JWT does reach B's rows when acting in B, so A's result is the service's tenant scoping.
      const asB = await getClinicVisitsRegister(inB, filter);
      expect(asB.visits.map((v) => v.id)).toEqual([visitB]);
      expect(asB.metrics.totalBilledRevenue).toBe(999);
    });

    it("lists the active tenant's doctors, owners and admins only", async () => {
      const doctors = await getActiveClinicDoctors(ctxFor(ownerA));
      const ids = doctors.map((d) => d.user_id);

      expect(ids).toEqual(expect.arrayContaining([ownerA.userId, doctorA1.userId, doctorA2.userId, dual.userId]));
      expect(ids).toHaveLength(4);
      expect(ids).not.toContain(ownerB.userId);
      expect(ids).not.toContain(doctorB.userId);
      expect(doctors.find((d) => d.user_id === doctorA1.userId)?.full_name).toBe("Dr. Synthetic Raj");

      const dualInA = ctxFor({
        userId: dual.userId,
        tenantId: ownerA.tenantId,
        role: dual.roleInA,
        client: dual.client,
      });
      const dualIds = (await getActiveClinicDoctors(dualInA)).map((d) => d.user_id);
      expect(dualIds).not.toContain(ownerB.userId);
      expect(dualIds).not.toContain(doctorB.userId);
    });
  });
});
