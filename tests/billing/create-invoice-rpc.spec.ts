/**
 * V2-07 07-02 (R-1, R-2, R-3, R-6): `public.create_invoice`, the visit's invoice as one atomic command.
 *
 * SECURITY DEFINER (invoices and invoice_items cannot be written directly by `authenticated`, V2-05 000072), so the
 * function's own guard block binds it: a session, the active clinic, billing:collect OR the visit's own doctor
 * (consultations:edit). Called through the caller's own supabase-js client; rows are seeded and read back with the
 * service-role client. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { BILLING_COLLECT_FORBIDDEN_MESSAGE, createVisitInvoice } from "@/features/billing/service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { psql } from "../helpers/sql";
import { withFault, leftoverFaults } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { createBarrier, gateClient } from "../helpers/write-barrier";
import {
  auditRows,
  callCreateInvoice,
  commandResultRows,
  createInvoiceArgs,
  invoicesOfVisit,
  itemsOfInvoice,
  seedVisit,
} from "../helpers/billing-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Billing Clinic A");
  tenantB = await seedTenantWithOwner("CI Billing Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
});

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

describe("create_invoice: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.create_invoice(uuid, uuid, jsonb, uuid, numeric, numeric)", definer: true });
  });

  it("the shared steps are definers (or the plain normaliser) that no API role can execute", () => {
    for (const fn of [
      "private.step_create_invoice(uuid, uuid, jsonb, numeric, numeric)",
      "private.step_record_payment(uuid, uuid, numeric, text, text, text, uuid, text)",
      "private.invoice_items_normalize(jsonb)",
    ]) {
      expect(
        psql(`select r || '|' || has_function_privilege(r, '${fn}', 'EXECUTE') from unnest(array['anon','authenticated','service_role']) r order by r`),
        fn
      ).toEqual(["anon|false", "authenticated|false", "service_role|false"]);
    }
    expect(psql(`select prosecdef from pg_proc where oid = 'private.step_create_invoice(uuid, uuid, jsonb, numeric, numeric)'::regprocedure`)).toEqual(["t"]);
  });
});

describe("create_invoice: one transaction", () => {
  it("happy path: invoice, items, audit and the claim commit together; the number comes from the sequence", async () => {
    const { visitId, patientId } = await seedVisit(tenantA);
    const args = createInvoiceArgs(tenantA, visitId);
    const { data, error } = await callCreateInvoice(tenantA.client, args);
    expect(error).toBeNull();
    const result = data as { invoice_id: string; invoice_number: string; status: string; total_amount: number; existing: boolean; replayed: boolean };
    expect(result).toMatchObject({ status: "issued", total_amount: 650, existing: false, replayed: false });
    expect(result.invoice_number).toMatch(/^INV-\d{4}-\d{5}$/);

    const invoices = await invoicesOfVisit(visitId);
    expect(invoices).toEqual([
      expect.objectContaining({
        id: result.invoice_id,
        invoice_number: result.invoice_number,
        status: "issued",
        subtotal: 700,
        discount: 50,
        tax: 0,
        total_amount: 650,
        patient_id: patientId,
        tenant_id: tenantA.tenantId,
      }),
    ]);
    // The branch hook (R-5): the default location is filled by the trigger.
    expect(invoices[0].location_id).toEqual(expect.any(String));
    expect(await itemsOfInvoice(result.invoice_id)).toEqual([
      { item_type: "consultation", description: "OPD Consultation Fee", unit_price: 500, quantity: 1, total_price: 500 },
      { item_type: "procedure", description: "Wound Dressing", unit_price: 200, quantity: 1, total_price: 200 },
    ]);
    expect(await auditRows(tenantA.tenantId, "invoice.create", result.invoice_id)).toEqual([
      {
        actor_id: tenantA.userId,
        actor_role: "owner",
        actor_type: "user",
        entity_type: "invoice",
        entity_id: result.invoice_id,
        metadata: { invoice_number: result.invoice_number, total_amount: 650 },
      },
    ]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.create_invoice|true"]);
  });

  it("a visit with a live invoice gets it back (existing: true) and nothing is written", async () => {
    const { visitId } = await seedVisit(tenantA);
    const first = await callCreateInvoice(tenantA.client, createInvoiceArgs(tenantA, visitId));
    const firstId = (first.data as { invoice_id: string }).invoice_id;
    const auditBefore = (await auditRows(tenantA.tenantId, "invoice.create", firstId)).length;

    // Another submit (a new id), even with other items and by another collector.
    const second = await callCreateInvoice(
      members.receptionist.client,
      createInvoiceArgs(tenantA, visitId, { p_items: [{ item_type: "other", description: "Different", unit_price: 1, quantity: 1 }], p_discount: 0 })
    );
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ invoice_id: firstId, existing: true, total_amount: 650 });
    expect(await invoicesOfVisit(visitId)).toHaveLength(1);
    expect(await itemsOfInvoice(firstId)).toHaveLength(2);
    expect(await auditRows(tenantA.tenantId, "invoice.create", firstId)).toHaveLength(auditBefore);
  });

  it("a cancelled invoice is not live: the visit is invoiced again", async () => {
    const { visitId } = await seedVisit(tenantA);
    const first = await callCreateInvoice(tenantA.client, createInvoiceArgs(tenantA, visitId));
    const firstId = (first.data as { invoice_id: string }).invoice_id;
    const admin = getAdminClient();
    await admin.from("invoices").update({ status: "cancelled" }).eq("id", firstId);
    const again = await callCreateInvoice(tenantA.client, createInvoiceArgs(tenantA, visitId));
    expect(again.error).toBeNull();
    expect(again.data).toMatchObject({ existing: false });
    expect((again.data as { invoice_id: string }).invoice_id).not.toBe(firstId);
    expect(await invoicesOfVisit(visitId)).toHaveLength(2);
  });

  it("rollback: a fault after the items insert leaves no invoice, no items, no audit row and no claim; the same id then succeeds", async () => {
    const { visitId } = await seedVisit(tenantA);
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const items = [
      { item_type: "consultation", description: "OPD Consultation Fee", unit_price: 500, quantity: 1 },
      { item_type: "procedure", description: marker, unit_price: 200, quantity: 1 },
    ];
    const args = createInvoiceArgs(tenantA, visitId, { p_items: items });
    const auditBefore = (await auditRows(tenantA.tenantId, "invoice.create")).length;

    await withFault({ table: "public.invoice_items", column: "description", marker }, async () => {
      const { data, error } = await callCreateInvoice(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
      expect(mapDbError(error)).toMatchObject({ code: "INTERNAL" });

      // Through the service the caller gets the fixed text, never the driver's.
      const viaService = await createVisitInvoice(ctxFor(tenantA), {
        visit_id: visitId,
        patient_id: (await seedVisitPatient(visitId)),
        items: [{ item_type: "procedure", description: marker, unit_price: 200, quantity: 1 }],
        discount: 0,
        tax: 0,
        client_request_id: randomUUID(),
      });
      expect(viaService).toEqual({ success: false, error: "Failed to create invoice." });
    });

    expect(await invoicesOfVisit(visitId)).toEqual([]);
    expect(await auditRows(tenantA.tenantId, "invoice.create")).toHaveLength(auditBefore);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);

    const retry = await callCreateInvoice(tenantA.client, args);
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ replayed: false, existing: false });
    expect(await invoicesOfVisit(visitId)).toHaveLength(1);
  });

  it("R-6: a failing number draw fails the command; no guessed number is used", async () => {
    // The sequence counts the year's numbers, so deleting an older invoice makes the next draw collide with a live one
    // (a clinic of its own: the collision outlives the test).
    const solo = await seedTenantWithOwner("CI Billing Numbering Clinic");
    const [v1, v2, v3] = await Promise.all([seedVisit(solo), seedVisit(solo), seedVisit(solo)]);
    const first = await callCreateInvoice(solo.client, createInvoiceArgs(solo, v1.visitId));
    const second = await callCreateInvoice(solo.client, createInvoiceArgs(solo, v2.visitId));
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const del = await getAdminClient().from("invoices").delete().eq("id", (first.data as { invoice_id: string }).invoice_id);
    expect(del.error).toBeNull();

    const args = createInvoiceArgs(solo, v3.visitId);
    const { data, error } = await callCreateInvoice(solo.client, args);
    expect(data).toBeNull();
    expect(error?.code).toBe("23505");
    expect(mapDbError(error).code).toBe("CONFLICT");
    expect(await invoicesOfVisit(v3.visitId)).toEqual([]);
    expect(commandResultRows(solo.tenantId, args.p_client_request_id)).toEqual([]);
  });
});

async function seedVisitPatient(visitId: string): Promise<string> {
  const { data } = await getAdminClient().from("visits").select("patient_id").eq("id", visitId).single();
  return (data as { patient_id: string }).patient_id;
}

describe("create_invoice: idempotency", () => {
  it("the same id twice: one invoice, one audit row, the first result with replayed: true", async () => {
    const { visitId } = await seedVisit(tenantA);
    const args = createInvoiceArgs(tenantA, visitId);
    const first = await callCreateInvoice(tenantA.client, args);
    const second = await callCreateInvoice(tenantA.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    const invoices = await invoicesOfVisit(visitId);
    expect(invoices).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "invoice.create", invoices[0].id)).toHaveLength(1);
  });

  it("the same id with another payload is IDEMPOTENCY_MISMATCH and writes nothing", async () => {
    const { visitId } = await seedVisit(tenantA);
    const args = createInvoiceArgs(tenantA, visitId);
    expect((await callCreateInvoice(tenantA.client, args)).error).toBeNull();
    const changed = await callCreateInvoice(tenantA.client, { ...args, p_discount: 0 });
    expect(changed.data).toBeNull();
    expect(mapDbError(changed.error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect((await invoicesOfVisit(visitId))[0].discount).toBe(50);
  });

  it("the same id by another user is IDEMPOTENCY_MISMATCH (a result is never handed to another actor)", async () => {
    const { visitId } = await seedVisit(tenantA);
    const args = createInvoiceArgs(tenantA, visitId);
    expect((await callCreateInvoice(tenantA.client, args)).error).toBeNull();
    const other = await callCreateInvoice(members.receptionist.client, args);
    expect(mapDbError(other.error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });

  it("two concurrent submits of one visit with different ids: one invoice, one audit row, one created and one existing", async () => {
    const { visitId } = await seedVisit(tenantA);
    const barrier = createBarrier(2);
    const a = gateClient(tenantA.client, { rpc: { create_invoice: barrier } });
    const b = gateClient(members.receptionist.client, { rpc: { create_invoice: barrier } });
    const [ra, rb] = await Promise.all([
      callCreateInvoice(a, createInvoiceArgs(tenantA, visitId)),
      callCreateInvoice(b, createInvoiceArgs(tenantA, visitId)),
    ]);
    expect(ra.error).toBeNull();
    expect(rb.error).toBeNull();
    const results = [ra.data, rb.data] as { invoice_id: string; existing: boolean }[];
    expect(results.map((r) => r.existing).sort()).toEqual([false, true]);
    expect(results[0].invoice_id).toBe(results[1].invoice_id);
    const invoices = await invoicesOfVisit(visitId);
    expect(invoices).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "invoice.create", invoices[0].id)).toHaveLength(1);
  });

  it("concurrent invoices for different visits draw distinct numbers", async () => {
    const visits = await Promise.all([seedVisit(tenantA), seedVisit(tenantA), seedVisit(tenantA)]);
    const barrier = createBarrier(3);
    const client = gateClient(tenantA.client, { rpc: { create_invoice: barrier } });
    const results = await Promise.all(visits.map((v) => callCreateInvoice(client, createInvoiceArgs(tenantA, v.visitId))));
    for (const r of results) expect(r.error).toBeNull();
    const numbers = results.map((r) => (r.data as { invoice_number: string }).invoice_number);
    expect(new Set(numbers).size).toBe(3);
  });
});

describe("create_invoice: input", () => {
  const bad: [string, unknown][] = [
    ["an empty list", []],
    ["a non-array", { description: "x", unit_price: 1 }],
    ["null", null],
    ["a missing description", [{ unit_price: 10, quantity: 1 }]],
    ["a blank description", [{ description: "   ", unit_price: 10, quantity: 1 }]],
    ["a negative price", [{ description: "x", unit_price: -1, quantity: 1 }]],
    ["a price that is not a number", [{ description: "x", unit_price: "10", quantity: 1 }]],
    ["a price above the bound", [{ description: "x", unit_price: 1000000.01, quantity: 1 }]],
    ["quantity 0", [{ description: "x", unit_price: 10, quantity: 0 }]],
    ["a fractional quantity", [{ description: "x", unit_price: 10, quantity: 1.5 }]],
    ["an unknown item type", [{ item_type: "gift", description: "x", unit_price: 10, quantity: 1 }]],
    ["51 items", Array.from({ length: 51 }, () => ({ description: "x", unit_price: 1, quantity: 1 }))],
    ["a subtotal beyond the column", Array.from({ length: 50 }, () => ({ description: "x", unit_price: 1000000, quantity: 99 }))],
  ];
  it.each(bad)("%s is INPUT_INVALID and writes nothing", async (_name, items) => {
    const { visitId } = await seedVisit(tenantA);
    const args = createInvoiceArgs(tenantA, visitId, { p_items: items as never });
    const { data, error } = await callCreateInvoice(tenantA.client, args);
    expect(data).toBeNull();
    expect(error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    expect(mapDbError(error).code).toBe("VALIDATION_FAILED");
    expect(await invoicesOfVisit(visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it("a negative discount or tax, and a missing request id, are refused", async () => {
    const { visitId } = await seedVisit(tenantA);
    for (const over of [{ p_discount: -1 }, { p_tax: -1 }, { p_discount: 100000000 }]) {
      const { error } = await callCreateInvoice(tenantA.client, createInvoiceArgs(tenantA, visitId, over));
      expect(error?.message).toBe("INPUT_INVALID");
    }
    const { error } = await callCreateInvoice(tenantA.client, createInvoiceArgs(tenantA, visitId, { p_client_request_id: null as unknown as string }));
    expect(error).toBeTruthy();
    expect(await invoicesOfVisit(visitId)).toEqual([]);
  });

  it("items default their type and quantity (consultation, 1) like the schema, and extra keys are ignored", async () => {
    const { visitId } = await seedVisit(tenantA);
    const { data, error } = await callCreateInvoice(
      tenantA.client,
      createInvoiceArgs(tenantA, visitId, { p_items: [{ description: " Plain fee ", unit_price: 99.999, total_price: 1 }], p_discount: 0 })
    );
    expect(error).toBeNull();
    expect(await itemsOfInvoice((data as { invoice_id: string }).invoice_id)).toEqual([
      { item_type: "consultation", description: "Plain fee", unit_price: 100, quantity: 1, total_price: 100 },
    ]);
  });
});

describe("create_invoice: who may call it", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix says billing:collect, or consultations:edit on their own visit", async (role) => {
    const member = members[role];
    const own = await seedVisit(tenantA, member.userId).catch(() => null);
    const others = await seedVisit(tenantA, members.doctor.userId === member.userId ? tenantA.userId : members.doctor.userId);

    const mayAny = hasPerm(role, "billing:collect");
    const mayOwn = mayAny || hasPerm(role, "consultations:edit");

    const onOthers = await callCreateInvoice(member.client, createInvoiceArgs(tenantA, others.visitId));
    if (mayAny) expect(onOthers.error).toBeNull();
    else {
      expect(onOthers.error?.code).toBe("42501");
      expect(await invoicesOfVisit(others.visitId)).toEqual([]);
    }

    if (own) {
      const onOwn = await callCreateInvoice(member.client, createInvoiceArgs(tenantA, own.visitId));
      if (mayOwn) expect(onOwn.error).toBeNull();
      else {
        expect(onOwn.error?.code).toBe("42501");
        expect(await invoicesOfVisit(own.visitId)).toEqual([]);
      }
    } else {
      // A role that cannot be a visit's doctor in the database cannot have an own visit: only "any visit" applies.
      expect(mayOwn).toBe(mayAny);
    }
  });

  it("the service refuses a colleague's visit with the fixed text before any write", async () => {
    const { visitId, patientId } = await seedVisit(tenantA, tenantA.userId);
    const result = await createVisitInvoice(ctxFor(members.doctor), {
      visit_id: visitId,
      patient_id: patientId,
      items: [{ item_type: "consultation", description: "Synthetic fee", unit_price: 200, quantity: 1 }],
      discount: 0,
      tax: 0,
      client_request_id: randomUUID(),
    });
    expect(result).toEqual({ success: false, error: BILLING_COLLECT_FORBIDDEN_MESSAGE });
    expect(await invoicesOfVisit(visitId)).toEqual([]);
  });

  it("anon cannot execute it (42501)", async () => {
    const { visitId } = await seedVisit(tenantA);
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { data, error } = await callCreateInvoice(anon, createInvoiceArgs(tenantA, visitId));
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await invoicesOfVisit(visitId)).toEqual([]);
  });

  it("another clinic's visit is NOT_FOUND, whichever clinic is named, and nothing is written", async () => {
    const visitB = await seedVisit(tenantB);
    // A's owner names B's visit under A, then names B as the tenant.
    const underA = await callCreateInvoice(tenantA.client, createInvoiceArgs(tenantA, visitB.visitId));
    expect(underA.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    expect(mapDbError(underA.error)).toMatchObject({ code: "NOT_FOUND" });
    const underB = await callCreateInvoice(tenantA.client, createInvoiceArgs(tenantB, visitB.visitId));
    expect(underB.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    expect(await invoicesOfVisit(visitB.visitId)).toEqual([]);
  });

  it("a member of A and B acting in A cannot invoice B's visit (naming B or A), but can in B", async () => {
    const visitB = await seedVisit(tenantB);
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    const named = await callCreateInvoice(actingInA, createInvoiceArgs(tenantB, visitB.visitId));
    expect(named.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    const underA = await callCreateInvoice(actingInA, createInvoiceArgs(tenantA, visitB.visitId));
    expect(underA.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    expect(await invoicesOfVisit(visitB.visitId)).toEqual([]);

    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    const ok = await callCreateInvoice(actingInB, createInvoiceArgs(tenantB, visitB.visitId));
    expect(ok.error).toBeNull();
    expect(await auditRows(tenantB.tenantId, "invoice.create")).toEqual([
      expect.objectContaining({ actor_id: dual.userId, actor_role: "receptionist", actor_type: "user" }),
    ]);
  });
});
