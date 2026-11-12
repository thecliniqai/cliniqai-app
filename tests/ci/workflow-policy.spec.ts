/**
 * Workflow policy (V2-03 03-08; rulings R-9, R-19, R-21; threat T-03-09): scripts/ci/workflow-policy.mjs fails, naming
 * the rule, on an unpinned `uses:`, a PR trigger on a staging workflow, a staging secret in a job without an
 * `environment`, a missing top-level `permissions`, `pull_request_target` and a secrets dump; the repository's own
 * workflows pass, and the same regressions introduced into those real files are caught.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWorkflow } from "@/scripts/ci/workflow-policy.mjs";
import { ROOT, runNodeChecker } from "./run-checker";

const fixture = (name: string) => `lint-fixtures/workflows/${name}`;
const workflow = (name: string) => fs.readFileSync(path.join(ROOT, ".github/workflows", name), "utf8");
const rules = (file: string, text: string) => checkWorkflow(file, text).map((f) => f.rule);

describe("workflow policy checker (CLI, the way the static job runs it)", () => {
  it("passes the repository's workflows, including staging.yml and drift.yml", () => {
    const r = runNodeChecker("workflow-policy.mjs", []);
    expect(r.stderr).toBe("");
    expect(r.stdout).toMatch(/workflow-policy: PASS \(\d+ workflow\(s\)\)/);
    expect(r.status).toBe(0);
    for (const name of ["staging.yml", "drift.yml"]) expect(fs.existsSync(path.join(ROOT, ".github/workflows", name))).toBe(true);
  });

  it("passes a clean fixture whose comments mention a tag pin and pull_request_target", () => {
    const r = runNodeChecker("workflow-policy.mjs", [fixture("clean.yml")]);
    expect(r.status).toBe(0);
  });

  it.each([
    ["unpinned-uses.yml", "uses-pinned", ":10 ", "actions/checkout@v4"],
    ["staging-pull-request.yml", "staging-no-pr-trigger", ":4 ", "`pull_request`"],
    ["staging-secret-without-environment.yml", "staging-secret-needs-environment", ":14 ", "job `migrate` uses secrets.STAGING_DB_URL"],
    ["no-permissions.yml", "top-level-permissions", ":1 ", "permissions"],
    ["pull-request-target.yml", "no-pull-request-target", ":3 ", "pull_request_target"],
    ["secrets-dump.yml", "no-secrets-dump", ":12 ", "toJSON(secrets)"],
  ])("%s exits 1 naming rule %s", (file, rule, line, detail) => {
    const r = runNodeChecker("workflow-policy.mjs", [fixture(file)]);
    expect(r.status).toBe(1);
    const failures = r.stderr.split("\n").filter((l) => l.startsWith("workflow-policy: FAIL"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`${fixture(file)}${line}[${rule}]`);
    expect(failures[0]).toContain(detail);
  });

  it("exits 2 on an unreadable file", () => {
    expect(runNodeChecker("workflow-policy.mjs", ["lint-fixtures/workflows/does-not-exist.yml"]).status).toBe(2);
  });
});

describe("workflow policy on regressions of the real staging workflows", () => {
  it("staging.yml gains a pull_request trigger -> staging-no-pr-trigger (by file name)", () => {
    const text = workflow("staging.yml").replace(/^on:\n/m, "on:\n  pull_request:\n");
    expect(rules(".github/workflows/staging.yml", text)).toEqual(["staging-no-pr-trigger"]);
  });

  it("drift.yml gains a workflow_run trigger -> staging-no-pr-trigger", () => {
    const text = workflow("drift.yml").replace(/^on:\n/m, 'on:\n  workflow_run:\n    workflows: ["CI"]\n');
    expect(rules(".github/workflows/drift.yml", text)).toEqual(["staging-no-pr-trigger"]);
  });

  it("the migrate job loses its environment -> staging-secret-needs-environment for each STAGING_DB_URL reference", () => {
    const original = workflow("staging.yml");
    const text = original.replace(/(\n  migrate:[\s\S]*?)\n    environment: staging\n/, "$1\n");
    expect(text).not.toBe(original);
    const found = checkWorkflow(".github/workflows/staging.yml", text);
    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const f of found) {
      expect(f.rule).toBe("staging-secret-needs-environment");
      expect(f.message).toContain("job `migrate` uses secrets.STAGING_DB_URL");
    }
  });

  it("a staging secret moved to the workflow-level env -> staging-secret-needs-environment", () => {
    const text = workflow("drift.yml").replace(/^permissions:\n/m, "env:\n  RO: ${{ secrets.STAGING_DB_URL_RO }}\npermissions:\n");
    const found = checkWorkflow(".github/workflows/drift.yml", text);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("staging-secret-needs-environment");
    expect(found[0].message).toContain("outside a job");
  });

  it("ci.yml with a tag-pinned checkout and without top-level permissions -> two rules", () => {
    const text = workflow("ci.yml")
      .replace(/actions\/checkout@[0-9a-f]{40}/, "actions/checkout@v7")
      .replace(/^permissions:\n  contents: read\n/m, "");
    expect(rules(".github/workflows/ci.yml", text).sort()).toEqual(["top-level-permissions", "uses-pinned"]);
  });
});
