import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner } from "../helpers/tenants";
import { createVisit } from "@/features/visits/actions";
import {
  createVisitInvoice,
  recordPayment,
  getInvoiceReceiptPdfSignedUrl,
} from "@/features/billing/actions";
import {
  generateAndArchiveReceiptPdf,
} from "@/features/billing/pdf/generator";
import { ReceiptPdfPayload } from "@/features/billing/pdf/receipt-document";
import {
  getDailyCollectionReport,
} from "@/features/billing/reports-actions";
import { formatCollectionReportCsv } from "@/features/billing/csv-utils";

describe("Payment Receipts & Financial Collection Reports Integration (REQ-billing-invoicing, REQ-multi-tenancy)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let patientAId: string;
  let visitA1Id: string;
  let visitA2Id: string;
  let invoiceA1Id: string;
  let invoiceA2Id: string;

  beforeAll(async () => {
    tenantA = await seedTenantWithOwner("Apollo Prime Clinic");
    tenantB = await seedTenantWithOwner("Fortis Health Center");

    // 1. Create Patient in Tenant A
    const { data: pA, error: pAErr } = await tenantA.client
      .from("patients")
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Karan Johar",
        phone: "+919876543210",
        age: 42,
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    if (pAErr || !pA) throw new Error(`Failed to create patient: ${pAErr?.message}`);
    patientAId = pA.id;

    const sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };

    // 2. Create Visit 1
    const v1 = await createVisit(
      {
        patient_id: patientAId,
        doctor_id: tenantA.userId,
        origin_type: "walk_in",
        reason_for_visit: "General health checkup",
        estimated_duration_minutes: 15,
        is_overbooked: false,
      },
      tenantA.client,
      sessionA
    );
    if (!v1.success) throw new Error(`Failed to create visit 1: ${v1.error}`);
    visitA1Id = v1.visitId;

    // 3. Create Visit 2
    const v2 = await createVisit(
      {
        patient_id: patientAId,
        doctor_id: tenantA.userId,
        origin_type: "walk_in",
        reason_for_visit: "Follow-up consultation",
        estimated_duration_minutes: 15,
        is_overbooked: false,
      },
      tenantA.client,
      sessionA
    );
    if (!v2.success) throw new Error(`Failed to create visit 2: ${v2.error}`);
    visitA2Id = v2.visitId;

    // 4. Create Invoice 1: Total ₹700 (Consultation ₹500 + Dressing ₹200)
    const inv1 = await createVisitInvoice(
      {
        visit_id: visitA1Id,
        patient_id: patientAId,
        items: [
          {
            item_type: "consultation",
            description: "Consultation Fee",
            unit_price: 500,
            quantity: 1,
          },
          {
            item_type: "procedure",
            description: "Dressing",
            unit_price: 200,
            quantity: 1,
          },
        ],
        discount: 0,
        tax: 0,
      },
      tenantA.client,
      sessionA
    );
    if (!inv1.success) throw new Error(`Failed to create invoice 1: ${inv1.error}`);
    invoiceA1Id = inv1.invoice.id;

    // 5. Create Invoice 2: Total ₹350
    const inv2 = await createVisitInvoice(
      {
        visit_id: visitA2Id,
        patient_id: patientAId,
        items: [
          {
            item_type: "consultation",
            description: "Follow-up Consultation Fee",
            unit_price: 350,
            quantity: 1,
          },
        ],
        discount: 0,
        tax: 0,
      },
      tenantA.client,
      sessionA
    );
    if (!inv2.success) throw new Error(`Failed to create invoice 2: ${inv2.error}`);
    invoiceA2Id = inv2.invoice.id;

    // 6. Record payments:
    // Invoice 1: Cash ₹400 + Card ₹300 = ₹700 (Paid)
    await recordPayment(
      {
        invoice_id: invoiceA1Id,
        amount: 400,
        payment_method: "cash",
        reference_number: "CSH-001",
      },
      tenantA.client,
      sessionA
    );
    await recordPayment(
      {
        invoice_id: invoiceA1Id,
        amount: 300,
        payment_method: "card",
        reference_number: "POS-7890",
      },
      tenantA.client,
      sessionA
    );

    // Invoice 2: UPI ₹350 = ₹350 (Paid)
    await recordPayment(
      {
        invoice_id: invoiceA2Id,
        amount: 350,
        payment_method: "upi",
        reference_number: "UPI-456789123",
      },
      tenantA.client,
      sessionA
    );
  });

  it("1. Compiles server-side React-PDF payment receipt with %PDF- header magic bytes", async () => {
    const payload: ReceiptPdfPayload = {
      tenant_id: tenantA.tenantId,
      invoice_id: invoiceA1Id,
      invoice_number: "INV-2026-TEST",
      receipt_number: "REC-INV-2026-TEST",
      date: new Date().toISOString(),
      clinic: {
        name: "Apollo Prime Clinic",
        address: "MG Road, Bengaluru",
        phone: "+918012345678",
        registration_number: "KAR/MED/2026/001",
        gstin: "29AAAAA0000A1Z5",
      },
      patient: {
        full_name: "Karan Johar",
        age: 42,
        sex: "male",
        phone: "+919876543210",
        uhid: patientAId.slice(0, 8).toUpperCase(),
      },
      doctor: {
        name: "S. Rao",
        qualifications: "MBBS, MD",
        registration_no: "KMC-43210",
      },
      items: [
        {
          description: "Consultation Fee",
          item_type: "consultation",
          unit_price: 500,
          quantity: 1,
          total_price: 500,
        },
        {
          description: "Dressing",
          item_type: "procedure",
          unit_price: 200,
          quantity: 1,
          total_price: 200,
        },
      ],
      subtotal: 700,
      discount: 0,
      tax: 0,
      total_amount: 700,
      payments: [
        {
          amount: 400,
          payment_method: "cash",
          reference_number: "CSH-001",
          recorded_at: new Date().toISOString(),
        },
        {
          amount: 300,
          payment_method: "card",
          reference_number: "POS-7890",
          recorded_at: new Date().toISOString(),
        },
      ],
      total_paid: 700,
      balance_due: 0,
      status: "paid",
    };

    const sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };
    const result = await generateAndArchiveReceiptPdf(payload, tenantA.client, sessionA);

    expect(result.buffer).toBeDefined();
    expect(result.buffer.length).toBeGreaterThan(1000);
    // Check %PDF- magic bytes
    const magic = result.buffer.toString("ascii", 0, 5);
    expect(magic).toBe("%PDF-");
    expect(result.signedUrl).toBeTruthy();
    expect(result.storagePath).toContain(tenantA.tenantId);
  });

  it("2. Retrieves signed receipt URL via Server Action with invoice details", async () => {
    const sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };
    const res = await getInvoiceReceiptPdfSignedUrl(invoiceA1Id, tenantA.client, sessionA);

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.signedUrl).toBeTruthy();
    expect(res.invoiceNumber).toMatch(/^INV-/);
  });

  it("3. Aggregates daily collection metrics with Cash, UPI, and Card breakdowns", async () => {
    const sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };
    const todayStr = new Date().toISOString().split("T")[0];

    const reportRes = await getDailyCollectionReport(todayStr, todayStr, tenantA.client, sessionA);

    expect(reportRes.success).toBe(true);
    if (!reportRes.success) return;

    const data = reportRes.data;
    // Total should be: 400 (cash) + 300 (card) + 350 (upi) = 1050
    expect(data.summary.totalCollection).toBe(1050);
    expect(data.summary.cashTotal).toBe(400);
    expect(data.summary.cardTotal).toBe(300);
    expect(data.summary.upiTotal).toBe(350);
    expect(data.summary.paymentsCount).toBe(3);
    expect(data.summary.outstandingReceivables).toBe(0);

    // Verify CSV export formatting
    const csv = formatCollectionReportCsv(data);
    expect(csv).toContain("Date & Time,Invoice #,Patient Name");
    expect(csv).toContain("Karan Johar");
    expect(csv).toContain("1050.00");
    expect(csv).toContain("Total Cash Received,400.00");
    expect(csv).toContain("Total UPI Received,350.00");
    expect(csv).toContain("Total Card Received,300.00");
  });

  it("4. Blocks cross-tenant receipt access and ensures strict financial reporting isolation", async () => {
    const sessionB = { userId: tenantB.userId, tenantId: tenantB.tenantId };

    // Tenant B attempts to fetch Tenant A's invoice receipt
    const crossRes = await getInvoiceReceiptPdfSignedUrl(invoiceA1Id, tenantB.client, sessionB);
    expect(crossRes.success).toBe(false);
    expect(crossRes.error).toContain("access denied");

    // Tenant B queries daily collection report
    const todayStr = new Date().toISOString().split("T")[0];
    const bReportRes = await getDailyCollectionReport(todayStr, todayStr, tenantB.client, sessionB);

    expect(bReportRes.success).toBe(true);
    if (!bReportRes.success) return;

    // Tenant B must have zero collections from Tenant A
    expect(bReportRes.data.summary.totalCollection).toBe(0);
    expect(bReportRes.data.summary.cashTotal).toBe(0);
    expect(bReportRes.data.summary.upiTotal).toBe(0);
    expect(bReportRes.data.summary.cardTotal).toBe(0);
    expect(bReportRes.data.payments).toHaveLength(0);
  });
});
