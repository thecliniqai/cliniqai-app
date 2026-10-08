"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { Visit, VisitOriginType, VisitStatus } from "@/lib/db/types";
import { z } from "zod";

const createVisitSchema = z.object({
  patient_id: z.string().uuid("Invalid patient ID"),
  doctor_id: z.string().uuid("Invalid doctor ID"),
  origin_type: z.enum(["scheduled", "walk_in"]),
  scheduled_at: z.string().datetime().nullable().optional(),
  estimated_duration_minutes: z.number().int().min(5).max(180).default(15),
  reason_for_visit: z.string().max(500).nullable().optional(),
  is_overbooked: z.boolean().default(false),
});

export type CreateVisitInput = z.infer<typeof createVisitSchema>;

export type CreateVisitResult =
  | { success: true; visitId: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createVisit(input: CreateVisitInput): Promise<CreateVisitResult> {
  const parseResult = createVisitSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return {
      success: false,
      error: "Please correct the highlighted errors.",
      fieldErrors,
    };
  }

  const supabase = await createClient();

  try {
    const session = await requirePermission("appointments:edit");
    const data = parseResult.data;

    // Insert visit under RLS
    const { data: newVisit, error: insertError } = await (
      supabase.from("visits") as unknown as {
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
        doctor_id: data.doctor_id,
        origin_type: data.origin_type,
        status: data.origin_type === "walk_in" ? "waiting" : "booked",
        scheduled_at: data.scheduled_at || null,
        estimated_duration_minutes: data.estimated_duration_minutes,
        reason_for_visit: data.reason_for_visit || null,
        is_overbooked: data.is_overbooked,
        created_by: session.userId,
      })
      .select("id")
      .single();

    if (insertError || !newVisit) {
      console.error("[features/visits/actions] Failed to insert visit:", insertError);
      return { success: false, error: "Failed to schedule visit in database." };
    }

    // Audit record creation
    await recordAudit({
      action: "visit.create",
      entityType: "visit",
      entityId: newVisit.id,
      metadata: {
        origin_type: data.origin_type,
        fields_changed: ["created"],
      },
    });

    revalidatePath("/calendar");
    revalidatePath("/queue");
    return { success: true, visitId: newVisit.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create visit.",
    };
  }
}

export type GetVisitsResult =
  | { success: true; visits: Visit[] }
  | { success: false; error: string };

export async function getVisitsForDate(
  dateStr: string,
  doctorId?: string
): Promise<GetVisitsResult> {
  const supabase = await createClient();

  try {
    const session = await requirePermission("appointments:view");

    // Compute start and end of day in UTC for boundary filtering
    const startOfDay = `${dateStr}T00:00:00.000Z`;
    const endOfDay = `${dateStr}T23:59:59.999Z`;

    let query = (supabase.from("visits") as unknown as {
      select: (cols: string) => any;
    })
      .select("*, patients(full_name, phone, age, date_of_birth)")
      .eq("tenant_id", session.tenantId)
      .or(`scheduled_at.gte.${startOfDay},created_at.gte.${startOfDay}`)
      .or(`scheduled_at.lte.${endOfDay},created_at.lte.${endOfDay}`);

    if (doctorId) {
      query = query.eq("doctor_id", doctorId);
    }

    const { data, error } = await query.order("scheduled_at", { ascending: true, nullsFirst: false });

    if (error) {
      console.error("[features/visits/actions] Failed to fetch visits:", error);
      return { success: false, error: "Failed to load visits for the selected date." };
    }

    return { success: true, visits: (data as Visit[]) || [] };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch visits.",
    };
  }
}

export type UpdateVisitStatusResult =
  | { success: true }
  | { success: false; error: string };

export async function updateVisitStatus(
  visitId: string,
  newStatus: VisitStatus
): Promise<UpdateVisitStatusResult> {
  const supabase = await createClient();

  try {
    const session = await requirePermission("appointments:edit");

    // Fetch existing visit
    const { data: existing, error: readError } = await (
      supabase.from("visits") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            single: () => Promise<{ data: Visit | null; error: { message: string } | null }>;
          };
        };
      }
    )
      .select("*")
      .eq("id", visitId)
      .single();

    if (readError || !existing) {
      return { success: false, error: "Visit not found or inaccessible." };
    }

    const oldStatus = existing.status;

    const { error: updateError } = await (
      supabase.from("visits") as unknown as {
        update: (vals: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
        };
      }
    )
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitId);

    if (updateError) {
      console.error("[features/visits/actions] Failed to update visit status:", updateError);
      return { success: false, error: "Failed to update visit status." };
    }

    // Record audit event
    await recordAudit({
      action: "visit.status_update",
      entityType: "visit",
      entityId: visitId,
      metadata: {
        old_status: oldStatus,
        new_status: newStatus,
        fields_changed: ["status"],
      },
    });

    revalidatePath("/calendar");
    revalidatePath("/queue");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update visit status.",
    };
  }
}
