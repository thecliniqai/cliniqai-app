import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { createVisit, getVisitsForDate } from "@/features/visits/service";
import { checkInVisit, getQueueForDate } from "@/features/queue/service";
import { uploadLabDocument } from "@/features/labs/service";
import { formatAmendedFilename } from "@/features/labs/utils";
import { getTenantToday } from "@/lib/datetime/server";
import { psql } from "../helpers/sql";

// V2-03 03-05 (P1-21): the clinic day at 00:00-05:30 IST. 2026-11-12T19:00:00Z is 00:30 IST on 13 Nov while the UTC
// date is still 12 Nov. Only `Date` is faked (timers, promises and the network run normally), and only around the
// service calls: seeding runs on the real clock. Rows written under the fake clock belong to the run's tenants and
// are removed by the tenant cascade in teardown.
//
// V2-05 05-08: a queue token's day is no longer chosen by the app. `next_queue_token` returns the clinic-local date
// that SQL computes from the database clock (`tenant_local_date(tenant, now())`), so a faked app clock cannot move it;
// the check-in cases below assert that date. The SQL/app parity of the clinic date at the IST boundary (18:30-24:00
// UTC) is asserted at fixed instants in the last describe block.
const AT_0030_IST_13_NOV = new Date("2026-11-12T19:00:00.000Z");
const VISIT_0200_IST_13_NOV = "2026-11-12T20:30:00.000Z";

function useClinicClock(instant: Date): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instant);
}

