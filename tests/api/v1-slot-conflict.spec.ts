/**
 * Paths that write a visit's slot without (or past) the app's slot check, after the `visits_no_double_booking`
 * exclusion constraint (V2-05 05-08, DB-08, T-05-20). The constraint refuses the overlapping write with 23P01; each path
 * must answer it as a taken slot, not as a server error:
 *   - `POST /api/v1/visits` has no slot check: a second overlapping scheduled visit → 409 SLOT_CONFLICT (before:
 *     stored, a silent double booking);
 *   - `POST /api/v1/appointments` and `PATCH /api/v1/appointments/:id` check only the target clinic day, so a visit
 *     that starts before midnight and runs past it is missed by the check and caught by the constraint → 409
 *     SLOT_CONFLICT (before: stored);
 *   - the patient reschedule link (`consume_reschedule_token`, 000023) checks overlaps with the doctor's default slot
 *     length, so a longer visit is missed there → `slot_taken`, HTTP 409, and the link stays usable (before: stored).
 * The API key, rows and links are synthetic; every route is called in-process.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POST as postVisit } from "@/app/api/v1/visits/route";
import { POST as postAppointment } from "@/app/api/v1/appointments/route";
import { PATCH as patchAppointment } from "@/app/api/v1/appointments/[id]/route";
import { POST as postRescheduleRoute } from "@/app/api/reschedule/[token]/route";
import { generateRescheduleToken } from "@/features/appointments/system";
import { createApiKeySecret } from "@/lib/api/auth";
import { publicEnv } from "@/lib/env";
import * as enqueueModule from "@/lib/jobs/enqueue";
import { enableApiV1ForFile } from "../helpers/api-v1";
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

describe("slot writes outside the app's slot check answer the exclusion constraint with 409 (05-08)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let rawKey: string;
  let patientId: string;

  async function seedVisit(scheduledAt: string, minutes: number, status = "booked"): Promise<string> {
    const { data, error } = await admin
      .from("visits")
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patientId,
        doctor_id: doctor.userId,
        origin_type: "scheduled",
        status,
        scheduled_at: scheduledAt,
        estimated_duration_minutes: minutes,
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to seed the visit: ${error?.message}`);
    return data.id;
  }

  async function visitsAt(scheduledAt: string): Promise<number> {
    const { count, error } = await admin
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", owner.tenantId)
      .eq("doctor_id", doctor.userId)
      .eq("scheduled_at", scheduledAt);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  function apiRequest(path: string, method: string, body: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: { authorization: `Bearer ${rawKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic Slot Conflict Clinic");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    // A doctor who works around the clock, so the app's shift check never decides these cases.
    const { error: shiftErr } = await admin
      .from("memberships")
      .update({ availability_schedule: ALL_WEEK, default_slot_duration_minutes: 15 })
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", doctor.userId);
    if (shiftErr) throw new Error(`Failed to set the shifts: ${shiftErr.message}`);

    const secret = createApiKeySecret();
    const { error: keyErr } = await admin.from("api_keys").insert({
      tenant_id: owner.tenantId,
      name: "Synthetic slot key",
      key_prefix: secret.keyPrefix,
      key_hash: secret.keyHash,
      created_by: owner.userId,
    });
    if (keyErr) throw new Error(`Failed to seed the API key: ${keyErr.message}`);
    rawKey = secret.rawToken;

    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic Slot Patient", phone: "+919000008803", created_by: owner.userId })
      .select("id")
      .single();
    if (pErr || !patient) throw new Error(`Failed to seed the patient: ${pErr?.message}`);
    patientId = patient.id;
  });

  it("POST /api/v1/visits: a second overlapping scheduled visit → 409 SLOT_CONFLICT (before: stored)", async () => {
    const at = istAt(20, 11, 0);
    const body = { patient_id: patientId, doctor_id: doctor.userId, origin_type: "scheduled", scheduled_at: at, estimated_duration_minutes: 15 };

    const first = await postVisit(apiRequest("/api/v1/visits", "POST", body));
    expect(first.status).toBe(201);
    const second = await postVisit(apiRequest("/api/v1/visits", "POST", body));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("SLOT_CONFLICT");
    expect(await visitsAt(at)).toBe(1);
  });

  it("POST /api/v1/appointments: a slot overlapped by the previous evening's visit → 409 SLOT_CONFLICT (before: stored)", async () => {
    await seedVisit(istAt(21, 23, 50), 30); // 23:50-00:20 IST, starts on the previous clinic day
    const at = istAt(22, 0, 0);

    const res = await postAppointment(
      apiRequest("/api/v1/appointments", "POST", { patient_id: patientId, doctor_id: doctor.userId, scheduled_at: at, estimated_duration_minutes: 15 })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("SLOT_CONFLICT");
    expect(await visitsAt(at)).toBe(0);
  });

  it("PATCH /api/v1/appointments/:id: rescheduling into that overlap → 409 SLOT_CONFLICT, the visit keeps its time", async () => {
    await seedVisit(istAt(24, 23, 50), 30);
    const original = istAt(25, 9, 0);
    const visitId = await seedVisit(original, 15);
    const target = istAt(25, 0, 5);

    const res = await patchAppointment(apiRequest(`/api/v1/appointments/${visitId}`, "PATCH", { scheduled_at: target }), {
      params: Promise.resolve({ id: visitId }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("SLOT_CONFLICT");
    const { data } = await admin.from("visits").select("scheduled_at").eq("id", visitId).single();
    expect(new Date(data!.scheduled_at as string).toISOString()).toBe(original);
  });

  it("patient reschedule link: a longer visit missed by the link's own check → 409 slot taken; the link stays usable", async () => {
    vi.spyOn(enqueueModule, "enqueueMessageAsSystem").mockResolvedValue({ id: "msg-syn" } as never);
    await seedVisit(istAt(10, 10, 0), 60); // 10:00-11:00 IST
    const visitId = await seedVisit(istAt(12, 10, 0), 15);
    const url = await generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, visitId);
    const token = url.split("/reschedule/")[1];

    const taken = istAt(10, 10, 30); // inside the 60-minute visit; the link's check looks only 15 minutes around
    const res = await postRescheduleRoute(
      new NextRequest(`http://localhost:3000/api/reschedule/${token}`, {
        method: "POST",
        body: JSON.stringify({ newScheduledAt: taken }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ token }) }
    );
    expect(res.status).toBe(409);
    const { data: unchanged } = await admin.from("visits").select("scheduled_at").eq("id", visitId).single();
    expect(new Date(unchanged!.scheduled_at as string).toISOString()).toBe(istAt(12, 10, 0));

    // The refused attempt rolled back, so the single-use link still works for a free time.
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false },
    });
    const { data } = await anon.rpc("consume_reschedule_token", { p_token: token, p_new_at: istAt(10, 15, 0) });
    expect((data as { status: string }).status).toBe("ok");
    vi.restoreAllMocks();
  });
});
