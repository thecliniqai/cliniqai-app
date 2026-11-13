/**
 * V2-04 04-07d (re-verification N-2): the restore runs the archive's SQL through `ops/bin/psql-restricted.sh`, i.e. psql
 * in restricted mode under a fresh key, so psql itself refuses every backslash meta-command whatever the guard's lexer
 * concluded. Against the primary local stack (loopback; read-only or temp-table SQL, nothing persists), with the pinned
 * postgres:17 image (ops/bin/pins.env).
 *
 *   - The re-verifier's file (`SET standard_conforming_strings = off` then `\'` hiding `\! echo …`): 04-07c's psql call
 *     ran the shell command; restricted psql refuses it, exit 3, the marker never printed.
 *   - A second divergence the text guard cannot see: server-side code switches client_encoding to GBK, whose trail
 *     bytes include the backslash, so psql and the guard (UTF-8) end an E'' string at different places. The guard passes
 *     this file (asserted here, so the reliance on the runtime layer stays visible); restricted psql refuses it.
 *   - The guard's restore copy of a pg_dump-shaped file (its `\restrict` lines as comments, COPY data with a
 *     backslash row and the `\.` terminator) runs normally in restricted mode.
 *
 * Synthetic SQL in a temp dir outside the repository; the shell command in the files is a harmless `echo`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { guardBytes } from "../../ops/restore-drill/sql-guard";

const ROOT = path.resolve(__dirname, "../..");
const RESTRICTED = path.join(ROOT, "ops/bin/psql-restricted.sh");
// Real path: psql-docker.sh mounts PSQL_MOUNT and runs in $PWD, which must agree (macOS /var is a symlink).
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "psql-restricted-")));
let dbUrl = "";

function stackDbUrl(): string {
  const out = execFileSync("npx", ["supabase", "status", "--workdir", ROOT, "-o", "env"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const m = /^DB_URL="(.*)"$/m.exec(out);
  if (!m) throw new Error("local stack status has no DB_URL; is `npx supabase start` running?");
  return m[1];
}

beforeAll(() => {
  dbUrl = stackDbUrl();
  expect(dbUrl).toMatch(/@127\.0\.0\.1:\d+\//);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(name: string, content: string | Buffer): string {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, content);
  return file;
}

function restricted(args: string[]) {
  return spawnSync(RESTRICTED, ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", ...args], {
    cwd: tmp,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", PSQL_DB_URL: dbUrl, PSQL_MOUNT: tmp },
    timeout: 90_000,
  });
}

describe("psql-restricted.sh: psql refuses every meta-command in the archive's SQL (04-07d, N-2)", () => {
  it("the re-verifier's standard_conforming_strings repro: refused, exit 3, the shell command never runs", () => {
    write("scs.sql", "SET standard_conforming_strings = off;\nselect 'a\\';  select ' \\! echo GUARD_BYPASS_EXECUTED # ' ;\n");
    const r = restricted(["-f", "scs.sql"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("backslash commands are restricted");
    expect(r.stdout + r.stderr).not.toContain("GUARD_BYPASS_EXECUTED\n");
    expect(r.stdout).not.toMatch(/^GUARD_BYPASS_EXECUTED$/m);
  }, 120_000);

  it("a client_encoding switch made by server-side code (invisible to the text guard): the guard passes it, restricted psql refuses it", () => {
    const sql = Buffer.concat([
      Buffer.from(
        "DO $$ BEGIN PERFORM set_config('client_' || 'encod' || 'ing', 'G' || 'BK', false); END $$;\n" + "select E'"
      ),
      Buffer.from([0xe2, 0x82, 0xac]), // U+20AC in UTF-8; in GBK `E2 82` and `AC 5C` are two characters
      Buffer.from("\\'; \\! echo ENCODING_BYPASS_EXECUTED ; select 1 ;';\n"),
    ]);
    write("enc.sql", sql);
    expect(guardBytes(sql).findings).toEqual([]);
    const r = restricted(["-f", "enc.sql"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("backslash commands are restricted");
    expect(r.stdout).not.toMatch(/^ENCODING_BYPASS_EXECUTED$/m);
  }, 120_000);

  it("the guard's restore copy of a pg_dump-shaped file restores in restricted mode (COPY data and its terminator work)", () => {
    const dump = [
      "\\restrict AbC123",
      "SET client_encoding = 'UTF8';",
      "SET standard_conforming_strings = on;",
      "CREATE TEMP TABLE t (a text);",
      "COPY t (a) FROM stdin;",
      "\\\\restrict data",
      "plain",
      "\\.",
      "SELECT count(*) || '|' || min(a) FROM t;",
      "\\unrestrict AbC123",
      "",
    ].join("\n");
    write("data.sql", dump);
    const guard = spawnSync(
      "npx",
      ["tsx", "ops/restore-drill/sql-guard.ts", "--emit-dir", path.join(tmp, "restore"), path.join(tmp, "data.sql")],
      { cwd: ROOT, encoding: "utf8" }
    );
    expect(guard.status).toBe(0);

    const r = restricted(["--single-transaction", "-f", "restore/data.sql"]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toEqual(["2|\\restrict data"]);

    // The original, with pg_dump's own \restrict line, is refused: restricted mode allows no second \restrict.
    expect(restricted(["-f", "data.sql"]).status).toBe(3);
  }, 120_000);
});
