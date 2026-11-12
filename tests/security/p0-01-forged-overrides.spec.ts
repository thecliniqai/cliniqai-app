/**
 * P0-01 forged-override regressions at the server-action layer (plan 01-01d; SECURITY_VERIFICATION_PLAN §6.2;
 * ADR-0005 Verification 1 and 2). Each action is called exactly as a browser can call it, with the old override
 * seams forged as trailing arguments: a service-role client and a "session" that claims tenant B's owner.
 *   - TC-SA-01..06 (SEC-01): searchPatients, getPatient, getPatients, updateClinicSettings, updateStatutorySettings,
 *     toggleGlobalConsent: (a) unauthenticated → auth error, tenant B untouched; (b) receptionist A → A-scoped or
 *     denied, tenant B untouched.
 *   - TC-SA-10.. (SEC-02): receptionist and nurse → completeAndSignConsultation, addPrescriptionItem,
 *     reopenVisitForAmendment, finalizeVisitAmendment denied; doctor → clinic:manage actions denied. The services'
 *     own checks are covered by tests/integration/consultation-service-guards.spec.ts and
 *     tests/settings/settings-service-guards.spec.ts; this proves the action layer ignores a role-escalating forged
 *     session.
 *   - TC-SA-30 (SEC-02): created_by, the signer, recorded_by and audit actor_id are the session user even when a
 *     forged actor is passed; a tenant-B id passed where a target is accepted gives A-scoped results.
 *
 * Runs on the local stack: `createClient()` from `@/lib/supabase/server` returns the acting seeded user's own JWT
 * client (or an anonymous client), so the session resolves through the real `auth.getUser()` and RLS.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { createVisit } from "@/features/visits/service";

const mockState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockState.client,
}));

import { searchPatients, getPatient, getPatients, createPatient } from "@/features/patients/actions";
import { toggleGlobalConsent } from "@/features/patients/consent";
import { findPotentialDuplicates } from "@/features/patients/dedup";
import { updateClinicSettings, updateStatutorySettings } from "@/features/settings/actions";
import {
  saveConsultationDraft,
  completeAndSignConsultation,
  reopenVisitForAmendment,
  finalizeVisitAmendment,
} from "@/features/consultation/actions";
import { addPrescriptionItem } from "@/features/prescriptions/actions";
import { recordVisitVitals } from "@/features/visits/actions";

// Server actions are typed without the removed override parameters; the browser can still send extra arguments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = (...args: any[]) => Promise<any>;
const call = (fn: unknown, ...args: unknown[]) => (fn as AnyAction)(...args);

const AUTH_FAILURE = /unauthenticated/i;
const PERMISSION_DENIED = /permission/i;
const SHARED_PHONE = "+919800000311";

describe("P0-01 forged overrides at the action layer", () => {
  let admin: SupabaseClient;
  let ownerA: SeededTenant;
  let receptionistA: SeededTenant;
  let nurseA: SeededTenant;
  let doctorA: SeededTenant;
  let ownerB: SeededTenant;
  let patientA: string;
  let patientB: string;
  let forgedClient: SupabaseClient;
  let forgedSession: { userId: string; tenantId: string; role: "owner" };

  const anon = () =>
    createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

  const actAs = (t: SeededTenant | null) => {
    mockState.client = t ? t.client : anon();
  };

  async function outcome(fn: unknown, ...args: unknown[]): Promise<{ threw?: string; value?: unknown }> {
    try {
      return { value: await call(fn, ...args) };
    } catch (err) {
      return { threw: err instanceof Error ? err.message : String(err) };
    }
  }

  async function seedPatient(tenant: SeededTenant, fullName: string, phone: string): Promise<string> {
    const { data, error } = await admin
      .from("patients")
      .insert({ tenant_id: tenant.tenantId, full_name: fullName, phone, sex: "female", age: 44, created_by: tenant.userId })
      .select("id")
      .single();
    if (error || !data) throw new Error(`patient seed failed: ${error?.message}`);
    return data.id;
  }

  async function tenantRow(tenantId: string) {
    const { data } = await admin.from("tenants").select("*").eq("id", tenantId).single();
    return data;
  }

  async function consentRows(patientId: string) {
    const { data } = await admin.from("consent_records").select("id, tenant_id").eq("patient_id", patientId);
    return data ?? [];
  }

  async function newVisitA(): Promise<string> {
    const res = await createVisit(ctxFor(ownerA), {
      patient_id: patientA,
      doctor_id: doctorA.userId,
      origin_type: "walk_in",
      scheduled_at: new Date().toISOString(),
      estimated_duration_minutes: 15,
      is_overbooked: false,
    });
    if (!res.success) throw new Error(`visit seed failed: ${res.error}`);
    return res.visitId;
  }

  beforeAll(async () => {
    admin = getAdminClient() as unknown as SupabaseClient;
    ownerA = await seedTenantWithOwner("P0-01 Forged Clinic A");
    receptionistA = await addMemberToTenant(ownerA.tenantId, "receptionist");
    nurseA = await addMemberToTenant(ownerA.tenantId, "nurse");
    doctorA = await addMemberToTenant(ownerA.tenantId, "doctor");
    ownerB = await seedTenantWithOwner("P0-01 Forged Clinic B");
    patientA = await seedPatient(ownerA, "Synthetic Forged Target A", SHARED_PHONE);
    patientB = await seedPatient(ownerB, "Synthetic Forged Target B", SHARED_PHONE);
    forgedClient = getAdminClient() as unknown as SupabaseClient;
    forgedSession = { userId: ownerB.userId, tenantId: ownerB.tenantId, role: "owner" };
  });

  describe("TC-SA-01..06 (a): unauthenticated with forged overrides", () => {
    it("the three patient reads throw an authentication error and return no rows", async () => {
      actAs(null);
      for (const [fn, args] of [
        [searchPatients, ["Synthetic Forged Target"]],
        [getPatient, [patientB, true]],
        [getPatients, []],
      ] as const) {
        const res = await outcome(fn, ...args, forgedClient, forgedSession);
        expect(res.value).toBeUndefined();
        expect(res.threw).toMatch(AUTH_FAILURE);
      }
    });

    it("the three writes return an authentication error and change nothing in tenant B", async () => {
      actAs(null);
      const tenantBBefore = await tenantRow(ownerB.tenantId);
      const consentBefore = await consentRows(patientB);

      const results = [
        await call(updateClinicSettings, { name: "Forged Clinic Name" }, forgedClient, forgedSession),
        await call(updateStatutorySettings, { gstin: null, drug_license_no: "FORGED-DL" }, forgedClient, forgedSession),
        await call(toggleGlobalConsent, patientB, "withdrawn", "forged", forgedClient, forgedSession),
      ];
      for (const res of results) {
        expect(res.success).toBe(false);
        expect(res.error).toMatch(AUTH_FAILURE);
      }
      expect(await tenantRow(ownerB.tenantId)).toEqual(tenantBBefore);
      expect(await consentRows(patientB)).toEqual(consentBefore);
    });
  });

  describe("TC-SA-01..06 (b): receptionist in tenant A with forged tenant-B overrides", () => {
    it("searchPatients returns only tenant A's match", async () => {
      actAs(receptionistA);
      const rows = await call(searchPatients, "Synthetic Forged Target", forgedClient, forgedSession);
      const ids = rows.map((p: { id: string }) => p.id);
      expect(ids).toContain(patientA);
      expect(ids).not.toContain(patientB);
      expect(rows.every((p: { tenant_id: string }) => p.tenant_id === ownerA.tenantId)).toBe(true);
    });

    it("getPatient returns null for tenant B's patient and the record for tenant A's", async () => {
      actAs(receptionistA);
      expect(await call(getPatient, patientB, true, forgedClient, forgedSession)).toBeNull();
      const own = await call(getPatient, patientA, false, forgedClient, forgedSession);
      expect(own?.id).toBe(patientA);
    });

    it("getPatients lists tenant A only", async () => {
      actAs(receptionistA);
      const rows = await call(getPatients, forgedClient, forgedSession);
      expect(rows.map((p: { id: string }) => p.id)).toContain(patientA);
      expect(rows.every((p: { tenant_id: string }) => p.tenant_id === ownerA.tenantId)).toBe(true);
    });

    it("clinic and statutory settings are denied (no clinic:manage) and neither tenant changes", async () => {
      actAs(receptionistA);
      const [aBefore, bBefore] = [await tenantRow(ownerA.tenantId), await tenantRow(ownerB.tenantId)];

      const clinic = await call(updateClinicSettings, { name: "Forged Clinic Name" }, forgedClient, forgedSession);
      const statutory = await call(updateStatutorySettings, { drug_license_no: "FORGED-DL" }, forgedClient, forgedSession);
      for (const res of [clinic, statutory]) {
        expect(res.success).toBe(false);
        expect(res.error).toMatch(PERMISSION_DENIED);
      }
      expect(await tenantRow(ownerA.tenantId)).toEqual(aBefore);
      expect(await tenantRow(ownerB.tenantId)).toEqual(bBefore);
    });

    it("toggleGlobalConsent is denied (no patients:edit) and writes no consent record", async () => {
      actAs(receptionistA);
      const [bBefore, aBefore] = [await consentRows(patientB), await consentRows(patientA)];
      const res = await call(toggleGlobalConsent, patientB, "withdrawn", "forged", forgedClient, forgedSession);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(PERMISSION_DENIED);
      expect(await consentRows(patientB)).toEqual(bBefore);
      expect(await consentRows(patientA)).toEqual(aBefore);
    });

    it("a nurse in A (patients:edit) who targets tenant B's patient writes nothing into tenant B", async () => {
      actAs(nurseA);
      await call(toggleGlobalConsent, patientB, "withdrawn", "forged", forgedClient, forgedSession);
      // Tenant B's view of its patient's consent history is unchanged; no row carries tenant B's id.
      const { data: seenByB } = await ownerB.client.from("consent_records").select("id").eq("patient_id", patientB);
      expect(seenByB ?? []).toEqual([]);
      const rows = await consentRows(patientB);
      expect(rows.filter((r) => r.tenant_id === ownerB.tenantId)).toEqual([]);
    });
  });

  describe("TC-SA-10..: a role-escalating forged session does not lift the action's permission check", () => {
    it("receptionist and nurse cannot sign, amend or prescribe; the visit and prescription are unchanged", async () => {
      const visitId = await newVisitA();
      actAs(doctorA);
      expect((await call(saveConsultationDraft, { visit_id: visitId, clinical_notes: "Synthetic note." })).success).toBe(
        true
      );
      const ownerASession = { userId: ownerA.userId, tenantId: ownerA.tenantId, role: "owner" };

      for (const actor of [receptionistA, nurseA]) {
        actAs(actor);
        const results = [
          await call(completeAndSignConsultation, visitId, forgedClient, ownerASession),
          await call(
            addPrescriptionItem,
            visitId,
            { medicine_name: "Synthetic Paracetamol", dosage: "1-0-1", duration: "3 days" },
            forgedClient,
            ownerASession
          ),
          await call(reopenVisitForAmendment, visitId, "Synthetic amendment reason text", forgedClient, ownerASession),
          await call(finalizeVisitAmendment, visitId, forgedClient, ownerASession),
        ];
        for (const res of results) {
          expect(res.success).toBe(false);
          expect(res.error).toMatch(PERMISSION_DENIED);
        }
      }

      const { data: visit } = await admin.from("visits").select("status, signed_by").eq("id", visitId).single();
      expect(visit?.status).not.toBe("completed");
      expect(visit?.signed_by).toBeNull();
      const { data: rx } = await admin.from("prescriptions").select("id").eq("visit_id", visitId);
      expect(rx ?? []).toEqual([]);
    });

    it("a doctor cannot change clinic or statutory settings (clinic:manage)", async () => {
      actAs(doctorA);
      const before = await tenantRow(ownerA.tenantId);
      const ownerASession = { userId: ownerA.userId, tenantId: ownerA.tenantId, role: "owner" };
      const clinic = await call(updateClinicSettings, { name: "Forged Clinic Name" }, forgedClient, ownerASession);
      const statutory = await call(updateStatutorySettings, { drug_license_no: "FORGED-DL" }, forgedClient, ownerASession);
      for (const res of [clinic, statutory]) {
        expect(res.success).toBe(false);
        expect(res.error).toMatch(PERMISSION_DENIED);
      }
      expect(await tenantRow(ownerA.tenantId)).toEqual(before);
    });
  });

  describe("TC-SA-30: the recorded actor is always the session user", () => {
    it("createPatient: created_by and the audit actor are the nurse, not the forged actor", async () => {
      actAs(nurseA);
      const res = await call(
        createPatient,
        {
          full_name: "Synthetic Attribution Patient",
          phone: "9800000312",
          age: 30,
          date_of_birth: null,
          abha_id: null,
          sex: "male",
          created_by: ownerA.userId,
          tenant_id: ownerB.tenantId,
        },
        forgedClient,
        { userId: ownerA.userId, tenantId: ownerB.tenantId, role: "owner" }
      );
      expect(res.success).toBe(true);

      const { data: row } = await admin.from("patients").select("tenant_id, created_by").eq("id", res.patientId).single();
      expect(row).toEqual({ tenant_id: ownerA.tenantId, created_by: nurseA.userId });

      const { data: audit } = await admin
        .from("audit_logs")
        .select("tenant_id, actor_id")
        .eq("entity_id", res.patientId)
        .eq("action", "patient.create");
      expect(audit).toEqual([{ tenant_id: ownerA.tenantId, actor_id: nurseA.userId }]);
    });

    it("recordVisitVitals: recorded_by is the nurse even when the input names another user", async () => {
      const visitId = await newVisitA();
      actAs(nurseA);
      const res = await call(
        recordVisitVitals,
        visitId,
        { systolic: 122, diastolic: 78, pulse: 71, recorded_by: ownerA.userId },
        forgedClient,
        { userId: ownerA.userId, tenantId: ownerA.tenantId, role: "owner" }
      );
      expect(res.success).toBe(true);
      const { data } = await admin.from("visits").select("vitals").eq("id", visitId).single();
      expect((data?.vitals as { recorded_by?: string }).recorded_by).toBe(nurseA.userId);
    });

    it("signing: the visit signer, the prescription's doctor and the audit actor are the session doctor", async () => {
      const visitId = await newVisitA();
      actAs(doctorA);
      const forgedActor = { userId: ownerA.userId, tenantId: ownerA.tenantId, role: "owner" };
      expect((await call(saveConsultationDraft, { visit_id: visitId, clinical_notes: "Synthetic note." })).success).toBe(
        true
      );
      const item = await call(
        addPrescriptionItem,
        visitId,
        { medicine_name: "Synthetic Paracetamol", dosage: "1-0-1", duration: "3 days" },
        forgedClient,
        forgedActor
      );
      expect(item.success).toBe(true);

      const signed = await call(completeAndSignConsultation, visitId, forgedClient, forgedActor);
      expect(signed.success).toBe(true);

      const { data: visit } = await admin.from("visits").select("status, signed_by").eq("id", visitId).single();
      expect(visit).toEqual({ status: "completed", signed_by: doctorA.userId });

      const { data: rx } = await admin.from("prescriptions").select("doctor_id, signed_at").eq("visit_id", visitId);
      expect(rx).toHaveLength(1);
      expect(rx?.[0].doctor_id).toBe(doctorA.userId);
      expect(rx?.[0].signed_at).not.toBeNull();

      const { data: audit } = await admin
        .from("audit_logs")
        .select("actor_id")
        .eq("entity_id", visitId)
        .eq("action", "visit.complete_and_sign");
      expect(audit).toEqual([{ actor_id: doctorA.userId }]);
    });

    it("findPotentialDuplicates: a tenant-B id passed as the old tenant override still gives A-scoped matches", async () => {
      actAs(receptionistA);
      const matches = await call(
        findPotentialDuplicates,
        { phone: SHARED_PHONE, fullName: "Synthetic Forged Target", tenantId: ownerB.tenantId },
        forgedClient,
        ownerB.tenantId
      );
      const ids = matches.map((m: { patient: { id: string } }) => m.patient.id);
      expect(ids).toContain(patientA);
      expect(ids).not.toContain(patientB);
      expect(matches.every((m: { patient: { tenant_id: string } }) => m.patient.tenant_id === ownerA.tenantId)).toBe(
        true
      );
    });
  });
});
