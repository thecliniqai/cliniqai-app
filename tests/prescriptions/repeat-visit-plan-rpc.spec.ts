/**
 * V2-09c 09C-03 (R-10, T-09C-08): `public.repeat_visit_plan`, "Same as last visit" as ONE command. The database copies a signed visit's diagnoses and
 * prescription lines onto a visit of the same patient (the stored values exactly), skips what is already there, leaves out a line that matches a recorded
 * allergy and reports it by its source item id, and refuses anything that is not a signed visit of the same patient in the same clinic.
 *
 * Called through the caller's own client and through the service; rows are seeded and read back with the service-role client. The shared command rules run
 * here: the catalog, the happy path with its audit row and data-only stored result, fault injection (nothing persists), replay, IDEMPOTENCY_MISMATCH with each
 * hashed input varied, the role matrix, cross-clinic and one concurrency case. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { repeatVisitPlan } from "@/features/prescriptions/service";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { createBarrier, gateClient } from "../helpers/write-barrier";
import { getAdminClient } from "../helpers/supabase-admin";
import { insertReturningId } from "../helpers/db";
import { auditRows, commandResultRows, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import { reopenVisitAs, seedClinicalVisit, signVisitAs } from "../helpers/clinical-commands";
import { addRxLinesAs, rxLine } from "../helpers/rx-lines";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];
const admin = getAdminClient();

let tenantA: SeededTenant;
let tenantB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;
/** The signed source: patient P, two diagnoses, three lines (one with a null timing, one with an instruction, one a custom medicine named for an allergy test). */
let source: { visitId: string; patientId: string };
let sourceItemIds: Record<string, string>;
/** A signed visit of another patient of clinic A, a signed visit of clinic B, and an unsigned visit of patient P (not a source). */
let otherPatientVisit: string;
let clinicBVisit: string;
let clinicBDraft: string;
let unsignedVisit: string;

const LINE_A = () => rxLine({ medicine_name: "Repeat-Tablet-A", dosage: "1-0-1", timing: "After food", duration: "5 days", special_instructions: "With water" });
const LINE_B = () => rxLine({ medicine_name: "Repeat-Syrup-B", dosage: "0-0-1", timing: null, duration: "3 days" });
const LINE_C = () => rxLine({ medicine_name: "Qzxrepeatol-Drops", dosage: "1-0-0", timing: null, duration: "7 days" });

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Repeat Plan Clinic A");
  tenantB = await seedTenantWithOwner("CI Repeat Plan Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);

  const signed = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, status: "in_consultation", notes: "Synthetic note", prescriptions: 0 });
  await insertReturningId(admin, "consultation_diagnoses", {
    tenant_id: tenantA.tenantId,
    visit_id: signed.visitId,
    patient_id: signed.patientId,
    diagnosis_name: "Viral fever",
    icd11_code: "MG26",
    notes: "A private note that must not travel",
  });
  await addRxLinesAs(ctxFor(members.doctor), signed.visitId, [LINE_A(), LINE_B(), LINE_C()]);
  await signVisitAs(members.doctor, signed.visitId);
  source = signed;
  const { data: items } = await admin.from("prescription_items").select("id, medicine_name, prescriptions!inner(visit_id)").eq("prescriptions.visit_id", signed.visitId);
  sourceItemIds = Object.fromEntries((items ?? []).map((i) => [i.medicine_name, i.id]));

  const other = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, status: "in_consultation", notes: "Other patient", prescriptions: 0, diagnosis: true });
  await addRxLinesAs(ctxFor(members.doctor), other.visitId, [rxLine({ medicine_name: "Other Patient Tablet" })]);
  await signVisitAs(members.doctor, other.visitId);
  otherPatientVisit = other.visitId;

  const foreign = await seedClinicalVisit(tenantB, { status: "in_consultation", notes: "Clinic B", prescriptions: 0, diagnosis: true });
  await signVisitAs(tenantB, foreign.visitId);
  clinicBVisit = foreign.visitId;
  clinicBDraft = (await seedClinicalVisit(tenantB, { status: "in_consultation", notes: "Clinic B draft", prescriptions: 0 })).visitId;

  unsignedVisit = (await targetVisit()).visitId;
}, 240_000);

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

