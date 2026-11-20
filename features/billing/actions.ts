"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import { CreateInvoiceInput, CollectPaymentInput, RecordPaymentInput, CompleteAndBillInput, AddInvoiceItemInput } from "./schema";
import { contextFailureToAppError } from "@/lib/commands/context-error";
import { toCommandResult } from "@/lib/commands/command-result";
import type { Result as CommandResult } from "@/lib/errors/app-error";
import * as billingService from "./service";
import type {
  CreateInvoiceResult,
  RecordPaymentResult,
  GetVisitBillingResult,
  GetReceiptPdfResult,
  SendConsolidatedConsultationWhatsAppInput,
} from "./service";

export type {
  CreateInvoiceResult,
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

function revalidate(...paths: string[]) {
  try {
    for (const path of paths) revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

export async function createVisitInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  const resolved = await resolveServiceContext("billing:collect");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await billingService.createVisitInvoice(resolved.ctx, input);
  if (result.success) revalidate("/queue", `/consultation/${result.invoice.visit_id}`);
  return result;
}

export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const resolved = await resolveServiceContext("billing:collect");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await billingService.recordPayment(resolved.ctx, input);
  if (result.success) revalidate("/queue", "/cabin", "/billing");
  return result;
}

/**
 * Desk checkout as one atomic command (V2-07 07-02): the visit's invoice and its payment in one transaction. Returns a
 * `Result` (with the `AppError` code the client's `useCommand` needs); `client_request_id` is required.
 */
export async function collectPayment(input: CollectPaymentInput): Promise<CommandResult<billingService.CollectPaymentValue>> {
  const resolved = await resolveServiceContext("billing:collect");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await billingService.collectPayment(resolved.ctx, input);
  if (result.ok) revalidate("/queue", "/cabin", "/billing", `/consultation/${input.visit_id}`);
  return result;
}

export async function getVisitBillingDetails(visitId: string): Promise<GetVisitBillingResult> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return billingService.getVisitBillingDetails(resolved.ctx, visitId);
}

export async function addInvoiceItem(input: AddInvoiceItemInput): Promise<Result<typeof billingService.addInvoiceItem>> {
  const resolved = await resolveServiceContext("billing:collect");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return billingService.addInvoiceItem(resolved.ctx, input);
}

export async function deleteInvoiceItem(itemId: string): Promise<Result<typeof billingService.deleteInvoiceItem>> {
  const resolved = await resolveServiceContext("billing:collect");
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
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await billingService.completeAndBillConsultation(resolved.ctx, input);
  if (result.success) revalidate(`/consultation/${result.visitId}`, "/queue", "/cabin", "/billing");
  return toCommandResult(result, (ok) => {
    const { success, ...value } = ok;
    void success;
    return value;
  });
}

export async function getInvoiceReceiptPdfSignedUrl(invoiceId: string): Promise<GetReceiptPdfResult> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return billingService.getInvoiceReceiptPdfSignedUrl(resolved.ctx, invoiceId);
}

export async function shareReceiptViaWhatsApp(
  invoiceId: string
): Promise<Result<typeof billingService.shareReceiptViaWhatsApp>> {
  const resolved = await resolveServiceContext("billing:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return billingService.shareReceiptViaWhatsApp(resolved.ctx, invoiceId);
}

export async function sendConsolidatedConsultationWhatsApp(
  input: SendConsolidatedConsultationWhatsAppInput
): Promise<Result<typeof billingService.sendConsolidatedConsultationWhatsApp>> {
  const resolved = await resolveServiceContext("prescriptions:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return billingService.sendConsolidatedConsultationWhatsApp(resolved.ctx, input);
}
