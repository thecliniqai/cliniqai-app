/**
 * The command palette's today-queue projection (V2-06 06-04b; T-06-17) against the local stack: exactly visit id, token,
 * name and status for today's visits matching a token, a name or a mobile number, cancelled visits left out. Synthetic
 * data only. (The palette's patient search moved to `GET /api/patients/search`, V2-08 08-02: see
 * `tests/patients/search-patients-db.spec.ts` and `search-route.spec.ts`.)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CLINIC_TZ, todayInTz } from "@/lib/datetime";
import { seedTenantWithOwner } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
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
  const { data, error } = await getAdminClient()
    .from("patients")
    .insert({ tenant_id: t.tenantId, created_by: t.userId, ...fields })
    .select("id")
    .single();
  if (error || !data) throw new Error(`patient insert: ${error?.message}`);
  return (data as { id: string }).id;
}

async function visitWithToken(t: Tenant, patientId: string, status: string, token: number | null): Promise<string> {
  const { data, error } = await getAdminClient()
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

describe("palette today-queue projection", () => {
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
