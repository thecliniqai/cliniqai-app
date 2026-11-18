/**
 * Minimal DTOs of the DPDP Right to Access export (V2-05 05-06, P1-11, ARC-07/C15, API-15; threat T-05-19).
 *
 * The export is built ONLY through these allow-lists: one closed list of fields per entity, used both to select the
 * columns (data minimisation at the query) and to copy them into the bundle (a field the database returns that is
 * not listed never reaches the archive, so a column added later is excluded until someone lists it here).
 *
 * Never exported: storage paths and keys (`storage_path`, `pdf_storage_path`), token hashes, staff/user ids
 * (`created_by`, `recorded_by`, `uploaded_by`, `doctor_id`, `signed_by`), tenant ids on rows, idempotency and command
 * ids, internal flags and bookkeeping (`metadata`, `current_revision`, `is_overbooked`, `is_deleted`, erasure fields,
 * catalogue ids). Other clinics' rows are excluded by the queries (every read is filtered by the acting clinic).
 *
 * Isomorphic and dependency-free (unit-tested without a database).
 */

export const EXPORT_FIELDS = {
  patient: [
    "id",
    "full_name",
    "phone",
    "age",
    "sex",
    "date_of_birth",
    "address",
    "abha_id",
    "national_health_id",
    "emergency_contact",
    "guardian_name",
    "guardian_phone",
    "guardian_relationship",
    "preferred_language",
    "allergies",
    "chronic_conditions",
    "created_at",
  ],
  /** Non-internal `visits` columns. */
  encounter: ["id", "scheduled_at", "created_at", "status", "origin_type", "reason_for_visit", "specialty", "signed_at"],
  /** `clinical_notes` content, flattened onto the encounter under the same names. */
  encounterClinical: [
    "vitals",
    "chief_complaints",
    "clinical_notes",
    "specialty_data",
    "investigations_advised",
    "advice",
  ],
  prescription: ["id", "visit_id", "version", "status", "signed_at", "amendment_reason", "created_at"],
  prescriptionItem: [
    "medicine_name",
    "generic_name",
    "dose_form",
    "dosage",
    "timing",
    "duration",
    "special_instructions",
    "sort_order",
  ],
  /** Lab and diagnostic documents: metadata only, never the storage path. */
  document: [
    "id",
    "visit_id",
    "title",
    "document_type",
    "report_date",
    "original_filename",
    "mime_type",
    "file_size_bytes",
    "is_abnormal",
    "notes",
    "created_at",
  ],
  invoice: ["id", "visit_id", "invoice_number", "status", "subtotal", "discount", "tax", "total_amount", "created_at"],
  invoiceItem: ["description", "item_type", "quantity", "unit_price", "total_price"],
  payment: ["id", "invoice_id", "amount", "payment_method", "reference_number", "recorded_at"],
  consentRecord: ["id", "consent_type", "status", "note", "recorded_at"],
} as const satisfies Record<string, readonly string[]>;

export type ExportEntity = keyof typeof EXPORT_FIELDS;

/** The PostgREST column list of an entity (no `*`). */
export function exportColumns(entity: ExportEntity): string {
  return EXPORT_FIELDS[entity].join(", ");
}

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A copy of `row` with only the listed fields that are present (own properties); anything else is dropped. */
export function pickFields(row: unknown, fields: readonly string[]): Row {
  const out: Row = {};
  if (!isRow(row)) return out;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(row, field)) out[field] = row[field];
  }
  return out;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

export function patientDto(row: unknown): Row {
  return pickFields(row, EXPORT_FIELDS.patient);
}

/** A visit row with its clinical content already flattened (`withClinicalNotes`). */
export function encounterDto(row: unknown): Row {
  return pickFields(row, [...EXPORT_FIELDS.encounter, ...EXPORT_FIELDS.encounterClinical]);
}

export function prescriptionDto(row: unknown): Row {
  const out = pickFields(row, EXPORT_FIELDS.prescription);
  out.prescription_items = rows(isRow(row) ? row.prescription_items : undefined).map((item) =>
    pickFields(item, EXPORT_FIELDS.prescriptionItem),
  );
  return out;
}

export function documentDto(row: unknown): Row {
  return pickFields(row, EXPORT_FIELDS.document);
}

export function invoiceDto(row: unknown): Row {
  const out = pickFields(row, EXPORT_FIELDS.invoice);
  out.invoice_items = rows(isRow(row) ? row.invoice_items : undefined).map((item) =>
    pickFields(item, EXPORT_FIELDS.invoiceItem),
  );
  return out;
}

export function paymentDto(row: unknown): Row {
  return pickFields(row, EXPORT_FIELDS.payment);
}

export function consentRecordDto(row: unknown): Row {
  return pickFields(row, EXPORT_FIELDS.consentRecord);
}

/** The raw rows the export read, before minimisation. */
export interface RawExportRows {
  patient: unknown;
  encounters: unknown;
  prescriptions: unknown;
  documents: unknown;
  invoices: unknown;
  payments: unknown;
  consentRecords: unknown;
}

export interface ExportDtos {
  patient: Row;
  encounters: Row[];
  prescriptions: Row[];
  documents: Row[];
  billing: { invoices: Row[]; payments: Row[] };
  consent_records: Row[];
}

/** The data part of the export bundle, built only from the allow-lists. */
export function toExportDtos(raw: RawExportRows): ExportDtos {
  return {
    patient: patientDto(raw.patient),
    encounters: rows(raw.encounters).map(encounterDto),
    prescriptions: rows(raw.prescriptions).map(prescriptionDto),
    documents: rows(raw.documents).map(documentDto),
    billing: {
      invoices: rows(raw.invoices).map(invoiceDto),
      payments: rows(raw.payments).map(paymentDto),
    },
    consent_records: rows(raw.consentRecords).map(consentRecordDto),
  };
}
