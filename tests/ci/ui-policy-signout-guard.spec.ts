/**
 * PWA spec 11 (PWA_STRATEGY §4 D-5, §9.1; V2-06 06-05, ruling R-19; T-06-06): the enforced `signout-guard` UI-policy
 * rule (scripts/ci/ui-policy/rules/signout-guard.mjs). Every fixture bypass of `hardSignOut()` is reported with
 * file:line and fails the run (exit 1); the helper, the server route and server files under features/auth/ pass; the
 * repository itself has 0 findings. Before 06-05 there was no rule, so nothing was reported.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

const ROOT = "lint-fixtures/ui-policy/signout-guard";
const NO_BASELINE = "lint-fixtures/ui-policy/no-baseline.json";

interface Finding {
  rule: string;
  file: string;
  line: number;
  detail: string;
}

function scan(root: string) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "signout-guard-")), "report.json");
  const r = runNodeChecker("ui-policy.mjs", ["--root", root, "--baseline", NO_BASELINE, "--json", out]);
  const findings = (JSON.parse(fs.readFileSync(out, "utf8")).findings as Finding[]).filter((f) => f.rule === "signout-guard");
  return { ...r, findings };
}

describe("signout-guard (enforced)", () => {
  it("reports every bypass with file:line and fails the run", () => {
    const r = scan(ROOT);
    expect(r.status).toBe(1);
    expect(r.findings.map((f) => `${f.file}:${f.line} ${f.detail}`).sort()).toEqual(
      [
        "components/menu.tsx:6 createClient().auth.signOut", // a client component calling it
        "components/menu.tsx:11 auth.signOut", // a destructured `auth`
        'components/menu.tsx:16 client.auth["signOut"]', // element access
        "components/menu.tsx:20 { signOut } destructured", // destructured method
        "features/auth/client-helper.tsx:7 createClient().auth.signOut", // "use client" under features/auth/
        "lib/hooks/use-session.ts:3 client.auth.signOut", // a non-client file outside the allowed places
      ].sort(),
    );
    expect(r.stderr).toContain("FAIL signout-guard components/menu.tsx:6 createClient().auth.signOut");
    expect(r.stdout).toContain("ui-policy: FAIL (6 enforced finding(s))");
  });

  it("allows the helper, the server route and server files under features/auth/; names containing the word pass", () => {
    const files = scan(ROOT).findings.map((f) => f.file);
    for (const allowed of ["lib/auth/hard-sign-out.ts", "app/auth/signout/route.ts", "features/auth/service.ts"]) {
      expect(files).not.toContain(allowed);
    }
    // menu.tsx's hardSignOutLabel/signOutScope (line 25-26) are identifiers, not a signOut access.
    expect(scan(ROOT).findings.filter((f) => f.file === "components/menu.tsx" && f.line > 21)).toEqual([]);
  });

  it("the repository has 0 findings (the user menu goes through hardSignOut)", () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "signout-guard-repo-")), "report.json");
    const r = runNodeChecker("ui-policy.mjs", ["--json", out]);
    const report = JSON.parse(fs.readFileSync(out, "utf8")) as { findings: Finding[]; rules: Array<{ id: string; mode: string }> };
    expect(report.rules.find((rule) => rule.id === "signout-guard")?.mode).toBe("enforce");
    expect(report.findings.filter((f) => f.rule === "signout-guard")).toEqual([]);
    expect(r.stdout).toContain("ui-policy: signout-guard [enforce] 0 finding(s)");
  });
});
