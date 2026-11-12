/**
 * Hosted drift tool (V2-03 03-03, B1 hosted half, PO action E1a): proves scripts/drift/hosted-dump-diff.mjs reports
 * no drift for a schema-only dump of the LOCAL database (built from the same migrations), names an added column when
 * the dump has one, refuses a non-loopback stack URL before connecting, and leaves no scratch database behind.
 *
 * DB lane: needs the local stack (the dump comes from `supabase db dump --local`; the diff builds a shadow database
 * in Docker). It never contacts a hosted project.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ROOT } from "./run-checker";

const SCRIPT = path.join(ROOT, "scripts/drift/hosted-dump-diff.mjs");
const LONG = 300_000;

let work: string;
let localDump: string;

function run(args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}

function report(out: string, label: string) {
  return JSON.parse(fs.readFileSync(path.join(out, `${label}-drift.json`), "utf8"));
}

function scratchDatabases(): string[] {
  const out = execFileSync(
    "docker",
    ["exec", "supabase_db_clinicos", "psql", "-U", "postgres", "-tAc", "select datname from pg_database where datname like 'drift_scratch_%'"],
    { encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "hosted-dump-diff-"));
  localDump = path.join(work, "local-schema.sql");
  execFileSync("npx", ["supabase", "db", "dump", "--local", "--agent", "no", "-f", localDump], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "pipe"],
  });
}, LONG);

describe("hosted dump drift tool", () => {
  it(
    "reports no drift for a schema-only dump of the local database",
    () => {
      const out = path.join(work, "clean");
      const r = run([localDump, "--out", out, "--label", "local"]);
      expect(r.stderr).not.toContain("hosted-dump-diff:");
      expect(r.status).toBe(0);
      expect(report(out, "local")).toMatchObject({ drift_count: 0, drift: [], result: "no drift" });
      expect(scratchDatabases()).toEqual([]);
    },
    LONG,
  );

  it(
    "names a column the dump has and the migrations do not",
    () => {
      const drifted = path.join(work, "drifted-schema.sql");
      fs.writeFileSync(
        drifted,
        `${fs.readFileSync(localDump, "utf8")}\nALTER TABLE "public"."patients" ADD COLUMN "drift_probe_note" "text";\n`,
      );
      const out = path.join(work, "drifted");
      const r = run([drifted, "--out", out, "--label", "hosted"]);
      expect(r.status).toBe(1);
      const rep = report(out, "hosted");
      expect(rep.drift_count).toBe(1);
      expect(rep.drift[0]).toBe('alter table "public"."patients" add column "drift_probe_note" text;');
      expect(fs.readFileSync(path.join(out, "hosted-drift.txt"), "utf8")).toContain('"drift_probe_note"');
      expect(scratchDatabases()).toEqual([]);
    },
    LONG,
  );

  it("refuses a non-loopback stack URL without connecting or writing a report", () => {
    const out = path.join(work, "refused");
    const r = run([localDump, "--out", out, "--stack-url", "postgresql://postgres:x@db.example.supabase.co:5432/postgres"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('refusing: the stack database host "db.example.supabase.co" is not loopback');
    expect(fs.existsSync(out)).toBe(false);
  });
});
