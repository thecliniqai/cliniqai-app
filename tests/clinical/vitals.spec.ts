/**
 * Vitals: unit conversions, BMI and range flags at the boundaries (V2-06 06-03b; 06-PLAN "Tests that fail without the
 * change": `vitals.spec.ts`; DESIGN_SYSTEM §7.3).
 */
import { describe, expect, it } from "vitest";
import {
  VITAL_SPECS,
  assessVital,
  bmi,
  bmiBand,
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  flagOf,
  flagWord,
  isCritical,
  parseVital,
  rangeMessage,
  summarizeVitals,
  vitalsItems,
  type VitalKind,
} from "@/lib/clinical/vitals";

describe("parseVital", () => {
  it("reads digits with one decimal point (a comma counts as the point); empty is null; anything else NaN", () => {
    expect(parseVital("98.6")).toBe(98.6);
    expect(parseVital(" 120 ")).toBe(120);
    expect(parseVital("98,6")).toBe(98.6);
    expect(parseVital(".5")).toBe(0.5);
    expect(parseVital("")).toBeNull();
    expect(parseVital("   ")).toBeNull();
    for (const bad of ["98.6abc", "1e2", "-5", "12.3.4", "120/80", "abc", "0x10"]) expect(parseVital(bad)).toBeNaN();
  });
});

describe("unit conversions", () => {
  it("°C ↔ °F to one decimal", () => {
    expect(celsiusToFahrenheit(37)).toBe(98.6);
    expect(celsiusToFahrenheit(38)).toBe(100.4);
    expect(celsiusToFahrenheit(40)).toBe(104);
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(fahrenheitToCelsius(98.6)).toBe(37);
    expect(fahrenheitToCelsius(100.4)).toBe(38);
    expect(fahrenheitToCelsius(104)).toBe(40);
    expect(fahrenheitToCelsius(212)).toBe(100);
  });

  it("round-trips every tenth of a degree from 35.0 to 42.0 °C", () => {
    for (let t = 350; t <= 420; t += 1) {
      const c = t / 10;
      expect(fahrenheitToCelsius(celsiusToFahrenheit(c))).toBe(c);
    }
  });
});

describe("BMI", () => {
  it("weight / height² to one decimal", () => {
    expect(bmi(78, 170)).toBe(27);
    expect(bmi(70, 175)).toBe(22.9);
    expect(bmi(50, 160)).toBe(19.5);
    expect(bmi(120, 165)).toBe(44.1);
  });

  it("is null until both values are plausible (no BMI from a half-typed height)", () => {
    expect(bmi(78, 17)).toBeNull();
    expect(bmi(78, null)).toBeNull();
    expect(bmi(undefined, 170)).toBeNull();
    expect(bmi(0, 170)).toBeNull();
    expect(bmi(400, 170)).toBeNull();
    expect(bmi(78, 251)).toBeNull();
    expect(bmi(78, 30)).not.toBeNull();
  });

  it("bands at their boundaries", () => {
    expect([18.4, 18.5, 24.9, 25, 29.9, 30].map(bmiBand)).toEqual([
      "Underweight",
      "Normal",
      "Normal",
      "Overweight",
      "Overweight",
      "Obese",
    ]);
  });
});

describe("range flags at the boundaries", () => {
  // [kind, value, expected flag]: each limit, and one step either side of it.
  const cases: [VitalKind, number, string][] = [
    ["systolic", 69, "critical-low"],
    ["systolic", 70, "low"],
    ["systolic", 89, "low"],
    ["systolic", 90, "normal"],
    ["systolic", 139, "normal"],
    ["systolic", 140, "high"],
    ["systolic", 179, "high"],
    ["systolic", 180, "critical-high"],
    ["diastolic", 59, "low"],
    ["diastolic", 60, "normal"],
    ["diastolic", 89, "normal"],
    ["diastolic", 90, "high"],
    ["diastolic", 119, "high"],
    ["diastolic", 120, "critical-high"],
    ["diastolic", 39, "critical-low"],
    ["pulse", 39, "critical-low"],
    ["pulse", 40, "low"],
    ["pulse", 49, "low"],
    ["pulse", 50, "normal"],
    ["pulse", 100, "normal"],
    ["pulse", 101, "high"],
    ["pulse", 130, "high"],
    ["pulse", 131, "critical-high"],
    ["temperatureF", 93.1, "critical-low"],
    ["temperatureF", 93.2, "low"],
    ["temperatureF", 94.9, "low"],
    ["temperatureF", 95, "normal"],
    ["temperatureF", 100.3, "normal"],
    ["temperatureF", 100.4, "high"],
    ["temperatureF", 103.9, "high"],
    ["temperatureF", 104, "critical-high"],
    ["spo2", 89, "critical-low"],
    ["spo2", 90, "low"],
    ["spo2", 94, "low"],
    ["spo2", 95, "normal"],
    ["spo2", 100, "normal"],
    ["respRate", 7, "critical-low"],
    ["respRate", 8, "low"],
    ["respRate", 11, "low"],
    ["respRate", 12, "normal"],
    ["respRate", 20, "normal"],
    ["respRate", 21, "high"],
    ["respRate", 30, "high"],
    ["respRate", 31, "critical-high"],
    ["sugarRandom", 53, "critical-low"],
    ["sugarRandom", 54, "low"],
    ["sugarRandom", 69, "low"],
    ["sugarRandom", 70, "normal"],
    ["sugarRandom", 199, "normal"],
    ["sugarRandom", 200, "high"],
    ["sugarRandom", 399, "high"],
    ["sugarRandom", 400, "critical-high"],
    ["sugarFasting", 125, "normal"],
    ["sugarFasting", 126, "high"],
    ["sugarPP", 199, "normal"],
    ["sugarPP", 200, "high"],
    ["weight", 0.3, "normal"],
    ["weight", 350, "normal"],
    ["height", 30, "normal"],
  ];
  it.each(cases)("%s %d → %s", (kind, value, flag) => {
    expect(flagOf(VITAL_SPECS[kind], value)).toBe(flag);
    expect(assessVital(kind, String(value))).toEqual({ state: "ok", value, flag });
  });

  it("flags read as words (never colour alone); critical is its own level", () => {
    expect(flagWord("high")).toBe("High");
    expect(flagWord("critical-high")).toBe("High");
    expect(flagWord("low")).toBe("Low");
    expect(flagWord("critical-low")).toBe("Low");
    expect(flagWord("normal")).toBeNull();
    expect(isCritical("critical-low")).toBe(true);
    expect(isCritical("low")).toBe(false);
  });
});

