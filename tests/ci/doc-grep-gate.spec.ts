/**
 * Doc-grep test gate (V2-02 02-04, `static` job; TEST_STRATEGY §9.6): proves scripts/ci/assert-no-doc-grep-tests.mjs
 * fails when a file under tests/ reads a path under docs/, passes on look-alikes that read nothing from docs/, and
 * passes on this repository. Uses throwaway temp directories holding synthetic spec files.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, runNodeChecker } from "./run-checker";

function treeWithSpec(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-grep-gate-"));
  fs.mkdirSync(path.join(dir, "tests", "ops"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tests", "ops", "sample.spec.ts"), source);
  return dir;
}

const run = (root: string) => runNodeChecker("assert-no-doc-grep-tests.mjs", ["--root", root]);

describe("doc-grep test gate", () => {
  it.each([
    ["a relative path", `const s = fs.readFileSync(path.resolve(__dirname, "../../docs/ops/runbook.md"), "utf8");`],
    ["path segments", `const s = fs.readFileSync(path.join(ROOT, "docs", "ops", "runbook.md"), "utf8");`],
    ["a template literal", "const ok = fs.existsSync(`${ROOT}/docs/ops/runbook.md`);"],
    ["a repo-relative path", `const s = readFileSync('docs/v2/PLAN.md', "utf8");`],
  ])("fails on a spec that reads docs/ via %s", (_label, line) => {
    const r = run(treeWithSpec(`import fs, { readFileSync } from "node:fs";\n${line}\n`));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAIL tests/ops/sample.spec.ts:2 reads a path under docs/");
  });

  it("passes on look-alikes that read nothing from docs/", () => {
    const source = [
      `import fs from "node:fs";`,
      `import { GET as getDocs } from "@/app/api/v1/docs/route";`,
      `const msg = "see docs/v2/TEST_STRATEGY.md for the policy";`,
      `const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "a.json"), "utf8");`,
    ].join("\n");
    const r = run(treeWithSpec(source));
    expect(r.status).toBe(0);
  });

  it("ignores a docs/ path in a file that never reads the filesystem", () => {
    const r = run(treeWithSpec(`const label = "docs/ops/runbook.md";\n`));
    expect(r.status).toBe(0);
  });

  it("passes on this repository's tests/", () => {
    const r = run(ROOT);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("doc-grep: PASS");
  });
});
