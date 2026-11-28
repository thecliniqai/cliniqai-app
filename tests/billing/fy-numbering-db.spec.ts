/**
 * V2-10 10-01 (D-6, D-8, D-15; threat T-10-03; roadmap V2-10 acceptance "FY numbering has no gaps under 50 parallel creates"):
 * invoice numbers come from the clinic's FY counter inside the creating command.
 *
 *   - tracer: a new clinic's first bill is `INV/<FY of the clinic-local today>/00001`, and its receipt PDF prints that number
 *     and the amount through lib/money;
 *   - an injected instant (1 Apr 00:00 IST) takes the new FY; a transaction that rolls back leaves no counter behind;
 *   - 50 parallel creates on 50 visits of one clinic → 00001..00050, no gap, no duplicate;
 *   - a fault after the number is taken (the invoice insert fails) → nothing is written and the next create gets the next
 *     number (no gap);
 *   - a cancelled or no-show visit is refused with VISIT_NOT_BILLABLE (D-8) through the service.
 * Calls go through each caller's own supabase-js client (PostgREST, one connection per request); rows are read back with the
 * service-role client or the local superuser (counter table, no API grant). Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indianFyAt } from "@/lib/fy";
import { formatINRAscii, toPaise } from "@/lib/money";
import { createInvoice } from "@/features/billing/service";
import { compileAndArchiveReceiptPdf } from "@/features/billing/pdf/generator";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { psql } from "../helpers/sql";
import { pdfText } from "../helpers/pdf-text";
import { leftoverFaults, withFault } from "../helpers/fault";
import { callCreateInvoice, createInvoiceArgs, invoicesOfVisit, seedVisit } from "../helpers/billing-commands";

const ITEMS_650 = [{ item_type: "consultation", description: "Synthetic consultation", unit_price: 650, quantity: 1 }];

async function clinicTimeZone(tenantId: string): Promise<string> {
  const { data, error } = await getAdminClient().from("tenants").select("timezone").eq("id", tenantId).single();
  if (error) throw new Error(error.message);
  return data.timezone as string;
}

/** The counter rows of a clinic (`fy:last_value`), read as the local superuser (no API role can read the table). */
function counters(tenantId: string): string[] {
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error("bad tenant id");
  return psql(`select fy || ':' || last_value from private.invoice_counters where tenant_id = '${tenantId}' order by fy`);
}

let fyNow: string;

beforeAll(async () => {
  const probe = await seedTenantWithOwner("CI FY Probe Clinic");
  fyNow = indianFyAt(new Date(), await clinicTimeZone(probe.tenantId));
});

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

describe("FY numbering: tracer", () => {
  let clinic: SeededTenant;
  beforeAll(async () => {
    clinic = await seedTenantWithOwner("CI FY Tracer Clinic");
  });

  it("the clinic's first bill is INV/<fy>/00001 and its receipt prints that number and the amount", async () => {
    const { visitId } = await seedVisit(clinic);
    const { data, error } = await callCreateInvoice(clinic.client, createInvoiceArgs(clinic, visitId, { p_items: ITEMS_650, p_discount: 0 }));
    expect(error).toBeNull();
    const result = data as { invoice_id: string; invoice_number: string; existing: boolean };
    expect(result.invoice_number).toBe(`INV/${fyNow}/00001`);
    expect(result.existing).toBe(false);
    expect(fyNow).toMatch(/^\d{4}-\d{2}$/);

    const [row] = await invoicesOfVisit(visitId);
    expect({ number: row.invoice_number, subtotal: Number(row.subtotal), total: Number(row.total_amount), status: row.status }).toEqual({
      number: `INV/${fyNow}/00001`,
      subtotal: 650,
      total: 650,
      status: "issued",
    });
    expect(counters(clinic.tenantId)).toEqual([`${fyNow}:1`]);

    const receipt = await compileAndArchiveReceiptPdf(ctxFor(clinic), result.invoice_id);
    expect(receipt).not.toBeNull();
    const text = pdfText(receipt!.buffer);
    expect(text).toContain(`INV/${fyNow}/00001`);
    expect(text).toContain(formatINRAscii(toPaise(650)));
    expect(formatINRAscii(toPaise(650))).toBe("Rs. 650");
    // The standard PDF font has no ₹ glyph: before 10-01 the receipt drew "¹650.00" (U+20B9 cut to its low byte 0xB9).
    expect(text).not.toContain("¹");
  });

  it("an injected instant takes its own FY (1 Apr 00:00 IST → the new FY), and a rolled-back command leaves no number behind", () => {
    if (!/^[0-9a-f-]{36}$/.test(clinic.tenantId)) throw new Error("bad tenant id");
    const out = psql(
      `begin; select private.next_invoice_number('${clinic.tenantId}', '2027-03-31T23:59:59+05:30'); ` +
        `select private.next_invoice_number('${clinic.tenantId}', '2027-04-01T00:00:00+05:30'); rollback;`
    );
    expect(out.filter((l) => l.startsWith("INV/"))).toEqual(["INV/2026-27/" + (fyNow === "2026-27" ? "00002" : "00001"), "INV/2027-28/00001"]);
    expect(counters(clinic.tenantId)).toEqual([`${fyNow}:1`]);
  });
});

