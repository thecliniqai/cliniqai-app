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
  recordPaymentSchema,
  RecordPaymentInput,
  completeAndBillSchema,
  CompleteAndBillInput,
  addInvoiceItemSchema,
  AddInvoiceItemInput,
} from "./schema";
import { completeAndSignConsultation } from "@/features/consultation/service";
import { createShareToken } from "@/features/sharing/tokens";
import { enqueueMessage } from "@/lib/messaging/dispatcher";
import type { InteractiveButton } from "@/lib/messaging/types";
import {
  compileAndArchiveReceiptPdf,
  generateAndArchiveReceiptPdf,
} from "./pdf/generator";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { mapDbError, type DbErrorMessages } from "@/lib/db/errors";
import { appError, type Result } from "@/lib/errors/app-error";

// Billing use-cases. Tenant and actor come only from `ctx` (ADR-0005 D1); each use-case checks the permission its
// server action checked before the move, and completeAndBillConsultation calls the consultation, invoice, payment and
// WhatsApp services with the same context so each callee's own permission check applies.

export type CreateInvoiceResult =
  | {
      success: true;
      invoice: Invoice;
      items: InvoiceItem[];
      /** True when the visit already had a live invoice (AR3-N2): that invoice is returned and nothing was created. */
      existing?: boolean;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/** The unique violation raised by invoices_one_live_per_visit (000024). */
function isLiveInvoiceConflict(err: { code?: string; message?: string } | null | undefined): boolean {
  return err?.code === "23505" && (err.message ?? "").includes("invoices_one_live_per_visit");
}

/** The visit's live (not cancelled) invoice and its items, read in the caller's tenant. */
async function liveInvoiceForVisit(
  ctx: ServiceContext,
  visitId: string
): Promise<{ invoice: Invoice; items: InvoiceItem[] } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invoice } = await (ctx.db.from("invoices") as any)
    .select("*")
    .eq("visit_id", visitId)
    .eq("tenant_id", ctx.tenantId)
    .neq("status", "cancelled")
    .maybeSingle();
  if (!invoice) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (ctx.db.from("invoice_items") as any)
    .select("*")
    .eq("invoice_id", invoice.id)
    .eq("tenant_id", ctx.tenantId);
  return { invoice: invoice as Invoice, items: (items || []) as InvoiceItem[] };
}

