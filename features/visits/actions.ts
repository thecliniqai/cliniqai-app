"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { Visit, VisitOriginType, VisitStatus, Database } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  visitsFilterSchema,
  VisitsFilterInput,
  computeDateRange,
  ClinicVisitRegisterItem,
  ClinicVisitsRegisterResult,
  ActiveDoctorOption,
} from "./schema";
import { vitalsSchema, Vitals } from "@/features/consultation/schema";

const createVisitSchema = z.object({
  patient_id: z.string().uuid("Invalid patient ID"),
  doctor_id: z.string().uuid("Invalid doctor ID"),
  origin_type: z.enum(["scheduled", "walk_in"]),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  estimated_duration_minutes: z.number().int().min(5).max(180).default(15),
  reason_for_visit: z.string().max(500).nullable().optional(),
  is_overbooked: z.boolean().default(false),
});

export type CreateVisitInput = z.infer<typeof createVisitSchema>;

export type CreateVisitResult =
  | { success: true; visitId: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createVisit(
  input: CreateVisitInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<CreateVisitResult> {
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

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));
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
    await recordAudit(
      {
        action: "visit.create",
        entityType: "visit",
        entityId: newVisit.id,
        metadata: {
          origin_type: data.origin_type,
          fields_changed: ["created"],
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/calendar");
      revalidatePath("/queue");
    } catch {
      // Ignore revalidate errors in non-Next.js runtime (e.g. tests)
    }
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
  doctorId?: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GetVisitsResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:view"));

    // Compute start and end of day in UTC for boundary filtering
    const startOfDay = `${dateStr}T00:00:00.000Z`;
    const endOfDay = `${dateStr}T23:59:59.999Z`;

    let query = (supabase.from("visits") as any)
      .select("*, patients(full_name, phone, age, date_of_birth)")
      .eq("tenant_id", session.tenantId)
      .or(`and(scheduled_at.gte.${startOfDay},scheduled_at.lte.${endOfDay}),and(scheduled_at.is.null,created_at.gte.${startOfDay},created_at.lte.${endOfDay})`);

    let data: Visit[] | null = null;
    let error: { message: string } | null = null;

    if (doctorId) {
      const res = await query.eq("doctor_id", doctorId).order("scheduled_at", { ascending: true, nullsFirst: false });
      data = res.data;
      error = res.error;
    } else {
      const res = await query.order("scheduled_at", { ascending: true, nullsFirst: false });
      data = res.data;
      error = res.error;
    }

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
  newStatus: VisitStatus,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<UpdateVisitStatusResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));

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
    await recordAudit(
      {
        action: "visit.status_update",
        entityType: "visit",
        entityId: visitId,
        metadata: {
          old_status: oldStatus,
          new_status: newStatus,
          fields_changed: ["status"],
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/calendar");
      revalidatePath("/queue");
    } catch {
      // Ignore revalidate errors in non-Next.js runtime (e.g. tests)
    }
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update visit status.",
    };
  }
}

export type ConfirmAppointmentResult =
  | { success: true }
  | { success: false; error: string };

