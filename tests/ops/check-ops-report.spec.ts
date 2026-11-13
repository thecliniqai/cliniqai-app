/**
 * V2-04 04-06 (R-28; threats T-04-15, T-04-17): the ops report tooling without a database.
 *
 *   - `scripts/ops/check-ops-report.ts` (run as the workflow and the PO's verify step run it, `tsx` CLI): the committed
 *     pass fixture passes every requirement; lag below 100 samples or p95 >= 120 s, a heartbeat gap over 6 h 15 min or
 *     under 24 h of coverage, one ok backup in a full IST day, no notified dead_letter alert each fail their
 *     `--require`d requirement (exit 1) but are only data without `--require` (exit 0); a phone-, email- or UUID-shaped
 *     string, an unknown key, a missing key or free text fails schema/PII (exit 1) and the output never echoes it.
 *   - `scripts/ops/ops-report.mjs`: refuses every user but the read-only role (and every non-staging target) before
 *     any process starts; reads the digest-pinned psql image; passes the connection by variable name only.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkOpsReport, evaluateRequirements, piiProblems, type OpsReport } from "@/scripts/ops/check-ops-report";
import { dockerArgs, postgresImage, readOnlyUserProblems, reportPsqlArgs, runOpsReport } from "@/scripts/ops/ops-report.mjs";
import { ROOT } from "../ci/run-checker";

const TSX = path.join(ROOT, "node_modules/.bin/tsx");
const CHECKER = path.join(ROOT, "scripts/ops/check-ops-report.ts");
const FIXTURE = path.join(ROOT, "tests/ops/fixtures/ops-report-pass.json");
const ALL = "lag,heartbeat,quota,alert-drill,backups";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-ops-report-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const base = (): OpsReport => JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as OpsReport;

function cli(report: unknown, args: string[] = []) {
  const file = path.join(tmp, `r-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, typeof report === "string" ? report : JSON.stringify(report));
  const r = spawnSync(TSX, [CHECKER, file, ...args], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("check-ops-report.ts (CLI)", () => {
  it("the committed pass fixture passes schema, PII and every requirement (exit 0)", () => {
    const r = cli(base(), ["--require", ALL]);
    expect(r.stderr).toContain("check-ops-report: PASS (required: lag, heartbeat, quota, alert-drill, backups)");
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { ok: boolean; requirements: Record<string, { pass: boolean }> };
    expect(out.ok).toBe(true);
    expect(Object.values(out.requirements).every((x) => x.pass)).toBe(true);
  });

  it.each([
    ["lag: 99 samples", (r: OpsReport) => void (r.jobs.lag.samples = 99), "lag"],
    ["lag: p95 exactly 120 s", (r: OpsReport) => void (r.jobs.lag.p95_seconds = 120), "lag"],
    ["lag: no samples", (r: OpsReport) => void (r.jobs.lag = { samples: 0, p50_seconds: null, p95_seconds: null, max_seconds: null }), "lag"],
    ["heartbeat: a gap of 6 h 15 min 1 s", (r: OpsReport) => void (r.heartbeats.largest_gap_seconds = 22501), "heartbeat"],
    ["heartbeat: under 24 h covered", (r: OpsReport) => void (r.heartbeats.covered_seconds = 86399), "heartbeat"],
    ["quota: no snapshot", (r: OpsReport) => void (r.quota = null), "quota"],
    ["alert-drill: dead_letter not emailed", (r: OpsReport) => void (r.alerts[0].provider_id_present = false), "alert-drill"],
    ["backups: one ok run in the full IST day", (r: OpsReport) => void r.backups.splice(1, 1), "backups"],
  ])("%s -> fails --require (exit 1), but is only data without --require (exit 0)", (_label, edit, requirement) => {
    const report = base();
    edit(report);
    const required = cli(report, ["--require", requirement]);
    expect(required.status).toBe(1);
    expect(required.stderr).toContain(`check-ops-report: FAIL required ${requirement}`);
    const data = cli(report);
    expect(data.status).toBe(0);
    expect((JSON.parse(data.stdout) as { requirements: Record<string, { pass: boolean }> }).requirements[requirement].pass).toBe(false);
  });

  it.each([
    ["a phone-shaped job kind", (r: OpsReport) => void (r.jobs.by_kind_status[0].kind = "+91 90000 00042"), "phone", "90000 00042"],
    ["a bare 10-digit phone as a plan", (r: OpsReport) => void (r.quota!.plan = "9000000042"), "phone", "9000000042"],
    ["an email in an alert rule", (r: OpsReport) => void (r.alerts[0].rule = "ops.patient@example.test"), "email", "ops.patient@example.test"],
    ["a UUID as an error code", (r: OpsReport) => void (r.backups[2].error_code = "ffffffff-1111-4222-8333-444444444444"), "uuid", "ffffffff-1111"],
    ["a phone-shaped key", (r: OpsReport) => void ((r.tables as unknown as Record<string, number>)["+919000000042"] = 1), "phone", "9000000042"],
  ])("%s -> PII violation, exit 1 even without --require, and the value is never printed", (_label, edit, rule, value) => {
    const report = base();
    edit(report);
    const r = cli(report);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("check-ops-report: FAIL pii");
    const out = JSON.parse(r.stdout) as { ok: boolean; pii: { ok: boolean; problems: string[] }; schema: { ok: boolean } };
    expect(out.ok).toBe(false);
    expect(out.pii.ok).toBe(false);
    expect(out.pii.problems.join("\n")).toContain(`${rule}-shaped string`);
    expect(out.schema.ok).toBe(false);
    expect(r.stdout + r.stderr).not.toContain(value);
  });

  it.each([
    ["an unknown top-level key", (r: Record<string, unknown>) => void (r.payloads = [])],
    ["an unknown key in a job row", (r: Record<string, unknown>) => void (((r.jobs as OpsReport["jobs"]).by_kind_status[0] as Record<string, unknown>).tenant = "x")],
    ["a missing block", (r: Record<string, unknown>) => void delete r.runner],
    ["free text as a job kind", (r: Record<string, unknown>) => void ((r.jobs as OpsReport["jobs"]).by_kind_status[0].kind = "Synthetic Patientname")],
    ["a non-ISO timestamp", (r: Record<string, unknown>) => void (r.generated_at = "13/11/2026")],
    ["a negative count", (r: Record<string, unknown>) => void ((r.tables as OpsReport["tables"]).jobs = -1)],
  ])("%s -> schema violation, exit 1, value not echoed", (_label, edit) => {
    const report = base() as unknown as Record<string, unknown>;
    edit(report);
    const r = cli(report);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("check-ops-report: FAIL schema");
    expect(r.stdout + r.stderr).not.toContain("Synthetic Patientname");
  });

  it("not JSON -> exit 1; unreadable file, unknown requirement or no file -> exit 2", () => {
    expect(cli("{not json").status).toBe(1);
    const missing = spawnSync(TSX, [CHECKER, path.join(tmp, "nope.json")], { cwd: ROOT, encoding: "utf8" });
    expect(missing.status).toBe(2);
    expect(cli(base(), ["--require", "lag,uptime"]).status).toBe(2);
    expect(spawnSync(TSX, [CHECKER], { cwd: ROOT, encoding: "utf8" }).status).toBe(2);
  });

  it("the SQL editor export form [{\"report_all\": {...}}] is unwrapped; --out writes the summary", () => {
    const out = path.join(tmp, "summary.json");
    const r = cli([{ report_all: base() }], ["--require", "quota", "--out", out]);
    expect(r.status).toBe(0);
    expect((JSON.parse(fs.readFileSync(out, "utf8")) as { ok: boolean }).ok).toBe(true);
  });
});

describe("check-ops-report.ts (functions)", () => {
  it("backups count only staging ok runs in FULL IST days of the window", () => {
    const r = base();
    // A local run and a failed run never count; moving one ok run out of the IST day leaves 1.
    expect(evaluateRequirements(r).backups.detail).toMatchObject({ full_ist_days: 1, min_ok_per_day: 2 });
    r.backups[0].environment = "local";
    expect(evaluateRequirements(r).backups.pass).toBe(false);
    const late = base();
    late.backups[0].started_at = "2026-11-11T18:29:59Z"; // 23:59:59 IST on the 11th: the day before the full day
    expect(evaluateRequirements(late).backups.pass).toBe(false);
    // A 12-hour window holds no full IST day: not met (never vacuously true).
    const short = base();
    short.window_hours = 12;
    expect(evaluateRequirements(short).backups).toMatchObject({ pass: false, detail: { full_ist_days: 0 } });
  });

  it("piiProblems names the path, never the value", () => {
    expect(piiProblems({ a: ["fine", "call 9000000042"], b: { c: "x@example.test" } })).toEqual([
      "$.a[1]: phone-shaped string",
      "$.b.c: email-shaped string",
    ]);
    expect(piiProblems({ jobs: 1, at: "2026-11-13T05:00:00Z", kind: "message.send", bytes: 1_000_000_000 })).toEqual([]);
  });

  it("a report with only the documented keys at every level passes the schema", () => {
    expect(checkOpsReport(base()).schema).toEqual({ ok: true, problems: [] });
  });
});

describe("ops-report.mjs: read-only credentials only", () => {
  const REF = "abcdefghijklmnopqrst";
  const PW = ["Fixture", "Pw", "not", "real"].join("-");
  const pooler = (user: string) => `postgresql://${user}:${encodeURIComponent(PW)}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
  const direct = (user: string) => `postgresql://${user}:${encodeURIComponent(PW)}@db.${REF}.supabase.co:5432/postgres`;
  const vars = (url: string) => ({ PATH: "/usr/bin", SUPABASE_PROJECT_REF_STAGING: REF, STAGING_DB_URL_RO: url });
  const neverSpawn = () => {
    throw new Error("spawned");
  };

  it.each([
    ["the owner role on the pooler", pooler(`postgres.${REF}`)],
    ["the owner role on the direct host", direct("postgres")],
    ["authenticator (member of the API roles)", pooler(`authenticator.${REF}`)],
    ["supabase_admin", direct("supabase_admin")],
    ["a look-alike role name", pooler(`clinicos_drift_ro_rw.${REF}`)],
  ])("%s is refused before any process starts (exit 2, no password printed)", (_label, url) => {
    const r = runOpsReport({ vars: vars(url), out: path.join(tmp, "x.json"), spawnImpl: neverSpawn });
    expect(r.exitCode).toBe(2);
    expect(r.lines.join("\n")).toContain("is not the read-only role clinicos_drift_ro");
    expect(r.lines.join("\n")).not.toContain(PW);
  });

  it.each([
    ["the local stack", "postgresql://clinicos_drift_ro:x@127.0.0.1:54322/postgres"],
    ["another project's pooler user", pooler("clinicos_drift_ro.zyxwvutsrqponmlkjihg")],
    ["no URL", undefined],
  ])("%s is refused by the staging target guard (exit 2)", (_label, url) => {
    const r = runOpsReport({ vars: { ...vars(""), STAGING_DB_URL_RO: url }, out: path.join(tmp, "x.json"), spawnImpl: neverSpawn });
    expect(r.exitCode).toBe(2);
    expect(r.lines[0]).toMatch(/^ops-report: REFUSED STAGING_DB_URL_RO: /);
  });

  it("the read-only role passes the user check on both host forms", () => {
    expect(readOnlyUserProblems(pooler(`clinicos_drift_ro.${REF}`), REF)).toEqual([]);
    expect(readOnlyUserProblems(direct("clinicos_drift_ro"), REF)).toEqual([]);
  });

  it("docker gets the digest-pinned image and PG* names only; psql runs guard and report in one read-only transaction", () => {
    const image = postgresImage();
    expect(image).toMatch(/^postgres:17[^@]*@sha256:[0-9a-f]{64}$/);
    const args = dockerArgs(image, 48);
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "--read-only"]);
    expect(args.filter((a, i) => args[i - 1] === "-e")).toEqual(["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "PGCONNECT_TIMEOUT"]);
    // No NAME=value before the image: the values come from the spawn environment, never from argv.
    expect(args.slice(0, args.indexOf(image)).every((a) => !a.includes("="))).toBe(true);
    expect(args[args.indexOf(image) + 1]).toBe("psql");
    const psql = reportPsqlArgs(48);
    const statements = psql.filter((a, i) => psql[i - 1] === "-c");
    expect(statements[0]).toBe("begin read only");
    expect(statements[1]).toMatch(/^do \$guard\$/);
    expect(statements.slice(2)).toEqual(["select ops.report_all(48)", "rollback"]);
  });

  it("a guard refusal, a missing grant and unexpected output each exit 2 with a fixed message", () => {
    const fake = (status: number, stdout: string, stderr: string) => () => ({ status, stdout, stderr });
    const url = pooler(`clinicos_drift_ro.${REF}`);
    const run = (impl: ReturnType<typeof fake>) => runOpsReport({ vars: vars(url), out: path.join(tmp, "y.json"), image: "postgres:17@sha256:" + "0".repeat(64), spawnImpl: impl });
    expect(run(fake(3, "", "ERROR:  ops_report_role_not_read_only: role_membership\nCONTEXT: PL/pgSQL")).lines).toEqual([
      "ops-report: REFUSED the credentials are not read-only (role_membership); use the clinicos_drift_ro URL",
    ]);
    expect(run(fake(3, "", "ERROR:  permission denied for function report_all")).lines[0]).toContain("04-P10 grant");
    expect(run(fake(0, "{}\n{}\n", "")).lines[0]).toContain("unexpected output (2 line(s))");
    expect(run(fake(0, "[1]\n", "")).exitCode).toBe(2);
    const ok = run(fake(0, '{"report_version": 1}\n', ""));
    expect(ok.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(tmp, "y.json"), "utf8")).toContain('"report_version": 1');
  });
});
