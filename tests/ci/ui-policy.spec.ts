/**
 * UI policy checker (V2-06 06-01a step 5; scripts/ci/ui-policy.mjs + scripts/ci/ui-policy/rules/*.mjs). Proves each
 * rule finds its fixture violation with file:line, report-mode findings never fail, the enforced brand-utility rule
 * does, and rules are discovered from the rules directory without a central list.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

const F = "lint-fixtures/ui-policy";
const NO_BASELINE = `${F}/no-baseline.json`;
const run = (root: string, ...extra: string[]) =>
  runNodeChecker("ui-policy.mjs", ["--root", `${F}/${root}`, "--baseline", NO_BASELINE, ...extra]);

interface Finding {
  rule: string;
  file: string;
  line: number;
  detail: string;
}
function findings(root: string, ...extra: string[]): { status: number | null; findings: Finding[]; stdout: string } {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ui-policy-")), "report.json");
  const r = run(root, "--json", out, ...extra);
  return { status: r.status, stdout: r.stdout, findings: JSON.parse(fs.readFileSync(out, "utf8")).findings };
}

describe("UI policy", () => {
  const S = "components/samples.tsx";

  it.each([
    ["arbitrary-color", S, 6, "bg-[#1769E0]"],
    ["px-font", S, 7, "text-[11px]"],
    ["raw-palette", S, 8, "text-gray-500"],
    ["raw-palette", S, 9, "bg-v1-blue-500"],
    ["screen-height", S, 10, "md:min-h-screen"],
    ["link-wraps-button", S, 12, "<Link> wraps <button>"],
    ["window-dialog", S, 14, "window.confirm()"],
    ["ai-sdk-import", "lib/ai-call.ts", 2, "ai"],
  ])("%s finds %s:%i", (rule, file, line, detail) => {
    const r = findings("violations");
    expect(r.findings).toContainEqual({ rule, file, line, detail });
  });

  it("report-mode findings exit 0 and are counted per rule; comments, semantic classes and primitives are not findings", () => {
    const r = findings("violations");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ui-policy: PASS");
    expect(r.findings.filter((f) => f.line === 1)).toEqual([]); // the comment line
    expect(r.findings.some((f) => f.detail.includes("hover:text-fg"))).toBe(false);
    expect(r.findings.some((f) => f.file === "components/ui/primitive.tsx")).toBe(false);
    expect(r.stdout).toContain("ui-policy: raw-palette [report] 2 finding(s) in 1 file(s)");
  });

  it("a brand-* class fails the enforced brand-utility rule (exit 1, file:line)", () => {
    const r = run("brand");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAIL brand-utility components/legacy.tsx:3 focus:border-brand-500");
    expect(r.stdout).toContain("ui-policy: FAIL (1 enforced finding(s))");
  });

  it("discovers rules from the rules directory without a central list", () => {
    const r = run("violations", "--rules", `${F}/extra-rules`);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ui-policy: fixture-extra [report] 3 finding(s) in 3 file(s)");
  });

  it("reports the delta against the baseline file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-policy-baseline-"));
    const baseline = path.join(dir, "baseline.json");
    fs.writeFileSync(baseline, JSON.stringify({ counts: { "px-font": 3 } }));
    const r = runNodeChecker("ui-policy.mjs", ["--root", `${F}/violations`, "--baseline", baseline]);
    expect(r.stdout).toContain("ui-policy: px-font [report] 1 finding(s) in 1 file(s) (baseline 3, delta -2)");
  });

  it("rejects a malformed rule module (usage error, exit 2)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-policy-rules-"));
    fs.writeFileSync(path.join(dir, "bad.mjs"), "export default { id: 'bad', mode: 'sometimes', check() { return []; } };\n");
    const r = runNodeChecker("ui-policy.mjs", ["--root", `${F}/violations`, "--rules", dir]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("bad.mjs");
  });
});
