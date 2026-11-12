"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import * as waitlistService from "./service";
import type {
  AddToWaitlistInput,
  AddToWaitlistResult,
  GetWaitlistResult,
  PromoteWaitlistResult,
} from "./service";

export type {
  AddToWaitlistInput,
  AddToWaitlistResult,
  WaitlistEntryWithPatient,
  GetWaitlistResult,
  PromoteWaitlistResult,
} from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.

function revalidate(...paths: string[]) {
  try {
    for (const path of paths) revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

/**
 * Adds a patient to the clinic's appointment waitlist (D-08).
 */
export async function addToWaitlist(input: AddToWaitlistInput): Promise<AddToWaitlistResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await waitlistService.addToWaitlist(resolved.ctx, input);
  if (result.success) revalidate("/calendar");
  return result;
}

/**
 * Retrieves active waitlist entries for a specified date and optional doctor.
 */
export async function getWaitlistForDate(targetDate: string, doctorId?: string): Promise<GetWaitlistResult> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return waitlistService.getWaitlistForDate(resolved.ctx, targetDate, doctorId);
}

/**
 * Explicitly promotes a waitlist entry into an appointment slot.
 */
export async function promoteWaitlistEntry(entryId: string, scheduledAt: string): Promise<PromoteWaitlistResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await waitlistService.promoteWaitlistEntry(resolved.ctx, entryId, scheduledAt);
  if (result.success) revalidate("/calendar", "/queue");
  return result;
}
