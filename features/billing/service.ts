import "server-only";
import { serverEnv } from "@/lib/env-server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertPerm, hasPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { visitInTenant } from "@/lib/auth/tenant-refs";
import { Invoice, InvoiceItem, Payment } from "@/lib/db/types";
import {
  createInvoiceSchema,
  CreateInvoiceInput,
  collectPaymentSchema,
  CollectPaymentInput,
  recordPaymentSchema,
  RecordPaymentInput,
  completeAndBillSchema,
  CompleteAndBillInput,
  addInvoiceItemSchema,
  AddInvoiceItemInput,
} from "./schema";
import { archiveSealedPrescriptionPdf } from "@/features/consultation/service";
import { createShareToken } from "@/features/sharing/tokens";
import { enqueueMessage } from "@/lib/jobs/enqueue";
import type { InteractiveButton } from "@/lib/messaging/types";
import {
  compileAndArchiveReceiptPdf,
  generateAndArchiveReceiptPdf,
  receiptArchived,
} from "./pdf/generator";
import { callCommand } from "@/lib/commands/call-command";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { mapDbError, unaffectedRowsError, type DbErrorMessages } from "@/lib/db/errors";
import { appError, type AppErrorCode, type Result } from "@/lib/errors/app-error";
import { ROW_CHANGED_MESSAGE, versionArg } from "@/lib/errors/row-changed";
import { clientErrorMessage } from "@/lib/errors/client-message";
import { roundRupees } from "@/lib/money";

// Billing use-cases. Tenant and actor come only from `ctx` (ADR-0005 D1); each use-case checks the permission its
// server action checked before the move, and completeAndBillConsultation calls the consultation, invoice, payment and
// WhatsApp services with the same context so each callee's own permission check applies.
// PO-3 (V2-05 05-02b, R-6/R-7): collecting and editing bills needs `billing:collect` (owner, admin, receptionist);
// doctors and nurses do not collect. A doctor (consultations:edit) may still create the invoice of their OWN visit
// through Sign & Bill, routed to reception unless they also hold billing:collect (the owner of a solo clinic). The
// database enforces the same rules (000056 invoices/invoice_items/payments policies); these checks give the fixed
// FORBIDDEN text before any write.

/** Fixed text for a caller who may not collect payments or edit bills (PO-3). */
export const BILLING_COLLECT_FORBIDDEN_MESSAGE =
  "Only the front desk can collect payments. Sign and route the bill to reception instead.";

/** Fixed texts for the invoice item guard's refusals (V2-05 05-11d, N-3: invoice_items_integrity_guard). */
export const INVOICE_LOCKED_MESSAGE = "A paid or cancelled invoice cannot be changed.";
export const INVOICE_BELOW_COLLECTED_MESSAGE =
  "This change would bring the bill to or below the amount already collected, and refunds are not available yet.";

function invoiceItemRefusal(err: { code?: string; message?: string } | null | undefined): string | null {
  if (err?.code !== "42501") return null;
  if (err.message === "INVOICE_ITEMS_LOCKED") return INVOICE_LOCKED_MESSAGE;
  if (err.message === "INVOICE_BELOW_COLLECTED") return INVOICE_BELOW_COLLECTED_MESSAGE;
  return null;
}

/**
 * True when the caller may create the invoice of `visitId`: a collector (billing:collect), or a clinician
 * (consultations:edit) who is the visit's doctor (Sign & Bill, R-7). Read on the caller's client, in their clinic.
 */
async function mayInvoiceVisit(ctx: ServiceContext, visitId: string): Promise<boolean> {
  if (hasPerm(ctx.role, "billing:collect")) return true;
  if (!hasPerm(ctx.role, "consultations:edit")) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db.from("visits") as any)
    .select("doctor_id")
    .eq("id", visitId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  return !error && !!data && (data as { doctor_id: string | null }).doctor_id === ctx.userId;
}

export type CreateInvoiceResult =
  | {
      success: true;
      invoice: Invoice;
      items: InvoiceItem[];
      /** True when the visit already had a live invoice (AR3-N2): that invoice is returned and nothing was created. */
      existing?: boolean;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/** An invoice and its items by id, read in the caller's tenant (RLS applies). */
async function invoiceWithItems(
  ctx: ServiceContext,
  invoiceId: string
): Promise<{ invoice: Invoice; items: InvoiceItem[] } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invoice } = await (ctx.db.from("invoices") as any)
    .select("*")
    .eq("id", invoiceId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!invoice) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (ctx.db.from("invoice_items") as any)
    .select("*")
    .eq("invoice_id", invoiceId)
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: true });
  return { invoice: invoice as Invoice, items: (items || []) as InvoiceItem[] };
}

/** One fixed text per invoice-item reason of `private.invoice_items_normalize` (000099, F-8), shared by the billing commands. */
const INVOICE_ITEM_REASON_MESSAGES = {
  ITEM_COUNT_INVALID: "An invoice needs between 1 and 50 items.",
  ITEM_DESCRIPTION_INVALID: "Each item needs a description of 1 to 200 characters without control characters.",
  ITEM_PRICE_INVALID: "Each item price must be between ₹0 and ₹10,00,000.",
  ITEM_QUANTITY_INVALID: "Each item quantity must be a whole number from 1 to 99.",
  INVOICE_TOTAL_INVALID: "The bill total is too large.",
  // V2-10 10-01 (D-8, migration 000140): a new bill for a cancelled or no-show visit.
  VISIT_NOT_BILLABLE: "This visit was cancelled or marked no-show, so it cannot be billed.",
} as const;

/** Fixed, data-free texts by reason or code for `create_invoice` and `collect_payment` (V2-07 07-02). The driver message never reaches the caller. */
export const INVOICE_COMMAND_MESSAGES = {
  NOT_FOUND: "Visit not found or access denied.",
  FORBIDDEN: BILLING_COLLECT_FORBIDDEN_MESSAGE,
  VALIDATION_FAILED: "Validation failed for invoice items.",
  // One text per cause (V2-07 07-04a F-8; the database raises one reason per cause).
  ...INVOICE_ITEM_REASON_MESSAGES,
  AMOUNT_INVALID: "Payment amount must be greater than zero.",
  METHOD_INVALID: "Invalid payment details.",
  OVERPAYMENT: "The amount is more than the balance due on this invoice.",
  INVOICE_NOT_PAYABLE: "This invoice is already settled or cancelled.",
  LOCK_TIMEOUT: "This bill is being updated. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  CONFLICT: "The invoice changed while saving. Refresh and try again.",
  INTERNAL: "Failed to create invoice.",
} as const satisfies DbErrorMessages;

