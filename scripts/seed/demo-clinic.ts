/**
 * Synthetic demo clinic: the seeding core shared by `scripts/seed-local-dev.ts` (local stack, V2-02 RL-18) and
 * `scripts/seed-staging.ts` (hosted staging, V2-03 03-08). It takes an already-guarded admin client; it performs no
 * target check of its own, so it is never run directly. Each caller owns its guard: the local seed refuses anything
 * but the loopback stack (`assertLocalTestEnv`), the staging seed refuses anything but the staging project
 * (`scripts/staging/target-guard.mjs`).
 *
 * All data is synthetic. Phone numbers (03-13b M-SEEDPHONE): India has no reserved fictional mobile range, so every
 * seeded number is built from `SYNTHETIC_PHONE_PREFIX` (`+91 90000 000xx`, `lib/messaging/synthetic-numbers.ts`), the
 * range every real messaging provider refuses to send to on every tier (03-13d guard). A seeded environment therefore
 * cannot message a stranger even after a real provider is switched on.
 *
 * Idempotent: users are matched by their fixed emails, the clinic by name + its owner's membership, memberships and
 * patients by natural keys. Every run sets the given password on all five users.
 *
 * Subscription (V2-05 05-09c, R-25): the demo clinic is `active` on the Standard price with a one-year comp
 * (`comp_until`), refreshed by every run, so it keeps full access and the Standard keys once access is enforced
 * (05-10a). `accessSummary` counts clinics by access level for the seeds' one-line report (counts only).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
// Relative import: tsx runs the seeds without the `@/` alias. The messaging guard's own constant, so the seed cannot
// drift out of the range the providers refuse.
import { SYNTHETIC_PHONE_PREFIX } from "../../lib/messaging/synthetic-numbers";

export const DEMO_CLINIC_NAME = "Synthetic Demo Clinic";
export const DEMO_EMAIL_DOMAIN = "demo-clinic.example.test";

export const DEMO_ROLES = ["owner", "admin", "doctor", "nurse", "receptionist"] as const;

const STAFF_TEMPLATE = [
  { role: "owner", local: "owner", fullName: "Demo Owner" },
  { role: "admin", local: "admin", fullName: "Demo Admin" },
  { role: "doctor", local: "doctor", fullName: "Dr Demo Doctor" },
  { role: "nurse", local: "nurse", fullName: "Demo Nurse" },
  { role: "receptionist", local: "reception", fullName: "Demo Reception" },
] as const;

export const DEMO_PATIENTS = [
  { full_name: "Synthetic Patient One", phone: `${SYNTHETIC_PHONE_PREFIX}01`, sex: "female" },
  { full_name: "Synthetic Patient Two", phone: `${SYNTHETIC_PHONE_PREFIX}02`, sex: "male" },
  { full_name: "Synthetic Patient Three", phone: `${SYNTHETIC_PHONE_PREFIX}03`, sex: "other" },
] as const;

export interface DemoClinicOptions {
  /** Clinic (tenant) name; default "Synthetic Demo Clinic". */
  clinicName?: string;
  /** Domain of the five staff emails; default `demo-clinic.example.test` (RFC 2606, never deliverable). */
  emailDomain?: string;
}

export interface DemoStaff {
  role: (typeof DEMO_ROLES)[number];
  email: string;
  fullName: string;
}

export function demoStaff(emailDomain: string = DEMO_EMAIL_DOMAIN): DemoStaff[] {
  return STAFF_TEMPLATE.map((s) => ({ role: s.role, email: `${s.local}@${emailDomain}`, fullName: s.fullName }));
}

