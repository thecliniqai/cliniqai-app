/**
 * Display and entry formats for clinic dates and times (V2-06 06-02c; DESIGN_SYSTEM §5 "Content conventions (India)",
 * §7.8). Isomorphic and zone-safe: a clinic date is a calendar string `YYYY-MM-DD` (`lib/datetime`), which has one
 * weekday and one name everywhere. Nothing here reads the browser's or the process's zone, and nothing cuts a UTC
 * `toISOString()`. Counts use `Intl.NumberFormat("en-IN")` (Indian digit grouping).
 *
 * - `formatClinicDate("2026-11-12")` → `12 Nov 2026`
 * - `formatClinicDateWithWeekday("2026-11-12")` → `Thu, 12 Nov 2026`
 * - `formatDayChip("2026-11-16")` → `Mon 16`
 * - `formatMonthYear("2026-11-12")` → `November 2026`
 * - `formatClinicTime("11:30")` → `11:30 am` (12-hour, lowercase, no leading zero)
 * - `formatDmy` / `parseDmy`: the `dd/mm/yyyy` entry form (never `mm/dd`)
 * - `formatCount(1240)` → `1,240`; Indian grouping `1,24,000`
 */
import { isYmd } from "./index";

/*
 * The names are the CLDR en-IN ones (what `Intl.DateTimeFormat("en-IN")` gives, "Sept" included), held as tables
 * rather than read from `Intl` at run time: ICU builds differ in the punctuation and spacing they put between parts
 * (Chrome's en-IN gave "Thu, 12 Nov, 2026" where Node gave "Thu, 12 Nov 2026"), and the server's and the browser's
 * output must be the same string or hydration breaks. A weekday comes from the calendar date itself (`getUTCDay` of
 * that UTC day), so no zone is involved.
 */
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function partsOf(ymd: string): { y: number; m: number; d: number; weekday: number } {
  if (!isYmd(ymd)) throw new RangeError("Expected a calendar date in YYYY-MM-DD form");
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

const COUNT = new Intl.NumberFormat("en-IN");

/** `12 Nov 2026`. */
export function formatClinicDate(ymd: string): string {
  const p = partsOf(ymd);
  return `${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}`;
}

/** `Thu, 12 Nov 2026`. */
export function formatClinicDateWithWeekday(ymd: string): string {
  const p = partsOf(ymd);
  return `${WEEKDAYS_SHORT[p.weekday]}, ${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}`;
}

/** `Thursday, 12 November 2026` (accessible names, where the short form would be read letter by letter). */
export function formatClinicDateLong(ymd: string): string {
  const p = partsOf(ymd);
  return `${WEEKDAYS_LONG[p.weekday]}, ${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}`;
}

/** `Mon 16` (DayStrip chips). */
export function formatDayChip(ymd: string): string {
  const p = partsOf(ymd);
  return `${WEEKDAYS_SHORT[p.weekday]} ${p.d}`;
}

/** `November 2026` (calendar header). */
export function formatMonthYear(ymd: string): string {
  const p = partsOf(ymd);
  return `${MONTHS_LONG[p.m - 1]} ${p.y}`;
}

/** `Nov 2026` (an approximate birth month). */
export function formatMonthShortYear(ymd: string): string {
  const p = partsOf(ymd);
  return `${MONTHS_SHORT[p.m - 1]} ${p.y}`;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Wall-clock `HH:mm` → `11:30 am` / `2:05 pm` (lowercase, no leading zero). */
export function formatClinicTime(hhmm: string): string {
  const match = HHMM_RE.exec(hhmm);
  if (!match) throw new RangeError("Expected a wall-clock time in HH:mm form");
  const hour = Number(match[1]);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour < 12 ? "am" : "pm"}`;
}

/** `2026-11-12` → `12/11/2026`. */
export function formatDmy(ymd: string): string {
  if (!isYmd(ymd)) throw new RangeError("Expected a calendar date in YYYY-MM-DD form");
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

/** `12/11/2026` (or `12-11-2026`, `12.11.2026`, `1/2/2026`) → `2026-11-12`; `null` when it is not a real date. */
export function parseDmy(text: string): string | null {
  const match = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(text);
  if (!match) return null;
  const ymd = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return isYmd(ymd) ? ymd : null;
}

/** A count with Indian digit grouping: `1,240`, `1,24,000`. */
export function formatCount(n: number): string {
  return COUNT.format(n);
}
