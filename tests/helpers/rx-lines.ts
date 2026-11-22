/**
 * Test helper for the Rx change command (V2-09c 09C-01): `public.change_prescription` through the service (`changePrescription`), the way the app sends it.
 * Fixtures that need a prescription line write it through this command, or as the service role on an unsigned visit (09A R-15 still applies to signed ones).
 */
import { randomUUID } from "node:crypto";
import type { ServiceContext } from "@/lib/auth/context";
import { changePrescription, type ChangePrescriptionResult } from "@/features/prescriptions/service";
import type { ChangePrescriptionInput } from "@/features/prescriptions/schema";

/** One synthetic line (the dose is explicit: the command never invents one). */
export function rxLine(over: Partial<NonNullable<NonNullable<ChangePrescriptionInput["changes"]["add"]>[number]>> = {}) {
  return { medicine_name: "Synthetic Tablet 250", dosage: "1-0-1", duration: "5 days", timing: "After food", ...over };
}

export function changeRxAs(
  ctx: ServiceContext,
  visitId: string,
  changes: ChangePrescriptionInput["changes"],
  clientRequestId: string = randomUUID()
): Promise<ChangePrescriptionResult> {
  return changePrescription(ctx, { visit_id: visitId, changes, client_request_id: clientRequestId });
}

/** Adds `lines` as `ctx`'s user and returns the new item ids (throws when the command refuses). */
export async function addRxLinesAs(ctx: ServiceContext, visitId: string, lines: ReturnType<typeof rxLine>[] = [rxLine()]): Promise<string[]> {
  const res = await changeRxAs(ctx, visitId, { add: lines });
  if (!res.success) throw new Error(`change_prescription failed: ${res.error}`);
  return res.addedItemIds;
}
