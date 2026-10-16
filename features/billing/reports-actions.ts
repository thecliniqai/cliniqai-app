"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { Database } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CollectionReportPaymentItem {
  id: string;
  amount: number;
  payment_method: "cash" | "upi" | "card";
  reference_number: string | null;
  notes: string | null;
  recorded_at: string;
  invoice_id: string;
  invoice_number: string;
  invoice_status: string;
  patient_name: string;
  patient_phone: string | null;
  doctor_name: string | null;
}

export interface CollectionReportData {
  dateRange: { start: string; end: string };
  summary: {
    totalCollection: number;
    cashTotal: number;
    upiTotal: number;
    cardTotal: number;
    paymentsCount: number;
    invoicesCount: number;
    averageInvoiceValue: number;
    outstandingReceivables: number;
  };
  payments: CollectionReportPaymentItem[];
}

export type GetCollectionReportResult =
  | { success: true; data: CollectionReportData }
  | { success: false; error: string };

/**
 * Aggregates daily, weekly, or monthly collection reports for clinic owners and billers.
 */
export async function getDailyCollectionReport(
  startDateStr: string,
  endDateStr: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GetCollectionReportResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("billing:view"));

    // Ensure start/end dates are well-bounded timestamps
    const startIso = new Date(`${startDateStr}T00:00:00.000Z`).toISOString();
    const endIso = new Date(`${endDateStr}T23:59:59.999Z`).toISOString();

    // 1. Fetch payments within date range for this tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rawPayments, error: payErr } = await (supabase.from("payments") as any)
      .select(`
        id,
        invoice_id,
        amount,
        payment_method,
        reference_number,
        notes,
        recorded_at,
        invoices:invoice_id (
          id,
          invoice_number,
          total_amount,
          status,
          visit_id,
          patient_id,
          patients:patient_id (
            full_name,
            phone
          ),
          visits:visit_id (
            doctor_id
          )
        )
      `)
      .eq("tenant_id", session.tenantId)
      .gte("recorded_at", startIso)
      .lte("recorded_at", endIso)
      .order("recorded_at", { ascending: false });

    if (payErr) {
      console.error("[features/billing/reports-actions] Payments query error:", payErr);
      return { success: false, error: "Failed to fetch collection payments." };
    }

    // 2. Compute payment metrics
    let totalCollection = 0;
    let cashTotal = 0;
    let upiTotal = 0;
    let cardTotal = 0;
    const uniqueInvoiceIds = new Set<string>();

    const paymentsList: CollectionReportPaymentItem[] = (rawPayments || []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => {
        const amt = Number(p.amount) || 0;
        totalCollection += amt;
        if (p.payment_method === "cash") cashTotal += amt;
        else if (p.payment_method === "upi") upiTotal += amt;
        else if (p.payment_method === "card") cardTotal += amt;

        if (p.invoice_id) uniqueInvoiceIds.add(p.invoice_id);

        const inv = p.invoices;
        const pat = inv?.patients;

        return {
          id: p.id,
          amount: amt,
          payment_method: p.payment_method,
          reference_number: p.reference_number || null,
          notes: p.notes || null,
          recorded_at: p.recorded_at,
          invoice_id: p.invoice_id,
          invoice_number: inv?.invoice_number || "—",
          invoice_status: inv?.status || "issued",
          patient_name: pat?.full_name || "Walk-in Patient",
          patient_phone: pat?.phone || null,
          doctor_name: null,
        };
      }
    );

    // 3. Query invoices created in this period to calculate outstanding receivables
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: periodInvoices } = await (supabase.from("invoices") as any)
      .select("id, total_amount, status")
      .eq("tenant_id", session.tenantId)
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    let periodInvoiceTotal = 0;
    let outstandingReceivables = 0;

    (periodInvoices || []).forEach((inv: { id: string; total_amount: number; status: string }) => {
      const amt = Number(inv.total_amount) || 0;
      periodInvoiceTotal += amt;
      if (inv.status !== "paid" && inv.status !== "cancelled") {
        outstandingReceivables += amt;
      }
    });

    const invoicesCount = (periodInvoices || []).length || uniqueInvoiceIds.size;
    const averageInvoiceValue =
      invoicesCount > 0
        ? Math.round((periodInvoiceTotal / invoicesCount + Number.EPSILON) * 100) / 100
        : 0;

    const round2 = (val: number) => Math.round((val + Number.EPSILON) * 100) / 100;

    return {
      success: true,
      data: {
        dateRange: { start: startDateStr, end: endDateStr },
        summary: {
          totalCollection: round2(totalCollection),
          cashTotal: round2(cashTotal),
          upiTotal: round2(upiTotal),
          cardTotal: round2(cardTotal),
          paymentsCount: paymentsList.length,
          invoicesCount,
          averageInvoiceValue: round2(averageInvoiceValue),
          outstandingReceivables: round2(outstandingReceivables),
        },
        payments: paymentsList,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load collection report.",
    };
  }
}

