import { z } from "zod";

/**
 * The invoice item bounds, the same the database enforces (V2-07 07-04a F-8; `private.invoice_items_normalize`, migration
 * 000099): a description of 1 to 200 characters without control characters, a price from 0 to 10,00,000 and a whole
 * quantity from 1 to 99. The form shows these as field errors; the database repeats them with one reason per cause
 * (ITEM_DESCRIPTION_INVALID, ITEM_PRICE_INVALID, ITEM_QUANTITY_INVALID).
 */
export const INVOICE_ITEM_LIMITS = { descriptionMax: 200, priceMax: 1_000_000, quantityMax: 99 } as const;

/** The database trims blanks only (`btrim`) and refuses control characters; the form checks the same text. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

export const invoiceItemDescriptionSchema = z.string().superRefine((value, ctx) => {
  const text = value.replace(/^ +| +$/g, "");
  if (text.length < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Description is required" });
  } else if ([...text].length > INVOICE_ITEM_LIMITS.descriptionMax) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Description must be ${INVOICE_ITEM_LIMITS.descriptionMax} characters or fewer` });
  } else if (CONTROL_CHARACTER.test(text)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Description cannot contain control characters" });
  }
});

export const invoiceItemPriceSchema = z.coerce
  .number()
  .min(0, "Price must be >= 0")
  .max(INVOICE_ITEM_LIMITS.priceMax, "Price cannot be more than ₹10,00,000");

export const invoiceItemQuantitySchema = z.coerce
  .number()
  .int("Quantity must be a whole number")
  .min(1, "Quantity must be >= 1")
  .max(INVOICE_ITEM_LIMITS.quantityMax, `Quantity cannot be more than ${INVOICE_ITEM_LIMITS.quantityMax}`);

export const invoiceItemSchema = z.object({
  item_type: z.enum(["consultation", "procedure", "medicine", "other"]).default("consultation"),
  description: invoiceItemDescriptionSchema,
  unit_price: invoiceItemPriceSchema,
  quantity: invoiceItemQuantitySchema.default(1),
  total_price: z.coerce.number().min(0).optional(),
});

/**
 * Field-level errors for one item the user is typing (a charge row): `{ description?, unit_price?, quantity? }` with the
 * first message of each field, empty when the item is valid. The checkout drawer shows them under the inputs.
 */
export function invoiceItemFieldErrors(item: {
  description: string;
  unit_price: number | "";
  quantity?: number;
}): { description?: string; unit_price?: string; quantity?: string } {
  const out: { description?: string; unit_price?: string; quantity?: string } = {};
  const description = invoiceItemDescriptionSchema.safeParse(item.description);
  if (!description.success) out.description = description.error.issues[0]?.message;
  const price = invoiceItemPriceSchema.safeParse(item.unit_price === "" ? Number.NaN : item.unit_price);
  if (!price.success) out.unit_price = item.unit_price === "" ? "Price is required" : price.error.issues[0]?.message;
  if (item.quantity !== undefined) {
    const quantity = invoiceItemQuantitySchema.safeParse(item.quantity);
    if (!quantity.success) out.quantity = quantity.error.issues[0]?.message;
  }
  return out;
}

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
  /**
   * The live invoice's `row_version` the screen shows (09E-07, R-19; `null` = the screen shows no invoice yet). The command refuses with `ROW_CHANGED` and writes
   * nothing when the invoice moved on, or when a version is given and the visit has no live invoice. The server action requires the key (`CollectPaymentRequest`);
   * left out of the object, nothing is compared.
   */
  expected_invoice_version: z.number().int().nonnegative().nullable().optional(),
});

export const recordPaymentSchema = z.object({
  invoice_id: z.string().uuid("Invalid invoice ID"),
  amount: z.coerce.number().positive("Payment amount must be greater than zero"),
  payment_method: z.enum(["cash", "upi", "card"]),
  reference_number: z.string().max(100).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  /** Client-generated idempotency key of one payment (V2-03 03-07): a resubmitted payment replays, never pays twice. */
  commandId: z.string().uuid("Invalid command ID").optional(),
  /** The invoice's `row_version` the screen shows (09E-07, R-19). The server action requires it (`RecordPaymentRequest`); left out, nothing is compared. */
  expected_invoice_version: z.number().int().nonnegative().nullable().optional(),
});

