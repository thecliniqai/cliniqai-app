/**
 * Fixtures for the consult draft command (V2-09b 09B-01). `saveConsultationDraft` now takes the visit, the version the caller read, a patch and a
 * client request id (R-3). These helpers read the visit's current `draft_version` as the service role, so a fixture that only wants "the doctor saves
 * this note" does not track versions; a spec about the version passes `expectedVersion` itself.
 */
import { randomUUID } from "node:crypto";
import type { ServiceContext } from "@/lib/auth/context";
import type { DraftPatch, SaveConsultationDraftInput } from "@/features/consultation/schema";
import { saveConsultationDraft, type SaveConsultationDraftResult } from "@/features/consultation/service";
import { getAdminClient } from "./supabase-admin";
import { addDaysYmd, todayInTz } from "@/lib/datetime";

/**
 * A follow-up date `days` after the clinic's today (Asia/Kolkata, the tenants default). Since 000116 (09B-06a, S-4) the draft command takes a follow-up
 * only from the clinic's today to today + 366, so fixtures use dates relative to today instead of fixed ones.
 */
export function followUpDay(days: number): string {
  return addDaysYmd(todayInTz("Asia/Kolkata"), days);
}

/** The visit's current `clinical_notes.draft_version` (service-role read; throws when the row cannot be read). */
export async function draftVersionOf(visitId: string): Promise<number> {
  const { data, error } = await getAdminClient().from("clinical_notes").select("draft_version").eq("visit_id", visitId).single();
  if (error || !data) throw new Error(`draft_version read failed: ${error?.message ?? "no row"}`);
  return data.draft_version;
}

/** Saves `patch` through the service as `ctx`, against the current version unless `expectedVersion` is given. */
export async function saveDraftAs(
  ctx: ServiceContext,
  visitId: string,
  patch: DraftPatch,
  over: { expectedVersion?: number; clientRequestId?: string } = {}
): Promise<SaveConsultationDraftResult> {
  return saveConsultationDraft(ctx, {
    visit_id: visitId,
    expected_version: over.expectedVersion ?? (await draftVersionOf(visitId)),
    patch,
    client_request_id: over.clientRequestId ?? randomUUID(),
  });
}

/**
 * The pre-09B-01 call shape (one object with the visit id and every field) as a patch: `metadata` becomes `provenance`, an undefined field is not sent.
 * For fixtures that predate the command; new specs use {@link saveDraftAs}.
 */
export async function saveLegacyDraft(ctx: ServiceContext, input: Partial<SaveConsultationDraftInput> & { visit_id: string }): Promise<SaveConsultationDraftResult> {
  const { visit_id, metadata, ...rest } = input;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) if (value !== undefined) patch[key] = value;
  if (metadata) patch.provenance = metadata;
  return saveDraftAs(ctx, visit_id, patch as DraftPatch);
}
