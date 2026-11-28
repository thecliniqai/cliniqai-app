/**
 * 09E PR 2 (CI 46049011705): the late no-show fixtures of check-in-rpc and start-consultation-rpc were seeded at
 * `Date.now() - 15 min`; that run reached them at 00:06 and 00:08 IST, the seed fell on the previous clinic day and the
 * check-in step (000106, R-8) rightly answered VISIT_NOT_TODAY. This spec pins the fix (tests/helpers/clinic-day.ts) at
 * the boundary with an injected "now", judged by the database's own day rule (`public.tenant_local_date` of the seed vs
 * of now, the exact VISIT_NOT_TODAY condition), and checks the real RPC on both sides of clinic-local midnight.
 * Synthetic data only.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CLINIC_TZ, todayInTz } from "@/lib/datetime";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { psql } from "../helpers/sql";
import { auditRows, seedVisit } from "../helpers/billing-commands";
import { callCheckIn, checkInArgs, visitRow } from "../helpers/clinical-commands";
import { clearOfClinicMidnight, clinicDayBounds, earlierToday } from "../helpers/clinic-day";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 00:05 IST on 28 Nov 2026, and the two instants the failing run reached the late no-show cases (00:06, 00:08 IST). */
const BOUNDARY_NOWS = ["2026-11-27T18:35:00.000Z", "2026-11-27T18:36:29.161Z", "2026-11-27T18:38:05.485Z"].map(Date.parse);

let clinic: SeededTenant;

beforeAll(async () => {
  clinic = await seedTenantWithOwner("CI Clinic Day Boundary");
});

/** The check-in step's day rule, evaluated by the database for an injected now: true when it would answer VISIT_NOT_TODAY. */
function visitNotToday(scheduledIso: string, nowMs: number): boolean {
  const nowIso = new Date(nowMs).toISOString();
  const [row] = psql(
    `select (public.tenant_local_date('${clinic.tenantId}'::uuid, '${scheduledIso}'::timestamptz) ` +
      `is distinct from public.tenant_local_date('${clinic.tenantId}'::uuid, '${nowIso}'::timestamptz))::text`
  );
  return row === "true";
}

describe("a late appointment of today, seeded with an injected now just after clinic-local midnight", () => {
  it("the boundary is real: 15 or 30 minutes before 00:05 IST is the previous clinic day, which the day rule refuses", () => {
    const [now] = BOUNDARY_NOWS;
    expect(visitNotToday(new Date(now - HOUR / 4).toISOString(), now)).toBe(true);
    expect(visitNotToday(new Date(now - HOUR / 2).toISOString(), now)).toBe(true);
  });

  it.each(BOUNDARY_NOWS.map((now) => [new Date(now).toISOString(), now] as const))(
    "earlierToday at %s stays on the clinic's day (the day rule accepts it) and is not after now",
    (_label, now) => {
      for (const before of [HOUR / 4, HOUR / 2]) {
        const seeded = earlierToday(before, now);
        expect(Date.parse(seeded)).toBeLessThanOrEqual(now);
        expect(visitNotToday(seeded, now), `${before / MINUTE} min before`).toBe(false);
      }
    }
  );

  it("at every minute of a clinic day, earlierToday(15 and 30 min) is on that day, never after now, and exactly 15/30 min early once it can be", () => {
    const { start } = clinicDayBounds(BOUNDARY_NOWS[0]);
    for (let now = start; now < start + 24 * HOUR; now += MINUTE) {
      for (const before of [HOUR / 4, HOUR / 2]) {
        const seeded = Date.parse(earlierToday(before, now));
        expect(todayInTz(DEFAULT_CLINIC_TZ, seeded)).toBe(todayInTz(DEFAULT_CLINIC_TZ, now));
        expect(seeded).toBeLessThanOrEqual(now);
        if (now - start >= before) expect(seeded).toBe(now - before);
      }
    }
  });
});

describe("the real check-in on both sides of clinic-local midnight (any time of day)", () => {
  beforeEach(() => clearOfClinicMidnight());

  it("a no-show of the previous day's last second is VISIT_NOT_TODAY; one at today's midnight is checked in as a late arrival", async () => {
    const { start } = clinicDayBounds();
    const yesterday = await seedVisit(clinic, undefined, { status: "no_show", scheduledAt: new Date(start - 1_000).toISOString(), overbooked: true });
    const refused = await callCheckIn(clinic.client, checkInArgs(clinic, yesterday.visitId));
    expect(refused.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_TODAY" });
    expect((await visitRow(yesterday.visitId)).status).toBe("no_show");

    const today = await seedVisit(clinic, undefined, { status: "no_show", scheduledAt: new Date(start).toISOString(), overbooked: true });
    const { data, error } = await callCheckIn(clinic.client, checkInArgs(clinic, today.visitId));
    expect(error).toBeNull();
    expect((await visitRow(today.visitId)).status).toBe("waiting");
    const [row] = await auditRows(clinic.tenantId, "queue.check_in", (data as { queue_token_id: string }).queue_token_id);
    expect(row.metadata).toHaveProperty("late_arrival", true);
  });
});
