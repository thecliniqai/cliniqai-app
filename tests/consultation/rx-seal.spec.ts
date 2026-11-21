/**
 * V2-09a 09A-02 (R-8, I-1): a signed prescription header cannot be rewritten by anyone, and a request path creates at most one header per visit.
 * Real PostgREST calls with each role's own JWT, and the service role (the v1 API's client). `version`, `status`, `signed_at` and
 * `amendment_reason` are not columns a request path writes (the 000108 column grant), so every role is refused by privilege; the service role
 * is refused by the seal guard once the visit is signed (`RX_SEALED`) and is admitted on a draft (the control). Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { prescriptionsOfVisit, seedClinicalVisit, signVisitAs, type ClinicalVisit } from "../helpers/clinical-commands";

const admin = getAdminClient();
let owner: SeededTenant;
let otherOwner: SeededTenant;
const members = {} as Record<"doctor" | "admin" | "nurse" | "receptionist", SeededTenant>;
let sealed: ClinicalVisit;
let draft: ClinicalVisit;

beforeAll(async () => {
  owner = await seedTenantWithOwner("Synthetic Rx Seal Clinic");
  otherOwner = await seedTenantWithOwner("Synthetic Rx Seal Other Clinic");
  for (const role of ["doctor", "admin", "nurse", "receptionist"] as const) members[role] = await addMemberToTenant(owner.tenantId, role);
  sealed = await seedClinicalVisit(owner, { doctorId: members.doctor.userId, prescriptions: 1 });
  await signVisitAs(members.doctor, sealed.visitId);
  draft = await seedClinicalVisit(owner, { doctorId: members.doctor.userId, prescriptions: 1 });
}, 90_000);

const writes = [
  ["version", { version: 7 }],
  ["status", { status: "amended" }],
  ["signed_at", { signed_at: "2031-01-01T00:00:00Z" }],
  ["amendment_reason", { amendment_reason: "Rewritten after signing" }],
] as const;

async function header(visitId: string) {
  const [rx] = await prescriptionsOfVisit(visitId);
  return rx;
}

describe("a request path cannot write the columns only the commands change (R-8)", () => {
  it.each(writes)("%s: refused by privilege for every role, on a signed and on a draft header; the row is unchanged", async (_column, patch) => {
    const before = { sealed: await header(sealed.visitId), draft: await header(draft.visitId) };
    const actors: [string, SeededTenant][] = [
      ["owner", owner],
      ["doctor", members.doctor],
      ["admin", members.admin],
      ["nurse", members.nurse],
      ["receptionist", members.receptionist],
      ["other clinic's owner", otherOwner],
    ];
    for (const [who, actor] of actors) {
      for (const rxId of [sealed.prescriptionIds[0], draft.prescriptionIds[0]]) {
        const { data, error } = await actor.client.from("prescriptions").update(patch).eq("id", rxId).select("id");
        expect(error?.code, `${who} writing ${Object.keys(patch)[0]}`).toBe("42501");
        expect(data).toBeNull();
      }
    }
    expect(await header(sealed.visitId)).toEqual(before.sealed);
    expect(await header(draft.visitId)).toEqual(before.draft);
  });

  it("letterhead_mode is set at INSERT only (000109): refused by privilege for the roles that hold prescriptions:edit, on a signed and on a draft header", async () => {
    for (const rxId of [sealed.prescriptionIds[0], draft.prescriptionIds[0]]) {
      for (const actor of [owner, members.doctor]) {
        const { data, error } = await actor.client.from("prescriptions").update({ letterhead_mode: "preprinted_letterhead" }).eq("id", rxId).select("id");
        expect(error?.code).toBe("42501");
        expect(data).toBeNull();
      }
    }
    const { data: row } = await admin.from("prescriptions").select("letterhead_mode").eq("id", sealed.prescriptionIds[0]).single();
    expect(row?.letterhead_mode).toBe("blank_paper");
  });

  it("updated_at stays writable for the roles that hold prescriptions:edit (the archive's own touch); the PDF pair has its own spec (rx-pdf-archive.spec.ts)", async () => {
    const stamp = new Date().toISOString();
    const { data, error } = await members.doctor.client.from("prescriptions").update({ updated_at: stamp }).eq("id", sealed.prescriptionIds[0]).select("id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: sealed.prescriptionIds[0] }]);
  });
});

describe("one header per visit on a request path (I-1)", () => {
  it("a doctor's second header (version 2) on a visit that has one is refused PRESCRIPTION_VERSION_FORBIDDEN", async () => {
    const { data, error } = await members.doctor.client
      .from("prescriptions")
      .insert({ tenant_id: owner.tenantId, visit_id: draft.visitId, patient_id: draft.patientId, doctor_id: members.doctor.userId, version: 2 })
      .select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(error?.message).toContain("PRESCRIPTION_VERSION_FORBIDDEN");
    expect(await prescriptionsOfVisit(draft.visitId)).toHaveLength(1);
  });

  it("the first header (version 1) of a visit that has none is admitted", async () => {
    const empty = await seedClinicalVisit(owner, { doctorId: members.doctor.userId, prescriptions: 0 });
    const { data, error } = await members.doctor.client
      .from("prescriptions")
      .insert({ tenant_id: owner.tenantId, visit_id: empty.visitId, patient_id: empty.patientId, doctor_id: members.doctor.userId, version: 1 })
      .select("id, version");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ version: 1 });
  });
});

describe("the service role meets the same seal (R-3, R-8)", () => {
  it("UPDATE and DELETE of a sealed header are refused RX_SEALED; the row is unchanged", async () => {
    const before = await header(sealed.visitId);
    for (const patch of [{ status: "amended" }, { version: 9 }, { signed_at: null }, { amendment_reason: "Rewritten by the system" }]) {
      const { error } = await admin.from("prescriptions").update(patch).eq("id", sealed.prescriptionIds[0]);
      expect(error?.code).toBe("42501");
      expect(error?.message).toContain("RX_SEALED");
    }
    const del = await admin.from("prescriptions").delete().eq("id", sealed.prescriptionIds[0]);
    expect(del.error?.code).toBe("42501");
    expect(del.error?.message).toContain("RX_SEALED");
    expect(await header(sealed.visitId)).toEqual(before);
  });

  it("INSERT of a header into a signed visit is refused PRESCRIPTION_VISIT_SIGNED", async () => {
    const { error } = await admin
      .from("prescriptions")
      .insert({ tenant_id: owner.tenantId, visit_id: sealed.visitId, patient_id: sealed.patientId, doctor_id: members.doctor.userId, version: 2 });
    expect(error?.code).toBe("42501");
    expect(error?.message).toContain("PRESCRIPTION_VISIT_SIGNED");
    expect(await prescriptionsOfVisit(sealed.visitId)).toHaveLength(1);
  });

  it("control: the same UPDATE of a draft header is admitted", async () => {
    const marker = `Draft edit ${randomUUID().slice(0, 8)}`;
    const { error } = await admin.from("prescriptions").update({ amendment_reason: marker }).eq("id", draft.prescriptionIds[0]);
    expect(error).toBeNull();
    expect((await header(draft.visitId)).amendment_reason).toBe(marker);
  });
});
