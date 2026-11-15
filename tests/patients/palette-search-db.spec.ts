/**
 * The command palette's server projections (V2-06 06-04b; T-06-17) against the local stack: the patient search
 * returns exactly id, name, age/sex and the last four digits of the mobile number, only from the caller's clinic; the
 * today-queue search returns exactly visit id, token, name and status for today's visits matching a token, a name or
 * a mobile number, cancelled visits left out. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CLINIC_TZ, todayInTz } from "@/lib/datetime";
import { seedTenantWithOwner } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { PALETTE_PATIENT_KEYS, searchPatientsForPalette } from "@/features/patients/service";
import { PALETTE_QUEUE_KEYS, searchTodayQueueForPalette } from "@/features/queue/service";

type Tenant = Awaited<ReturnType<typeof seedTenantWithOwner>>;

interface PatientFields {
  full_name: string;
  phone: string;
  is_deleted?: boolean;
  date_of_birth?: string;
  age?: number;
  sex?: "male" | "female" | "other";
}

async function patient(t: Tenant, fields: PatientFields): Promise<string> {
  const { data, error } = await t.client
    .from("patients")
    .insert({ tenant_id: t.tenantId, created_by: t.userId, ...fields })
    .select("id")
    .single();
  if (error || !data) throw new Error(`patient insert: ${error?.message}`);
  return (data as { id: string }).id;
}

async function visitWithToken(t: Tenant, patientId: string, status: string, token: number | null): Promise<string> {
  const { data, error } = await t.client
    .from("visits")
    .insert({
      tenant_id: t.tenantId,
      patient_id: patientId,
      doctor_id: t.userId,
      origin_type: "walk_in",
      status,
      estimated_duration_minutes: 15,
      created_by: t.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`visit insert: ${error?.message}`);
  const visitId = (data as { id: string }).id;
  if (token !== null) {
    // Tokens are issued by check-in (a definer path); the seed writes the row directly as the admin.
    const { error: tokenError } = await getAdminClient()
      .from("queue_tokens")
      .insert({ tenant_id: t.tenantId, visit_id: visitId, date: todayInTz(DEFAULT_CLINIC_TZ), token_number: token });
    if (tokenError) throw new Error(`token insert: ${tokenError.message}`);
  }
  return visitId;
}

describe("palette projections", () => {
  let a: Tenant;
  let b: Tenant;
  let withDob: string;
  let withAge: string;
  let waitingVisit: string;

  beforeAll(async () => {
    a = await seedTenantWithOwner("Palette Clinic A");
    b = await seedTenantWithOwner("Palette Clinic B");
    withDob = await patient(a, { full_name: "Meena Pawar Palette", phone: "+919812340001", date_of_birth: "1984-03-10", sex: "female" });
    withAge = await patient(a, { full_name: "Ravi Palette", phone: "9812340002", age: 7, sex: "male" });
    await patient(b, { full_name: "Meena Pawar Palette", phone: "+919812340001", sex: "female" });
    waitingVisit = await visitWithToken(a, withDob, "waiting", 14);
    await visitWithToken(a, withAge, "cancelled", 15);
    await visitWithToken(b, await patient(b, { full_name: "Meena Other Clinic", phone: "9812340001" }), "waiting", 14);
    await patient(a, { full_name: "Meena Deleted Palette", phone: "9812340003", is_deleted: true });
  });

  it("patients: exactly four fields, the last four digits only, age from the date of birth in the clinic's zone", async () => {
    const found = await searchPatientsForPalette(ctxFor(a), "9812340001");
    expect(found).toHaveLength(1);
    const [p] = found;
    expect(Object.keys(p)).toEqual([...PALETTE_PATIENT_KEYS]);
    expect(p).toMatchObject({ id: withDob, name: "Meena Pawar Palette", phoneLast4: "0001" });
    expect(p.ageSex?.sex).toBe("F");
    expect(p.ageSex?.age).toMatch(/^\d+ y$/);
    expect(JSON.stringify(found)).not.toContain("9812340001");
    expect(JSON.stringify(found)).not.toContain("1984");
  });

  it("patients: stored age when there is no date of birth; name search; only the caller's clinic", async () => {
    const byName = await searchPatientsForPalette(ctxFor(a), "Palette");
    expect(byName.map((p) => p.id).sort()).toEqual([withDob, withAge].sort());
    expect(byName.find((p) => p.id === withAge)).toEqual({ id: withAge, name: "Ravi Palette", ageSex: { age: "7 y", sex: "M" }, phoneLast4: "0002" });
    const fromB = await searchPatientsForPalette(ctxFor(b), "Meena");
    expect(fromB.map((p) => p.name).sort()).toEqual(["Meena Other Clinic", "Meena Pawar Palette"]);
    expect(fromB.map((p) => p.id)).not.toContain(withDob);
  });

  it("patients: deleted patients are left out", async () => {
    const found = await searchPatientsForPalette(ctxFor(a), "Meena");
    expect(found.map((p) => p.name)).toEqual(["Meena Pawar Palette"]);
  });

  it("patients: one character or an empty query returns nothing (no directory dump)", async () => {
    expect(await searchPatientsForPalette(ctxFor(a), "P")).toEqual([]);
    expect(await searchPatientsForPalette(ctxFor(a), "   ")).toEqual([]);
  });

  it("queue: token, name or mobile number; exactly four fields; cancelled visits and other clinics left out", async () => {
    for (const q of ["14", "#14", "T14", "token 14", "Meena", "9812340001"]) {
      const found = await searchTodayQueueForPalette(ctxFor(a), q);
      expect(found, q).toEqual([{ visitId: waitingVisit, token: 14, name: "Meena Pawar Palette", status: "waiting" }]);
      expect(Object.keys(found[0])).toEqual([...PALETTE_QUEUE_KEYS]);
    }
    expect(await searchTodayQueueForPalette(ctxFor(a), "15")).toEqual([]);
    expect((await searchTodayQueueForPalette(ctxFor(a), "Meena")).map((m) => m.name)).toEqual(["Meena Pawar Palette"]);
    expect(await searchTodayQueueForPalette(ctxFor(a), "Ravi")).toEqual([]);
    expect(await searchTodayQueueForPalette(ctxFor(a), "")).toEqual([]);
  });
});