describe("FY numbering: concurrency", () => {
  it("50 parallel creates on 50 visits of one clinic → 00001..00050, no gap, no duplicate", { timeout: 120_000 }, async () => {
    const clinic = await seedTenantWithOwner("CI FY Parallel Clinic");
    const visits: string[] = [];
    for (let i = 0; i < 50; i++) visits.push((await seedVisit(clinic)).visitId);

    const results = await Promise.all(
      visits.map((visitId) => callCreateInvoice(clinic.client, createInvoiceArgs(clinic, visitId, { p_items: ITEMS_650, p_discount: 0 })))
    );
    expect(results.map((r) => r.error?.code ?? null)).toEqual(Array(50).fill(null));

    const { data, error } = await getAdminClient().from("invoices").select("invoice_number, visit_id").eq("tenant_id", clinic.tenantId);
    expect(error).toBeNull();
    const numbers = (data ?? []).map((r) => r.invoice_number).sort();
    const expected = Array.from({ length: 50 }, (_, i) => `INV/${fyNow}/${String(i + 1).padStart(5, "0")}`);
    expect(numbers).toEqual(expected);
    expect(new Set((data ?? []).map((r) => r.visit_id)).size).toBe(50);
    expect(counters(clinic.tenantId)).toEqual([`${fyNow}:50`]);
  });

  it("a fault after the number is taken writes nothing and burns no number: the next create gets the next number", async () => {
    const clinic = await seedTenantWithOwner("CI FY Fault Clinic");
    const first = await seedVisit(clinic);
    const faulted = await seedVisit(clinic);
    const next = await seedVisit(clinic);

    const ok = await callCreateInvoice(clinic.client, createInvoiceArgs(clinic, first.visitId, { p_items: ITEMS_650, p_discount: 0 }));
    expect((ok.data as { invoice_number: string }).invoice_number).toBe(`INV/${fyNow}/00001`);

    // The invoice insert is the first write after private.next_invoice_number: the fault rolls the counter back with it.
    const failed = await withFault({ table: "public.invoices", column: "visit_id", marker: faulted.visitId }, () =>
      callCreateInvoice(clinic.client, createInvoiceArgs(clinic, faulted.visitId, { p_items: ITEMS_650, p_discount: 0 }))
    );
    expect(failed.error?.code).toBe("XX000");
    expect(await invoicesOfVisit(faulted.visitId)).toEqual([]);
    expect(counters(clinic.tenantId)).toEqual([`${fyNow}:1`]);

    const after = await callCreateInvoice(clinic.client, createInvoiceArgs(clinic, next.visitId, { p_items: ITEMS_650, p_discount: 0 }));
    expect(after.error).toBeNull();
    expect((after.data as { invoice_number: string }).invoice_number).toBe(`INV/${fyNow}/00002`);
    expect(counters(clinic.tenantId)).toEqual([`${fyNow}:2`]);
  });
});

describe("D-8: no bill for a cancelled or no-show visit", () => {
  it.each(["cancelled", "no_show"] as const)("a %s visit is refused with VISIT_NOT_BILLABLE and nothing is written", async (status) => {
    const clinic = await seedTenantWithOwner(`CI FY ${status} Clinic`);
    const { visitId, patientId } = await seedVisit(clinic, undefined, { status });
    const res = await createInvoice(ctxFor(clinic), {
      visit_id: visitId,
      patient_id: patientId,
      items: ITEMS_650.map((i) => ({ ...i, item_type: "consultation" as const })),
      discount: 0,
      tax: 0,
      client_request_id: randomUUID(),
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("CONFLICT");
    expect(res.error.reason).toBe("VISIT_NOT_BILLABLE");
    expect(res.error.message).toBe("This visit was cancelled or marked no-show, so it cannot be billed.");
    expect(await invoicesOfVisit(visitId)).toEqual([]);
    expect(counters(clinic.tenantId)).toEqual([]);
  });
});
