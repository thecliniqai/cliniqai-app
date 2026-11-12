/**
 * Migration immutability gate (V2-03 03-03, B2 / R-4): proves scripts/ci/migration-immutability.mjs fails when an
 * applied migration is modified, renamed or deleted, when a new migration does not continue the sequence, and when
 * two migrations share a number; and passes for a correctly numbered new migration. Each case builds a throwaway git
 * repo whose `base` branch holds two applied migrations, then changes it on a feature branch.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

const MIGRATIONS = "supabase/migrations";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args], {
    cwd,
    encoding: "utf8",
  });
}

function write(repo: string, rel: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), body);
}

/** A repo with `base` = 000001 + 000002 applied, checked out on `feature` (branched from base). */
function fixtureRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "migration-immutability-"));
  git(repo, "init", "-q", "-b", "base");
  write(repo, `${MIGRATIONS}/000001_foundation.sql`, "create table a (id int);\n");
  write(repo, `${MIGRATIONS}/000002_second.sql`, "create table b (id int);\n");
  write(repo, "README.md", "fixture\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "checkout", "-q", "-b", "feature");
  return repo;
}

function commitAll(repo: string): void {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "change");
}

function check(repo: string) {
  return runNodeChecker("migration-immutability.mjs", ["--base", "base", "--root", repo]);
}

describe("migration immutability gate", () => {
  it("passes when nothing under supabase/migrations changed", () => {
    const repo = fixtureRepo();
    write(repo, "README.md", "edited\n");
    commitAll(repo);
    const r = check(repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("2 applied unchanged");
  });

  it("passes for a new migration that continues the sequence", () => {
    const repo = fixtureRepo();
    write(repo, `${MIGRATIONS}/000003_x.sql`, "create table c (id int);\n");
    commitAll(repo);
    const r = check(repo);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 new above 2");
  });

  it("fails naming a modified applied migration", () => {
    const repo = fixtureRepo();
    write(repo, `${MIGRATIONS}/000001_foundation.sql`, "create table a (id int, extra text);\n");
    commitAll(repo);
    const r = check(repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("applied migration modified (M): supabase/migrations/000001_foundation.sql");
  });

  it("fails on an uncommitted edit of an applied migration", () => {
    const repo = fixtureRepo();
    write(repo, `${MIGRATIONS}/000002_second.sql`, "create table b (id bigint);\n");
    const r = check(repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("applied migration modified (M): supabase/migrations/000002_second.sql");
  });

  it("fails naming a renamed applied migration", () => {
    const repo = fixtureRepo();
    git(repo, "mv", `${MIGRATIONS}/000002_second.sql`, `${MIGRATIONS}/000002_renamed.sql`);
    commitAll(repo);
    const r = check(repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /applied migration renamed \(R\d+\): supabase\/migrations\/000002_second\.sql -> supabase\/migrations\/000002_renamed\.sql/,
    );
  });

  it("fails naming a deleted applied migration", () => {
    const repo = fixtureRepo();
    git(repo, "rm", "-q", `${MIGRATIONS}/000001_foundation.sql`);
    commitAll(repo);
    const r = check(repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("applied migration deleted (D): supabase/migrations/000001_foundation.sql");
  });

  it("fails when two new migrations share a number", () => {
    const repo = fixtureRepo();
    write(repo, `${MIGRATIONS}/000003_x.sql`, "select 1;\n");
    write(repo, `${MIGRATIONS}/000003_y.sql`, "select 2;\n");
    commitAll(repo);
    const r = check(repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "migration number 3 is used by 2 files: supabase/migrations/000003_x.sql, supabase/migrations/000003_y.sql",
    );
  });

  it("fails when a new migration reuses or undercuts an applied number", () => {
    const repo = fixtureRepo();
    write(repo, `${MIGRATIONS}/000002_late.sql`, "select 1;\n");
    commitAll(repo);
    const r = check(repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("new migration supabase/migrations/000002_late.sql has number 2, not above the highest on the base (2)");
    expect(r.stderr).toContain("migration number 2 is used by 2 files");
  });

  it("fails on a timestamped CLI migration name (an untracked `db diff -f` artefact)", () => {
    const repo = fixtureRepo();
    write(repo, `${MIGRATIONS}/20261113000000_drift.sql`, "select 1;\n");
    const r = check(repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("new migration supabase/migrations/20261113000000_drift.sql is not named NNNNNN_snake_case.sql");
  });

  it("exits 2 when the base ref cannot be resolved", () => {
    const repo = fixtureRepo();
    const r = runNodeChecker("migration-immutability.mjs", ["--base", "no-such-branch", "--root", repo]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("cannot resolve the merge base of 'no-such-branch'");
  });
});
