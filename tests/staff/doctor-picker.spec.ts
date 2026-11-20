/**
 * V2-08 08-01a (R-2): who is offered as a visit's doctor. The picker lists a doctor and an owner who practises; an admin
 * is never listed, even with credentials, and an owner who does not practise is not listed. The listed set equals the
 * members the database accepts as a visit's doctor (`authz.role_has_permission(role, 'consultations:edit')`, the rule
 * of migration 000099 G-9), less a non-practising owner. Both pickers (`getActiveClinicDoctors` for filters and
 * booking, `getTenantDoctorDirectory` for scheduling) follow the same rule. Synthetic data, local stack only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getActiveClinicDoctors } from "@/features/visits/service";
import { getTenantDoctorDirectory } from "@/features/staff/service";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

let owner: SeededTenant;
let doctor: SeededTenant;
let admin: SeededTenant;
let nurse: SeededTenant;
let receptionist: SeededTenant;

async function setOwnerPractising(practising: boolean): Promise<void> {
  const { error } = await getAdminClient().from("tenants").update({ owner_is_practicing_doctor: practising }).eq("id", owner.tenantId);
  if (error) throw new Error(error.message);
}

/** The members the database accepts as a visit's doctor (G-9), by user id. */
function databaseClinicians(): string[] {
  return psql(
    `select user_id from public.memberships where tenant_id = '${owner.tenantId}' and status = 'active' ` +
      `and authz.role_has_permission(role, 'consultations:edit')`,
  );
}

describe("doctor picker (R-2)", () => {
  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Doctor Picker Clinic ${randomUUID().slice(0, 8)}`);
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    admin = await addMemberToTenant(owner.tenantId, "admin");
    nurse = await addMemberToTenant(owner.tenantId, "nurse");
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
    // The admin holds credentials: v1 offered such an admin as a doctor.
    const { error } = await getAdminClient()
      .from("memberships")
      .update({ qualifications: "MBBS", medical_council_reg_no: "SYN-0001", full_name: "Synthetic Credentialed Admin" })
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", admin.userId);
    if (error) throw new Error(error.message);
  });

  it("lists the doctor and the practising owner; never the admin (even with credentials), nurse or receptionist", async () => {
    await setOwnerPractising(true);
    const ctx = ctxFor(owner);
    const picker = (await getActiveClinicDoctors(ctx)).map((d) => d.user_id).sort();
    const directory = (await getTenantDoctorDirectory(ctx)).map((d) => d.id).sort();
    const expected = [owner.userId, doctor.userId].sort();
    expect(picker).toEqual(expected);
    expect(directory).toEqual(expected);
    for (const excluded of [admin, nurse, receptionist]) {
      expect(picker).not.toContain(excluded.userId);
      expect(directory).not.toContain(excluded.userId);
    }
  });

  it("an owner who is not practising is not listed; the doctor still is", async () => {
    await setOwnerPractising(false);
    try {
      const ctx = ctxFor(owner);
      expect((await getActiveClinicDoctors(ctx)).map((d) => d.user_id)).toEqual([doctor.userId]);
      expect((await getTenantDoctorDirectory(ctx)).map((d) => d.id)).toEqual([doctor.userId]);
    } finally {
      await setOwnerPractising(true);
    }
  });

  it("the listed set equals the members for whom the database accepts a doctor (consultations:edit)", async () => {
    await setOwnerPractising(true);
    const ctx = ctxFor(owner);
    const listed = (await getActiveClinicDoctors(ctx)).map((d) => d.user_id).sort();
    expect(listed).toEqual(databaseClinicians().sort());
    expect((await getTenantDoctorDirectory(ctx)).map((d) => d.id).sort()).toEqual(listed);
  });
});
