"use server";

import { resolveServiceContext } from "@/lib/auth/context";
import type { CreateInvoiceInput, CollectPaymentRequest, RecordPaymentRequest, CompleteAndBillInput, AddInvoiceItemInput } from "./schema";
import { contextFailureToAppError } from "@/lib/commands/context-error";
import { toCommandResult } from "@/lib/commands/command-result";
import type { Result as CommandResult } from "@/lib/errors/app-error";
import * as billingService from "./service";
import type {
  RecordPaymentResult,
  GetVisitBillingResult,
  GetReceiptPdfResult,
  SendConsolidatedConsultationWhatsAppInput,
} from "./service";
import { markAction } from "@/lib/observability/db-timing";
import { expectedVersionError } from "@/lib/errors/expected-version";

export type {
  CreateInvoiceValue,
  RecordPaymentResult,
  GetVisitBillingResult,
  CompleteAndBillResult,
  CompleteAndBillValue,
  GetReceiptPdfResult,
  SendConsolidatedConsultationWhatsAppInput,
} from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.
// PO-3 (V2-05 05-02b): invoicing, item edits and payment collection need `billing:collect` (owner, admin,
// receptionist); doctors bill their own visit only through completeAndBillConsultation (Sign & Bill).

type Result<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

/**
 * Creates the visit's invoice as one atomic command (V2-07 07-02, 07-04a F-10). Returns a `Result` (with the `AppError`
 * code the client's `useCommand` needs, as `collectPayment` does); `client_request_id` is required.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<CommandResult<billingService.CreateInvoiceValue>> {
  await markAction("billing.create_invoice");
  const resolved = await resolveServiceContext("billing:collect", "full", { sensitive: "billing.invoice.create" });
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await billingService.createInvoice(resolved.ctx, input);
  return result;
}

export async function recordPayment(input: RecordPaymentRequest): Promise<RecordPaymentResult> {
  await markAction("billing.record_payment");
  const resolved = await resolveServiceContext("billing:collect", "full", { sensitive: "billing.payment.record" });
  if (!resolved.ok) return { success: false, error: resolved.error };
  const invalid = expectedVersionError(input?.expected_invoice_version);
  if (invalid) return { success: false, error: invalid.message };
  const result = await billingService.recordPayment(resolved.ctx, input);
  return result;
}

/**
 * Desk checkout as one atomic command (V2-07 07-02): the visit's invoice and its payment in one transaction. Returns a
 * `Result` (with the `AppError` code the client's `useCommand` needs); `client_request_id` is required.
 */
export async function collectPayment(input: CollectPaymentRequest): Promise<CommandResult<billingService.CollectPaymentValue>> {
  await markAction("billing.collect_payment");
  const resolved = await resolveServiceContext("billing:collect", "full", { sensitive: "billing.payment.collect" });
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await billingService.collectPayment(resolved.ctx, input);
  return result;
}

export async function getVisitBillingDetails(visitId: string): Promise<GetVisitBillingResult> {
  await markAction("billing.get_visit_billing_details");
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return billingService.getVisitBillingDetails(resolved.ctx, visitId);
}

export async function addInvoiceItem(input: AddInvoiceItemInput): Promise<Result<typeof billingService.addInvoiceItem>> {
  await markAction("billing.add_invoice_item");
  const resolved = await resolveServiceContext("billing:collect", "full", { sensitive: "billing.invoice_item.add" });
  if (!resolved.ok) return { success: false, error: resolved.error };
  return billingService.addInvoiceItem(resolved.ctx, input);
}

export async function deleteInvoiceItem(itemId: string): Promise<Result<typeof billingService.deleteInvoiceItem>> {
  await markAction("billing.delete_invoice_item");
  const resolved = await resolveServiceContext("billing:collect", "full", { sensitive: "billing.invoice_item.delete" });
  if (!resolved.ok) return { success: false, error: resolved.error };
  return billingService.deleteInvoiceItem(resolved.ctx, itemId);
}

/**
 * Solo Doctor Workflow as one atomic command (V2-07 07-03): signs the consultation, creates the invoice and, when the fee
 * is collected, records the payment, all in one transaction. Returns a `Result` (with the `AppError` code the client's
 * `useCommand` needs); `client_request_id` is required. The command checks each part's permission (sign:
 * consultations:edit; invoice: billing:collect or the visit's own doctor; payment, only when `payment_collected`:
 * billing:collect, refused before anything is signed); the receipt PDF and WhatsApp follow after the commit.
 */
export async function completeAndBillConsultation(
  input: CompleteAndBillInput
): Promise<CommandResult<billingService.CompleteAndBillValue>> {
  await markAction("billing.complete_and_bill_consultation");
  const resolved = await resolveServiceContext("consultations:edit", "full", { sensitive: "billing.complete_and_bill" });
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await billingService.completeAndBillConsultation(resolved.ctx, input);
  return toCommandResult(result, (ok) => {
    const { success, ...value } = ok;
    void success;
    return value;
  });
}

export async function getInvoiceReceiptPdfSignedUrl(invoiceId: string): Promise<GetReceiptPdfResult> {
  await markAction("billing.get_invoice_receipt_pdf_signed_url");
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return billingService.getInvoiceReceiptPdfSignedUrl(resolved.ctx, invoiceId);
}

export async function shareReceiptViaWhatsApp(
  invoiceId: string
): Promise<Result<typeof billingService.shareReceiptViaWhatsApp>> {
  await markAction("billing.share_receipt_via_whats_app");
  const resolved = await resolveServiceContext("billing:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return billingService.shareReceiptViaWhatsApp(resolved.ctx, invoiceId);
}

export async function sendConsolidatedConsultationWhatsApp(
  input: SendConsolidatedConsultationWhatsAppInput
): Promise<Result<typeof billingService.sendConsolidatedConsultationWhatsApp>> {
  await markAction("billing.send_consolidated_consultation_whats_app");
  const resolved = await resolveServiceContext("prescriptions:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return billingService.sendConsolidatedConsultationWhatsApp(resolved.ctx, input);
}
