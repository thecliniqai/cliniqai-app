/**
 * Workflow policy (V2-03 03-08; rulings R-9, R-19, R-21; threat T-03-09): scripts/ci/workflow-policy.mjs fails, naming
 * the rule, on an unpinned `uses:`, a PR trigger on a staging workflow, a staging secret in a job without an
 * `environment`, a missing top-level `permissions`, `pull_request_target` and a secrets dump; the repository's own
 * workflows pass, and the same regressions introduced into those real files are caught.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWorkflow, dynamicSecretLines } from "@/scripts/ci/workflow-policy.mjs";
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

  it("drift.yml gains a workflow_run trigger -> staging-no-pr-trigger (and, 04-07c, workflow-run-pinned on each job)", () => {
    const text = workflow("drift.yml").replace(/^on:\n/m, 'on:\n  workflow_run:\n    workflows: ["CI"]\n');
    expect([...new Set(rules(".github/workflows/drift.yml", text))].sort()).toEqual(["staging-no-pr-trigger", "workflow-run-pinned"]);
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
        // 04-06: its staging job has no job-level `if:` limiting it to feature/v2.
        "staging-feature-v2-only",
        // 04-07c (L-3): nor the case-sensitive ref check as its first step.
        "staging-exact-ref-step",
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
      // The first setup-node is the `plan` job's (Environment staging-readonly, 04-00), so 04-06's rule fires too.
      ["staging-secret-step-scope", "staging-readonly-secrets-ro"],
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

/**
 * V2-04 04-06 (R-28; T-04-15, T-04-17): the staging ops report workflow. It is a staging workflow (Environment
 * `staging-readonly`), so every staging rule applies; three rules are new: a `staging-readonly` job reads only `*_RO`
 * secrets, every job in a `staging*` Environment is limited to feature/v2 by its `if:`, and every job of
 * `ops-report.yml` runs in `staging-readonly`. Each regression is made on the committed file.
 */
