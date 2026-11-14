import "server-only";

import { z } from "zod";
import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { memberOfTenant, patientInTenant } from "@/lib/auth/tenant-refs";
import { isDateOnly } from "@/lib/utils/filter-values";
import { dayWindowUtc, ymdOf } from "@/lib/datetime";
import { getTenantTimeZone } from "@/lib/datetime/server";
import { Visit, VisitStatus } from "@/lib/db/types";
import { clinicalNotesEmbed, updateClinicalNotes, withClinicalNotes } from "@/lib/db/clinical-notes";
import {
  visitsFilterSchema,
  VisitsFilterInput,
  computeDateRange,
  ClinicVisitRegisterItem,
  ClinicVisitsRegisterResult,
  ActiveDoctorOption,
} from "./schema";
import { recordVitalsInputSchema, type RecordVitalsInput, type Vitals } from "@/features/consultation/schema";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { clientErrorMessage } from "@/lib/errors/client-message";
import { mapDbError, type DbErrorLike } from "@/lib/db/errors";
import type { AppErrorCode } from "@/lib/errors/app-error";

// Visit use-cases. The acting tenant and user come only from `ctx` (ADR-0005 D1); each use-case checks the same
// permission its server action checked before the move, so service→service chains are checked too.

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

/**
 * The reason a visit insert carries when the doctor's slot was taken between the slot check and the insert: the
 * `visits_no_double_booking` exclusion constraint (V2-05 05-08, DB-08) refuses a second overlapping, non-overbooked
 * scheduled visit with SQLSTATE 23P01, which `mapDbError` maps to CONFLICT with the constraint name as the reason.
 */
export const SLOT_TAKEN_REASON = "VISITS_NO_DOUBLE_BOOKING";
export const SLOT_TAKEN_MESSAGE =
  "This slot was just booked for the doctor. Pick another time, or confirm the overbooking.";

/** True when a visit write was refused because the doctor's slot is taken ({@link SLOT_TAKEN_REASON}). */
export function isSlotTakenError(err: DbErrorLike | null | undefined): boolean {
  return mapDbError(err).reason === SLOT_TAKEN_REASON;
}

export type CreateVisitResult =
  | { success: true; visitId: string }
  | {
      success: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
      /** Set when the slot was taken (CONFLICT, reason {@link SLOT_TAKEN_REASON}). */
      conflict?: true;
      code?: AppErrorCode;
      reason?: string;
    };

