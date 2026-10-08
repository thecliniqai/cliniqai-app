"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { Database, Patient, WaitlistEntry } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createVisit } from "@/features/visits/actions";

const addToWaitlistSchema = z.object({
  patient_id: z.string().uuid("Invalid patient ID"),
  doctor_id: z.string().uuid("Invalid doctor ID").nullable().optional(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Target date must be in YYYY-MM-DD format"),
  time_window: z.string().max(100).nullable().optional(),
  priority: z.number().int().min(0).max(10).default(0),
  notes: z.string().max(500).nullable().optional(),
});

export type AddToWaitlistInput = z.infer<typeof addToWaitlistSchema>;

export type AddToWaitlistResult =
  | { success: true; entryId: string }
  | { success: false; error: string };

/**
 * Adds a patient to the clinic's appointment waitlist.
 * Complies with waitlist management specifications (D-08).
 */
export async function addToWaitlist(
  input: AddToWaitlistInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<AddToWaitlistResult> {
  const parseResult = addToWaitlistSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.issues[0]?.message || "Invalid waitlist parameters.",
    };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));
    const data = parseResult.data;

    const { data: newEntry, error } = await (
      supabase.from("waitlist_entries") as unknown as {
        insert: (row: Record<string, unknown>) => {
          select: (cols: string) => {
            single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
          };
        };
      }
    )
      .insert({
        tenant_id: session.tenantId,
        patient_id: data.patient_id,
        doctor_id: data.doctor_id || null,
        target_date: data.target_date,
        time_window: data.time_window || null,
        priority: data.priority,
        notes: data.notes || null,
        status: "waiting",
        created_by: session.userId,
      })
      .select("id")
      .single();

    if (error || !newEntry) {
      console.error("[features/waitlist/actions] Failed to insert waitlist entry:", error);
      return { success: false, error: "Failed to add patient to waitlist." };
    }

    // Record audit event
    await recordAudit(
      {
        action: "waitlist.add",
        entityType: "waitlist",
        entityId: newEntry.id,
        metadata: {
          target_date: data.target_date,
          priority: data.priority,
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/calendar");
    } catch {
      // Ignore in non-request environments
    }

    return { success: true, entryId: newEntry.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to add to waitlist.",
    };
  }
}

export interface WaitlistEntryWithPatient extends WaitlistEntry {
  patient?: Patient | null;
}

export type GetWaitlistResult =
  | { success: true; entries: WaitlistEntryWithPatient[] }
  | { success: false; error: string };

/**
 * Retrieves active waitlist entries for a specified date and optional doctor.
 */
export async function getWaitlistForDate(
  targetDate: string,
  doctorId?: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GetWaitlistResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:view"));

    let query = (supabase.from("waitlist_entries") as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              order: (c1: string, o1: Record<string, unknown>) => {
                order: (c2: string, o2: Record<string, unknown>) => Promise<{ data: any[] | null; error: { message: string } | null }>;
                eq: (col: string, val: string) => {
                  order: (c2: string, o2: Record<string, unknown>) => Promise<{ data: any[] | null; error: { message: string } | null }>;
                };
              };
            };
          };
        };
      };
    })
      .select("*, patients(*)")
      .eq("tenant_id", session.tenantId)
      .eq("target_date", targetDate)
      .eq("status", "waiting");

    let entriesData: any[] | null = null;
    let entriesError: { message: string } | null = null;

    if (doctorId && doctorId !== "all") {
      const res = await query.order("priority", { ascending: false }).eq("doctor_id", doctorId).order("created_at", { ascending: true });
      entriesData = res.data;
      entriesError = res.error;
    } else {
      const res = await query.order("priority", { ascending: false }).order("created_at", { ascending: true });
      entriesData = res.data;
      entriesError = res.error;
    }

    if (entriesError) {
      console.error("[features/waitlist/actions] Failed to fetch waitlist:", entriesError);
      return { success: false, error: "Failed to load waitlist entries." };
    }

    const entries: WaitlistEntryWithPatient[] = (entriesData || []).map((row) => {
      const { patients, ...entryData } = row;
      return {
        ...entryData,
        patient: patients || null,
      };
    });

    return { success: true, entries };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch waitlist.",
    };
  }
}

export type PromoteWaitlistResult =
  | { success: true; visitId: string }
  | { success: false; error: string };

/**
 * Explicitly promotes a waitlist entry into an appointment slot.
 */
export async function promoteWaitlistEntry(
  entryId: string,
  scheduledAt: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<PromoteWaitlistResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));

    // 1. Fetch waitlist entry
    const { data: entry, error: fetchError } = await (
      supabase.from("waitlist_entries") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            single: () => Promise<{ data: WaitlistEntry | null; error: { message: string } | null }>;
          };
        };
      }
    )
      .select("*")
      .eq("id", entryId)
      .single();

    if (fetchError || !entry) {
      return { success: false, error: "Waitlist entry not found." };
    }

    if (entry.status !== "waiting") {
      return { success: false, error: `Waitlist entry is already ${entry.status}.` };
    }

    // 2. Create visit
    const visitRes = await createVisit(
      {
        patient_id: entry.patient_id,
        doctor_id: entry.doctor_id || session.userId,
        origin_type: "scheduled",
        scheduled_at: scheduledAt,
        reason_for_visit: "Booked from waitlist",
        estimated_duration_minutes: 15,
        is_overbooked: false,
      },
      clientOverride,
      session
    );

    if (!visitRes.success) {
      return { success: false, error: visitRes.error };
    }

    // 3. Mark waitlist entry as promoted
    await (
      supabase.from("waitlist_entries") as unknown as {
        update: (vals: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
      }
    )
      .update({
        status: "promoted",
        promoted_visit_id: visitRes.visitId,
      })
      .eq("id", entryId);

    // 4. Audit
    await recordAudit(
      {
        action: "waitlist.promote",
        entityType: "waitlist",
        entityId: entryId,
        metadata: {
          promoted_visit_id: visitRes.visitId,
        },
      },
      clientOverride,
      session
    );

    await recordAudit(
      {
        action: "visit.auto_promoted_from_waitlist",
        entityType: "visit",
        entityId: visitRes.visitId,
        metadata: {
          promoted_from_waitlist_id: entryId,
          promoted_visit_id: visitRes.visitId,
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/calendar");
    } catch {
      // Ignore
    }

    return { success: true, visitId: visitRes.visitId };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to promote waitlist entry.",
    };
  }
}