describe("workflow policy: the read-only ops report (04-06)", () => {
  const report = () => workflow("ops-report.yml");
  const after = (edit: (t: string) => string, name = "ops-report.yml", original = report()) => {
    const text = edit(original);
    expect(text, "the edit did not apply").not.toBe(original);
    return checkWorkflow(`.github/workflows/${name}`, text);
  };

  it("the committed ops-report.yml passes: staging-readonly, feature/v2 only, read-only token, pinned actions, no PR trigger", () => {
    const text = report();
    expect(text).toMatch(/\n    environment: staging-readonly\n/);
    expect(text).toMatch(/\n    if: \$\{\{ github\.ref == 'refs\/heads\/feature\/v2' \}\}\n/);
    expect(text).toMatch(/\npermissions:\n  contents: read\n\n/);
    expect(text).toContain("run: node scripts/ops/ops-report.mjs --out ops-report/ops-report.json --hours 48");
    expect(text).not.toMatch(/pull_request|workflow_run/);
    expect(checkWorkflow(".github/workflows/ops-report.yml", text)).toEqual([]);
  });

  it("the job moved to the reviewed staging Environment (write credentials) -> ops-report-read-only", () => {
    const found = after((t) => t.replace("    environment: staging-readonly\n", "    environment: staging\n"));
    expect(found.map((f) => f.rule)).toEqual(["ops-report-read-only"]);
    expect(found[0].message).toContain("must run in Environment `staging-readonly`");
  });

  it("the write database URL in the staging-readonly job -> staging-readonly-secrets-ro (any workflow)", () => {
    const found = after((t) => t.replace(/STAGING_DB_URL_RO: \$\{\{ secrets\.STAGING_DB_URL_RO \}\}\n(\s+SUPABASE_PROJECT_REF_STAGING: \$\{\{ vars\.SUPABASE_PROJECT_REF_STAGING \}\}\n\s+run: node scripts\/ops)/, "STAGING_DB_URL_RO: ${{ secrets.STAGING_DB_URL }}\n$1"));
    expect(found.map((f) => f.rule)).toEqual(["staging-readonly-secrets-ro"]);
    expect(found[0].message).toContain("uses secrets.STAGING_DB_URL;");
    // The same rule in drift.yml (a non-STAGING secret name too), and the plan job of staging.yml.
    const drift = workflow("drift.yml");
    expect(after((t) => t.replace("secrets.SUPABASE_ACCESS_TOKEN_STAGING_RO", "secrets.SUPABASE_ACCESS_TOKEN"), "drift.yml", drift).map((f) => f.rule)).toEqual([
      "staging-readonly-secrets-ro",
    ]);
    const staging = workflow("staging.yml");
    const plan = after((t) => t.replace(/(\n  plan:[\s\S]*?)STAGING_DB_URL_RO: \$\{\{ secrets\.STAGING_DB_URL_RO \}\}/, "$1STAGING_DB_URL_RO: ${{ secrets.STAGING_DB_URL }}"), "staging.yml", staging);
    expect(plan.map((f) => f.rule)).toEqual(["staging-readonly-secrets-ro"]);
  });

  it.each([
    ["no job-level if", (t: string) => t.replace("    if: ${{ github.ref == 'refs/heads/feature/v2' }}\n", ""), "has no job-level `if:`"],
    ["another branch", (t: string) => t.replace("refs/heads/feature/v2' }}", "refs/heads/main' }}"), "does not start with"],
    ["an || that bypasses the branch", (t: string) => t.replace("refs/heads/feature/v2' }}", "refs/heads/feature/v2' && github.actor == 'x' || github.event_name == 'workflow_dispatch' }}"), "top-level `||`"],
    ["the branch check second", (t: string) => t.replace("if: ${{ github.ref == 'refs/heads/feature/v2' }}", "if: ${{ github.event_name == 'schedule' && github.ref == 'refs/heads/feature/v2' }}"), "does not start with"],
  ])("%s -> staging-feature-v2-only", (_label, edit, detail) => {
    const found = after(edit);
    expect(found.map((f) => f.rule)).toEqual(["staging-feature-v2-only"]);
    expect(found[0].message).toContain(detail);
  });

  it("an || inside parentheses after the branch check passes (staging.yml's form); the rule covers backup.yml and drift.yml jobs", () => {
    expect(after((t) => t.replace("refs/heads/feature/v2' }}", "refs/heads/feature/v2' && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') }}"))).toEqual([]);
    for (const name of ["backup.yml", "drift.yml", "staging.yml"]) {
      const original = workflow(name);
      const found = after((t) => t.replace("if: ${{ github.ref == 'refs/heads/feature/v2'", "if: ${{ github.ref != 'refs/heads/feature/v2'"), name, original);
      expect(found.map((f) => f.rule), name).toEqual(["staging-feature-v2-only"]);
    }
  });

  it("the standing staging rules bite on ops-report.yml too (it is a staging workflow)", () => {
    expect(after((t) => t.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n  pull_request:\n")).map((f) => f.rule)).toEqual(["staging-no-pr-trigger"]);
    expect(after((t) => t.replace("  contents: read\n", "  contents: write\n")).map((f) => f.rule)).toEqual(["staging-read-only-token"]);
    expect(after((t) => t.replace("run: node scripts/ops/ops-report.mjs --out", 'run: echo "${{ secrets.STAGING_DB_URL_RO }}"; node scripts/ops/ops-report.mjs --out')).map((f) => f.rule)).toContain("run-no-untrusted-expression");
    expect(after((t) => t.replace("run: npm ci --ignore-scripts\n", "run: npm ci\n")).map((f) => f.rule)).toEqual(["privileged-ignore-scripts"]);
    expect(after((t) => t.replace("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "actions/checkout@v7")).map((f) => f.rule)).toEqual(["uses-pinned"]);
    expect(after((t) => t.replace("          node-version-file: .nvmrc\n", "          node-version-file: .nvmrc\n          cache: npm\n")).map((f) => f.rule)).toEqual(["privileged-no-cache"]);
  });
});

/**
 * V2-04 04-07c (review C M-1, L-2, L-3; triage M-POLICY): the reviewer's bypasses. Each fixture in
 * lint-fixtures/workflows/bypass-*.yml passed the policy as committed at 0dc606b (exit 0; before/after in
 * evidence/04-07c/workflow-policy-bypass-before-after.txt) and is now refused, naming each rule it breaks. The same
 * bypasses are then applied to the committed workflows, and the backup alert's conditions are evaluated against a fork
 * PR's spoofed run with GitHub's case-insensitive string comparison.
 */
describe("workflow policy: environment, secret-name and workflow_run bypasses (04-07c)", () => {
  const ruleSet = (file: string, text: string) => [...new Set(rules(file, text))].sort();

  it.each([
    [
      "bypass-environment-expression.yml",
      ["environment-literal", "no-dynamic-secret", "staging-exact-ref-step", "staging-feature-v2-only", "staging-no-pr-trigger", "workflow-run-pinned"],
    ],
    ["bypass-environment-matrix.yml", ["environment-literal", "no-dynamic-secret", "staging-exact-ref-step"]],
    ["bypass-environment-case.yml", ["environment-known", "staging-backup-environment-scope"]],
    ["bypass-readonly-case.yml", ["environment-known", "staging-readonly-secrets-ro"]],
    ["bypass-workflow-run-name-only.yml", ["workflow-run-pinned"]],
  ])("%s is refused (CLI exit 1) naming %j", (file, expected) => {
    const r = runNodeChecker("workflow-policy.mjs", [fixture(file)]);
    expect(r.status).toBe(1);
    const found = [...new Set([...r.stderr.matchAll(/\[([a-z0-9-]+)\]/g)].map((m) => m[1]))].sort();
    expect(found).toEqual(expected);
  });

  it("the bypasses applied to the committed backup.yml: expression, matrix, mixed-case and unknown Environment names", () => {
    const backup = workflow("backup.yml");
    const env = (name: string) => backup.replace("    environment: staging-backup\n", `    environment: ${name}\n`);
    expect(ruleSet(".github/workflows/backup.yml", env("${{ vars.BK_ENV }}"))).toEqual(["environment-literal"]);
    expect(ruleSet(".github/workflows/backup.yml", env("${{ matrix.e }}"))).toEqual(["environment-literal"]);
    expect(ruleSet(".github/workflows/backup.yml", env("Staging-Backup"))).toEqual(["environment-known"]);
    expect(ruleSet(".github/workflows/backup.yml", env("production"))).toEqual(["environment-known"]);
    const mapping = backup.replace("    environment: staging-backup\n", "    environment:\n      name: ${{ inputs.env }}\n");
    expect(ruleSet(".github/workflows/backup.yml", mapping)).toEqual(["environment-literal"]);
    // A mixed-case `staging-backup` in another file is caught by the scope rule too (names compared lower-cased).
    expect(ruleSet(".github/workflows/other.yml", env("STAGING-BACKUP"))).toEqual(["environment-known", "staging-backup-environment-scope"]);
  });

  it("a computed index into secrets is refused wherever it appears; literal reads and other contexts pass", () => {
    const backup = workflow("backup.yml");
    for (const expr of ["secrets[matrix.n]", "secrets[ format('{0}_{1}', 'BACKUP', 'S3_BUCKET') ]", "secrets[inputs.name]", "fromJSON(toJSON(secrets))[matrix.n]"]) {
      const text = backup.replace("BACKUP_S3_BUCKET: ${{ secrets.BACKUP_S3_BUCKET }}\n          BACKUP_S3_ACCESS_KEY_ID", `BACKUP_S3_BUCKET: \${{ ${expr} }}\n          BACKUP_S3_ACCESS_KEY_ID`);
      expect(text, expr).not.toBe(backup);
      expect(rules(".github/workflows/backup.yml", text), expr).toContain(expr.includes("toJSON") ? "no-secrets-dump" : "no-dynamic-secret");
    }
    expect(dynamicSecretLines("a: ${{ secrets.X }}\nb: ${{ secrets['Y'] }}\nc: ${{ inputs.secrets }}\nd: ${{ toJSON(secrets) }}\n")).toEqual([]);
    expect(dynamicSecretLines("a: 1\nb: ${{ format('{0}',\n  secrets[matrix.n]) }}\n")).toEqual([2]);
  });

  it("any job with an Environment makes the workflow a staging workflow: workflow_run and PR triggers are refused next to it", () => {
    const ci = workflow("ci.yml");
    const withEnv = ci.replace(/(\n  static:\n(?: {4}.*\n)*? {4}runs-on: [^\n]+\n)/, "$1    environment: staging-readonly\n");
    expect(withEnv, "the edit did not apply").not.toBe(ci);
    const found = ruleSet(".github/workflows/ci.yml", withEnv);
    expect(found).toContain("staging-no-pr-trigger");
    expect(found).toContain("staging-feature-v2-only");
    expect(found).toContain("staging-exact-ref-step");
    const report = workflow("ops-report.yml").replace("  workflow_dispatch:\n", "  workflow_dispatch:\n  workflow_run:\n    workflows: [CI]\n");
    expect(ruleSet(".github/workflows/ops-report.yml", report)).toEqual(["staging-no-pr-trigger", "workflow-run-pinned"]);
  });

  it("every staging job starts with the exact-ref step; removing it, conditioning it or weakening it is refused", () => {
    for (const name of ["staging.yml", "drift.yml", "ops-report.yml", "backup.yml"]) {
      const text = workflow(name);
      const jobs = (text.match(/\n {4}environment: /g) ?? []).length;
      expect((text.match(/\n {6}- name: Exact ref check \(feature\/v2, case-sensitive\)\n {8}run: '\[ "\$GITHUB_REF" = "refs\/heads\/feature\/v2" \] \|\| /g) ?? []).length, name).toBe(jobs);
      expect(checkWorkflow(`.github/workflows/${name}`, text), name).toEqual([]);
    }
    const ops = workflow("ops-report.yml");
    const step = /      - name: Exact ref check \(feature\/v2, case-sensitive\)\n        run: [^\n]+\n/;
    expect(ruleSet(".github/workflows/ops-report.yml", ops.replace(step, ""))).toEqual(["staging-exact-ref-step"]);
    expect(ruleSet(".github/workflows/ops-report.yml", ops.replace("      - name: Exact ref check (feature/v2, case-sensitive)\n", "      - name: Exact ref check (feature/v2, case-sensitive)\n        if: ${{ false }}\n"))).toEqual(["staging-exact-ref-step"]);
    expect(ruleSet(".github/workflows/ops-report.yml", ops.replace("      - name: Exact ref check (feature/v2, case-sensitive)\n", "      - name: Exact ref check (feature/v2, case-sensitive)\n        continue-on-error: true\n"))).toEqual(["staging-exact-ref-step"]);
    expect(ruleSet(".github/workflows/ops-report.yml", ops.replace('= "refs/heads/feature/v2" ] ||', '== "refs/heads/feature/v2" ] ||'))).toEqual(["staging-exact-ref-step"]);
    expect(ruleSet(".github/workflows/ops-report.yml", ops.replace('exit 1; }\'', 'exit 0; }\''))).toEqual(["staging-exact-ref-step"]);
  });

  it("the exact-ref step is case-sensitive where GitHub's == is not: Feature/V2 passes the if: but fails the step", () => {
    const line = /\n {8}run: '(\[ "\$GITHUB_REF" = [^\n]+)'\n/.exec(workflow("backup.yml"))?.[1];
    expect(line).toBeDefined();
    const step = (ref: string) => spawnSync("bash", ["-e", "-c", line!], { encoding: "utf8", env: { PATH: process.env.PATH, GITHUB_REF: ref, NODE_ENV: "test" } });
    expect(step("refs/heads/feature/v2").status).toBe(0);
    for (const ref of ["refs/heads/Feature/V2", "refs/heads/FEATURE/v2", "refs/heads/feature/v2-x", "refs/tags/feature/v2"]) {
      const r = step(ref);
      expect(r.status, ref).toBe(1);
      expect(r.stderr).toContain("wrong ref");
    }
    // The job `if:` alone would have let the mixed-case branch through (GitHub compares strings case-insensitively).
    expect(evaluateIf("github.ref == 'refs/heads/feature/v2'", { github: { ref: "refs/heads/Feature/V2" } })).toBe(true);
  });

  it("backup-alert.yml: each pinned condition is required and a top-level || is refused", () => {
    const alert = workflow("backup-alert.yml");
    expect(checkWorkflow(".github/workflows/backup-alert.yml", alert)).toEqual([]);
    for (const [label, cut] of [
      ["path", "github.event.workflow_run.path == '.github/workflows/backup.yml'\n      && "],
      ["repository", "\n      && github.event.workflow_run.head_repository.full_name == github.repository"],
      ["event", "\n      && contains(fromJSON('[\"schedule\",\"workflow_dispatch\"]'), github.event.workflow_run.event)"],
    ]) {
      const text = alert.replace(cut, "");
      expect(text, label).not.toBe(alert);
      const found = checkWorkflow(".github/workflows/backup-alert.yml", text);
      expect(found.map((f) => f.rule), label).toEqual(["workflow-run-pinned"]);
    }
    const widened = alert.replace(`'["schedule","workflow_dispatch"]'`, `'["schedule","workflow_dispatch","pull_request_review"]'`);
    expect(ruleSet(".github/workflows/backup-alert.yml", widened)).toEqual(["workflow-run-pinned"]);
    const or = alert.replace("&& github.event.workflow_run.conclusion != 'skipped' }}", "&& github.event.workflow_run.conclusion != 'skipped' || github.actor == 'x' }}");
    expect(checkWorkflow(".github/workflows/backup-alert.yml", or).map((f) => f.message)).toEqual([expect.stringContaining("top-level `||`")]);
  });

  describe("backup-alert.yml against a fork PR's spoofed 'Staging backup' run (review C L-2)", () => {
    const alert = workflow("backup-alert.yml");
    const ifExpr = /\n {4}if: >-\n((?: {6}[^\n]*\n)+)/.exec(alert)![1].split("\n").map((l) => l.trim()).join(" ").trim();
    const script = /\n {8}run: \|\n((?: {10}[^\n]*\n?)+)/.exec(alert)![1].split("\n").map((l) => l.slice(10)).join("\n");
    const repo = "clinicos/clinicOS";
    const genuine = {
      path: ".github/workflows/backup.yml",
      head_repository: { full_name: repo },
      event: "schedule",
      head_branch: "feature/v2",
      conclusion: "failure",
      html_url: "https://github.com/clinicos/clinicOS/actions/runs/1",
    };
    const ctx = (run: Record<string, unknown>) => ({ github: { repository: repo, event: { workflow_run: run } } });

    /** Runs the step's script with a recording `gh` (no network) the way the job's env would pass the event. */
    function runStep(run: typeof genuine) {
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-gh-"));
      const log = path.join(bin, "gh.log");
      try {
        fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho "$*" >> "${log}"\ncase "$1 $2" in "issue list") echo '[]' ;; esac\n`, { mode: 0o755 });
        const r = spawnSync("bash", ["-e", "-c", script], {
          cwd: ROOT,
          encoding: "utf8",
          env: {
            PATH: `${bin}:${process.env.PATH}`,
            GH_REPO: repo,
            RUN_URL: run.html_url,
            CONCLUSION: run.conclusion,
            WF_PATH: run.path,
            HEAD_BRANCH: run.head_branch,
            HEAD_REPO: run.head_repository.full_name,
            RUN_EVENT: run.event,
            NODE_ENV: "test",
          },
        });
        return { status: r.status, stderr: r.stderr, gh: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "" };
      } finally {
        fs.rmSync(bin, { recursive: true, force: true });
      }
    }

    it("a genuine failed scheduled or dispatched run of backup.yml opens the issue", () => {
      expect(evaluateIf(ifExpr, ctx(genuine))).toBe(true);
      expect(evaluateIf(ifExpr, ctx({ ...genuine, event: "workflow_dispatch", conclusion: "timed_out" }))).toBe(true);
      const r = runStep(genuine);
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(r.gh).toContain('issue create --title Staging backup failing');
      expect(evaluateIf(ifExpr, ctx({ ...genuine, conclusion: "success" }))).toBe(false);
    });

    it.each([
      ["a fork PR's copy under pull_request_review (fork branch named feature/v2)", { head_repository: { full_name: "attacker/clinicOS" }, event: "pull_request_review" }],
      ["the same from a branch of this repository under pull_request_review_comment", { event: "pull_request_review_comment" }],
      ["a workflow at another path that copies the name", { path: ".github/workflows/fake-backup.yml" }],
      ["a fork's run of the real file path under workflow_dispatch", { head_repository: { full_name: "attacker/clinicOS" }, event: "workflow_dispatch" }],
      ["a pull_request run", { event: "pull_request" }],
      ["another branch", { head_branch: "main" }],
    ])("refuses %s at the job condition", (_label, spoof) => {
      expect(evaluateIf(ifExpr, ctx({ ...genuine, ...spoof }))).toBe(false);
    });

    it.each([
      ["a mixed-case branch Feature/V2", { head_branch: "Feature/V2" }],
      ["a mixed-case workflow path", { path: ".github/workflows/Backup.yml" }],
      ["a mixed-case repository owner", { head_repository: { full_name: "Clinicos/clinicOS" } }],
    ])("%s passes GitHub's case-insensitive if: but the step refuses it and opens nothing", (_label, spoof) => {
      const run = { ...genuine, ...spoof } as typeof genuine;
      expect(evaluateIf(ifExpr, ctx(run))).toBe(true);
      const r = runStep(run);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("not a feature/v2 run of this repository's backup.yml");
      expect(r.gh).toBe("");
    });
  });
});

/**
 * A small evaluator for the expression forms the pinned `if:` conditions use, with GitHub's semantics: string `==` and
 * `!=` ignore case, `&&` / `||` / parentheses, `contains(fromJSON('[…]'), x)` (case-insensitive), dotted context paths.
 */
function evaluateIf(expr: string, context: Record<string, unknown>): boolean {
  const src = expr.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1");
  const tokens = [...src.matchAll(/\s*('(?:[^']|'')*'|&&|\|\||==|!=|[(),]|[A-Za-z_][A-Za-z0-9_.-]*)/gy)].map((m) => m[1]);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const resolve = (p: string): unknown => p.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), context);
  const eq = (a: unknown, b: unknown) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
  function primary(): unknown {
    const t = next();
    if (t === "(") {
      const v = or();
      next();
      return v;
    }
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t === "contains" || t === "fromJSON") {
      next(); // (
      const args: unknown[] = [or()];
      while (peek() === ",") {
        next();
        args.push(or());
      }
      next(); // )
      if (t === "fromJSON") return JSON.parse(String(args[0]));
      const [hay, needle] = args;
      return Array.isArray(hay) ? hay.some((h) => eq(h, needle)) : String(hay).toLowerCase().includes(String(needle).toLowerCase());
    }
    if (t === "true" || t === "false") return t === "true";
    return resolve(t);
  }
  function comparison(): unknown {
    const left = primary();
    if (peek() === "==" || peek() === "!=") {
      const op = next();
      const right = primary();
      return op === "==" ? eq(left, right) : !eq(left, right);
    }
    return left;
  }
  function and(): unknown {
    let v = comparison();
    while (peek() === "&&") {
      next();
      const r = comparison();
      v = Boolean(v) && Boolean(r);
    }
    return v;
  }
  function or(): unknown {
    let v = and();
    while (peek() === "||") {
      next();
      const r = and();
      v = Boolean(v) || Boolean(r);
    }
    return v;
  }
  const result = or();
  if (i !== tokens.length) throw new Error(`evaluateIf: could not parse ${src}`);
  return Boolean(result);
}
