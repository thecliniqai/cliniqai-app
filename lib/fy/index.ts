/**
 * Indian financial year (V2-10 10-01, D-6; ADR-016): April to March, written `2026-27`. Twin of the database's
 * `private.indian_fy(date)` (migration 000140), which numbers invoices `INV/<fy>/<5 digits>`; both are checked against
 * one case table (tests/fixtures/fy-cases.json). The FY of an instant is read in the clinic's zone, never the process's.
 * SUB-05 (SaaS invoices, V2-13b) reuses this module.
 */
import { isYmd, resolveTimeZone, ymdOf } from "@/lib/datetime";

const FY_RE = /^(\d{4})-(\d{2})$/;

/** The FY of a clinic-local calendar date `YYYY-MM-DD`: 31 Mar 2027 → `2026-27`, 1 Apr 2027 → `2027-28`. */
export function indianFy(ymd: string): string {
  if (!isYmd(ymd)) throw new RangeError("Expected a calendar date in YYYY-MM-DD form");
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const start = month < 4 ? year - 1 : year;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The FY of `instant` in the clinic's zone `tz` (an unusable zone reads as Asia/Kolkata, as the database does). */
export function indianFyAt(instant: Date | string | number, tz: string | null | undefined): string {
  return indianFy(ymdOf(instant, resolveTimeZone(tz)));
}

/** True for a well-formed FY label whose second year follows the first (`2026-27`, `1999-00`). */
export function isFy(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = FY_RE.exec(value);
  if (!m) return false;
  return (Number(m[1]) + 1) % 100 === Number(m[2]);
}

/** First and last clinic-local day of an FY: `2026-27` → 2026-04-01 .. 2027-03-31. */
export function fyBounds(fy: string): { startYmd: string; endYmd: string } {
  if (!isFy(fy)) throw new RangeError("Expected an FY label such as 2026-27");
  const start = Number(fy.slice(0, 4));
  return { startYmd: `${start}-04-01`, endYmd: `${start + 1}-03-31` };
}
