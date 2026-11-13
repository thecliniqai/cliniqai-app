/**
 * Workflow policy (V2-03 03-08; rulings R-9, R-19, R-21; threat T-03-09): scripts/ci/workflow-policy.mjs fails, naming
 * the rule, on an unpinned `uses:`, a PR trigger on a staging workflow, a staging secret in a job without an
 * `environment`, a missing top-level `permissions`, `pull_request_target` and a secrets dump; the repository's own
 * workflows pass, and the same regressions introduced into those real files are caught.
 */
import fs from "node:fs";
import os from "node:os";
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

/** A full commit SHA, so the pin rule stays quiet and each case isolates its own rule. */
const PIN = "3d3c42e5aac5ba805825da76410c181273ba90b1";

describe("workflow policy enforces every rule the staging/drift headers claim (03-13b M-POLICY)", () => {
  // The review's bypass fixture (A M-3), verbatim in shape: flow-style triggers with pull_request, write-all, job-level
  // write scopes, a staging secret in job-level env, setup-node's npm cache and an untrusted context in run:.
  const BYPASS_FLOW = [
    "name: bypass",
    "on: { pull_request: { branches: [feature/v2] }, workflow_dispatch: {} }",
    "permissions: write-all",
    "jobs:",
    "  migrate:",
    "    runs-on: ubuntu-24.04",
    "    environment: staging",
    "    permissions:",
    "      contents: write",
    "      id-token: write",
    "    env:",
    "      DB: ${{ secrets.STAGING_DB_URL }}",
    "    steps:",
    `      - uses: actions/setup-node@${PIN}`,
    "        with:",
    "          cache: npm",
    '      - run: echo "${{ github.head_ref }}"',
    "",
  ].join("\n");
  // The same workflow in block style, so every individual rule fires.
  const BYPASS_BLOCK = BYPASS_FLOW.replace(
    "on: { pull_request: { branches: [feature/v2] }, workflow_dispatch: {} }",
    "on:\n  pull_request:\n    branches: [feature/v2]\n  workflow_dispatch:",
  );

  it("the flow-style bypass fixture fails (CLI exit 1) instead of passing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-policy-"));
    try {
      const file = path.join(dir, "staging.yml");
      fs.writeFileSync(file, BYPASS_FLOW);
      const r = runNodeChecker("workflow-policy.mjs", [file]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("[parseable-yaml] flow mappings ({ … }) are not supported");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the block-style bypass names every rule it breaks", () => {
    const found = rules(".github/workflows/staging.yml", BYPASS_BLOCK);
    expect([...new Set(found)].sort()).toEqual(
      [
        "no-write-all",
        "privileged-no-cache",
        "run-no-untrusted-expression",
        "staging-no-pr-trigger",
        // 04-00 (L-5): its `migrate` job has no read-only `plan` job to wait for.
        "staging-plan-before-migrate",
        "staging-read-only-token",
        "staging-secret-step-scope",
      ].sort(),
    );
    expect(found.filter((r) => r === "staging-read-only-token")).toHaveLength(2); // contents and id-token
  });

  const staging = () => workflow("staging.yml");
  const drift = () => workflow("drift.yml");
  /** Applies `edit`, checks it changed the text, returns the rules found. */
  const after = (name: string, original: string, edit: (t: string) => string) => {
    const text = edit(original);
    expect(text, "the edit did not apply").not.toBe(original);
    return rules(`.github/workflows/${name}`, text);
  };

  it.each<[string, string, (t: string) => string, string[]]>([
    ["triggers as a flow list with pull_request", "staging.yml", (t) => t.replace(/^on:\n/m, "on: [push, pull_request]\nx-old-on:\n"), ["staging-no-pr-trigger"]],
    ["an issue_comment trigger", "drift.yml", (t) => t.replace(/^on:\n/m, "on:\n  issue_comment:\n"), ["staging-no-pr-trigger"]],
    ["a pull_request_review trigger", "staging.yml", (t) => t.replace(/^on:\n/m, "on:\n  pull_request_review:\n"), ["staging-no-pr-trigger"]],
    ["permissions: write-all", "drift.yml", (t) => t.replace(/^permissions:\n  contents: read\n/m, "permissions: write-all\n"), ["no-write-all"]],
    ["a job-level contents: write", "staging.yml", (t) => t.replace("    environment: staging\n", "    environment: staging\n    permissions:\n      contents: write\n"), ["staging-read-only-token"]],
    [
      "a staging secret in job-level env",
      "drift.yml",
      (t) => t.replace("    environment: staging-readonly\n", "    environment: staging-readonly\n    env:\n      RO: ${{ secrets.STAGING_DB_URL_RO }}\n"),
      ["staging-secret-step-scope"],
    ],
    [
      "a staging secret in a step's with:",
      "staging.yml",
      (t) => t.replace("          node-version-file: .nvmrc\n", "          node-version-file: .nvmrc\n          token: ${{ secrets.STAGING_SECRET_KEY }}\n"),
      ["staging-secret-step-scope"],
    ],
    ["setup-node's npm cache", "staging.yml", (t) => t.replace("          node-version-file: .nvmrc\n", "          node-version-file: .nvmrc\n          cache: npm\n"), ["privileged-no-cache"]],
    [
      "an actions/cache step",
      "drift.yml",
      (t) => t.replace("      - name: npm ci (no install scripts)\n", `      - uses: actions/cache@${PIN}\n        with:\n          path: x\n          key: k\n      - name: npm ci (no install scripts)\n`),
      ["privileged-no-cache"],
    ],
    ["npm ci without --ignore-scripts", "staging.yml", (t) => t.replace("run: npm ci --ignore-scripts\n", "run: npm ci\n"), ["privileged-ignore-scripts"]],
    ["a checkout that persists credentials", "drift.yml", (t) => t.replace("          persist-credentials: false\n", "          persist-credentials: true\n"), ["privileged-checkout-no-persist"]],
    ["any expression in a staging run:", "staging.yml", (t) => t.replace('run: node scripts/staging/wait-for-release.mjs "$STAGING_ORIGIN" "$RELEASE_SHA"', "run: node scripts/staging/wait-for-release.mjs ${{ vars.STAGING_ORIGIN }}"), ["run-no-untrusted-expression"]],
    [
      "a staging secret hidden in a shell comment of a run: script",
      "staging.yml",
      (t) => t.replace('          if [ "$TASK" = "seed-reset" ]; then\n', '          # ${{ secrets.STAGING_SECRET_KEY }}\n          if [ "$TASK" = "seed-reset" ]; then\n'),
      ["run-no-untrusted-expression", "staging-secret-step-scope"],
    ],
    ["a YAML anchor", "drift.yml", (t) => t.replace("    runs-on: ubuntu-24.04\n", "    runs-on: &os ubuntu-24.04\n"), ["parseable-yaml"]],
    ["a duplicate key", "drift.yml", (t) => t.replace("    runs-on: ubuntu-24.04\n", "    runs-on: ubuntu-24.04\n    runs-on: ubuntu-22.04\n"), ["parseable-yaml"]],
  ])("staging/drift regression: %s", (_label, name, edit, expected) => {
    const found = after(name, name === "staging.yml" ? staging() : drift(), edit);
    expect([...new Set(found)].sort()).toEqual([...expected].sort());
  });

  it("ci.yml: an untrusted context in run: fails even outside staging; the existing safe expressions pass", () => {
    const ci = workflow("ci.yml");
    expect(rules(".github/workflows/ci.yml", ci)).toEqual([]);
    for (const expr of ["github.head_ref", "github.event.pull_request.title", "inputs.lane", "steps.pw.outputs.version", "secrets.GITHUB_TOKEN"]) {
      const found = after("ci.yml", ci, (t) => t.replace("run: node scripts/ci/assert-no-env-files.mjs", `run: echo "\${{ ${expr} }}"`));
      expect(found, expr).toEqual(["run-no-untrusted-expression"]);
    }
  });

  it("ci.yml keeps its npm caches and plain npm ci (no environment, not a staging workflow)", () => {
    expect(rules(".github/workflows/ci.yml", workflow("ci.yml"))).toEqual([]);
    expect(rules(".github/workflows/nightly.yml", workflow("nightly.yml"))).toEqual([]);
  });
});

