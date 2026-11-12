/**
 * Env-file gate (V2-02 02-01, `static` job): proves scripts/ci/assert-no-env-files.mjs fails when any env file other
 * than the template and the local-stack test defaults exists, and passes otherwise. Uses throwaway temp directories
 * holding empty files (only names are inspected; nothing is ever read).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

function tree(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-files-gate-"));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), "");
  }
  return dir;
}

describe("env-file gate", () => {
  it("passes with only the template and the test defaults at the root", () => {
    const r = runNodeChecker("assert-no-env-files.mjs", ["--root", tree([".env.example", ".env.test", "src/a.ts"])]);
    expect(r.status).toBe(0);
  });

  it.each([[".env"], [".env.local"], ["supabase/.env.production"], ["nested/.env.test"]])("fails on %s", (file) => {
    const r = runNodeChecker("assert-no-env-files.mjs", ["--root", tree([".env.example", file])]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`env file in working tree: ${file}`);
  });
});