async function seedPatient(t: SeededTenant, fullName: string, phone: string): Promise<string> {
  const { data, error } = await t.client
    .from("patients")
    .insert({ tenant_id: t.tenantId, full_name: fullName, phone, age: 40, created_by: t.userId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to seed patient: ${error?.message}`);
  return data.id;
}

async function walkInVisit(t: SeededTenant, patientId: string): Promise<string> {
  const res = await createVisit(ctxFor(t), {
    patient_id: patientId,
    doctor_id: t.userId,
    origin_type: "walk_in",
    reason_for_visit: "Synthetic IST boundary check",
    estimated_duration_minutes: 15,
    is_overbooked: false,
  });
  if (!res.success) throw new Error(`Failed to create visit: ${res.error}`);
  return res.visitId;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** `tenant_local_date(tenant, at)` from SQL; `at` defaults to the database's `now()`. */
function sqlTenantDate(tenantId: string, at?: string): string {
  if (!UUID.test(tenantId)) throw new Error("tenant id is not a uuid");
  if (at !== undefined && !ISO_INSTANT.test(at)) throw new Error("instant is not an ISO UTC timestamp");
  const instant = at === undefined ? "now()" : `'${at}'::timestamptz`;
  const [date] = psql(`select public.tenant_local_date('${tenantId}', ${instant})::text`);
  return date;
}

async function tokenDateOf(t: SeededTenant, visitId: string): Promise<string | undefined> {
  const { data } = await getAdminClient()
    .from("queue_tokens")
    .select("date")
    .eq("visit_id", visitId)
    .eq("tenant_id", t.tenantId)
    .single();
  return data?.date;
}

describe("IST day boundaries (00:00-05:30 IST) use the clinic date, not the UTC date", () => {
  let ist: SeededTenant;
  let newYork: SeededTenant;
  let istPatientId: string;
  let nyPatientId: string;

  beforeAll(async () => {
    ist = await seedTenantWithOwner("Synthetic IST Boundary Clinic");
    newYork = await seedTenantWithOwner("Synthetic Eastern Zone Clinic");
    // A tenant in another zone proves the tenant's own zone is read (not a hard-coded IST).
    const { error } = await getAdminClient()
      .from("tenants")
      .update({ timezone: "America/New_York" })
      .eq("id", newYork.tenantId);
    if (error) throw new Error(`Failed to set the tenant zone: ${error.message}`);

    istPatientId = await seedPatient(ist, "Synthetic Boundary Patient", "+919000011101");
    nyPatientId = await seedPatient(newYork, "Synthetic Eastern Patient", "+919000011102");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("check-in issues a queue token dated the clinic-local today from SQL, whatever the app clock says (05-08)", async () => {
    const visitId = await walkInVisit(ist, istPatientId);

    const before = sqlTenantDate(ist.tenantId);
    useClinicClock(AT_0030_IST_13_NOV);
    const res = await checkInVisit(ctxFor(ist), visitId, "normal");
    vi.useRealTimers();
    const after = sqlTenantDate(ist.tenantId);

    expect(res).toMatchObject({ success: true, tokenNumber: 1 });
    expect([before, after]).toContain(await tokenDateOf(ist, visitId));
  });

  it("the tenant's own zone decides the token date: an America/New_York clinic gets its own clinic-local today", async () => {
    const visitId = await walkInVisit(newYork, nyPatientId);

    const before = sqlTenantDate(newYork.tenantId);
    useClinicClock(AT_0030_IST_13_NOV);
    const res = await checkInVisit(ctxFor(newYork), visitId, "normal");
    vi.useRealTimers();
    const after = sqlTenantDate(newYork.tenantId);

    expect(res.success).toBe(true);
    expect([before, after]).toContain(await tokenDateOf(newYork, visitId));
  });

  it("a visit at 02:00 IST on 13 Nov is in the 13 Nov list and not in the 12 Nov list", async () => {
    const { data: visit, error } = await ist.client
      .from("visits")
      .insert({
        tenant_id: ist.tenantId,
        patient_id: istPatientId,
        doctor_id: ist.userId,
        origin_type: "scheduled",
        status: "booked",
        scheduled_at: VISIT_0200_IST_13_NOV,
        created_by: ist.userId,
      })
      .select("id")
      .single();
    if (error || !visit) throw new Error(`Failed to seed the visit: ${error?.message}`);

    useClinicClock(AT_0030_IST_13_NOV);
    const on13 = await getVisitsForDate(ctxFor(ist), "2026-11-13");
    const on12 = await getVisitsForDate(ctxFor(ist), "2026-11-12");
    const queue13 = await getQueueForDate(ctxFor(ist), "2026-11-13");
    const queue12 = await getQueueForDate(ctxFor(ist), "2026-11-12");
    vi.useRealTimers();

    if (!on13.success || !on12.success) throw new Error("getVisitsForDate failed");
    expect(on13.visits.map((v) => v.id)).toContain(visit.id);
    expect(on12.visits.map((v) => v.id)).not.toContain(visit.id);

    if (!queue13.success || !queue12.success) throw new Error("getQueueForDate failed");
    expect(queue13.items.map((i) => i.visit.id)).toContain(visit.id);
    expect(queue12.items.map((i) => i.visit.id)).not.toContain(visit.id);
  });

  it("a lab document uploaded at 00:30 IST without a report date is dated 13 Nov", async () => {
    const formData = new FormData();
    formData.set("file", new File(["%PDF-1.4 synthetic"], "synthetic_cbc.pdf", { type: "application/pdf" }));
    formData.set("patient_id", istPatientId);
    formData.set("title", "Synthetic CBC");
    formData.set("document_type", "lab_report");
    formData.set("is_abnormal", "false");

    useClinicClock(AT_0030_IST_13_NOV);
    const res = await uploadLabDocument(ctxFor(ist), formData);
    vi.useRealTimers();

    if (!res.success) throw new Error(`Upload failed: ${res.error}`);
    expect(res.document.report_date).toBe("2026-11-13");
    // The date no longer travels in the storage key (ids only since V2-05 05-02c, R-45); the readable download name
    // (formatAmendedFilename) carries the same clinic date.
    expect(formatAmendedFilename("Synthetic", res.document.original_filename, res.document.report_date)).toMatch(/_2026-11-13\.pdf$/);
  });
});

// V2-05 05-08 (V2-03 R-33, 03-05 note): SQL and the app agree on a clinic's "today". `tenant_local_date` (SQL, used by
// next_queue_token and the date-fill triggers) and `getTenantToday` (lib/datetime/server) are evaluated at the same
// fixed instants, including 18:30-24:00 UTC where the IST date is already the next UTC day (before 05-08, SQL's
// CURRENT_DATE gave the UTC date there), for the zone values a clinic row may hold.
describe("clinic date parity: SQL tenant_local_date = app getTenantToday", () => {
  let clinic: SeededTenant;

  // 18:30 and 19:00 UTC are 00:00 and 00:30 IST on the next day; 23:59:59 UTC is 05:29:59 IST; 03:00 UTC is still the
  // previous evening west of UTC.
  const INSTANTS = ["2026-11-13T18:30:00.000Z", "2026-11-13T19:00:00.000Z", "2026-11-13T23:59:59.000Z", "2026-11-14T03:00:00.000Z"];
  const ZONES = [
    "Asia/Kolkata",
    "America/New_York",
    "asia/kolkata",
    "america/new_york",
    "Asia/Calcutta",
    "UTC",
    "Etc/GMT+5",
    "Pacific/Kiritimati",
    "+05:30",
    "-05:00",
    "-0500",
    "+05",
    "EST",
    "IST",
    "Not/AZone",
    "",
  ];

  beforeAll(async () => {
    clinic = await seedTenantWithOwner("Synthetic Date Parity Clinic");
  });

  it("an IST clinic between 18:30 and 24:00 UTC: SQL gives the next day, as the app does (before: the UTC date)", async () => {
    // The clinic still has the default zone (Asia/Kolkata) here; the next test changes it.
    for (const at of INSTANTS.slice(0, 3)) {
      const app = await getTenantToday(getAdminClient(), clinic.tenantId, Date.parse(at));
      expect({ at, sql: sqlTenantDate(clinic.tenantId, at) }).toEqual({ at, sql: app.today });
      expect(app.today).toBe("2026-11-14");
    }
  });

  it.each(ZONES)("zone %j: SQL and the app give the same clinic date at every instant", async (zone) => {
    const { error } = await getAdminClient().from("tenants").update({ timezone: zone }).eq("id", clinic.tenantId);
    if (error) throw new Error(`Failed to set the tenant zone: ${error.message}`);
    for (const at of INSTANTS) {
      const app = await getTenantToday(getAdminClient(), clinic.tenantId, Date.parse(at));
      expect({ zone, at, sql: sqlTenantDate(clinic.tenantId, at) }).toEqual({ zone, at, sql: app.today });
    }
  });
});