const createInvoiceRpcResultSchema = z.object({
  invoice_id: z.string().uuid(),
  invoice_number: z.string(),
  status: z.enum(["draft", "issued", "paid", "cancelled"]),
  total_amount: z.number(),
  existing: z.boolean(),
  replayed: z.boolean().optional(),
});

/** What `collect_payment` returns to the checkout (V2-07 07-02). */
export interface CollectPaymentValue {
  invoiceId: string;
  invoiceNumber: string;
  /** True when this command created the visit's invoice (false: it paid the invoice that already existed). */
  invoiceCreated: boolean;
  paymentId: string;
  status: "paid" | "issued";
  totalPaid: number;
  balanceDue: number;
  /** True when this client_request_id was already collected: nothing new was written. */
  replayed: boolean;
  /** The invoice's new `row_version` (09E-07). */
  invoiceVersion?: number;
}

/** What `create_invoice` returns to the checkout (V2-07 07-04a F-10). */
export interface CreateInvoiceValue {
  invoiceId: string;
  invoiceNumber: string;
  status: "draft" | "issued" | "paid" | "cancelled";
  totalAmount: number;
  /** True when the visit already had a live invoice (AR3-N2): that invoice is returned and nothing was created. */
  existing: boolean;
  /** True when this client_request_id was already created: nothing new was written. */
  replayed: boolean;
}

/**
 * Creates the visit's invoice as one atomic command (V2-07 07-02): `public.create_invoice` locks the visit, takes the
 * number from the clinic's FY counter (`INV/2026-27/00001`, migration 000140; a failure fails the command), inserts the invoice and its
 * items and writes the `invoice.create` audit row in one transaction. A visit that already has a live invoice gets it
 * back (`existing: true`, nothing written, AR3-N2).
 *
 * Returns a `Result` with the real `AppError` code and reason (V2-07 07-04a F-10), as `collectPayment` does: the client's
 * `useCommand` needs the code (a locked clinic, a signed-out session, an id mismatch) and the reason.
 */
export async function createInvoice(ctx: ServiceContext, input: CreateInvoiceInput): Promise<Result<CreateInvoiceValue>> {
  const parseResult = createInvoiceSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return {
      ok: false,
      error: appError("VALIDATION_FAILED", { message: "Validation failed for invoice items.", fieldErrors }),
    };
  }

  try {
    const data = parseResult.data;

    // PO-3: a collector, or the visit's own doctor (Sign & Bill). Checked before any write; the command repeats it.
    if (!(await mayInvoiceVisit(ctx, data.visit_id))) {
      return { ok: false, error: appError("FORBIDDEN", { message: BILLING_COLLECT_FORBIDDEN_MESSAGE }) };
    }

    // The visit must be this clinic's visit of the invoiced patient (P0-13: the FKs and RLS do not check this).
    if (!(await visitInTenant(ctx, data.visit_id, data.patient_id))) {
      return { ok: false, error: appError("NOT_FOUND", { message: INVOICE_COMMAND_MESSAGES.NOT_FOUND }) };
    }

    const outcome = await callCommand(
      ctx,
      "create_invoice",
      {
        p_visit_id: data.visit_id,
        p_items: invoiceItemsPayload(data.items),
        p_discount: toRupeeParam(data.discount),
        p_tax: toRupeeParam(data.tax),
        p_client_request_id: data.client_request_id,
      },
      createInvoiceRpcResultSchema,
      INVOICE_COMMAND_MESSAGES,
      { event: "billing.invoice_create.failed" }
    );
    if (!outcome.ok) return outcome;
    const v = outcome.value;
    return {
      ok: true,
      value: {
        invoiceId: v.invoice_id,
        invoiceNumber: v.invoice_number,
        status: v.status,
        totalAmount: v.total_amount,
        existing: v.existing,
        replayed: v.replayed ?? false,
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: appError("INTERNAL", {
        message: clientErrorMessage(err, "Failed to create visit invoice.", "billing.invoice_create.failed"),
      }),
    };
  }
}

/**
 * {@link createInvoice} with the invoice and its items loaded for the caller (the legacy `{ success }` shape, kept for the
 * services and tests that read the created rows).
 */
export async function createVisitInvoice(
  ctx: ServiceContext,
  input: CreateInvoiceInput
): Promise<CreateInvoiceResult> {
  const created = await createInvoice(ctx, input);
  if (!created.ok) {
    return {
      success: false,
      error: created.error.message,
      ...(created.error.fieldErrors ? { fieldErrors: created.error.fieldErrors } : {}),
    };
  }
  try {
    const loaded = await invoiceWithItems(ctx, created.value.invoiceId);
    if (!loaded) return { success: false, error: INVOICE_COMMAND_MESSAGES.INTERNAL };
    return {
      success: true,
      invoice: loaded.invoice,
      items: loaded.items,
      ...(created.value.existing ? { existing: true } : {}),
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to create visit invoice.", "billing.invoice_create.failed"),
    };
  }
}

/** The item list the command takes: the schema's fields only, prices at 2 decimals (the old service rounded the same way). */
function invoiceItemsPayload(items: CreateInvoiceInput["items"]) {
  return items.map((item) => ({
    item_type: item.item_type,
    description: item.description,
    unit_price: toRupeeParam(item.unit_price),
    quantity: Number(item.quantity) || 1,
  }));
}

/**
 * Desk checkout as one atomic command (V2-07 07-02, R-7): `public.collect_payment` gets or creates the visit's invoice
 * (from `items`, only when there is none) and records the payment in one transaction. Nothing persists unless both
 * succeed; the same `client_request_id` replays the first result.
 */
export async function collectPayment(
  ctx: ServiceContext,
  input: CollectPaymentInput
): Promise<Result<CollectPaymentValue>> {
  const parseResult = collectPaymentSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return {
      ok: false,
      error: appError("VALIDATION_FAILED", {
        message: parseResult.error.issues[0]?.message || "Invalid payment details.",
        fieldErrors,
      }),
    };
  }
  // PO-3: only collectors (owner, admin, receptionist) collect; the command repeats it.
  if (!hasPerm(ctx.role, "billing:collect")) {
    return { ok: false, error: appError("FORBIDDEN", { message: BILLING_COLLECT_FORBIDDEN_MESSAGE }) };
  }
  const data = parseResult.data;

  // The visit must be this clinic's visit of the invoiced patient (P0-13), as for the invoice command.
  if (!(await visitInTenant(ctx, data.visit_id, data.patient_id))) {
    return { ok: false, error: appError("NOT_FOUND", { message: INVOICE_COMMAND_MESSAGES.NOT_FOUND }) };
  }

  const outcome = await callCommand(
    ctx,
    "collect_payment",
    {
      p_visit_id: data.visit_id,
      p_items: invoiceItemsPayload(data.items),
      p_amount: toRupeeParam(data.amount),
      p_method: data.payment_method,
      p_reference: data.reference_number ?? "",
      p_notes: data.notes ?? "",
      p_discount: toRupeeParam(data.discount),
      p_tax: toRupeeParam(data.tax),
      p_client_request_id: data.client_request_id,
      ...versionArg("p_expected_invoice_version", data.expected_invoice_version),
    },
    collectPaymentRpcResultSchema,
    { ...INVOICE_COMMAND_MESSAGES, INTERNAL: RECORD_PAYMENT_MESSAGES.INTERNAL },
    { event: "billing.collect_payment.failed" }
  );
  if (!outcome.ok) return outcome;

  const v = outcome.value;
  return {
    ok: true,
    value: {
      invoiceId: v.invoice_id,
      invoiceNumber: v.invoice_number,
      invoiceCreated: v.invoice_created,
      paymentId: v.payment_id,
      status: v.invoice_status === "paid" ? "paid" : "issued",
      totalPaid: v.paid_total,
      balanceDue: v.balance_due,
      replayed: v.replayed ?? false,
      invoiceVersion: v.invoice_version,
    },
  };
}

