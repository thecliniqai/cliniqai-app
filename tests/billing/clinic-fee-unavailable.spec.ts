/**
 * PR 2 review N-3: a new bill never starts from a made-up amount. When the clinic's fee cannot be read with the bill, `getVisitBillingDetails` refuses with a
 * fixed text (the checkout drawer then shows it with Try again and offers no Collect button) instead of answering success with no fee, which the drawer
 * used to turn into a hard-coded ₹500. A fee that is read is answered as before. The database is a stub; the drawer's path is
 * `tests/e2e/shell/bootstrap.spec.ts` (fees are never held).
 */
import { describe, expect, it, vi } from "vitest";
import { mockCtx } from "../helpers/context";
import { CLINIC_FEE_UNAVAILABLE, getVisitBillingDetails } from "@/features/billing/service";

const VISIT = "00000000-0000-4000-8000-0000000000c1";

/** A visit with no invoice yet; the tenants read answers `tenant`. */
function db(tenant: { data: unknown; error: unknown }) {
  const chain = (result: { data: unknown; error: unknown }) => {
    const c: Record<string, unknown> = {};
    for (const k of ["select", "eq", "order", "limit"]) c[k] = () => c;
    c.maybeSingle = async () => result;
    c.then = (resolve: (v: unknown) => void) => resolve(result);
    return c;
  };
  return { from: (table: string) => (table === "invoices" ? chain({ data: [], error: null }) : chain(tenant)) };
}

describe("getVisitBillingDetails: the clinic's fee for a new bill", () => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  it("refuses with the fixed text when the fee could not be read: no bill starts from a default amount", async () => {
    const res = await getVisitBillingDetails(mockCtx(db({ data: null, error: { code: "57014", message: "canceling statement" } })), VISIT);
    expect(res).toEqual({ success: false, error: CLINIC_FEE_UNAVAILABLE });
  });

  it("answers the fee the database has", async () => {
    const res = await getVisitBillingDetails(mockCtx(db({ data: { default_consultation_fee: 735 }, error: null })), VISIT);
    expect(res.success && res.clinicFee).toBe(735);
  });
});
