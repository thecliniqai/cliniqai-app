/**
 * V2-04 04-05a: the restore-drill evidence checker (ops/restore-drill/check-evidence.ts, used for 04-P13 and the
 * nightly self-test) and the backup workflows (backup.yml, backup-alert.yml, nightly backup-roundtrip) against the
 * V2-03 workflow policy as it stands.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDrillEvidence } from "../../ops/restore-drill/check-evidence";
import { checkWorkflow } from "../../scripts/ci/workflow-policy.mjs";

const ROOT = path.resolve(__dirname, "../..");

function evidence(): Record<string, unknown> {
  return {
    format_version: 1,
    kind: "restore-drill",
    mode: "self-test",
    environment: "local",
    result: "pass",
    dump_started_at: "2026-11-13T02:00:00Z",
    drill_started_at: "2026-11-13T02:05:00Z",
    checks_green_at: "2026-11-13T02:07:30Z",
    rpo_seconds: 300,
    rto_seconds: 150,
    dump_age_h: 0.1,
    targets: { rpo_seconds_max: 43200, rto_seconds_max: 14400 },
    checks: {
      archive_digest: true,
      sql_guard: true,
      decrypt: true,
      wrong_key_refused: true,
      restore: true,
      migration_history: true,
      objects_verified: true,
      manifest_compare: true,
      drill_checks_sql: true,
      breakglass_decrypt: true,
      failed_run_recorded: true,
      tampered_archive_refused: true,
    },
    counts: { tables: 60, rows: 900, buckets: 3, objects: 1, object_bytes: 4096, policies: 99, functions: 56, auth_users: 5, pgtap_tests: 10, migrations: 32 },
    versions: { server: "17.11", cli: "2.120.0", age: "v1.3.2" },
  };
}

describe("check-evidence.ts (restore drill)", () => {
  it("passes a complete green self-test record", () => {
    expect(checkDrillEvidence(evidence())).toEqual({ ok: true, problems: [] });
  });

  it("fails RPO above 12 h and RTO above 4 h (R-4)", () => {
    const e = { ...evidence(), drill_started_at: "2026-11-13T14:00:01Z", checks_green_at: "2026-11-13T18:00:02Z", rpo_seconds: 43201, rto_seconds: 14401 };
    expect(checkDrillEvidence(e).problems).toEqual(["RPO 43201 s exceeds 43200 s (12 h, R-4)", "RTO 14401 s exceeds 14400 s (4 h, R-4)"]);
  });

  it("fails a red or missing check, and a self-test without the break-glass decrypt", () => {
    const red = evidence();
    (red.checks as Record<string, boolean>).drill_checks_sql = false;
    expect(checkDrillEvidence(red).problems).toContain("check drill_checks_sql is not green");
    const missing = evidence();
    delete (missing.checks as Record<string, boolean>).breakglass_decrypt;
    expect(checkDrillEvidence(missing).problems).toContain("check breakglass_decrypt missing (self-test)");
    const archive: Record<string, unknown> = { ...evidence(), mode: "archive" };
    delete (archive.checks as Record<string, boolean>).breakglass_decrypt;
    delete (archive.checks as Record<string, boolean>).failed_run_recorded;
    delete (archive.checks as Record<string, boolean>).tampered_archive_refused;
    expect(checkDrillEvidence(archive).ok).toBe(true);
  });

  it("04-07c (M-BACKUPAUTH): a drill without the digest check or the SQL guard fails, in either mode", () => {
    for (const mode of ["self-test", "archive"]) {
      for (const check of ["archive_digest", "sql_guard"]) {
        const e: Record<string, unknown> = { ...evidence(), mode };
        const checks = { ...(e.checks as Record<string, boolean>) };
        delete checks[check];
        e.checks = checks;
        expect(checkDrillEvidence(e).problems, `${mode} ${check}`).toContain(`check ${check} missing`);
      }
    }
    const noTamper = evidence();
    delete (noTamper.checks as Record<string, boolean>).tampered_archive_refused;
    expect(checkDrillEvidence(noTamper).problems).toContain("check tampered_archive_refused missing (self-test)");
  });

  it("refuses anything but counts and verdicts: an unknown key, a name in counts, a free-text version", () => {
    expect(checkDrillEvidence({ ...evidence(), table_names: ["patients"] }).problems).toContain("table_names is not an allowed key");
    const named = evidence();
    (named.counts as Record<string, unknown>).patients = "Ravi Kumar";
    expect(checkDrillEvidence(named).problems).toContain("counts.patients is not an allowed key");
    const text = evidence();
    (text.versions as Record<string, unknown>).server = "PostgreSQL on patient-db.internal";
    expect(checkDrillEvidence(text).problems).toContain("versions.server is not a version string");
  });

  it("fails when RPO/RTO do not match the recorded timestamps", () => {
    expect(checkDrillEvidence({ ...evidence(), rto_seconds: 10 }).problems).toContain("rto_seconds does not match checks_green_at - drill_started_at");
  });
});

describe("backup workflows under scripts/ci/workflow-policy.mjs", () => {
  const workflow = (name: string) => fs.readFileSync(path.join(ROOT, ".github/workflows", name), "utf8");
  const rules = (name: string, text: string) => checkWorkflow(`.github/workflows/${name}`, text).map((f) => f.rule);

  it("backup.yml passes as a staging workflow: no PR trigger, read-only token, secrets only in step env, no ${{ }} in run", () => {
    const text = workflow("backup.yml");
    expect(rules("backup.yml", text)).toEqual([]);
    // It is treated as a staging workflow (Environment `staging`), so each staging rule bites on a bypass.
    expect(rules("backup.yml", text.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n  pull_request:\n"))).toContain("staging-no-pr-trigger");
    expect(rules("backup.yml", text.replace("permissions:\n  contents: read\n", "permissions:\n  contents: read\n  issues: write\n"))).toContain("staging-read-only-token");
    expect(rules("backup.yml", text.replace("run: npm ci --ignore-scripts", "run: npm ci"))).toContain("privileged-ignore-scripts");
    expect(rules("backup.yml", text.replace("bash ops/backup/backup.sh", "bash ops/backup/backup.sh ${{ inputs.force_fail }}"))).toContain("run-no-untrusted-expression");
  });

  it("backup-alert.yml (issues: write, no secret, not a staging workflow) passes", () => {
    expect(rules("backup-alert.yml", workflow("backup-alert.yml"))).toEqual([]);
  });

  it("nightly.yml with the backup-roundtrip job passes the policy", () => {
    const text = fs.readFileSync(path.join(ROOT, ".github/workflows/nightly.yml"), "utf8");
    expect(checkWorkflow(".github/workflows/nightly.yml", text)).toEqual([]);
  });
});
