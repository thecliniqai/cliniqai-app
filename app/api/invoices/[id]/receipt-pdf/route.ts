import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { generateAndArchiveReceiptPdf } from "@/features/billing/pdf/generator";
import { ReceiptPdfPayload } from "@/features/billing/pdf/receipt-document";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;

    // 1. Authenticate user session
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // 2. Validate tenant membership server-side
    const membership = await getActiveMembership();

    // 3. Fetch invoice under strict tenant isolation (supports invoice ID or visit ID)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invoice, error: invoiceErr } = await (supabase.from("invoices") as any)
      .select("*")
      .eq("tenant_id", membership.tenantId)
      .or(`id.eq.${invoiceId},visit_id.eq.${invoiceId}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invoiceErr || !invoice) {
      return new NextResponse("Invoice not found or access denied", { status: 404 });
    }

    // 4. Fetch clinic tenant details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tenant } = await (supabase.from("tenants") as any)
      .select("id, name, address, phone, registration_number, logo_url")
      .eq("id", membership.tenantId)
      .single();

    // 5. Fetch patient details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: patient } = await (supabase.from("patients") as any)
      .select("id, full_name, age, sex, phone, address")
      .eq("id", invoice.patient_id)
      .eq("tenant_id", membership.tenantId)
      .single();

    // 6. Fetch visit and doctor details if visit_id is present
    let doctorInfo: { name: string; qualifications?: string | null; registration_no?: string | null } | null = null;
    if (invoice.visit_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: visit } = await (supabase.from("visits") as any)
        .select("doctor_id")
        .eq("id", invoice.visit_id)
        .eq("tenant_id", membership.tenantId)
        .maybeSingle();

      if (visit?.doctor_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: doctorMember } = await (supabase.from("memberships") as any)
          .select("qualifications, medical_council_reg_no")
          .eq("tenant_id", membership.tenantId)
          .eq("user_id", visit.doctor_id)
          .maybeSingle();

        doctorInfo = {
          name: user.user_metadata?.full_name || "Clinician",
          qualifications: doctorMember?.qualifications || null,
          registration_no: doctorMember?.medical_council_reg_no || null,
        };
      }
    }

    // 7. Fetch invoice items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: items } = await (supabase.from("invoice_items") as any)
      .select("*")
      .eq("invoice_id", invoice.id)
      .eq("tenant_id", membership.tenantId)
      .order("created_at", { ascending: true });

    // 8. Fetch payments
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: payments } = await (supabase.from("payments") as any)
      .select("*")
      .eq("invoice_id", invoice.id)
      .eq("tenant_id", membership.tenantId)
      .order("recorded_at", { ascending: true });

    const totalPaid = Math.round(
      ((payments || []).reduce((acc: number, curr: { amount: number }) => acc + Number(curr.amount), 0) +
        Number.EPSILON) *
        100
    ) / 100;

    const totalAmount = Number(invoice.total_amount);
    const balanceDue = Math.max(0, Math.round((totalAmount - totalPaid + Number.EPSILON) * 100) / 100);

    // 9. Build payload
    const { searchParams } = new URL(request.url);
    const isDownload = searchParams.get("download") === "true";

    const payload: ReceiptPdfPayload = {
      tenant_id: membership.tenantId,
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
    };

    // 10. Generate PDF buffer
    const { buffer } = await generateAndArchiveReceiptPdf(payload, supabase as any, {
      userId: membership.userId,
      tenantId: membership.tenantId,
    });

    const filename = `Receipt-${invoice.invoice_number}.pdf`;
    const disposition = isDownload
      ? `attachment; filename="${filename}"`
      : `inline; filename="${filename}"`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err: unknown) {
    console.error("[app/api/invoices/[id]/receipt-pdf] Error:", err);
    return new NextResponse(
      err instanceof Error ? err.message : "Internal Server Error",
      { status: 500 }
    );
  }
}