export type RecordPaymentResult =
  | {
      success: true;
      paymentId: string;
      status: "paid" | "issued";
      totalPaid: number;
      balanceDue: number;
      /** True when this command id was already recorded: nothing new was written (V2-03 03-07). */
      replayed?: boolean;
      /** The invoice's new `row_version` (09E-07). */
      invoiceVersion?: number;
    }
  | { success: false; error: string };

/** The `record_payment` RPC result (000027), parsed at the service boundary (TARGET §3.2). */
export const recordPaymentRpcResultSchema = z.object({
  payment_id: z.string().uuid(),
  invoice_status: z.enum(["draft", "issued", "paid", "cancelled"]),
  paid_total: z.number(),
  total_amount: z.number(),
  balance_due: z.number(),
  replayed: z.boolean(),
  /** 09E-07: the invoice's `row_version` after the call (absent from the system path of an older database). */
  invoice_version: z.number().int().optional(),
});
export type RecordPaymentRpcResult = z.infer<typeof recordPaymentRpcResultSchema>;

const collectPaymentRpcResultSchema = recordPaymentRpcResultSchema.omit({ replayed: true }).extend({
  invoice_id: z.string().uuid(),
  invoice_number: z.string(),
  invoice_created: z.boolean(),
  replayed: z.boolean().optional(),
  /** 09E-07: the invoice's new `row_version` (absent in a result stored before migration 000126). */
  invoice_version: z.number().int().optional(),
});

/** Fixed, data-free texts by reason or code. The driver message never reaches the caller (AD-7). */
export const RECORD_PAYMENT_MESSAGES = {
  NOT_FOUND: "Invoice not found or unauthorized.",
  FORBIDDEN: "You do not have permission to perform this action.",
  OVERPAYMENT: "The amount is more than the balance due on this invoice.",
  INVOICE_NOT_PAYABLE: "This invoice is already settled or cancelled.",
  LOCK_TIMEOUT: "This invoice is being updated. Try again.",
  IDEMPOTENCY_MISMATCH: "This payment was already submitted with different details. Refresh and try again.",
  VALIDATION_FAILED: "Invalid payment details.",
  CONFLICT: "The invoice changed while saving. Refresh and try again.",
  INTERNAL: "Failed to record payment.",
} as const satisfies DbErrorMessages;

/** The closed system actors `record_payment` accepts on the system path (000027, `payments_recorded_by_system_known`). */
export const PAYMENT_SYSTEM_ACTORS = ["system:payment_webhook"] as const;
export type PaymentSystemActor = (typeof PAYMENT_SYSTEM_ACTORS)[number];

export interface RecordPaymentRpcArgs {
  /** The active tenant from the server-side context (ServiceContext.tenantId), never request input. */
  tenantId: string;
  invoiceId: string;
  amount: number;
  method: "cash" | "upi" | "card";
  reference?: string | null;
  notes?: string | null;
  commandId: string;
  /** The invoice's `row_version` the screen shows (09E-07, R-19); absent: nothing is compared (the system path). */
  expectedInvoiceVersion?: number | null;
}

/**
 * Calls `public.record_payment` on `db` and maps the outcome: the parsed result, or an {@link AppError} with a fixed
 * message. On the user path `db` is the caller's JWT client (RLS, `auth.uid()` actor); the system path
 * (`features/billing/system.ts`) passes the service-role client and a closed `systemActor`. An unexpected failure or
 * an unparseable result is logged with its tag only and becomes `INTERNAL`.
 */
export async function callRecordPayment(
  db: ServiceContext["db"],
  args: RecordPaymentRpcArgs,
  failure: { event: "billing.payment_record.failed" | "billing.payment_record_system.failed" },
  systemActor?: PaymentSystemActor
): Promise<Result<RecordPaymentRpcResult>> {
  const { data, error } = await db.rpc("record_payment", {
    p_tenant_id: args.tenantId,
    p_invoice_id: args.invoiceId,
    p_amount: args.amount,
    p_method: args.method,
    p_reference: args.reference ?? "",
    p_notes: args.notes ?? undefined,
    p_command_id: args.commandId,
    p_system_actor: systemActor,
    ...versionArg("p_expected_invoice_version", args.expectedInvoiceVersion),
  });

  if (error) {
    const mapped = mapDbError(error, { ROW_CHANGED: ROW_CHANGED_MESSAGE, ...RECORD_PAYMENT_MESSAGES });
    if (mapped.code === "INTERNAL") {
      log.error({ event: failure.event, code: errorTag(error), requestId: await getRequestId(), tenantId: args.tenantId });
    }
    return { ok: false, error: mapped };
  }

  const parsed = recordPaymentRpcResultSchema.safeParse(data);
  if (!parsed.success) {
    log.error({ event: failure.event, code: "result_shape", requestId: await getRequestId(), tenantId: args.tenantId });
    return { ok: false, error: appError("INTERNAL", { message: RECORD_PAYMENT_MESSAGES.INTERNAL }) };
  }
  return { ok: true, value: parsed.data };
}

/**
 * A rupee amount rounded to the paisa for a `numeric(10,2)` command parameter (the RPCs refuse more than 2 decimals):
 * `lib/money` converts through integer paise, exact for every 2-decimal value (V2-10 10-01, D-1).
 */
function toRupeeParam(amount: number): number {
  return roundRupees(amount);
}

/**
 * Records a payment as one atomic command (V2-03 03-07, D1): `public.record_payment` locks the invoice, enforces the
 * invariants (no overpayment, payable status), inserts the payment, moves the invoice to `paid` when settled and
 * writes the audit row and the `payment.recorded` outbox rows in the same transaction, under the caller's RLS.
 */
