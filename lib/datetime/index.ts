/**
 * Clinic-day dates (V2-03 03-05, P1-21, ADR-016). Isomorphic: no `server-only`, no environment, no browser zone.
 *
 * A clinic's "today", its day boundaries and any date derived from an instant are computed in the tenant's IANA
 * zone (`tenants.timezone`, default {@link DEFAULT_CLINIC_TZ}), never in UTC and never in the zone of the process or
 * the browser. Server code resolves the zone through `getTenantTimeZone()` (`lib/datetime/server.ts`); client
 * components receive it as a `timeZone` prop from their server parent.
 *
 * Dates are calendar strings `YYYY-MM-DD` ("ymd"). Day windows are half-open: `[startIso, endIsoExclusive)`, so a
 * query uses `.gte(start).lt(endExclusive)` and no `23:59:59.999` literal is needed. Display formatting stays with
 * `Intl.DateTimeFormat` (DESIGN_SYSTEM) and must pass `timeZone`.
 */
import { TZDate } from "@date-fns/tz";

/** The zone every tenant has by default (`tenants.timezone` default) and the fallback for an unusable value. */
export const DEFAULT_CLINIC_TZ = "Asia/Kolkata";

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type WeekdayName = (typeof WEEKDAYS)[number];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatYmd(year: number, month1: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month1)}-${pad2(day)}`;
}

function parseYmd(ymd: string): { y: number; m: number; d: number } {
  if (!isYmd(ymd)) throw new RangeError("Expected a calendar date in YYYY-MM-DD form");
  const [, y, m, d] = YMD_RE.exec(ymd)!;
  return { y: Number(y), m: Number(m), d: Number(d) };
}

/** True when `value` is a real calendar date in `YYYY-MM-DD` form (`2026-02-30` is not). */
export function isYmd(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = YMD_RE.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

/** True when `tz` is an IANA zone (or offset) the runtime can compute with. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The tenant's zone if it is usable, otherwise {@link DEFAULT_CLINIC_TZ}. */
export function resolveTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_CLINIC_TZ;
}

function toInstant(instant: Date | string | number): number {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === "number" ? instant : Date.parse(instant);
  if (Number.isNaN(ms)) throw new RangeError("Invalid instant");
  return ms;
}

/** The calendar date of `instant` in zone `tz` (a timestamp from the database, a `Date`, or epoch ms). */
export function ymdOf(instant: Date | string | number, tz: string): string {
  const zoned = new TZDate(toInstant(instant), tz);
  return formatYmd(zoned.getFullYear(), zoned.getMonth() + 1, zoned.getDate());
}

/** The clinic's current date in zone `tz`. `now` is injectable for tests; it defaults to the current instant. */
export function todayInTz(tz: string, now: Date | number = Date.now()): string {
  return ymdOf(now, tz);
}

/** `ymd` moved by `n` calendar days (negative allowed). Pure calendar arithmetic: no zone is involved. */
export function addDaysYmd(ymd: string, n: number): string {
  const { y, m, d } = parseYmd(ymd);
  const moved = new Date(Date.UTC(y, m - 1, d + Math.trunc(n)));
  return formatYmd(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** The first day of the month that contains `ymd`. */
export function startOfMonthYmd(ymd: string): string {
  const { y, m } = parseYmd(ymd);
  return formatYmd(y, m, 1);
}

/** The `n` clinic dates after today (tomorrow first) in zone `tz`. */
export function nextNDays(tz: string, n: number, now: Date | number = Date.now()): string[] {
  const today = todayInTz(tz, now);
  return Array.from({ length: Math.max(0, Math.trunc(n)) }, (_, i) => addDaysYmd(today, i + 1));
}

/** The weekday of a calendar date (zone-free: a date has one weekday everywhere). */
export function weekdayOfYmd(ymd: string): WeekdayName {
  const { y, m, d } = parseYmd(ymd);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** The UTC instant (ISO string) of wall-clock time `hhmm` (`HH:mm` or `HH:mm:ss`) on date `ymd` in zone `tz`. */
export function zonedDateTimeToUtcIso(ymd: string, hhmm: string, tz: string): string {
  const { y, m, d } = parseYmd(ymd);
  const match = HHMM_RE.exec(hhmm);
  if (!match) throw new RangeError("Expected a wall-clock time in HH:mm or HH:mm:ss form");
  const zoned = new TZDate(y, m - 1, d, Number(match[1]), Number(match[2]), Number(match[3] ?? 0), tz);
  return new Date(zoned.getTime()).toISOString();
}

/**
 * The UTC instants that bound clinic date `ymd` in zone `tz`: `[startIso, endIsoExclusive)`. For Asia/Kolkata,
 * `2026-11-13` is `2026-11-12T18:30:00.000Z` to `2026-11-13T18:30:00.000Z`.
 */
export function dayWindowUtc(ymd: string, tz: string): { startIso: string; endIsoExclusive: string } {
  return rangeWindowUtc(ymd, ymd, tz);
}

/** The UTC instants that bound the clinic dates `startYmd`..`endYmd` (inclusive) in zone `tz`, half-open. */
export function rangeWindowUtc(
  startYmd: string,
  endYmd: string,
  tz: string
): { startIso: string; endIsoExclusive: string } {
  const start = parseYmd(startYmd);
  const end = parseYmd(addDaysYmd(endYmd, 1));
  const startZoned = new TZDate(start.y, start.m - 1, start.d, tz);
  const endZoned = new TZDate(end.y, end.m - 1, end.d, tz);
  return {
    startIso: new Date(startZoned.getTime()).toISOString(),
    endIsoExclusive: new Date(endZoned.getTime()).toISOString(),
  };
}

/** Whole years between `dobYmd` and `todayYmd` (both calendar dates); `null` for an unusable date of birth. */
export function ageInYears(dobYmd: string, todayYmd: string): number | null {
  if (!isYmd(dobYmd) || !isYmd(todayYmd)) return null;
  const dob = parseYmd(dobYmd);
  const today = parseYmd(todayYmd);
  let age = today.y - dob.y;
  if (today.m < dob.m || (today.m === dob.m && today.d < dob.d)) age--;
  return age >= 0 ? age : 0;
}
