/**
 * V2-09c 09C-01 (R-2, T-09C-01, T-09C-02): `public.change_prescription`, every Rx change as one atomic command, and the grant narrowing that makes it the
 * only request-path writer of the prescription rows.
 *
 * Called through the caller's own client (and through the service); rows are seeded and read back with the service-role client. Synthetic data only.
 * The High controls each have a test that fails without them: the transaction (a fault after the header and the item are written undoes everything), the
 * item-belongs-to-the-visit check, the sealed refusal, and the revoked direct writes (a JWT insert, update and delete of the rows are 42501).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { SIGNED_CONSULTATION_MESSAGE } from "@/features/consultation/record-state";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { createBarrier, gateClient } from "../helpers/write-barrier";
import { getAdminClient } from "../helpers/supabase-admin";
import { auditRows, commandResultRows, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import { reopenVisitAs, seedClinicalVisit, signVisitAs } from "../helpers/clinical-commands";
import { changeRxAs, rxLine } from "../helpers/rx-lines";
import type { Json } from "@/types/database";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];
const admin = getAdminClient();

let tenantA: SeededTenant;
let tenantB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Rx Command Clinic A");
  tenantB = await seedTenantWithOwner("CI Rx Command Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
  // The clinic's print settings (R-12) are frozen on a header at its creation.
  await admin.from("tenants").update({ rx_paper_size: "A5", rx_letterhead_mode: "preprinted_letterhead" }).eq("id", tenantA.tenantId).throwOnError();
}, 120_000);

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

type Args = { p_tenant_id: string; p_visit_id: string; p_changes: Json; p_client_request_id: string };

function args(visitId: string, changes: Record<string, unknown>, over: Partial<Args> = {}): Args {
  return { p_tenant_id: tenantA.tenantId, p_visit_id: visitId, p_changes: changes as Json, p_client_request_id: randomUUID(), ...over };
}

const call = (client: SeededTenant["client"], a: Args) => client.rpc("change_prescription", a);

/** An in-consultation visit of clinic A with no prescription yet; its doctor is the member doctor. */
const openVisit = () => seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, status: "in_consultation", notes: null, prescriptions: 0 });

async function headersOf(visitId: string) {
  const { data, error } = await admin.from("prescriptions").select("id, version, status, letterhead_mode, paper_size, doctor_id").eq("visit_id", visitId).order("version");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function itemsOf(visitId: string) {
  const headers = await headersOf(visitId);
  if (headers.length === 0) return [];
  const { data, error } = await admin
    .from("prescription_items")
    .select("id, medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, cdci_brand_id, sort_order")
    .in("prescription_id", headers.map((h) => h.id))
    .order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function customMedicine(doctorId: string, name: string) {
  const { data, error } = await admin.from("doctor_custom_medicines").select("default_dosage, default_timing, default_duration, use_count").eq("doctor_id", doctorId).eq("medicine_name", name).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

describe("change_prescription: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.change_prescription(uuid, uuid, jsonb, uuid)", definer: true });
  });
});

