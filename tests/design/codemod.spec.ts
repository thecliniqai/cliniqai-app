/**
 * The v1 colour codemod (V2-06 06-01a step 4; scripts/design/codemod-colors.mjs + color-map.json). Runs the script as
 * a child process on a temp copy of lint-fixtures/ui-policy/codemod/ and asserts the rewritten source, the report and
 * idempotence.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROOT, runChecker } from "../ci/run-checker";

const SCRIPT = path.join(ROOT, "scripts/design/codemod-colors.mjs");
const FIXTURE = path.join(ROOT, "lint-fixtures/ui-policy/codemod");
let dir: string;
let first: ReturnType<typeof runChecker>;
let report: {
  totals: { replacements: number; byRule: Record<string, number> };
  unmapped: Array<{ file: string; line: number; token: string; reason: string }>;
  outOfScope: Array<{ file: string; reason: string }>;
  collapses: Array<{ semantic: string; sources: Record<string, number> }>;
};
const read = (rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codemod-"));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  first = runChecker(process.execPath, [SCRIPT, "--root", dir, "--report", path.join(dir, "report.json")]);
  report = JSON.parse(read("report.json"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("codemod-colors", () => {
  it("maps hex classes by property, case-insensitively, keeping variants, opacity and important", () => {
    expect(first.status).toBe(0);
    const out = read("components/sample.tsx");
    expect(out).toContain('"hover:bg-accent-hover/80 text-accent border-accent"');
    expect(out).toContain("!bg-accent-subtle");
    expect(out).toContain("md:hover:text-accent-hover");
    expect(out).not.toMatch(/\[#1769e0\]|\[#155cc0\]|\[#eaf2ff\]/i);
  });

  it("maps a focus ring to `ring` and a selection ring to `accent`", () => {
    const out = read("components/sample.tsx");
    expect(out).toContain("focus-visible:ring-ring ring-2 ring-accent/20");
  });

  it("maps the deleted brand scale and text-gray-400 to semantics", () => {
    const out = read("components/sample.tsx");
    expect(out).toContain('"bg-accent text-accent-fg"');
    expect(out).toContain('"text-fg-subtle placeholder:text-fg-placeholder"');
    expect(report.totals.byRule).toEqual({ hex: 8, brand: 2, gray400: 2 });
  });

  it("rewrites template-literal text and leaves an unmapped hex in place, listed with its line", () => {
    const out = read("components/sample.tsx");
    expect(out).toContain("`text-[#123456] ${on ? \"bg-canvas\" : \"\"}`");
    expect(report.unmapped).toContainEqual(
      expect.objectContaining({ file: "components/sample.tsx", line: 13, token: "text-[#123456]", reason: "no table entry" }),
    );
    expect(report.unmapped).toContainEqual(
      expect.objectContaining({ token: "hover:bg-[#912018]", reason: expect.stringContaining("Button primitive") }),
    );
  });

  it("skips a react-pdf document with its reason", () => {
    expect(read("features/billing/pdf/doc.tsx")).toBe(fs.readFileSync(path.join(FIXTURE, "features/billing/pdf/doc.tsx"), "utf8"));
    expect(report.outOfScope).toEqual([
      expect.objectContaining({ file: "features/billing/pdf/doc.tsx", reason: expect.stringContaining("react-pdf") }),
    ]);
  });

  it("lists every semantic fed by more than one v1 colour (collapse)", () => {
    expect(report.collapses).toContainEqual({ semantic: "accent-hover", sources: { "#155cc0": 1, "#0f5ab8": 1 } });
  });

  it("is idempotent: a second run changes nothing", () => {
    const before = read("components/sample.tsx");
    const again = runChecker(process.execPath, [SCRIPT, "--root", dir, "--dry-run"]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("0 replacement(s) in 0 file(s)");
    expect(read("components/sample.tsx")).toBe(before);
  });
});
