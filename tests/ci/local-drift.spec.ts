/**
 * Local drift gate (V2-03 03-03, B1 local half): proves scripts/ci/local-drift.mjs passes an empty diff and the
 * allowlisted pg_net false positive only, and fails (printing the statement) on anything else. Fixtures are saved CLI
 * outputs in both shapes the CLI emits (JSON under `--output-format json`, plain SQL otherwise).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

const PG_NET = 'drop extension if exists "pg_net";';

function fixture(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-drift-"));
  const file = path.join(dir, "diff.out");
  fs.writeFileSync(file, body);
  return file;
}

const cliJson = (diff: string) =>
  JSON.stringify({ diff, file: null, files: [], schemas: [], engine: "migra", message: "Diff complete." });

describe("local drift gate", () => {
  it.each([
    ["an empty JSON diff", cliJson("")],
    ["an empty plain diff", "\n"],
    ["the pg_net false positive only (JSON, as CLI 2.120.0 prints it)", cliJson(`${PG_NET}\n\n\n`)],
    ["the pg_net false positive only (plain)", `${PG_NET}\n\n\n\n`],
  ])("passes on %s", (_name, body) => {
    const r = runNodeChecker("local-drift.mjs", ["--input", fixture(body)]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("fails on one extra statement and prints it", () => {
    const extra = 'alter table "public"."patients" add column "nickname" text;';
    const r = runNodeChecker("local-drift.mjs", ["--input", fixture(cliJson(`${PG_NET}\n\n${extra}\n\n`))]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("1 statement(s) beyond the allowlist");
    expect(r.stderr).toContain(extra);
    expect(r.stderr).not.toContain(PG_NET);
  });

  it("does not allowlist a near-miss of the pg_net line", () => {
    const r = runNodeChecker("local-drift.mjs", ["--input", fixture('drop extension if exists "pg_cron";\n')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('drop extension if exists "pg_cron";');
  });

  it("writes the evidence files with counts", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "local-drift-out-"));
    const r = runNodeChecker("local-drift.mjs", ["--input", fixture(cliJson(`${PG_NET}\n`)), "--out", out]);
    expect(r.status).toBe(0);
    const report = JSON.parse(fs.readFileSync(path.join(out, "local-drift.json"), "utf8"));
    expect(report).toMatchObject({ statements: 1, allowlisted: [PG_NET], drift: [], result: "pass" });
    expect(fs.readFileSync(path.join(out, "local-drift.txt"), "utf8")).toBe(`${PG_NET}\n`);
  });

  it("exits 2 on output it cannot parse", () => {
    const r = runNodeChecker("local-drift.mjs", ["--input", fixture('{"message": "no diff field"}')]);
    expect(r.status).toBe(2);
  });
});
