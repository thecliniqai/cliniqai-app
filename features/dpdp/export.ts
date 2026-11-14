import "server-only";

import { assertPerm, PermissionDeniedError } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { clinicalNotesEmbed, withClinicalNotes } from "@/lib/db/clinical-notes";
import { exportColumns, toExportDtos } from "./export-dto";

export interface DpdpArchiveMetadata {
  standard: "DPDP_ACT_2023_RIGHT_TO_ACCESS";
  exported_at: string;
  tenant_id: string;
  patient_id: string;
  clinic_name: string;
  statutory_registrations?: {
    clinical_establishment_reg_no?: string | null;
    state_medical_council_reg_no?: string | null;
    gstin?: string | null;
    drug_license_no?: string | null;
  };
}

export interface DpdpExportBundle {
  export_metadata: DpdpArchiveMetadata;
  patient: Record<string, unknown>;
  encounters: Array<Record<string, unknown>>;
  prescriptions: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  billing: {
    invoices: Array<Record<string, unknown>>;
    payments: Array<Record<string, unknown>>;
  };
  consent_records: Array<Record<string, unknown>>;
}

export interface ExportPatientDpdpArchiveOptions {
  format?: "json" | "pdf";
  skipAudit?: boolean;
}

/**
 * Compiles a full, multi-domain patient clinical & billing dossier
 * under DPDP Act 2023 Right to Access (Section 11/12).
 * Strictly scoped to the acting tenant (`ctx.tenantId`, ADR-0005 D1) and `patientId`; runs on `ctx.db`, so a staff
 * session reads under RLS and only the `/api/v1` register path reads with its own client.
 *
 * Permission (ruling 01-09, V2-05 05-06 P1-11): `exports:create` on both paths. A staff session needs the
 * `exports:create` permission (owner only today). The `/api/v1` API-key principal (actorType "api_key", role "admin"
 * by D-02) keeps the `patients:view` role check AND needs the `exports:create` scope on its key
 * (`api_keys.scopes`, migration 000062; checked here, so every caller of the service is covered); a key without it
 * gets `ExportScopeMissingError` (a `PermissionDeniedError`, 403). That route stays off in production (PO-16).
 *
 * The payload is built only through `export-dto.ts` (explicit allow-list per entity, used for the selected columns
 * and for the copy into the bundle): no storage paths, token hashes, staff ids or internal columns.
 */
export const DPDP_EXPORT_PERMISSION = "exports:create" as const;

/** The API-key scope the `/api/v1` export requires (`api_keys.scopes`). */
export const DPDP_EXPORT_SCOPE = "exports:create" as const;

/** An API key without {@link DPDP_EXPORT_SCOPE}: a permission denial (403 on the route). */
export class ExportScopeMissingError extends PermissionDeniedError {
  readonly reason = "EXPORT_SCOPE_MISSING";
  constructor() {
    super("This API key does not have the exports:create scope.");
    this.name = "ExportScopeMissingError";
  }
}

/**
 * A section of the archive could not be read (V2-05 05a review INT L-1, plan 05-11c). A Right-to-Access answer must be
 * complete: the export fails closed (the routes answer 500 with a fixed text) and no "completed" audit row is written.
 * `cause` stays on the server (log its tag, never the object).
 */
export class ExportIncompleteError extends Error {
  readonly reason = "EXPORT_INCOMPLETE";
  constructor(
    readonly section: string,
    cause: unknown
  ) {
    super("The patient export could not be completed.", { cause });
    this.name = "ExportIncompleteError";
  }
}

type QueryResult = { data: unknown; error: unknown };

/** The rows of one archive section, or {@link ExportIncompleteError} when its query failed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sectionRows(section: string, result: QueryResult): any[] {
  if (result.error) throw new ExportIncompleteError(section, result.error);
  return Array.isArray(result.data) ? result.data : [];
}

/** PostgREST's "no row" answer to `.single()`: the patient is not visible to the caller (→ not found). */
const NO_ROW = "PGRST116";

/**
 * The one compliance audit row of a DPDP export (`dpdp.data_export`, status "completed"). Written exactly once per
 * export, after the archive (and, for a PDF, the document) was produced: the service writes it for a JSON export
 * unless `skipAudit`; the routes pass `skipAudit` for a PDF and call this after rendering (05-11c: the PDF path wrote
 * two rows before). A failure to write it is logged, not raised (the archive was produced).
 */