export async function confirmAppointment(
  visitId: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<ConfirmAppointmentResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));

    // Fetch existing visit
    const { data: existing, error: readError } = await (supabase.from("visits") as any)
      .select("id, status, metadata")
      .eq("id", visitId)
      .single();

    if (readError || !existing) {
      return { success: false, error: "Appointment not found or inaccessible." };
    }

    if (existing.status === "cancelled") {
      return { success: false, error: "Cannot confirm a cancelled appointment." };
    }

    const { error: updateError } = await (supabase.from("visits") as any)
      .update({
        status: "confirmed",
        metadata: {
          ...(existing.metadata || {}),
          clinic_confirmed: true,
          confirmed_at: new Date().toISOString(),
          confirmed_by: session.userId,
          confirmed_via: "staff_calendar",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitId);

    if (updateError) {
      console.error("[confirmAppointment] Failed to update visit status:", updateError);
      return { success: false, error: "Failed to confirm appointment." };
    }

    // Record audit event
    await recordAudit(
      {
        action: "visit.confirm",
        entityType: "visit",
        entityId: visitId,
        metadata: {
          old_status: existing.status,
          new_status: "confirmed",
          confirmed_via: "staff_calendar",
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/calendar");
      revalidatePath("/queue");
    } catch {
      // Ignore
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to confirm appointment.",
    };
  }
}

export type CancelVisitResult =
  | { success: true; autoPromoted: boolean; replacementVisitId?: string; promotedPatientId?: string }
  | { success: false; error: string };

export async function cancelVisit(
  visitId: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<CancelVisitResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));

    // 1. Fetch existing visit
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
      return { success: false, error: "Visit not found." };
    }

    if (existing.status === "cancelled") {
      return { success: false, error: "Visit is already cancelled." };
    }

    // 2. Mark visit cancelled
    await (
      supabase.from("visits") as unknown as {
        update: (vals: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
      }
    )
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitId);

    // 3. Audit cancellation
    await recordAudit(
      {
        action: "visit.cancel",
        entityType: "visit",
        entityId: visitId,
        metadata: {
          old_status: existing.status,
          new_status: "cancelled",
        },
      },
      clientOverride,
      session
    );

    // 4. Auto-promotion from waitlist (D-08)
    let autoPromoted = false;
    let replacementVisitId: string | undefined;
    let promotedPatientId: string | undefined;

    if (existing.scheduled_at) {
      const targetDate = existing.scheduled_at.split("T")[0];

      // Query eligible waitlist entries for this tenant, target_date, status='waiting', and matching doctor
      interface WaitlistRow {
        id: string;
        patient_id: string;
        doctor_id: string | null;
        priority: number;
        created_at: string;
      }

      const { data: candidates, error: candidateErr } = await (
        supabase.from("waitlist_entries") as unknown as {
          select: (cols: string) => {
            eq: (col: string, val: string) => {
              eq: (col: string, val: string) => {
                eq: (col: string, val: string) => {
                  or: (filter: string) => {
                    order: (c1: string, o1: Record<string, unknown>) => {
                      order: (c2: string, o2: Record<string, unknown>) => {
                        limit: (n: number) => Promise<{ data: WaitlistRow[] | null; error: unknown }>;
                      };
                    };
                  };
                };
              };
            };
          };
        }
      )
        .select("id, patient_id, doctor_id, priority, created_at")
        .eq("tenant_id", session.tenantId)
        .eq("target_date", targetDate)
        .eq("status", "waiting")
        .or(`doctor_id.is.null,doctor_id.eq.${existing.doctor_id}`)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1);

      if (candidateErr) {
        console.error("[cancelVisit] candidates query error:", candidateErr);
      }

      if (candidates && candidates.length > 0) {
        const topCandidate = candidates[0];

        // Create replacement visit
        const newVisitRes = await createVisit(
          {
            patient_id: topCandidate.patient_id,
            doctor_id: existing.doctor_id,
            origin_type: "scheduled",
            scheduled_at: new Date(existing.scheduled_at).toISOString(),
            estimated_duration_minutes: existing.estimated_duration_minutes || 15,
            reason_for_visit: "Booked from waitlist",
            is_overbooked: false,
          },
          clientOverride,
          session
        );

        if (newVisitRes.success) {
          autoPromoted = true;
          replacementVisitId = newVisitRes.visitId;
          promotedPatientId = topCandidate.patient_id;

          // Mark candidate waitlist entry as promoted
          await (
            supabase.from("waitlist_entries") as unknown as {
              update: (vals: Record<string, unknown>) => {
                eq: (col: string, val: string) => Promise<{ error: unknown }>;
              };
            }
          )
            .update({
              status: "promoted",
              promoted_visit_id: replacementVisitId,
            })
            .eq("id", topCandidate.id);

          // Audit auto-promotion
          await recordAudit(
            {
              action: "visit.auto_promoted_from_waitlist",
              entityType: "visit",
              entityId: replacementVisitId,
              metadata: {
                promoted_from_waitlist_id: topCandidate.id,
                promoted_visit_id: replacementVisitId,
              },
            },
            clientOverride,
            session
          );
        }
      }
    }

    try {
      revalidatePath("/calendar");
      revalidatePath("/queue");
    } catch {
      // Ignore
    }

    return {
      success: true,
      autoPromoted,
      replacementVisitId,
      promotedPatientId,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to cancel visit.",
    };
  }
}

/**
 * Retrieves the list of active doctors in the clinic for filter dropdowns.
 */
export async function getActiveClinicDoctors(
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<ActiveDoctorOption[]> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:view"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (supabase.from("memberships") as any)
      .select("id, user_id, full_name, qualifications, default_specialty, role")
      .eq("tenant_id", session.tenantId)
      .in("role", ["doctor", "owner", "admin"])
      .order("created_at", { ascending: true });

    if (error || !rows) {
      console.error("[getActiveClinicDoctors] Error querying doctors:", error);
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      full_name: r.full_name || (r.role === "doctor" ? "Doctor" : "Clinic Doctor"),
      qualifications: r.qualifications || null,
      specialty: r.default_specialty || null,
    }));
  } catch (err: unknown) {
    console.error("[getActiveClinicDoctors] Unexpected error:", err);
    return [];
  }
}

