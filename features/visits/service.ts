import "server-only";

import { z } from "zod";
import { DEFAULT_VISIT_DURATION_MINUTES, visitDurationSchema } from "./duration";
import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { memberOfTenant, patientInTenant } from "@/lib/auth/tenant-refs";
import { isDateOnly } from "@/lib/utils/filter-values";
import { dayWindowUtc } from "@/lib/datetime";
import { getTenantTimeZone } from "@/lib/datetime/server";
import { Visit } from "@/lib/db/types";
import { clinicalNotesEmbed, readStoredVitals, updateClinicalNotes, withClinicalNotes } from "@/lib/db/clinical-notes";
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
import { isDeadlock, retryOnDeadlock } from "@/lib/db/retry";
import type { AppErrorCode } from "@/lib/errors/app-error";

// Visit use-cases. The acting tenant and user come only from `ctx` (ADR-0005 D1); each use-case checks the same
// permission its server action checked before the move, so service→service chains are checked too.

/**
 * The reason a visit insert carries when the doctor's slot was taken between the slot check and the insert: the
 * `visits_no_double_booking` exclusion constraint (V2-05 05-08, DB-08) refuses a second overlapping, non-overbooked
 * scheduled visit with SQLSTATE 23P01, which `mapDbError` maps to CONFLICT with the constraint name as the reason.
 */
export const SLOT_TAKEN_REASON = "VISITS_NO_DOUBLE_BOOKING";
export const SLOT_TAKEN_MESSAGE =
  "This slot was just booked for the doctor. Pick another time, or confirm the overbooking.";

/**
 * True when a visit write was refused because the doctor's slot is taken ({@link SLOT_TAKEN_REASON}). A deadlock (40P01)
 * that survived the one {@link retryOnDeadlock} retry counts as taken too: only a concurrent write of an overlapping slot
 * produces one on a slot write, and that write went on (V2-05 05-11c).
 */
export function isSlotTakenError(err: DbErrorLike | null | undefined): boolean {
  return isDeadlock(err) || mapDbError(err).reason === SLOT_TAKEN_REASON;
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

/**
 * Retrieves the list of active doctors in the clinic for filter dropdowns.
 */
export async function getActiveClinicDoctors(ctx: ServiceContext): Promise<ActiveDoctorOption[]> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:view");
    const session = ctx;

    // V2-08 R-2: a doctor, or the owner when the owner practises. An admin is never offered, credentials or not.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tenant } = await (supabase.from("tenants") as any)
      .select("owner_is_practicing_doctor")
      .eq("id", session.tenantId)
      .single();
    const ownerPracticing = tenant?.owner_is_practicing_doctor ?? true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: allRows, error } = await (supabase.from("memberships") as any)
      .select("id, user_id, full_name, qualifications, default_specialty, role")
      .eq("tenant_id", session.tenantId)
      .eq("status", "active")
      .in("role", ["doctor", "owner"])
      .order("created_at", { ascending: true });

    if (error || !allRows) {
      log.error({ event: "visits.doctors_query.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return [];
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = allRows.filter((r: any) => r.role === "doctor" || ownerPracticing);

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

    // V2-08 08-06a (A-1): what the caller sent is merged into the record already stored, so recording one more reading
    // (pulse after the BP) never drops the earlier ones. A field the caller left empty keeps its stored value.
    const sent = Object.fromEntries(Object.entries(parseResult.data).filter(([, value]) => value !== null && value !== undefined));
    const stored = await readStoredVitals(supabase, session.tenantId, visitId);
    if (stored.error) {
      log.error({ event: "visits.vitals_read.failed", code: errorTag(stored.raw), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to record patient vitals." };
    }
    const validated = { ...stored.vitals, ...sent } as Vitals;

    // Auto-calculate BMI if height and weight are provided (from the merged record: a new weight re-computes it)
    if (validated.weight && validated.height && validated.height > 0) {
      const hm = validated.height / 100;
      validated.bmi = Number((validated.weight / (hm * hm)).toFixed(1));
    }

    const nowIso = new Date().toISOString();
    const vitalsToSave: Vitals = {
      ...validated,
      recorded_at: (sent.recorded_at as string | undefined) || nowIso,
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
