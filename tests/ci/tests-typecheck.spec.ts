/**
 * Test type-checking (V2-02 02-04, RL-13; `static` job runs `npm run typecheck` = both configs).
 *
 * Proves there is no exclusion gap: every file under tests/ is part of `tsconfig.tests.json`, a deliberately
 * mistyped spec fails type-checking under that config, and the app config `tsconfig.json` (what `next build`
 * checks) still leaves tests out. Uses the TypeScript compiler API on the repo's own configs; probe files are written
 * to a throwaway temp directory.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ROOT } from "./run-checker";

function parseConfig(file: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, file), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  });
  if (!parsed) throw new Error(`could not parse ${file}`);
  if (parsed.errors.length) {
    throw new Error(parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("\n"));
  }
  return parsed;
}

function listTestSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTestSources(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const norm = (p: string) => path.resolve(p);

function diagnosticsFor(source: string, options: ts.CompilerOptions): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tests-typecheck-"));
  const file = path.join(dir, "probe.spec.ts");
  fs.writeFileSync(file, source);
  const program = ts.createProgram({ rootNames: [file], options });
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}

describe("test type-checking (RL-13)", () => {
  const testsConfig = parseConfig("tsconfig.tests.json");

  it("includes every TypeScript file under tests/ and the test runner configs", () => {
    const included = new Set(testsConfig.fileNames.map(norm));
    const expected = [
      ...listTestSources(path.join(ROOT, "tests")),
      path.join(ROOT, "vitest.config.ts"),
      path.join(ROOT, "playwright.config.ts"),
    ].map(norm);

    expect(expected.length).toBeGreaterThan(50);
    expect(expected.filter((f) => !included.has(f))).toEqual([]);
  });

  it("fails a deliberately mistyped spec and passes a well-typed one using the Vitest globals", () => {
    const bad = diagnosticsFor(
      `describe("probe", () => { it("x", () => { const n: number = "not a number"; expect(n).toBe(1); }); });\nexport {};\n`,
      testsConfig.options
    );
    expect(bad).toEqual([expect.stringMatching(/^TS2322: Type 'string' is not assignable to type 'number'/)]);

    const good = diagnosticsFor(
      `describe("probe", () => { afterAll(() => {}); it("x", () => { expect(1).toBe(1); }); });\nexport {};\n`,
      testsConfig.options
    );
    expect(good).toEqual([]);
  });

  it("keeps tests out of the app config that `next build` type-checks", () => {
    const appConfig = parseConfig("tsconfig.json");
    const testsDir = norm(path.join(ROOT, "tests")) + path.sep;
    expect(appConfig.fileNames.map(norm).filter((f) => f.startsWith(testsDir))).toEqual([]);
  });
});
