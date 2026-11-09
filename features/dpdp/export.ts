import { getAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit/audit";
import type { Database } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";

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
 * Strictly scoped to tenant_id and patient_id.
 */
export async function exportPatientDpdpArchive(
  patientId: string,
  tenantId: string,
  options?: ExportPatientDpdpArchiveOptions,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: {
    userId: string;
    tenantId: string;
    role?: string;
    actorType?: "user" | "api_key";
    apiKeyId?: string;
  }
): Promise<DpdpExportBundle> {
  const supabase = clientOverride || getAdminClient();

  // 1. Fetch Patient demographics (must belong to tenantId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: patient, error: patientError } = await (supabase.from("patients") as any)
    .select("*")
    .eq("id", patientId)
    .eq("tenant_id", tenantId)
    .single();

  if (patientError || !patient) {
    throw new Error(`Patient not found or unauthorized: ${patientError?.message || "Not found"}`);
  }

  // 2. Fetch Tenant / Clinic info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tenant } = await (supabase.from("tenants") as any)
    .select("*")
    .eq("id", tenantId)
    .single();

  // 3. Fetch Encounters (visits) with vitals and clinical notes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: encounters } = await (supabase.from("visits") as any)
    .select("*")
    .eq("patient_id", patientId)
    .eq("tenant_id", tenantId)
    .order("scheduled_at", { ascending: false });

  // 4. Fetch Prescriptions with nested prescription_items
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prescriptions } = await (supabase.from("prescriptions") as any)
    .select("*, prescription_items(*)")
    .eq("patient_id", patientId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  // 5. Fetch Lab Reports & Diagnostic Documents
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: documents } = await (supabase.from("patient_documents") as any)
    .select("*")
    .eq("patient_id", patientId)
    .eq("tenant_id", tenantId)
    .order("report_date", { ascending: false });

  // 6. Fetch Billing: Invoices and Payments (per OpenCode review requirement)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invoices } = await (supabase.from("invoices") as any)
    .select("*, invoice_items(*)")
    .eq("patient_id", patientId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceIds = (invoices || []).map((inv: any) => inv.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payments: any[] = [];
  if (invoiceIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: paymentsData } = await (supabase.from("payments") as any)
      .select("*")
      .eq("tenant_id", tenantId)
      .in("invoice_id", invoiceIds)
      .order("recorded_at", { ascending: false });
    payments = paymentsData || [];
  }

  // 7. Fetch Immutable Consent Records
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: consentRecords } = await (supabase.from("consent_records") as any)
    .select("*")
    .eq("patient_id", patientId)
    .eq("tenant_id", tenantId)
    .order("recorded_at", { ascending: false });

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
    patient,
    encounters: encounters || [],
    prescriptions: prescriptions || [],
    documents: documents || [],
    billing: {
      invoices: invoices || [],
      payments: payments || [],
    },
    consent_records: consentRecords || [],
  };

  // 8. Log compliance audit event
  if (!options?.skipAudit) {
    try {
      await recordAudit(
        {
          action: "dpdp.data_export",
          entityType: "patient",
          entityId: patientId,
          actorType: sessionOverride?.actorType || "user",
          apiKeyId: sessionOverride?.apiKeyId || null,
          metadata: {
            format: options?.format || "json",
            status: "completed",
          },
        },
        supabase,
        sessionOverride || {
          userId: patient.created_by,
          tenantId: tenantId,
          role: "owner",
        }
      );
    } catch (auditErr) {
      console.warn("[features/dpdp/export] Audit log warning:", auditErr);
    }
  }

  return bundle;
}