/**
 * Retrieves the unified register of clinic visits with filtering, search, pagination, and metrics.
 */
export async function getClinicVisitsRegister(
  input: Partial<VisitsFilterInput> = {},
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<ClinicVisitsRegisterResult> {
  const parsed = visitsFilterSchema.parse(input);
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:view"));

    // 1. Compute date range
    const { startIso, endIso } = computeDateRange(
      parsed.datePreset,
      parsed.startDate,
      parsed.endDate
    );

    // 2. Build base query with tenant isolation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from("visits") as any)
      .select(
        "id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, reason_for_visit, vitals, chief_complaints, clinical_notes, specialty, investigations_advised, advice, created_at, updated_at"
      )
      .eq("tenant_id", session.tenantId)
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    if (parsed.doctorId && parsed.doctorId !== "all") {
      query = query.eq("doctor_id", parsed.doctorId);
    }

    if (parsed.status && parsed.status !== "all") {
      query = query.eq("status", parsed.status);
    }

    if (parsed.specialty && parsed.specialty !== "all") {
      query = query.eq("specialty", parsed.specialty);
    }

    // Handle patient search if provided
    if (parsed.searchQuery && parsed.searchQuery.trim()) {
      const clean = parsed.searchQuery.trim().replace(/[,()]/g, " ");
      if (clean) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: matchedPatients } = await (supabase.from("patients") as any)
          .select("id")
          .eq("tenant_id", session.tenantId)
          .or(`full_name.ilike.%${clean}%,phone.ilike.%${clean}%,abha_id.ilike.%${clean}%`)
          .limit(100);

        const patientIds = (matchedPatients || []).map((p: { id: string }) => p.id);
        if (patientIds.length === 0) {
          // No patients matched query
          return {
            visits: [],
            metrics: {
              totalVisits: 0,
              completedVisits: 0,
              inProgressVisits: 0,
              waitingVisits: 0,
              totalBilledRevenue: 0,
            },
            totalCount: 0,
            page: parsed.page,
            pageSize: parsed.pageSize,
            totalPages: 0,
          };
        }
        query = query.in("patient_id", patientIds);
      }
    }

    // 3. Execute query for matching visits in period
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: allVisits, error: visitsErr } = await query.order("created_at", {
      ascending: false,
    });

    if (visitsErr || !allVisits) {
      console.error("[getClinicVisitsRegister] Error fetching visits:", visitsErr);
      return {
        visits: [],
        metrics: {
          totalVisits: 0,
          completedVisits: 0,
          inProgressVisits: 0,
          waitingVisits: 0,
          totalBilledRevenue: 0,
        },
        totalCount: 0,
        page: parsed.page,
        pageSize: parsed.pageSize,
        totalPages: 0,
      };
    }

    // 4. Calculate summary metrics across all period visits
    const totalVisits = allVisits.length;
    let completedVisits = 0;
    let inProgressVisits = 0;
    let waitingVisits = 0;
    for (const v of allVisits) {
      if (v.status === "completed") completedVisits++;
      else if (v.status === "in_consultation") inProgressVisits++;
      else if (v.status === "waiting") waitingVisits++;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allVisitIds = allVisits.map((v: any) => v.id);

    // Query invoices for revenue calculation
    let totalBilledRevenue = 0;
    if (allVisitIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: periodInvoices } = await (supabase.from("invoices") as any)
        .select("total_amount")
        .eq("tenant_id", session.tenantId)
        .in("visit_id", allVisitIds);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const inv of periodInvoices || []) {
        totalBilledRevenue += Number(inv.total_amount) || 0;
      }
    }

    // 5. Paginate for current page
    const totalCount = allVisits.length;
    const totalPages = Math.ceil(totalCount / parsed.pageSize) || 1;
    const startIndex = (parsed.page - 1) * parsed.pageSize;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paginatedRows = allVisits.slice(startIndex, startIndex + parsed.pageSize);

    if (paginatedRows.length === 0) {
      return {
        visits: [],
        metrics: {
          totalVisits,
          completedVisits,
          inProgressVisits,
          waitingVisits,
          totalBilledRevenue: Math.round(totalBilledRevenue * 100) / 100,
        },
        totalCount,
        page: parsed.page,
        pageSize: parsed.pageSize,
        totalPages,
      };
    }

    // 6. Gather patient, doctor, diagnoses, prescription, invoice data for paginated rows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pageVisitIds = paginatedRows.map((v: any) => v.id);
    const pagePatientIds = Array.from(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Set(paginatedRows.map((v: any) => v.patient_id).filter(Boolean))
    );
    const pageDoctorIds = Array.from(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Set(paginatedRows.map((v: any) => v.doctor_id).filter(Boolean))
    );

    const [patientsRes, doctorsRes, tokensRes, diagRes, rxRes, invRes] = await Promise.all([
      pagePatientIds.length > 0
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase.from("patients") as any)
            .select("id, full_name, phone, age, sex, abha_id")
            .eq("tenant_id", session.tenantId)
            .in("id", pagePatientIds)
        : Promise.resolve({ data: [] }),
      pageDoctorIds.length > 0
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase.from("memberships") as any)
            .select("user_id, full_name, qualifications, default_specialty, role")
            .eq("tenant_id", session.tenantId)
            .in("user_id", pageDoctorIds)
        : Promise.resolve({ data: [] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("queue_tokens") as any)
        .select("visit_id, token_number")
        .eq("tenant_id", session.tenantId)
        .in("visit_id", pageVisitIds),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("consultation_diagnoses") as any)
        .select("id, visit_id, diagnosis_name, icd11_code, snomed_concept_id, is_chronic")
        .eq("tenant_id", session.tenantId)
        .in("visit_id", pageVisitIds),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("prescriptions") as any)
        .select("id, visit_id, version, status, signed_at, created_at")
        .eq("tenant_id", session.tenantId)
        .in("visit_id", pageVisitIds)
        .order("version", { ascending: false }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("invoices") as any)
        .select("id, visit_id, invoice_number, total_amount, status")
        .eq("tenant_id", session.tenantId)
        .in("visit_id", pageVisitIds),
    ]);

    // Map patients
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patientMap = new Map<string, any>();
    for (const p of patientsRes.data || []) {
      patientMap.set(p.id, p);
    }

    // Map doctors
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doctorMap = new Map<string, any>();
    for (const d of doctorsRes.data || []) {
      doctorMap.set(d.user_id, {
        full_name: d.full_name || (d.role === "doctor" ? "Doctor" : "Staff"),
        qualifications: d.qualifications || null,
        specialty: d.default_specialty || null,
      });
    }

    // Map tokens
    const tokenMap = new Map<string, number>();
    for (const t of tokensRes.data || []) {
      if (t.visit_id) tokenMap.set(t.visit_id, t.token_number);
    }

    // Map diagnoses
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const diagMap = new Map<string, any[]>();
    for (const d of diagRes.data || []) {
      const list = diagMap.get(d.visit_id) || [];
      list.push(d);
      diagMap.set(d.visit_id, list);
    }

    // Map prescriptions & items
    const rxList = rxRes.data || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latestRxPerVisit = new Map<string, any>();
    for (const rx of rxList) {
      if (!latestRxPerVisit.has(rx.visit_id)) {
        latestRxPerVisit.set(rx.visit_id, rx);
      } else if (rx.status === "active" && latestRxPerVisit.get(rx.visit_id).status !== "active") {
        latestRxPerVisit.set(rx.visit_id, rx);
      }
    }

    const rxIds = Array.from(latestRxPerVisit.values()).map((rx: { id: string }) => rx.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemsByRx: Record<string, any[]> = {};
    if (rxIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: itemRows } = await (supabase.from("prescription_items") as any)
        .select(
          "id, prescription_id, medicine_name, dose_form, dosage, timing, duration, sort_order"
        )
        .in("prescription_id", rxIds)
        .order("sort_order", { ascending: true });
      for (const item of itemRows || []) {
        itemsByRx[item.prescription_id] = itemsByRx[item.prescription_id] || [];
        itemsByRx[item.prescription_id].push(item);
      }
    }

    // Map invoices & payments
    const invoiceList = invRes.data || [];
    const invoiceIds = invoiceList.map((inv: { id: string }) => inv.id);
    const paymentsByInvoice: Record<string, number> = {};
    if (invoiceIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: paymentRows } = await (supabase.from("payments") as any)
        .select("invoice_id, amount")
        .eq("tenant_id", session.tenantId)
        .in("invoice_id", invoiceIds);
      for (const p of paymentRows || []) {
        paymentsByInvoice[p.invoice_id] =
          (paymentsByInvoice[p.invoice_id] || 0) + Number(p.amount);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoiceByVisit = new Map<string, any>();
    for (const inv of invoiceList) {
      const totalPaid = paymentsByInvoice[inv.id] || 0;
      const totalAmount = Number(inv.total_amount) || 0;
      invoiceByVisit.set(inv.visit_id, {
        id: inv.id,
        invoice_number: inv.invoice_number,
        total_amount: totalAmount,
        status: inv.status,
        total_paid: totalPaid,
        balance_due: Math.max(0, totalAmount - totalPaid),
      });
    }

    // 7. Assemble items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mappedVisits: ClinicVisitRegisterItem[] = paginatedRows.map((v: any) => {
      const pat = patientMap.get(v.patient_id) || {
        id: v.patient_id,
        full_name: "Patient",
        phone: "",
        age: null,
        sex: null,
        abha_id: null,
      };

      const doc = doctorMap.get(v.doctor_id) || {
        full_name: "Doctor",
        qualifications: null,
        specialty: null,
      };

      const rx = latestRxPerVisit.get(v.id);
      const rxItems = rx ? itemsByRx[rx.id] || [] : [];

      return {
        id: v.id,
        patient: {
          id: pat.id,
          full_name: pat.full_name,
          phone: pat.phone,
          age: pat.age,
          sex: pat.sex,
          abha_id: pat.abha_id,
        },
        doctor: {
          id: v.doctor_id,
          full_name: doc.full_name,
          qualifications: doc.qualifications,
          specialty: doc.specialty,
        },
        scheduled_at: v.scheduled_at,
        created_at: v.created_at,
        status: v.status,
        origin_type: v.origin_type,
        specialty: v.specialty,
        token_number: tokenMap.get(v.id) || null,
        reason_for_visit: v.reason_for_visit,
        clinical_notes: v.clinical_notes,
        chief_complaints: v.chief_complaints || [],
        diagnoses: diagMap.get(v.id) || [],
        prescription: rx
          ? {
              id: rx.id,
              version: rx.version,
              status: rx.status,
              signed_at: rx.signed_at,
              item_count: rxItems.length,
              items: rxItems,
            }
          : null,
        invoice: invoiceByVisit.get(v.id) || null,
        vitals: v.vitals,
        advice: v.advice,
      };
    });

    return {
      visits: mappedVisits,
      metrics: {
        totalVisits,
        completedVisits,
        inProgressVisits,
        waitingVisits,
        totalBilledRevenue: Math.round(totalBilledRevenue * 100) / 100,
      },
      totalCount,
      page: parsed.page,
      pageSize: parsed.pageSize,
      totalPages,
    };
  } catch (err: unknown) {
    console.error("[getClinicVisitsRegister] Unexpected error:", err);
    return {
      visits: [],
      metrics: {
        totalVisits: 0,
        completedVisits: 0,
        inProgressVisits: 0,
        waitingVisits: 0,
        totalBilledRevenue: 0,
      },
      totalCount: 0,
      page: parsed.page,
      pageSize: parsed.pageSize,
      totalPages: 0,
    };
  }
}

