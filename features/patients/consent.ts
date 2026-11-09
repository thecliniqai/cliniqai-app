"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { ConsentRecord, Database } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ConsentType = "treatment" | "data_sharing" | "teleconsultation" | "global";

export interface CurrentConsentState {
  consentType: string;
  status: "granted" | "withdrawn" | "none";
  recordedAt?: string;
  note?: string | null;
}

/**
 * Derives current consent state by reading latest row ordered by recorded_at DESC, id DESC.
 * Immutable history: previous rows are never overwritten.
 */
export async function getCurrentConsent(
  patientId: string,
  consentType: string
): Promise<CurrentConsentState> {
  const supabase = await createClient();
  const session = await requirePermission("patients:view");

  const { data, error } = await (supabase.from("consent_records") as any)
    .select("*")
    .eq("tenant_id", session.tenantId)
    .eq("patient_id", patientId)
    .eq("consent_type", consentType)
    .order("recorded_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      consentType,
      status: "none",
    };
  }

  return {
    consentType,
    status: data.status,
    recordedAt: data.recorded_at,
    note: data.note,
  };
}

export async function grantConsent(
  patientId: string,
  consentType: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  try {
    const session = await requirePermission("patients:edit");

    // Append-only insert: never modify historical rows
    const { data, error } = await (supabase.from("consent_records") as any)
      .insert({
        tenant_id: session.tenantId,
        patient_id: patientId,
        consent_type: consentType,
        status: "granted",
        recorded_by: session.userId,
        note: note?.trim() || null,
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("[features/patients/consent] Failed to record consent grant:", error);
      return { success: false, error: "Failed to record consent." };
    }

    await recordAudit({
      action: "patient.consent.granted",
      entityType: "consent",
      entityId: data.id,
      metadata: {
        consent_type: consentType,
      },
    });

    revalidatePath(`/patients/${patientId}`);
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to record consent.",
    };
  }
}

export async function withdrawConsent(
  patientId: string,
  consentType: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  try {
    const session = await requirePermission("patients:edit");

    // Append-only insert: withdrawal appends a new row with status 'withdrawn'
    const { data, error } = await (supabase.from("consent_records") as any)
      .insert({
        tenant_id: session.tenantId,
        patient_id: patientId,
        consent_type: consentType,
        status: "withdrawn",
        recorded_by: session.userId,
        note: reason?.trim() || null,
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("[features/patients/consent] Failed to record consent withdrawal:", error);
      return { success: false, error: "Failed to record consent withdrawal." };
    }

    await recordAudit({
      action: "patient.consent.withdrawn",
      entityType: "consent",
      entityId: data.id,
      metadata: {
        consent_type: consentType,
      },
    });

    revalidatePath(`/patients/${patientId}`);
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to withdraw consent.",
    };
  }
}

/**
 * Toggles a patient's single global consent status ('granted' vs 'withdrawn')
 * under DPDP Act 2023 D-15.
 * Records immutable append-only entries for 'global', and synchronizes
 * purpose-specific consent ('treatment', 'data_sharing') to satisfy purpose limitation.
 */
export async function toggleGlobalConsent(
  patientId: string,
  targetStatus: "granted" | "withdrawn",
  note?: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string; role?: string }
): Promise<{ success: boolean; error?: string }> {
  const supabase = clientOverride || (sessionOverride ? getAdminClient() : await createClient());

  try {
    const session = sessionOverride || (await requirePermission("patients:edit"));
    const timestamp = new Date().toISOString();
    const cleanReason =
      note?.trim() ||
      (targetStatus === "granted"
        ? "Global informed consent granted for medical care, communications, and clinical record processing"
        : "Patient requested global consent withdrawal");

    // 1. Synchronize global, treatment, and data_sharing consent records
    const purposes = ["global", "treatment", "data_sharing"];
    const rows = purposes.map((purpose) => ({
      tenant_id: session.tenantId,
      patient_id: patientId,
      consent_type: purpose,
      status: targetStatus,
      recorded_by: session.userId,
      recorded_at: timestamp,
      note: cleanReason,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("consent_records") as any)
      .insert(rows)
      .select("id, consent_type");

    if (error || !data) {
      console.error("[features/patients/consent] Failed to record global consent toggle:", error);
      return { success: false, error: "Failed to record global consent update." };
    }

    // 2. Record immutable compliance audit entry for each synchronized purpose
    for (const record of data as { id: string; consent_type: string }[]) {
      await recordAudit(
        {
          action: targetStatus === "granted" ? "patient.consent.granted" : "patient.consent.withdrawn",
          entityType: "consent",
          entityId: record.id,
          metadata: {
            consent_type: record.consent_type,
            reason: cleanReason,
            status: targetStatus,
          },
        },
        supabase as any,
        session
      );
    }

    try {
      revalidatePath(`/patients/${patientId}`);
    } catch {
      // Ignore in non-request environments
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to toggle global consent.",
    };
  }
}

