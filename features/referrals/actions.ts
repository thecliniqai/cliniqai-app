"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext, resolveServiceContext } from "@/lib/auth/context";
import { Referral } from "@/lib/db/types";
import * as referralsService from "./service";
import { ReferralItem, CreateReferralInput, CloseReferralLoopInput } from "./types";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Actions that threw on an authentication or
// permission failure still throw; the others return their existing failure shape.
// V2-05 05-02b: referrals are clinical (target matrix: consultations:view / consultations:edit, both clinics); the
// writes and the letter reads use those keys, the register lists stay patients:view (RLS returns only what the role
// may read, so a front-desk register is simply empty).

function revalidate(path: string, type?: "page") {
  try {
    revalidatePath(path, type);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

/**
 * Creates a clinical referral (out-of-network specialist or in-network partner clinic).
 */
export async function createReferral(
  input: CreateReferralInput
): Promise<{ success: boolean; referral?: Referral; signedUrl?: string; error?: string }> {
  const ctx = await requireServiceContext("consultations:edit");
  const result = await referralsService.createReferral(ctx, input);
  if (result.success) {
    revalidate("/referrals");
    revalidate(`/patients/${input.patient_id}`);
  }
  return result;
}

/**
 * Retrieves all outbound referrals initiated by the active clinic.
 */
export async function getOutboundReferrals(): Promise<{ success: boolean; referrals: ReferralItem[]; error?: string }> {
  const ctx = await requireServiceContext("patients:view");
  return referralsService.getOutboundReferrals(ctx);
}

/**
 * Retrieves all inbound referrals targeted at the active clinic.
 */
export async function getInboundReferrals(): Promise<{ success: boolean; referrals: ReferralItem[]; error?: string }> {
  const ctx = await requireServiceContext("patients:view");
  return referralsService.getInboundReferrals(ctx);
}

/**
 * Marks an inbound referral as acknowledged by the receiving clinic.
 */
export async function acknowledgeReferral(referralId: string): Promise<{ success: boolean; error?: string }> {
  const ctx = await requireServiceContext("consultations:edit");
  const result = await referralsService.acknowledgeReferral(ctx, referralId);
  if (result.success) revalidate("/referrals");
  return result;
}

/**
 * Closes the referral loop with the receiving clinic's notes.
 */
export async function closeReferralLoop(input: CloseReferralLoopInput): Promise<{ success: boolean; error?: string }> {
  const ctx = await requireServiceContext("consultations:edit");
  const result = await referralsService.closeReferralLoop(ctx, input);
  if (result.success) {
    revalidate("/referrals");
    revalidate("/patients/[id]", "page");
  }
  return result;
}

/**
 * Returns a short-lived (3600s) signed URL for the referral letter PDF.
 */
export async function getReferralSignedUrl(
  referralId: string
): Promise<{ success: boolean; signedUrl?: string; error?: string }> {
  const ctx = await requireServiceContext("consultations:view");
  return referralsService.getReferralSignedUrl(ctx, referralId);
}

/**
 * Referrals for one patient of the active clinic.
 */
export async function getPatientReferrals(
  patientId: string
): Promise<{ success: boolean; referrals: Referral[]; error?: string }> {
  const ctx = await requireServiceContext("patients:view");
  return referralsService.getPatientReferrals(ctx, patientId);
}

/**
 * Shares a referral letter via WhatsApp with a secure tokenized link.
 */
export async function shareReferralLetterViaWhatsApp(
  referralId: string
): Promise<{ success: boolean; shareUrl?: string; token?: string; error?: string }> {
  const resolved = await resolveServiceContext("consultations:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return referralsService.shareReferralLetterViaWhatsApp(resolved.ctx, referralId);
}
