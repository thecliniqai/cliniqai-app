/**
 * `lib/ui/age.ts` (V2-06 06-02c; DESIGN_SYSTEM §5 "Age"; 06-PLAN 06-02c "age.spec.ts"): age from DOB and DOB from age
 * on clinic dates, including the IST date boundary (00:00-05:30 IST, when UTC is still on the previous day) and a
 * 29 Feb date of birth.
 */
import { describe, expect, it } from "vitest";
import { ageInYears, todayInTz } from "@/lib/datetime";
import { calculateAgeFromDob, calculateDobFromAge } from "@/features/patients/schema";
import { ageParts, dobFromAge, formatAge, formatAgeToday, parseAgeAmount } from "@/lib/ui/age";

const IST = "Asia/Kolkata";

describe("formatAge: 42 y, months below 2 years, days below 1 month", () => {
  it.each([
    ["1984-11-15", "2026-11-15", "42 y"],
    ["1984-11-16", "2026-11-15", "41 y"],
    ["2024-11-15", "2026-11-15", "2 y"],
    ["2024-11-16", "2026-11-15", "23 m"],
    ["2026-03-15", "2026-11-15", "8 m"],
    ["2026-10-16", "2026-11-15", "30 d"],
    ["2026-11-03", "2026-11-15", "12 d"],
    ["2026-11-15", "2026-11-15", "0 d"],
  ])("born %s, on %s → %s", (dob, today, expected) => {
    expect(formatAge(dob, today)).toBe(expected);
  });

  it("refuses an unusable date of birth or one after today", () => {
    expect(formatAge("2026-02-30", "2026-11-15")).toBeNull();
    expect(formatAge("15/11/1984", "2026-11-15")).toBeNull();
    expect(formatAge("2026-11-16", "2026-11-15")).toBeNull();
  });
});

describe("the IST date boundary: today is the clinic's date, not UTC's", () => {
  // 00:30 IST on 15 Nov 2026 is 19:00 UTC on 14 Nov.
  const justAfterIstMidnight = Date.parse("2026-11-14T19:00:00Z");
  // 05:29 IST on 15 Nov is 23:59 UTC on 14 Nov: still the UTC day before.
  const beforeUtcMidnight = Date.parse("2026-11-14T23:59:00Z");
  // 23:59 IST on 14 Nov is 18:29 UTC on 14 Nov.
  const justBeforeIstMidnight = Date.parse("2026-11-14T18:29:00Z");

  it("a birthday that is today in IST counts between 00:00 and 05:30 IST", () => {
    expect(todayInTz(IST, justAfterIstMidnight)).toBe("2026-11-15");
    expect(formatAgeToday("1984-11-15", IST, justAfterIstMidnight)).toBe("42 y");
    expect(formatAgeToday("1984-11-15", IST, beforeUtcMidnight)).toBe("42 y");
    // A UTC "today" would still say 41.
    expect(formatAge("1984-11-15", "2026-11-14")).toBe("41 y");
  });

  it("the minute before IST midnight is still the day before", () => {
    expect(formatAgeToday("1984-11-15", IST, justBeforeIstMidnight)).toBe("41 y");
  });

  it("an infant's month count turns at IST midnight", () => {
    expect(formatAgeToday("2026-03-15", IST, justBeforeIstMidnight)).toBe("7 m");
    expect(formatAgeToday("2026-03-15", IST, justAfterIstMidnight)).toBe("8 m");
  });

  it("DOB from age uses the clinic's year at the IST new year", () => {
    // 00:30 IST on 1 Jan 2027 is 19:00 UTC on 31 Dec 2026.
    const istNewYear = Date.parse("2026-12-31T19:00:00Z");
    expect(dobFromAge(42, "y", todayInTz(IST, istNewYear))).toBe("1985-01-01");
  });
});

