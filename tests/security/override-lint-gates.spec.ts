/**
 * P0-01 lint gates (ADR-0005 Verification 3, plan 01-01d): proves the `no-restricted-syntax` rules in eslint.config.mjs
 * reject every banned acting-principal form on `"use server"` modules and in `features/** /schema.ts` input schemas,
 * by running ESLint itself on the fixtures in lint-fixtures/p0-01/ (ignored by the normal `npx eslint .` run).
 * Schema fixtures are linted as `features/<domain>/schema.ts`, so the test follows the real `files` glob.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const ROOT = path.resolve(__dirname, "../..");
const FIXTURES = path.join(ROOT, "lint-fixtures/p0-01");

function p001(messages: ESLint.LintResult["messages"]) {
  return messages.filter((m) => m.ruleId === "no-restricted-syntax" && m.message.startsWith("P0-01:"));
}

async function actionMessages(fixture: string) {
  const eslint = new ESLint({ cwd: ROOT, ignore: false });
  const [result] = await eslint.lintFiles([path.join(FIXTURES, fixture)]);
  return p001(result.messages);
}

async function schemaMessages(fixture: string) {
  const eslint = new ESLint({ cwd: ROOT, ignore: false });
  const code = fs.readFileSync(path.join(FIXTURES, fixture), "utf8");
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, "features/p0-01-fixture/schema.ts") });
  return p001(result.messages);
}

describe("P0-01 lint gates: \"use server\" exports", () => {
  it.each([
    ["client-override.ts", "a clientOverride parameter"],
    ["session-override.ts", "a sessionOverride parameter"],
    ["tenant-id-override.ts", "a tenantIdOverride parameter on an exported arrow function"],
    ["actor-session.ts", "an actorSession parameter"],
    ["session-param.ts", "a session parameter"],
    ["client-param.ts", "a client parameter"],
    ["acting-tenant-id.ts", "an acting tenantId parameter"],
    ["actor-id-default.ts", "a default-assigned actorId parameter"],
    ["rest-session.ts", "a rest parameter named session"],
    ["destructured-created-by.ts", "a destructured createdBy field"],
    ["destructured-recorded-by-default.ts", "a destructured recorded_by field with a default"],
    ["destructured-signed-by-string-key.ts", "a destructured string-keyed signed_by field"],
    ["inline-type-tenant-id.ts", "a tenantId field in an inline parameter type"],
    ["unexported-reexported.ts", "a top-level function exported through export { }"],
    ["default-export.ts", "a default-exported action"],
  ])("fails lint on %s (%s)", async (fixture) => {
    const messages = await actionMessages(fixture);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((m) => m.severity === 2)).toBe(true);
  }, 60_000);

  it("allows target ids and acting-principal names inside the action body", async () => {
    expect(await actionMessages("allowed.ts")).toEqual([]);
  }, 60_000);

  it("does not apply to modules without the \"use server\" directive", async () => {
    expect(await actionMessages("not-use-server.ts")).toEqual([]);
  }, 60_000);
});

describe("P0-01 lint gates: input schemas", () => {
  it("fails lint on every acting actor/tenant key, including nested, extend() and string keys", async () => {
    const messages = await schemaMessages("schema-banned.ts");
    expect(messages.map((m) => m.line).sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8]);
    expect(messages.every((m) => m.severity === 2)).toBe(true);
  }, 60_000);

  it("allows target_tenant_id, omit() and attribution on stored TypeScript types", async () => {
    expect(await schemaMessages("schema-allowed.ts")).toEqual([]);
  }, 60_000);
});