export async function createVisitInvoice(
  ctx: ServiceContext,
  input: CreateInvoiceInput
): Promise<CreateInvoiceResult> {
  const parseResult = createInvoiceSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return {
      success: false,
      error: "Validation failed for invoice items.",
      fieldErrors,
    };
  }

  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:edit");
    const session = ctx;
    const data = parseResult.data;

    // The visit must be this clinic's visit of the invoiced patient (P0-13: the FKs and RLS do not check this).
    if (!(await visitInTenant(ctx, data.visit_id, data.patient_id))) {
      return { success: false, error: "Visit not found or access denied." };
    }

    // 1. Calculate item totals with decimal precision (avoiding float drift)
    const processedItems = data.items.map((item) => {
      const unit =
        Math.round((Number(item.unit_price) + Number.EPSILON) * 100) / 100;
      const qty = Number(item.quantity) || 1;
      const total = Math.round((unit * qty + Number.EPSILON) * 100) / 100;
      return {
        ...item,
        unit_price: unit,
        quantity: qty,
        total_price: total,
      };
    });

    const subtotal =
      Math.round(
        (processedItems.reduce((acc, curr) => acc + curr.total_price, 0) +
          Number.EPSILON) *
          100
      ) / 100;

    const discount =
      Math.round((Number(data.discount || 0) + Number.EPSILON) * 100) / 100;
    const tax =
      Math.round((Number(data.tax || 0) + Number.EPSILON) * 100) / 100;
    const totalAmount = Math.max(
      0,
      Math.round((subtotal - discount + tax + Number.EPSILON) * 100) / 100
    );

    // 2. Generate sequential invoice number via Postgres RPC
    let invoiceNumber: string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: numData, error: rpcErr } = await (supabase as any).rpc(
        "generate_tenant_invoice_number",
        { p_tenant_id: session.tenantId }
      );
      if (rpcErr || !numData) {
        throw new Error(rpcErr?.message || "RPC returned null");
      }
      invoiceNumber = numData;
    } catch {
      const year = new Date().getFullYear();
      invoiceNumber = `INV-${year}-${Date.now().toString().slice(-5)}`;
    }

    // 3. Insert Invoice
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newInvoice, error: invoiceErr } = await (
      supabase.from("invoices") as any
    )
      .insert({
        tenant_id: session.tenantId,
        visit_id: data.visit_id,
        patient_id: data.patient_id,
        invoice_number: invoiceNumber,
        subtotal,
        discount,
        tax,
        total_amount: totalAmount,
        status: "issued",
      })
      .select("*")
      .single();

    if (invoiceErr && isLiveInvoiceConflict(invoiceErr)) {
      // AR3-N2: one live invoice per visit (000024). A retry or a concurrent request gets the existing invoice back.
      const existing = await liveInvoiceForVisit(ctx, data.visit_id);
      if (existing) {
        return { success: true, invoice: existing.invoice, items: existing.items, existing: true };
      }
      return { success: false, error: "Failed to create invoice." };
    }

    if (invoiceErr || !newInvoice) {
      log.error({ event: "billing.invoice_insert.failed", code: errorTag(invoiceErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to create invoice." };
    }

    // 4. Insert Invoice Items
    const itemsToInsert = processedItems.map((item) => ({
      tenant_id: session.tenantId,
      invoice_id: newInvoice.id,
      item_type: item.item_type,
      description: item.description,
      unit_price: item.unit_price,
      quantity: item.quantity,
      total_price: item.total_price,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: insertedItems, error: itemsErr } = await (
      supabase.from("invoice_items") as any
    )
      .insert(itemsToInsert)
      .select("*");

    if (itemsErr) {
      log.error({ event: "billing.invoice_items_insert.failed", code: errorTag(itemsErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to record invoice items." };
    }

    // 5. Record Audit
    await recordAudit(ctx, {
      action: "invoice.create",
      entityType: "invoice",
      entityId: newInvoice.id,
      metadata: {
        invoice_number: invoiceNumber,
        total_amount: totalAmount,
      },
    });

    return {
      success: true,
      invoice: newInvoice as Invoice,
      items: (insertedItems || []) as InvoiceItem[],
    };
  } catch (err: unknown) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "Failed to create visit invoice.",
    };
  }
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
});
export type RecordPaymentRpcResult = z.infer<typeof recordPaymentRpcResultSchema>;

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
  });

  if (error) {
    const mapped = mapDbError(error, RECORD_PAYMENT_MESSAGES);
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

/** Rounds to paise without float drift (the RPC refuses more than 2 decimals). */
function toPaise(amount: number): number {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
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

  if (!hasPerm(ctx.role, "appointments:edit")) {
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
        amount: toPaise(data.amount),
        method: data.payment_method,
        reference: data.reference_number,
        notes: data.notes,
        // A caller without a per-attempt id still gets a unique command; only the id the client resends replays.
        commandId: data.commandId ?? randomUUID(),
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
  };
}

export type GetVisitBillingResult =
  | {
      success: true;
      invoice: Invoice | null;
      items: InvoiceItem[];
      payments: Payment[];
      totalPaid: number;
      balanceDue: number;
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
      return {
        success: true,
        invoice: null,
        items: [],
        payments: [],
        totalPaid: 0,
        balanceDue: 0,
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
      error: err instanceof Error ? err.message : "Failed to load billing.",
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
    assertPerm(ctx.role, "appointments:edit");
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
      log.error({ event: "billing.invoice_item_add.failed", code: errorTag(itemErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to add charge to invoice." };
    }

    // 3. Recalculate invoice totals
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: allItems } = await (supabase.from("invoice_items") as any)
      .select("total_price")
      .eq("invoice_id", data.invoice_id)
      .eq("tenant_id", session.tenantId);

    const newSubtotal =
      Math.round(
        ((allItems || []).reduce(
          (acc: number, curr: { total_price: number }) =>
            acc + Number(curr.total_price),
          0
        ) +
          Number.EPSILON) *
          100
      ) / 100;

    const discount = Number(invoice.discount) || 0;
    const tax = Number(invoice.tax) || 0;
    const newTotal = Math.max(
      0,
      Math.round((newSubtotal - discount + tax + Number.EPSILON) * 100) / 100
    );

    // 4. Update payments / status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: payments } = await (supabase.from("payments") as any)
      .select("amount")
      .eq("invoice_id", data.invoice_id)
      .eq("tenant_id", session.tenantId);

    const totalPaid =
      Math.round(
        ((payments || []).reduce(
          (acc: number, curr: { amount: number }) => acc + Number(curr.amount),
          0
        ) +
          Number.EPSILON) *
          100
      ) / 100;

    const isFullyPaid = totalPaid >= newTotal && newTotal > 0;
    const newStatus = isFullyPaid ? "paid" : "issued";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("invoices") as any)
      .update({
        subtotal: newSubtotal,
        total_amount: newTotal,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.invoice_id)
      .eq("tenant_id", session.tenantId);

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
      error: err instanceof Error ? err.message : "Failed to add invoice item.",
    };
  }
}

export async function deleteInvoiceItem(
  ctx: ServiceContext,
  itemId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:edit");
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
    const { error: delErr } = await (supabase.from("invoice_items") as any)
      .delete()
      .eq("id", itemId)
      .eq("tenant_id", session.tenantId);

    if (delErr) {
      return { success: false, error: "Failed to delete item." };
    }

    // 3. Recalculate invoice totals
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invoice } = await (supabase.from("invoices") as any)
      .select("id, discount, tax")
      .eq("id", item.invoice_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (invoice) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: allItems } = await (supabase.from("invoice_items") as any)
        .select("total_price")
        .eq("invoice_id", item.invoice_id)
        .eq("tenant_id", session.tenantId);

      const newSubtotal =
        Math.round(
          ((allItems || []).reduce(
            (acc: number, curr: { total_price: number }) =>
              acc + Number(curr.total_price),
            0
          ) +
            Number.EPSILON) *
            100
        ) / 100;

      const discount = Number(invoice.discount) || 0;
      const tax = Number(invoice.tax) || 0;
      const newTotal = Math.max(
        0,
        Math.round((newSubtotal - discount + tax + Number.EPSILON) * 100) / 100
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: payments } = await (supabase.from("payments") as any)
        .select("amount")
        .eq("invoice_id", item.invoice_id)
        .eq("tenant_id", session.tenantId);

      const totalPaid =
        Math.round(
          ((payments || []).reduce(
            (acc: number, curr: { amount: number }) =>
              acc + Number(curr.amount),
            0
          ) +
            Number.EPSILON) *
            100
        ) / 100;

      const isFullyPaid = totalPaid >= newTotal && newTotal > 0;
      const newStatus = isFullyPaid ? "paid" : "issued";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("invoices") as any)
        .update({
          subtotal: newSubtotal,
          total_amount: newTotal,
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.invoice_id)
        .eq("tenant_id", session.tenantId);
    }

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
      error:
        err instanceof Error ? err.message : "Failed to remove invoice item.",
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
       * AR3-N2: another request had already billed this visit; `invoiceId` / `invoiceNumber` are that invoice and
       * nothing else ran (no payment, receipt or message). The modal shows "already billed", never "payment pending".
       */
      alreadyBilled?: boolean;
    }
  | { success: false; error: string };

