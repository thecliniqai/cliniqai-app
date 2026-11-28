/**
 * V2-10 10-01 (D-6; ADR-016): `lib/fy`, the Indian financial year (April-March, `2026-27`). One case table
 * (tests/fixtures/fy-cases.json) is passed by the app twin here, by the database's `private.indian_fy` (read through
 * the local superuser), and is embedded verbatim in supabase/tests/database/billing_invariants.test.sql, which runs it
 * through `private.next_invoice_number` in an Asia/Kolkata and an America/New_York clinic. Synthetic values only.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fyBounds, indianFy, indianFyAt, isFy } from "@/lib/fy";
import { psql } from "../helpers/sql";

interface FyCases {
  dates: Array<{ date: string; fy: string }>;
  instants: Array<{ at: string; tz: string; fy: string; label: string }>;
}

const ROOT = path.resolve(__dirname, "../..");
const CASES_FILE = path.join(ROOT, "tests/fixtures/fy-cases.json");
const PGTAP_FILE = path.join(ROOT, "supabase/tests/database/billing_invariants.test.sql");
const CASES = JSON.parse(fs.readFileSync(CASES_FILE, "utf8")) as FyCases;

const SAFE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SAFE_TZ = /^[A-Za-z_]+\/[A-Za-z_]+$/;

describe("lib/fy against the shared case table", () => {
  it("has the boundary cases the plan names (31 Mar 23:59 and 1 Apr 00:00 in IST and in a non-IST clinic)", () => {
    expect(CASES.dates).toHaveLength(11);
    expect(CASES.instants.map((i) => `${i.tz} ${i.fy}`)).toEqual([
      "Asia/Kolkata 2026-27",
      "Asia/Kolkata 2027-28",
      "America/New_York 2026-27",
      "America/New_York 2027-28",
      "America/New_York 2026-27",
    ]);
  });

  it.each(CASES.dates)("indianFy($date) = $fy", ({ date, fy }) => {
    expect(indianFy(date)).toBe(fy);
    const { startYmd, endYmd } = fyBounds(fy);
    expect(startYmd <= date && date <= endYmd).toBe(true);
  });

  it.each(CASES.instants)("indianFyAt: $label → $fy", ({ at, tz, fy }) => {
    expect(indianFyAt(at, tz)).toBe(fy);
  });

  it("the database's private.indian_fy gives the same answer for every case", () => {
    const rows = [
      ...CASES.dates.map((c) => {
        if (!SAFE_DATE.test(c.date)) throw new Error("unsafe case");
        return `('${c.date}'::date)`;
      }),
      ...CASES.instants.map((c) => {
        if (!SAFE_AT.test(c.at) || !SAFE_TZ.test(c.tz)) throw new Error("unsafe case");
        return `(('${c.at}'::timestamptz at time zone '${c.tz}')::date)`;
      }),
    ];
    const sql = `select private.indian_fy(d) from (values ${rows.join(", ")}) v(d)`;
    expect(psql(sql)).toEqual([...CASES.dates.map((c) => c.fy), ...CASES.instants.map((c) => c.fy)]);
  });

  it("billing_invariants.test.sql embeds exactly this case table (the pgTAP twin cannot drift)", () => {
    const sql = fs.readFileSync(PGTAP_FILE, "utf8");
    const m = /-- fy-cases:begin\n\$json\$([\s\S]*?)\$json\$\n-- fy-cases:end/.exec(sql);
    expect(m, "fy-cases markers").not.toBeNull();
    expect(JSON.parse(m![1])).toEqual(CASES);
  });
});

describe("lib/fy edges", () => {
  it("an unusable clinic zone reads as Asia/Kolkata, as the database's tenant_local_date does", () => {
    expect(indianFyAt("2027-03-31T18:30:00Z", "Not/AZone")).toBe("2027-28");
    expect(indianFyAt("2027-03-31T18:30:00Z", null)).toBe("2027-28");
  });

  it("refuses a malformed date or FY label", () => {
    expect(() => indianFy("2027-02-30")).toThrow(RangeError);
    expect(() => indianFy("31/03/2027")).toThrow(RangeError);
    expect(() => fyBounds("2026-28")).toThrow(RangeError);
    expect([isFy("2026-27"), isFy("1999-00"), isFy("2026-2027"), isFy("2026-28"), isFy(2026)]).toEqual([true, true, false, false, false]);
  });

  it("fyBounds runs 1 April to 31 March", () => {
    expect(fyBounds("2026-27")).toEqual({ startYmd: "2026-04-01", endYmd: "2027-03-31" });
    expect(fyBounds("2099-00")).toEqual({ startYmd: "2099-04-01", endYmd: "2100-03-31" });
  });
});
