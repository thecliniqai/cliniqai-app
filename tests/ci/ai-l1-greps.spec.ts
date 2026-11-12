/**
 * AI-06 L1 policy checks (V2-02 02-01 step 5, RL-11): proves each rule of scripts/ci/ai-l1-greps.mjs fires on its
 * fixture tree (lint-fixtures/ai-l1/<case>/), stays silent on allowed copy, and that time-boxed exceptions work only
 * while valid (expired and stale entries fail; L1-R6 cannot be waived). Asserts the checker's exit code and output.
 */
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

const F = "lint-fixtures/ai-l1";
const TODAY = "2026-11-12";
const check = (fixture: string, allowlist = "none") =>
  runNodeChecker("ai-l1-greps.mjs", [
    "--root",
    `${F}/${fixture}`,
    "--allowlist",
    `${F}/allowlists/${allowlist}.json`,
    "--today",
    TODAY,
  ]);

describe("AI-06 L1 checks", () => {
  it.each([
    ["r1-ai-route", "L1-R1 app/api/ai/chat/route.ts"],
    ["r1-copilot-page", "L1-R1 app/(dashboard)/copilot/page.tsx"],
    ["r2-removed-surface", "L1-R2 components/drawer.tsx:2 CopilotDrawer"],
    ["r3-test-branch", "L1-R3 lib/ai/client.ts:2 VITEST"],
    ["r4-sparkle-icon", "L1-R4 components/badge.tsx:7 <Sparkles>"],
    ["r4-sparkle-alias", "L1-R4 components/badge.tsx:7 <Star>"],
    ["r4-glyph", "L1-R4 components/hint.tsx:3"],
    ["r5-ai-copy", "L1-R5 components/banner.tsx:3 AI insights"],
    ["r6-ai-price", "L1-R6 features/ai/upsell.tsx:6"],
  ])("fails on %s", (fixture, expected) => {
    const r = check(fixture);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`FAIL ${expected}`);
  });

  it("only the intended rule fires on the features/ai price fixture (AI alone is allowed there)", () => {
    const r = check("r6-ai-price");
    expect(r.stderr).not.toContain("L1-R5");
  });

  it("passes LLM-feature files, comments, identifiers and price copy without AI, given a valid time-boxed exception", () => {
    const r = check("allowed", "timeboxed");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("waived L1-R5 components/settings/integrations.tsx:3");
    expect(r.stdout).toContain("ai-l1: PASS");
  });

  it("the time-boxed exception is what makes that tree pass", () => {
    const r = check("allowed", "none");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAIL L1-R5 components/settings/integrations.tsx:3");
    expect(r.stderr).not.toContain("ai-scribe-modal");
    expect(r.stderr).not.toContain("notes.tsx");
    expect(r.stderr).not.toContain("features/ai/assist.tsx");
  });

  it("fails on an expired exception", () => {
    const r = check("allowed", "expired");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("exception EXPIRED on 2026-11-01");
  });

  it("fails on a stale exception that matches nothing", () => {
    const r = check("allowed", "stale");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("components/removed-long-ago.tsx: STALE exception");
  });

  it("refuses to waive L1-R6 (AI next to a price or purchase action)", () => {
    const r = check("r6-ai-price", "r6-waiver");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("L1-R6 (AI next to a price or purchase action) has no exceptions");
    expect(r.stderr).toContain("FAIL L1-R6 features/ai/upsell.tsx:6");
  });
});