describe("change_prescription: one transaction", () => {
  it("happy path: the header with the clinic's print settings, the item as sent, the doctor's custom medicine, one counts-only audit row and a data-only stored result commit together", async () => {
    const v = await openVisit();
    const a = args(v.visitId, { add: [rxLine({ medicine_name: "Synthetic Custom Syrup", generic_name: "Synthol", dose_form: "Syrup", dosage: "1-0-0", timing: null, duration: "5 days", special_instructions: "Shake well" })] });
    const { data, error } = await call(members.doctor.client, a);
    expect(error).toBeNull();
    const result = data as { prescription_id: string; added_item_ids: string[]; replayed: boolean };
    expect(result.replayed).toBe(false);
    expect(result.added_item_ids).toHaveLength(1);

    const headers = await headersOf(v.visitId);
    expect(headers).toEqual([
      { id: result.prescription_id, version: 1, status: "active", letterhead_mode: "preprinted_letterhead", paper_size: "A5", doctor_id: members.doctor.userId },
    ]);
    expect(await itemsOf(v.visitId)).toEqual([
      {
        id: result.added_item_ids[0],
        medicine_name: "Synthetic Custom Syrup",
        generic_name: "Synthol",
        dose_form: "Syrup",
        dosage: "1-0-0",
        timing: null,
        duration: "5 days",
        special_instructions: "Shake well",
        cdci_brand_id: null,
        sort_order: 0,
      },
    ]);
    expect(await customMedicine(members.doctor.userId, "Synthetic Custom Syrup")).toEqual({ default_dosage: "1-0-0", default_timing: null, default_duration: "5 days", use_count: 1 });

    const rows = await auditRows(tenantA.tenantId, "prescription.lines_change", result.prescription_id);
    expect(rows).toEqual([
      expect.objectContaining({
        actor_id: members.doctor.userId,
        actor_role: "doctor",
        actor_type: "user",
        entity_type: "prescription",
        metadata: { added: 1, updated: 0, removed: 0 },
      }),
    ]);
    // No clinical text in the audit row or in the stored command result (F-5).
    expect(JSON.stringify(rows[0].metadata)).not.toContain("Syrup");
    expect(commandResultRows(tenantA.tenantId, a.p_client_request_id)).toEqual(["public.change_prescription|true"]);
    expectDataOnlyStoredResult(tenantA.tenantId, a.p_client_request_id);
  });

  it("rollback: a fault after the header and the item are written (the custom medicine upsert) leaves no header, item, custom medicine, audit row or claim; the same id then succeeds", async () => {
    const v = await openVisit();
    const marker = `fault-syrup-${randomUUID().slice(0, 8)}`;
    const a = args(v.visitId, { add: [rxLine({ medicine_name: marker })] });
    await withFault({ table: "public.doctor_custom_medicines", column: "medicine_name", marker, event: "insert" }, async () => {
      const { data, error } = await call(members.doctor.client, a);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
    });
    expect(await headersOf(v.visitId)).toEqual([]);
    expect(await itemsOf(v.visitId)).toEqual([]);
    expect(await customMedicine(members.doctor.userId, marker)).toBeNull();
    expect(commandResultRows(tenantA.tenantId, a.p_client_request_id)).toEqual([]);

    const retry = await call(members.doctor.client, a);
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ replayed: false });
    expect(await itemsOf(v.visitId)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "prescription.lines_change", (retry.data as { prescription_id: string }).prescription_id)).toHaveLength(1);
  });

  it("rollback: a fault on the second line of a change undoes the first line and the removes of the same change", async () => {
    const v = await openVisit();
    const first = await changeRxAs(ctxFor(members.doctor), v.visitId, { add: [rxLine({ medicine_name: "Synthetic Keep Line" })] });
    expect(first.success).toBe(true);
    const keepId = first.success ? first.addedItemIds[0] : "";
    const marker = `fault-second-${randomUUID().slice(0, 8)}`;
    await withFault({ table: "public.prescription_items", column: "medicine_name", marker, event: "insert" }, async () => {
      const { error } = await call(
        members.doctor.client,
        args(v.visitId, { remove: [keepId], add: [rxLine({ medicine_name: "Synthetic Good Line" }), rxLine({ medicine_name: marker })] })
      );
      expect(error?.code).toBe("XX000");
    });
    expect((await itemsOf(v.visitId)).map((i) => i.medicine_name)).toEqual(["Synthetic Keep Line"]);
  });
});

