/**
 * React Compiler rules back at "error" (V2-06 06-08, R-30; 03-06 carry-over). Proves, with ESLint itself:
 *   - the three rules are errors for app code that has no waiver (fixtures at virtual app paths);
 *   - a waiver downgrades exactly its own rule in exactly its own file, and an expired waiver is no longer applied;
 *   - an inline directive cannot switch a compiler rule off;
 *   - the real register is valid: in its time box, at most 90 days, and neither stale nor miscounted (the sites are
 *     measured with the rule at "error");
 *   - the register checker rejects expired, over-90-day, stale, miscounted and ownerless entries.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import {
  RULES,
  measure,
  readRegister,
  todayUtc,
  waiverProblems,
} from "../../scripts/ci/react-compiler-waivers.mjs";

const ROOT = path.resolve(__dirname, "../..");
const FIXTURES = path.join(ROOT, "lint-fixtures/react-compiler");
const exists = (f: string) => fs.existsSync(path.join(ROOT, f));

type Waiver = { file: string; rule: string; sites: number; owner: string; added: string; expires: string; reason: string };
const waivers = readRegister() as Waiver[];

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT, ignore: false });
});

async function lintFixture(fixture: string, relPath: string): Promise<ESLint.LintResult["messages"]> {
  const code = fs.readFileSync(path.join(FIXTURES, fixture), "utf8");
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, relPath) });
  return result.messages;
}

const severityOf = (messages: ESLint.LintResult["messages"], ruleId: string) =>
  messages.filter((m) => m.ruleId === ruleId).map((m) => [m.line, m.severity]);

describe("React Compiler rules at error (R-30)", () => {
  it.each([
    ["set-state-in-effect.tsx", "react-hooks/set-state-in-effect", 8],
    ["purity.tsx", "react-hooks/purity", 4],
    ["immutability.tsx", "react-hooks/immutability", 9],
  ])("%s fails lint at error in an unwaived app file", async (fixture, ruleId, line) => {
    for (const at of ["components/fixture/sample.tsx", "app/(dashboard)/fixture/page.tsx", "features/fixture/view.tsx"]) {
      expect(severityOf(await lintFixture(fixture, at), ruleId)).toEqual([[line, 2]]);
    }
  });

  it("a waiver downgrades only its own rule in its own file to warn", async () => {
    const waived = waivers.find((w) => w.rule === "set-state-in-effect" && w.file.startsWith("app/("));
    expect(waived, "the register has a waiver under an app route group (glob escaping)").toBeDefined();
    const file = waived!.file;
    expect(severityOf(await lintFixture("set-state-in-effect.tsx", file), "react-hooks/set-state-in-effect")).toEqual([[8, 1]]);
    // The other compiler rules stay errors in the same file.
    expect(severityOf(await lintFixture("purity.tsx", file), "react-hooks/purity")).toEqual([[4, 2]]);
    expect(severityOf(await lintFixture("immutability.tsx", file), "react-hooks/immutability")).toEqual([[9, 2]]);
    // A sibling path is not covered by the waiver.
    const sibling = path.posix.join(path.posix.dirname(file), "sibling.tsx");
    expect(severityOf(await lintFixture("set-state-in-effect.tsx", sibling), "react-hooks/set-state-in-effect")).toEqual([[8, 2]]);
  });

  it("an expired waiver is no longer applied (the file fails lint again)", async () => {
    // A copy of the config whose register holds one expired entry for a virtual file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-waivers-"));
    fs.mkdirSync(path.join(dir, "scripts/ci"), { recursive: true });
    fs.copyFileSync(path.join(ROOT, "eslint.config.mjs"), path.join(dir, "eslint.config.mjs"));
    const entry = (file: string, expires: string) => ({ file, rule: "set-state-in-effect", sites: 1, owner: "V2-08", added: "2026-01-01", expires, reason: "fixture entry for the expiry test" });
    fs.writeFileSync(
      path.join(dir, "scripts/ci/react-compiler-waivers.json"),
      JSON.stringify({ waivers: [entry("components/expired.tsx", "2026-02-01"), entry("components/live.tsx", "2999-12-31")] }),
    );
    fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");
    const copy = new ESLint({ cwd: dir, ignore: false });
    const code = fs.readFileSync(path.join(FIXTURES, "set-state-in-effect.tsx"), "utf8");
    const lint = async (file: string) => (await copy.lintText(code, { filePath: path.join(dir, file) }))[0].messages;
    expect(severityOf(await lint("components/expired.tsx"), "react-hooks/set-state-in-effect")).toEqual([[8, 2]]);
    expect(severityOf(await lint("components/live.tsx"), "react-hooks/set-state-in-effect")).toEqual([[8, 1]]);
  });

  it("an inline directive naming a compiler rule fails lint (waivers go through the register only)", async () => {
    const messages = await lintFixture("inline-directive.tsx", "components/fixture/quiet.tsx");
    expect(severityOf(messages, "clinicos/no-compiler-rule-directive")).toEqual([[8, 2]]);
  });
});

describe("React Compiler waiver register", () => {
  it("the real register is in its time box, at most 90 days, and neither stale nor miscounted", async () => {
    const counts = await measure([...new Set(waivers.map((w) => w.file))]);
    expect(waiverProblems(waivers, { today: todayUtc(), counts, exists })).toEqual([]);
    for (const w of waivers) expect(RULES).toContain(w.rule);
  });

  const base = { file: "components/a.tsx", rule: "set-state-in-effect", sites: 2, owner: "V2-08", added: "2026-11-15", expires: "2027-02-13", reason: "rebuilt by the owner phase; fixture" };
  const check = (entries: object[], found = 2, today = "2026-11-20") =>
    waiverProblems(entries, { today, counts: new Map([["components/a.tsx#set-state-in-effect", found]]), exists: () => true });

  it("accepts a valid entry", () => {
    expect(check([base])).toEqual([]);
  });

  it.each([
    ["expired", [base], 2, "2027-02-14", "expired on 2027-02-13"],
    ["over 90 days", [{ ...base, expires: "2027-02-14" }], 2, "2026-11-20", "more than 90 days after 2026-11-15"],
    ["added in the future", [{ ...base, added: "2026-12-01", expires: "2027-01-01" }], 2, "2026-11-20", "is in the future"],
    ["stale", [base], 0, "2026-11-20", "stale, no set-state-in-effect finding left"],
    ["a fixed site", [base], 1, "2026-11-20", "1 finding(s), the entry says 2"],
    ["a new site", [base], 3, "2026-11-20", "3 finding(s), the entry allows 2"],
    ["no owner phase", [{ ...base, owner: "later" }], 2, "2026-11-20", "owner must name a phase"],
    ["an unknown rule", [{ ...base, rule: "rules-of-hooks" }], 2, "2026-11-20", "rule must be one of"],
    ["a duplicate", [base, base], 2, "2026-11-20", "listed twice"],
  ])("rejects %s", (_name, entries, found, today, problem) => {
    expect(check(entries, found, today).join("\n")).toContain(problem);
  });
});