export async function createVisit(ctx: ServiceContext, input: CreateVisitInput): Promise<CreateVisitResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:edit");
    const session = ctx;

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
    const data = parseResult.data;

    // The patient and the doctor must belong to the caller's clinic (P0-13: the FKs and RLS do not check this).
    if (!(await patientInTenant(ctx, data.patient_id))) {
      return { success: false, error: "Patient not found or access denied." };
    }
    if (!(await memberOfTenant(ctx, data.doctor_id))) {
      return { success: false, error: "Doctor not found in this clinic." };
    }

    // Insert visit under RLS. Two concurrent inserts of conflicting slots can both find the other's not-yet-committed
    // row while checking `visits_no_double_booking`; PostgreSQL then aborts one of them as a deadlock (40P01) instead
    // of 23P01. The other transaction goes on and commits, so one retry answers definitively: 23P01 (the slot is
    // taken) or, if the other failed, the booking itself (V2-05 05-08).
    const insertVisit = () => (
      supabase.from("visits") as unknown as {
        insert: (row: Record<string, unknown>) => {
          select: (cols: string) => {
            single: () => Promise<{ data: { id: string } | null; error: { code?: string; message: string } | null }>;
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
    let { data: newVisit, error: insertError } = await insertVisit();
    if (insertError?.code === "40P01") ({ data: newVisit, error: insertError } = await insertVisit());

    if (insertError || !newVisit) {
      const mapped = mapDbError(insertError, { [SLOT_TAKEN_REASON]: SLOT_TAKEN_MESSAGE });
      if (mapped.reason === SLOT_TAKEN_REASON) {
        // Expected under concurrency (two desks booking one slot): not an error to alert on.
        return { success: false, error: mapped.message, conflict: true, code: mapped.code, reason: mapped.reason };
      }
      log.error({ event: "visits.create_insert.failed", code: errorTag(insertError), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to schedule visit in database." };
    }

    await recordAudit(ctx, {
      action: "visit.create",
      entityType: "visit",
      entityId: newVisit.id,
      metadata: {
        origin_type: data.origin_type,
        fields_changed: ["created"],
      },
    });

    return { success: true, visitId: newVisit.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to create visit.", "visits.create_visit.failed"),
    };
  }
}

export type GetVisitsResult =
  | { success: true; visits: Visit[] }
  | { success: false; error: string };

export async function getVisitsForDate(
  ctx: ServiceContext,
  dateStr: string,
  doctorId?: string
): Promise<GetVisitsResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:view");
    const session = ctx;

    // The date is interpolated into a PostgREST filter string below, so only YYYY-MM-DD is accepted.
    if (!isDateOnly(dateStr)) {
      return { success: false, error: "Failed to load visits for the selected date." };
    }

    // The clinic day in the tenant's zone, half-open (V2-03 03-05): a 02:00 IST visit belongs to its IST date.
    const { startIso: startOfDay, endIsoExclusive: endOfDay } = dayWindowUtc(
      dateStr,
      await getTenantTimeZone(supabase, session.tenantId)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = (supabase.from("visits") as any)
      .select("*, patients(full_name, phone, age, date_of_birth)")
      .eq("tenant_id", session.tenantId)
      .or(`and(scheduled_at.gte.${startOfDay},scheduled_at.lt.${endOfDay}),and(scheduled_at.is.null,created_at.gte.${startOfDay},created_at.lt.${endOfDay})`);

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
      log.error({ event: "visits.list_query.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to load visits for the selected date." };
    }

    return { success: true, visits: (data as Visit[]) || [] };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to fetch visits.", "visits.get_visits_for_date.failed"),
    };
  }
}

export type UpdateVisitStatusResult =
  | { success: true }
  | { success: false; error: string };

export async function updateVisitStatus(
  ctx: ServiceContext,
  visitId: string,
  newStatus: VisitStatus
): Promise<UpdateVisitStatusResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:edit");

    // Fetch existing visit
    // By id AND the active clinic: RLS admits every clinic the user belongs to (AR-M2b).
    const { data: existing, error: readError } = (await (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from("visits") as any
    )
      .select("*")
      .eq("id", visitId)
      .eq("tenant_id", ctx.tenantId)
      .single()) as { data: Visit | null; error: { message: string } | null };

    if (readError || !existing) {
      return { success: false, error: "Visit not found or inaccessible." };
    }

    const oldStatus = existing.status;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase.from("visits") as any)
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitId)
      .eq("tenant_id", ctx.tenantId);

    if (updateError) {
      log.error({ event: "visits.status_update.failed", code: errorTag(updateError), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to update visit status." };
    }

    await recordAudit(ctx, {
      action: "visit.status_update",
      entityType: "visit",
      entityId: visitId,
      metadata: {
        old_status: oldStatus,
        new_status: newStatus,
        fields_changed: ["status"],
      },
    });

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to update visit status.", "visits.update_visit_status.failed"),
    };
  }
}

export type ConfirmAppointmentResult =
  | { success: true }
  | { success: false; error: string };

