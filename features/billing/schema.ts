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
});

export const recordPaymentSchema = z.object({
  invoice_id: z.string().uuid("Invalid invoice ID"),
  amount: z.coerce.number().positive("Payment amount must be greater than zero"),
  payment_method: z.enum(["cash", "upi", "card"]),
  reference_number: z.string().max(100).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
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
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type CompleteAndBillInput = z.infer<typeof completeAndBillSchema>;
export type AddInvoiceItemInput = z.infer<typeof addInvoiceItemSchema>;

