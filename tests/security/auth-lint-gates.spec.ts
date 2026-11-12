/**
 * AUTH-01 lint gates (01-06): proves the `no-restricted-syntax` rules in eslint.config.mjs fire, by running ESLint
 * itself on the fixtures in lint-fixtures/auth-01/ (ignored by the normal `npx eslint .` run).
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const ROOT = path.resolve(__dirname, "../..");
const FIXTURES = path.join(ROOT, "lint-fixtures/auth-01");

async function auth01Messages(fixture: string) {
  const eslint = new ESLint({ cwd: ROOT, ignore: false });
  const [result] = await eslint.lintFiles([path.join(FIXTURES, fixture)]);
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax" && m.message.startsWith("AUTH-01:"));
}

describe("AUTH-01 lint gates", () => {
  it.each([
    ["otp-create-user.ts", "OTP sign-in with user creation"],
    ["wire-create-user.ts", "the wire-level create_user flag"],
    ["generate-link.ts", "admin generateLink (computed access)"],
    ["destructured-otp.ts", "destructured ID-token sign-in"],
    ["dev-otp.ts", "a dev OTP shortcut"],
  ])("fails lint on %s (%s)", async (fixture) => {
    const messages = await auth01Messages(fixture);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((m) => m.severity === 2)).toBe(true);
  }, 60_000);

  it("allows password sign-in and the recovery-code verification", async () => {
    expect(await auth01Messages("allowed.ts")).toEqual([]);
  }, 60_000);
});
