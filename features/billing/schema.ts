import { z } from "zod";

export const invoiceItemSchema = z.object({
  item_type: z.enum(["consultation", "procedure", "medicine", "other"]).default("consultation"),
  description: z.string().min(1, "Description is required"),
  unit_price: z.coerce.number().min(0, "Price must be >= 0"),
  quantity: z.coerce.number().int().min(1, "Quantity must be >= 1").default(1),
  total_price: z.coerce.number().min(0).optional(),
});

export const createInvoiceSchema = z.object({
  visit_id: z.string().uuid("Invalid visit ID"),
  patient_id: z.string().uuid("Invalid patient ID"),
  items: z.array(invoiceItemSchema).min(1, "At least one invoice item is required"),
  discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
  /** One id per logical submit (V2-07, PWA-06a): the same id replays the first result and writes nothing new. */
  client_request_id: z.string().uuid("Invalid request ID"),
});

/** Desk checkout (V2-07 07-02, R-7): the visit's invoice (created from `items` when there is none) and its payment. */
export const collectPaymentSchema = z.object({
  visit_id: z.string().uuid("Invalid visit ID"),
  patient_id: z.string().uuid("Invalid patient ID"),
  /** Used only when the visit has no live invoice yet; may be empty when one exists. */
  items: z.array(invoiceItemSchema).max(50).default([]),
  discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
  amount: z.coerce.number().positive("Payment amount must be greater than zero"),
  payment_method: z.enum(["cash", "upi", "card"]),
  reference_number: z.string().max(100).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  client_request_id: z.string().uuid("Invalid request ID"),
});

export const recordPaymentSchema = z.object({
  invoice_id: z.string().uuid("Invalid invoice ID"),
  amount: z.coerce.number().positive("Payment amount must be greater than zero"),
  payment_method: z.enum(["cash", "upi", "card"]),
  reference_number: z.string().max(100).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  /** Client-generated idempotency key of one payment (V2-03 03-07): a resubmitted payment replays, never pays twice. */
  commandId: z.string().uuid("Invalid command ID").optional(),
});

export const completeAndBillSchema = z.object({
  visit_id: z.string().uuid("Invalid visit ID"),
  patient_id: z.string().uuid("Invalid patient ID"),
  consultation_fee: z.coerce.number().min(0, "Consultation fee cannot be negative").default(500),
  additional_items: z.array(invoiceItemSchema).optional().default([]),
  discount: z.coerce.number().min(0).optional().default(0),
  payment_collected: z.boolean().default(true),
  payment_method: z.enum(["cash", "upi", "card"]).default("cash"),
  reference_number: z.string().max(100).nullable().optional(),
  /** One id per logical submit (V2-07 07-03, PWA-06a): the same id replays the first result and writes nothing new. */
  client_request_id: z.string().uuid("Invalid request ID"),
});

export const addInvoiceItemSchema = z.object({
  invoice_id: z.string().uuid("Invalid invoice ID"),
  item_type: z.enum(["consultation", "procedure", "medicine", "other"]).default("procedure"),
  description: z.string().min(1, "Description is required"),
  unit_price: z.coerce.number().min(0, "Price must be >= 0"),
  quantity: z.coerce.number().int().min(1, "Quantity must be >= 1").default(1),
});

export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type CollectPaymentInput = z.infer<typeof collectPaymentSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type CompleteAndBillInput = z.infer<typeof completeAndBillSchema>;
export type AddInvoiceItemInput = z.infer<typeof addInvoiceItemSchema>;

