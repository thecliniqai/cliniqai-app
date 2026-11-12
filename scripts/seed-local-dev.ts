/**
 * Local development seed (V2-01 R7, V2-02 plan 02-03a, ruling RL-18): known synthetic logins for the PO on the LOCAL
 * Supabase stack only.
 *
 *   npm run seed:local            create or refresh "Synthetic Demo Clinic" and its five staff logins
 *   npm run seed:local -- --reset delete that clinic and those five users (nothing else)
 *
 * Safety: reads `.env.test` + `npx supabase status` only (never `.env`), then refuses to run unless every URL is
 * loopback and every key is a local-stack key (`assertLocalTestEnv`), which also pins MESSAGING_PROVIDER=dev. All data
 * is synthetic. Phone numbers: India has no reserved fictional mobile range, so the +91 90000 0000x numbers below are
 * merely valid-looking and may belong to real subscribers. They are safe only while messaging stays offline: never run
 * the app against this seed with a real messaging provider (e.g. MSG91 keys), or reminders could reach real people.
 *
 * Password: `LOCAL_DEV_SEED_PASSWORD` from the shell if set (at least 10 characters); otherwise a random one is
 * generated and printed ONCE to this terminal. It is never written to disk or committed. Every run sets the password
 * on all five users, so the printed one is always current.
 *
 * Idempotent: users are matched by their fixed emails, the clinic by name + its owner's membership, memberships and
 * patients by natural keys. Test runs never touch this data: their teardown only removes rows created during the run.
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertLocalTestEnv, loadLocalStackKeys, loadTestEnv } from "../tests/setup/test-env";

const ROOT = path.resolve(__dirname, "..");
const CLINIC_NAME = "Synthetic Demo Clinic";
const DOMAIN = "demo-clinic.example.test";

const STAFF = [
  { role: "owner", email: `owner@${DOMAIN}`, fullName: "Demo Owner" },
  { role: "admin", email: `admin@${DOMAIN}`, fullName: "Demo Admin" },
  { role: "doctor", email: `doctor@${DOMAIN}`, fullName: "Dr Demo Doctor" },
  { role: "nurse", email: `nurse@${DOMAIN}`, fullName: "Demo Nurse" },
  { role: "receptionist", email: `reception@${DOMAIN}`, fullName: "Demo Reception" },
] as const;

const PATIENTS = [
  { full_name: "Synthetic Patient One", phone: "+919000000001", sex: "female" },
  { full_name: "Synthetic Patient Two", phone: "+919000000002", sex: "male" },
  { full_name: "Synthetic Patient Three", phone: "+919000000003", sex: "other" },
] as const;

function adminClient(): SupabaseClient {
  loadTestEnv(ROOT);
  loadLocalStackKeys(ROOT);
  assertLocalTestEnv();
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function seedPassword(): { password: string; generated: boolean } {
  const fromShell = process.env.LOCAL_DEV_SEED_PASSWORD;
  if (fromShell !== undefined && fromShell !== "") {
    if (fromShell.length < 10) throw new Error("LOCAL_DEV_SEED_PASSWORD must be at least 10 characters");
    return { password: fromShell, generated: false };
  }
  return { password: `Demo-${randomBytes(12).toString("base64url")}9!`, generated: true };
}

async function findUserIds(admin: SupabaseClient): Promise<Map<string, string>> {
  const wanted = new Set<string>(STAFF.map((s) => s.email));
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
async function findClinicId(admin: SupabaseClient, ownerId: string | undefined): Promise<string | null> {
  if (!ownerId) return null;
  const { data, error } = await admin
    .from("memberships")
    .select("tenant_id, tenants!inner(name)")
    .eq("user_id", ownerId)
    .eq("role", "owner")
    .eq("tenants.name", CLINIC_NAME);
  if (error) throw new Error(`finding the demo clinic failed: ${error.message}`);
  return (data?.[0]?.tenant_id as string | undefined) ?? null;
}

async function seed(admin: SupabaseClient): Promise<void> {
  const { password, generated } = seedPassword();
  const userIds = await findUserIds(admin);

  for (const staff of STAFF) {
    const existing = userIds.get(staff.email);
    if (existing) {
      const { error } = await admin.auth.admin.updateUserById(existing, { password, email_confirm: true });
      if (error) throw new Error(`updating ${staff.email} failed: ${error.message}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email: staff.email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`creating ${staff.email} failed: ${error?.message}`);
      userIds.set(staff.email, data.user.id);
    }
  }

  const ownerId = userIds.get(STAFF[0].email)!;
  let clinicId = await findClinicId(admin, ownerId);
  if (!clinicId) {
    const { data, error } = await admin.from("tenants").insert({ name: CLINIC_NAME }).select("id").single();
    if (error || !data) throw new Error(`creating the demo clinic failed: ${error?.message}`);
    clinicId = data.id as string;
  }

  const { error: memError } = await admin.from("memberships").upsert(
    STAFF.map((s) => ({
      user_id: userIds.get(s.email)!,
      tenant_id: clinicId,
      role: s.role,
      full_name: s.fullName,
    })),
    { onConflict: "user_id,tenant_id" },
  );
  if (memError) throw new Error(`upserting memberships failed: ${memError.message}`);

  const { data: existingPatients, error: pErr } = await admin
    .from("patients")
    .select("phone")
    .eq("tenant_id", clinicId)
    .in("phone", PATIENTS.map((p) => p.phone));
  if (pErr) throw new Error(`listing demo patients failed: ${pErr.message}`);
  const have = new Set((existingPatients ?? []).map((p) => p.phone as string));
  const missing = PATIENTS.filter((p) => !have.has(p.phone));
  if (missing.length) {
    const { error } = await admin
      .from("patients")
      .insert(missing.map((p) => ({ ...p, tenant_id: clinicId, created_by: ownerId })));
    if (error) throw new Error(`creating demo patients failed: ${error.message}`);
  }

  console.log(`[seed:local] "${CLINIC_NAME}" ready on the local stack (${PATIENTS.length} synthetic patients).`);
  console.log("[seed:local] logins (password sign-in at /login):");
  for (const s of STAFF) console.log(`  ${s.role.padEnd(12)} ${s.email}`);
  if (generated) {
    console.log(`[seed:local] password (generated, shown once, not stored): ${password}`);
    console.log("[seed:local] set LOCAL_DEV_SEED_PASSWORD in your shell to choose your own.");
  } else {
    console.log("[seed:local] password: the value of LOCAL_DEV_SEED_PASSWORD in your shell.");
  }
}

async function reset(admin: SupabaseClient): Promise<void> {
  const userIds = await findUserIds(admin);
  const clinicId = await findClinicId(admin, userIds.get(STAFF[0].email));
  if (clinicId) {
    // Every tenant-scoped table cascades from tenants.
    const { error } = await admin.from("tenants").delete().eq("id", clinicId);
    if (error) throw new Error(`deleting the demo clinic failed: ${error.message}`);
  }
  for (const [email, id] of userIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleting ${email} failed: ${error.message}`);
  }
  console.log(`[seed:local] reset: removed ${clinicId ? 1 : 0} clinic and ${userIds.size} demo user(s).`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--reset");
  if (unknown.length) throw new Error(`unknown argument(s): ${unknown.join(" ")} (only --reset is supported)`);
  const admin = adminClient();
  if (args.includes("--reset")) await reset(admin);
  else await seed(admin);
}

main().catch((error: unknown) => {
  console.error(`[seed:local] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
