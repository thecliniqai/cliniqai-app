/**
 * PWA spec 11 (PWA_STRATEGY §4 D-5, §9.1; V2-06 06-05, ruling R-19; T-06-06): the enforced `signout-guard` UI-policy
 * rule (scripts/ci/ui-policy/rules/signout-guard.mjs). Every fixture bypass of `hardSignOut()` is reported with
 * file:line and fails the run (exit 1); only the files on the rule's explicit list pass (the helper, the server route,
 * and `features/auth/service.ts` while it imports "server-only"); the repository itself has 0 findings. Before 06-05
 * there was no rule, so nothing was reported. 06-09a (M-GUARD): 06-05's rule exempted every directive-less file under
 * features/auth/ and missed computed names, `Reflect.get` and direct GoTrue logout calls; the fixtures marked 06-09a
 * below are not reported by the 06-05 rule (evidence/06-09a/signout-guard-before-after.txt).
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
        // 06-09a: a directive-less browser module under features/auth/ (the 06-05 password-flows.ts bypass)
        "features/auth/password-flows.ts:4 client.auth.signOut",
        // 06-09a: computed names
        'components/computed-access.tsx:9 auth["signOut"]', // auth[`sign${"Out"}`]
        'components/computed-access.tsx:14 auth["signOut"]', // auth["sign" + "Out"]
        "components/computed-access.tsx:19 Reflect.get(auth, …)", // Reflect.get(auth, "signOut")
        "components/computed-access.tsx:25 client.auth[<computed>]", // a key the rule cannot see
        "components/computed-access.tsx:26 Reflect.get(client.auth, …)",
        'components/computed-access.tsx:31 "signOut" string', // the name kept in a variable
        // 06-09a: direct calls to GoTrue's logout endpoint
        "lib/raw-logout.ts:3 GoTrue logout URL (/auth/v1/logout)",
        "lib/raw-logout.ts:7 GoTrue logout URL (/auth/v1/logout)",
      ].sort(),
    );
    expect(r.stderr).toContain("FAIL signout-guard components/menu.tsx:6 createClient().auth.signOut");
    expect(r.stdout).toContain("ui-policy: FAIL (15 enforced finding(s))");
  });

  it("allows only the files on the explicit list; names containing the word and other auth methods pass", () => {
    const findings = scan(ROOT).findings;
    const files = findings.map((f) => f.file);
    for (const allowed of ["lib/auth/hard-sign-out.ts", "app/auth/signout/route.ts", "features/auth/service.ts"]) {
      expect(files).not.toContain(allowed);
    }
    // menu.tsx's hardSignOutLabel/signOutScope (line 25-26) are identifiers, not a signOut access.
    expect(findings.filter((f) => f.file === "components/menu.tsx" && f.line > 21)).toEqual([]);
    // computed-access.tsx's auth["getSession"] / Reflect.get(auth, "getUser") (lines 37-38) are not sign-outs.
    expect(findings.filter((f) => f.file === "components/computed-access.tsx" && f.line > 33)).toEqual([]);
  });

  it("features/auth/service.ts is exempt only while it imports server-only (06-09a)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "signout-guard-server-only-"));
    fs.mkdirSync(path.join(root, "features/auth"), { recursive: true });
    const withGuard = fs.readFileSync(path.join(ROOT, "features/auth/service.ts"), "utf8");
    expect(withGuard).toMatch(/^import "server-only";$/m);
    fs.writeFileSync(path.join(root, "features/auth/service.ts"), withGuard.replace(/^import "server-only";\n/m, ""));
    const r = scan(root);
    expect(r.status).toBe(1);
    expect(r.findings.map((f) => `${f.file}:${f.line} ${f.detail}`)).toEqual([
      'features/auth/service.ts:1 exempt as server-side password changes only with import "server-only"',
    ]);
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