export const SIGN_AND_BILL_ALREADY_DONE_MESSAGE =
  "This consultation is already signed and billed. Open the visit at checkout to view the invoice.";

/**
 * IR2-L1: where a "Sign & Bill" for `visitId` stands for the acting user.
 * - "resume": completed and signed by `ctx.userId` (an earlier Sign & Bill whose billing step failed) with no invoice;
 * - "already_billed": completed and signed by `ctx.userId` and an invoice exists;
 * - "sign": anything else (not signed yet, or signed by someone else / reopened: completeAndSignConsultation decides).
 */
async function signedVisitAwaitingInvoice(
  ctx: ServiceContext,
  visitId: string
): Promise<"resume" | "already_billed" | "sign"> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: visit } = await (ctx.db.from("visits") as any)
    .select("id, status, signed_at, signed_by")
    .eq("id", visitId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!visit || visit.status !== "completed" || !visit.signed_at || visit.signed_by !== ctx.userId) {
    return "sign";
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invoices, error } = await (ctx.db.from("invoices") as any)
    .select("id")
    .eq("visit_id", visitId)
    .eq("tenant_id", ctx.tenantId)
    .neq("status", "cancelled")
    .limit(1);
  if (error) return "sign";
  return Array.isArray(invoices) && invoices.length > 0 ? "already_billed" : "resume";
}

