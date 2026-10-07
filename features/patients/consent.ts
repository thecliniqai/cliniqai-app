"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { ConsentRecord } from "@/lib/db/types";

export type ConsentType = "treatment" | "data_sharing" | "teleconsultation";

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
