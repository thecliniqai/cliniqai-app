/**
 * `lib/datetime/format.ts` (V2-06 06-02c; DESIGN_SYSTEM §5): the India display formats for clinic dates, times and
 * counts, and the dd/mm/yyyy entry form. A clinic date has one name everywhere: the formatters work on the calendar
 * date itself (as a UTC day), so the result never depends on the process's or the browser's zone (the browser side is
 * covered by tests/e2e/design/keyboard/data-and-dates.spec.ts in UTC+14 and in IST).
 */
import { describe, expect, it } from "vitest";
import {
  formatClinicDate,
  formatClinicDateLong,
  formatClinicDateWithWeekday,
  formatClinicTime,
  formatCount,
  formatDayChip,
  formatDmy,
  formatMonthShortYear,
  formatMonthYear,
  parseDmy,
} from "@/lib/datetime/format";

describe("display formats", () => {
  it("dates: 12 Nov 2026, Thu, 12 Nov 2026, Thursday, 12 November 2026, Mon 16, November 2026, Nov 2026", () => {
    expect(formatClinicDate("2026-11-12")).toBe("12 Nov 2026");
    expect(formatClinicDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatClinicDateWithWeekday("2026-11-12")).toBe("Thu, 12 Nov 2026");
    expect(formatClinicDateLong("2026-11-12")).toBe("Thursday, 12 November 2026");
    expect(formatDayChip("2026-11-16")).toBe("Mon 16");
    expect(formatMonthYear("2026-11-12")).toBe("November 2026");
    expect(formatMonthShortYear("1984-01-01")).toBe("Jan 1984");
  });

  it("a leap day and the year's edges keep their own day (no UTC/IST shift)", () => {
    expect(formatClinicDateWithWeekday("2028-02-29")).toBe("Tue, 29 Feb 2028");
    expect(formatClinicDate("2026-12-31")).toBe("31 Dec 2026");
    expect(formatClinicDate("2027-01-01")).toBe("1 Jan 2027");
  });

  it("month and weekday names are the CLDR en-IN ones (cross-checked against Intl for every month and weekday)", () => {
    const intl = new Intl.DateTimeFormat("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    const short = new Intl.DateTimeFormat("en-IN", { weekday: "short", month: "short", timeZone: "UTC" });
    for (let month = 1; month <= 12; month++) {
      for (const day of [1, 2, 3, 4, 5, 6, 7]) {
        const ymd = `2026-${String(month).padStart(2, "0")}-0${day}`;
        const ms = Date.UTC(2026, month - 1, day);
        const long = Object.fromEntries(intl.formatToParts(ms).map((p) => [p.type, p.value]));
        const brief = Object.fromEntries(short.formatToParts(ms).map((p) => [p.type, p.value]));
        expect(formatClinicDateLong(ymd)).toBe(`${long.weekday}, ${day} ${long.month} 2026`);
        expect(formatClinicDateWithWeekday(ymd)).toBe(`${brief.weekday}, ${day} ${brief.month} 2026`);
      }
    }
    expect(formatClinicDate("2026-09-30")).toBe("30 Sept 2026");
  });

  it("times: 12-hour, lowercase, no leading zero", () => {
    expect(formatClinicTime("11:30")).toBe("11:30 am");
    expect(formatClinicTime("09:05")).toBe("9:05 am");
    expect(formatClinicTime("12:00")).toBe("12:00 pm");
    expect(formatClinicTime("00:15")).toBe("12:15 am");
    expect(formatClinicTime("17:45")).toBe("5:45 pm");
    expect(() => formatClinicTime("24:00")).toThrow(RangeError);
    expect(() => formatClinicTime("9:30")).toThrow(RangeError);
  });

  it("counts use Indian grouping", () => {
    expect(formatCount(1240)).toBe("1,240");
    expect(formatCount(124000)).toBe("1,24,000");
    expect(formatCount(12500000)).toBe("1,25,00,000");
  });

  it("refuses a non-date", () => {
    expect(() => formatClinicDate("2026-02-30")).toThrow(RangeError);
    expect(() => formatClinicDate("12/11/2026")).toThrow(RangeError);
  });
});

describe("dd/mm/yyyy entry (never mm/dd)", () => {
  it("round-trips", () => {
    expect(formatDmy("2026-11-12")).toBe("12/11/2026");
    expect(parseDmy("12/11/2026")).toBe("2026-11-12");
    expect(parseDmy("1/2/2026")).toBe("2026-02-01");
    expect(parseDmy("01-02-2026")).toBe("2026-02-01");
    expect(parseDmy(" 29.02.2028 ")).toBe("2028-02-29");
  });

  it("refuses impossible dates and other shapes", () => {
    for (const text of ["31/02/2026", "29/02/2026", "12/13/2026", "00/11/2026", "12/11/26", "2026-11-12", "12112026", ""]) {
      expect(parseDmy(text), text).toBeNull();
    }
  });
});
