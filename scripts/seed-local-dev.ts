/**
 * Local development seed (V2-01 R7, V2-02 plan 02-03a, ruling RL-18): known synthetic logins for the PO on the LOCAL
 * Supabase stack only.
 *
 *   npm run seed:local            create or refresh "Synthetic Demo Clinic" and its five staff logins
 *   npm run seed:local -- --reset delete that clinic and those five users (nothing else)
 *
 * Safety: reads `.env.test` + `npx supabase status` only (never `.env`), then refuses to run unless every URL is
 * loopback and every key is a local-stack key (`assertLocalTestEnv`), which also pins MESSAGING_PROVIDER=dev. All data
 * is synthetic. Phone numbers: India has no reserved fictional mobile range, so the +91 90000 0000x numbers in
 * `scripts/seed/demo-clinic.ts` are merely valid-looking and may belong to real subscribers. They are safe only while
 * messaging stays offline: never run the app against this seed with a real messaging provider (e.g. MSG91 keys), or
 * reminders could reach real people.
 *
 * Password: `LOCAL_DEV_SEED_PASSWORD` from the shell if set (at least 10 characters); otherwise a random one is
 * generated and printed ONCE to this terminal. It is never written to disk or committed. Every run sets the password
 * on all five users, so the printed one is always current.
 *
 * Idempotent: users are matched by their fixed emails, the clinic by name + its owner's membership, memberships and
 * patients by natural keys. Test runs never touch this data: their teardown only removes rows created during the run.
 * The seeding itself lives in `scripts/seed/demo-clinic.ts` (V2-03 03-08), shared with `scripts/seed-staging.ts`; the
 * loopback guard below is this script's own and is unchanged.
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertLocalTestEnv, loadLocalStackKeys, loadTestEnv } from "../tests/setup/test-env";
import { DEMO_CLINIC_NAME, DEMO_PATIENTS, resetDemoClinic, seedDemoClinic } from "./seed/demo-clinic";

const ROOT = path.resolve(__dirname, "..");

function adminClient(): SupabaseClient {
  loadTestEnv(ROOT);
  loadLocalStackKeys(ROOT);
  assertLocalTestEnv();
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
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

async function seed(admin: SupabaseClient): Promise<void> {
  const { password, generated } = seedPassword();
  const { staff } = await seedDemoClinic(admin, password);

  console.log(`[seed:local] "${DEMO_CLINIC_NAME}" ready on the local stack (${DEMO_PATIENTS.length} synthetic patients).`);
  console.log("[seed:local] logins (password sign-in at /login):");
  for (const s of staff) console.log(`  ${s.role.padEnd(12)} ${s.email}`);
  if (generated) {
    console.log(`[seed:local] password (generated, shown once, not stored): ${password}`);
    console.log("[seed:local] set LOCAL_DEV_SEED_PASSWORD in your shell to choose your own.");
  } else {
    console.log("[seed:local] password: the value of LOCAL_DEV_SEED_PASSWORD in your shell.");
  }
}

async function reset(admin: SupabaseClient): Promise<void> {
  const { clinicsRemoved, usersRemoved } = await resetDemoClinic(admin);
  console.log(`[seed:local] reset: removed ${clinicsRemoved} clinic and ${usersRemoved} demo user(s).`);
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