describe("change_prescription: the lines", () => {
  it("adds take contiguous sort orders in array order, and the next add continues after the highest", async () => {
    const v = await openVisit();
    await changeRxAs(ctxFor(members.doctor), v.visitId, { add: [rxLine({ medicine_name: "Line A" }), rxLine({ medicine_name: "Line B" }), rxLine({ medicine_name: "Line C" })] });
    expect((await itemsOf(v.visitId)).map((i) => `${i.medicine_name}:${i.sort_order}`)).toEqual(["Line A:0", "Line B:1", "Line C:2"]);
    const b = (await itemsOf(v.visitId)).find((i) => i.medicine_name === "Line B")!;
    await changeRxAs(ctxFor(members.doctor), v.visitId, { remove: [b.id] });
    await changeRxAs(ctxFor(members.doctor), v.visitId, { add: [rxLine({ medicine_name: "Line D" })] });
    expect((await itemsOf(v.visitId)).map((i) => `${i.medicine_name}:${i.sort_order}`)).toEqual(["Line A:0", "Line C:2", "Line D:3"]);
  });

  it("two parallel adds on a fresh visit create one header and contiguous sort orders", async () => {
    const v = await openVisit();
    const barrier = createBarrier(2);
    const [x, y] = await Promise.all([
      call(gateClient(members.doctor.client, { rpc: { change_prescription: barrier } }), args(v.visitId, { add: [rxLine({ medicine_name: "Parallel X" })] })),
      call(gateClient(members.owner.client, { rpc: { change_prescription: barrier } }), args(v.visitId, { add: [rxLine({ medicine_name: "Parallel Y" })] })),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect(await headersOf(v.visitId)).toHaveLength(1);
    expect((await itemsOf(v.visitId)).map((i) => i.sort_order)).toEqual([0, 1]);
  });

  it("an update changes the dose fields named and keeps the id and the medicine; an empty timing or instruction clears it", async () => {
    const v = await openVisit();
    const res = await changeRxAs(ctxFor(members.doctor), v.visitId, { add: [rxLine({ medicine_name: "Synthetic Update Tab", special_instructions: "With water" })] });
    const id = res.success ? res.addedItemIds[0] : "";
    const up = await call(members.doctor.client, args(v.visitId, { update: [{ id, duration: "10 days", timing: null, special_instructions: "" }] }));
    expect(up.error).toBeNull();
    expect(up.data).toMatchObject({ added_item_ids: [], replayed: false });
    expect(await itemsOf(v.visitId)).toEqual([
      expect.objectContaining({ id, medicine_name: "Synthetic Update Tab", dosage: "1-0-1", timing: null, duration: "10 days", special_instructions: null }),
    ]);
    const rows = await auditRows(tenantA.tenantId, "prescription.lines_change", (up.data as { prescription_id: string }).prescription_id);
    expect(rows.map((r) => r.metadata)).toEqual([{ added: 1, updated: 0, removed: 0 }, { added: 0, updated: 1, removed: 0 }]);
  });

  it("a custom line raises use_count by one and keeps its dose as the doctor's stored values; a catalogue line does not join the list", async () => {
    const v = await openVisit();
    const name = `Synthetic Custom ${randomUUID().slice(0, 6)}`;
    await changeRxAs(ctxFor(members.doctor), v.visitId, { add: [rxLine({ medicine_name: name, dosage: "1-1-1", timing: "With food", duration: "7 days" })] });
    expect(await customMedicine(members.doctor.userId, name)).toEqual({ default_dosage: "1-1-1", default_timing: "With food", default_duration: "7 days", use_count: 1 });
    await changeRxAs(ctxFor(members.doctor), v.visitId, { add: [rxLine({ medicine_name: name, dosage: "0-0-1", timing: null, duration: "3 days" })] });
    expect(await customMedicine(members.doctor.userId, name)).toEqual({ default_dosage: "0-0-1", default_timing: null, default_duration: "3 days", use_count: 2 });

    await admin.from("cdci_medicines_search").upsert({ id: "test-cdci-09c-rpc-1", brand_name: "Qzxrpc Catalogue Tab", generic_name: "Qzxrpcol", dose_form: "Tablet", product_name: "Qzxrpc", supplier_name: "Synthetic Labs" }, { onConflict: "id" }).throwOnError();
    const cat = await changeRxAs(ctxFor(members.doctor), v.visitId, { add: [rxLine({ medicine_name: "Qzxrpc Catalogue Tab", cdci_brand_id: "test-cdci-09c-rpc-1" })] });
    expect(cat.success).toBe(true);
    expect(await customMedicine(members.doctor.userId, "Qzxrpc Catalogue Tab")).toBeNull();
    expect((await itemsOf(v.visitId)).find((i) => i.medicine_name === "Qzxrpc Catalogue Tab")?.cdci_brand_id).toBe("test-cdci-09c-rpc-1");
  });
});

describe("change_prescription: an item belongs to the visit's own prescription (T-09C-01)", () => {
  it("an update or remove id from another visit, and from another clinic, is ITEM_NOT_FOUND (P0002 -> NOT_FOUND) and nothing is written", async () => {
    const mine = await openVisit();
    const other = await openVisit();
    const foreign = await seedClinicalVisit(tenantB, { status: "in_consultation", notes: null, prescriptions: 0 });
    const [a, b, c] = await Promise.all([
      changeRxAs(ctxFor(members.doctor), mine.visitId, { add: [rxLine({ medicine_name: "Mine" })] }),
      changeRxAs(ctxFor(members.doctor), other.visitId, { add: [rxLine({ medicine_name: "Other visit" })] }),
      changeRxAs(ctxFor(tenantB), foreign.visitId, { add: [rxLine({ medicine_name: "Other clinic" })] }),
    ]);
    expect([a, b, c].every((r) => r.success)).toBe(true);
    const otherId = b.success ? b.addedItemIds[0] : "";
    const foreignId = c.success ? c.addedItemIds[0] : "";
    for (const [name, id] of [["another visit", otherId], ["another clinic", foreignId]] as const) {
      for (const changes of [{ update: [{ id, duration: "1 day" }] }, { remove: [id] }, { add: [rxLine({ medicine_name: "Must not persist" })], remove: [id] }]) {
        const res = await call(members.doctor.client, args(mine.visitId, changes));
        expect(res.error, name).toMatchObject({ code: "P0002", message: "ITEM_NOT_FOUND" });
        expect(mapDbError(res.error), name).toMatchObject({ code: "NOT_FOUND" });
      }
    }
    expect((await itemsOf(mine.visitId)).map((i) => i.medicine_name)).toEqual(["Mine"]);
    expect((await itemsOf(other.visitId)).map((i) => [i.medicine_name, i.duration])).toEqual([["Other visit", "5 days"]]);
    expect((await itemsOf(foreign.visitId)).map((i) => i.medicine_name)).toEqual(["Other clinic"]);
  });

  it("the update or remove of a visit with no prescription at all is ITEM_NOT_FOUND and creates no header", async () => {
    const v = await openVisit();
    const res = await call(members.doctor.client, args(v.visitId, { remove: [randomUUID()] }));
    expect(res.error).toMatchObject({ code: "P0002", message: "ITEM_NOT_FOUND" });
    expect(await headersOf(v.visitId)).toEqual([]);
  });

  it("the service answers the fixed text for a vanished item", async () => {
    const v = await openVisit();
    await changeRxAs(ctxFor(members.doctor), v.visitId, { add: [rxLine()] });
    const res = await changeRxAs(ctxFor(members.doctor), v.visitId, { remove: [randomUUID()] });
    expect(res).toEqual({ success: false, error: "This medicine is no longer on the prescription.", code: "NOT_FOUND", reason: "ITEM_NOT_FOUND" });
  });
});

describe("change_prescription: idempotency", () => {
  it("the same id with the same input replays the first result, writes nothing and adds no audit row", async () => {
    const v = await openVisit();
    const a = args(v.visitId, { add: [rxLine({ medicine_name: "Once" })] });
    const first = await call(members.doctor.client, a);
    const second = await call(members.doctor.client, a);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    expect(await itemsOf(v.visitId)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "prescription.lines_change", (first.data as { prescription_id: string }).prescription_id)).toHaveLength(1);
  });

  it("IDEMPOTENCY_MISMATCH with each hashed input varied: the visit and the changes", async () => {
    const v = await openVisit();
    const other = await openVisit();
    const a = args(v.visitId, { add: [rxLine({ medicine_name: "Original" })] });
    expect((await call(members.doctor.client, a)).error).toBeNull();
    const variants: Array<[string, Args]> = [
      ["visit", { ...a, p_visit_id: other.visitId }],
      ["changes", { ...a, p_changes: { add: [rxLine({ medicine_name: "Different" })] } as Json }],
    ];
    for (const [name, variant] of variants) {
      expect(mapDbError((await call(members.doctor.client, variant)).error), name).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    }
    expect((await itemsOf(v.visitId)).map((i) => i.medicine_name)).toEqual(["Original"]);
    expect(await itemsOf(other.visitId)).toEqual([]);
  });

  it("two concurrent submits of one id: the loser replays the winner's result", async () => {
    const v = await openVisit();
    const a = args(v.visitId, { add: [rxLine({ medicine_name: "Racing" })] });
    const barrier = createBarrier(2);
    const [x, y] = await Promise.all([
      call(gateClient(members.doctor.client, { rpc: { change_prescription: barrier } }), a),
      call(gateClient(members.doctor.client, { rpc: { change_prescription: barrier } }), a),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as { replayed: boolean }).replayed, (y.data as { replayed: boolean }).replayed].sort()).toEqual([false, true]);
    expect(await itemsOf(v.visitId)).toHaveLength(1);
  });
});

