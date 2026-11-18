/**
 * scripts/db/diagnostics.mjs + scripts/db/diagnostics.sql (V2-05 plan 05-03; BACKEND §3 D0-D10; R-15; T-05-22).
 *
 * 1. Target guard: a non-loopback `--db-url`, `--linked`, `--project-ref`, a bare connection string, a remote
 *    DOCKER_HOST or a bad label → exit 1 before any docker/psql call (spawnSync injected, never called) and nothing
 *    written.
 * 2. Parser: counts only, row values are never kept.
 * 3. The real SQL against the local stack finds planted violations: inside one psql session that is never committed
 *    (rolled back at session end), with FK triggers off (`session_replication_role = replica`, so the planted rows
 *    survive whatever constraints exist), a tenant-A visit pointing at a tenant-B patient and a visit whose doctor is
 *    not a member of its clinic raise D1, D1x and D5/D5x by exactly one over an unplanted run.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parseArgs, parseDiagnostics, runDiagnostics, SQL_FILE } from "../../scripts/db/diagnostics.mjs";
import { psqlFile } from "../helpers/sql";

class Sink {
  text = "";
  write(chunk: string) {
    this.text += chunk;
    return true;
  }
}

function deps(env: Record<string, string> = {}) {
  const spawnSync = vi.fn(() => ({ status: 0, stdout: "@@ D5 count\n0\n", stderr: "" }));
  const writeFile = vi.fn();
  const stdout = new Sink();
  const stderr = new Sink();
  return { spawnSync, writeFile, stdout, stderr, env };
}

describe("db:diagnostics target guard (T-05-22)", () => {
  it.each([
    [["--label", "x", "--db-url", "postgresql://postgres@db.example.com:5432/postgres"]],
    [["--label", "x", "--db-url=postgresql://postgres@10.0.0.5:54322/postgres"]],
    [["--label", "x", "--db-url", "postgresql://postgres@127.0.0.1:6543/postgres"]],
    [["--label", "x", "--linked"]],
    [["--label", "x", "--project-ref", "abcdefghijklmnopqrst"]],
    [["--label", "x", "postgresql://postgres@db.example.com:5432/postgres"]],
    [["--label", "x", "--unknown"]],
    [["--label", "../escape"]],
    [[]],
  ])("refuses %j with exit 1 before any query", (argv) => {
    const d = deps();
    expect(runDiagnostics(argv, d as never)).toBe(1);
    expect(d.spawnSync).not.toHaveBeenCalled();
    expect(d.writeFile).not.toHaveBeenCalled();
    expect(d.stderr.text).toMatch(/refusing|--label/);
  });

  it("refuses a DOCKER_HOST on another machine before any query", () => {
    const d = deps({ DOCKER_HOST: "tcp://203.0.113.7:2376" });
    expect(runDiagnostics(["--label", "x"], d as never)).toBe(1);
    expect(d.spawnSync).not.toHaveBeenCalled();
    expect(d.stderr.text).toContain("DOCKER_HOST");
  });

  it("a loopback --db-url on the local db port is accepted; the query runs in the local container, read only", () => {
    const d = deps({ DOCKER_HOST: "unix:///var/run/docker.sock" });
    expect(runDiagnostics(["--label", "probe", "--db-url", "postgresql://postgres@127.0.0.1:54322/postgres"], d as never)).toBe(0);
    expect(d.spawnSync).toHaveBeenCalledTimes(1);
    const [cmd, args] = d.spawnSync.mock.calls[0] as unknown as [string, string[]];
    expect(cmd).toBe("docker");
    expect(args.slice(0, 3)).toEqual(["exec", "-i", "supabase_db_clinicos"]);
    expect(args).toContain("begin transaction isolation level repeatable read read only");
    expect(args.at(-1)).toBe("rollback");
    expect(d.writeFile).toHaveBeenCalledTimes(1);
    const [file, body] = d.writeFile.mock.calls[0] as unknown as [string, string];
    expect(file).toMatch(/evidence\/05a\/diagnostics\/probe\.json$/);
    expect(JSON.parse(body).checks).toEqual({ D5: 0 });
  });

  it("parseArgs takes --label=… and --out-dir", () => {
    expect(parseArgs(["--label=before-05-03", "--out-dir", "out"], 54322)).toEqual({ ok: true, label: "before-05-03", outDir: "out" });
  });
});

describe("parseDiagnostics keeps counts only", () => {
  it("count, pairs and rows checks", () => {
    const out = ["@@ D0 rows", "000001|foundation", "000002|invitations_billing", "@@ D1 pairs", "visits→patients|2",
      "invoices→visits|0", "@@ D2 pairs", "@@ D5 count", "3", "@@ D7d rows", "a5a00000-0000-4000-8000-000000000001", ""].join("\n");
    const checks = parseDiagnostics(out);
    expect(checks).toEqual({ D0: 2, D1: { "visits→patients": 2, "invoices→visits": 0 }, D2: {}, D5: 3, D7d: 1 });
    expect(JSON.stringify(checks)).not.toContain("foundation");
    expect(JSON.stringify(checks)).not.toContain("a5a00000");
  });

  it("a non-numeric count line is an error, not a silent 0", () => {
    expect(() => parseDiagnostics("@@ D5 count\nERROR\n")).toThrow(/D5/);
  });
});

describe("diagnostics.sql on the local stack finds planted violations", () => {
  function run(plant: boolean) {
    const tA = randomUUID();
    const tB = randomUUID();
    const pB = randomUUID();
    const user = randomUUID(); // no auth.users row and no membership: FK triggers are off in this transaction
    const before = ["begin transaction isolation level repeatable read"];
    if (plant) {
      // Synthetic rows; FK triggers off for this transaction only. Never committed (the session ends without commit).
      before.push(
        "set local session_replication_role = replica",
        `insert into public.tenants (id, name) values ('${tA}', 'Synthetic Diag A'), ('${tB}', 'Synthetic Diag B')`,
        `insert into public.patients (id, tenant_id, full_name, phone, created_by) values ('${pB}', '${tB}', 'Synthetic Diag Patient', '+919000000099', '${user}')`,
        `insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, created_by) values ('${tA}', '${pB}', '${user}', 'walk_in', '${user}')`,
      );
    }
    const r = psqlFile(SQL_FILE, {}, { before });
    expect(r.status, r.stderr).toBe(0);
    return parseDiagnostics(r.stdout) as Record<string, Record<string, number> & number>;
  }

  it("a cross-tenant visit and a non-member doctor each count once more than the clean run", () => {
    const clean = run(false);
    const planted = run(true);
    expect(planted.D1["visits→patients"] - clean.D1["visits→patients"]).toBe(1);
    expect(planted.D1x["visits.patient_id→patients"] - clean.D1x["visits.patient_id→patients"]).toBe(1);
    expect(planted.D5 - clean.D5).toBe(1);
    expect(planted.D5x["visits.doctor_id"] - clean.D5x["visits.doctor_id"]).toBe(1);
    // Nothing else moved: the other pairs are unchanged.
    expect(planted.D1x["invoices.visit_id→visits"]).toBe(clean.D1x["invoices.visit_id→visits"]);
    // The plant was rolled back.
    expect(run(false).D1["visits→patients"]).toBe(clean.D1["visits→patients"]);
  });
});