export async function recordPayment(
  ctx: ServiceContext,
  input: RecordPaymentInput
): Promise<RecordPaymentResult> {
  const parseResult = recordPaymentSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.issues[0]?.message || "Invalid payment details.",
    };
  }

  // PO-3: only collectors (owner, admin, receptionist) record payments; the payments INSERT policy repeats it (000056).
  if (!hasPerm(ctx.role, "billing:collect")) {
    return { success: false, error: RECORD_PAYMENT_MESSAGES.FORBIDDEN };
  }

  const data = parseResult.data;
  let outcome: Result<RecordPaymentRpcResult>;
  try {
    outcome = await callRecordPayment(
      ctx.db,
      {
        tenantId: ctx.tenantId,
        invoiceId: data.invoice_id,
        amount: toRupeeParam(data.amount),
        method: data.payment_method,
        reference: data.reference_number,
        notes: data.notes,
        // A caller without a per-attempt id still gets a unique command; only the id the client resends replays.
        commandId: data.commandId ?? randomUUID(),
        expectedInvoiceVersion: data.expected_invoice_version,
      },
      { event: "billing.payment_record.failed" }
    );
  } catch (err: unknown) {
    log.error({ event: "billing.payment_record.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { success: false, error: RECORD_PAYMENT_MESSAGES.INTERNAL };
  }

  if (!outcome.ok) return { success: false, error: outcome.error.message };

  const result = outcome.value;
  return {
    success: true,
    paymentId: result.payment_id,
    status: result.invoice_status === "paid" ? "paid" : "issued",
    totalPaid: result.paid_total,
    balanceDue: result.balance_due,
    replayed: result.replayed,
    invoiceVersion: result.invoice_version,
  };
}

/** The fixed text when the clinic's fee could not be read for a new bill (PR 2 review N-3). */
export const CLINIC_FEE_UNAVAILABLE = "The clinic's consultation fee could not be loaded, so the bill was not started. Try again.";

export type GetVisitBillingResult =
  | {
      success: true;
      invoice: Invoice | null;
      items: InvoiceItem[];
      payments: Payment[];
      totalPaid: number;
      balanceDue: number;
      /**
       * V2-09e 09E-13 (R-13: fees are read with the bill, never held): the clinic's current default consultation fee, read from the database with a visit
       * that has no invoice yet (the new bill's starting fee); null when the visit has an invoice or the clinic has none set.
       */
      clinicFee?: number | null;
    }
  | { success: false; error: string };

export async function getVisitBillingDetails(
  ctx: ServiceContext,
  visitId: string
): Promise<GetVisitBillingResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:view");
    const session = ctx;

    // Fetch invoice for visit (ordered by created_at DESC with limit 1 so multiple invoices never cause PGRST116)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invoices, error: invErr } = await (
      supabase.from("invoices") as any
    )
      .select("*, invoice_items(*), payments(*)")
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (invErr) {
      log.error({ event: "billing.visit_billing_load.failed", code: errorTag(invErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to load billing details." };
    }

    const invoice = invoices && invoices.length > 0 ? invoices[0] : null;

    if (!invoice) {
      // V2-09e 09E-13 (R-13): the fee a new bill starts from is read here, with the bill, every time (never from the session bootstrap or another copy).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tenant, error: feeErr } = await (supabase.from("tenants") as any)
        .select("default_consultation_fee")
        .eq("id", session.tenantId)
        .maybeSingle();
      if (feeErr) {
        // PR 2 review N-3: a bill never starts from a made-up amount. Without the clinic's fee the drawer says so and offers Try again (no ₹500 default).
        log.error({ event: "billing.clinic_fee_load.failed", code: errorTag(feeErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
        return { success: false, error: CLINIC_FEE_UNAVAILABLE };
      }
      const fee = tenant?.default_consultation_fee;
      return {
        success: true,
        invoice: null,
        items: [],
        payments: [],
        totalPaid: 0,
        balanceDue: 0,
        clinicFee: fee === null || fee === undefined || !Number.isFinite(Number(fee)) ? null : Number(fee),
      };
    }

    const items: InvoiceItem[] = invoice.invoice_items || [];
    const payments: Payment[] = invoice.payments || [];

    const totalPaid =
      Math.round(
        (payments.reduce((acc, curr) => acc + Number(curr.amount), 0) +
          Number.EPSILON) *
          100
      ) / 100;
    const balanceDue = Math.max(
      0,
      Math.round(
        (Number(invoice.total_amount) - totalPaid + Number.EPSILON) * 100
      ) / 100
    );

    return {
      success: true,
      invoice: {
        id: invoice.id,
        tenant_id: invoice.tenant_id,
        visit_id: invoice.visit_id,
        patient_id: invoice.patient_id,
        invoice_number: invoice.invoice_number,
        subtotal: Number(invoice.subtotal),
        discount: Number(invoice.discount),
        tax: Number(invoice.tax),
        total_amount: Number(invoice.total_amount),
        status: invoice.status,
        // The version the drawer shows (09E-07, R-19): the payment sends it back.
        row_version: typeof invoice.row_version === "number" ? invoice.row_version : undefined,
        created_at: invoice.created_at,
        updated_at: invoice.updated_at,
      },
      items,
      payments,
      totalPaid,
      balanceDue,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to load billing.", "billing.load.failed"),
    };
  }
}

export async function addInvoiceItem(
  ctx: ServiceContext,
  input: AddInvoiceItemInput
): Promise<{ success: boolean; item?: InvoiceItem; error?: string }> {
  const parseResult = addInvoiceItemSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.issues[0]?.message || "Invalid item details.",
    };
  }

  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "billing:collect");
    const session = ctx;
    const data = parseResult.data;

    // 1. Fetch invoice to ensure tenant ownership
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invoice, error: invErr } = await (
      supabase.from("invoices") as any
    )
      .select("id, tenant_id, discount, tax, subtotal, total_amount, status")
      .eq("id", data.invoice_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (invErr || !invoice) {
      return { success: false, error: "Invoice not found or access denied." };
    }

    const qty = data.quantity > 0 ? data.quantity : 1;
    const unitPrice = Math.max(0, Number(data.unit_price) || 0);
    const totalPrice =
      Math.round((unitPrice * qty + Number.EPSILON) * 100) / 100;

    // 2. Insert into invoice_items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newItem, error: itemErr } = await (
      supabase.from("invoice_items") as any
    )
      .insert({
        tenant_id: session.tenantId,
        invoice_id: data.invoice_id,
        item_type: data.item_type,
        description: data.description.trim(),
        unit_price: unitPrice,
        quantity: qty,
        total_price: totalPrice,
      })
      .select("*")
      .single();

    if (itemErr || !newItem) {
      const refused = invoiceItemRefusal(itemErr);
      if (refused) return { success: false, error: refused };
      log.error({ event: "billing.invoice_item_add.failed", code: errorTag(itemErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to add charge to invoice." };
    }

    // 3. The invoice's subtotal, total and paid/issued status follow its items in the database
    // (`invoice_items_sync_invoice`, V2-05 05-11b): members hold no UPDATE on invoices.

    await recordAudit(ctx, {
      action: "invoice.item_add",
      entityType: "invoice",
      entityId: data.invoice_id,
      metadata: {
        item_id: newItem.id,
        description: data.description,
        amount: totalPrice,
      },
    });

    return { success: true, item: newItem };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to add invoice item.", "billing.item_add.failed"),
    };
  }
}

export async function deleteInvoiceItem(
  ctx: ServiceContext,
  itemId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "billing:collect");
    const session = ctx;

    // 1. Fetch item to find invoice_id and verify tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: item, error: itemErr } = await (
      supabase.from("invoice_items") as any
    )
      .select("id, invoice_id, tenant_id, total_price")
      .eq("id", itemId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (itemErr || !item) {
      return { success: false, error: "Invoice item not found." };
    }

    // 2. Delete item
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: deleted, error: delErr } = await (supabase.from("invoice_items") as any)
      .delete()
      .eq("id", itemId)
      .eq("tenant_id", session.tenantId)
      .select("id");

    if (delErr) {
      return { success: false, error: invoiceItemRefusal(delErr) ?? "Failed to delete item." };
    }
    // RLS may filter the delete to 0 rows (V2-05 05-04; the DELETE policy needs billing:collect): refuse the no-op
    // before the totals are recomputed or an audit row is written.
    const refused = unaffectedRowsError(deleted);
    if (refused) {
      log.warn({ event: "billing.item_remove.refused", reason: "row_not_affected", requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: refused.message };
    }

    // 3. The invoice's totals and status follow in the database (`invoice_items_sync_invoice`, V2-05 05-11b).

    await recordAudit(ctx, {
      action: "invoice.item_remove",
      entityType: "invoice",
      entityId: item.invoice_id,
      metadata: {
        item_id: itemId,
        amount: item.total_price,
      },
    });

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to remove invoice item.", "billing.item_remove.failed"),
    };
  }
}

