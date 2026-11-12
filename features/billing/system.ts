import "server-only";

import { getSystemDb } from "@/lib/supabase/system";
import { recordPaymentSchema, type RecordPaymentInput } from "./schema";
import {
  callRecordPayment,
  RECORD_PAYMENT_MESSAGES,
  type PaymentSystemActor,
  type RecordPaymentResult,
} from "./service";

/**
 * The system path of `record_payment` (TARGET §7.1; V2-03 03-07, D1). For jobs and inbound webhooks (ADR-0005 allows
 * `features/<domain>/system.ts`), never a request path: there is no session, so the service-role client runs the same
 * SECURITY INVOKER function with an explicit actor from the closed {@link PaymentSystemActor} set. The function refuses
 * that actor from a user session and refuses the service role without it; the payment row carries
 * `recorded_by_system`, the audit row `actor_type = 'system'`. `tenantId` is the tenant the job or webhook resolved
 * for its subject (never a value from the inbound body); the invoice must belong to it. `commandId` is required: a
 * system caller always has a stable key (a provider event id).
 *
 * `server-only`, never `"use server"`.
 */
export async function recordPaymentAsSystem(
  tenantId: string,
  input: RecordPaymentInput & { commandId: string },
  systemActor: PaymentSystemActor
): Promise<RecordPaymentResult> {
  const parsed = recordPaymentSchema.safeParse(input);
  const commandId = parsed.success ? parsed.data.commandId : undefined;
  if (!parsed.success || !commandId) {
    return { success: false, error: RECORD_PAYMENT_MESSAGES.VALIDATION_FAILED };
  }
  const data = parsed.data;
  const db = getSystemDb("billing.record_payment_system");

  const outcome = await callRecordPayment(
    db,
    {
      tenantId,
      invoiceId: data.invoice_id,
      amount: Math.round((Number(data.amount) + Number.EPSILON) * 100) / 100,
      method: data.payment_method,
      reference: data.reference_number,
      notes: data.notes,
      commandId,
    },
    { event: "billing.payment_record_system.failed" },
    systemActor
  );
  if (!outcome.ok) return { success: false, error: outcome.error.message };

  const result = outcome.value;
  return {
    success: true,
    paymentId: result.payment_id,
    status: result.invoice_status === "paid" ? "paid" : "issued",
    totalPaid: result.paid_total,
    balanceDue: result.balance_due,
    replayed: result.replayed,
  };
}
