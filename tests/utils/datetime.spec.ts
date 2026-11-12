import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CLINIC_TZ,
  addDaysYmd,
  ageInYears,
  dayWindowUtc,
  isValidTimeZone,
  isYmd,
  nextNDays,
  rangeWindowUtc,
  resolveTimeZone,
  startOfMonthYmd,
  todayInTz,
  weekdayOfYmd,
  ymdOf,
  zonedDateTimeToUtcIso,
} from "@/lib/datetime";
import { calculateAgeFromDob, calculateDobFromAge } from "@/features/patients/schema";
import { computeDateRange } from "@/features/visits/schema";
import { isDateOnly } from "@/lib/utils/filter-values";

// V2-03 03-05 (P1-21, ADR-016). The clinic day in Asia/Kolkata (UTC+05:30) starts at 18:30Z of the previous UTC
// day, so 00:00-05:29 IST is the window where a UTC "today" names the wrong date. CI runs this file a second time
// under TZ=America/New_York: nothing here may depend on the process zone.
const IST = "Asia/Kolkata";

describe("lib/datetime: clinic today across the IST midnight (00:00-05:30 IST)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("18:29:59Z is still 12 Nov in IST (23:59:59 IST)", () => {
    expect(todayInTz(IST, new Date("2026-11-12T18:29:59Z"))).toBe("2026-11-12");
  });

  it("18:30:00Z is already 13 Nov in IST (00:00 IST), while the UTC date is still 12 Nov", () => {
    const now = new Date("2026-11-12T18:30:00Z");
    expect(now.toISOString().slice(0, 10)).toBe("2026-11-12");
    expect(todayInTz(IST, now)).toBe("2026-11-13");
  });

  it("every instant from 00:00 to 05:29:59 IST names the IST date", () => {
    for (let minutes = 0; minutes < 330; minutes += 1) {
      const instant = Date.UTC(2026, 10, 12, 18, 30) + minutes * 60_000;
      expect(todayInTz(IST, instant)).toBe("2026-11-13");
    }
    expect(todayInTz(IST, new Date("2026-11-12T23:59:59Z"))).toBe("2026-11-13");
    // 05:30 IST is 00:00Z: from here the UTC date agrees again.
    expect(todayInTz(IST, new Date("2026-11-13T00:00:00Z"))).toBe("2026-11-13");
  });

  it("defaults `now` to the current instant (fake clock at 00:30 IST on 2 Mar)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T19:00:00Z"));
    expect(todayInTz(IST)).toBe("2026-03-02");
    vi.setSystemTime(new Date("2026-03-01T18:29:00Z"));
    expect(todayInTz(IST)).toBe("2026-03-01");
  });

  it("ymdOf reads database timestamps (offset forms) in the clinic zone", () => {
    expect(ymdOf("2026-11-12T20:30:00+00:00", IST)).toBe("2026-11-13");
    expect(ymdOf("2026-11-12T18:30:00.000Z", IST)).toBe("2026-11-13");
    expect(ymdOf("2026-11-13T00:00:00+05:30", IST)).toBe("2026-11-13");
    expect(ymdOf("2026-11-12T20:30:00Z", "UTC")).toBe("2026-11-12");
    expect(() => ymdOf("not a date", IST)).toThrow(RangeError);
  });
});

describe("lib/datetime: day windows are half-open in the clinic zone", () => {
  it("dayWindowUtc('2026-11-13', Asia/Kolkata) is [12 Nov 18:30Z, 13 Nov 18:30Z)", () => {
    expect(dayWindowUtc("2026-11-13", IST)).toEqual({
      startIso: "2026-11-12T18:30:00.000Z",
      endIsoExclusive: "2026-11-13T18:30:00.000Z",
    });
  });

  it("a visit at 02:00 IST on 13 Nov falls inside 13 Nov and outside 12 Nov", () => {
    const visit = "2026-11-12T20:30:00.000Z";
    const inside = (w: { startIso: string; endIsoExclusive: string }) => visit >= w.startIso && visit < w.endIsoExclusive;
    expect(inside(dayWindowUtc("2026-11-13", IST))).toBe(true);
    expect(inside(dayWindowUtc("2026-11-12", IST))).toBe(false);
  });

  it("rangeWindowUtc covers whole clinic days and rejects bad dates", () => {
    expect(rangeWindowUtc("2026-10-01", "2026-10-10", IST)).toEqual({
      startIso: "2026-09-30T18:30:00.000Z",
      endIsoExclusive: "2026-10-10T18:30:00.000Z",
    });
    expect(() => dayWindowUtc("2026-02-30", IST)).toThrow(RangeError);
    expect(() => dayWindowUtc("2026-11-13T00:00:00.000Z", IST)).toThrow(RangeError);
  });

  it("follows the zone's own offset, including DST days", () => {
    expect(dayWindowUtc("2026-11-13", "UTC")).toEqual({
      startIso: "2026-11-13T00:00:00.000Z",
      endIsoExclusive: "2026-11-14T00:00:00.000Z",
    });
    // US spring-forward day (8 Mar 2026) is 23 hours long in New York.
    expect(dayWindowUtc("2026-03-08", "America/New_York")).toEqual({
      startIso: "2026-03-08T05:00:00.000Z",
      endIsoExclusive: "2026-03-09T04:00:00.000Z",
    });
  });

  it("zonedDateTimeToUtcIso converts clinic wall-clock time to an instant", () => {
    expect(zonedDateTimeToUtcIso("2026-11-13", "14:00", IST)).toBe("2026-11-13T08:30:00.000Z");
    expect(zonedDateTimeToUtcIso("2026-11-13", "00:00", IST)).toBe("2026-11-12T18:30:00.000Z");
    expect(zonedDateTimeToUtcIso("2026-11-13", "23:59:59", IST)).toBe("2026-11-13T18:29:59.000Z");
    expect(() => zonedDateTimeToUtcIso("2026-11-13", "24:00", IST)).toThrow(RangeError);
  });
});