export type CompleteAndBillResult =
  | {
      success: true;
      visitId: string;
      invoiceId: string;
      pdfStoragePath: string | null;
      paymentRecorded: boolean;
      whatsAppSent?: boolean;
      whatsAppError?: string | null;
      rxShareUrl?: string;
      invoiceShareUrl?: string;
      /** The invoice's number (the existing invoice's number when `alreadyBilled`). */
      invoiceNumber?: string | null;
      /**
       * AR3-N2: the visit already had a live invoice (made at the desk before the sign-off); `invoiceId` /
       * `invoiceNumber` are that invoice and no payment, receipt or message followed. The modal shows "already billed",
       * never "payment pending".
       */
      alreadyBilled?: boolean;
      /** True when this client_request_id was already completed: nothing new was written (R-4: no receipt, no message). */
      replayed?: boolean;
    }
  | { success: false; error: string; code?: AppErrorCode; reason?: string };

/** What a successful Sign & Bill gives the modal (the success branch of {@link CompleteAndBillResult}). */
export type CompleteAndBillValue = Omit<Extract<CompleteAndBillResult, { success: true }>, "success">;

export const SIGN_AND_BILL_ALREADY_DONE_MESSAGE =
  "This consultation is already signed and billed. Open the visit at checkout to view the invoice.";

/** Fixed, data-free texts by reason or code for `complete_and_bill` (V2-07 07-03). The driver message never reaches the caller. */
export const COMPLETE_AND_BILL_MESSAGES = {
  NOT_FOUND: "Visit not found or access denied.",
  FORBIDDEN: "You do not have permission to sign and bill this consultation.",
  VALIDATION_FAILED: "Validation failed for invoice items.",
  ALREADY_SIGNED: "This consultation is already signed.",
  ALREADY_BILLED: SIGN_AND_BILL_ALREADY_DONE_MESSAGE,
  SIGN_CONTENT_REQUIRED: "Cannot sign off consultation without recording at least one diagnosis or clinical note.",
  VISIT_NOT_SIGNABLE: "Check the patient in before signing this consultation.",
  ...INVOICE_ITEM_REASON_MESSAGES,
  AMOUNT_INVALID: "Payment amount must be greater than zero.",
  METHOD_INVALID: "Invalid payment details.",
  OVERPAYMENT: "The amount is more than the balance due on this invoice.",
  INVOICE_NOT_PAYABLE: "This invoice is already settled or cancelled.",
  LOCK_TIMEOUT: "This consultation is being updated. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  CONFLICT: "The consultation changed while saving. Refresh and try again.",
  INTERNAL: "Failed to complete and bill consultation.",
} as const satisfies DbErrorMessages;

const completeAndBillRpcResultSchema = z.object({
  visit_id: z.string().uuid(),
  signed_at: z.string(),
  sealed_prescriptions: z.number().int(),
  resumed: z.boolean(),
  invoice_id: z.string().uuid(),
  invoice_number: z.string(),
  total_amount: z.number(),
  already_billed: z.boolean(),
  payment_recorded: z.boolean(),
  invoice_status: z.string(),
  paid_total: z.number(),
  replayed: z.boolean(),
});

/**
 * Solo Doctor Workflow: signs the consultation and bills the visit as ONE atomic command (`public.complete_and_bill`,
 * V2-07 07-03, R-7): the sign-off (or the resume of a visit this user signed that has no invoice yet, IR2-L1), the
 * invoice and, when `payment_collected`, the payment commit together or not at all. Nothing is signed when the invoice or
 * the payment fails, and a failure is reported as a failure (never as a success with `paymentRecorded: false`). The
 * receipt PDF, the prescription archive and the consolidated WhatsApp message run AFTER the commit (R-4), skipped on a
 * replay of the same `client_request_id`.
 *
 * Permissions (also checked in the command): `consultations:edit`; `billing:collect` when the payment is collected,
 * refused before anything is signed (PO-3); the invoice needs `billing:collect` or the visit's own doctor.
 */
