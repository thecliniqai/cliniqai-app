import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner } from "../helpers/tenants";
import { createVisit } from "@/features/visits/actions";
import {
  createVisitInvoice,
  recordPayment,
  getVisitBillingDetails,
} from "@/features/billing/actions";

describe("Per-Visit Billing & Payment Recording Integration (REQ-billing-invoicing, REQ-multi-tenancy)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let patientAId: string;
  let visitAId: string;
  let invoiceAId: string;

  beforeAll(async () => {
    tenantA = await seedTenantWithOwner("Fortis Care Clinic");
    tenantB = await seedTenantWithOwner("Max Life Medical");

    // 1. Create a patient in Tenant A
    const { data: pA, error: pAErr } = await tenantA.client
      .from("patients")
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Pooja Hegde",
        phone: "+919812345678",
        age: 29,
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    if (pAErr || !pA) throw new Error(`Failed to create test patient A: ${pAErr?.message}`);
    patientAId = pA.id;

    // 2. Create visit in Tenant A
    const visitRes = await createVisit(
      {
        patient_id: patientAId,
        doctor_id: tenantA.userId,
        origin_type: "walk_in",
        reason_for_visit: "Minor laceration dressing and consultation",
        estimated_duration_minutes: 15,
        is_overbooked: false,
      },
      tenantA.client,
      { userId: tenantA.userId, tenantId: tenantA.tenantId }
    );

    if (!visitRes.success) throw new Error(`Failed to create test visit: ${visitRes.error}`);
    visitAId = visitRes.visitId;
  });

  it("1. Generates an itemized visit invoice with exact decimal calculation and zero float drift", async () => {
    const sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };

    const invRes = await createVisitInvoice(
      {
        visit_id: visitAId,
        patient_id: patientAId,
        items: [
          {
            item_type: "consultation",
            description: "OPD Consultation Fee",
            unit_price: 500.0,
            quantity: 1,
          },
          {
            item_type: "procedure",
            description: "Wound Debridement & Dressing",
            unit_price: 200.0,
            quantity: 1,
          },
        ],
        discount: 50.0,
        tax: 0,
      },
      tenantA.client,
      sessionA
    );

    expect(invRes.success).toBe(true);
    if (!invRes.success) return;

    invoiceAId = invRes.invoice.id;
    expect(invRes.invoice.subtotal).toBe(700.0);
    expect(invRes.invoice.discount).toBe(50.0);
    expect(invRes.invoice.total_amount).toBe(650.0);
    expect(invRes.invoice.status).toBe("issued");
    expect(invRes.items).toHaveLength(2);
  });

  it("2. Loads visit billing details with initial unpaid balance", async () => {
    const sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };

    const details = await getVisitBillingDetails(visitAId, tenantA.client, sessionA);
    expect(details.success).toBe(true);
    if (!details.success) return;

    expect(details.invoice?.id).toBe(invoiceAId);
    expect(details.totalPaid).toBe(0);
    expect(details.balanceDue).toBe(650.0);
    expect(details.items).toHaveLength(2);
    expect(details.payments).toHaveLength(0);
  });

  it("3. Records partial cash payment: reduces balance due and retains 'issued' status", async () => {
    const sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };

    const payRes = await recordPayment(
      {
        invoice_id: invoiceAId,
        amount: 300.0,
        payment_method: "cash",
        notes: "Advance cash paid at reception",
      },
      tenantA.client,
      sessionA
    );

    expect(payRes.success).toBe(true);
    if (!payRes.success) return;

    expect(payRes.status).toBe("issued");
    expect(payRes.totalPaid).toBe(300.0);
    expect(payRes.balanceDue).toBe(350.0);

    // Verify database record
    const { data: invRow } = await tenantA.client
      .from("invoices")
      .select("status")
      .eq("id", invoiceAId)
      .single();

    expect(invRow?.status).toBe("issued");
  });

  it("4. Records final UPI payment: satisfies total amount and transitions status to 'paid'", async () => {
    const sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };

    const payRes = await recordPayment(
      {
        invoice_id: invoiceAId,
        amount: 350.0,
        payment_method: "upi",
        reference_number: "UPI-TXN-12345678",
        notes: "GPay QR settlement",
      },
      tenantA.client,
      sessionA
    );

    expect(payRes.success).toBe(true);
    if (!payRes.success) return;

    expect(payRes.status).toBe("paid");
    expect(payRes.totalPaid).toBe(650.0);
    expect(payRes.balanceDue).toBe(0);

    // Verify invoice status in database
    const { data: invRow } = await tenantA.client
      .from("invoices")
      .select("status")
      .eq("id", invoiceAId)
      .single();

    expect(invRow?.status).toBe("paid");
  });

  it("5. Strictly enforces multi-tenant security boundary against cross-tenant data access", async () => {
    // Tenant B attempts to read Tenant A's invoice directly
    const { data: invoiceSeenByB } = await tenantB.client
      .from("invoices")
      .select("*")
      .eq("id", invoiceAId)
      .maybeSingle();

    expect(invoiceSeenByB).toBeNull();

    // Tenant B attempts to read Tenant A's payments directly
    const { data: paymentsSeenByB } = await tenantB.client
      .from("payments")
      .select("*")
      .eq("invoice_id", invoiceAId);

    expect(paymentsSeenByB).toEqual([]);

    // Tenant B attempts to record payment on Tenant A's invoice
    const sessionB = { userId: tenantB.userId, tenantId: tenantB.tenantId };
    const unauthorizedPay = await recordPayment(
      {
        invoice_id: invoiceAId,
        amount: 50.0,
        payment_method: "cash",
      },
      tenantB.client,
      sessionB
    );

    expect(unauthorizedPay.success).toBe(false);
  });
});
