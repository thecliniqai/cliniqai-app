/**
 * Migration immutability gate (V2-03 03-03, B2 / R-4): proves scripts/ci/migration-immutability.mjs fails when an
 * applied migration is modified, renamed or deleted, when a new migration does not continue the sequence, and when
 * two migrations share a number; and passes for a correctly numbered new migration. Each case builds a throwaway git
 * repo whose `base` branch holds two applied migrations, then changes it on a feature branch.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, runNodeChecker } from "./run-checker";

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

/** Runs the gate with exactly `env` for the GitHub event variables (nothing else inherited that could change the base). */
function gate(repo: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/ci/migration-immutability.mjs"), ...args, "--root", repo], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env } as unknown as NodeJS.ProcessEnv,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A GitHub push event payload file whose `before` is `sha`. */
function pushEvent(repo: string, sha: string): string {
  const file = path.join(repo, "..", `${path.basename(repo)}-event.json`);
  fs.writeFileSync(file, JSON.stringify({ before: sha, after: git(repo, "rev-parse", "HEAD").trim() }));
  return file;
}

describe("migration immutability on pushes to feature/v2 (03-13b, review IND L-4)", () => {
  /** `base` holds 000001 + 000002; the pushed commit edits applied 000001 on the same branch. */
  function pushedEdit() {
    const repo = fixtureRepo();
    git(repo, "checkout", "-q", "base");
    const before = git(repo, "rev-parse", "HEAD").trim();
    write(repo, `${MIGRATIONS}/000001_foundation.sql`, "create table a (id int, sneaky text);\n");
    commitAll(repo);
    return { repo, before };
  }

  it("comparing the pushed branch with itself (the old push base) sees nothing: the gap", () => {
    const { repo } = pushedEdit();
    expect(gate(repo, ["--base", "base"]).status).toBe(0);
  });

  it("--base auto on a push compares with the commit before the push and fails naming the edited migration", () => {
    const { repo, before } = pushedEdit();
    const r = gate(repo, ["--base", "auto"], { GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: pushEvent(repo, before) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("applied migration modified (M): supabase/migrations/000001_foundation.sql");
  });

  it("--base auto on a push with an unknown before-commit (new branch / force-push) falls back to HEAD~1", () => {
    const { repo } = pushedEdit();
    for (const before of ["0".repeat(40), "f".repeat(40)]) {
      const r = gate(repo, ["--base", "auto"], { GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: pushEvent(repo, before) });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("000001_foundation.sql");
    }
  });

  it("--base auto on a pull request compares with origin/<base branch>", () => {
    const repo = fixtureRepo();
    git(repo, "update-ref", "refs/remotes/origin/base", "base");
    write(repo, `${MIGRATIONS}/000002_second.sql`, "create table b (id int, sneaky text);\n");
    commitAll(repo);
    const r = gate(repo, ["--base", "auto"], { GITHUB_EVENT_NAME: "pull_request", GITHUB_BASE_REF: "base" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("applied migration modified (M): supabase/migrations/000002_second.sql");
    write(repo, `${MIGRATIONS}/000002_second.sql`, "create table b (id int);\n");
    commitAll(repo);
    const ok = gate(repo, ["--base", "auto"], { GITHUB_EVENT_NAME: "pull_request", GITHUB_BASE_REF: "base" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("[pull request base]");
  });
});

describe("migration number collisions against origin/feature/v2 (03-13b, review IND Low)", () => {
  /** `feature` adds 000003_feature; `integration` (from base) is what another branch merged meanwhile. */
  function collision(integrationFile: string | null) {
    const repo = fixtureRepo();
    write(repo, `${MIGRATIONS}/000003_feature.sql`, "create table c (id int);\n");
    commitAll(repo);
    git(repo, "checkout", "-q", "-b", "integration", "base");
    if (integrationFile) {
      write(repo, `${MIGRATIONS}/${integrationFile}`, "create table other (id int);\n");
      commitAll(repo);
    }
    git(repo, "checkout", "-q", "feature");
    return repo;
  }

  it("passes when the integration branch has not used the number (and reports the check)", () => {
    const r = gate(collision(null), ["--base", "base", "--against", "integration"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no collision with integration (highest 2)");
  });

  it("fails when another branch already merged the same number under another name", () => {
    const r = gate(collision("000003_other.sql"), ["--base", "base", "--against", "integration"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("new migration supabase/migrations/000003_feature.sql reuses number 3, already taken on integration by 000003_other.sql");
  });

  it("fails when the integration branch has moved past the number (out-of-order once merged)", () => {
    const r = gate(collision("000004_other.sql"), ["--base", "base", "--against", "integration"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("has number 3, not above the highest on integration (4)");
  });

  it("passes when the integration branch already has the very same file (a stacked parent merged)", () => {
    expect(gate(collision("000003_feature.sql"), ["--base", "base", "--against", "integration"]).status).toBe(0);
  });

  it("without --against the collision is not checked (the plain gate passes)", () => {
    expect(gate(collision("000003_other.sql"), ["--base", "base"]).status).toBe(0);
  });

  it("exits 2 when --against cannot be resolved", () => {
    const r = gate(collision(null), ["--base", "base", "--against", "origin/no-such-branch"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("cannot resolve --against 'origin/no-such-branch'");
  });
});
