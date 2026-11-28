/**
 * V2-14 14-02 (P2-06, SEC-20): values that reach a PostgREST `.or()` filter string. `isIsoDateParam` guards the
 * `/api/v1/visits` date filters (before: any text, e.g. `x,tenant_id.neq.0`, was interpolated); the Semgrep rule
 * `postgrest-or-interpolation` (semgrep/rules/) requires such a check at every interpolated `.or()`.
 */
import { describe, expect, it } from "vitest";
import { isIsoDateParam, isUuid } from "@/lib/utils/filter-values";

describe("isIsoDateParam", () => {
  it.each(["2026-11-28", "2026-11-28T09:30", "2026-11-28T09:30:00Z", "2026-11-28T09:30:00.000Z", "2026-11-28T09:30:00.123456+05:30", "2024-02-29"])(
    "accepts %s",
    (value) => expect(isIsoDateParam(value)).toBe(true),
  );

  it.each([
    "2026-11-28,tenant_id.neq.0",
    "2026-11-28)",
    "and(created_at.gte.2026-01-01)",
    "2026-13-01",
    "2026-02-30",
    "2025-02-29",
    "2026-11-28T25:00:00Z",
    "2026-11-28 09:30",
    "SENTINEL_NOT_A_DATE",
    "",
    " 2026-11-28",
  ])("refuses %j", (value) => expect(isIsoDateParam(value)).toBe(false));

  it("refuses non-strings", () => {
    for (const value of [null, undefined, 20261128, {}, ["2026-11-28"]]) expect(isIsoDateParam(value)).toBe(false);
  });
});

describe("isUuid (the receipt lookup's id, now checked inside compileReceiptPayload too)", () => {
  it("refuses filter syntax", () => {
    expect(isUuid("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("00000000-0000-4000-8000-000000000001,visit_id.neq.0")).toBe(false);
  });
});