async function findUserIds(admin: SupabaseClient, staff: DemoStaff[]): Promise<Map<string, string>> {
  const wanted = new Set<string>(staff.map((s) => s.email));
  const found = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listing users failed: ${error.message}`);
    for (const u of data.users) if (u.email && wanted.has(u.email)) found.set(u.email, u.id);
    if (data.users.length < 1000) break;
  }
  return found;
}

/** The demo clinic: the tenant with this name in which the demo owner is the owner. */
async function findClinicId(admin: SupabaseClient, ownerId: string | undefined, clinicName: string): Promise<string | null> {
  if (!ownerId) return null;
  const { data, error } = await admin
    .from("memberships")
    .select("tenant_id, tenants!inner(name)")
    .eq("user_id", ownerId)
    .eq("role", "owner")
    .eq("tenants.name", clinicName);
  if (error) throw new Error(`finding the demo clinic failed: ${error.message}`);
  return (data?.[0]?.tenant_id as string | undefined) ?? null;
}

export interface SeedResult {
  clinicId: string;
  staff: DemoStaff[];
  patientsCreated: number;
}

/** Creates or refreshes the demo clinic, its five staff logins (all with `password`) and three synthetic patients. */
export async function seedDemoClinic(
  admin: SupabaseClient,
  password: string,
  options: DemoClinicOptions = {},
): Promise<SeedResult> {
  const clinicName = options.clinicName ?? DEMO_CLINIC_NAME;
  const staff = demoStaff(options.emailDomain);
  const userIds = await findUserIds(admin, staff);

  for (const s of staff) {
    const existing = userIds.get(s.email);
    if (existing) {
      const { error } = await admin.auth.admin.updateUserById(existing, { password, email_confirm: true });
      if (error) throw new Error(`updating ${s.email} failed: ${error.message}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email: s.email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`creating ${s.email} failed: ${error?.message}`);
      userIds.set(s.email, data.user.id);
    }
  }

  const ownerId = userIds.get(staff[0].email)!;
  let clinicId = await findClinicId(admin, ownerId, clinicName);
  if (!clinicId) {
    const { data, error } = await admin.from("tenants").insert({ name: clinicName }).select("id").single();
    if (error || !data) throw new Error(`creating the demo clinic failed: ${error?.message}`);
    clinicId = data.id as string;
  }

  const { error: memError } = await admin.from("memberships").upsert(
    staff.map((s) => ({
      user_id: userIds.get(s.email)!,
      tenant_id: clinicId,
      role: s.role,
      full_name: s.fullName,
    })),
    { onConflict: "user_id,tenant_id" },
  );
  if (memError) throw new Error(`upserting memberships failed: ${memError.message}`);

  await compDemoClinic(admin, clinicId);

  const { data: existingPatients, error: pErr } = await admin
    .from("patients")
    .select("phone")
    .eq("tenant_id", clinicId)
    .in("phone", DEMO_PATIENTS.map((p) => p.phone));
  if (pErr) throw new Error(`listing demo patients failed: ${pErr.message}`);
  const have = new Set((existingPatients ?? []).map((p) => p.phone as string));
  const missing = DEMO_PATIENTS.filter((p) => !have.has(p.phone));
  if (missing.length) {
    const { error } = await admin
      .from("patients")
      .insert(missing.map((p) => ({ ...p, tenant_id: clinicId, created_by: ownerId })));
    if (error) throw new Error(`creating demo patients failed: ${error.message}`);
  }

  return { clinicId, staff, patientsCreated: missing.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Subscription (V2-05 05-09c; SUB-01 `comp_until` for dev and staging; ruling R-25; research Pitfall 8)
// ---------------------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** The Standard plan's price active now, by plan code (never a fixed id). */
async function standardPriceId(admin: SupabaseClient): Promise<string> {
  const { data: plan, error } = await admin.from("plans").select("id").eq("code", "standard").single();
  if (error || !plan) throw new Error(`finding the Standard plan failed: ${error?.message ?? "no row"}`);
  const now = new Date().toISOString();
  const { data: price, error: priceError } = await admin
    .from("plan_prices")
    .select("id")
    .eq("plan_id", plan.id)
    .lte("active_from", now)
    .or(`active_until.is.null,active_until.gt.${now}`)
    .order("active_from", { ascending: false })
    .limit(1)
    .single();
  if (priceError || !price) throw new Error(`finding the Standard price failed: ${priceError?.message ?? "no row"}`);
  return price.id as string;
}

/**
 * The demo clinic is a comped, `active` Standard clinic: full access for a year from each seed run, whatever happens
 * to billing, with the Standard keys (a comp without a price has none, Pitfall 8). The row exists from the clinic's
 * creation (`tenants_create_subscription`, `incomplete`); the seed shapes it with the service role.
 */
async function compDemoClinic(admin: SupabaseClient, clinicId: string): Promise<void> {
  const price = await standardPriceId(admin);
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const { data, error } = await admin
    .from("tenant_subscriptions")
    .update({
      status: "active",
      plan_price_id: price,
      current_period_start: iso(now),
      current_period_end: iso(now + 30 * DAY_MS),
      access_ends_at: iso(now + 31 * DAY_MS),
      cancel_at_period_end: false,
      canceled_at: null,
      cancel_source: null,
      past_due_since: null,
      grace_until: null,
      halted_at: null,
      expired_at: null,
      comp_until: iso(now + 365 * DAY_MS),
      updated_at: iso(now),
    })
    .eq("tenant_id", clinicId)
    .select("tenant_id");
  if (error) throw new Error(`setting the demo clinic's subscription failed: ${error.message}`);
  if (!data || data.length !== 1) throw new Error("setting the demo clinic's subscription failed: no subscription row");
}

export interface AccessSummary {
  full: number;
  locked: number;
  onboarding: number;
  /** `none` (purged) or no subscription row at all (never expected: every clinic gets one at creation). */
  other: number;
}

/**
 * Counts clinics by access level at the current time (`public.tenant_access_for_system`, service role only; R-28).
 * Counts only: no clinic name or id is returned or printed.
 */
export async function accessSummary(admin: SupabaseClient): Promise<AccessSummary> {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("tenants").select("id").order("id").range(from, from + 999);
    if (error) throw new Error(`listing clinics failed: ${error.message}`);
    ids.push(...(data ?? []).map((t) => t.id as string));
    if (!data || data.length < 1000) break;
  }
  const summary: AccessSummary = { full: 0, locked: 0, onboarding: 0, other: 0 };
  for (let i = 0; i < ids.length; i += 20) {
    const levels = await Promise.all(
      ids.slice(i, i + 20).map(async (id) => {
        const { data, error } = await admin.rpc("tenant_access_for_system", { p_tenant: id });
        if (error) throw new Error(`reading a clinic's access level failed: ${error.message}`);
        return data as string | null;
      }),
    );
    for (const level of levels) {
      if (level === "full" || level === "locked" || level === "onboarding") summary[level] += 1;
      else summary.other += 1;
    }
  }
  return summary;
}

/** The one line both seeds print (counts only). */
export function formatAccessSummary(s: AccessSummary): string {
  return `access summary: full=${s.full} locked=${s.locked} onboarding=${s.onboarding}${s.other ? ` other=${s.other}` : ""}`;
}

/** Deletes the demo clinic (every tenant table cascades from tenants) and its five users; nothing else. */
export async function resetDemoClinic(
  admin: SupabaseClient,
  options: DemoClinicOptions = {},
): Promise<{ clinicsRemoved: number; usersRemoved: number }> {
  const clinicName = options.clinicName ?? DEMO_CLINIC_NAME;
  const staff = demoStaff(options.emailDomain);
  const userIds = await findUserIds(admin, staff);
  const clinicId = await findClinicId(admin, userIds.get(staff[0].email), clinicName);
  if (clinicId) {
    const { error } = await admin.from("tenants").delete().eq("id", clinicId);
    if (error) throw new Error(`deleting the demo clinic failed: ${error.message}`);
  }
  for (const [email, id] of userIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleting ${email} failed: ${error.message}`);
  }
  return { clinicsRemoved: clinicId ? 1 : 0, usersRemoved: userIds.size };
}
