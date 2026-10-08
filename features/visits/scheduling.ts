"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { createVisit } from "./actions";
import { Database, Visit } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const bookAppointmentSchema = z.object({
  patient_id: z.string().uuid("Invalid patient ID"),
  doctor_id: z.string().uuid("Invalid doctor ID"),
  scheduled_at: z.string().datetime({ offset: true }),
  estimated_duration_minutes: z.number().int().min(5).max(180).default(15),
  reason_for_visit: z.string().max(500).nullable().optional(),
  is_overbooked: z.boolean().default(false),
});

export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;

export interface CheckSlotResult {
  available: boolean;
  conflictingVisit?: Visit | null;
}

/**
 * Checks whether a requested doctor appointment slot overlaps with existing booked or in-progress visits.
 * Complies with double-booking prevention (D-06).
 */
export async function checkSlotAvailability(
  doctorId: string,
  scheduledAt: string,
  durationMinutes: number = 15,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<CheckSlotResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:view"));
    const targetDate = scheduledAt.split("T")[0];
    const startOfDay = `${targetDate}T00:00:00.000Z`;
    const endOfDay = `${targetDate}T23:59:59.999Z`;

    // Query non-cancelled visits for this doctor on the target date
    const { data: visits, error } = await (
      supabase.from("visits") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              gte: (col: string, val: string) => {
                lte: (col: string, val: string) => {
                  not: (col: string, op: string, val: string) => Promise<{ data: Visit[] | null; error: { message: string } | null }>;
                };
              };
            };
          };
        };
      }
    )
      .select("*")
      .eq("tenant_id", session.tenantId)
      .eq("doctor_id", doctorId)
      .gte("scheduled_at", startOfDay)
      .lte("scheduled_at", endOfDay)
      .not("status", "in", '("cancelled")');

    if (error || !visits) {
      console.error("[features/visits/scheduling] Availability check failed:", error);
      return { available: true };
    }

    const targetStart = new Date(scheduledAt).getTime();
    const targetEnd = targetStart + durationMinutes * 60000;

    for (const v of visits) {
      if (!v.scheduled_at) continue;
      const visitStart = new Date(v.scheduled_at).getTime();
      const visitEnd = visitStart + (v.estimated_duration_minutes || 15) * 60000;

      // Overlap condition: startA < endB && endA > startB
      if (visitStart < targetEnd && visitEnd > targetStart) {
        return {
          available: false,
          conflictingVisit: v,
        };
      }
    }

    return { available: true };
  } catch (err: unknown) {
    console.error("[features/visits/scheduling] Slot availability error:", err);
    return { available: true };
  }
}

export type BookAppointmentResult =
  | { success: true; visitId: string }
  | { success: false; conflict?: boolean; conflictingVisit?: Visit | null; error: string };

/**
 * Books an appointment on the doctor's day timeline.
 * If slot is occupied and `is_overbooked` is false, returns conflict details for overbooking confirmation dialog.
 */
export async function bookAppointment(
  input: BookAppointmentInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<BookAppointmentResult> {
  const parseResult = bookAppointmentSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.issues[0]?.message || "Invalid appointment details",
    };
  }

  const data = parseResult.data;

  // 1. Check double-booking slot availability
  if (!data.is_overbooked) {
    const slotCheck = await checkSlotAvailability(
      data.doctor_id,
      data.scheduled_at,
      data.estimated_duration_minutes,
      clientOverride,
      sessionOverride
    );

    if (!slotCheck.available) {
      return {
        success: false,
        conflict: true,
        conflictingVisit: slotCheck.conflictingVisit,
        error: "Slot is already booked. Confirmation is required to overbook this slot.",
      };
    }
  }

  // 2. Create the visit
  const visitRes = await createVisit(
    {
      patient_id: data.patient_id,
      doctor_id: data.doctor_id,
      origin_type: "scheduled",
      scheduled_at: data.scheduled_at,
      estimated_duration_minutes: data.estimated_duration_minutes,
      reason_for_visit: data.reason_for_visit || null,
      is_overbooked: data.is_overbooked,
    },
    clientOverride,
    sessionOverride
  );

  if (!visitRes.success) {
    return {
      success: false,
      error: visitRes.error,
    };
  }

  return {
    success: true,
    visitId: visitRes.visitId,
  };
}