describe("plausible limits (hard errors, the only thing that blocks saving)", () => {
  const limits: [VitalKind, number, number][] = [
    ["systolic", 40, 300],
    ["diastolic", 20, 200],
    ["pulse", 20, 250],
    ["temperatureF", 85, 115],
    ["spo2", 50, 100],
    ["respRate", 4, 80],
    ["weight", 0.3, 350],
    ["height", 30, 250],
    ["sugarRandom", 10, 1000],
  ];
  it.each(limits)("%s accepts %d…%d and refuses one step outside", (kind, min, max) => {
    const step = VITAL_SPECS[kind].decimals > 0 ? 0.1 : 1;
    expect(assessVital(kind, String(min)).state).toBe("ok");
    expect(assessVital(kind, String(max)).state).toBe("ok");
    const below = assessVital(kind, String(Math.round((min - step) * 10) / 10));
    const above = assessVital(kind, String(Math.round((max + step) * 10) / 10));
    expect(below).toEqual({ state: "implausible", message: `Enter a value between ${min} and ${max}` });
    expect(above).toEqual({ state: "implausible", message: `Enter a value between ${min} and ${max}` });
  });

  it("BP 1500 is an error, not a flag; text is an error; empty is neither", () => {
    expect(assessVital("systolic", "1500")).toEqual({ state: "implausible", message: rangeMessage(VITAL_SPECS.systolic) });
    expect(assessVital("pulse", "eighty")).toEqual({ state: "invalid", message: "Enter pulse as a number" });
    expect(assessVital("pulse", "")).toEqual({ state: "empty" });
  });
});

describe("summary", () => {
  it("BP, pulse, temperature in that order, at most three, all items kept for the popover", () => {
    const { shown, all } = summarizeVitals({ systolic: 128, diastolic: 84, pulse: 88, temperatureF: 98.6, spo2: 98, weight: 78 });
    expect(shown.map((i) => i.text)).toEqual(["BP 128/84", "P 88", "98.6°F"]);
    expect(all.map((i) => i.text)).toEqual(["BP 128/84", "P 88", "98.6°F", "SpO₂ 98%", "78 kg"]);
  });

  it("a flagged value is never hidden behind normal ones", () => {
    const { shown } = summarizeVitals({ systolic: 128, diastolic: 84, pulse: 88, temperatureF: 98.6, spo2: 88 });
    expect(shown.map((i) => [i.text, i.flag])).toEqual([
      ["SpO₂ 88%", "critical-low"],
      ["BP 128/84", "normal"],
      ["P 88", "normal"],
    ]);
  });

  // 06-09c (M-VITALS, IND M-1): the reviewer's probe. Before, "flagged first" treated high and critical alike, so
  // shown = [BP high, P high, 100.8°F high] and the critical SpO₂ 84 % was only in the popover.
  it("a critical reading is never hidden behind merely-high ones: criticals rank first", () => {
    const { shown, all } = summarizeVitals({ systolic: 150, diastolic: 95, pulse: 110, temperatureF: 100.8, spo2: 84 });
    expect(shown.map((i) => [i.text, i.flag])).toEqual([
      ["SpO₂ 84%", "critical-low"],
      ["BP 150/95", "high"],
      ["P 110", "high"],
    ]);
    expect(all).toHaveLength(4);
  });

  it("every critical reading is shown, even more than three of them; then flagged, then normal", () => {
    const reading = { systolic: 200, diastolic: 125, pulse: 160, temperatureF: 106, spo2: 80, respRate: 40, weight: 70 };
    const { shown, all } = summarizeVitals(reading);
    const criticals = all.filter((i) => i.flag.startsWith("critical"));
    expect(criticals.length).toBeGreaterThan(3);
    expect(shown.map((i) => i.text)).toEqual(criticals.map((i) => i.text));
    const mixed = summarizeVitals({ systolic: 128, diastolic: 84, pulse: 110, spo2: 84 }, 3).shown;
    expect(mixed.map((i) => i.flag)).toEqual(["critical-low", "high", "normal"]);
  });

  it("BP takes the worse of its two numbers; spoken forms name the vital", () => {
    const [bp] = vitalsItems({ systolic: 150, diastolic: 95 });
    expect(bp).toEqual({ text: "BP 150/95", spoken: "blood pressure 150 over 95", flag: "high" });
    expect(vitalsItems({ systolic: 120, diastolic: 125 })[0].flag).toBe("critical-high");
    expect(vitalsItems({ sugar: 130, sugarType: "fasting" })[0].flag).toBe("high");
    expect(vitalsItems({ sugar: 130, sugarType: "random" })[0].flag).toBe("normal");
    // Half a BP is not a reading.
    expect(vitalsItems({ systolic: 150 })).toEqual([]);
  });
});
