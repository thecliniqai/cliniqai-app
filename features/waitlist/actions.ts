"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import { contextFailureToAppError } from "@/lib/commands/context-error";
import type { Result as CommandResult } from "@/lib/errors/app-error";
import * as waitlistService from "./service";
import type {
  AddToWaitlistInput,
  AddToWaitlistValue,
  GetWaitlistResult,
  PromoteWaitlistInput,
  PromoteWaitlistValue,
} from "./service";
import { markAction } from "@/lib/observability/db-timing";

export type {
  AddToWaitlistInput,
  AddToWaitlistValue,
  WaitlistEntryWithPatient,
  GetWaitlistResult,
  PromoteWaitlistInput,
  PromoteWaitlistValue,
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
 * Adds a patient to the clinic's appointment waitlist (D-08) as one atomic command (V2-08 08-04a). `client_request_id` is
 * required (the same id replays the first result).
 */
export async function addToWaitlist(
  input: AddToWaitlistInput,
  clientRequestId: string
): Promise<CommandResult<AddToWaitlistValue>> {
  await markAction("waitlist.add_to_waitlist");
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await waitlistService.addToWaitlist(resolved.ctx, input, clientRequestId);
  if (result.ok) revalidate("/schedule");
  return result;
}

/**
 * Retrieves active waitlist entries for a specified date and optional doctor.
 */
export async function getWaitlistForDate(targetDate: string, doctorId?: string): Promise<GetWaitlistResult> {
  await markAction("waitlist.get_waitlist_for_date");
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return waitlistService.getWaitlistForDate(resolved.ctx, targetDate, doctorId);
}

/**
 * Explicitly promotes a waitlist entry into an appointment slot as one atomic command (V2-08 08-04a). A slot that is taken,
 * off duty or blocked answers CONFLICT (SLOT_TAKEN, SLOT_OFF_DUTY, SLOT_BLOCKED) and writes nothing.
 */
export async function promoteWaitlistEntry(
  input: PromoteWaitlistInput,
  clientRequestId: string
): Promise<CommandResult<PromoteWaitlistValue>> {
  await markAction("waitlist.promote_waitlist_entry");
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await waitlistService.promoteWaitlistEntry(resolved.ctx, input, clientRequestId);
  return result;
}
