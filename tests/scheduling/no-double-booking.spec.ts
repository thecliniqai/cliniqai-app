/**
 * Two desks booking the same slot at the same moment (V2-05 05-08; roadmap V2-05 acceptance 6 "two overlapping
 * non-overbooked appointments cannot both be inserted"; P1-39, DB-08; threat T-05-20).
 *
 * Before 05-08 the booking read the slot (`checkSlotAvailability`) and then inserted the visit: two receptionists whose
 * checks both ran before either insert both saw a free slot and both bookings were stored. The
 * `visits_no_double_booking` exclusion constraint refuses the second insert (23P01). Since V2-07 07-03 the check, the
 * insert and the booking message are one command (`register_and_book`): the loser's refusal is SLOT_TAKEN (CONFLICT,
 * `lib/db/errors.ts`) and the booking drawer offers the overbook confirmation.
 *
 * The two bookings start at the same moment: each receptionist's client holds its `register_and_book` call at a shared
 * barrier until both are ready (tests/helpers/write-barrier.ts), then both run. Every call goes through the real service
 * with the receptionist's own JWT client (RLS applies); rows are counted with the service-role client. The interleaving
 * inside the command (check, then insert, with the other desk's row uncommitted) is covered deterministically in
 * tests/visits/register-and-book-rpc.spec.ts. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { registerAndBook, BOOKING_COMMAND_MESSAGES } from "@/features/visits/scheduling-service";
import type { Result } from "@/lib/errors/app-error";
import type { ServiceContext } from "@/lib/auth/context";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { createBarrier, gateClient } from "../helpers/write-barrier";

type Booked = Awaited<ReturnType<typeof registerAndBook>>;

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

  /** The two receptionists' contexts, each holding its booking call until both are ready. */
  function racingDesks(): [ServiceContext, ServiceContext] {
    const booking = createBarrier(2);
    return [deskA, deskB].map((desk) => {
      const ctx = ctxFor(desk);
      return { ...ctx, db: gateClient(ctx.db, { rpc: { register_and_book: booking } }) };
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
  const book = (ctx: ServiceContext, input: ReturnType<typeof booking>) => registerAndBook(ctx, input, randomUUID());

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

  function expectOneWinner(results: Booked[]) {
    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r): r is Extract<Result<unknown>, { ok: false }> => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    // The loser is refused by the command (its slot check, or the database's exclusion constraint when both passed it).
    expect(losses[0].error).toMatchObject({ code: "CONFLICT", reason: "SLOT_TAKEN", message: BOOKING_COMMAND_MESSAGES.SLOT_TAKEN });
  }

  it("two receptionists book the same slot in parallel: exactly one succeeds, the other gets CONFLICT (before: both stored)", async () => {
    const at = "2031-03-03T04:30:00.000Z";
    const [a, b] = racingDesks();

    const results = await Promise.all([book(a, booking(at)), book(b, booking(at))]);

    expectOneWinner(results);
    expect(await bookedAt(at)).toBe(1);
  });

  it("overlapping slots (10:00 and 10:05) booked in parallel: exactly one succeeds", async () => {
    const first = "2031-03-03T05:30:00.000Z";
    const second = "2031-03-03T05:35:00.000Z";
    const [a, b] = racingDesks();

    const results = await Promise.all([book(a, booking(first)), book(b, booking(second))]);

    expectOneWinner(results);
    expect((await bookedAt(first)) + (await bookedAt(second))).toBe(1);
  });

  it("back-to-back slots booked in parallel both succeed (the slot is half-open)", async () => {
    const first = "2031-03-03T06:30:00.000Z";
    const second = "2031-03-03T06:45:00.000Z";
    const [a, b] = racingDesks();

    const results = await Promise.all([book(a, booking(first)), book(b, booking(second))]);

    expect(results.map((r) => r.ok)).toEqual([true, true]);
  });

  it("an intentional overbooking in parallel is stored next to the regular booking", async () => {
    const at = "2031-03-03T07:00:00.000Z";
    const [a, b] = racingDesks();

    const results = await Promise.all([
      book(a, booking(at)),
      book(b, booking(at, { is_overbooked: true })),
    ]);

    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(await bookedAt(at)).toBe(2);
  });
});