export async function completeAndBillConsultation(
  ctx: ServiceContext,
  input: CompleteAndBillInput
): Promise<CompleteAndBillResult> {
  const parseResult = completeAndBillSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.issues[0]?.message || "Invalid input",
      code: "VALIDATION_FAILED",
    };
  }

  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "consultations:edit");
    const session = ctx;
    const data = parseResult.data;

    // 0. PO-3: collecting at the doctor's desk needs billing:collect (the owner of a solo clinic holds it). A doctor
    // without it is refused BEFORE anything is signed or billed; the modal offers only "route to reception" to them.
    if (data.payment_collected && !hasPerm(ctx.role, "billing:collect")) {
      return { success: false, error: BILLING_COLLECT_FORBIDDEN_MESSAGE, code: "FORBIDDEN" };
    }

    // The visit must be this clinic's visit of the billed patient (P0-13: the FKs and RLS do not check this).
    if (!(await visitInTenant(ctx, data.visit_id, data.patient_id))) {
      return { success: false, error: COMPLETE_AND_BILL_MESSAGES.NOT_FOUND, code: "NOT_FOUND" };
    }

    // 1. One command: sign (or resume), invoice, optional payment.
    const items = [
      {
        item_type: "consultation" as const,
        description: "OPD Consultation Fee",
        unit_price: Number(data.consultation_fee),
        quantity: 1,
      },
      ...data.additional_items,
    ];
    const outcome = await callCommand(
      ctx,
      "complete_and_bill",
      {
        p_visit_id: data.visit_id,
        p_items: invoiceItemsPayload(items),
        p_discount: toRupeeParam(data.discount),
        p_tax: 0,
        p_payment: data.payment_collected
          ? { method: data.payment_method, reference: data.reference_number ?? null }
          : null,
        p_client_request_id: data.client_request_id,
        ...versionArg("p_expected_version", data.expected_version),
      },
      completeAndBillRpcResultSchema,
      COMPLETE_AND_BILL_MESSAGES,
      { event: "billing.complete_and_bill.failed" }
    );
    if (!outcome.ok) {
      return { success: false, error: outcome.error.message, code: outcome.error.code, reason: outcome.error.reason };
    }
    const done = outcome.value;

    // 2. After the commit (R-4), best-effort, and idempotent (V2-07 07-04a F-7, G-2): a replay means the first call's
    // response may have been lost after the commit, so the steps that follow the commit must still happen once. The
    // prescription PDF is rendered when it is not archived yet, the receipt when it is not in storage, and the one
    // consolidated WhatsApp message carries a per-visit dedupe key, so a repeat queues nothing new.
    // The archive is idempotent (V2-09a R-12: a header with its hash is left alone), so a first call and a replay take the same step.
    await archiveSealedPrescriptionPdf(ctx, data.visit_id);

    // AR3-N2: the visit already had its invoice (made at the desk before the sign-off): return it and stop (no payment,
    // receipt or WhatsApp message followed in this command, so none is made up now either).
    if (done.already_billed) {
      return {
        success: true,
        visitId: data.visit_id,
        invoiceId: done.invoice_id,
        invoiceNumber: done.invoice_number ?? null,
        pdfStoragePath: null,
        paymentRecorded: done.payment_recorded,
        alreadyBilled: true,
        replayed: done.replayed,
      };
    }

    // 2b. Generate and archive Receipt PDF to storage immediately (a replay: only when it is missing)
    try {
      if (!done.replayed || !(await receiptArchived(ctx, done.invoice_id))) {
        await compileAndArchiveReceiptPdf(ctx, done.invoice_id);
      }
    } catch (pdfErr) {
      log.warn({ event: "billing.receipt_pdf_generate.failed", code: errorTag(pdfErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
    }

    // 3. Retrieve signed PDF path if generated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rxRows } = await (supabase.from("prescriptions") as any)
      .select("pdf_storage_path")
      .eq("visit_id", data.visit_id)
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false })
      .limit(1);
    const rxRow = rxRows && rxRows.length > 0 ? rxRows[0] : null;

    // 4. One consolidated WhatsApp message, ONLY when the doctor chose it on the finish review (V2-09c 09C-05, CTO ruling Q-8: PO-23(h) accepts WhatsApp for
    // reminders and billing notices, so the prescription's delivery is never a default). It carries both links in a single message to avoid double message costs.
    let whatsAppSent = false;
    let whatsAppError: string | null = null;
    let rxShareUrl: string | undefined;
    let invoiceShareUrl: string | undefined;

    if (data.send_whatsapp === true) {
      try {
        const waRes = await sendConsolidatedConsultationWhatsApp(ctx, {
          visitId: data.visit_id,
          invoiceId: done.invoice_id,
          patientId: data.patient_id,
          // One consolidated message per visit, whatever the retries do (V2-07 07-04a F-7, G-2). A manual resend
          // from the visit register carries no key and is never deduplicated.
          dedupeKey: `consultation_documents:${data.visit_id}`,
        });
        whatsAppSent = waRes.success;
        whatsAppError = waRes.error || null;
        rxShareUrl = waRes.rxShareUrl;
        invoiceShareUrl = waRes.invoiceShareUrl;
      } catch (waErr) {
        log.warn({ event: "billing.checkout_whatsapp.failed", code: errorTag(waErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
        // 03-13c (M-ERRMSG): the dispatch error can carry the recipient's phone; the client gets fixed text only.
        whatsAppError = "Failed to dispatch automated WhatsApp";
      }
    }

    return {
      success: true,
      visitId: data.visit_id,
      invoiceId: done.invoice_id,
      invoiceNumber: done.invoice_number ?? null,
      pdfStoragePath: rxRow?.pdf_storage_path || null,
      paymentRecorded: done.payment_recorded,
      whatsAppSent,
      whatsAppError,
      rxShareUrl,
      invoiceShareUrl,
      replayed: done.replayed,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to complete and bill consultation.", "billing.checkout.failed"),
    };
  }
}

export type GetReceiptPdfResult =
  | { success: true; signedUrl: string; invoiceNumber: string }
  | { success: false; error: string };

/**
 * Generates or retrieves signed PDF URL for an invoice payment receipt.
 */
export async function getInvoiceReceiptPdfSignedUrl(
  ctx: ServiceContext,
  invoiceId: string
): Promise<GetReceiptPdfResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:view");
    const session = ctx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invoice, error: invoiceErr } = await (
      supabase.from("invoices") as any
    )
      .select("*")
      .eq("id", invoiceId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (invoiceErr || !invoice) {
      return { success: false, error: "Invoice not found or access denied." };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tenant } = await (supabase.from("tenants") as any)
      .select("id, name, address, phone, registration_number, logo_url")
      .eq("id", session.tenantId)
      .single();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: patient } = await (supabase.from("patients") as any)
      .select("id, full_name, age, sex, phone, address")
      .eq("id", invoice.patient_id)
      .eq("tenant_id", session.tenantId)
      .single();

    let doctorInfo: {
      name: string;
      qualifications?: string | null;
      registration_no?: string | null;
    } | null = null;
    if (invoice.visit_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: visit } = await (supabase.from("visits") as any)
        .select("doctor_id")
        .eq("id", invoice.visit_id)
        .eq("tenant_id", session.tenantId)
        .maybeSingle();

      if (visit?.doctor_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: doctorMember } = await (
          supabase.from("memberships") as any
        )
          .select("qualifications, medical_council_reg_no")
          .eq("tenant_id", session.tenantId)
          .eq("user_id", visit.doctor_id)
          .maybeSingle();

        doctorInfo = {
          name: "Doctor",
          qualifications: doctorMember?.qualifications || null,
          registration_no: doctorMember?.medical_council_reg_no || null,
        };
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: items } = await (supabase.from("invoice_items") as any)
      .select("*")
      .eq("invoice_id", invoiceId)
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: payments } = await (supabase.from("payments") as any)
      .select("*")
      .eq("invoice_id", invoiceId)
      .eq("tenant_id", session.tenantId)
      .order("recorded_at", { ascending: true });

    const totalPaid =
      Math.round(
        ((payments || []).reduce(
          (acc: number, curr: { amount: number }) => acc + Number(curr.amount),
          0
        ) +
          Number.EPSILON) *
          100
      ) / 100;

    const totalAmount = Number(invoice.total_amount);
    const balanceDue = Math.max(
      0,
      Math.round((totalAmount - totalPaid + Number.EPSILON) * 100) / 100
    );

    const { signedUrl } = await generateAndArchiveReceiptPdf(ctx, {
      tenant_id: session.tenantId,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      receipt_number: `REC-${invoice.invoice_number}`,
      date: invoice.created_at,
      clinic: {
        name: tenant?.name || "Clinic",
        address: tenant?.address || null,
        phone: tenant?.phone || null,
        registration_number: tenant?.registration_number || null,
        logo_url: tenant?.logo_url || null,
      },
      patient: {
        full_name: patient?.full_name || "Patient",
        age: patient?.age || null,
        sex: patient?.sex || null,
        phone: patient?.phone || null,
        uhid: patient?.id ? patient.id.slice(0, 8).toUpperCase() : null,
        address: typeof patient?.address === "string" ? patient.address : null,
      },
      doctor: doctorInfo,
      items: (items || []).map(
        (it: {
          id: string;
          description: string;
          item_type: string;
          unit_price: number;
          quantity: number;
          total_price: number;
        }) => ({
          id: it.id,
          description: it.description,
          item_type: it.item_type,
          unit_price: Number(it.unit_price),
          quantity: Number(it.quantity),
          total_price: Number(it.total_price),
        })
      ),
      subtotal: Number(invoice.subtotal),
      discount: Number(invoice.discount),
      tax: Number(invoice.tax),
      total_amount: totalAmount,
      payments: (payments || []).map(
        (p: {
          id: string;
          amount: number;
          payment_method: "cash" | "upi" | "card";
          reference_number?: string | null;
          recorded_at: string;
        }) => ({
          id: p.id,
          amount: Number(p.amount),
          payment_method: p.payment_method,
          reference_number: p.reference_number || null,
          recorded_at: p.recorded_at,
        })
      ),
      total_paid: totalPaid,
      balance_due: balanceDue,
      status: invoice.status,
    });

    return {
      success: true,
      signedUrl,
      invoiceNumber: invoice.invoice_number,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to load receipt PDF.", "billing.receipt_pdf.failed"),
    };
  }
}

