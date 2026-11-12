import { describe, it, expect } from "vitest";
import { signAndBillReceiptState, alreadyBilledMessage } from "@/features/billing/sign-and-bill-outcome";

// AR3-N2 follow-up (01-10): what the Sign & Bill modal shows for the receipt card, from the action result it consumes.
describe("signAndBillReceiptState", () => {
  it("an already-billed result reads as already billed with the invoice number, never as payment pending", () => {
    const state = signAndBillReceiptState({ alreadyBilled: true, invoiceNumber: "INV-2026-0042", paymentRecorded: false });
    expect(state).toEqual({
      kind: "already_billed",
      badge: "Already billed",
      message: "This visit is already billed (invoice INV-2026-0042). No new invoice or payment was recorded.",
    });
  });

  it("without an invoice number it still says already billed", () => {
    const state = signAndBillReceiptState({ alreadyBilled: true, invoiceNumber: null, paymentRecorded: false });
    expect(state.kind).toBe("already_billed");
    expect(state.badge).toBe("Already billed");
    expect(alreadyBilledMessage(undefined)).toBe("This visit is already billed. No new invoice or payment was recorded.");
  });

  it("a fresh bill shows Paid or Pending at Desk from paymentRecorded", () => {
    expect(signAndBillReceiptState({ paymentRecorded: true })).toEqual({ kind: "paid", badge: "Paid" });
    expect(signAndBillReceiptState({ paymentRecorded: false, alreadyBilled: false })).toEqual({
      kind: "pending",
      badge: "Pending at Desk",
    });
  });
});
