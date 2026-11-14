/**
 * Age ↔ date of birth for the identity inputs (V2-06 06-02c; DESIGN_SYSTEM §5 "Age", 06-UI-SPEC AgeOrDobInput).
 * Pure calendar arithmetic on clinic dates (`YYYY-MM-DD`): "today" is always the clinic's date in its zone
 * (`todayInTz(tz)` from `lib/datetime`), never the browser's or UTC's, so between 00:00 and 05:30 IST a birthday that
 * is today in the clinic already counts (UTC is still on yesterday).
 *
 * Display (DESIGN_SYSTEM §5): `42 y`; months below 2 years (`8 m`, `23 m`); days below 1 month (`12 d`).
 * Birthdays use the same rule as `lib/datetime` `ageInYears`: a 29 Feb birthday is reached on 1 Mar in other years.
 *
 * Age → DOB uses the convention of `features/patients/schema.ts` `calculateDobFromAge` (1 Jan of the birth year), so
 * an age entered here and the stored, approximate date of birth agree with the server and round-trip to the same age.
 * Below 2 years an age is entered in months, and the approximate DOB is the same day that many months ago.
 */
import { isYmd, todayInTz } from "@/lib/datetime";

export interface AgeParts {
  years: number;
  /** Whole months after the last birthday (0-11). */
  months: number;
  /** Whole days after the last month-day (0-30). */
  days: number;
  /** Total whole months since birth. */
  totalMonths: number;
}

export type AgeUnit = "y" | "m";

/** Largest age the inputs accept, in years (the v1 form's 130). */
export const MAX_AGE_YEARS = 130;

function parts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split("-").map(Number);
  return [y, m, d];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The age on clinic date `todayYmd` of someone born on `dobYmd`; `null` for an unusable date or a birth date after
 * today.
 */
export function ageParts(dobYmd: string, todayYmd: string): AgeParts | null {
  if (!isYmd(dobYmd) || !isYmd(todayYmd) || dobYmd > todayYmd) return null;
  const [by, bm, bd] = parts(dobYmd);
  const [ty, tm, td] = parts(todayYmd);
  let totalMonths = (ty - by) * 12 + (tm - bm);
  let days: number;
  if (td >= bd) {
    days = td - bd;
  } else {
    totalMonths -= 1;
    // Days since the month-day was last reached: the remainder of the previous month, then today's day.
    const prevMonth = tm === 1 ? 12 : tm - 1;
    const prevYear = tm === 1 ? ty - 1 : ty;
    const anchor = Math.min(bd, daysInMonth(prevYear, prevMonth));
    days = daysInMonth(prevYear, prevMonth) - anchor + td;
    // A 29-31 birth day that does not exist last month: the month-day falls on the 1st of this month.
    if (bd > daysInMonth(prevYear, prevMonth)) days = td - 1;
  }
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12, days, totalMonths };
}

/** `42 y`, `8 m` (below 2 years), `12 d` (below 1 month); `null` for an unusable date of birth. */
export function formatAge(dobYmd: string, todayYmd: string): string | null {
  const age = ageParts(dobYmd, todayYmd);
  if (!age) return null;
  if (age.totalMonths < 1) return `${age.days} d`;
  if (age.years < 2) return `${age.totalMonths} m`;
  return `${age.years} y`;
}

/** The age today in clinic zone `tz` (`now` injectable for tests). */
export function formatAgeToday(dobYmd: string, tz: string, now: Date | number = Date.now()): string | null {
  return formatAge(dobYmd, todayInTz(tz, now));
}

/**
 * The approximate date of birth for an age entered on clinic date `todayYmd`: `n` years → 1 Jan of the birth year
 * (the server's convention); `n` months → the same day `n` months ago (clamped to the month's last day). `null` when
 * the age is not a whole number in range (0-130 years, 0-23 months).
 */
export function dobFromAge(amount: number, unit: AgeUnit, todayYmd: string): string | null {
  if (!isYmd(todayYmd) || !Number.isInteger(amount) || amount < 0) return null;
  const [ty, tm, td] = parts(todayYmd);
  if (unit === "y") {
    if (amount > MAX_AGE_YEARS) return null;
    return toYmd(ty - amount, 1, 1);
  }
  if (amount > 23) return null;
  const index = ty * 12 + (tm - 1) - amount;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return toYmd(y, m, Math.min(td, daysInMonth(y, m)));
}

/** Parses the age field: digits only, in range for its unit; `null` otherwise. */
export function parseAgeAmount(text: string, unit: AgeUnit): number | null {
  if (!/^\s*\d{1,3}\s*$/.test(text)) return null;
  const n = Number(text.trim());
  if (unit === "y" && n > MAX_AGE_YEARS) return null;
  if (unit === "m" && n > 23) return null;
  return n;
}