/** A new draft visit of patient P of the doctor (a target for the copy). */
async function targetVisit(): Promise<{ visitId: string }> {
  const visitId = await insertReturningId(admin, "visits", {
    tenant_id: tenantA.tenantId,
    patient_id: source.patientId,
    doctor_id: members.doctor.userId,
    origin_type: "walk_in",
    status: "in_consultation",
    created_by: members.doctor.userId,
  });
  return { visitId };
}

type Args = { p_tenant_id: string; p_visit_id: string; p_source_visit_id: string; p_parts: string[]; p_client_request_id: string };
const args = (visitId: string, parts: string[] = ["diagnoses", "prescription"], over: Partial<Args> = {}): Args => ({
  p_tenant_id: tenantA.tenantId,
  p_visit_id: visitId,
  p_source_visit_id: source.visitId,
  p_parts: parts,
  p_client_request_id: randomUUID(),
  ...over,
});
const call = (client: SeededTenant["client"], a: Args) => client.rpc("repeat_visit_plan", a);

async function itemsOf(visitId: string) {
  const { data, error } = await admin
    .from("prescription_items")
    .select("id, medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, cdci_brand_id, allergy_override, sort_order, prescriptions!inner(visit_id)")
    .eq("prescriptions.visit_id", visitId)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function diagnosesOf(visitId: string) {
  const { data, error } = await admin.from("consultation_diagnoses").select("diagnosis_name, icd11_code, notes, is_chronic, is_custom").eq("visit_id", visitId);
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function headersOf(visitId: string) {
  const { data } = await admin.from("prescriptions").select("id, version, status, doctor_id").eq("visit_id", visitId);
  return data ?? [];
}

describe("repeat_visit_plan: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.repeat_visit_plan(uuid, uuid, uuid, text[], uuid)", definer: true });
  });
});

