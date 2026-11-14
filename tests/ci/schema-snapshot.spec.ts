/**
 * Schema + privilege snapshot (V2-03 03-13b, review finding M-DRIFT; scripts/drift/schema-snapshot.mjs).
 *
 * The old drift checks could not see this phase's protections: migra compares no privileges, and the staging diff read
 * only `public`. Proves, on the live local stack, that the snapshot catches exactly those changes (each made inside
 * one `begin … rollback` session, so no other session ever sees it): EXECUTE on `private.outbox_payment_recorded` to
 * anon, table-level INSERT on `payments` (the column-level grant is what stops a forged `recorded_by_system`), an `ops`
 * table change, RLS switched off, and a storage policy. Also: the CLI compares a saved snapshot with the committed one
 * (exit 1 naming the line), and the hosted job diffs `public,ops,private` and runs the same query read-only through
 * psql with the connection in `PG*` variables only.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_FILE, SNAPSHOT_SQL, compareSnapshots, judgeSnapshot, parseSnapshot } from "@/scripts/drift/schema-snapshot.mjs";
import { diffArgs, runSchemaDrift } from "@/scripts/staging/schema-drift.mjs";
import { psqlSession } from "../helpers/sql";
import { ROOT } from "./run-checker";

/** The snapshot as the local superuser sees it, with `changes` applied first inside one rolled-back transaction. */
function snapshotWith(changes: string[]): string[] {
  const out = psqlSession(["begin", ...changes, SNAPSHOT_SQL, "rollback"]);
  return parseSnapshot(out.join("\n"));
}

