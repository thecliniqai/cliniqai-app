"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { Invoice, InvoiceItem, Payment, Database } from "@/lib/db/types";
import {
  createInvoiceSchema,
  CreateInvoiceInput,
  recordPaymentSchema,
  RecordPaymentInput,
  completeAndBillSchema,
  CompleteAndBillInput,
} from "./schema";
import { completeAndSignConsultation } from "@/features/consultation/actions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { enqueueMessage } from "@/lib/messaging/dispatcher";

export type CreateInvoiceResult =
  | { success: true; invoice: Invoice; items: InvoiceItem[] }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createVisitInvoice(
  input: CreateInvoiceInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
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

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));
    const data = parseResult.data;

    // 1. Calculate item totals with decimal precision (avoiding float drift)
    const processedItems = data.items.map((item) => {
      const unit = Math.round((Number(item.unit_price) + Number.EPSILON) * 100) / 100;
      const qty = Number(item.quantity) || 1;
      const total = Math.round((unit * qty + Number.EPSILON) * 100) / 100;
      return {
        ...item,
        unit_price: unit,
        quantity: qty,
        total_price: total,
      };
    });

    const subtotal = Math.round(
      (processedItems.reduce((acc, curr) => acc + curr.total_price, 0) + Number.EPSILON) * 100
    ) / 100;

    const discount = Math.round((Number(data.discount || 0) + Number.EPSILON) * 100) / 100;
    const tax = Math.round((Number(data.tax || 0) + Number.EPSILON) * 100) / 100;
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
    const { data: newInvoice, error: invoiceErr } = await (supabase.from("invoices") as any)
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

    if (invoiceErr || !newInvoice) {
      console.error("[features/billing/actions] Failed to insert invoice:", invoiceErr);
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
    const { data: insertedItems, error: itemsErr } = await (supabase.from("invoice_items") as any)
      .insert(itemsToInsert)
      .select("*");

    if (itemsErr) {
      console.error("[features/billing/actions] Failed to insert invoice items:", itemsErr);
      return { success: false, error: "Failed to record invoice items." };
    }

    // 5. Record Audit
    await recordAudit(
      {
        action: "invoice.create",
        entityType: "invoice",
        entityId: newInvoice.id,
        metadata: {
          invoice_number: invoiceNumber,
          total_amount: totalAmount,
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/queue");
      revalidatePath(`/consultation/${data.visit_id}`);
    } catch {
      // Ignore during unit tests
    }

    return {
      success: true,
      invoice: newInvoice as Invoice,
      items: (insertedItems || []) as InvoiceItem[],
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create visit invoice.",
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
    }
  | { success: false; error: string };

export async function recordPayment(
  input: RecordPaymentInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<RecordPaymentResult> {
  const parseResult = recordPaymentSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.issues[0]?.message || "Invalid payment details.",
    };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));
    const data = parseResult.data;

    // 1. Fetch invoice and verify tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invoice, error: invoiceErr } = await (supabase.from("invoices") as any)
      .select("id, tenant_id, total_amount, status")
      .eq("id", data.invoice_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (invoiceErr || !invoice) {
      return { success: false, error: "Invoice not found or unauthorized." };
    }

    // 2. Insert Payment record
    const paymentAmount = Math.round((Number(data.amount) + Number.EPSILON) * 100) / 100;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newPayment, error: paymentErr } = await (supabase.from("payments") as any)
      .insert({
        tenant_id: session.tenantId,
        invoice_id: data.invoice_id,
        amount: paymentAmount,
        payment_method: data.payment_method,
        reference_number: data.reference_number || null,
        notes: data.notes || null,
        recorded_by: session.userId,
      })
      .select("id")
      .single();

    if (paymentErr || !newPayment) {
      console.error("[features/billing/actions] Failed to record payment:", paymentErr);
      return { success: false, error: "Failed to record payment in database." };
    }

    // 3. Query all payments for this invoice to check paid status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: paymentsList } = await (supabase.from("payments") as any)
      .select("amount")
      .eq("invoice_id", data.invoice_id)
      .eq("tenant_id", session.tenantId);

    const totalPaid = Math.round(
      ((paymentsList || []).reduce((acc: number, curr: { amount: number }) => acc + Number(curr.amount), 0) +
        Number.EPSILON) *
        100
    ) / 100;

    const totalAmount = Number(invoice.total_amount);
    const balanceDue = Math.max(0, Math.round((totalAmount - totalPaid + Number.EPSILON) * 100) / 100);
    const isFullyPaid = totalPaid >= totalAmount;

    // Update invoice status if fully paid
    if (isFullyPaid && invoice.status !== "paid") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("invoices") as any)
        .update({ status: "paid", updated_at: new Date().toISOString() })
        .eq("id", data.invoice_id)
        .eq("tenant_id", session.tenantId);
    }

    // 4. Record Audit Log
    await recordAudit(
      {
        action: "invoice.payment_recorded",
        entityType: "payment",
        entityId: newPayment.id,
        metadata: {
          invoice_id: data.invoice_id,
          amount: paymentAmount,
          method: data.payment_method,
          is_fully_paid: isFullyPaid,
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/queue");
      revalidatePath("/cabin");
      revalidatePath("/billing");
    } catch {
      // Ignore during testing
    }

    return {
      success: true,
      paymentId: newPayment.id,
      status: isFullyPaid ? "paid" : "issued",
      totalPaid,
      balanceDue,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to record payment.",
    };
  }
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
  visitId: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GetVisitBillingResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:view"));

    // Fetch invoice for visit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invoice, error: invErr } = await (supabase.from("invoices") as any)
      .select("*, invoice_items(*), payments(*)")
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    if (invErr) {
      console.error("[getVisitBillingDetails] Error loading invoice:", invErr);
      return { success: false, error: "Failed to load billing details." };
    }

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

    const totalPaid = Math.round(
      (payments.reduce((acc, curr) => acc + Number(curr.amount), 0) + Number.EPSILON) * 100
    ) / 100;
    const balanceDue = Math.max(
      0,
      Math.round((Number(invoice.total_amount) - totalPaid + Number.EPSILON) * 100) / 100
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

export type CompleteAndBillResult =
  | {
      success: true;
      visitId: string;
      invoiceId: string;
      pdfStoragePath: string | null;
      paymentRecorded: boolean;
    }
  | { success: false; error: string };

/**
 * Solo Doctor Workflow: Seals consultation prescription and records visit billing in one atomic step.
 */
export async function completeAndBillConsultation(
  input: CompleteAndBillInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<CompleteAndBillResult> {
  const parseResult = completeAndBillSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.issues[0]?.message || "Invalid input",
    };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));
    const data = parseResult.data;

    // 1. Sign off and finalize consultation & prescription
    const signResult = await completeAndSignConsultation(data.visit_id, supabase as any, session);
    if (!signResult.success) {
      return { success: false, error: signResult.error };
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

    const invoiceResult = await createVisitInvoice(
      {
        visit_id: data.visit_id,
        patient_id: data.patient_id,
        items,
        discount: data.discount,
        tax: 0,
      },
      supabase as any,
      session
    );

    if (!invoiceResult.success) {
      return { success: false, error: invoiceResult.error };
    }

    // 3. Record payment if collected
    let paymentRecorded = false;
    if (data.payment_collected && invoiceResult.invoice.total_amount > 0) {
      const payResult = await recordPayment(
        {
          invoice_id: invoiceResult.invoice.id,
          amount: invoiceResult.invoice.total_amount,
          payment_method: data.payment_method,
          reference_number: data.reference_number ?? undefined,
        },
        supabase as any,
        session
      );
      paymentRecorded = payResult.success;
    }

    // 4. Retrieve signed PDF path if generated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rxRow } = await (supabase.from("prescriptions") as any)
      .select("pdf_storage_path")
      .eq("visit_id", data.visit_id)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    return {
      success: true,
      visitId: data.visit_id,
      invoiceId: invoiceResult.invoice.id,
      pdfStoragePath: rxRow?.pdf_storage_path || null,
      paymentRecorded,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to complete and bill consultation.",
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
  invoiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GetReceiptPdfResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:view"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invoice, error: invoiceErr } = await (supabase.from("invoices") as any)
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

    let doctorInfo: { name: string; qualifications?: string | null; registration_no?: string | null } | null = null;
    if (invoice.visit_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: visit } = await (supabase.from("visits") as any)
        .select("doctor_id")
        .eq("id", invoice.visit_id)
        .eq("tenant_id", session.tenantId)
        .maybeSingle();

      if (visit?.doctor_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: doctorMember } = await (supabase.from("memberships") as any)
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

    const totalPaid = Math.round(
      ((payments || []).reduce((acc: number, curr: { amount: number }) => acc + Number(curr.amount), 0) +
        Number.EPSILON) *
        100
    ) / 100;

    const totalAmount = Number(invoice.total_amount);
    const balanceDue = Math.max(0, Math.round((totalAmount - totalPaid + Number.EPSILON) * 100) / 100);

    const { generateAndArchiveReceiptPdf } = await import("@/features/billing/pdf/generator");

    const { signedUrl } = await generateAndArchiveReceiptPdf(
      {
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
        items: (items || []).map((it: { id: string; description: string; item_type: string; unit_price: number; quantity: number; total_price: number }) => ({
          id: it.id,
          description: it.description,
          item_type: it.item_type,
          unit_price: Number(it.unit_price),
          quantity: Number(it.quantity),
          total_price: Number(it.total_price),
        })),
        subtotal: Number(invoice.subtotal),
        discount: Number(invoice.discount),
        tax: Number(invoice.tax),
        total_amount: totalAmount,
        payments: (payments || []).map((p: { id: string; amount: number; payment_method: "cash" | "upi" | "card"; reference_number?: string | null; recorded_at: string }) => ({
          id: p.id,
          amount: Number(p.amount),
          payment_method: p.payment_method,
          reference_number: p.reference_number || null,
          recorded_at: p.recorded_at,
        })),
        total_paid: totalPaid,
        balance_due: balanceDue,
        status: invoice.status,
      },
      supabase as any,
      session
    );

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
  invoiceId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: any,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: boolean; shareUrl?: string; token?: string; error?: string }> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("billing:view"));

    // 1. Fetch invoice record joined with patient and tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inv, error: invErr } = await (supabase.from("invoices") as any)
      .select("*, patient:patients(id, full_name, phone), tenant:tenants(name, phone)")
      .eq("id", invoiceId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (invErr || !inv) {
      return { success: false, error: "Invoice not found." };
    }

    if (!inv.patient?.phone) {
      return { success: false, error: "Patient does not have a phone number registered." };
    }

    // 2. Generate secure 64-character token in document_share_tokens
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: tokenErr } = await (supabase.from("document_share_tokens") as any).insert({
      tenant_id: session.tenantId,
      document_id: null,
      resource_type: "invoice",
      resource_id: invoiceId,
      token,
      expires_at: expiresAt,
      created_by: session.userId,
    });

    if (tokenErr) {
      console.error("[shareReceiptViaWhatsApp] Token creation error:", tokenErr);
      return { success: false, error: "Failed to generate secure share link." };
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const shareUrl = `${baseUrl}/r/${token}`;

    // 3. Enqueue Event #11 (receipt_issued)
    await enqueueMessage(
      {
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
        metadata: {
          invoice_id: invoiceId,
          share_token: token,
          share_url: shareUrl,
        },
      },
      supabase
    );

    // 4. Record audit log
    await recordAudit(
      {
        action: "invoice.share_whatsapp",
        entityType: "invoice",
        entityId: invoiceId,
        metadata: { share_token: token, recipient_phone: inv.patient.phone },
      },
      clientOverride,
      session
    );

    return { success: true, shareUrl, token };
  } catch (err: unknown) {
    console.error("[features/billing/actions] shareReceiptViaWhatsApp error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to share receipt.",
    };
  }
}