/**
 * Shares an invoice/payment receipt via WhatsApp with a 7-day secure tokenized link (/r/[token]).
 * Enqueues Event #11 (receipt_issued) outbox notification.
 */
export async function shareReceiptViaWhatsApp(
  ctx: ServiceContext,
  invoiceId: string
): Promise<{
  success: boolean;
  shareUrl?: string;
  token?: string;
  error?: string;
}> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "billing:view");
    const session = ctx;

    // 1. Fetch invoice record joined with patient and tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let { data: inv, error: invErr } = await (supabase.from("invoices") as any)
      .select(
        "*, patient:patients(id, full_name, phone), tenant:tenants(name, phone)"
      )
      .eq("id", invoiceId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (invErr || !inv) {
      // Fallback: Check if invoiceId is actually visitId
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: invByVisits } = await (supabase.from("invoices") as any)
          .select(
            "*, patient:patients(id, full_name, phone), tenant:tenants(name, phone)"
          )
          .eq("visit_id", invoiceId)
          .eq("tenant_id", session.tenantId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (invByVisits && invByVisits.length > 0) {
          inv = invByVisits[0];
          invoiceId = invByVisits[0].id;
          invErr = null;
        }
      } catch {
        // Ignore fallback lookup error
      }
    }

    if (invErr || !inv) {
      return { success: false, error: "Invoice not found." };
    }

    if (!inv.patient?.phone) {
      return {
        success: false,
        error: "Patient does not have a phone number registered.",
      };
    }

    // 2. Secure 64-character token via create_share_token (tenant from the invoice row, P0-04)
    const created = await createShareToken(supabase, "invoice", inv.id ?? invoiceId);
    if (!created) {
      return { success: false, error: "Failed to generate secure share link." };
    }
    const { token } = created;

    const baseUrl = serverEnv().NEXT_PUBLIC_APP_URL;
    const shareUrl = `${baseUrl}/r/${token}`;

    // 3. Enqueue Event #11 (receipt_issued)
    // V2-04 04-03a: queued through the enqueue RPC; the job runner sends it (per-row key, R-24).
    await enqueueMessage(ctx, {
      patientId: inv.patient_id,
      channel: "whatsapp",
      messageType: "receipt_issued",
      templateId: "receipt_issued",
      templateParams: {
        patient_name: inv.patient.full_name || "Patient",
        invoice_number: inv.invoice_number,
        amount: String(inv.total_amount),
        document_url: shareUrl,
      },
      recipientPhone: inv.patient.phone,
      // No token in metadata (AR3-N1); the link in template_params and buttons is redacted after sending.
      metadata: {
        invoice_id: invoiceId,
        buttons: [
          {
            id: "btn_view_receipt",
            text: "View Receipt",
            url: shareUrl,
          },
        ],
      },
    });

    // 4. Record audit log
    await recordAudit(ctx, {
      action: "invoice.share_whatsapp",
      entityType: "invoice",
      entityId: invoiceId,
      // no token or phone in the audit trail
    });

    return { success: true, shareUrl, token };
  } catch (err: unknown) {
    log.error({ event: "billing.receipt_share.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to share receipt."),
    };
  }
}

