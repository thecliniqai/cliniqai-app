/**
 * Synthetic demo clinic seed (V2-03 03-08): the seeding core that `npm run seed:local` and `scripts/seed-staging.ts`
 * share (scripts/seed/demo-clinic.ts), run against the LOCAL stack only. It uses its own clinic name and email domain
 * per run, so it never touches the PO's local demo logins.
 *
 * Proves: one run creates the clinic, five confirmed staff users with the five roles, and three synthetic patients;
 * the password works for sign-in; a second run is idempotent (same clinic, no new patients, password refreshed);
 * reset removes exactly that clinic and those users. 03-13b (M-SEEDPHONE): every phone the seed writes is in the
 * synthetic range the messaging layer refuses (`lib/utils/synthetic-phones.ts`), and a refresh moves a pre-03-13b demo
 * patient off its old, possibly real `+91 90000 0000x` number.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { publicEnv } from "@/lib/env";
import { isSyntheticPhone } from "@/lib/utils/synthetic-phones";
import { DEMO_PATIENTS, DEMO_ROLES, LEGACY_DEMO_PHONES, demoStaff, resetDemoClinic, seedDemoClinic } from "@/scripts/seed/demo-clinic";
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
  return { ok: !error && !!data.session, userId: data.user?.id ?? null };
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

  it("is idempotent: a second run keeps the clinic, adds no patients and sets the new password", async () => {
    const again = await seedDemoClinic(admin, secondPassword, options);
    expect(again.clinicId).toBe(clinicId);
    expect(again.patientsCreated).toBe(0);
    const { count } = await admin.from("patients").select("id", { count: "exact", head: true }).eq("tenant_id", clinicId);
    expect(count).toBe(DEMO_PATIENTS.length);
    expect((await signIn(`doctor@${options.emailDomain}`, firstPassword)).ok).toBe(false);
    expect((await signIn(`doctor@${options.emailDomain}`, secondPassword)).ok).toBe(true);
  });

  it("a refresh moves a demo patient still on its pre-03-13b number into the synthetic range (03-13b M-SEEDPHONE)", async () => {
    // Recreate the old state: patient Two back on its old number, as a seed from before 03-13b left it.
    const { error } = await admin.from("patients").update({ phone: LEGACY_DEMO_PHONES[1] }).eq("tenant_id", clinicId).eq("phone", DEMO_PATIENTS[1].phone);
    expect(error).toBeNull();
    const again = await seedDemoClinic(admin, secondPassword, options);
    expect(again.patientsCreated).toBe(0);
    const { data: patients } = await admin.from("patients").select("phone").eq("tenant_id", clinicId);
    expect((patients ?? []).map((p) => p.phone).sort()).toEqual(DEMO_PATIENTS.map((p) => p.phone).sort());
    expect((patients ?? []).every((p) => isSyntheticPhone(p.phone as string))).toBe(true);
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