describe("schema snapshot on the local stack (catches what migra and a public-only diff miss)", () => {
  const baseline = snapshotWith([]);

  it("covers public, ops and private, privileges and storage policies", () => {
    const kinds = new Set(baseline.map((l) => l.split(" ").slice(0, l.startsWith("grant") ? 2 : 1).join(" ")));
    for (const kind of ["relation", "column", "constraint", "index", "policy", "function", "grant table", "grant column", "grant function", "grant schema"]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
    expect(baseline.some((l) => l.startsWith("relation ops.error_events "))).toBe(true);
    expect(baseline.some((l) => l.startsWith("function private.outbox_payment_recorded("))).toBe(true);
    expect(baseline.some((l) => l.startsWith("function authz.active_tenant_id("))).toBe(true);
    expect(baseline).toContain("grant column public.payments.amount INSERT to authenticated");
    expect(baseline.some((l) => l.startsWith("policy storage.objects."))).toBe(true);
    // One fact per line, sorted, deterministic.
    expect(baseline.every((l) => /^(relation|column|constraint|index|trigger|policy|function|enum|view|grant|default-privilege) /.test(l))).toBe(true);
    expect(snapshotWith([])).toEqual(baseline);
  });

  it.each<[string, string[], RegExp]>([
    [
      "EXECUTE on private.outbox_payment_recorded granted to anon",
      ["grant execute on function private.outbox_payment_recorded(uuid) to anon"],
      /^\+ grant function private\.outbox_payment_recorded\(p_payment_id uuid\) EXECUTE to anon$/,
    ],
    [
      "EXECUTE on an authz helper granted to anon (V2-05 05-01b: authz is a snapshot schema)",
      ["grant usage on schema authz to anon", "grant execute on function authz.active_tenant_id() to anon"],
      /^\+ grant function authz\.active_tenant_id\(\) EXECUTE to anon$/,
    ],
    ["table-level INSERT on payments re-granted to authenticated", ["grant insert on public.payments to authenticated"], /^\+ grant table public\.payments INSERT to authenticated$/],
    ["a column added to ops.error_events", ["alter table ops.error_events add column drift_probe text"], /^\+ column ops\.error_events\.drift_probe text /],
    ["RLS switched off on patients", ["alter table public.patients disable row level security"], /^- relation public\.patients kind=r rls=t /],
    [
      "a permissive storage policy",
      ["create policy drift_probe on storage.objects for select to anon using (true)"],
      /^\+ policy storage\.objects\.drift_probe cmd=r permissive=t roles=anon using=true check=-$/,
    ],
    [
      // V2-05 05-02c: a dashboard edit of an existing per-class storage policy (here: the Rx class opened to every
      // signed-in user) is drift, line for line.
      "a changed storage policy (the Rx class read rule loosened)",
      ["alter policy prescriptions_rx_select on storage.objects using (bucket_id = 'prescriptions')"],
      /^\+ policy storage\.objects\.prescriptions_rx_select cmd=r permissive=t roles=authenticated using=\(bucket_id = 'prescriptions'::text\) check=-$/,
    ],
  ])("%s is drift (exit 1, the line named)", (_label, changes, line) => {
    const changed = snapshotWith(changes);
    const judged = judgeSnapshot(changed, { expected: baseline });
    expect(judged.exitCode).toBe(1);
    expect(judged.lines.some((l) => line.test(l)), judged.lines.slice(0, 6).join("\n")).toBe(true);
  });
});

describe("schema snapshot CLI (--input, the way a saved snapshot is judged)", () => {
  const committed: string[] = parseSnapshot(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
  const run = (lines: string[], extra: string[] = []) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-snapshot-"));
    try {
      const input = path.join(dir, "snapshot.txt");
      fs.writeFileSync(input, `${lines.join("\n")}\n`);
      const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/drift/schema-snapshot.mjs"), "--input", input, "--out", dir, ...extra], { encoding: "utf8" });
      const report = JSON.parse(fs.readFileSync(path.join(dir, "schema-snapshot-drift.json"), "utf8")) as { missing: string[]; unexpected: string[]; result: string };
      return { status: r.status, stdout: r.stdout, stderr: r.stderr, report };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it("the committed snapshot is non-trivial and equals itself (exit 0)", () => {
    expect(committed.length).toBeGreaterThan(500);
    const r = run(committed);
    expect(r.status).toBe(0);
    expect(r.report.result).toBe("pass");
  });

  it("a grant the migrations do not make fails, naming the line (exit 1)", () => {
    const extra = "grant function private.outbox_payment_recorded(p_payment_id uuid) EXECUTE to anon";
    const withoutColumnGrant = committed.filter((l) => l !== "grant column public.payments.amount INSERT to authenticated");
    const r = run([...withoutColumnGrant, extra]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`+ ${extra}`);
    expect(r.stderr).toContain("- grant column public.payments.amount INSERT to authenticated");
    expect(r.report).toMatchObject({ result: "fail", unexpected: [extra], missing: ["grant column public.payments.amount INSERT to authenticated"] });
  });

  it("compareSnapshots reports both directions", () => {
    expect(compareSnapshots(["a", "b"], ["b", "c"])).toEqual({ missing: ["a"], unexpected: ["c"] });
  });
});

describe("hosted schema drift covers ops, private and privileges (scripts/staging/schema-drift.mjs)", () => {
  const REF = "abcdefghijklmnopqrst";
  const PW = "Fixture-Pw/Marker+not-real";
  const roUrl = `postgresql://clinicos_drift_ro.${REF}:${encodeURIComponent(PW)}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
  const vars = { STAGING_DB_URL_RO: roUrl, SUPABASE_PROJECT_REF_STAGING: REF };
  const committed: string = fs.readFileSync(SNAPSHOT_FILE, "utf8");

  type SpawnImpl = NonNullable<NonNullable<Parameters<typeof runSchemaDrift>[0]>["spawnImpl"]>;
  /** Fakes `npx supabase db diff` (no drift) and `psql` (the given snapshot); the judge runs for real. */
  function fake(psqlOut: string, psqlStatus = 0) {
    const calls: Array<{ cmd: string; args: string[]; env?: Record<string, string | undefined> }> = [];
    const spawnImpl: SpawnImpl = (cmd, args, opts) => {
      const env = (opts as { env?: Record<string, string | undefined> }).env;
      calls.push({ cmd, args, env });
      if (cmd === "npx") return { status: 0, stdout: JSON.stringify({ diff: "" }), stderr: "" };
      if (cmd === "psql") return { status: psqlStatus, stdout: psqlOut, stderr: psqlStatus ? `connection to ${roUrl} failed` : "" };
      const r = spawnSync(cmd, args, { ...(opts as object), encoding: "utf8" });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    return { calls, spawnImpl };
  }

  it("diffs public, ops and private with migra", () => {
    expect(diffArgs("u")).toEqual(expect.arrayContaining(["--schema", "public,ops,private"]));
  });

  it("passes when staging's snapshot equals the committed one; psql gets PG* variables (TLS required), no URL", () => {
    const f = fake(parseSnapshot(committed).join("\n"));
    const r = runSchemaDrift({ vars, spawnImpl: f.spawnImpl });
    expect(r.lines.join("\n")).toContain("schema-snapshot: PASS (staging");
    expect(r.exitCode).toBe(0);
    const psql = f.calls.find((c) => c.cmd === "psql")!;
    expect(psql.args).toEqual(expect.arrayContaining(["begin read only", "rollback"]));
    expect(psql.args.join(" ")).not.toContain(REF);
    expect(psql.env).toMatchObject({
      PGHOST: "aws-0-ap-south-1.pooler.supabase.com",
      PGUSER: `clinicos_drift_ro.${REF}`,
      PGPASSWORD: PW,
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
    });
    expect(Object.keys(psql.env!).sort()).toEqual(["PATH", "PGCONNECT_TIMEOUT", "PGDATABASE", "PGHOST", "PGPASSWORD", "PGPORT", "PGSSLMODE", "PGUSER"]);
  });

  it("a dashboard grant to anon on staging is drift (exit 1) even when migra sees nothing", () => {
    const extra = "grant function private.outbox_payment_recorded(p_payment_id uuid) EXECUTE to anon";
    const f = fake(`${committed}\n${extra}\n`);
    const r = runSchemaDrift({ vars, spawnImpl: f.spawnImpl });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toContain(`+ ${extra}`);
    expect(r.lines.join("\n")).toContain("local-drift: PASS");
  });

  it("a failing snapshot query exits 2 with the URL and password redacted", () => {
    const r = runSchemaDrift({ vars, spawnImpl: fake("", 2).spawnImpl });
    expect(r.exitCode).toBe(2);
    const printed = r.lines.join("\n");
    expect(printed).toContain("the privilege snapshot query failed");
    expect(printed).not.toContain(PW);
    expect(printed).not.toContain(encodeURIComponent(PW));
  });
});
