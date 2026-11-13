/**
 * Staging seed (V2-03 03-08, P1-35a; rulings R-9, R-21): the synthetic demo clinic of `npm run seed:local`, on the
 * hosted STAGING project. Runs only in `.github/workflows/staging.yml` (job `seed`, `workflow_dispatch` task `seed` or
 * `seed-reset`) inside the GitHub Environment `staging`, after the PO approves the run. Agents never run it.
 *
 *   npx tsx scripts/seed-staging.ts            create or refresh "Synthetic Demo Clinic" and its five staff logins
 *   npx tsx scripts/seed-staging.ts --reset    delete that clinic and those five users (nothing else)
 *
 * Refuses (exit 1, before any request) unless every one of these holds:
 *   - `APP_ENV=staging`;
 *   - `STAGING_SUPABASE_URL` is `https://<SUPABASE_PROJECT_REF_STAGING>.supabase.co` (scripts/staging/target-guard.mjs:
 *     no loopback, no IP literal, no other project);
 *   - `STAGING_SECRET_KEY` is a hosted secret key (`sb_secret_…`; a local-stack JWT is refused);
 *   - `STAGING_SEED_PASSWORD` has at least 16 characters (staging is reachable from the internet; it is never
 *     generated, printed or stored by this script).
 * Never reads any `.env*` file. Prints the clinic name, the five login emails and counts only.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEMO_CLINIC_NAME, resetDemoClinic, seedDemoClinic } from "./seed/demo-clinic";
import { REF_VAR, stagingTargetProblems } from "./staging/target-guard.mjs";

const TAG = "[seed:staging]";
const MIN_PASSWORD = 16;

type Env = Record<string, string | undefined>;

/** Every reason the environment is not an approved staging seed run. Empty = go. */
function stagingSeedProblems(env: Env): string[] {
  const problems: string[] = [];
  if (env.APP_ENV !== "staging") problems.push(`APP_ENV must be "staging" (got ${env.APP_ENV ? JSON.stringify(env.APP_ENV) : "unset"})`);
  for (const p of stagingTargetProblems({ url: env.STAGING_SUPABASE_URL, ref: env[REF_VAR], kind: "api" })) {
    problems.push(`STAGING_SUPABASE_URL: ${p}`);
  }
  const key = env.STAGING_SECRET_KEY ?? "";
  if (!key.startsWith("sb_secret_")) problems.push("STAGING_SECRET_KEY must be a hosted secret key (sb_secret_…)");
  const password = env.STAGING_SEED_PASSWORD ?? "";
  if (password.length < MIN_PASSWORD) problems.push(`STAGING_SEED_PASSWORD must be set and at least ${MIN_PASSWORD} characters`);
  return problems;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--reset");
  if (unknown.length) {
    console.error(`${TAG} unknown argument(s): ${unknown.join(" ")} (only --reset is supported)`);
    return 2;
  }
  const env = process.env as Env;
  const problems = stagingSeedProblems(env);
  if (problems.length) {
    console.error(`${TAG} REFUSED: this is not an approved staging seed run.`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }

  const admin: SupabaseClient = createClient(env.STAGING_SUPABASE_URL!, env.STAGING_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  if (args.includes("--reset")) {
    const { clinicsRemoved, usersRemoved } = await resetDemoClinic(admin);
    console.log(`${TAG} reset: removed ${clinicsRemoved} clinic and ${usersRemoved} demo user(s) from ${env[REF_VAR]}.`);
    return 0;
  }
  const { staff, patientsCreated } = await seedDemoClinic(admin, env.STAGING_SEED_PASSWORD!);
  console.log(`${TAG} "${DEMO_CLINIC_NAME}" ready on staging ${env[REF_VAR]} (${patientsCreated} synthetic patient(s) created).`);
  console.log(`${TAG} logins (password sign-in; the password is STAGING_SEED_PASSWORD in the staging Environment):`);
  for (const s of staff) console.log(`  ${s.role.padEnd(12)} ${s.email}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`${TAG} ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