describe("lib/datetime: calendar arithmetic", () => {
  it("addDaysYmd rolls months, years and leap days", () => {
    expect(addDaysYmd("2026-11-13", 1)).toBe("2026-11-14");
    expect(addDaysYmd("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysYmd("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDaysYmd("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysYmd("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDaysYmd("2026-11-13", 14)).toBe("2026-11-27");
    expect(addDaysYmd("2026-03-01", -6)).toBe("2026-02-23");
  });

  it("nextNDays lists the clinic dates after today, tomorrow first", () => {
    expect(nextNDays(IST, 5, new Date("2026-12-29T19:00:00Z"))).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
      "2027-01-04",
    ]);
    expect(nextNDays(IST, 0)).toEqual([]);
  });

  it("startOfMonthYmd and weekdayOfYmd are zone-free", () => {
    expect(startOfMonthYmd("2026-11-13")).toBe("2026-11-01");
    expect(weekdayOfYmd("2026-11-13")).toBe("friday");
    expect(weekdayOfYmd("2026-03-01")).toBe("sunday");
  });

  it("isYmd accepts only real calendar dates", () => {
    expect(isYmd("2026-11-13")).toBe(true);
    expect(isYmd("2028-02-29")).toBe(true);
    expect(isYmd("2026-02-29")).toBe(false);
    expect(isYmd("2026-13-01")).toBe(false);
    expect(isYmd("2026-11-13T00:00:00Z")).toBe(false);
    expect(isYmd("13-11-2026")).toBe(false);
    expect(isYmd(20261113)).toBe(false);
    expect(isDateOnly("2026-02-29")).toBe(false);
    expect(isDateOnly("2026-11-13")).toBe(true);
  });

  it("an unusable tenant zone resolves to the clinic default", () => {
    expect(DEFAULT_CLINIC_TZ).toBe("Asia/Kolkata");
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(resolveTimeZone("Not/AZone")).toBe(IST);
    expect(resolveTimeZone(null)).toBe(IST);
    expect(resolveTimeZone("Asia/Dubai")).toBe("Asia/Dubai");
  });
});

describe("date consumers use the clinic date", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("age turns over on the IST birthday, not the UTC one", () => {
    expect(ageInYears("1990-11-13", "2026-11-12")).toBe(35);
    expect(ageInYears("1990-11-13", "2026-11-13")).toBe(36);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T19:00:00Z")); // 00:30 IST on 13 Nov
    expect(calculateAgeFromDob("1990-11-13")).toBe(36);
    expect(calculateDobFromAge(36)).toBe("1990-01-01");
    vi.setSystemTime(new Date("2026-12-31T19:00:00Z")); // 00:30 IST on 1 Jan 2027
    expect(calculateDobFromAge(36)).toBe("1991-01-01");
  });

  it("visit register 'today' is the IST day at 00:30 IST", () => {
    const now = new Date("2026-11-12T19:00:00Z");
    expect(computeDateRange("today", null, null, IST, now)).toEqual({
      startIso: "2026-11-12T18:30:00.000Z",
      endIsoExclusive: "2026-11-13T18:30:00.000Z",
    });
    expect(computeDateRange("yesterday", null, null, IST, now)).toEqual({
      startIso: "2026-11-11T18:30:00.000Z",
      endIsoExclusive: "2026-11-12T18:30:00.000Z",
    });
    expect(computeDateRange("last_7_days", null, null, IST, now)).toEqual({
      startIso: "2026-11-06T18:30:00.000Z",
      endIsoExclusive: "2026-11-13T18:30:00.000Z",
    });
    expect(computeDateRange("this_month", null, null, IST, new Date("2026-11-30T19:00:00Z"))).toEqual({
      startIso: "2026-11-30T18:30:00.000Z",
      endIsoExclusive: "2026-12-31T18:30:00.000Z",
    });
  });
});
