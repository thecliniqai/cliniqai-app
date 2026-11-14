import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { createVisit, getVisitsForDate } from "@/features/visits/service";
import { checkInVisit, getQueueForDate } from "@/features/queue/service";
import { uploadLabDocument } from "@/features/labs/service";
import { formatAmendedFilename } from "@/features/labs/utils";

// V2-03 03-05 (P1-21): the clinic day at 00:00-05:30 IST. 2026-11-12T19:00:00Z is 00:30 IST on 13 Nov while the UTC
// date is still 12 Nov. Only `Date` is faked (timers, promises and the network run normally), and only around the
// service calls: seeding runs on the real clock. Rows written under the fake clock belong to the run's tenants and
// are removed by the tenant cascade in teardown.
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

  it("check-in at 00:30 IST issues a queue token dated the IST day (13 Nov), listed on that day's queue", async () => {
    const visitId = await walkInVisit(ist, istPatientId);

    useClinicClock(AT_0030_IST_13_NOV);
    const res = await checkInVisit(ctxFor(ist), visitId, "normal");
    vi.useRealTimers();

    expect(res).toMatchObject({ success: true, tokenNumber: 1 });
    expect(await tokenDateOf(ist, visitId)).toBe("2026-11-13");
  });

  it("the tenant's own zone decides: the same instant is still 12 Nov for an America/New_York clinic", async () => {
    const visitId = await walkInVisit(newYork, nyPatientId);

    useClinicClock(AT_0030_IST_13_NOV);
    const res = await checkInVisit(ctxFor(newYork), visitId, "normal");
    vi.useRealTimers();

    expect(res.success).toBe(true);
    expect(await tokenDateOf(newYork, visitId)).toBe("2026-11-12");
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
