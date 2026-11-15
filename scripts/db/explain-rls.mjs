#!/usr/bin/env node
/**
 * RLS helper cost evidence, LOCAL STACK ONLY (V2-05 plan 05-10a; SUB §7.2 "the helper is evaluated once per statement";
 * R-15). Runs `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` for the patient list and the visit list as a simulated doctor of the
 * seeded demo clinic (`npm run seed:local`), inside the local stack's Postgres container (`docker exec … psql`, the
 * container named after supabase/config.toml's project_id, never a URL), in a transaction that is rolled back. Inside
 * that transaction (as postgres, before the role switch) 30 synthetic patients and 30 completed visits are added to the
 * demo clinic, so each scan filters real rows; all of it is rolled back.
 *
 * Asserts, per query: the policy's helper call (`authz.tenant_ids_with` / `authz.full_tenant_ids`) sits in an InitPlan
 * or a hashed SubPlan whose node ran with `loops=1`, i.e. once per statement, not once per row (the `(select …)`
 * wrapping of every policy, 05-PLAN per-migration checklist item 3). Writes the plans (no row data: EXPLAIN prints
 * plan nodes and counts only) to the output file.
 *
 * Refusals (exit 1, before any docker call): any argument but `--out <file>`; `DOCKER_HOST` naming a non-loopback
 * daemon. Exit 0 = every assertion holds; 1 = refused or an assertion failed.
 *
 * Usage: node scripts/db/explain-rls.mjs [--out <file>]
 *   (default: .planning/phases/05-db-authorisation-entitlements/evidence/05b/explain-rls.txt)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_OUT = ".planning/phases/05-db-authorisation-entitlements/evidence/05b/explain-rls.txt";
const DEMO_CLINIC_NAME = "Synthetic Demo Clinic";
const LOOPBACK = /^(unix:\/\/|npipe:\/\/)|^tcp:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/;

const QUERIES = [
  {
    name: "patient list (patients:view)",
    sql: "select id, full_name from public.patients order by created_at desc limit 50",
    helper: "authz.tenant_ids_with('patients:view'",
  },
  {
    name: "visit list (appointments:view)",
    sql: "select id, status, scheduled_at from public.visits order by scheduled_at desc nulls last limit 100",
    helper: "authz.tenant_ids_with('appointments:view'",
  },
];

function fail(msg) {
  process.stderr.write(`explain-rls: ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
let out = DEFAULT_OUT;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out" && args[i + 1]) out = args[++i];
  else fail(`refusing argument ${JSON.stringify(args[i])} (only --out <file>)`);
}
if (process.env.DOCKER_HOST && !LOOPBACK.test(process.env.DOCKER_HOST)) fail("refusing: DOCKER_HOST is not a local daemon");

const toml = fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
if (!projectId) fail("project_id not found in supabase/config.toml");
const container = `supabase_db_${projectId}`;

function psql(sql) {
  const res = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: sql,
    encoding: "utf8",
  });
  if (res.status !== 0) fail(`psql failed (exit ${res.status}): ${(res.stderr || "").split("\n")[0]}`);
  return res.stdout;
}

const doctor = psql(
  "select m.user_id from public.memberships m join public.tenants t on t.id = m.tenant_id " +
    `where t.name = '${DEMO_CLINIC_NAME}' and m.role = 'doctor' and m.status = 'active' order by m.created_at limit 1;`,
).trim();
if (!/^[0-9a-f-]{36}$/.test(doctor)) fail("no active doctor of the demo clinic (run npm run seed:local)");
const level = psql(
  `select billing_internal.tenant_access_level(t.id, now()) from public.tenants t where t.name = '${DEMO_CLINIC_NAME}' limit 1;`,
).trim();

const report = [
  `# explain-rls (05-10a): RLS helper evaluation per statement, local stack, demo clinic access level = ${level}`,
  `# simulated principal: a doctor of "${DEMO_CLINIC_NAME}" (role authenticated, JWT sub only); plans only, no row data`,
  "",
];
let failures = 0;
for (const q of QUERIES) {
  const plan = psql(
    [
      "begin;",
      // Synthetic rows for the scan (rolled back with the transaction).
      "insert into public.patients (tenant_id, full_name, phone, created_by) " +
        `select t.id, 'Synthetic Explain Patient ' || g, '+9190000' || lpad((50000 + g)::text, 5, '0'), '${doctor}' ` +
        `from public.tenants t cross join generate_series(1, 30) g where t.name = '${DEMO_CLINIC_NAME}';`,
      "insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, created_by, status, scheduled_at) " +
        `select p.tenant_id, p.id, '${doctor}', 'walk_in', '${doctor}', 'completed', now() - (row_number() over () || ' days')::interval ` +
        `from public.patients p join public.tenants t on t.id = p.tenant_id where t.name = '${DEMO_CLINIC_NAME}' and p.full_name like 'Synthetic Explain Patient %';`,
      `select set_config('request.jwt.claims', json_build_object('sub', '${doctor}', 'role', 'authenticated')::text, true) is not null;`,
      "set local role authenticated;",
      `explain (analyze, buffers, verbose, costs off, timing off, summary off) ${q.sql};`,
      "rollback;",
    ].join("\n"),
  )
    .split("\n")
    .filter((l) => l !== "t")
    .join("\n");
  const lines = plan.split("\n");
  const sub = lines.findIndex((l) => /^\s*(InitPlan|SubPlan) \d+/.test(l));
  const helperLine = lines.findIndex((l) => l.includes(q.helper));
  // The node right under the InitPlan/SubPlan header is the helper's evaluation; it must have run once.
  const evalLine = sub >= 0 ? lines.slice(sub + 1).find((l) => /actual rows=\d+ loops=\d+/.test(l)) : undefined;
  const loops = evalLine ? Number(/loops=(\d+)/.exec(evalLine)?.[1]) : NaN;
  const ok = sub >= 0 && helperLine >= 0 && loops === 1;
  if (!ok) failures++;
  report.push(`## ${q.name}`);
  report.push(`sql: ${q.sql}`);
  report.push(
    `assert: helper ${q.helper}…) in ${sub >= 0 ? lines[sub].trim() : "NO InitPlan/SubPlan"}, evaluated with loops=${loops}: ${ok ? "PASS" : "FAIL"}`,
  );
  report.push("");
  report.push(plan.trimEnd());
  report.push("");
}
report.push(failures === 0 ? "explain-rls: PASS" : `explain-rls: FAIL (${failures} quer${failures === 1 ? "y" : "ies"})`);
fs.mkdirSync(path.dirname(path.resolve(ROOT, out)), { recursive: true });
fs.writeFileSync(path.resolve(ROOT, out), report.join("\n") + "\n");
process.stdout.write(`${report[report.length - 1]} (${out})\n`);
process.exit(failures === 0 ? 0 : 1);
