/**
 * The loser of a real slot race on every writer of a visit slot gets the taken-slot conflict, never a server error or
 * "not found" (V2-05 05a review INT L-3, 05-08 deviation 5 residual; plan 05-11c).
 *
 * Two concurrent writes of overlapping slots can each find the other's not-yet-committed index entry while checking the
 * `visits_no_double_booking` exclusion constraint; PostgreSQL then aborts one of them as a deadlock (SQLSTATE 40P01)
 * instead of answering 23P01. The survivor commits, so one retry of the aborted write answers definitively (23P01 → the
 * slot is taken). `retryOnDeadlock` (lib/db/retry.ts) is that one retry, shared by `createVisit`, `POST /api/v1/visits`,
 * `POST /api/v1/appointments`, `PATCH /api/v1/appointments/:id` and the patient reschedule link.
 *
 * The deadlock is forced, not hoped for. A superuser session ("holder") inserts visit X and waits, inside its open
 * transaction, until a backend is blocked on its transaction id: the writer under test (R), whose slot overlaps X. The
 * holder then inserts visit Z, which overlaps R's slot but not X's, so it waits on R: a cycle. Each waiting backend
 * runs the deadlock check once, `deadlock_timeout` (1 s) after its own wait began, and the backend that finds the cycle
 * is aborted. R's check runs about 1 s after R began waiting, when the holder (which closes the cycle within ~20 ms)
 * is already waiting on R, so R is aborted with 40P01. The holder raises its own `deadlock_timeout` for its
 * transaction (SET LOCAL, superuser) so its check can never run first: with both at 1 s the two checks are only a few
 * milliseconds apart and scheduling jitter decided the victim (1 run in ~6 aborted the holder; root-caused, 05-11c).
 * The holder's insert then goes through and it commits. If R were not the victim the holder's session would fail
 * with the deadlock instead, and the test fails (asserted). Without the retry, R's 40P01 surfaced as 500 (v1 routes)
 * or 404 (reschedule link). Synthetic data only; the holder's SQL carries only the seeded ids.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as postVisit } from "@/app/api/v1/visits/route";
import { POST as postAppointment } from "@/app/api/v1/appointments/route";
import { PATCH as patchAppointment } from "@/app/api/v1/appointments/[id]/route";
import { POST as postRescheduleRoute } from "@/app/api/reschedule/[token]/route";
import { generateRescheduleToken } from "@/features/appointments/system";
import { createVisit, SLOT_TAKEN_MESSAGE, SLOT_TAKEN_REASON } from "@/features/visits/service";
import { createApiKeySecret } from "@/lib/api/auth";
import { publicEnv } from "@/lib/env";
import * as enqueueModule from "@/lib/jobs/enqueue";
import { enableApiV1ForFile } from "../helpers/api-v1";
import { ctxFor } from "../helpers/context";
import { psql, psqlAsync } from "../helpers/sql";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

enableApiV1ForFile();

const ALL_DAY = { enabled: true, shifts: [{ start: "00:00", end: "23:59" }] };
const ALL_WEEK = Object.fromEntries(
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, ALL_DAY])
);

/** An instant `days` from now at `hh:mm` IST (fixed +05:30), as an ISO UTC string. */
function istAt(days: number, hh: number, mm: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  return new Date(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`).toISOString();
}

const plusMinutes = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

describe("slot writers under a forced deadlock: the loser gets the taken slot (05-11c, INT L-3)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let desk: SeededTenant;
  let rawKey: string;
  let patientId: string;

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic Deadlock Retry Clinic");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    desk = await addMemberToTenant(owner.tenantId, "receptionist");
    // A doctor who works around the clock, so no shift check decides these cases.
    const { error: shiftErr } = await admin
      .from("memberships")
      .update({ availability_schedule: ALL_WEEK, default_slot_duration_minutes: 15 })
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", doctor.userId);
    if (shiftErr) throw new Error(`Failed to set the shifts: ${shiftErr.code}`);

    const secret = createApiKeySecret();
    const { error: keyErr } = await admin.from("api_keys").insert({
      tenant_id: owner.tenantId,
      name: "Synthetic deadlock key",
      key_prefix: secret.keyPrefix,
      key_hash: secret.keyHash,
      created_by: owner.userId,
    });
    if (keyErr) throw new Error(`Failed to seed the API key: ${keyErr.code}`);
    rawKey = secret.rawToken;

    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic Deadlock Patient", phone: "+919000008811", created_by: owner.userId })
      .select("id")
      .single();
    if (pErr || !patient) throw new Error(`Failed to seed the patient: ${pErr?.code}`);
    patientId = patient.id;
  });

  function visitValues(at: string, minutes: number): string {
    return (
      `('${owner.tenantId}', '${patientId}', '${doctor.userId}', 'scheduled', 'booked', '${at}', ${minutes}, '${owner.userId}')`
    );
  }

  const VISIT_COLUMNS =
    "insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, estimated_duration_minutes, created_by) values ";

  /**
   * Runs `writer` (R, whose slot is [at+10, at+25)) against a holder that owns X = [at, at+15) and, once R waits on it,
   * inserts Z = [at+20, at+35). Returns R's result after the holder committed.
   */
  async function raceAgainstHolder<T>(at: string, writer: () => Promise<T>): Promise<T> {
    const tag = `c11c_holder_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const holder = psqlAsync(
      [
        `set application_name = '${tag}'`,
        "begin",
        // Only R's deadlock check may find the cycle (see the file comment).
        "set local deadlock_timeout = '30s'",
        `${VISIT_COLUMNS}${visitValues(at, 15)}`,
        // Wait (inside the open transaction) until a backend is blocked on this transaction: the writer under test.
        `do $$ declare n int := 0; begin loop perform pg_sleep(0.02); n := n + 1; ` +
          `exit when exists (select 1 from pg_locks w where w.locktype = 'transactionid' and not w.granted ` +
          `and w.transactionid = pg_current_xact_id()::xid); ` +
          `if n > 1500 then raise exception 'C11C_NO_WAITER'; end if; end loop; end $$`,
        `${VISIT_COLUMNS}${visitValues(plusMinutes(at, 20), 15)}`,
        "commit",
      ].join("; ")
    );
    // The holder is past its first insert once it sleeps in the wait loop.
    await vi.waitFor(
      () => {
        const [n] = psql(`select count(*) from pg_stat_activity where application_name = '${tag}' and wait_event = 'PgSleep'`);
        if (n !== "1") throw new Error("holder not ready");
      },
      { timeout: 20_000, interval: 50 }
    );
    const result = writer();
    // The holder must survive (R was the deadlock victim): a rejection here fails the test with the deadlock.
    await holder;
    return result;
  }

  async function visitsAt(scheduledAt: string): Promise<number> {
    const { count, error } = await admin
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", owner.tenantId)
      .eq("doctor_id", doctor.userId)
      .eq("scheduled_at", scheduledAt);
    if (error) throw new Error(error.code);
    return count ?? 0;
  }

  async function seedVisit(scheduledAt: string, minutes: number): Promise<string> {
    const { data, error } = await admin
      .from("visits")
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patientId,
        doctor_id: doctor.userId,
        origin_type: "scheduled",
        status: "booked",
        scheduled_at: scheduledAt,
        estimated_duration_minutes: minutes,
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to seed the visit: ${error?.code}`);
    return data.id;
  }

  function apiRequest(path: string, method: string, body: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: { authorization: `Bearer ${rawKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("POST /api/v1/visits: the deadlock victim → 409 SLOT_CONFLICT (before: 500)", async () => {
    const at = istAt(30, 10, 0);
    const target = plusMinutes(at, 10);
    const res = await raceAgainstHolder(at, () =>
      postVisit(
        apiRequest("/api/v1/visits", "POST", {
          patient_id: patientId,
          doctor_id: doctor.userId,
          origin_type: "scheduled",
          scheduled_at: target,
          estimated_duration_minutes: 15,
        })
      )
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("SLOT_CONFLICT");
    expect(await visitsAt(target)).toBe(0);
    expect(await visitsAt(at)).toBe(1);
    expect(await visitsAt(plusMinutes(at, 20))).toBe(1);
  });

  it("POST /api/v1/appointments: the deadlock victim → 409 SLOT_CONFLICT (before: 500)", async () => {
    const at = istAt(31, 10, 0);
    const target = plusMinutes(at, 10);
    const res = await raceAgainstHolder(at, () =>
      postAppointment(
        apiRequest("/api/v1/appointments", "POST", {
          patient_id: patientId,
          doctor_id: doctor.userId,
          scheduled_at: target,
          estimated_duration_minutes: 15,
        })
      )
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("SLOT_CONFLICT");
    expect(await visitsAt(target)).toBe(0);
  });

  it("PATCH /api/v1/appointments/:id: the deadlock victim → 409 SLOT_CONFLICT, the visit keeps its time (before: 500)", async () => {
    const at = istAt(32, 10, 0);
    const original = istAt(33, 9, 0);
    const visitId = await seedVisit(original, 15);
    const target = plusMinutes(at, 10);
    const res = await raceAgainstHolder(at, () =>
      patchAppointment(apiRequest(`/api/v1/appointments/${visitId}`, "PATCH", { scheduled_at: target }), {
        params: Promise.resolve({ id: visitId }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("SLOT_CONFLICT");
    const { data } = await admin.from("visits").select("scheduled_at").eq("id", visitId).single();
    expect(new Date(data!.scheduled_at as string).toISOString()).toBe(original);
  });

  it("patient reschedule link: the deadlock victim → 409 slot taken, the link stays usable (before: 404 not found)", async () => {
    vi.spyOn(enqueueModule, "enqueueMessageAsSystem").mockResolvedValue({ id: "msg-syn" } as never);
    try {
      const at = istAt(34, 10, 0);
      const original = istAt(36, 9, 0);
      const visitId = await seedVisit(original, 15);
      const url = await generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, visitId);
      const token = url.split("/reschedule/")[1];
      const target = plusMinutes(at, 10);

      const res = await raceAgainstHolder(at, () =>
        postRescheduleRoute(
          new NextRequest(`http://localhost:3000/api/reschedule/${token}`, {
            method: "POST",
            body: JSON.stringify({ newScheduledAt: target }),
            headers: { "content-type": "application/json" },
          }),
          { params: Promise.resolve({ token }) }
        )
      );
      expect(res.status).toBe(409);
      const { data: unchanged } = await admin.from("visits").select("scheduled_at").eq("id", visitId).single();
      expect(new Date(unchanged!.scheduled_at as string).toISOString()).toBe(original);

      // The aborted attempt rolled back, so the single-use link still works for a free time.
      const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false },
      });
      const { data } = await anon.rpc("consume_reschedule_token", { p_token: token, p_new_at: istAt(35, 15, 0) });
      expect((data as { status: string }).status).toBe("ok");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("createVisit (app booking, receptionist under RLS): the deadlock victim → the taken-slot conflict", async () => {
    const at = istAt(37, 10, 0);
    const target = plusMinutes(at, 10);
    const res = await raceAgainstHolder(at, () =>
      createVisit(ctxFor(desk), {
        patient_id: patientId,
        doctor_id: doctor.userId,
        origin_type: "scheduled",
        scheduled_at: target,
        estimated_duration_minutes: 15,
        is_overbooked: false,
      })
    );
    expect(res).toEqual({ success: false, conflict: true, code: "CONFLICT", reason: SLOT_TAKEN_REASON, error: SLOT_TAKEN_MESSAGE });
    expect(await visitsAt(target)).toBe(0);
  });
});