/**
 * Records or updates triage vitals on an active or waiting visit record.
 * Accessible to Nurses, Doctors, Admins, and Owners with "vitals:edit" permission.
 */
export async function recordVisitVitals(
  visitId: string,
  vitalsInput: Vitals,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: true; vitals: Vitals } | { success: false; error: string }> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("vitals:edit"));

    // Validate vitals schema
    const parseResult = vitalsSchema.safeParse(vitalsInput);
    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error.errors[0]?.message || "Invalid vitals data.",
      };
    }

    const validated = { ...parseResult.data };

    // Auto-calculate BMI if height and weight are provided
    if (validated.weight && validated.height && validated.height > 0) {
      const hm = validated.height / 100;
      validated.bmi = Number((validated.weight / (hm * hm)).toFixed(1));
    }

    const nowIso = new Date().toISOString();
    const vitalsToSave: Vitals = {
      ...validated,
      recorded_at: validated.recorded_at || nowIso,
      recorded_by: validated.recorded_by || session.userId,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase.from("visits") as any)
      .update({
        vitals: vitalsToSave,
        updated_at: nowIso,
      })
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId);

    if (updateError) {
      console.error("[recordVisitVitals] Failed to update vitals:", updateError);
      return { success: false, error: "Failed to record patient vitals." };
    }

    await recordAudit(
      {
        action: "vitals.record",
        entityType: "visit",
        entityId: visitId,
        metadata: {
          fields_changed: ["vitals"],
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/queue");
      revalidatePath("/visits");
      revalidatePath("/cabin");
      revalidatePath(`/consultation/${visitId}`);
    } catch {
      // Ignore in non-Next.js runtime (e.g. tests)
    }

    return { success: true, vitals: vitalsToSave };
  } catch (err: unknown) {
    console.error("[recordVisitVitals] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to record patient vitals.",
    };
  }
}
