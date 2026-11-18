/**
 * Synthetic demo clinic seed (V2-03 03-08): the seeding core that `npm run seed:local` and `scripts/seed-staging.ts`
 * share (scripts/seed/demo-clinic.ts), run against the LOCAL stack only. It uses its own clinic name and email domain
 * per run, so it never touches the PO's local demo logins.
 *
 * Proves: one run creates the clinic, five confirmed staff users with the five roles, and three synthetic patients;
 * the password works for sign-in; a second run is idempotent (same clinic, no new patients, password refreshed);
 * reset removes exactly that clinic and those users. 03-13b (M-SEEDPHONE): every phone the seed writes is in the
 * synthetic range every real messaging provider refuses (`lib/messaging/synthetic-numbers.ts`, 03-13d guard).
 * V2-05 05-09c (R-25, Pitfall 8): the clinic is `active` on the Standard price with a one-year comp, so its owner reads
 * `full` access and the Standard keys; a re-run refreshes the comp; `accessSummary` counts it as full (counts only).
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { publicEnv } from "@/lib/env";
import { isSyntheticPhone } from "@/lib/messaging/synthetic-numbers";
import {
  accessSummary,
  DEMO_PATIENTS,
  DEMO_ROLES,
  demoStaff,
  formatAccessSummary,
  resetDemoClinic,
  seedDemoClinic,
} from "@/scripts/seed/demo-clinic";
import { getAdminClient } from "../helpers/supabase-admin";

const run = randomBytes(4).toString("hex");
const options = { clinicName: `Synthetic Seed Spec Clinic ${run}`, emailDomain: `seed-spec-${run}.example.test` };
const firstPassword = `Seed-spec-${randomBytes(9).toString("base64url")}`;
const secondPassword = `Seed-spec-${randomBytes(9).toString("base64url")}`;

async function signIn(email: string, password: string) {
  const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  return { ok: !error && !!data.session, userId: data.user?.id ?? null, client: anon };
}

describe("demo clinic seeding core (local stack)", () => {
  const admin = getAdminClient();
  let clinicId = "";

  afterAll(async () => {
    await resetDemoClinic(admin, options);
  });

  it("creates the clinic, five staff with the five roles and three synthetic patients", async () => {
    const result = await seedDemoClinic(admin, firstPassword, options);
    clinicId = result.clinicId;
    expect(result.patientsCreated).toBe(DEMO_PATIENTS.length);
    expect(result.staff.map((s) => s.email)).toEqual(demoStaff(options.emailDomain).map((s) => s.email));

    const { data: tenant } = await admin.from("tenants").select("name").eq("id", clinicId).single();
    expect(tenant?.name).toBe(options.clinicName);

    const { data: memberships } = await admin.from("memberships").select("role, user_id").eq("tenant_id", clinicId);
    expect((memberships ?? []).map((m) => m.role).sort()).toEqual([...DEMO_ROLES].sort());

    const { data: patients } = await admin.from("patients").select("phone").eq("tenant_id", clinicId);
    expect((patients ?? []).map((p) => p.phone).sort()).toEqual(DEMO_PATIENTS.map((p) => p.phone).sort());
    // 03-13b M-SEEDPHONE: every number the seed wrote is in the synthetic range (never a possibly real subscriber's).
    expect(patients).toHaveLength(3);
    for (const p of patients ?? []) expect(isSyntheticPhone(p.phone as string), p.phone as string).toBe(true);

    const owner = await signIn(`owner@${options.emailDomain}`, firstPassword);
    expect(owner.ok).toBe(true);
    expect((memberships ?? []).some((m) => m.user_id === owner.userId && m.role === "owner")).toBe(true);
  });

  it("comps the clinic: active on the Standard price for a year, full access and the Standard keys for its owner", async () => {
    const { data: sub, error } = await admin
      .from("tenant_subscriptions")
      .select("status, plan_price_id, comp_until, plan_prices!inner(plans!inner(code))")
      .eq("tenant_id", clinicId)
      .single();
    expect(error).toBeNull();
    expect(sub?.status).toBe("active");
    expect(sub?.plan_prices).toMatchObject({ plans: { code: "standard" } });
    const compDays = (Date.parse(sub!.comp_until!) - Date.now()) / 86_400_000;
    expect(compDays).toBeGreaterThan(364);
    expect(compDays).toBeLessThanOrEqual(365);

    const owner = await signIn(`owner@${options.emailDomain}`, firstPassword);
    const { data: level } = await owner.client.rpc("my_tenant_access", { p_tenant: clinicId });
    expect(level).toBe("full");
    const { data: keys } = await owner.client.rpc("my_entitlements", { p_tenant: clinicId });
    const enabled = new Set(((keys ?? []) as Array<{ key: string; enabled: boolean }>).filter((k) => k.enabled).map((k) => k.key));
    expect(enabled.has("core.*")).toBe(true);
    expect(enabled.has("assist.allergy_check")).toBe(true);
    expect(enabled.has("ai.scribe")).toBe(false);
  });

  it("counts clinics by access level for the seeds' report: the demo clinic is full; counts only", async () => {
    const summary = await accessSummary(admin);
    expect(summary.full).toBeGreaterThanOrEqual(1);
    // Other spec files create clinics concurrently, so the total is not compared with an exact clinic count.
    expect(summary.full + summary.locked + summary.onboarding + summary.other).toBeGreaterThan(0);
    const line = formatAccessSummary(summary);
    expect(line).toMatch(/^access summary: full=\d+ locked=\d+ onboarding=\d+( other=\d+)?$/);
    expect(line).not.toContain(options.clinicName);
  });

  it("is idempotent: a second run keeps the clinic, adds no patients and sets the new password", async () => {
    const again = await seedDemoClinic(admin, secondPassword, options);
    expect(again.clinicId).toBe(clinicId);
    expect(again.patientsCreated).toBe(0);
    const { count } = await admin.from("patients").select("id", { count: "exact", head: true }).eq("tenant_id", clinicId);
    expect(count).toBe(DEMO_PATIENTS.length);
    expect((await signIn(`doctor@${options.emailDomain}`, firstPassword)).ok).toBe(false);
    expect((await signIn(`doctor@${options.emailDomain}`, secondPassword)).ok).toBe(true);
    const { data: sub } = await admin.from("tenant_subscriptions").select("status, comp_until").eq("tenant_id", clinicId).single();
    expect(sub?.status).toBe("active");
    expect(Date.parse(sub!.comp_until!)).toBeGreaterThan(Date.now() + 364 * 86_400_000);
  });

  it("reset removes exactly that clinic and its five users", async () => {
    const removed = await resetDemoClinic(admin, options);
    expect(removed).toEqual({ clinicsRemoved: 1, usersRemoved: 5 });
    const { data: tenant } = await admin.from("tenants").select("id").eq("id", clinicId).maybeSingle();
    expect(tenant).toBeNull();
    expect((await signIn(`owner@${options.emailDomain}`, secondPassword)).ok).toBe(false);
    expect(await resetDemoClinic(admin, options)).toEqual({ clinicsRemoved: 0, usersRemoved: 0 });
  });
});
