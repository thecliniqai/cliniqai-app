"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext, resolveServiceContext } from "@/lib/auth/context";
import * as consentService from "./consent-service";
import type { CurrentConsentState } from "./consent-service";

export type { ConsentType, CurrentConsentState } from "./consent-service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1); the server-only service does the work. Failure shapes are unchanged.

function revalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

/** Latest consent state for a purpose. Throws when unauthenticated or not permitted, as before. */
export async function getCurrentConsent(patientId: string, consentType: string): Promise<CurrentConsentState> {
  const ctx = await requireServiceContext("patients:view");
  return consentService.getCurrentConsent(ctx, patientId, consentType);
}

export async function grantConsent(
  patientId: string,
  consentType: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const resolved = await resolveServiceContext("patients:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await consentService.grantConsent(resolved.ctx, patientId, consentType, note);
  if (result.success) revalidate(`/patients/${patientId}`);
  return result;
}

export async function withdrawConsent(
  patientId: string,
  consentType: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const resolved = await resolveServiceContext("patients:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await consentService.withdrawConsent(resolved.ctx, patientId, consentType, reason);
  if (result.success) revalidate(`/patients/${patientId}`);
  return result;
}

/**
 * Toggles a patient's single global consent status under DPDP Act 2023 D-15 (append-only records for 'global',
 * 'treatment' and 'data_sharing').
 */
export async function toggleGlobalConsent(
  patientId: string,
  targetStatus: "granted" | "withdrawn",
  note?: string
): Promise<{ success: boolean; error?: string }> {
  const resolved = await resolveServiceContext("patients:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await consentService.toggleGlobalConsent(resolved.ctx, patientId, targetStatus, note);
  if (result.success) revalidate(`/patients/${patientId}`);
  return result;
}
