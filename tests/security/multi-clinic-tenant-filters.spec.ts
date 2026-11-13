/**
 * A member of two clinics acts only in the active one (V2-02 02-06, AR-M2b).
 *
 * RLS on visits, queue tokens, waitlist entries and referrals admits every clinic the user belongs to
 * (`current_user_tenant_ids()`), and the active clinic is the one the user picked (`clinic_active_tenant`). Before
 * 02-06 several services read and changed rows by id with RLS as the only scope, so a user who is a doctor in clinic A
 * and a receptionist in clinic C, acting in A, could check in, confirm, cancel or re-status C's visits, promote C's
 * waitlist entry and acknowledge C's inbound referral with A's role, and got an A queue token pointing at C's visit.
 * Every by-id read and write now filters on the active clinic (`ctx.tenantId`).
 *
 * Each case: refused for C's row, C's row unchanged, no clinic-A row references it; a positive control proves the same
 * call succeeds on A's own row. Local stack, real JWT clients, synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "@/lib/auth/context";
import { checkInVisit, transitionQueueState } from "@/features/queue/service";
import { cancelVisit, confirmAppointment, updateVisitStatus } from "@/features/visits/service";
import { promoteWaitlistEntry } from "@/features/waitlist/service";
import { acknowledgeReferral } from "@/features/referrals/service";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { insertReturningId, rowById, type IdTable } from "../helpers/db";
import type { Tables, TablesInsert } from "@/types/database";

const admin = getAdminClient();

function insertRow<T extends IdTable>(table: T, row: TablesInsert<T>): Promise<string> {
  return insertReturningId(admin, table, row);
}

function rowOf<T extends IdTable>(table: T, id: string): Promise<Tables<T>> {
  return rowById(admin, table, id);
}

interface ClinicRows {
  patient: string;
  visit: string;
  waitlist: string;
}

async function seedClinic(owner: SeededTenant, label: string): Promise<ClinicRows> {
  const patient = await insertRow("patients", {
    tenant_id: owner.tenantId,
    full_name: `Synthetic Multi Patient ${label}`,
    phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    created_by: owner.userId,
  });
  const newVisit = () =>
    insertRow("visits", {
      tenant_id: owner.tenantId,
      patient_id: patient,
      doctor_id: owner.userId,
      origin_type: "scheduled",
      status: "booked",
      scheduled_at: new Date(Date.now() + 2 * 86_400_000 + Math.floor(Math.random() * 600) * 60_000).toISOString(),
      created_by: owner.userId,
    });
  const visit = await newVisit();
  const waitlist = await insertRow("waitlist_entries", {
    tenant_id: owner.tenantId,
    patient_id: patient,
    doctor_id: owner.userId,
    target_date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
    created_by: owner.userId,
  });
  return { patient, visit, waitlist };
}

describe("AR-M2b: a member of clinics A and C, acting in A, cannot reach C's rows by id", () => {
  let ownerA: SeededTenant;
  let ownerC: SeededTenant;
  let member: SeededTenant;
  let ctxA: ServiceContext;
  let A: ClinicRows;
  let C: ClinicRows;

  /** Clinic-A rows that mention any of C's ids. */
  async function aRowsReferencingC(): Promise<string[]> {
    const cIds = [C.patient, C.visit, C.waitlist, ownerC.tenantId];
    const out: string[] = [];
    // Data tables only: an audit row may record a refused id.
    for (const table of ["queue_tokens", "visits", "waitlist_entries"] as const) {
      const { data, error } = await admin.from(table).select("*").eq("tenant_id", ownerA.tenantId);
      if (error) throw new Error(`read ${table}: ${error.message}`);
      for (const row of data ?? []) if (cIds.some((id) => JSON.stringify(row).includes(id))) out.push(table);
    }
    return out;
  }

  beforeAll(async () => {
    const tag = randomUUID().slice(0, 8);
    ownerA = await seedTenantWithOwner(`Multi Clinic A ${tag}`);
    ownerC = await seedTenantWithOwner(`Multi Clinic C ${tag}`);
    member = await addMemberToTenant(ownerA.tenantId, "doctor");
    const { error } = await admin.from("memberships").insert({ user_id: member.userId, tenant_id: ownerC.tenantId, role: "receptionist" });
    if (error) throw new Error(`second membership failed: ${error.message}`);
    // The context a request in clinic A builds (lib/auth/context.ts): A's tenant and role, the member's JWT client.
    ctxA = { userId: member.userId, tenantId: ownerA.tenantId, role: "doctor", actorType: "user", db: member.client };
    A = await seedClinic(ownerA, "A");
    C = await seedClinic(ownerC, "C");
  }, 60_000);

  it("RLS alone would let the member read C's visit by id (the precondition the filters close)", async () => {
    const { data } = await member.client.from("visits").select("id").eq("id", C.visit).maybeSingle();
    expect(data).not.toBeNull();
  });

  it("checkInVisit: C's visit refused, no A queue token points at it, C's visit unchanged", async () => {
    const before = await rowOf("visits", C.visit);
    expect((await checkInVisit(ctxA, C.visit)).success).toBe(false);
    expect(await rowOf("visits", C.visit)).toEqual(before);
    const { data: tokens } = await admin.from("queue_tokens").select("id").eq("visit_id", C.visit);
    expect(tokens ?? []).toEqual([]);
    expect((await checkInVisit(ctxA, A.visit)).success).toBe(true);
  });

  it("updateVisitStatus, confirmAppointment, cancelVisit: C's visit refused and unchanged", async () => {
    const before = await rowOf("visits", C.visit);
    expect((await updateVisitStatus(ctxA, C.visit, "confirmed")).success).toBe(false);
    expect((await confirmAppointment(ctxA, C.visit)).success).toBe(false);
    expect((await cancelVisit(ctxA, C.visit)).success).toBe(false);
    expect(await rowOf("visits", C.visit)).toEqual(before);

    const control = await insertRow("visits", {
      tenant_id: ownerA.tenantId,
      patient_id: A.patient,
      doctor_id: ownerA.userId,
      origin_type: "scheduled",
      status: "booked",
      scheduled_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      created_by: ownerA.userId,
    });
    expect((await updateVisitStatus(ctxA, control, "booked")).success).toBe(true);
    expect((await confirmAppointment(ctxA, control)).success).toBe(true);
    expect((await cancelVisit(ctxA, control)).success).toBe(true);
  });

  it("transitionQueueState: C's visit refused and unchanged", async () => {
    const before = await rowOf("visits", C.visit);
    expect((await transitionQueueState(ctxA, C.visit, "in_consultation")).success).toBe(false);
    expect(await rowOf("visits", C.visit)).toEqual(before);
  });

  it("promoteWaitlistEntry: C's entry refused and unchanged, no A visit for C's patient", async () => {
    const before = await rowOf("waitlist_entries", C.waitlist);
    const at = new Date(Date.now() + 6 * 86_400_000).toISOString();
    expect((await promoteWaitlistEntry(ctxA, C.waitlist, at)).success).toBe(false);
    expect(await rowOf("waitlist_entries", C.waitlist)).toEqual(before);
    expect((await promoteWaitlistEntry(ctxA, A.waitlist, at)).success).toBe(true);
  });

  it("acknowledgeReferral: an inbound referral of C is not acknowledged from A", async () => {
    const source = await seedTenantWithOwner(`Multi Clinic S ${randomUUID().slice(0, 8)}`);
    const sourcePatient = await insertRow("patients", {
      tenant_id: source.tenantId,
      full_name: "Synthetic Multi Patient S",
      phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      created_by: source.userId,
    });
    const referral = (target: string) =>
      insertRow("referrals", {
        tenant_id: source.tenantId,
        patient_id: sourcePatient,
        referral_type: "in_network",
        target_tenant_id: target,
        referring_doctor_id: source.userId,
        referred_to_name: "Synthetic Specialist",
        reason_for_referral: "Synthetic reason",
      });
    const toC = await referral(ownerC.tenantId);
    const toA = await referral(ownerA.tenantId);
    expect((await acknowledgeReferral(ctxA, toC)).success).toBe(false);
    expect((await rowOf("referrals", toC)).status).toBe("sent");
    expect((await acknowledgeReferral(ctxA, toA)).success).toBe(true);
  });

  it("no clinic-A row references a clinic-C id", async () => {
    expect(await aRowsReferencingC()).toEqual([]);
  });
});