/**
 * V2-04 04-00 (review A L-5, L-7; R-47): in staging.yml the `migrate` job needs the read-only `plan` job (Environment
 * `staging-readonly`), and no staging `run:` prints a database URL with its password for a CLI. Each regression is made
 * on the real staging.yml, so the committed file is what the rules are proved against.
 */
describe("workflow policy: plan before migrate and password-free CLI URLs (04-00)", () => {
  const staging = () => workflow("staging.yml");
  const after = (edit: (t: string) => string, name = "staging.yml", original = staging()) => {
    const text = edit(original);
    expect(text, "the edit did not apply").not.toBe(original);
    return checkWorkflow(`.github/workflows/${name}`, text);
  };

  it("the committed staging.yml has a plan job in staging-readonly that migrate needs, and passes", () => {
    const text = staging();
    expect(text).toMatch(/\n  plan:\n[\s\S]*?\n    environment: staging-readonly\n/);
    expect(text).toMatch(/\n  migrate:\n    name: migrate\n    needs: plan\n/);
    expect(checkWorkflow(".github/workflows/staging.yml", text)).toEqual([]);
  });

  it("Environment staging-backup is accepted in backup.yml only (04-05a, R-48)", () => {
    const backup = workflow("backup.yml");
    expect(backup).toMatch(/\n    environment: staging-backup\n/);
    expect(checkWorkflow(".github/workflows/backup.yml", backup)).toEqual([]);
    // The same job in any other workflow file is refused, by name or in the mapping form.
    for (const name of ["staging.yml", "drift.yml", "backup-copy.yml", "nightly.yml"]) {
      const found = checkWorkflow(`.github/workflows/${name}`, backup).filter((f) => f.rule === "staging-backup-environment-scope");
      expect(found, name).toHaveLength(1);
      expect(found[0].message).toContain("only backup.yml may");
    }
    const mapping = backup.replace("    environment: staging-backup\n", "    environment:\n      name: staging-backup\n");
    expect(checkWorkflow(".github/workflows/other.yml", mapping).map((f) => f.rule)).toContain("staging-backup-environment-scope");
    // It still counts as a staging workflow: a PR trigger is refused.
    const pr = backup.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n  pull_request:\n");
    expect(checkWorkflow(".github/workflows/backup.yml", pr).map((f) => f.rule)).toContain("staging-no-pr-trigger");
  });

  it("migrate without `needs: plan` fails (L-5)", () => {
    const found = after((t) => t.replace("    needs: plan\n", ""));
    expect(found.map((f) => f.rule)).toEqual(["staging-plan-before-migrate"]);
    expect(found[0].message).toContain("must declare `needs: plan`");
  });

  it("a plan job that runs in the reviewed staging Environment fails (L-5)", () => {
    const found = after((t) => t.replace(/(\n  plan:[\s\S]*?\n    environment: )staging-readonly\n/, "$1staging\n"));
    expect(found.map((f) => f.rule)).toEqual(["staging-plan-before-migrate"]);
    expect(found[0].message).toContain("must run in Environment `staging-readonly`");
  });

  it("no plan job at all fails, even if migrate still names it (L-5)", () => {
    const found = after((t) => t.replace(/\n  plan:\n[\s\S]*?\n(?=  migrate:\n)/, "\n"));
    expect(found.map((f) => f.rule)).toEqual(["staging-plan-before-migrate"]);
    expect(found[0].message).toContain("no `plan` job");
  });

  it.each([
    ["a flow list", (t: string) => t.replace("    needs: plan\n", "    needs: [plan]\n")],
    ["a block list", (t: string) => t.replace("    needs: plan\n", "    needs:\n      - plan\n")],
  ])("`needs` written as %s passes", (_label, edit) => {
    expect(after(edit)).toEqual([]);
  });

  it("a staging run: that prints the database URL with its password fails (L-7)", () => {
    const found = after((t) => t.replace("--print-db-url --no-password)", "--print-db-url)"));
    expect(found.map((f) => f.rule)).toEqual(["staging-db-url-no-password"]);
    expect(found[0].message).toContain("without `--no-password`");
  });

  it("the same command in drift.yml (a staging workflow) fails too; outside staging workflows the rule does not apply", () => {
    const drift = workflow("drift.yml");
    const edit = (t: string) =>
      t.replace("run: node scripts/staging/schema-drift.mjs --out drift-report", 'run: |\n          DB_URL="$(node scripts/staging/target-guard.mjs --var STAGING_DB_URL_RO --print-db-url)"\n          node scripts/staging/schema-drift.mjs --out drift-report');
    expect(after(edit, "drift.yml", drift).map((f) => f.rule)).toEqual(["staging-db-url-no-password"]);
    const ci = workflow("ci.yml");
    expect(after((t) => t.replace("run: node scripts/ci/assert-no-env-files.mjs", "run: node scripts/staging/target-guard.mjs --var X --print-db-url"), "ci.yml", ci)).toEqual([]);
  });
});