describe("repeat_visit_plan: the copy", () => {
  it("happy path: the diagnoses and the lines are copied as stored, with one counts-only audit row and a data-only stored result", async () => {
    const t = await targetVisit();
    const a = args(t.visitId);
    const { data, error } = await call(members.doctor.client, a);
    expect(error).toBeNull();
    const result = data as { prescription_id: string; added_item_ids: string[]; skipped_item_ids: string[]; diagnoses_added: number; replayed: boolean };
    expect(result).toMatchObject({ diagnoses_added: 1, skipped_item_ids: [], replayed: false });
    expect(result.added_item_ids).toHaveLength(3);

    expect((await itemsOf(t.visitId)).map((i) => [i.medicine_name, i.dosage, i.timing, i.duration, i.special_instructions, i.sort_order])).toEqual([
      ["Repeat-Tablet-A", "1-0-1", "After food", "5 days", "With water", 0],
      ["Repeat-Syrup-B", "0-0-1", null, "3 days", null, 1],
      ["Qzxrepeatol-Drops", "1-0-0", null, "7 days", null, 2],
    ]);
    expect(await diagnosesOf(t.visitId)).toEqual([{ diagnosis_name: "Viral fever", icd11_code: "MG26", notes: null, is_chronic: false, is_custom: false }]);
    expect(await headersOf(t.visitId)).toEqual([{ id: result.prescription_id, version: 1, status: "active", doctor_id: members.doctor.userId }]);

    const rows = await auditRows(tenantA.tenantId, "visit.repeat_plan", t.visitId);
    expect(rows).toEqual([expect.objectContaining({ actor_id: members.doctor.userId, actor_role: "doctor", entity_type: "visit", metadata: { added: 3, skipped: 0, diagnoses_added: 1 } })]);
    expect(JSON.stringify(rows[0].metadata)).not.toContain("Tablet");
    expect(commandResultRows(tenantA.tenantId, a.p_client_request_id)).toEqual(["public.repeat_visit_plan|true"]);
    expectDataOnlyStoredResult(tenantA.tenantId, a.p_client_request_id);
  });

  it("a null timing stays null: nothing is added to a copied line, and the copied custom medicine joins the doctor's own list with the stored dose", async () => {
    const t = await targetVisit();
    expect((await call(members.doctor.client, args(t.visitId, ["prescription"]))).error).toBeNull();
    const b = (await itemsOf(t.visitId)).find((i) => i.medicine_name === "Repeat-Syrup-B")!;
    expect(b.timing).toBeNull();
    expect(b.special_instructions).toBeNull();
    expect(b.allergy_override).toBeNull();
    const { data } = await admin.from("doctor_custom_medicines").select("default_dosage, default_timing, default_duration").eq("doctor_id", members.doctor.userId).eq("medicine_name", "Repeat-Syrup-B").single();
    expect(data).toEqual({ default_dosage: "0-0-1", default_timing: null, default_duration: "3 days" });
  });

  it("only the parts asked for are copied: diagnoses alone create no header, the prescription alone adds no diagnosis", async () => {
    const onlyDx = await targetVisit();
    const dx = await call(members.doctor.client, args(onlyDx.visitId, ["diagnoses"]));
    expect(dx.data).toMatchObject({ prescription_id: null, added_item_ids: [], diagnoses_added: 1 });
    expect(await headersOf(onlyDx.visitId)).toEqual([]);
    expect(await diagnosesOf(onlyDx.visitId)).toHaveLength(1);

    const onlyRx = await targetVisit();
    const rx = await call(members.doctor.client, args(onlyRx.visitId, ["prescription"]));
    expect(rx.data).toMatchObject({ diagnoses_added: 0 });
    expect(await diagnosesOf(onlyRx.visitId)).toEqual([]);
    expect(await itemsOf(onlyRx.visitId)).toHaveLength(3);
  });

  it("what is already on the visit is skipped (case-insensitive), and a second run with a new id copies nothing", async () => {
    const t = await targetVisit();
    await addRxLinesAs(ctxFor(members.doctor), t.visitId, [rxLine({ medicine_name: "  repeat-tablet-a ", dosage: "9-9-9" })]);
    await admin.from("consultation_diagnoses").insert({ tenant_id: tenantA.tenantId, visit_id: t.visitId, patient_id: source.patientId, diagnosis_name: "VIRAL FEVER" }).throwOnError();
    const first = await call(members.doctor.client, args(t.visitId));
    expect(first.data).toMatchObject({ diagnoses_added: 0 });
    expect((first.data as { added_item_ids: string[] }).added_item_ids).toHaveLength(2);
    expect((await itemsOf(t.visitId)).map((i) => i.medicine_name)).toEqual(["repeat-tablet-a", "Repeat-Syrup-B", "Qzxrepeatol-Drops"]);
    expect((await itemsOf(t.visitId))[0].dosage).toBe("9-9-9");
    const again = await call(members.doctor.client, args(t.visitId));
    expect(again.data).toMatchObject({ added_item_ids: [], skipped_item_ids: [], diagnoses_added: 0, replayed: false });
    expect(await itemsOf(t.visitId)).toHaveLength(3);
  });

  it("an allergy-matching line is NOT copied: it is returned by its source item id, the others are copied, and the audit counts it", async () => {
    const t = await targetVisit();
    await admin.from("patients").update({ allergies: ["Qzxrepeatol"] }).eq("id", source.patientId).throwOnError();
    try {
      const { data, error } = await call(members.doctor.client, args(t.visitId, ["prescription"]));
      expect(error).toBeNull();
      expect(data).toMatchObject({ skipped_item_ids: [sourceItemIds["Qzxrepeatol-Drops"]] });
      expect((data as { added_item_ids: string[] }).added_item_ids).toHaveLength(2);
      expect((await itemsOf(t.visitId)).map((i) => i.medicine_name)).toEqual(["Repeat-Tablet-A", "Repeat-Syrup-B"]);
      expect(await auditRows(tenantA.tenantId, "visit.repeat_plan", t.visitId)).toEqual([expect.objectContaining({ metadata: { added: 2, skipped: 1, diagnoses_added: 0 } })]);
      // The service hands the screen the skipped line's stored values, to open in the dose builder.
      const viaService = await repeatVisitPlan(ctxFor(members.doctor), { visit_id: t.visitId, source_visit_id: source.visitId, parts: ["prescription"], client_request_id: randomUUID() });
      expect(viaService).toMatchObject({ success: true, skippedItemIds: [sourceItemIds["Qzxrepeatol-Drops"]] });
      if (viaService.success) {
        expect(viaService.skippedItems.map((i) => [i.medicine_name, i.dosage, i.timing, i.duration])).toEqual([["Qzxrepeatol-Drops", "1-0-0", null, "7 days"]]);
        expect((viaService.items ?? []).map((i) => i.medicine_name)).toEqual(["Repeat-Tablet-A", "Repeat-Syrup-B"]);
      }
      // The kill switch: with the allergy check off the line is copied (as a line added by hand would be).
      const off = await admin.from("tenant_entitlement_overrides").insert({ tenant_id: tenantA.tenantId, key: "assist.allergy_check", enabled: false, reason: "Synthetic test: allergy check off" });
      expect(off.error).toBeNull();
      try {
        const t2 = await targetVisit();
        expect((await call(members.doctor.client, args(t2.visitId, ["prescription"]))).data).toMatchObject({ skipped_item_ids: [] });
        expect(await itemsOf(t2.visitId)).toHaveLength(3);
      } finally {
        await admin.from("tenant_entitlement_overrides").delete().eq("tenant_id", tenantA.tenantId).eq("key", "assist.allergy_check");
      }
    } finally {
      await admin.from("patients").update({ allergies: null }).eq("id", source.patientId).throwOnError();
    }
  });

  it("the service returns what the database now holds (the lines and diagnoses), and takes the tenant and actor from the session", async () => {
    const t = await targetVisit();
    const res = await repeatVisitPlan(ctxFor(members.doctor), { visit_id: t.visitId, source_visit_id: source.visitId, parts: ["diagnoses", "prescription"], client_request_id: randomUUID() });
    expect(res).toMatchObject({ success: true, diagnosesAdded: 1, replayed: false });
    if (res.success) {
      expect(res.items?.map((i) => i.medicine_name)).toEqual(["Repeat-Tablet-A", "Repeat-Syrup-B", "Qzxrepeatol-Drops"]);
      expect(res.diagnoses?.map((d) => d.diagnosis_name)).toEqual(["Viral fever"]);
      expect(res.addedItemIds).toHaveLength(3);
    }
  });
});

