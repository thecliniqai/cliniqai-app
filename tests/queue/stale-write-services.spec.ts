/**
 * V2-09e 09E-07 (R-19; migration 000126): the services and the server actions send the row version the screen shows, and a stale one is refused with the fixed
 * text and no write. The command's own order and replay rules are in `supabase/tests/database/stale_write_refusal.test.sql`; this file is the application half:
 *   - a service call with the current version succeeds and returns the visit's / invoice's new version; with a stale version it is `CONFLICT` / `ROW_CHANGED`
 *     with `ROW_CHANGED_MESSAGE` and the row is unchanged (status, time, payments);
 *   - a call without a version (the system and API paths) compares nothing;
 *   - the error mapping and the argument helper (`versionArg`);
 *   - the server actions REQUIRE a version (a call without one fails the typecheck: the `@ts-expect-error` cases below are never executed).
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { mapDbError } from "@/lib/db/errors";
import { ROW_CHANGED_MESSAGE, versionArg, isRowChanged } from "@/lib/errors/row-changed";
import { cancelVisit, confirmAppointment, markNoShow, rescheduleVisit } from "@/features/visits/scheduling-service";
import { checkInVisit, completeVisit, startConsultation } from "@/features/queue/service";
import { collectPayment, getVisitBillingDetails } from "@/features/billing/service";
import * as queueActions from "@/features/queue/actions";
import * as schedulingActions from "@/features/visits/scheduling";
import * as billingActions from "@/features/billing/actions";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { seedBookedVisit, seedPatient } from "../helpers/front-desk-commands";
import { seedVisit } from "../helpers/billing-commands";
import { schedRow } from "../helpers/scheduling-commands";

let tenant: SeededTenant;
const DAY = 86_400_000;

async function versionOf(visitId: string): Promise<number> {
  const { data, error } = await getAdminClient().from("visits").select("row_version").eq("id", visitId).single();
  if (error) throw new Error(error.message);
  return data.row_version;
}
async function invoiceVersionOf(visitId: string): Promise<number> {
  const { data, error } = await getAdminClient().from("invoices").select("row_version").eq("visit_id", visitId).neq("status", "cancelled").single();
  if (error) throw new Error(error.message);
  return data.row_version;
}
/** Moves the visit's version the way another device's edit would (a listed column). */
async function moveOn(visitId: string): Promise<void> {
  const { error } = await getAdminClient().from("visits").update({ estimated_duration_minutes: 25 }).eq("id", visitId);
  if (error) throw new Error(error.message);
}
async function bookedAt(at: string, over: Record<string, unknown> = {}): Promise<string> {
  return seedBookedVisit(tenant, await seedPatient(tenant), tenant.userId, at, { is_overbooked: true, ...over });
}
const ahead = () => new Date(Date.now() + 3 * DAY).toISOString();
const past = () => new Date(Date.now() - DAY).toISOString();

const refused = { ok: false, error: { code: "CONFLICT", reason: "ROW_CHANGED", message: ROW_CHANGED_MESSAGE } };

beforeAll(async () => {
  tenant = await seedTenantWithOwner("CI StaleWrite Clinic");
});

describe("the error mapping and the argument helper", () => {
  it("ROW_CHANGED (P0001) is CONFLICT with the reason, and the text is fixed and carries no data", () => {
    const mapped = mapDbError({ code: "P0001", message: "ROW_CHANGED", details: "visit 123 is at 7", hint: "secret" }, { ROW_CHANGED: ROW_CHANGED_MESSAGE });
    expect(mapped).toMatchObject({ code: "CONFLICT", reason: "ROW_CHANGED", message: ROW_CHANGED_MESSAGE });
    expect(JSON.stringify(mapped)).not.toMatch(/123|secret/);
    expect(ROW_CHANGED_MESSAGE).toBe("This changed on another device. The latest is shown.");
    expect(isRowChanged(mapped)).toBe(true);
    expect(isRowChanged({ reason: "SLOT_TAKEN" })).toBe(false);
    expect(isRowChanged(null)).toBe(false);
  });

  it("versionArg: nothing when there is no version, the named parameter when there is one, and a value no row has for anything that cannot be a version", () => {
    expect(versionArg("p_expected_version", undefined)).toEqual({});
    expect(versionArg("p_expected_version", null)).toEqual({});
    expect(versionArg("p_expected_version", 0)).toEqual({ p_expected_version: 0 });
    expect(versionArg("p_expected_invoice_version", 7)).toEqual({ p_expected_invoice_version: 7 });
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(versionArg("p_expected_version", bad)).toEqual({ p_expected_version: -1 });
  });
});

