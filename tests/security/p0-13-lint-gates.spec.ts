/**
 * P0-13 lint gates (V2-02 02-06, IR-F3/AR-M2c): proves the `no-restricted-syntax` rules in eslint.config.mjs reject the
 * two server entry points the guard inventory cannot see, by running ESLint itself:
 *   - a function-level (inline) `"use server"` action (lint-fixtures/inventory/inline/page.tsx, also the inventory
 *     gate's fixture);
 *   - a route handler named `route.{js,jsx,tsx,mjs,cjs}` under app/ (linted as text at that path, so the test follows
 *     the real `files` glob).
 * A module-level `"use server"` file and an `app/** /route.ts` handler stay clean.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const ROOT = path.resolve(__dirname, "../..");
const ROUTE_SOURCE = "export async function GET() {\n  return new Response(\"fixture\");\n}\n";

function p013(messages: ESLint.LintResult["messages"]) {
  return messages.filter((m) => m.ruleId === "no-restricted-syntax" && m.message.startsWith("P0-13:"));
}

async function lintAt(code: string, relPath: string) {
  const eslint = new ESLint({ cwd: ROOT, ignore: false });
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, relPath) });
  return p013(result.messages);
}

describe("P0-13 lint gates", () => {
  it("fails lint on an inline \"use server\" action", async () => {
    const eslint = new ESLint({ cwd: ROOT, ignore: false });
    const [result] = await eslint.lintFiles([path.join(ROOT, "lint-fixtures/inventory/inline/page.tsx")]);
    const messages = p013(result.messages);
    expect(messages.map((m) => [m.line, m.severity])).toEqual([[6, 2]]);
    expect(messages[0].message).toContain("inline \"use server\"");
  }, 60_000);

  it.each(["route.js", "route.jsx", "route.tsx", "route.mjs", "route.cjs"])("fails lint on app/**/%s", async (name) => {
    const messages = await lintAt(ROUTE_SOURCE, `app/api/p0-13-fixture/${name}`);
    expect(messages.length).toBe(1);
    expect(messages[0].severity).toBe(2);
    expect(messages[0].message).toContain("route handlers must be named route.ts");
  }, 60_000);

  it("allows app/**/route.ts and a module-level \"use server\" module", async () => {
    expect(await lintAt(ROUTE_SOURCE, "app/api/p0-13-fixture/route.ts")).toEqual([]);
    const moduleLevel = fs.readFileSync(path.join(ROOT, "lint-fixtures/inventory/clean/actions.ts"), "utf8");
    expect(await lintAt(moduleLevel, "features/p0-13-fixture/actions.ts")).toEqual([]);
  }, 60_000);
});