describe("change_prescription: who may call it, and on what", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants prescriptions:edit", async (role) => {
    const v = await openVisit();
    const { error } = await call(members[role].client, args(v.visitId, { add: [rxLine({ medicine_name: `By ${role}` })] }));
    if (hasPerm(role, "prescriptions:edit")) {
      expect(error).toBeNull();
      expect((await itemsOf(v.visitId)).map((i) => i.medicine_name)).toEqual([`By ${role}`]);
    } else {
      expect(error?.code).toBe("42501");
      expect(await itemsOf(v.visitId)).toEqual([]);
      expect(await headersOf(v.visitId)).toEqual([]);
      expect(await auditRows(tenantA.tenantId, "prescription.lines_change", v.visitId)).toEqual([]);
    }
  });

  it("another clinic's visit, or another clinic named by a member of this one, is VISIT_NOT_FOUND and nothing changes", async () => {
    const v = await openVisit();
    const foreign = await call(tenantB.client, args(v.visitId, { add: [rxLine()] }, { p_tenant_id: tenantB.tenantId }));
    expect(foreign.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    const forged = await call(tenantB.client, args(v.visitId, { add: [rxLine()] }));
    expect(forged.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    expect(await headersOf(v.visitId)).toEqual([]);
  });

  it("a sealed, an unsigned completed and a cancelled visit are DRAFT_LOCKED with every row unchanged; an amending visit takes the change", async () => {
    const sealed = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, notes: "Signed note", prescriptions: 0 });
    await changeRxAs(ctxFor(members.doctor), sealed.visitId, { add: [rxLine({ medicine_name: "Signed line" })] });
    await signVisitAs(members.doctor, sealed.visitId);
    const completed = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, status: "waiting", notes: "Desk note", prescriptions: 0 });
    await admin.from("visits").update({ status: "completed" }).eq("id", completed.visitId).throwOnError();
    const cancelled = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, status: "cancelled", notes: "Cancelled note", prescriptions: 0 });
    const signedItem = (await itemsOf(sealed.visitId))[0];

    for (const [name, visit] of [["sealed", sealed], ["completed", completed], ["cancelled", cancelled]] as const) {
      const before = JSON.stringify([await headersOf(visit.visitId), await itemsOf(visit.visitId)]);
      for (const changes of [{ add: [rxLine({ medicine_name: "Rewrite" })] }, { remove: [signedItem.id] }, { update: [{ id: signedItem.id, duration: "1 day" }] }]) {
        const a = args(visit.visitId, changes);
        const res = await call(members.doctor.client, a);
        expect(res.error, name).toMatchObject({ code: "P0001", message: "DRAFT_LOCKED" });
        expect(mapDbError(res.error), name).toMatchObject({ code: "CONFLICT", reason: "DRAFT_LOCKED" });
        expect(commandResultRows(tenantA.tenantId, a.p_client_request_id), name).toEqual([]);
      }
      expect(JSON.stringify([await headersOf(visit.visitId), await itemsOf(visit.visitId)]), name).toBe(before);
    }
    // The service answers the fixed signed text.
    expect(await changeRxAs(ctxFor(members.doctor), sealed.visitId, { add: [rxLine()] })).toEqual({
      success: false,
      error: SIGNED_CONSULTATION_MESSAGE,
      code: "CONFLICT",
      reason: "DRAFT_LOCKED",
    });

    await reopenVisitAs(members.doctor, sealed.visitId);
    const open = await changeRxAs(ctxFor(members.doctor), sealed.visitId, { add: [rxLine({ medicine_name: "Amended line" })], remove: [signedItem.id] });
    expect(open.success).toBe(true);
    expect((await itemsOf(sealed.visitId)).map((i) => i.medicine_name)).toEqual(["Amended line"]);
  }, 120_000);
});

