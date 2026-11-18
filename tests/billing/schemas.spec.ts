import { describe, it, expect } from "vitest";
import {
  invoiceItemSchema,
  createInvoiceSchema,
  recordPaymentSchema,
  completeAndBillSchema,
  collectPaymentSchema,
} from "@/features/billing/schema";

describe("Billing Zod Validation Schemas (REQ-billing-invoicing)", () => {
  it("validates invoiceItemSchema with valid items and defaults", () => {
    const valid = {
      item_type: "consultation",
      description: "General Physician OPD Consultation",
      unit_price: 500,
      quantity: 1,
    };

    const parsed = invoiceItemSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.unit_price).toBe(500);
      expect(parsed.data.quantity).toBe(1);
    }

    // Negative unit price rejected
    expect(invoiceItemSchema.safeParse({ ...valid, unit_price: -100 }).success).toBe(false);

    // Zero or negative quantity rejected
    expect(invoiceItemSchema.safeParse({ ...valid, quantity: 0 }).success).toBe(false);
  });

  it("validates createInvoiceSchema requiring at least one item and non-negative discounts", () => {
    const valid = {
      visit_id: "11111111-1111-1111-1111-111111111111",
      patient_id: "22222222-2222-2222-2222-222222222222",
      items: [
        {
          item_type: "consultation" as const,
          description: "OPD Consultation",
          unit_price: 500,
          quantity: 1,
        },
      ],
      discount: 50,
      tax: 0,
      client_request_id: "44444444-4444-4444-8444-444444444444",
    };

    expect(createInvoiceSchema.safeParse(valid).success).toBe(true);

    // V2-07 PWA-06a: the request id is required and a uuid
    expect(createInvoiceSchema.safeParse({ ...valid, client_request_id: undefined }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...valid, client_request_id: "nope" }).success).toBe(false);

    // Empty items array rejected
    expect(createInvoiceSchema.safeParse({ ...valid, items: [] }).success).toBe(false);

    // Invalid UUID rejected
    expect(createInvoiceSchema.safeParse({ ...valid, visit_id: "invalid-uuid" }).success).toBe(false);

    // Negative discount rejected
    expect(createInvoiceSchema.safeParse({ ...valid, discount: -20 }).success).toBe(false);
  });

  it("validates collectPaymentSchema: a positive amount, a closed method, a request id; items may be empty", () => {
    const valid = {
      visit_id: "11111111-1111-1111-1111-111111111111",
      patient_id: "22222222-2222-2222-2222-222222222222",
      amount: 650,
      payment_method: "upi",
      client_request_id: "44444444-4444-4444-8444-444444444444",
    };
    const parsed = collectPaymentSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ items: [], discount: 0, tax: 0 });
    expect(collectPaymentSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
    expect(collectPaymentSchema.safeParse({ ...valid, payment_method: "bitcoin" }).success).toBe(false);
    expect(collectPaymentSchema.safeParse({ ...valid, client_request_id: undefined }).success).toBe(false);
    expect(collectPaymentSchema.safeParse({ ...valid, items: Array.from({ length: 51 }, () => ({ description: "x", unit_price: 1 })) }).success).toBe(false);
  });

  it("validates recordPaymentSchema with cash, upi, card and positive amount", () => {
    const validCash = {
      invoice_id: "33333333-3333-3333-3333-333333333333",
      amount: 450,
      payment_method: "cash",
    };
    expect(recordPaymentSchema.safeParse(validCash).success).toBe(true);

    const validUpi = {
      invoice_id: "33333333-3333-3333-3333-333333333333",
      amount: 500,
      payment_method: "upi",
      reference_number: "UPI-REF-998877",
    };
    expect(recordPaymentSchema.safeParse(validUpi).success).toBe(true);

    // Invalid payment method rejected
    expect(
      recordPaymentSchema.safeParse({ ...validCash, payment_method: "crypto" }).success
    ).toBe(false);

    // Zero or negative payment rejected
    expect(recordPaymentSchema.safeParse({ ...validCash, amount: 0 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...validCash, amount: -100 }).success).toBe(false);
  });

  it("validates completeAndBillSchema with solo doctor defaults", () => {
    const valid = {
      visit_id: "11111111-1111-1111-1111-111111111111",
      patient_id: "22222222-2222-2222-2222-222222222222",
      consultation_fee: 600,
      payment_collected: true,
      payment_method: "cash" as const,
    };

    const parsed = completeAndBillSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.consultation_fee).toBe(600);
      expect(parsed.data.payment_collected).toBe(true);
      expect(parsed.data.additional_items).toEqual([]);
      expect(parsed.data.discount).toBe(0);
    }
  });
});