describe("a 29 Feb date of birth", () => {
  it("is reached on 1 Mar in other years (the lib/datetime ageInYears rule)", () => {
    expect(formatAge("2024-02-29", "2025-02-28")).toBe("11 m");
    expect(ageParts("2024-02-29", "2025-02-28")).toMatchObject({ years: 0, months: 11, days: 30 });
    expect(ageParts("2024-02-29", "2025-03-01")).toMatchObject({ years: 1, months: 0, days: 0 });
    expect(formatAge("2024-02-29", "2026-02-28")).toBe("23 m");
    expect(formatAge("2024-02-29", "2026-03-01")).toBe("2 y");
    expect(formatAge("2024-02-29", "2028-02-29")).toBe("4 y");
  });
});

describe("ageParts agrees with lib/datetime ageInYears", () => {
  it("for every DOB in 2023-2024 on a spread of clinic dates", () => {
    const todays = ["2025-01-01", "2025-02-28", "2025-03-01", "2026-02-28", "2026-12-31", "2028-02-29"];
    let checked = 0;
    for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2024, 11, 31); t += 86_400_000) {
      const d = new Date(t);
      const dob = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      for (const today of todays) {
        const parts = ageParts(dob, today);
        expect(parts?.years, `${dob} on ${today}`).toBe(ageInYears(dob, today));
        expect(parts!.months).toBeGreaterThanOrEqual(0);
        expect(parts!.months).toBeLessThan(12);
        expect(parts!.days).toBeGreaterThanOrEqual(0);
        expect(parts!.days).toBeLessThan(31);
        checked++;
      }
    }
    expect(checked).toBe(731 * 6);
  });
});

describe("dobFromAge", () => {
  it("years → 1 Jan of the birth year, the server's convention, and back to the same age", () => {
    expect(dobFromAge(42, "y", "2026-11-15")).toBe("1984-01-01");
    expect(calculateDobFromAge(42, "2026-11-15")).toBe(dobFromAge(42, "y", "2026-11-15"));
    for (const years of [0, 1, 2, 42, 99, 130]) {
      const dob = dobFromAge(years, "y", "2026-11-15")!;
      expect(calculateAgeFromDob(dob, "2026-11-15")).toBe(years);
    }
  });

  it("months → the same day that many months ago, clamped to the month's end", () => {
    expect(dobFromAge(8, "m", "2026-11-15")).toBe("2026-03-15");
    expect(dobFromAge(0, "m", "2026-11-15")).toBe("2026-11-15");
    expect(dobFromAge(23, "m", "2026-11-15")).toBe("2024-12-15");
    expect(dobFromAge(1, "m", "2026-03-31")).toBe("2026-02-28");
    expect(dobFromAge(1, "m", "2024-03-31")).toBe("2024-02-29");
    expect(dobFromAge(11, "m", "2026-01-31")).toBe("2025-02-28");
    for (const months of [0, 1, 8, 13, 23]) {
      expect(formatAge(dobFromAge(months, "m", "2026-11-15")!, "2026-11-15")).toBe(months < 1 ? "0 d" : `${months} m`);
    }
  });

  it("refuses out-of-range or non-integer ages", () => {
    expect(dobFromAge(131, "y", "2026-11-15")).toBeNull();
    expect(dobFromAge(24, "m", "2026-11-15")).toBeNull();
    expect(dobFromAge(-1, "y", "2026-11-15")).toBeNull();
    expect(dobFromAge(4.5, "y", "2026-11-15")).toBeNull();
    expect(dobFromAge(4, "y", "2026-02-30")).toBeNull();
  });
});

describe("parseAgeAmount", () => {
  it("accepts whole numbers in range for the unit", () => {
    expect(parseAgeAmount("42", "y")).toBe(42);
    expect(parseAgeAmount(" 8 ", "m")).toBe(8);
    expect(parseAgeAmount("0", "y")).toBe(0);
    expect(parseAgeAmount("130", "y")).toBe(130);
  });

  it("refuses anything else", () => {
    for (const [text, unit] of [
      ["", "y"],
      ["4.5", "y"],
      ["-3", "y"],
      ["131", "y"],
      ["24", "m"],
      ["42y", "y"],
      ["forty", "y"],
    ] as const) {
      expect(parseAgeAmount(text, unit), `${text} ${unit}`).toBeNull();
    }
  });
});