describe("change_prescription: input", () => {
  const big = (n: number) => Array.from({ length: n }, (_, i) => rxLine({ medicine_name: `Bulk ${i}` }));
  it.each<[string, Record<string, unknown>]>([
    ["no operation", {}],
    ["empty lists only", { add: [], update: [], remove: [] }],
    ["an unknown key", { swap: [] }],
    ["a line key outside the closed set", { add: [{ ...rxLine(), sort_order: 4 }] }],
    ["an empty dosage", { add: [rxLine({ dosage: "" })] }],
    ["a blank medicine name", { add: [rxLine({ medicine_name: "   " })] }],
    ["no duration", { add: [{ medicine_name: "x", dosage: "1-0-1" }] }],
    ["a number for a text field", { add: [{ ...rxLine(), timing: 5 }] }],
    ["a catalogue id that does not exist", { add: [rxLine({ cdci_brand_id: "no-such-brand" })] }],
    ["a 501-character instruction", { add: [rxLine({ special_instructions: "y".repeat(501) })] }],
    ["31 adds", { add: big(31) }],
    ["an update with no field", { update: [{ id: randomUUID() }] }],
    ["an update that changes the medicine", { update: [{ id: randomUUID(), medicine_name: "Other" }] }],
    ["a remove that is not a uuid", { remove: ["not-a-uuid"] }],
    ["the same item removed twice", (() => { const id = randomUUID(); return { remove: [id, id] }; })()],
    ["an item both updated and removed", (() => { const id = randomUUID(); return { update: [{ id, duration: "1 day" }], remove: [id] }; })()],
    ["a change set over 64 kB", { add: Array.from({ length: 30 }, () => rxLine({ special_instructions: "z".repeat(500), generic_name: "g".repeat(250) })), update: [], remove: [], pad: "p".repeat(40_000) }],
  ])("%s is INPUT_INVALID (VALIDATION_FAILED) and writes nothing", async (_name, changes) => {
    const v = await openVisit();
    const res = await call(members.doctor.client, args(v.visitId, changes));
    expect(res.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    expect(mapDbError(res.error)).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await headersOf(v.visitId)).toEqual([]);
  });

  it("the service refuses what the schema refuses, with field errors and no database call", async () => {
    const v = await openVisit();
    const res = await changeRxAs(ctxFor(members.doctor), v.visitId, { add: [rxLine({ dosage: "" })] });
    expect(res).toMatchObject({ success: false, code: "VALIDATION_FAILED", fieldErrors: expect.any(Object) });
    expect(await headersOf(v.visitId)).toEqual([]);
  });
});

