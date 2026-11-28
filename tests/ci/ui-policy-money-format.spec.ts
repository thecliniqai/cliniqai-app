/**
 * V2-10 10-01 (D-1; DESIGN_SYSTEM §7.7): the enforced `money-format` UI-policy rule
 * (scripts/ci/ui-policy/rules/money-format.mjs). Hand-built rupee text (`toLocaleString("en-IN")` on an amount,
 * `"₹" + x`, `` `₹${x}` ``, `₹{x}` in JSX) is reported with file:line and fails the run; dates, fixed messages, a lone
 * "₹" heading and lib/money itself pass (the legacy exemptions ended in 10-02); the repository has 0 findings.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

const ROOT = "lint-fixtures/ui-policy/money-format";
const NO_BASELINE = "lint-fixtures/ui-policy/no-baseline.json";

interface Finding {
  rule: string;
  file: string;
  line: number;
  detail: string;
}

function scan(root?: string) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "money-format-")), "report.json");
  const args = root ? ["--root", root, "--baseline", NO_BASELINE, "--json", out] : ["--json", out];
  const r = runNodeChecker("ui-policy.mjs", args);
  const findings = (JSON.parse(fs.readFileSync(out, "utf8")).findings as Finding[]).filter((f) => f.rule === "money-format");
  return { ...r, findings };
}

describe("money-format (enforced)", () => {
  it("reports every hand-built amount with file:line and fails the run", () => {
    const r = scan(ROOT);
    expect(r.status).toBe(1);
    expect(r.findings.map((f) => `${f.file}:${f.line} ${f.detail}`).sort()).toEqual(
      [
        'components/amounts.tsx:6 toLocaleString("en-IN") on an amount',
        'components/amounts.tsx:7 "₹" + amount',
        "components/amounts.tsx:8 `₹${amount}`",
        "components/amounts.tsx:9 ₹{amount} in JSX",
        "components/amounts.tsx:10 ₹{amount} in JSX",
        'components/amounts.tsx:12 toLocaleString("en-IN") on an amount', // the locale in any case
        "features/checkout-copy.tsx:2 ₹{amount} in JSX", // an exempt name in another folder is not exempt
        "components/queue/checkout-drawer.tsx:2 ₹{amount} in JSX", // 10-02: the drawer is no longer exempt (the list is empty)
      ].sort(),
    );
    expect(r.stderr).toContain('FAIL money-format components/amounts.tsx:7 "₹" + amount');
  });

  it("dates, fixed messages, a lone ₹ and lib/money are not findings", () => {
    const findings = scan(ROOT).findings;
    // amounts.tsx:11 new Date(at).toLocaleString, :13 date options, :14-16 labels and messages, :17 two literals, :18 no ₹.
    expect(findings.filter((f) => f.file === "components/amounts.tsx" && [1, 3, 11, 13, 14, 15, 16, 17, 18].includes(f.line))).toEqual([]);
    expect(findings.map((f) => f.file)).not.toContain("lib/money/format.ts");
  });

  it("the repository has no finding (every rupee amount goes through lib/money)", () => {
    const r = scan();
    expect(r.findings).toEqual([]);
    expect(r.stdout).toContain("ui-policy: money-format [enforce] 0 finding(s)");
  });
});