export const completeAndBillSchema = z.object({
  visit_id: z.string().uuid("Invalid visit ID"),
  patient_id: z.string().uuid("Invalid patient ID"),
  // V2-10 10-02 (D-11): no default amount. The modal starts from the clinic's fee (`sign_and_bill_context`); a caller that sends none is refused.
  consultation_fee: z.coerce
    .number({ required_error: "Enter the consultation fee.", invalid_type_error: "Enter the consultation fee." })
    .min(0, "Consultation fee cannot be negative")
    .max(INVOICE_ITEM_LIMITS.priceMax, "Consultation fee cannot be more than ₹10,00,000"),
  additional_items: z.array(invoiceItemSchema).optional().default([]),
  discount: z.coerce.number().min(0).optional().default(0),
  payment_collected: z.boolean().default(true),
  payment_method: z.enum(["cash", "upi", "card"]).default("cash"),
  reference_number: z.string().max(100).nullable().optional(),
  /**
   * V2-09c 09C-05 (CTO ruling Q-8): the doctor's choice, made on the finish review, to queue the one consolidated WhatsApp message (prescription and receipt
   * links) once the sign-off has committed. Never on by default (absent means no): without it nothing is sent, and the success screen offers the manual send.
   */
  send_whatsapp: z.boolean().optional(),
  /**
   * The visit's `row_version` the screen shows (09E-07, R-19). V2-10 10-02: the Sign & Bill modal sends the version `sign_and_bill_context` answered when it
   * opened (or re-read after a refusal); the server action requires it (`CompleteAndBillRequest`). Left out (the services' system and test callers), nothing is
   * compared.
   */
  expected_version: z.number().int().nonnegative().nullable().optional(),
  /** One id per logical submit (V2-07 07-03, PWA-06a): the same id replays the first result and writes nothing new. */
  client_request_id: z.string().uuid("Invalid request ID"),
});

export const addInvoiceItemSchema = z.object({
  invoice_id: z.string().uuid("Invalid invoice ID"),
  item_type: z.enum(["consultation", "procedure", "medicine", "other"]).default("procedure"),
  description: invoiceItemDescriptionSchema,
  unit_price: invoiceItemPriceSchema,
  quantity: invoiceItemQuantitySchema.default(1),
});

export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type CollectPaymentInput = z.infer<typeof collectPaymentSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
/** What a screen sends (09E-07, R-19): the input with the invoice version it shows (`null`: it shows no invoice yet). */
export type CollectPaymentRequest = CollectPaymentInput & { expected_invoice_version: number | null };
export type RecordPaymentRequest = RecordPaymentInput & { expected_invoice_version: number };
export type CompleteAndBillInput = z.infer<typeof completeAndBillSchema>;
/** What the Sign & Bill screen sends (V2-10 10-02): the input with the visit version it shows (from `sign_and_bill_context`). */
export type CompleteAndBillRequest = CompleteAndBillInput & { expected_version: number };
export type AddInvoiceItemInput = z.infer<typeof addInvoiceItemSchema>;


/**
 * A file-name-safe form of an invoice number (V2-10 10-01): `INV/2026-27/00001` → `INV-2026-27-00001`. The slashes of the
 * FY numbering (migration 000140) are path separators in a download name and in `Content-Disposition`.
 */
export function invoiceFileStem(invoiceNumber: string): string {
  return invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "invoice";
}

/**
 * What Sign & Bill reads when it opens (V2-10 10-02, D-10; `public.sign_and_bill_context`, migration 000141), as the database answers it: rupees as numbers.
 * The service converts it to {@link SignAndBillContext} (integer paise, D-1). Unknown keys are dropped; a shape outside this is a defect.
 */
export const signAndBillContextRowSchema = z.object({
  fee: z.object({ consultation: z.number().nonnegative().nullable(), followup: z.number().nonnegative().nullable() }),
  methods: z.array(z.string()),
  visit: z.object({ id: z.string().uuid(), row_version: z.number().int().nonnegative(), status: z.string() }),
  invoice: z
    .object({ id: z.string().uuid(), row_version: z.number().int().nonnegative(), total: z.number().nonnegative(), paid: z.number().nonnegative() })
    .nullable(),
});

export type PaymentMethod = "cash" | "upi" | "card";

/** Sign & Bill's context on the device (V2-10 10-02): money in integer paise, ids, the visit's version. No PHI. */
export interface SignAndBillContext {
  /** The clinic's default fees now (paise), null when the clinic set none (the field then starts empty: never a made-up amount). */
  fee: { consultation: number | null; followup: number | null };
  /** The clinic's accepted payment methods, in the order cash, UPI, card. */
  methods: PaymentMethod[];
  /** `rowVersion` is what the sign-off sends as `expected_version`. */
  visit: { id: string; rowVersion: number; status: string };
  /** The visit's live invoice (made at the desk before the sign-off), or null. */
  invoice: { id: string; rowVersion: number; totalPaise: number; paidPaise: number } | null;
}