export async function confirmAppointment(ctx: ServiceContext, visitId: string): Promise<ConfirmAppointmentResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:edit");
    const session = ctx;

    // Fetch existing visit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: readError } = await (supabase.from("visits") as any)
      .select("id, status, metadata")
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (readError || !existing) {
      log.error({ event: "visits.confirm_read.failed", code: errorTag(readError), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Appointment not found or inaccessible." };
    }

    if (existing.status === "cancelled") {
      return { success: false, error: "Cannot confirm a cancelled appointment." };
    }

    if (existing.status === "confirmed") {
      return { success: true };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId);

    if (updateError) {
      log.error({ event: "visits.confirm_update.failed", code: errorTag(updateError), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to confirm appointment." };
    }

    await recordAudit(ctx, {
      action: "visit.confirm",
      entityType: "visit",
      entityId: visitId,
      metadata: {
        old_status: existing.status,
        new_status: "confirmed",
        confirmed_via: "staff_calendar",
      },
    });

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to confirm appointment.", "visits.confirm_appointment.failed"),
    };
  }
}

export type CancelVisitResult =
  | { success: true; autoPromoted: boolean; replacementVisitId?: string; promotedPatientId?: string }
  | { success: false; error: string };

export async function cancelVisit(ctx: ServiceContext, visitId: string): Promise<CancelVisitResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:edit");
    const session = ctx;

    // 1. Fetch existing visit
    // By id AND the active clinic: RLS admits every clinic the user belongs to (AR-M2b).
    const { data: existing, error: readError } = (await (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from("visits") as any
    )
      .select("*")
      .eq("id", visitId)
      .eq("tenant_id", ctx.tenantId)
      .single()) as { data: Visit | null; error: { message: string } | null };

    if (readError || !existing) {
      return { success: false, error: "Visit not found." };
    }

    if (existing.status === "cancelled") {
      return { success: false, error: "Visit is already cancelled." };
    }

    // 2. Mark visit cancelled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("visits") as any)
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId);

    // 3. Audit cancellation
    await recordAudit(ctx, {
      action: "visit.cancel",
      entityType: "visit",
      entityId: visitId,
      metadata: {
        old_status: existing.status,
        new_status: "cancelled",
      },
    });

    // 4. Auto-promotion from waitlist (D-08)
    let autoPromoted = false;
    let replacementVisitId: string | undefined;
    let promotedPatientId: string | undefined;

    if (existing.scheduled_at) {
      const targetDate = ymdOf(existing.scheduled_at, await getTenantTimeZone(supabase, session.tenantId));

      // Query eligible waitlist entries for this tenant, target_date, status='waiting', and matching doctor
      interface WaitlistRow {
        id: string;
        patient_id: string;
        doctor_id: string | null;
        priority: number;
        created_at: string;
      }

      // existing.doctor_id is a uuid read from the visit row (not caller input).
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
        log.error({ event: "visits.cancel_candidates.failed", code: errorTag(candidateErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      }

      if (candidates && candidates.length > 0) {
        const topCandidate = candidates[0];

        // Create replacement visit (same context, so createVisit's own permission check applies)
        const newVisitRes = await createVisit(ctx, {
          patient_id: topCandidate.patient_id,
          doctor_id: existing.doctor_id,
          origin_type: "scheduled",
          scheduled_at: new Date(existing.scheduled_at).toISOString(),
          estimated_duration_minutes: existing.estimated_duration_minutes || 15,
          reason_for_visit: "Booked from waitlist",
          is_overbooked: false,
        });

        if (newVisitRes.success) {
          autoPromoted = true;
          replacementVisitId = newVisitRes.visitId;
          promotedPatientId = topCandidate.patient_id;

          // Mark candidate waitlist entry as promoted
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from("waitlist_entries") as any)
            .update({
              status: "promoted",
              promoted_visit_id: replacementVisitId,
            })
            .eq("id", topCandidate.id)
            .eq("tenant_id", session.tenantId);

          await recordAudit(ctx, {
            action: "visit.auto_promoted_from_waitlist",
            entityType: "visit",
            entityId: replacementVisitId,
            metadata: {
              promoted_from_waitlist_id: topCandidate.id,
              promoted_visit_id: replacementVisitId,
            },
          });
        }
      }
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
      error: clientErrorMessage(err, "Failed to cancel visit.", "visits.cancel_visit.failed"),
    };
  }
}

/**
 * Retrieves the list of active doctors in the clinic for filter dropdowns.
 */