export async function recordDpdpExportAudit(ctx: ServiceContext, patientId: string, format: "json" | "pdf"): Promise<void> {
  try {
    await recordAudit(ctx, {
      action: "dpdp.data_export",
      entityType: "patient",
      entityId: patientId,
      metadata: { format, status: "completed" },
    });
  } catch (auditErr) {
    log.warn({ event: "dpdp.export_audit.failed", code: errorTag(auditErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
  }
}

export function dpdpExportPermission(ctx: Pick<ServiceContext, "actorType">): "exports:create" | "patients:view" {
  return ctx.actorType === "api_key" ? "patients:view" : DPDP_EXPORT_PERMISSION;
}

/** An API-key principal must hold the export scope on its (unrevoked, same-clinic) key; other principals pass. */
async function assertExportScope(ctx: ServiceContext): Promise<void> {
  if (ctx.actorType !== "api_key") return;
  if (!ctx.apiKeyId) throw new ExportScopeMissingError();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: key, error } = await (ctx.db.from("api_keys") as any)
    .select("scopes")
    .eq("id", ctx.apiKeyId)
    .eq("tenant_id", ctx.tenantId)
    .is("revoked_at", null)
    .maybeSingle();
  const scopes: unknown = key?.scopes;
  if (error || !Array.isArray(scopes) || !scopes.includes(DPDP_EXPORT_SCOPE)) {
    throw new ExportScopeMissingError();
  }
}

export async function exportPatientDpdpArchive(
  ctx: ServiceContext,
  patientId: string,
  options?: ExportPatientDpdpArchiveOptions
): Promise<DpdpExportBundle> {
  assertPerm(ctx.role, dpdpExportPermission(ctx));
  await assertExportScope(ctx);
  const supabase = ctx.db;
  const tenantId = ctx.tenantId;

  // 1. Patient demographics (must belong to tenantId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: patient, error: patientError } = await (supabase.from("patients") as any)
    .select(exportColumns("patient"))
    .eq("id", patientId)
    .eq("tenant_id", tenantId)
    .single();

  // A failed read is not "not found": the export fails closed (05-11c, INT L-1).
  if (patientError && (patientError as { code?: string }).code !== NO_ROW) {
    throw new ExportIncompleteError("patient", patientError);
  }
  if (!patient) {
    throw new Error("Patient not found or unauthorized.", { cause: patientError });
  }

  // Every section below fails the whole export when its query fails (05-11c, INT L-1): before, an error was dropped
  // (`data ?? []`) and the archive shipped with 200 and a "completed" audit row while missing whole sections.

  // 2. Clinic name and statutory registrations (export metadata only)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantResult = await (supabase.from("tenants") as any)
    .select("name, clinical_establishment_reg_no, state_medical_council_reg_no, gstin, drug_license_no")
    .eq("id", tenantId)
    .single();
  if (tenantResult.error) throw new ExportIncompleteError("clinic", tenantResult.error);
  const tenant = tenantResult.data;

  // 3. Encounters (visits) with their clinical_notes content (V2-05 05-02a), flattened under the same field names
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const encounterRows = sectionRows(
    "encounters",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("visits") as any)
      .select(`${exportColumns("encounter")}, ${clinicalNotesEmbed()}`)
      .eq("patient_id", patientId)
      .eq("tenant_id", tenantId)
      .order("scheduled_at", { ascending: false })
  );
  const encounters = encounterRows.map(withClinicalNotes);

  // 4. Prescriptions with their items
  const prescriptions = sectionRows(
    "prescriptions",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("prescriptions") as any)
      .select(`${exportColumns("prescription")}, prescription_items(${exportColumns("prescriptionItem")})`)
      .eq("patient_id", patientId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
  );

  // 5. Lab reports and diagnostic documents (metadata only)
  const documents = sectionRows(
    "documents",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("patient_documents") as any)
      .select(exportColumns("document"))
      .eq("patient_id", patientId)
      .eq("tenant_id", tenantId)
      .order("report_date", { ascending: false })
  );

  // 6. Billing: invoices with items, and their payments
  const invoices = sectionRows(
    "invoices",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("invoices") as any)
      .select(`${exportColumns("invoice")}, invoice_items(${exportColumns("invoiceItem")})`)
      .eq("patient_id", patientId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceIds = invoices.map((inv: any) => inv.id);
  let payments: unknown[] = [];
  if (invoiceIds.length > 0) {
    payments = sectionRows(
      "payments",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("payments") as any)
        .select(exportColumns("payment"))
        .eq("tenant_id", tenantId)
        .in("invoice_id", invoiceIds)
        .order("recorded_at", { ascending: false })
    );
  }

  // 7. Consent records
  const consentRecords = sectionRows(
    "consent_records",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("consent_records") as any)
      .select(exportColumns("consentRecord"))
      .eq("patient_id", patientId)
      .eq("tenant_id", tenantId)
      .order("recorded_at", { ascending: false })
  );

  const exportMetadata: DpdpArchiveMetadata = {
    standard: "DPDP_ACT_2023_RIGHT_TO_ACCESS",
    exported_at: new Date().toISOString(),
    tenant_id: tenantId,
    patient_id: patientId,
    clinic_name: tenant?.name || "Clinic",
    statutory_registrations: {
      clinical_establishment_reg_no: tenant?.clinical_establishment_reg_no || null,
      state_medical_council_reg_no: tenant?.state_medical_council_reg_no || null,
      gstin: tenant?.gstin || null,
      drug_license_no: tenant?.drug_license_no || null,
    },
  };

  const bundle: DpdpExportBundle = {
    export_metadata: exportMetadata,
    ...toExportDtos({
      patient,
      encounters,
      prescriptions,
      documents,
      invoices,
      payments,
      consentRecords,
    }),
  };

  // 8. Log compliance audit event (only for a complete archive; a PDF caller passes skipAudit and records it after
  // rendering, so each export has exactly one row)
  if (!options?.skipAudit) {
    await recordDpdpExportAudit(ctx, patientId, options?.format || "json");
  }

  return bundle;
}
