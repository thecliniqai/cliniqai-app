/**
 * V2-03 03-13c (triage M-ERRMSG, the features/billing/** share; review C M-3): a billing service never returns a raw
 * database or provider error text to the client. Every catch maps through `clientErrorMessage` (a permission refusal
 * keeps its fixed text; anything else becomes the service's fixed fallback), so a Postgres detail or a WhatsApp
 * dispatch error carrying a patient's phone or name cannot reach the response. Unit test: the database stub throws a
 * synthetic, PHI-shaped error on first use.
 */
import { describe, expect, it, vi } from "vitest";
import { mockCtx } from "../helpers/context";
import {
  deleteInvoiceItem,
  getInvoiceReceiptPdfSignedUrl,
  getVisitBillingDetails,
  shareReceiptViaWhatsApp,
} from "@/features/billing/service";
import { getDailyCollectionReport } from "@/features/billing/reports-service";

const LEAK = "Key (phone)=(+919000000099) already exists for Synthetic Leakname";
const ID = "00000000-0000-4000-8000-0000000000b1";

/** A client whose every table, RPC and storage access throws the PHI-shaped error. */
function throwingDb() {
  const fail = () => {
    throw new Error(LEAK);
  };
  return new Proxy({}, { get: () => fail });
}

describe("features/billing: no raw error text in a service result (M-ERRMSG)", () => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  it.each<[string, () => Promise<{ success: boolean; error?: string }>]>([
    ["getVisitBillingDetails", () => getVisitBillingDetails(mockCtx(throwingDb()), ID)],
    ["deleteInvoiceItem", () => deleteInvoiceItem(mockCtx(throwingDb()), ID)],
    ["getInvoiceReceiptPdfSignedUrl", () => getInvoiceReceiptPdfSignedUrl(mockCtx(throwingDb()), ID)],
    ["shareReceiptViaWhatsApp", () => shareReceiptViaWhatsApp(mockCtx(throwingDb()), ID)],
    ["getDailyCollectionReport", () => getDailyCollectionReport(mockCtx(throwingDb()), "2026-11-01", "2026-11-02")],
  ])("%s returns a fixed message, never the database error", async (_name, call) => {
    const result = await call();
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).not.toContain("9000000099");
    expect(result.error).not.toContain("Leakname");
    expect(result.error).not.toContain("Key (");
  });
});