/**
 * Solo Doctor Workflow: Seals consultation prescription and records visit billing in one atomic step.
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
    };
  }

  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "consultations:edit");
    const session = ctx;
    const data = parseResult.data;

    // 1. Sign off and finalize consultation & prescription. IR2-L1: a retry after the sign-off committed but billing
    // failed resumes at billing: a visit already completed and signed by this same user, with no invoice yet, is not
    // re-signed (P1-23) and goes straight to step 2. Anything else that is already signed is refused as before.
    const resume = await signedVisitAwaitingInvoice(ctx, data.visit_id);
    if (resume === "already_billed") {
      return { success: false, error: SIGN_AND_BILL_ALREADY_DONE_MESSAGE };
    }
    if (resume !== "resume") {
      const signResult = await completeAndSignConsultation(ctx, data.visit_id);
      if (!signResult.success) {
        return { success: false, error: signResult.error };
      }
    }

    // 2. Create Invoice
    const items = [
      {
        item_type: "consultation" as const,
        description: "OPD Consultation Fee",
        unit_price: Number(data.consultation_fee),
        quantity: 1,
      },
      ...data.additional_items,
    ];

    const invoiceResult = await createVisitInvoice(ctx, {
      visit_id: data.visit_id,
      patient_id: data.patient_id,
      items,
      discount: data.discount,
      tax: 0,
    });

    if (!invoiceResult.success) {
      return { success: false, error: invoiceResult.error };
    }

    // AR3-N2: a concurrent or repeated Sign & Bill for this visit already created the live invoice. Return it and stop:
    // no second payment, receipt or WhatsApp message. The request that created the invoice does those.
    if (invoiceResult.existing) {
      return {
        success: true,
        visitId: data.visit_id,
        invoiceId: invoiceResult.invoice.id,
        invoiceNumber: invoiceResult.invoice.invoice_number ?? null,
        pdfStoragePath: null,
        paymentRecorded: false,
        alreadyBilled: true,
      };
    }

    // 3. Record payment if collected
    let paymentRecorded = false;
    if (data.payment_collected && invoiceResult.invoice.total_amount > 0) {
      const payResult = await recordPayment(ctx, {
        invoice_id: invoiceResult.invoice.id,
        amount: invoiceResult.invoice.total_amount,
        payment_method: data.payment_method,
        reference_number: data.reference_number ?? undefined,
      });
      paymentRecorded = payResult.success;
    }

    // 3b. Generate and archive Receipt PDF to storage immediately
    try {
      await compileAndArchiveReceiptPdf(ctx, invoiceResult.invoice.id);
    } catch (pdfErr) {
      log.warn({ event: "billing.receipt_pdf_generate.failed", code: errorTag(pdfErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
    }

    // 4. Retrieve signed PDF path if generated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rxRows } = await (supabase.from("prescriptions") as any)
      .select("pdf_storage_path")
      .eq("visit_id", data.visit_id)
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false })
      .limit(1);
    const rxRow = rxRows && rxRows.length > 0 ? rxRows[0] : null;

    // 5. Automated Single Consolidated WhatsApp Dispatch:
    // Sends both prescription and invoice links together in a single WhatsApp message to avoid double message costs.
    let whatsAppSent = false;
    let whatsAppError: string | null = null;
    let rxShareUrl: string | undefined;
    let invoiceShareUrl: string | undefined;

    try {
      const waRes = await sendConsolidatedConsultationWhatsApp(ctx, {
        visitId: data.visit_id,
        invoiceId: invoiceResult.invoice.id,
        patientId: data.patient_id,
      });
      whatsAppSent = waRes.success;
      whatsAppError = waRes.error || null;
      rxShareUrl = waRes.rxShareUrl;
      invoiceShareUrl = waRes.invoiceShareUrl;
    } catch (waErr) {
      log.warn({ event: "billing.checkout_whatsapp.failed", code: errorTag(waErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      whatsAppError =
        waErr instanceof Error
          ? waErr.message
          : "Failed to dispatch automated WhatsApp";
    }

    return {
      success: true,
      visitId: data.visit_id,
      invoiceId: invoiceResult.invoice.id,
      invoiceNumber: invoiceResult.invoice.invoice_number ?? null,
      pdfStoragePath: rxRow?.pdf_storage_path || null,
      paymentRecorded,
      whatsAppSent,
      whatsAppError,
      rxShareUrl,
      invoiceShareUrl,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to complete and bill consultation.",
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
      error: err instanceof Error ? err.message : "Failed to load receipt PDF.",
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
    await enqueueMessage(supabase, {
      tenantId: session.tenantId,
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
      error: err instanceof Error ? err.message : "Failed to share receipt.",
    };
  }
}

export interface SendConsolidatedConsultationWhatsAppInput {
  visitId: string;
  invoiceId?: string;
  patientId?: string;
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
    assertPerm(ctx.role, "consultations:view");
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
    if (inv) {
      invoiceId = inv.id;
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
    const queueItem = await enqueueMessage(supabase, {
      tenantId: session.tenantId,
      patientId: patientId || null,
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
    });

    // 10. Record consolidated audit log
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
      error:
        err instanceof Error
          ? err.message
          : "Failed to dispatch consolidated consultation WhatsApp.",
    };
  }
}
