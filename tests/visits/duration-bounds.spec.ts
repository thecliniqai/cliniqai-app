/**
 * Visit duration bounds (V2-05 05a review M-DURATION: INT M-1, IND L1; plan 05-11c app side). The database refuses an
 * `estimated_duration_minutes` outside 5–480 (`visits_duration_range`, 05-11a). Every writer validates the same bounds
 * first (`features/visits/duration.ts`), so a caller gets a validation answer rather than a database error:
 *   - the app schemas (`createVisit`, `bookAppointmentSchema`) accept 5–480 (before: 5–180, so a legitimate 4-hour
 *     procedure slot was refused in the app while the database allows it);
 *   - `POST /api/v1/visits` and `POST /api/v1/appointments` answer 422 for a zero, negative, fractional, oversized or
 *     non-number duration and store nothing (before: 0/negative/non-number silently became 15, a 10^6-minute booking
 *     was stored and blocked the doctor's calendar for years, a fraction reached the database as a 22P02 → 500).
 * Local stack; `/api/v1` switched on for this file. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as postVisit } from "@/app/api/v1/visits/route";
import { POST as postAppointment } from "@/app/api/v1/appointments/route";
import { createVisit } from "@/features/visits/service";
import { bookAppointmentSchema } from "@/features/visits/schema";
import { createApiKeySecret } from "@/lib/api/auth";
import { enableApiV1ForFile } from "../helpers/api-v1";
import { ctxFor } from "../helpers/context";
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

const OUT_OF_BOUNDS: Array<[string, unknown]> = [
  ["zero", 0],
  ["negative", -30],
  ["below the minimum", 4],
  ["fractional", 7.5],
  ["above the maximum", 481],
  ["about 1,900 years", 1_000_000_000],
  ["a numeric string", "30"],
];

describe("visit duration bounds 5–480 on every writer (05-11c, M-DURATION)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let desk: SeededTenant;
  let rawKey: string;
  let patientId: string;

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic Duration Bounds Clinic");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    desk = await addMemberToTenant(owner.tenantId, "receptionist");
    const { error: shiftErr } = await admin
      .from("memberships")
      .update({ availability_schedule: ALL_WEEK })
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", doctor.userId);
    if (shiftErr) throw new Error(`Failed to set the shifts: ${shiftErr.code}`);

    const secret = createApiKeySecret();
    const { error: keyErr } = await admin.from("api_keys").insert({
      tenant_id: owner.tenantId,
      name: "Synthetic duration key",
      key_prefix: secret.keyPrefix,
      key_hash: secret.keyHash,
      created_by: owner.userId,
    });
    if (keyErr) throw new Error(`Failed to seed the API key: ${keyErr.code}`);
    rawKey = secret.rawToken;

    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic Duration Patient", phone: "+919000008812", created_by: owner.userId })
      .select("id")
      .single();
    if (pErr || !patient) throw new Error(`Failed to seed the patient: ${pErr?.code}`);
    patientId = patient.id;
  });

  async function visitsAt(scheduledAt: string): Promise<number[]> {
    const { data, error } = await admin
      .from("visits")
      .select("estimated_duration_minutes")
      .eq("tenant_id", owner.tenantId)
      .eq("scheduled_at", scheduledAt);
    if (error) throw new Error(error.code);
    return (data ?? []).map((r) => r.estimated_duration_minutes as number);
  }

  function apiRequest(path: string, body: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${rawKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  describe("app schemas", () => {
    it("bookAppointmentSchema accepts 5 and 480 and refuses 4, 481 and a fraction", () => {
      const base = { patient_id: patientId ?? "00000000-0000-4000-8000-000000000001", doctor_id: "00000000-0000-4000-8000-000000000002", scheduled_at: istAt(40, 10, 0) };
      for (const ok of [5, 480]) expect(bookAppointmentSchema.safeParse({ ...base, estimated_duration_minutes: ok }).success).toBe(true);
      for (const bad of [4, 481, 7.5]) expect(bookAppointmentSchema.safeParse({ ...base, estimated_duration_minutes: bad }).success).toBe(false);
    });

    it("createVisit books a 480-minute visit (before: refused above 180) and refuses 481 with a field error", async () => {
      const at = istAt(41, 9, 0);
      const ok = await createVisit(ctxFor(desk), {
        patient_id: patientId,
        doctor_id: doctor.userId,
        origin_type: "scheduled",
        scheduled_at: at,
        estimated_duration_minutes: 480,
        is_overbooked: false,
      });
      expect(ok).toMatchObject({ success: true });
      expect(await visitsAt(at)).toEqual([480]);

      const at2 = istAt(42, 9, 0);
      const bad = await createVisit(ctxFor(desk), {
        patient_id: patientId,
        doctor_id: doctor.userId,
        origin_type: "scheduled",
        scheduled_at: at2,
        estimated_duration_minutes: 481,
        is_overbooked: false,
      });
      expect(bad).toMatchObject({ success: false });
      expect((bad as { fieldErrors?: Record<string, string[]> }).fieldErrors?.estimated_duration_minutes).toBeDefined();
      expect(await visitsAt(at2)).toEqual([]);
    });
  });

  describe.each([
    ["POST /api/v1/visits", "/api/v1/visits", postVisit, { origin_type: "scheduled" }, 43],
    ["POST /api/v1/appointments", "/api/v1/appointments", postAppointment, {}, 60],
  ] as const)("%s", (_name, path, handler, extra, dayBase) => {
    it.each(OUT_OF_BOUNDS.map(([label, value], i) => [label, value, i] as const))(
      "%s duration → 422 VALIDATION_ERROR, nothing stored",
      async (_label, value, i) => {
        const at = istAt(dayBase + i, 10, 0);
        const res = await handler(
          apiRequest(path, { patient_id: patientId, doctor_id: doctor.userId, scheduled_at: at, estimated_duration_minutes: value, ...extra })
        );
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error.code).toBe("VALIDATION_ERROR");
        expect(body.error.message).toBe("Field 'estimated_duration_minutes' must be a whole number of minutes from 5 to 480.");
        expect(await visitsAt(at)).toEqual([]);
      }
    );

    it("480 is stored as given; an omitted duration defaults to 15", async () => {
      const at = istAt(dayBase + 10, 10, 0);
      const res = await handler(
        apiRequest(path, { patient_id: patientId, doctor_id: doctor.userId, scheduled_at: at, estimated_duration_minutes: 480, ...extra })
      );
      expect(res.status).toBe(201);
      expect(await visitsAt(at)).toEqual([480]);

      const at2 = istAt(dayBase + 11, 10, 0);
      const res2 = await handler(apiRequest(path, { patient_id: patientId, doctor_id: doctor.userId, scheduled_at: at2, ...extra }));
      expect(res2.status).toBe(201);
      expect(await visitsAt(at2)).toEqual([15]);
    });
  });
});
