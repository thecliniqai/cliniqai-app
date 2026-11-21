/**
 * Seeds a visit with the service-role client (V2-08 08-06a, S-1). `authenticated` holds no INSERT on `public.visits` any more:
 * a visit is created by the definer commands (`enqueue_walk_in`, `register_and_book`, the waitlist promotion) or, for a fixture,
 * straight into the table. This is the fixture form: the result shape is the one the retired `createVisit` service returned
 * (`{ success, visitId }`), so specs that only needed a visit to exist keep their flow. Synthetic data only; it checks nothing
 * the database does not (the composite keys still tie the patient and the doctor to the clinic).
 */
import { getAdminClient } from "./supabase-admin";

export interface SeedVisitInput {
  patient_id: string;
  doctor_id: string;
  origin_type?: "scheduled" | "walk_in";
  scheduled_at?: string | null;
  estimated_duration_minutes?: number;
  reason_for_visit?: string | null;
  is_overbooked?: boolean;
  status?: string;
}

export type SeedVisitResult = { success: true; visitId: string } | { success: false; error: string };

export async function createVisit(ctx: { tenantId: string; userId: string }, input: SeedVisitInput): Promise<SeedVisitResult> {
  const origin = input.origin_type ?? "scheduled";
  const { data, error } = await getAdminClient()
    .from("visits")
    .insert({
      tenant_id: ctx.tenantId,
      patient_id: input.patient_id,
      doctor_id: input.doctor_id,
      origin_type: origin,
      status: input.status ?? (origin === "walk_in" ? "waiting" : "booked"),
      scheduled_at: origin === "walk_in" ? null : (input.scheduled_at ?? null),
      estimated_duration_minutes: input.estimated_duration_minutes ?? 15,
      reason_for_visit: input.reason_for_visit ?? null,
      is_overbooked: input.is_overbooked ?? false,
      created_by: ctx.userId,
    } as never)
    .select("id")
    .single();
  if (error || !data) return { success: false, error: error?.message ?? "insert failed" };
  return { success: true, visitId: (data as { id: string }).id };
}
