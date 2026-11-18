/**
 * Two desks booking the same slot at the same moment (V2-05 05-08; roadmap V2-05 acceptance 6 "two overlapping
 * non-overbooked appointments cannot both be inserted"; P1-39, DB-08; threat T-05-20).
 *
 * `bookAppointment` checks the slot (`checkSlotAvailability`) and then inserts the visit. Two receptionists whose
 * checks both run before either insert both saw a free slot, and before 05-08 both bookings were stored. The
 * `visits_no_double_booking` exclusion constraint now refuses the second insert (23P01), which the service reports as a
 * CONFLICT with reason VISITS_NO_DOUBLE_BOOKING (`lib/db/errors.ts`) and `conflict: true`, so the booking drawer offers
 * the overbook confirmation.
 *
 * The interleaving is forced, not hoped for: each receptionist's client holds its `visits` insert at a shared barrier
 * until both bookings have passed their slot check (tests/helpers/write-barrier.ts). Every call goes through the real
 * service with the receptionist's own JWT client (RLS applies); rows are counted with the service-role client.
 * Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { bookAppointment, type BookAppointmentResult } from "@/features/visits/scheduling-service";
import { SLOT_TAKEN_MESSAGE, SLOT_TAKEN_REASON } from "@/features/visits/service";
import type { ServiceContext } from "@/lib/auth/context";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { createBarrier, gateClient } from "../helpers/write-barrier";

describe("no double booking under concurrency (05-08, acceptance 6)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let deskA: SeededTenant;
  let deskB: SeededTenant;
  let patientId: string;

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic Double Booking Clinic");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    deskA = await addMemberToTenant(owner.tenantId, "receptionist");
    deskB = await addMemberToTenant(owner.tenantId, "receptionist");
    const { data, error } = await admin
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic Booking Patient", phone: "+919000008801", created_by: owner.userId })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to seed the patient: ${error?.message}`);
    patientId = data.id;
  });

  /** The two receptionists' contexts, each holding its visit insert until both have reached it. */
  function racingDesks(): [ServiceContext, ServiceContext] {
    const visitsInsert = createBarrier(2);
    return [deskA, deskB].map((desk) => {
      const ctx = ctxFor(desk);
      return { ...ctx, db: gateClient(ctx.db, { insert: { visits: visitsInsert } }) };
    }) as [ServiceContext, ServiceContext];
  }

  // Every slot below is on Monday 3 Mar 2031 between 10:00 and 13:00 IST (04:30-07:30 UTC), inside a new doctor's
  // default shift (000012), so the slot check reaches the visit query and both bookings reach their insert.
  function booking(scheduledAt: string, over: { is_overbooked?: boolean } = {}) {
    return {
      patient_id: patientId,
      doctor_id: doctor.userId,
      scheduled_at: scheduledAt,
      estimated_duration_minutes: 15,
      reason_for_visit: "Synthetic concurrent booking",
      ...over,
    };
  }

  async function bookedAt(scheduledAt: string): Promise<number> {
    const { count, error } = await admin
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", owner.tenantId)
      .eq("doctor_id", doctor.userId)
      .eq("scheduled_at", scheduledAt);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  function expectOneWinner(results: BookAppointmentResult[]) {
    const wins = results.filter((r) => r.success);
    const losses = results.filter((r): r is Extract<BookAppointmentResult, { success: false }> => !r.success);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    // The loser passed the slot check (the barrier proves it) and was refused by the database, not by the app check.
    expect(losses[0]).toEqual({
      success: false,
      conflict: true,
      code: "CONFLICT",
      reason: SLOT_TAKEN_REASON,
      error: SLOT_TAKEN_MESSAGE,
    });
  }

  it("two receptionists book the same slot in parallel: exactly one succeeds, the other gets CONFLICT (before: both stored)", async () => {
    const at = "2031-03-03T04:30:00.000Z";
    const [a, b] = racingDesks();

    const results = await Promise.all([bookAppointment(a, booking(at)), bookAppointment(b, booking(at))]);

    expectOneWinner(results);
    expect(await bookedAt(at)).toBe(1);
  });

  it("overlapping slots (10:00 and 10:05) booked in parallel: exactly one succeeds", async () => {
    const first = "2031-03-03T05:30:00.000Z";
    const second = "2031-03-03T05:35:00.000Z";
    const [a, b] = racingDesks();

    const results = await Promise.all([bookAppointment(a, booking(first)), bookAppointment(b, booking(second))]);

    expectOneWinner(results);
    expect((await bookedAt(first)) + (await bookedAt(second))).toBe(1);
  });

  it("back-to-back slots booked in parallel both succeed (the slot is half-open)", async () => {
    const first = "2031-03-03T06:30:00.000Z";
    const second = "2031-03-03T06:45:00.000Z";
    const [a, b] = racingDesks();

    const results = await Promise.all([bookAppointment(a, booking(first)), bookAppointment(b, booking(second))]);

    expect(results.map((r) => r.success)).toEqual([true, true]);
  });

  it("an intentional overbooking in parallel is stored next to the regular booking", async () => {
    const at = "2031-03-03T07:00:00.000Z";
    const [a, b] = racingDesks();

    const results = await Promise.all([
      bookAppointment(a, booking(at)),
      bookAppointment(b, booking(at, { is_overbooked: true })),
    ]);

    expect(results.map((r) => r.success)).toEqual([true, true]);
    expect(await bookedAt(at)).toBe(2);
  });
});