describe("the visit services send the version", () => {
  it("cancel: a stale version is refused with the fixed text and the visit stays booked; the current version cancels and returns the new version", async () => {
    const visitId = await bookedAt(ahead());
    await moveOn(visitId);
    const stale = await cancelVisit(ctxFor(tenant), { visit_id: visitId, reason_code: "other", expected_version: 0 }, randomUUID());
    expect(stale).toMatchObject(refused);
    expect((await schedRow(visitId)).status).toBe("booked");
    const current = await versionOf(visitId);
    const done = await cancelVisit(ctxFor(tenant), { visit_id: visitId, reason_code: "other", expected_version: current }, randomUUID());
    expect(done).toMatchObject({ ok: true, value: { visitId } });
    expect(done.ok && done.value.rowVersion).toBe(await versionOf(visitId));
    expect((await schedRow(visitId)).status).toBe("cancelled");
  });

  it("cancel without a version compares nothing (the system and API paths)", async () => {
    const visitId = await bookedAt(ahead());
    await moveOn(visitId);
    expect(await cancelVisit(ctxFor(tenant), { visit_id: visitId, reason_code: "other" }, randomUUID())).toMatchObject({ ok: true });
  });

  it("a version that cannot be one (negative) is a validation failure, never a write", async () => {
    const visitId = await bookedAt(ahead());
    const res = await cancelVisit(ctxFor(tenant), { visit_id: visitId, reason_code: "other", expected_version: -3 }, randomUUID());
    expect(res).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect((await schedRow(visitId)).status).toBe("booked");
  });

  it("reschedule: a stale version leaves the time where it was; the current one moves it", async () => {
    const visitId = await bookedAt(ahead());
    const before = (await schedRow(visitId)).scheduled_at;
    await moveOn(visitId);
    const to = new Date(Date.now() + 5 * DAY).toISOString();
    expect(await rescheduleVisit(ctxFor(tenant), { visit_id: visitId, new_scheduled_at: to, is_overbooked: true, expected_version: 0 }, randomUUID())).toMatchObject(refused);
    expect((await schedRow(visitId)).scheduled_at).toBe(before);
    const moved = await rescheduleVisit(ctxFor(tenant), { visit_id: visitId, new_scheduled_at: to, is_overbooked: true, expected_version: await versionOf(visitId) }, randomUUID());
    expect(moved).toMatchObject({ ok: true });
    expect(moved.ok && moved.value.rowVersion).toBe(await versionOf(visitId));
  });

  it("confirm and mark no-show: stale is refused, current works", async () => {
    const toConfirm = await bookedAt(ahead());
    await moveOn(toConfirm);
    expect(await confirmAppointment(ctxFor(tenant), toConfirm, randomUUID(), 0)).toMatchObject(refused);
    expect((await schedRow(toConfirm)).status).toBe("booked");
    expect(await confirmAppointment(ctxFor(tenant), toConfirm, randomUUID(), await versionOf(toConfirm))).toMatchObject({ ok: true, value: { alreadyConfirmed: false } });

    const missed = await bookedAt(past());
    await moveOn(missed);
    expect(await markNoShow(ctxFor(tenant), missed, randomUUID(), 0)).toMatchObject(refused);
    expect((await schedRow(missed)).status).toBe("booked");
    expect(await markNoShow(ctxFor(tenant), missed, randomUUID(), await versionOf(missed))).toMatchObject({ ok: true });
  });

  it("check in, start consultation and complete at the desk: stale is refused with no queue token and no status move", async () => {
    const today = new Date().toISOString();
    const visitId = await bookedAt(today);
    await moveOn(visitId);
    const stale = await checkInVisit(ctxFor(tenant), visitId, "normal", randomUUID(), 0);
    expect(stale).toMatchObject({ success: false, code: "CONFLICT", reason: "ROW_CHANGED", error: ROW_CHANGED_MESSAGE });
    expect((await schedRow(visitId)).status).toBe("booked");
    const { count } = await getAdminClient().from("queue_tokens").select("id", { count: "exact", head: true }).eq("visit_id", visitId);
    expect(count).toBe(0);
    const ok = await checkInVisit(ctxFor(tenant), visitId, "normal", randomUUID(), await versionOf(visitId));
    expect(ok).toMatchObject({ success: true });
    expect(ok.success && ok.rowVersion).toBe(await versionOf(visitId));

    const startable = await bookedAt(today);
    await moveOn(startable);
    expect(await startConsultation(ctxFor(tenant), startable, randomUUID(), 0)).toMatchObject(refused);
    expect((await schedRow(startable)).status).toBe("booked");
    expect(await startConsultation(ctxFor(tenant), startable, randomUUID(), await versionOf(startable))).toMatchObject({ ok: true });

    const { visitId: waiting } = await seedVisit(tenant, undefined, { status: "waiting" });
    await moveOn(waiting);
    expect(await completeVisit(ctxFor(tenant), waiting, randomUUID(), 0)).toMatchObject(refused);
    expect((await schedRow(waiting)).status).toBe("waiting");
    expect(await completeVisit(ctxFor(tenant), waiting, randomUUID(), await versionOf(waiting))).toMatchObject({ ok: true });
  });
});

