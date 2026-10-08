import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner } from "../helpers/tenants";
import { bookAppointment } from "@/features/visits/scheduling";
import { addToWaitlist, getWaitlistForDate } from "@/features/waitlist/actions";
import { cancelVisit, getVisitsForDate } from "@/features/visits/actions";

describe("Doctor Calendar Scheduling & Waitlist Promotion (REQ-appointment-booking, REQ-multi-tenancy)", () => {
  let tenant: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let patient1Id: string;
  let patient2Id: string;
  let patient3Id: string;
  let originalVisitId: string;
  let overbookedVisitId: string;
  let waitlistEntryId: string;

  const testDate = "2026-10-15";
  const testSlotTime = `${testDate}T10:00:00.000Z`;

  beforeAll(async () => {
    tenant = await seedTenantWithOwner("Zenith Care Clinic");

    // Create 3 test patients
    const { data: p1 } = await tenant.client
      .from("patients")
      .insert({
        tenant_id: tenant.tenantId,
        full_name: "Vikram Seth",
        phone: "+919988776655",
        age: 40,
        created_by: tenant.userId,
      })
      .select("id")
      .single();

    patient1Id = p1!.id;

    const { data: p2 } = await tenant.client
      .from("patients")
      .insert({
        tenant_id: tenant.tenantId,
        full_name: "Deepa Mehta",
        phone: "+919988776656",
        age: 36,
        created_by: tenant.userId,
      })
      .select("id")
      .single();

    patient2Id = p2!.id;

    const { data: p3 } = await tenant.client
      .from("patients")
      .insert({
        tenant_id: tenant.tenantId,
        full_name: "Arundhati Roy",
        phone: "+919988776657",
        age: 52,
        created_by: tenant.userId,
      })
      .select("id")
      .single();

    patient3Id = p3!.id;
  });

  it("1. Booking an appointment occupies the slot on the doctor's calendar", async () => {
    const session = { userId: tenant.userId, tenantId: tenant.tenantId };

    const res = await bookAppointment(
      {
        patient_id: patient1Id,
        doctor_id: tenant.userId,
        scheduled_at: testSlotTime,
        estimated_duration_minutes: 15,
        reason_for_visit: "Cardiac checkup",
        is_overbooked: false,
      },
      tenant.client,
      session
    );

    expect(res.success).toBe(true);
    if (!res.success) return;
    originalVisitId = res.visitId;

    // Verify visit saved in DB
    const { data: visitRow } = await tenant.client
      .from("visits")
      .select("id, status, scheduled_at, is_overbooked")
      .eq("id", originalVisitId)
      .single();

    expect(visitRow?.status).toBe("booked");
    expect(visitRow?.is_overbooked).toBe(false);
    expect(new Date(visitRow?.scheduled_at || "").getTime()).toBe(new Date(testSlotTime).getTime());
  });

  it("2. Attempting a second booking at the same time without override flag is rejected with conflict warning", async () => {
    const session = { userId: tenant.userId, tenantId: tenant.tenantId };

    const res = await bookAppointment(
      {
        patient_id: patient2Id,
        doctor_id: tenant.userId,
        scheduled_at: testSlotTime,
        estimated_duration_minutes: 15,
        reason_for_visit: "Routine follow-up",
        is_overbooked: false,
      },
      tenant.client,
      session
    );

    // Must be rejected with conflict
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.conflict).toBe(true);
    expect(res.conflictingVisit?.id).toBe(originalVisitId);
  });

  it("3. Confirming overbook override successfully schedules the second appointment with is_overbooked: true", async () => {
    const session = { userId: tenant.userId, tenantId: tenant.tenantId };

    const res = await bookAppointment(
      {
        patient_id: patient2Id,
        doctor_id: tenant.userId,
        scheduled_at: testSlotTime,
        estimated_duration_minutes: 15,
        reason_for_visit: "Urgent consultation",
        is_overbooked: true, // Overbooking confirmed
      },
      tenant.client,
      session
    );

    expect(res.success).toBe(true);
    if (!res.success) return;
    overbookedVisitId = res.visitId;

    // Verify visit saved in DB with is_overbooked = true
    const { data: visitRow } = await tenant.client
      .from("visits")
      .select("id, status, is_overbooked")
      .eq("id", overbookedVisitId)
      .single();

    expect(visitRow?.status).toBe("booked");
    expect(visitRow?.is_overbooked).toBe(true);
  });

  it("4. Adding a patient to the waitlist records an active entry under RLS", async () => {
    const session = { userId: tenant.userId, tenantId: tenant.tenantId };

    const res = await addToWaitlist(
      {
        patient_id: patient3Id,
        doctor_id: tenant.userId,
        target_date: testDate,
        time_window: "Morning (9 AM - 1 PM)",
        priority: 5,
        notes: "Flexible timing",
      },
      tenant.client,
      session
    );

    expect(res.success).toBe(true);
    if (!res.success) return;
    waitlistEntryId = res.entryId;

    // Verify waitlist row in DB
    const { data: entryRow } = await tenant.client
      .from("waitlist_entries")
      .select("id, status, priority, target_date")
      .eq("id", waitlistEntryId)
      .single();

    expect(entryRow?.status).toBe("waiting");
    expect(entryRow?.priority).toBe(5);
    expect(entryRow?.target_date).toBe(testDate);

    // Verify retrieval via getWaitlistForDate
    const listRes = await getWaitlistForDate(testDate, tenant.userId, tenant.client, session);
    expect(listRes.success).toBe(true);
    if (listRes.success) {
      expect(listRes.entries.some((e) => e.id === waitlistEntryId)).toBe(true);
    }
  });

  it("5. Cancelling the original appointment automatically promotes the waitlisted patient into the slot", async () => {
    const session = { userId: tenant.userId, tenantId: tenant.tenantId };

    // Cancel original appointment
    const cancelRes = await cancelVisit(originalVisitId, tenant.client, session);
    expect(cancelRes.success).toBe(true);
    expect(cancelRes.autoPromoted).toBe(true);
    expect(cancelRes.promotedPatientId).toBe(patient3Id);
    expect(cancelRes.replacementVisitId).toBeDefined();

    // Verify original visit is cancelled
    const { data: origVisit } = await tenant.client
      .from("visits")
      .select("status")
      .eq("id", originalVisitId)
      .single();
    expect(origVisit?.status).toBe("cancelled");

    // Verify waitlist entry is marked 'promoted'
    const { data: waitlistRow } = await tenant.client
      .from("waitlist_entries")
      .select("status, promoted_visit_id")
      .eq("id", waitlistEntryId)
      .single();

    expect(waitlistRow?.status).toBe("promoted");
    expect(waitlistRow?.promoted_visit_id).toBe(cancelRes.replacementVisitId);

    // Verify newly created replacement visit
    const { data: replacementVisit } = await tenant.client
      .from("visits")
      .select("patient_id, doctor_id, status, scheduled_at, reason_for_visit")
      .eq("id", cancelRes.replacementVisitId!)
      .single();

    expect(replacementVisit?.patient_id).toBe(patient3Id);
    expect(replacementVisit?.status).toBe("booked");
    expect(new Date(replacementVisit?.scheduled_at || "").getTime()).toBe(new Date(testSlotTime).getTime());
    expect(replacementVisit?.reason_for_visit).toBe("Booked from waitlist");
  });
});
