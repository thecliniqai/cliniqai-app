import { describe, it, expect } from "vitest";
import {
  invoiceItemSchema,
  createInvoiceSchema,
  recordPaymentSchema,
  completeAndBillSchema,
  collectPaymentSchema,
  addInvoiceItemSchema,
  invoiceItemFieldErrors,
  INVOICE_ITEM_LIMITS,
} from "@/features/billing/schema";

// V2-07 07-04a F-8: the form checks the bounds the database enforces (private.invoice_items_normalize), with a message per field.
describe("invoice item bounds (the database's, mirrored)", () => {
  const item = { item_type: "procedure", description: "Wound dressing", unit_price: 150, quantity: 2 };
  const issue = (over: Record<string, unknown>) => {
    const r = invoiceItemSchema.safeParse({ ...item, ...over });
    return r.success ? null : { path: r.error.issues[0].path.join("."), message: r.error.issues[0].message };
  };

  it("accepts the limits themselves: 200 characters, 10,00,000, quantity 99, price 0", () => {
    expect(issue({ description: "d".repeat(INVOICE_ITEM_LIMITS.descriptionMax) })).toBeNull();
    expect(issue({ unit_price: INVOICE_ITEM_LIMITS.priceMax })).toBeNull();
    expect(issue({ unit_price: 0 })).toBeNull();
    expect(issue({ quantity: INVOICE_ITEM_LIMITS.quantityMax })).toBeNull();
  });

  it.each([
    ["a blank description", { description: "   " }, "description", "Description is required"],
    ["a 201-character description", { description: "d".repeat(201) }, "description", "Description must be 200 characters or fewer"],
    ["a description with a control character", { description: "fee" }, "description", "Description cannot contain control characters"],
    ["a price above 10,00,000", { unit_price: 1_000_000.01 }, "unit_price", "Price cannot be more than ₹10,00,000"],
    ["a negative price", { unit_price: -1 }, "unit_price", "Price must be >= 0"],
    ["quantity 100", { quantity: 100 }, "quantity", "Quantity cannot be more than 99"],
    ["quantity 0", { quantity: 0 }, "quantity", "Quantity must be >= 1"],
    ["a fractional quantity", { quantity: 1.5 }, "quantity", "Quantity must be a whole number"],
  ])("refuses %s with a field-level message", (_name, over, path, message) => {
    expect(issue(over)).toEqual({ path, message });
  });

  it("the description counts characters like the database (a 200-character emoji description is allowed) and trims blanks only", () => {
    expect(issue({ description: "😀".repeat(200) })).toBeNull();
    expect(issue({ description: `  ${"d".repeat(200)}  ` })).toBeNull();
  });

  it("invoiceItemFieldErrors gives the first message of each field and nothing for a valid item", () => {
    expect(invoiceItemFieldErrors({ description: "Dressing", unit_price: 150, quantity: 1 })).toEqual({});
    expect(invoiceItemFieldErrors({ description: "d".repeat(201), unit_price: 2_000_000, quantity: 100 })).toEqual({
      description: "Description must be 200 characters or fewer",
      unit_price: "Price cannot be more than ₹10,00,000",
      quantity: "Quantity cannot be more than 99",
    });
    expect(invoiceItemFieldErrors({ description: "Dressing", unit_price: "" }).unit_price).toBe("Price is required");
  });

  it("the add-item schema and the Sign & Bill consultation fee use the same bounds", () => {
    expect(addInvoiceItemSchema.safeParse({ invoice_id: "11111111-1111-4111-8111-111111111111", description: "x", unit_price: 2_000_000 }).success).toBe(false);
    const fee = completeAndBillSchema.safeParse({
      visit_id: "11111111-1111-4111-8111-111111111111",
      patient_id: "22222222-2222-4222-8222-222222222222",
      consultation_fee: 1_000_001,
      client_request_id: "33333333-3333-4333-8333-333333333333",
    });
    expect(fee.success).toBe(false);
  });
});

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
      client_request_id: "33333333-3333-4333-8333-333333333333",
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

  it("completeAndBillSchema requires a client_request_id (V2-07 07-03, PWA-06a)", () => {
    const base = {
      visit_id: "11111111-1111-1111-1111-111111111111",
      patient_id: "22222222-2222-2222-2222-222222222222",
      consultation_fee: 600,
    };
    expect(completeAndBillSchema.safeParse(base).success).toBe(false);
    expect(completeAndBillSchema.safeParse({ ...base, client_request_id: "not-a-uuid" }).success).toBe(false);
  });
});
