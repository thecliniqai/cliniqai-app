import { z } from "zod";

export const uploadLabDocumentSchema = z.object({
  patient_id: z.string().uuid("Invalid patient ID"),
  visit_id: z.string().uuid("Invalid visit ID").optional().nullable(),
  title: z.string().min(1, "Document title is required").max(255, "Title must be under 255 characters"),
  document_type: z.enum(["lab_report", "imaging", "prescription_scan", "other"], {
    errorMap: () => ({ message: "Invalid document type" }),
  }),
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Report date must be YYYY-MM-DD"),
  notes: z.string().max(2000, "Notes cannot exceed 2000 characters").optional().nullable(),
  is_abnormal: z
    .union([z.boolean(), z.string()])
    .transform((val) => val === true || val === "true")
    .optional()
    .default(false),
});

export const generateShareTokenSchema = z.object({
  document_id: z.string().uuid("Invalid document ID"),
});

export type UploadLabDocumentSchema = z.infer<typeof uploadLabDocumentSchema>;
export type GenerateShareTokenSchema = z.infer<typeof generateShareTokenSchema>;