describe("collect payment sends the invoice version", () => {
  it("a payment against an invoice that moved on (an item added elsewhere) is refused with nothing recorded; the current version pays and returns the new one", async () => {
    const { visitId, patientId } = await seedVisit(tenant, undefined, { status: "completed" });
    const base = {
      visit_id: visitId,
      patient_id: patientId,
      items: [{ item_type: "consultation" as const, description: "Synthetic fee", unit_price: 700, quantity: 1 }],
      discount: 0,
      tax: 0,
      amount: 100,
      payment_method: "cash" as const,
    };
    const first = await collectPayment(ctxFor(tenant), { ...base, client_request_id: randomUUID() });
    expect(first).toMatchObject({ ok: true, value: { invoiceCreated: true } });
    const invoiceId = first.ok ? first.value.invoiceId : "";
    const seen = await invoiceVersionOf(visitId);
    // The checkout drawer reads the invoice through this service and sends the version it shows: it must carry it (a screen that never sent one was found by the e2e).
    const shown = await getVisitBillingDetails(ctxFor(tenant), visitId);
    expect(shown.success && shown.invoice?.row_version).toBe(seen);
    // Another device adds an item: the invoice's subtotal and total move, so does its version.
    const { error } = await getAdminClient().from("invoice_items").insert({ tenant_id: tenant.tenantId, invoice_id: invoiceId, item_type: "procedure", description: "Synthetic extra", unit_price: 50, quantity: 1, total_price: 50 });
    expect(error).toBeNull();
    expect(await invoiceVersionOf(visitId)).toBeGreaterThan(seen);

    const stale = await collectPayment(ctxFor(tenant), { ...base, items: [], client_request_id: randomUUID(), expected_invoice_version: seen });
    expect(stale).toMatchObject(refused);
    const { count } = await getAdminClient().from("payments").select("id", { count: "exact", head: true }).eq("invoice_id", invoiceId);
    expect(count).toBe(1);

    const paid = await collectPayment(ctxFor(tenant), { ...base, items: [], client_request_id: randomUUID(), expected_invoice_version: await invoiceVersionOf(visitId) });
    expect(paid).toMatchObject({ ok: true, value: { invoiceCreated: false } });
    expect(paid.ok && paid.value.invoiceVersion).toBe(await invoiceVersionOf(visitId));
  });

  it("a version given for a visit with no live invoice is refused, and no invoice is created", async () => {
    const { visitId, patientId } = await seedVisit(tenant, undefined, { status: "completed" });
    const res = await collectPayment(ctxFor(tenant), {
      visit_id: visitId,
      patient_id: patientId,
      items: [{ item_type: "consultation", description: "Synthetic fee", unit_price: 300, quantity: 1 }],
      discount: 0,
      tax: 0,
      amount: 100,
      payment_method: "cash",
      client_request_id: randomUUID(),
      expected_invoice_version: 3,
    });
    expect(res).toMatchObject(refused);
    const { count } = await getAdminClient().from("invoices").select("id", { count: "exact", head: true }).eq("visit_id", visitId);
    expect(count).toBe(0);
  });
});

describe("the server actions require the version", () => {
  it("a call without one does not typecheck (never executed here: `npm run typecheck` is the check)", () => {
    const never = (): void => {
      // @ts-expect-error the version the screen shows is required
      void queueActions.checkInVisit("v", "normal", "r");
      // @ts-expect-error the version the screen shows is required
      void queueActions.startConsultation("v", "r");
      // @ts-expect-error the version the screen shows is required
      void queueActions.completeVisit("v", "r");
      // @ts-expect-error the version the screen shows is required
      void schedulingActions.markNoShow("v", "r");
      // @ts-expect-error the version the screen shows is required
      void schedulingActions.confirmAppointment("v", "r");
      // @ts-expect-error `expected_version` is required in what a screen sends
      void schedulingActions.cancelVisit({ visit_id: "v", reason_code: "other" }, "r");
      // @ts-expect-error `expected_version` is required in what a screen sends
      void schedulingActions.rescheduleVisit({ visit_id: "v", new_scheduled_at: "2030-01-01T00:00:00Z" }, "r");
      // @ts-expect-error `expected_invoice_version` is required (null when the screen shows no invoice yet)
      void billingActions.collectPayment({} as Parameters<typeof billingActions.collectPayment>[0] extends infer T ? Omit<T & object, "expected_invoice_version"> : never);
    };
    expect(typeof never).toBe("function");
  });
});
