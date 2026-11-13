/**
 * V2-04 04-07c (review C M-2, triage M-BACKUPAUTH): a restore refuses an archive it cannot authenticate and SQL that
 * would run a psql meta-command.
 *
 *   - ops/restore-drill/sql-guard.ts: psql's lexer view of a dump (quotes, E'' strings, dollar quotes, comments, COPY
 *     data up to `\.`); every backslash meta-command outside COPY data is refused, the pg_dump shapes pass.
 *   - ops/restore-drill/run.sh: `--expect-sha256` is required for `archive` and `--decrypt-only`; a tampered or planted
 *     archive (any digest but the recorded one) is refused before `age -d`; a correctly recorded archive whose SQL holds
 *     `\! …` is refused after decrypting and before the drill stack starts, and the command never runs.
 *
 * Synthetic files only, in a temp dir outside the repository (R-29); throwaway age keys. No Docker: every refusal
 * happens before the drill stack would start. Needs the pinned age binary (`ops/bin/install-age.sh`).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findMetaCommands, guardBytes } from "../../ops/restore-drill/sql-guard";

const ROOT = path.resolve(__dirname, "../..");
const RUN = path.join(ROOT, "ops/restore-drill/run.sh");

function findAge(): string {
  const cached = path.join(ROOT, ".cache/ops-bin/age");
  if (fs.existsSync(cached)) return cached;
  const onPath = spawnSync("sh", ["-c", "command -v age"], { encoding: "utf8" }).stdout.trim();
  if (onPath) return onPath;
  throw new Error("age is not installed: run ops/bin/install-age.sh (pinned release, SHA-256 verified)");
}

const reasons = (sql: string) => findMetaCommands(sql).map((f) => `${f.line}:${f.reason}`);
const SCS = "backslash before a quote inside a standard string (read differently when standard_conforming_strings is off)";
const LINE_START = "line starts with a backslash outside COPY data (psql meta-command shape)";
const setting = (name: string) => `statement changes or names ${name} (only pg_dump's own SET line is allowed)`;

describe("sql-guard.ts: what psql would execute as a meta-command", () => {
  it("passes the shapes pg_dump writes: COPY data with \\N and backslashes, E'' strings, dollar quotes, comments, \\restrict", () => {
    const dump = [
      "\\restrict AbC123",
      "-- a comment with a backslash \\! is not a command",
      "/* block \\o /tmp/x /* nested */ still a comment */",
      "SET client_encoding = 'UTF8';",
      "SET standard_conforming_strings = on;",
      "SELECT pg_catalog.set_config('search_path', '', false);",
      "COMMENT ON TABLE t IS 'ends with an escaped-or-doubled backslash \\\\';",
      "CREATE FUNCTION f() RETURNS text LANGUAGE plpgsql AS $_$ BEGIN RETURN '\\d+' || E'\\n'; END; $_$;",
      "CREATE FUNCTION g() RETURNS text LANGUAGE sql AS $$",
      "  SELECT '\\! not a command inside a dollar quote'",
      "$$;",
      "ALTER TABLE t ADD CONSTRAINT c CHECK (x ~ '^[0-9a-f]{64}$' AND y <> E'it\\'s \\\\ fine');",
      'CREATE TABLE "we\\ird" (a int);',
      'COPY "public"."t" ("a", "b") FROM stdin;',
      "\\N\tvalue with \\\\ backslash",
      "1\t\\N",
      "\\.",
      "SELECT 1;",
      "\\unrestrict AbC123",
      "",
    ].join("\n");
    expect(reasons(dump)).toEqual([]);
  });

  it.each([
    ["a meta-command on its own line", "SELECT 1;\n\\! id\n", ["2:psql meta-command (unquoted backslash outside COPY data)"]],
    ["after a statement on the same line", "SELECT 1; \\! id\n", ["1:psql meta-command (unquoted backslash outside COPY data)"]],
    ["\\copy to a file", "\\copy public.patients to '/tmp/out.csv'\n", ["1:psql meta-command (unquoted backslash outside COPY data)"]],
    ["\\o redirect inside a statement", "SELECT 1 \\o /tmp/x\n;\n", ["1:psql meta-command (unquoted backslash outside COPY data)"]],
    ["right after the COPY terminator", "COPY t (a) FROM stdin;\n1\n\\.\n\\! id\n", ["4:psql meta-command (unquoted backslash outside COPY data)"]],
    ["content after COPY … FROM stdin; on its line", "COPY t (a) FROM stdin; \\! id\n1\n\\.\n", ["1:content after COPY … FROM stdin; on the same line"]],
    ["a \\restrict line that is not the bare form", "\\restrict key; \\! id\n", ["1:psql meta-command (unquoted backslash outside COPY data)"]],
    ["\\restrict inside a statement", "SELECT\n\\restrict k\n1;\n", ["2:psql meta-command (unquoted backslash outside COPY data)"]],
    ["a quote closed early by an E-string escape trick", "SELECT 'a\\'; \\! id\n", [`1:${SCS}`]],
    ["COPY … PROGRAM", "COPY t FROM PROGRAM 'id';\n", ["1:COPY … PROGRAM (server-side command)"]],
    ["a COPY whose terminator is missing", "COPY t (a) FROM stdin;\n1\n", ["1:COPY … FROM stdin without its \\. terminator"]],
    ["an unterminated dollar quote hiding the rest", "SELECT $x$ \\! id\n", ["1:unterminated quoted text at end of file"]],
  ])("refuses %s", (_label, sql, expected) => {
    expect(reasons(sql)).toEqual(expected);
  });

  it("the CLI names file and line only, never the line's content, and exits 1 / 0 / 2", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-guard-"));
    try {
      fs.writeFileSync(path.join(dir, "schema.sql"), "SELECT 'Ravi Kumar';\n\\! echo Ravi Kumar\n");
      fs.writeFileSync(path.join(dir, "data.sql"), "COPY t (a) FROM stdin;\n\\N\n\\.\n");
      const cli = (args: string[]) => spawnSync("npx", ["tsx", "ops/restore-drill/sql-guard.ts", ...args], { cwd: ROOT, encoding: "utf8" });
      const bad = cli([path.join(dir, "schema.sql"), path.join(dir, "data.sql")]);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("sql-guard: REFUSED schema.sql:2 psql meta-command");
      expect(bad.stderr + bad.stdout).not.toContain("Ravi");
      expect(cli([path.join(dir, "data.sql")]).status).toBe(0);
      expect(cli([]).status).toBe(2);
      expect(cli([path.join(dir, "missing.sql")]).status).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// 04-07d (re-verification N-2): the 04-07c guard read every '…' string as standard_conforming_strings = on, while psql
// follows the server's setting, which the archive can turn off. The re-verifier's file passed the guard and psql ran
// `\! echo …`. The guard is now independent of that setting and refuses the settings psql's lexer depends on.
describe("sql-guard.ts does not depend on standard_conforming_strings or the client encoding (04-07d, N-2)", () => {
  it.each([
    [
      "the re-verifier's repro (SET standard_conforming_strings = off, then `\\'` hides `\\!`)",
      "SET standard_conforming_strings = off;\nselect 'a\\';  select ' \\! echo GUARD_BYPASS_EXECUTED # ' ;\n",
      [`1:${setting("standard_conforming_strings")}`, `2:${SCS}`],
    ],
    [
      "the same strings when the setting is changed where no text scan can see it (server-side code)",
      "select 'a\\';  select ' \\! echo X # ' ;\n",
      [`1:${SCS}`],
    ],
    ["`\\'` at the end of a string spanning lines", "select 'a\nb\\';\n", [`2:${SCS}`]],
    ["set_config of standard_conforming_strings", "SELECT pg_catalog.set_config('standard_conforming_strings', 'off', false);\n", [`1:${setting("standard_conforming_strings")}`]],
    ["a quoted-identifier spelling", 'SET "standard_conforming_strings" TO off;\n', [`1:${setting("standard_conforming_strings")}`]],
    ["RESET standard_conforming_strings", "RESET standard_conforming_strings;\n", [`1:${setting("standard_conforming_strings")}`]],
    ["SET standard_conforming_strings = on inside a statement pg_dump never writes", "SET LOCAL standard_conforming_strings = on;\n", [`1:${setting("standard_conforming_strings")}`]],
    ["a client_encoding other than UTF8", "SET client_encoding = 'SJIS';\n", [`1:${setting("client_encoding")}`]],
    ["set_config of client_encoding", "select set_config('client_encoding', 'GBK', false);\n", [`1:${setting("client_encoding")}`]],
    ["a function body that sets client_encoding", "CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ SET client_encoding = 'BIG5' $$;\n", [`1:${setting("client_encoding")}`]],
    ["a line inside a string that starts with a backslash", "SELECT '\n  \\! id\n';\n", [`2:${LINE_START}`]],
    ["a line inside a dollar quote that starts with a backslash", "SELECT $q$\n\\o /tmp/x\n$q$;\n", [`2:${LINE_START}`]],
    ["a line inside a block comment that starts with a backslash", "/*\n\\! id\n*/ SELECT 1;\n", [`2:${LINE_START}`]],
  ])("refuses %s", (_label, sql, expected) => {
    expect(reasons(sql)).toEqual(expected);
  });

  it("passes backslashes whose reading is the same under both settings (`\\\\` before the closing quote, `\\d`, `\\n`)", () => {
    expect(reasons("SELECT 'a\\\\', '^\\d+$', 'x\\ny';\nSET standard_conforming_strings = on;\nSET client_encoding = 'UTF8';\n")).toEqual([]);
  });

  it("refuses a file that is not valid UTF-8, naming the line only", () => {
    const bytes = Buffer.concat([Buffer.from("SELECT 1;\nSELECT 'x"), Buffer.from([0x85, 0x5c]), Buffer.from("';\n")]);
    expect(guardBytes(bytes).findings).toEqual([{ line: 2, reason: "not valid UTF-8 (pg_dump writes UTF8)" }]);
    expect(guardBytes(Buffer.from("SELECT 'ą';\n")).findings).toEqual([]);
  });

  it("--emit-dir writes restore copies with only pg_dump's \\restrict lines turned into comments, and nothing when refused", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-guard-emit-"));
    try {
      const dump = "\\restrict AbC123\nSET client_encoding = 'UTF8';\nCOPY t (a) FROM stdin;\n\\\\restrict data\n\\.\n\\unrestrict AbC123\n";
      fs.writeFileSync(path.join(dir, "data.sql"), dump);
      fs.writeFileSync(path.join(dir, "evil.sql"), "select 'a\\';  select ' \\! echo X # ' ;\n");
      const cli = (args: string[]) => spawnSync("npx", ["tsx", "ops/restore-drill/sql-guard.ts", ...args], { cwd: ROOT, encoding: "utf8" });

      const out = path.join(dir, "restore");
      const ok = cli(["--emit-dir", out, path.join(dir, "data.sql")]);
      expect(ok.status).toBe(0);
      const copy = fs.readFileSync(path.join(out, "data.sql"), "utf8").split("\n");
      const original = dump.split("\n");
      expect(copy).toHaveLength(original.length);
      expect(copy[0]).toMatch(/^-- pg_dump restrict line removed/);
      expect(copy[5]).toMatch(/^-- pg_dump restrict line removed/);
      // Everything else, the COPY data line included, is unchanged.
      expect(copy.filter((_l, i) => i !== 0 && i !== 5)).toEqual(original.filter((_l, i) => i !== 0 && i !== 5));

      const refusedOut = path.join(dir, "refused");
      const bad = cli(["--emit-dir", refusedOut, path.join(dir, "data.sql"), path.join(dir, "evil.sql")]);
      expect(bad.status).toBe(1);
      expect(fs.existsSync(refusedOut)).toBe(false);
      expect(cli(["--emit-dir"]).status).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("run.sh refuses an unauthenticated archive and meta-command SQL before the drill stack starts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "restore-guards-"));
  const AGE = findAge();
  const AGE_KEYGEN = path.join(path.dirname(AGE), "age-keygen");
  const key = path.join(tmp, "primary.key");
  const marker = path.join(tmp, "meta-command-ran");
  const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

  /** A manifest of backup.sh's shape (synthetic counts). */
  const validManifest = () => ({
    format_version: 1,
    environment: "local",
    dump_started_at: "2026-11-14T00:00:00Z",
    dump_finished_at: "2026-11-14T00:01:00Z",
    cli_version: "2.120.0",
    server_version: "17.11",
    database_bytes: 1000,
    policies: 1,
    functions: 1,
    rls_tables: 1,
    auth_users: 0,
    tables: { "public.t": 1 } as Record<string, unknown>,
    buckets: {},
    excluded_buckets: [],
  });

  /** A synthetic archive: the six SQL files and a manifest, tar | age to the throwaway key. */
  function archive(name: string, schemaSql: string, manifest: object = validManifest()): string {
    const stage = path.join(tmp, `${name}-stage`);
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(stage, "roles.sql"), "-- roles\n");
    fs.writeFileSync(path.join(stage, "schema.sql"), schemaSql);
    fs.writeFileSync(path.join(stage, "storage_policies.sql"), "");
    fs.writeFileSync(path.join(stage, "data.sql"), "COPY public.t (a) FROM stdin;\n\\N\n\\.\n");
    fs.writeFileSync(path.join(stage, "history_schema.sql"), "-- history\n");
    fs.writeFileSync(path.join(stage, "history_data.sql"), "-- history data\n");
    const out = path.join(tmp, `${name}.tar.age`);
    const recipient = spawnSync(AGE_KEYGEN, ["-y", key], { encoding: "utf8" }).stdout.trim();
    const r = spawnSync("sh", ["-c", 'tar -C "$1" -cf - . | "$2" -r "$3" -o "$4"', "sh", stage, AGE, recipient, out], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    fs.rmSync(stage, { recursive: true, force: true });
    return out;
  }

  const run = (args: string[]) =>
    spawnSync("bash", [RUN, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, AGE_BIN: AGE, NODE_ENV: "test" },
    });

  let clean = "";
  let evil = "";
  let evilManifest = "";
  beforeAll(() => {
    expect(spawnSync(AGE_KEYGEN, ["-o", key], { encoding: "utf8" }).status).toBe(0);
    clean = archive("clean", "CREATE TABLE public.t (a int);\n");
    evil = archive("evil", `CREATE TABLE public.t (a int);\n\\! touch '${marker}'\n`);
    // 04-07e (N-2b): the re-checker's two manifest routes (a count with a meta-command, a table key that ends the
    // counts query's literal when standard_conforming_strings is off).
    evilManifest = archive("evilmanifest", "CREATE TABLE public.t (a int);\n", {
      ...validManifest(),
      policies: `1 \\! touch '${marker}' #`,
      tables: { "public.t": 1, [`x\\'; \\! touch '${marker}' #.t`]: 1 },
    });
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("refuses to run without --expect-sha256, or with a value that is not a SHA-256 (exit 2)", () => {
    for (const args of [
      ["--dump", clean, "--identity", key],
      ["--dump", clean, "--identity", key, "--decrypt-only"],
      ["--dump", clean, "--identity", key, "--expect-sha256", "abc"],
    ]) {
      const r = run(args);
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stdout + r.stderr).not.toContain("restore-drill.decrypt");
    }
  });

  it("refuses a tampered archive (one byte changed) before decrypting, in both modes", () => {
    const digest = sha256(clean);
    const tampered = path.join(tmp, "tampered.tar.age");
    const bytes = fs.readFileSync(clean);
    bytes[bytes.length - 1] ^= 0x01;
    fs.writeFileSync(tampered, bytes);
    for (const extra of [[], ["--decrypt-only"]]) {
      const r = run(["--dump", tampered, "--identity", key, "--expect-sha256", digest, ...extra]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("archive SHA-256 does not match the recorded digest: refused before decrypt");
      expect(r.stdout).not.toContain("restore-drill.decrypt");
    }
  });

  it("refuses a planted archive (valid age file to the same key, not the recorded one)", () => {
    const r = run(["--dump", evil, "--identity", key, "--expect-sha256", sha256(clean)]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refused before decrypt");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("the recorded clean archive passes the digest check (decrypt-only, upper-case digest accepted)", () => {
    const r = run(["--dump", clean, "--identity", key, "--expect-sha256", sha256(clean).toUpperCase(), "--decrypt-only"]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("restore-drill.digest ok");
    expect(r.stdout).toMatch(/restore-drill\.decrypt_only ok entries=\d+/);
  });

  it("04-07e (N-2b): refuses an authenticated archive whose manifest holds a meta-command in a count or a table key, before any SQL runs", () => {
    const r = run(["--dump", evilManifest, "--identity", key, "--expect-sha256", sha256(evilManifest)]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("restore-drill.digest ok");
    expect(r.stdout).toContain("manifest-guard: REFUSED");
    expect(r.stdout).toContain("policies: must be an integer");
    expect(r.stdout).toContain("tables: 1 key(s) not of the form schema.table");
    expect(r.stderr).toContain("manifest.json failed validation: refused before restore");
    // The refused values are never printed.
    expect(r.stdout + r.stderr).not.toContain("touch");
    expect(r.stdout).not.toContain("restore-drill.sql_guard");
    expect(r.stdout).not.toContain("restore-drill.stack_start");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("refuses an authenticated archive whose SQL holds a psql meta-command, before any SQL runs or a stack starts", () => {
    const r = run(["--dump", evil, "--identity", key, "--expect-sha256", sha256(evil)]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("restore-drill.digest ok");
    expect(r.stdout).toContain("restore-drill.sql_guard");
    expect(r.stderr).toContain("sql-guard: REFUSED schema.sql:2 psql meta-command");
    expect(r.stderr).toContain("refused before restore");
    expect(r.stdout).not.toContain("restore-drill.stack_start");
    expect(fs.existsSync(marker)).toBe(false);
  });
});
