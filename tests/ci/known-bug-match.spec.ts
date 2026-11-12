/**
 * Known-bug failure matching (V2-02 02-06, IR-F4): only the failure of a known bug's own marked correct-outcome
 * assertion counts as its expected failure (tests/e2e/support/known-bug.ts); any other error turns the test red.
 */
import { describe, expect, it } from "vitest";
import { firstLine, isKnownBugFailure, knownBugMessage } from "../e2e/support/known-bug-match";

describe("known-bug failure matching", () => {
  it("accepts the bug's own marked assertion failure", () => {
    const error = new Error(`${knownBugMessage("F-01", "the patient record opens")}\n\nexpect(page).toHaveURL(expected) failed`);
    expect(isKnownBugFailure("F-01", error)).toBe(true);
  });

  it("rejects an unmarked failure, a timeout and another bug's marker", () => {
    expect(isKnownBugFailure("F-01", new Error("locator.click: Timeout 15000ms exceeded."))).toBe(false);
    expect(isKnownBugFailure("F-01", new Error("expect(received).toHaveLength(expected)"))).toBe(false);
    expect(isKnownBugFailure("F-01", new Error(knownBugMessage("F-04", "one patient row")))).toBe(false);
    expect(isKnownBugFailure("F-01", "KNOWN-BUG F-0")).toBe(false);
  });

  it("reports the first non-empty line without colour codes", () => {
    expect(firstLine(new Error("\n\u001b[31mKNOWN-BUG F-04: one row\u001b[39m\nmore"))).toBe("KNOWN-BUG F-04: one row");
  });
});