export interface SendConsolidatedConsultationWhatsAppInput {
  visitId: string;
  invoiceId?: string;
  patientId?: string;
  /**
   * Business dedupe key of the message (see `EnqueueMessageInput.dedupeKey`): the same key queues one message. Sign & Bill
   * passes a per-visit key so its post-commit steps can run again after a lost response without a second message; a manual
   * resend passes none.
   */
  dedupeKey?: string;
}

/**
 * Dispatches a single consolidated WhatsApp message containing BOTH prescription and invoice links,
 * avoiding double Meta template message charges for the clinic.
 */
export async function sendConsolidatedConsultationWhatsApp(
  ctx: ServiceContext,
  input: SendConsolidatedConsultationWhatsAppInput
): Promise<{
  success: boolean;
  rxShareUrl?: string;
  invoiceShareUrl?: string;
  messageId?: string;
  error?: string;
}> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "prescriptions:view");
    const session = ctx;

    // 1. Fetch visit and verify tenant access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visit, error: visitErr } = await (
      supabase.from("visits") as any
    )
      .select("id, doctor_id, patient_id")
      .eq("id", input.visitId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (visitErr || !visit) {
      return { success: false, error: "Visit not found." };
    }

    const patientId = input.patientId || visit.patient_id;
    let patientPhone = "";
    let patientName = "Patient";

    if (patientId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pt } = await (supabase.from("patients") as any)
        .select("id, full_name, phone")
        .eq("id", patientId)
        .eq("tenant_id", session.tenantId)
        .maybeSingle();

      if (pt) {
        patientPhone = pt.phone || "";
        patientName = pt.full_name || "Patient";
      }
    }

    if (!patientPhone) {
      return {
        success: false,
        error: "Patient does not have a phone number registered.",
      };
    }

    // 2. Fetch clinic tenant details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tenant } = await (supabase.from("tenants") as any)
      .select("name, phone")
      .eq("id", session.tenantId)
      .single();
    const clinicName = tenant?.name || "Clinic";

    // 3. Fetch doctor details
    let doctorName = "Dr.";
    if (visit.doctor_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: docMem } = await (supabase.from("memberships") as any)
        .select("full_name")
        .eq("user_id", visit.doctor_id)
        .eq("tenant_id", session.tenantId)
        .maybeSingle();

      if (docMem?.full_name) {
        doctorName = docMem.full_name.startsWith("Dr.")
          ? docMem.full_name
          : `Dr. ${docMem.full_name}`;
      }
    }

    // 4. Fetch prescription record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rx } = await (supabase.from("prescriptions") as any)
      .select("id")
      .eq("visit_id", input.visitId)
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 5. Fetch invoice record
    let invoiceId = input.invoiceId;
    let invoiceNumber = "";
    let totalAmount = "0";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let invQuery = (supabase.from("invoices") as any)
      .select("id, invoice_number, total_amount")
      .eq("tenant_id", session.tenantId);

    if (invoiceId) {
      invQuery = invQuery.eq("id", invoiceId);
    } else {
      invQuery = invQuery
        .eq("visit_id", input.visitId)
        .order("created_at", { ascending: false })
        .limit(1);
    }

    const { data: inv } = await invQuery.maybeSingle();
    // Only an invoice found in the active clinic is ever linked. A caller-supplied id that is not one is refused, never
    // passed to create_share_token as given (V2-05 05-01b: that function still binds "any membership" until 05-02c,
    // so a member of two clinics could otherwise mint a link to the other clinic's receipt).
    if (input.invoiceId && !inv) {
      return { success: false, error: "Invoice not found." };
    }
    invoiceId = inv?.id;
    if (inv) {
      invoiceNumber = inv.invoice_number || "";
      totalAmount = String(inv.total_amount || 0);
    }

    const baseUrl = serverEnv().NEXT_PUBLIC_APP_URL;

    // 6./7. Share tokens for the prescription and the receipt via create_share_token (P0-04). A refused token is
    // reported, not silently linked: the message must never carry a link that does not resolve.
    let rxShareUrl: string | undefined;
    let rxToken: string | undefined;
    if (rx?.id) {
      const created = await createShareToken(supabase, "prescription", rx.id);
      if (!created) {
        return { success: false, error: "Failed to generate secure share links." };
      }
      rxToken = created.token;
      rxShareUrl = `${baseUrl}/r/${rxToken}`;
    }

    let invoiceShareUrl: string | undefined;
    let invToken: string | undefined;
    if (invoiceId) {
      const created = await createShareToken(supabase, "invoice", invoiceId);
      if (!created) {
        return { success: false, error: "Failed to generate secure share links." };
      }
      invToken = created.token;
      invoiceShareUrl = `${baseUrl}/r/${invToken}`;
    }

    // 8. Build interactive buttons
    const buttons: InteractiveButton[] = [];
    if (rxShareUrl) {
      buttons.push({
        id: "btn_view_rx",
        text: "View Prescription 📄",
        url: rxShareUrl,
      });
    }
    if (invoiceShareUrl) {
      buttons.push({
        id: "btn_view_receipt",
        text: "View Receipt 🧾",
        url: invoiceShareUrl,
      });
    }

    // 9. Enqueue single consolidated WhatsApp message
    // V2-04 04-03a: queued through the enqueue RPC with the visit as its subject; the job runner sends it.
    const queueItem = await enqueueMessage(ctx, {
      patientId: patientId || null,
      visitId: input.visitId,
      channel: "whatsapp",
      messageType: "consultation_documents",
      templateId: "consultation_documents",
      templateParams: {
        patient_name: patientName,
        doctor_name: doctorName,
        clinic_name: clinicName,
        amount: totalAmount,
        invoice_number: invoiceNumber,
        prescription_url: rxShareUrl || "",
        receipt_url: invoiceShareUrl || "",
      },
      recipientPhone: patientPhone,
      metadata: {
        visit_id: input.visitId,
        prescription_id: rx?.id,
        invoice_id: invoiceId,
        // No tokens in metadata (AR3-N1); the links in template_params and buttons are redacted after sending.
        buttons,
      },
      dedupeKey: input.dedupeKey ?? null,
    });

    // 10. Record consolidated audit log (a deduplicated repeat queued nothing new, so it is not audited again)
    if (!queueItem?.deduped) {
      await recordAudit(ctx, {
        action: "consultation.share_consolidated_whatsapp",
        entityType: "visit",
        entityId: input.visitId,
        metadata: {
          prescription_id: rx?.id,
          invoice_id: invoiceId,
          queue_id: queueItem?.id,
        },
      });
    }

    return {
      success: true,
      rxShareUrl,
      invoiceShareUrl,
      messageId: queueItem?.id,
    };
  } catch (err: unknown) {
    log.error({ event: "billing.consolidated_whatsapp.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to dispatch consolidated consultation WhatsApp."),
    };
  }
}