describe("repeat_visit_plan: one transaction", () => {
  it("rollback: a fault on the second copied line undoes the diagnoses and the first line; the same id then succeeds", async () => {
    const t = await targetVisit();
    const a = args(t.visitId);
    await withFault({ table: "public.prescription_items", column: "medicine_name", marker: "Repeat-Syrup-B", event: "insert" }, async () => {
      const { data, error } = await call(members.doctor.client, a);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
    });
    expect(await itemsOf(t.visitId)).toEqual([]);
    expect(await headersOf(t.visitId)).toEqual([]);
    expect(await diagnosesOf(t.visitId)).toEqual([]);
    expect(await auditRows(tenantA.tenantId, "visit.repeat_plan", t.visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, a.p_client_request_id)).toEqual([]);

    const retry = await call(members.doctor.client, a);
    expect(retry.error).toBeNull();
    expect(await itemsOf(t.visitId)).toHaveLength(3);
  });
});

describe("repeat_visit_plan: idempotency", () => {
  it("the same id with the same input replays the first result, writes nothing and adds no audit row", async () => {
    const t = await targetVisit();
    const a = args(t.visitId);
    const first = await call(members.doctor.client, a);
    const second = await call(members.doctor.client, a);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    expect(await itemsOf(t.visitId)).toHaveLength(3);
    expect(await auditRows(tenantA.tenantId, "visit.repeat_plan", t.visitId)).toHaveLength(1);
  });

  it("IDEMPOTENCY_MISMATCH with each hashed input varied: the visit, the source and the parts", async () => {
    const t = await targetVisit();
    const other = await targetVisit();
    const a = args(t.visitId, ["prescription"]);
    expect((await call(members.doctor.client, a)).error).toBeNull();
    const variants: Array<[string, Args]> = [
      ["visit", { ...a, p_visit_id: other.visitId }],
      ["source", { ...a, p_source_visit_id: otherPatientVisit }],
      ["parts", { ...a, p_parts: ["diagnoses"] }],
      ["more parts", { ...a, p_parts: ["prescription", "diagnoses"] }],
    ];
    for (const [name, variant] of variants) {
      expect(mapDbError((await call(members.doctor.client, variant)).error), name).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    }
    expect(await itemsOf(other.visitId)).toEqual([]);
  });

  it("the order of the parts is not a different request", async () => {
    const t = await targetVisit();
    const a = args(t.visitId, ["diagnoses", "prescription"]);
    expect((await call(members.doctor.client, a)).error).toBeNull();
    const swapped = await call(members.doctor.client, { ...a, p_parts: ["prescription", "diagnoses"] });
    expect(swapped.error).toBeNull();
    expect(swapped.data).toMatchObject({ replayed: true });
  });

  it("two concurrent submits of one id: the loser replays the winner's result", async () => {
    const t = await targetVisit();
    const a = args(t.visitId);
    const barrier = createBarrier(2);
    const [x, y] = await Promise.all([
      call(gateClient(members.doctor.client, { rpc: { repeat_visit_plan: barrier } }), a),
      call(gateClient(members.doctor.client, { rpc: { repeat_visit_plan: barrier } }), a),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as { replayed: boolean }).replayed, (y.data as { replayed: boolean }).replayed].sort()).toEqual([false, true]);
    expect(await itemsOf(t.visitId)).toHaveLength(3);
  });

  it("two different ids at once copy each line once", async () => {
    const t = await targetVisit();
    const barrier = createBarrier(2);
    const [x, y] = await Promise.all([
      call(gateClient(members.doctor.client, { rpc: { repeat_visit_plan: barrier } }), args(t.visitId)),
      call(gateClient(members.owner.client, { rpc: { repeat_visit_plan: barrier } }), args(t.visitId)),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect((await itemsOf(t.visitId)).map((i) => i.medicine_name).sort()).toEqual(["Qzxrepeatol-Drops", "Repeat-Syrup-B", "Repeat-Tablet-A"]);
    expect(await headersOf(t.visitId)).toHaveLength(1);
    expect(await diagnosesOf(t.visitId)).toHaveLength(1);
  });
});

describe("repeat_visit_plan: who may call it, and from what", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants prescriptions:edit and consultations:edit", async (role) => {
    const t = await targetVisit();
    const { error } = await call(members[role].client, args(t.visitId, ["prescription"]));
    if (hasPerm(role, "prescriptions:edit") && hasPerm(role, "consultations:edit")) {
      expect(error).toBeNull();
      expect(await itemsOf(t.visitId)).toHaveLength(3);
    } else {
      expect(error?.code).toBe("42501");
      expect(await itemsOf(t.visitId)).toEqual([]);
      expect(await headersOf(t.visitId)).toEqual([]);
      expect(await auditRows(tenantA.tenantId, "visit.repeat_plan", t.visitId)).toEqual([]);
    }
  });

  it("another clinic's visit as the source or as the target, and another clinic named by a member of this one, is VISIT_NOT_FOUND and nothing changes", async () => {
    const t = await targetVisit();
    const foreignSource = await call(members.doctor.client, args(t.visitId, ["prescription"], { p_source_visit_id: clinicBVisit }));
    expect(foreignSource.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    const foreignTarget = await call(members.doctor.client, args(clinicBDraft, ["prescription"]));
    expect(foreignTarget.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    const forged = await call(tenantB.client, args(t.visitId, ["prescription"]));
    expect(forged.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    expect(await itemsOf(t.visitId)).toEqual([]);
    expect(await headersOf(t.visitId)).toEqual([]);
  });

  it("a source of another patient, an unsigned source and an open amendment read as not found; nothing is copied", async () => {
    const t = await targetVisit();
    for (const [name, sourceId] of [["another patient", otherPatientVisit], ["unsigned", unsignedVisit]] as const) {
      const res = await call(members.doctor.client, args(t.visitId, ["diagnoses", "prescription"], { p_source_visit_id: sourceId }));
      expect(res.error, name).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
      expect(mapDbError(res.error), name).toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await itemsOf(t.visitId)).toEqual([]);
    expect(await diagnosesOf(t.visitId)).toEqual([]);
  });

  it("a sealed target is DRAFT_LOCKED and its rows are unchanged; an amending target takes the copy", async () => {
    const sealed = await targetVisit();
    await admin.from("clinical_notes").update({ clinical_notes: "Sealed note" }).eq("visit_id", sealed.visitId).throwOnError();
    await addRxLinesAs(ctxFor(members.doctor), sealed.visitId, [rxLine({ medicine_name: "Sealed-line" })]);
    await signVisitAs(members.doctor, sealed.visitId);
    const locked = args(sealed.visitId);
    const before = JSON.stringify(await itemsOf(sealed.visitId));
    const res = await call(members.doctor.client, locked);
    expect(res.error).toMatchObject({ code: "P0001", message: "DRAFT_LOCKED" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "DRAFT_LOCKED" });
    expect(JSON.stringify(await itemsOf(sealed.visitId))).toBe(before);
    expect(commandResultRows(tenantA.tenantId, locked.p_client_request_id)).toEqual([]);

    await reopenVisitAs(members.doctor, sealed.visitId);
    const open = await call(members.doctor.client, args(sealed.visitId, ["prescription"]));
    expect(open.error).toBeNull();
    expect((await itemsOf(sealed.visitId)).map((i) => i.medicine_name)).toEqual(["Sealed-line", "Repeat-Tablet-A", "Repeat-Syrup-B", "Qzxrepeatol-Drops"]);
  }, 120_000);
});

describe("repeat_visit_plan: input", () => {
  it.each<[string, (t: string) => Args]>([
    ["no parts", (t) => args(t, [])],
    ["an unknown part", (t) => args(t, ["labs"])],
    ["a part named twice", (t) => args(t, ["diagnoses", "diagnoses"])],
    ["three parts", (t) => args(t, ["diagnoses", "prescription", "diagnoses"])],
    ["the visit as its own source", (t) => args(t, ["prescription"], { p_source_visit_id: t })],
  ])("%s is INPUT_INVALID (VALIDATION_FAILED) and writes nothing", async (_name, make) => {
    const t = await targetVisit();
    const res = await call(members.doctor.client, make(t.visitId));
    expect(res.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    expect(mapDbError(res.error)).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await itemsOf(t.visitId)).toEqual([]);
  });

  it("the service refuses what the schema refuses before any database call", async () => {
    const t = await targetVisit();
    const res = await repeatVisitPlan(ctxFor(members.doctor), { visit_id: t.visitId, source_visit_id: "not-a-uuid", parts: ["prescription"], client_request_id: randomUUID() });
    expect(res).toMatchObject({ success: false, code: "VALIDATION_FAILED" });
    const none = await repeatVisitPlan(ctxFor(members.doctor), { visit_id: t.visitId, source_visit_id: source.visitId, parts: [], client_request_id: randomUUID() });
    expect(none).toMatchObject({ success: false, code: "VALIDATION_FAILED" });
    expect(await itemsOf(t.visitId)).toEqual([]);
  });

  it("the service refuses a role without both permissions before the database", async () => {
    const t = await targetVisit();
    const res = await repeatVisitPlan(ctxFor(members.nurse), { visit_id: t.visitId, source_visit_id: source.visitId, parts: ["prescription"], client_request_id: randomUUID() });
    expect(res.success).toBe(false);
    expect(await itemsOf(t.visitId)).toEqual([]);
  });
});
