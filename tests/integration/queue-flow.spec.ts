import { describe, it, expect, beforeAll } from "vitest";
import { DEFAULT_CLINIC_TZ, todayInTz } from "@/lib/datetime";
import { seedTenantWithOwner } from "../helpers/tenants";
import { createVisit } from "@/features/visits/service";
import { ctxFor } from "../helpers/context";
import { checkInVisit, transitionQueueState, getQueueForDate } from "@/features/queue/service";

describe("Queue Progression & Reception Flow (REQ-appointment-booking, REQ-multi-tenancy)", () => {
  let tenant: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let patientAId: string;
  let patientBId: string;
  let walkInVisitId: string;
  let scheduledVisitId: string;

  beforeAll(async () => {
    tenant = await seedTenantWithOwner("Metro Health Clinic");

    // Create 2 test patients for Metro Health Clinic
    const { data: p1, error: p1Err } = await tenant.client
      .from("patients")
      .insert({
        tenant_id: tenant.tenantId,
        full_name: "Anita Desai",
        phone: "+919111222333",
        age: 32,
        created_by: tenant.userId,
      })
      .select("id")
      .single();

    if (p1Err || !p1) throw new Error(`Failed to create test patient A: ${p1Err?.message}`);
    patientAId = p1.id;

    const { data: p2, error: p2Err } = await tenant.client
      .from("patients")
      .insert({
        tenant_id: tenant.tenantId,
        full_name: "Karan Johar",
        phone: "+919444555666",
        age: 45,
        created_by: tenant.userId,
      })
      .select("id")
      .single();

    if (p2Err || !p2) throw new Error(`Failed to create test patient B: ${p2Err?.message}`);
    patientBId = p2.id;
  });

  it("1. Adding a walk-in patient creates a visit with origin_type='walk_in', generates token #1, and sets status 'waiting'", async () => {

    // 1. Create walk-in visit
    const visitRes = await createVisit(
      ctxFor(tenant),
      {
        patient_id: patientAId,
        doctor_id: tenant.userId,
        origin_type: "walk_in",
        reason_for_visit: "Acute fever and headache",
        estimated_duration_minutes: 15,
        is_overbooked: false,
      }
    );

    expect(visitRes.success).toBe(true);
    if (!visitRes.success) return;
    walkInVisitId = visitRes.visitId;

    // 2. Check in the walk-in visit to issue token
    const checkInRes = await checkInVisit(ctxFor(tenant), walkInVisitId, "normal");
    expect(checkInRes.success).toBe(true);
    if (!checkInRes.success) return;
    expect(checkInRes.tokenNumber).toBe(1);

    // 3. Verify database state
    const { data: visitRow } = await tenant.client
      .from("visits")
      .select("origin_type, status")
      .eq("id", walkInVisitId)
      .single();

    expect(visitRow?.origin_type).toBe("walk_in");
    expect(visitRow?.status).toBe("waiting");

    const { data: tokenRow } = await tenant.client
      .from("queue_tokens")
      .select("token_number, priority, called_at, completed_at")
      .eq("visit_id", walkInVisitId)
      .single();

    expect(tokenRow?.token_number).toBe(1);
    expect(tokenRow?.priority).toBe("normal");
    expect(tokenRow?.called_at).toBeNull();
    expect(tokenRow?.completed_at).toBeNull();
  });

  it("2. Scheduled appointment checking in generates next token and transitions to 'waiting'", async () => {
    const scheduledTime = new Date().toISOString();

    // 1. Create scheduled appointment
    const visitRes = await createVisit(
      ctxFor(tenant),
      {
        patient_id: patientBId,
        doctor_id: tenant.userId,
        origin_type: "scheduled",
        scheduled_at: scheduledTime,
        reason_for_visit: "Follow-up consultation",
        estimated_duration_minutes: 20,
        is_overbooked: false,
      }
    );

    expect(visitRes.success).toBe(true);
    if (!visitRes.success) return;
    scheduledVisitId = visitRes.visitId;

    // Initially status is 'booked'
    const { data: initialVisit } = await tenant.client
      .from("visits")
      .select("status, origin_type")
      .eq("id", scheduledVisitId)
      .single();

    expect(initialVisit?.origin_type).toBe("scheduled");
    expect(initialVisit?.status).toBe("booked");

    // 2. Check in the scheduled visit
    const checkInRes = await checkInVisit(ctxFor(tenant), scheduledVisitId, "normal");
    expect(checkInRes.success).toBe(true);
    if (!checkInRes.success) return;
    // Should receive sequential token #2
    expect(checkInRes.tokenNumber).toBe(2);

    // Verify status transitioned to 'waiting'
    const { data: updatedVisit } = await tenant.client
      .from("visits")
      .select("status")
      .eq("id", scheduledVisitId)
      .single();

    expect(updatedVisit?.status).toBe("waiting");
  });

  it("3. Moving patient from 'waiting' to 'in_consultation' sets called_at timestamp", async () => {

    const transitionRes = await transitionQueueState(ctxFor(tenant), walkInVisitId, "in_consultation");

    expect(transitionRes.success).toBe(true);

    // Verify visit status is now 'in_consultation'
    const { data: visitRow } = await tenant.client
      .from("visits")
      .select("status")
      .eq("id", walkInVisitId)
      .single();

    expect(visitRow?.status).toBe("in_consultation");

    // Verify queue_tokens called_at is now populated
    const { data: tokenRow } = await tenant.client
      .from("queue_tokens")
      .select("called_at, completed_at")
      .eq("visit_id", walkInVisitId)
      .single();

    expect(tokenRow?.called_at).not.toBeNull();
    expect(tokenRow?.completed_at).toBeNull();
  });

  it("4. Completing visit sets completed_at and removes patient from active waiting count", async () => {

    const transitionRes = await transitionQueueState(ctxFor(tenant), walkInVisitId, "completed");

    expect(transitionRes.success).toBe(true);

    // Verify visit status is now 'completed'
    const { data: visitRow } = await tenant.client
      .from("visits")
      .select("status")
      .eq("id", walkInVisitId)
      .single();

    expect(visitRow?.status).toBe("completed");

    // Verify queue_tokens completed_at is populated
    const { data: tokenRow } = await tenant.client
      .from("queue_tokens")
      .select("called_at, completed_at")
      .eq("visit_id", walkInVisitId)
      .single();

    expect(tokenRow?.called_at).not.toBeNull();
    expect(tokenRow?.completed_at).not.toBeNull();

    // Verify live queue query has 1 waiting patient (patient B), 0 with doctor, 1 completed
    // The clinic date in the tenant zone (default Asia/Kolkata), as the service computes it (V2-03 03-05).
    const today = todayInTz(DEFAULT_CLINIC_TZ);
    const queueRes = await getQueueForDate(ctxFor(tenant), today);
    expect(queueRes.success).toBe(true);

    if (queueRes.success) {
      const waiting = queueRes.items.filter((i) => i.visit.status === "waiting");
      const inConsult = queueRes.items.filter((i) => i.visit.status === "in_consultation");
      const completed = queueRes.items.filter((i) => i.visit.status === "completed");

      expect(waiting.length).toBe(1);
      expect(waiting[0].visit.id).toBe(scheduledVisitId);
      expect(inConsult.length).toBe(0);
      expect(completed.some((i) => i.visit.id === walkInVisitId)).toBe(true);
    }
  });
});
