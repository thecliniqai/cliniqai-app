/**
 * V2-04 04-06 (FT-04, R-5, R-8; roadmap "a quota-threshold unit test"): `ops.quota_level(used, limit)` is the threshold
 * math every quota snapshot and alert uses: `ok` below 60 % of the limit, `upgrade_trigger` from exactly 60 %,
 * `critical` from exactly 70 %, `unknown` without a positive limit. Exact numeric comparison (no rounding): one byte
 * below a boundary stays below it.
 */
import { describe, expect, it } from "vitest";
import { psql } from "../helpers/sql";

const level = (used: string, limit: string) => psql(`select ops.quota_level(${used}, ${limit})`)[0];

describe("ops.quota_level: the 60 % / 70 % thresholds against the Free database limit (500 MB)", () => {
  it.each([
    ["0", "500000000", "ok"],
    ["299999999", "500000000", "ok"],
    ["300000000", "500000000", "upgrade_trigger"],
    ["349999999", "500000000", "upgrade_trigger"],
    ["350000000", "500000000", "critical"],
    ["499999999", "500000000", "critical"],
    ["600000000", "500000000", "critical"],
  ])("%s of %s bytes -> %s", (used, limit, expected) => {
    expect(level(used, limit)).toBe(expected);
  });

  it.each([
    ["29999", "50000", "ok"],
    ["30000", "50000", "upgrade_trigger"],
    ["35000", "50000", "critical"],
    ["599999999.9", "1000000000", "ok"],
    ["600000000", "1000000000", "upgrade_trigger"],
  ])("MAU / Storage boundaries: %s of %s -> %s", (used, limit, expected) => {
    expect(level(used, limit)).toBe(expected);
  });

  it.each([
    ["100", "0"],
    ["100", "-1"],
    ["100", "null"],
    ["null", "500000000"],
  ])("used %s with limit %s -> unknown", (used, limit) => {
    expect(level(used, limit)).toBe("unknown");
  });

  it("is IMMUTABLE with an empty search_path and executable by no API role", () => {
    const fn = "ops.quota_level(numeric,numeric)";
    expect(psql(`select provolatile::text || '|' || array_to_string(proconfig, ',') from pg_proc where oid = '${fn}'::regprocedure`)).toEqual([
      'i|search_path=""',
    ]);
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(psql(`select has_function_privilege('${role}', '${fn}', 'execute')`), role).toEqual(["f"]);
    }
  });

  it("the Free limits are seeded in decimal units and ops.settings names the plan", () => {
    expect(psql("select metric || '=' || limit_value from ops.quota_limits where plan = 'free' order by metric")).toEqual([
      "db_bytes=500000000",
      "mau=50000",
      "storage_bytes=1000000000",
    ]);
    expect(psql("select value from ops.settings where key = 'plan'")).toEqual(["free"]);
  });
});
