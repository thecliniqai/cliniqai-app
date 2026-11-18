/**
 * V2-04 04-07e (adversarial re-check N-2b): ops/restore-drill/manifest-guard.ts validates every manifest.json field the
 * restore drill reads before any of it is used. The re-checker's values (a count holding `\! echo …`, a table key that
 * ends a SQL literal, a count with a newline) are refused; backup.sh's own shape passes; the validated copy holds only
 * known fields; problems never repeat a refused value. Synthetic manifests only.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../ops/restore-drill/manifest-guard";

const ROOT = path.resolve(__dirname, "../..");

const valid = () => ({
  format_version: 1,
  environment: "staging",
  dump_started_at: "2026-11-14T00:00:00Z",
  dump_finished_at: "2026-11-14T00:02:10Z",
  cli_version: "2.120.0",
  server_version: "17.11",
  database_bytes: 12_345_678,
  policies: 212,
  functions: 300,
  rls_tables: 43,
  auth_users: 5,
  tables: { "public.tenants": 1, "auth.users": 5, "supabase_migrations.schema_migrations": 45, "storage.objects": 1 },
  buckets: {
    "patient-documents": {
      objects: [{ name: "t1/doc-1.pdf", size: 4096, sha256: "a".repeat(64) }],
    },
  },
  excluded_buckets: ["drill-selftest-target"],
});

const problems = (m: unknown) => {
  const r = validateManifest(m);
  return r.ok ? [] : r.problems;
};

describe("manifest-guard.ts: archive-controlled manifest values are validated before use (04-07e, N-2b)", () => {
  it("passes backup.sh's shape and returns a copy with the same values", () => {
    const r = validateManifest(valid());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest).toEqual(valid());
    // A Debian-style server_version also passes.
    expect(problems({ ...valid(), server_version: "17.4 (Debian 17.4-1.pgdg120+2)" })).toEqual([]);
  });

  it.each([
    ["the re-checker's count with a meta-command", { policies: "1 \\! echo VAR_INTERP_EXECUTED #" }, "policies: must be an integer from 0 to 999999999"],
    ["a count with a newline", { functions: "1;\n\\! echo VAR_INTERP_EXECUTED" }, "functions: must be an integer from 0 to 999999999"],
    ["a numeric string", { auth_users: "5" }, "auth_users: must be an integer from 0 to 999999999"],
    ["a negative count", { rls_tables: -1 }, "rls_tables: must be an integer from 0 to 999999999"],
    ["a fractional count", { policies: 1.5 }, "policies: must be an integer from 0 to 999999999"],
    ["a count above the bound", { policies: 1_000_000_000 }, "policies: must be an integer from 0 to 999999999"],
    ["another format version", { format_version: 2 }, "format_version: must be 1"],
    ["an unknown environment", { environment: "prod'; --" }, "environment: must be local, staging or production"],
    ["a timestamp that is not ISO UTC", { dump_started_at: "2026-11-14 00:00:00" }, "dump_started_at: must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)"],
    ["a version with shell text", { cli_version: "2.1.0; echo" }, "cli_version: must be N.N.N"],
    ["a server version with quotes", { server_version: "17.11 ('x')" }, "server_version: not a PostgreSQL version string"],
    ["an unknown field", { extra: 1 }, "unknown field extra"],
    ["excluded buckets that are not ids", { excluded_buckets: ["../x"] }, "excluded_buckets: must be a list of bucket ids"],
  ])("refuses %s", (_label, patch, expected) => {
    expect(problems({ ...valid(), ...patch })).toEqual([expected]);
  });

  it.each([
    ["the re-checker's table key that ends a literal", "x\\'; \\! echo COUNTS_SQL_EXECUTED #.t"],
    ["a quoted identifier", '"public"."t"'],
    ["upper case", "public.Tenants"],
    ["three parts", "public.t.x"],
    ["a 64-character name", `public.${"a".repeat(64)}`],
  ])("refuses table keys: %s (counted, never printed)", (_label, key) => {
    const p = problems({ ...valid(), tables: { "public.tenants": 1, [key]: 1 } });
    expect(p).toEqual(["tables: 1 key(s) not of the form schema.table (lower-case identifiers)"]);
    expect(p.join(" ")).not.toContain("echo");
  });

  it("refuses tables outside the dumped schemas and table counts that are not integers", () => {
    expect(problems({ ...valid(), tables: { "pg_catalog.pg_authid": 1 } })).toEqual(["tables: pg_catalog.pg_authid is outside the dumped schemas"]);
    expect(problems({ ...valid(), tables: { "public.t": "1" } })).toEqual(["tables: public.t count must be a non-negative integer"]);
  });

  it("refuses objects without a valid name, size and SHA-256, and bucket ids backup.sh would not write", () => {
    const bucket = (o: object) => ({ ...valid(), buckets: { b: { objects: [o] } } });
    for (const o of [
      { name: "../escape", size: 1, sha256: "a".repeat(64) },
      { name: "/abs", size: 1, sha256: "a".repeat(64) },
      { name: "a\nb", size: 1, sha256: "a".repeat(64) },
      { name: "ok", size: -1, sha256: "a".repeat(64) },
      { name: "ok", size: 1, sha256: "A".repeat(64) },
      { name: "ok", size: 1, sha256: "a".repeat(63) },
      { name: "ok", size: 1, sha256: "a".repeat(64), extra: true },
    ]) {
      expect(problems(bucket(o))).toEqual(["buckets: b has 1 object(s) without a valid name, size and SHA-256"]);
    }
    expect(problems({ ...valid(), buckets: { "..": { objects: [] } } })).toEqual(["buckets: 1 bucket id(s) refused"]);
  });

  it("the CLI writes the validated copy (exit 0), refuses without writing (exit 1) and never prints a refused value", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-guard-"));
    try {
      const cli = (args: string[]) => spawnSync("npx", ["tsx", "ops/restore-drill/manifest-guard.ts", ...args], { cwd: ROOT, encoding: "utf8" });
      fs.writeFileSync(path.join(dir, "good.json"), JSON.stringify(valid()));
      const ok = cli(["--in", path.join(dir, "good.json"), "--out", path.join(dir, "good.out.json")]);
      expect(ok.status, ok.stderr).toBe(0);
      expect(JSON.parse(fs.readFileSync(path.join(dir, "good.out.json"), "utf8"))).toEqual(valid());

      fs.writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ ...valid(), policies: "1 \\! echo VAR_INTERP_EXECUTED #" }));
      const bad = cli(["--in", path.join(dir, "bad.json"), "--out", path.join(dir, "bad.out.json")]);
      expect(bad.status).toBe(1);
      expect(bad.stdout).toContain("manifest-guard: REFUSED");
      expect(bad.stdout + bad.stderr).not.toContain("echo");
      expect(fs.existsSync(path.join(dir, "bad.out.json"))).toBe(false);

      fs.writeFileSync(path.join(dir, "notjson.json"), "{");
      expect(cli(["--in", path.join(dir, "notjson.json"), "--out", path.join(dir, "x.json")]).status).toBe(2);
      expect(cli([]).status).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