export async function getActiveClinicDoctors(ctx: ServiceContext): Promise<ActiveDoctorOption[]> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:view");
    const session = ctx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (supabase.from("memberships") as any)
      .select("id, user_id, full_name, qualifications, default_specialty, role")
      .eq("tenant_id", session.tenantId)
      .in("role", ["doctor", "owner", "admin"])
      .order("created_at", { ascending: true });

    if (error || !rows) {
      log.error({ event: "visits.doctors_query.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
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
    log.error({ event: "visits.doctors.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }
}

/** The empty register returned on any failure (and to an unauthenticated caller). */
export function emptyVisitsRegister(page: number, pageSize: number): ClinicVisitsRegisterResult {
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
    page,
    pageSize,
    totalPages: 0,
  };
}

/**
 * Retrieves the unified register of clinic visits with filtering, search, pagination, and metrics.
 * Invalid filter input throws (zod), as before.
 */
export async function getClinicVisitsRegister(
  ctx: ServiceContext,
  input: Partial<VisitsFilterInput> = {}
): Promise<ClinicVisitsRegisterResult> {
  const parsed = visitsFilterSchema.parse(input);
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:view");
    const session = ctx;

    // 1. Compute date range
    const { startIso, endIsoExclusive } = computeDateRange(
      parsed.datePreset,
      parsed.startDate,
      parsed.endDate,
      await getTenantTimeZone(supabase, session.tenantId)
    );

    // 2. Build base query with tenant isolation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from("visits") as any)
      .select(
        `id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, reason_for_visit, specialty, created_at, updated_at, ${clinicalNotesEmbed(["vitals", "chief_complaints", "clinical_notes", "advice"])}`
      )
      .eq("tenant_id", session.tenantId)
      .gte("created_at", startIso)
      .lt("created_at", endIsoExclusive);

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
        const digitsOnly = clean.replace(/\D/g, "");
        let orClause = `full_name.ilike.%${clean}%,phone.ilike.%${clean}%,abha_id.ilike.%${clean}%`;
        if (digitsOnly.length >= 3) {
          if (!orClause.includes(`phone.ilike.%${digitsOnly}%`)) {
            orClause += `,phone.ilike.%${digitsOnly}%`;
          }
          if (!orClause.includes(`phone.ilike.%+91${digitsOnly}%`)) {
            orClause += `,phone.ilike.%+91${digitsOnly}%`;
          }
          if (digitsOnly.startsWith("91") && digitsOnly.length >= 5) {
            const subscriber = digitsOnly.slice(2);
            if (!orClause.includes(`phone.ilike.%${subscriber}%`)) {
              orClause += `,phone.ilike.%${subscriber}%`;
            }
            if (!orClause.includes(`phone.ilike.%+91${subscriber}%`)) {
              orClause += `,phone.ilike.%+91${subscriber}%`;
            }
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: matchedPatients } = await (supabase.from("patients") as any)
          .select("id")
          .eq("tenant_id", session.tenantId)
          .or(orClause)
          .limit(100);

        const patientIds = (matchedPatients || []).map((p: { id: string }) => p.id);
        if (patientIds.length === 0) {
          // No patients matched query
          return emptyVisitsRegister(parsed.page, parsed.pageSize);
        }
        query = query.in("patient_id", patientIds);
      }
    }

    // 3. Execute query for matching visits in period
    const { data: allVisits, error: visitsErr } = await query.order("created_at", {
      ascending: false,
    });

    if (visitsErr || !allVisits) {
      log.error({ event: "visits.register_query.failed", code: errorTag(visitsErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return emptyVisitsRegister(parsed.page, parsed.pageSize);
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

      for (const inv of periodInvoices || []) {
        totalBilledRevenue += Number(inv.total_amount) || 0;
      }
    }

    // 5. Paginate for current page
    const totalCount = allVisits.length;
    const totalPages = Math.ceil(totalCount / parsed.pageSize) || 1;
    const startIndex = (parsed.page - 1) * parsed.pageSize;
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
    // Clinical content from clinical_notes (05-02a): null for a role that may not read it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mappedVisits: ClinicVisitRegisterItem[] = paginatedRows.map(withClinicalNotes).map((v: any) => {
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
    log.error({ event: "visits.register.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return emptyVisitsRegister(parsed.page, parsed.pageSize);
  }
}

export type RecordVisitVitalsResult = { success: true; vitals: Vitals } | { success: false; error: string };

/**
 * Records or updates triage vitals on an active or waiting visit record ("vitals:edit": nurses, doctors, owners).
 * The recorder is always the session user: `recorded_by` is not part of the input (ADR-0005 D1, SEC-02).
 */
export async function recordVisitVitals(
  ctx: ServiceContext,
  visitId: string,
  vitalsInput: RecordVitalsInput
): Promise<RecordVisitVitalsResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "vitals:edit");
    const session = ctx;

    // Validate vitals schema (a caller-sent recorded_by is stripped here)
    const parseResult = recordVitalsInputSchema.safeParse(vitalsInput);
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
      recorded_by: session.userId,
    };

    // Vitals live in clinical_notes (V2-05 05-02a, R-3): a nurse may change `vitals` only (guard trigger); a visit the
    // caller may not change (another clinic, a role without vitals:edit) affects 0 rows and is refused, never reported
    // as recorded.
    const { error: updateError, raw } = await updateClinicalNotes(supabase, session.tenantId, visitId, {
      vitals: vitalsToSave as Record<string, unknown>,
    });

    if (updateError) {
      if (updateError.code === "FORBIDDEN") {
        log.warn({ event: "visits.vitals_update.refused", reason: updateError.reason === "ROW_NOT_AFFECTED" ? "row_not_affected" : "forbidden", requestId: await getRequestId(), tenantId: ctx.tenantId });
        return { success: false, error: updateError.message };
      }
      log.error({ event: "visits.vitals_update.failed", code: errorTag(raw), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to record patient vitals." };
    }

    await recordAudit(ctx, {
      action: "vitals.record",
      entityType: "visit",
      entityId: visitId,
      metadata: {
        fields_changed: ["vitals"],
      },
    });

    return { success: true, vitals: vitalsToSave };
  } catch (err: unknown) {
    log.error({ event: "visits.vitals.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to record patient vitals."),
    };
  }
}
