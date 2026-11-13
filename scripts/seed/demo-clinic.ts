/**
 * Synthetic demo clinic: the seeding core shared by `scripts/seed-local-dev.ts` (local stack, V2-02 RL-18) and
 * `scripts/seed-staging.ts` (hosted staging, V2-03 03-08). It takes an already-guarded admin client; it performs no
 * target check of its own, so it is never run directly. Each caller owns its guard: the local seed refuses anything
 * but the loopback stack (`assertLocalTestEnv`), the staging seed refuses anything but the staging project
 * (`scripts/staging/target-guard.mjs`).
 *
 * All data is synthetic. Phone numbers (03-13b M-SEEDPHONE): India has no reserved fictional mobile range, so every
 * seeded number comes from the project's synthetic block `+91 60000 000NN` (`lib/utils/synthetic-phones.ts`), which
 * the messaging layer refuses to send to on every tier. A seeded environment therefore cannot message a stranger even
 * after a real provider is switched on. Seeds written before 03-13b used `+91 90000 0000x`; a refresh moves those
 * three demo patients onto the synthetic numbers.
 *
 * Idempotent: users are matched by their fixed emails, the clinic by name + its owner's membership, memberships and
 * patients by natural keys. Every run sets the given password on all five users.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
// Relative import: tsx runs the seeds without the `@/` alias.
import { syntheticPhone } from "../../lib/utils/synthetic-phones";

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
  { full_name: "Synthetic Patient One", phone: syntheticPhone(1), sex: "female" },
  { full_name: "Synthetic Patient Two", phone: syntheticPhone(2), sex: "male" },
  { full_name: "Synthetic Patient Three", phone: syntheticPhone(3), sex: "other" },
] as const;

/**
 * The numbers the demo patients had before 03-13b (`+91 90000 0000x`, possibly real subscribers), in DEMO_PATIENTS
 * order. A refresh moves a demo-clinic patient still on one of these onto its synthetic number.
 */
export const LEGACY_DEMO_PHONES = ["+919000000001", "+919000000002", "+919000000003"] as const;

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

  // Seeds from before 03-13b: move the three demo patients off their old, possibly real numbers (this clinic only).
  for (const [i, legacy] of LEGACY_DEMO_PHONES.entries()) {
    const { error } = await admin.from("patients").update({ phone: DEMO_PATIENTS[i].phone }).eq("tenant_id", clinicId).eq("phone", legacy);
    if (error) throw new Error(`moving a demo patient to the synthetic range failed: ${error.message}`);
  }

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
