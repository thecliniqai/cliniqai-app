import type { CompleteAndBillResult } from "./service";

/**
 * What the Sign & Bill modal shows for the receipt card after a successful `completeAndBillConsultation` (AR3-N2).
 * An already-billed visit (another request created the invoice) is shown as such, never as "payment pending".
 */
export type SignAndBillReceiptState =
  | { kind: "already_billed"; badge: string; message: string }
  | { kind: "paid"; badge: string }
  | { kind: "pending"; badge: string };

export function alreadyBilledMessage(invoiceNumber?: string | null): string {
  return invoiceNumber
    ? `This visit is already billed (invoice ${invoiceNumber}). No new invoice or payment was recorded.`
    : "This visit is already billed. No new invoice or payment was recorded.";
}

export function signAndBillReceiptState(
  result: Pick<Extract<CompleteAndBillResult, { success: true }>, "alreadyBilled" | "invoiceNumber" | "paymentRecorded">
): SignAndBillReceiptState {
  if (result.alreadyBilled) {
    return { kind: "already_billed", badge: "Already billed", message: alreadyBilledMessage(result.invoiceNumber) };
  }
  return result.paymentRecorded ? { kind: "paid", badge: "Paid" } : { kind: "pending", badge: "Pending at Desk" };
}