describe("the contract: change_prescription is the only request-path writer (T-09C-02)", () => {
  it("a direct JWT insert, update and delete of prescription_items, an insert of a header and a write of a custom medicine are refused by privilege (42501); the rows are unchanged", async () => {
    const v = await openVisit();
    const res = await changeRxAs(ctxFor(members.doctor), v.visitId, { add: [rxLine({ medicine_name: "Direct write target" })] });
    expect(res.success).toBe(true);
    const [header] = await headersOf(v.visitId);
    const [item] = await itemsOf(v.visitId);
    const client = members.doctor.client;

    const insertItem = await client.from("prescription_items").insert({ tenant_id: tenantA.tenantId, prescription_id: header.id, medicine_name: "Direct", dosage: "1", duration: "1 day" });
    expect(insertItem.error?.code).toBe("42501");
    const updateItem = await client.from("prescription_items").update({ dosage: "9-9-9" }).eq("id", item.id).select("id");
    expect(updateItem.error?.code).toBe("42501");
    const deleteItem = await client.from("prescription_items").delete().eq("id", item.id).select("id");
    expect(deleteItem.error?.code).toBe("42501");

    const empty = await openVisit();
    const insertHeader = await client.from("prescriptions").insert({ tenant_id: tenantA.tenantId, visit_id: empty.visitId, patient_id: empty.patientId, doctor_id: members.doctor.userId, version: 1 });
    expect(insertHeader.error?.code).toBe("42501");
    const insertCustom = await client.from("doctor_custom_medicines").insert({ tenant_id: tenantA.tenantId, doctor_id: members.doctor.userId, medicine_name: "Direct custom" });
    expect(insertCustom.error?.code).toBe("42501");
    const updateCustom = await client.from("doctor_custom_medicines").update({ default_dosage: "9" }).eq("doctor_id", members.doctor.userId).select("id");
    expect(updateCustom.error?.code).toBe("42501");

    expect(await itemsOf(v.visitId)).toEqual([expect.objectContaining({ id: item.id, medicine_name: "Direct write target", dosage: "1-0-1" })]);
    expect(await headersOf(empty.visitId)).toEqual([]);
    // The service role (the v1 API's client) keeps its own path on an unsigned visit; the member's own SELECT still works.
    const read = await client.from("prescription_items").select("id").eq("id", item.id);
    expect(read.data).toEqual([{ id: item.id }]);
  });
});
