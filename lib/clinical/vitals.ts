/**
 * Vital signs: units, plausible ranges, range flags and BMI (V2-06 06-03b; DESIGN_SYSTEM §7.3; 06-UI-SPEC VitalsForm,
 * VitalsSummary). Pure functions, shared by the form, the summary and (later) the server.
 *
 * Two kinds of limit:
 * - **plausible**: outside it the number cannot be a reading of a living patient (BP 1500, SpO₂ 120). The form shows a
 *   field error ("Enter a value between 40 and 300") and does not save it.
 * - **flag**: a plausible value outside the usual adult range is flagged "High" or "Low" (warning) or, past the
 *   critical limit, critical (danger: e.g. SpO₂ under 90). A flag never blocks saving.
 * The limits are the default adult table (DESIGN_SYSTEM §7.3 "Assumption: default adult ranges"); a clinic-configurable
 * table and paediatric ranges by age arrive with V2-09 (owner of the consult and the vitals settings).
 *
 * Boundary convention: `low` is "value < low", `high` is "value >= high" (a reading equal to the high limit is
 * flagged, one equal to the low limit is not); the critical limits follow the same rule.
 */
export type VitalKind =
  | "systolic"
  | "diastolic"
  | "pulse"
  | "temperatureF"
  | "spo2"
  | "respRate"
  | "weight"
  | "height"
  | "sugarRandom"
  | "sugarFasting"
  | "sugarPP";

export interface VitalSpec {
  label: string;
  unit: string;
  /** Plausible range, inclusive. */
  min: number;
  max: number;
  /** Decimal places a reading keeps. */
  decimals: number;
  /** Flags: value < low → low; value >= high → high; critical beyond criticalLow / criticalHigh. */
  low?: number;
  high?: number;
  criticalLow?: number;
  criticalHigh?: number;
}

export const VITAL_SPECS: Readonly<Record<VitalKind, VitalSpec>> = Object.freeze({
  systolic: { label: "Systolic", unit: "mmHg", min: 40, max: 300, decimals: 0, low: 90, high: 140, criticalLow: 70, criticalHigh: 180 },
  diastolic: { label: "Diastolic", unit: "mmHg", min: 20, max: 200, decimals: 0, low: 60, high: 90, criticalLow: 40, criticalHigh: 120 },
  pulse: { label: "Pulse", unit: "bpm", min: 20, max: 250, decimals: 0, low: 50, high: 101, criticalLow: 40, criticalHigh: 131 },
  temperatureF: { label: "Temperature", unit: "°F", min: 85, max: 115, decimals: 1, low: 95, high: 100.4, criticalLow: 93.2, criticalHigh: 104 },
  spo2: { label: "SpO₂", unit: "%", min: 50, max: 100, decimals: 0, low: 95, criticalLow: 90 },
  respRate: { label: "Resp. rate", unit: "/min", min: 4, max: 80, decimals: 0, low: 12, high: 21, criticalLow: 8, criticalHigh: 31 },
  weight: { label: "Weight", unit: "kg", min: 0.3, max: 350, decimals: 1 },
  height: { label: "Height", unit: "cm", min: 30, max: 250, decimals: 1 },
  sugarRandom: { label: "Blood sugar (random)", unit: "mg/dL", min: 10, max: 1000, decimals: 0, low: 70, high: 200, criticalLow: 54, criticalHigh: 400 },
  sugarFasting: { label: "Blood sugar (fasting)", unit: "mg/dL", min: 10, max: 1000, decimals: 0, low: 70, high: 126, criticalLow: 54, criticalHigh: 400 },
  sugarPP: { label: "Blood sugar (PP)", unit: "mg/dL", min: 10, max: 1000, decimals: 0, low: 70, high: 200, criticalLow: 54, criticalHigh: 400 },
});

export type VitalFlag = "normal" | "low" | "high" | "critical-low" | "critical-high";

export type VitalAssessment =
  | { state: "empty" }
  | { state: "invalid"; message: string }
  | { state: "implausible"; message: string }
  | { state: "ok"; value: number; flag: VitalFlag };

/**
 * Reads typed text: digits with at most one decimal point (a comma is read as the point). Empty → null; anything else
 * that is not such a number → NaN. Never `parseFloat`'s prefix reading ("98.6abc" is not 98.6).
 */
export function parseVital(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return Number.NaN;
  return Number(t);
}

export function rangeMessage(spec: VitalSpec): string {
  return `Enter a value between ${spec.min} and ${spec.max}`;
}

export function flagOf(spec: VitalSpec, value: number): VitalFlag {
  if (spec.criticalLow !== undefined && value < spec.criticalLow) return "critical-low";
  if (spec.criticalHigh !== undefined && value >= spec.criticalHigh) return "critical-high";
  if (spec.low !== undefined && value < spec.low) return "low";
  if (spec.high !== undefined && value >= spec.high) return "high";
  return "normal";
}

/** Assesses one typed reading. */
export function assessVital(kind: VitalKind, text: string): VitalAssessment {
  const spec = VITAL_SPECS[kind];
  const value = parseVital(text);
  if (value === null) return { state: "empty" };
  if (Number.isNaN(value)) return { state: "invalid", message: `Enter ${spec.label.toLowerCase()} as a number` };
  if (value < spec.min || value > spec.max) return { state: "implausible", message: rangeMessage(spec) };
  return { state: "ok", value, flag: flagOf(spec, value) };
}

/** The word a flag reads as next to its value (never colour alone). */
export function flagWord(flag: VitalFlag): string | null {
  if (flag === "low" || flag === "critical-low") return "Low";
  if (flag === "high" || flag === "critical-high") return "High";
  return null;
}

export function isCritical(flag: VitalFlag): boolean {
  return flag === "critical-low" || flag === "critical-high";
}

/*
 * Units.
 */
export function celsiusToFahrenheit(c: number): number {
  return roundTo((c * 9) / 5 + 32, 1);
}

export function fahrenheitToCelsius(f: number): number {
  return roundTo(((f - 32) * 5) / 9, 1);
}

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * Body-mass index: weight (kg) / height (m)², one decimal. Null unless both are plausible readings (VITAL_SPECS) —
 * a half-typed height must not print a BMI of 3,000.
 */
export function bmi(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (weightKg == null || heightCm == null) return null;
  const w = VITAL_SPECS.weight;
  const h = VITAL_SPECS.height;
  if (!(weightKg >= w.min && weightKg <= w.max && heightCm >= h.min && heightCm <= h.max)) return null;
  const m = heightCm / 100;
  return roundTo(weightKg / (m * m), 1);
}

/** WHO adult BMI band (shown as text next to the number; not a flag). */
export function bmiBand(value: number): "Underweight" | "Normal" | "Overweight" | "Obese" {
  if (value < 18.5) return "Underweight";
  if (value < 25) return "Normal";
  if (value < 30) return "Overweight";
  return "Obese";
}

/*
 * Summary (VitalsSummary, queue rows, consult context): at most three items, in this order.
 */
export interface VitalsReading {
  systolic?: number | null;
  diastolic?: number | null;
  pulse?: number | null;
  temperatureF?: number | null;
  spo2?: number | null;
  respRate?: number | null;
  weight?: number | null;
  height?: number | null;
  sugar?: number | null;
  sugarType?: "random" | "fasting" | "pp" | null;
}

export interface SummaryItem {
  /** Short visible text: "BP 150/95", "P 88", "98.6°F", "SpO₂ 97%". */
  text: string;
  /** Spoken text: "blood pressure 150 over 95". */
  spoken: string;
  flag: VitalFlag;
}

function worst(a: VitalFlag, b: VitalFlag): VitalFlag {
  const rank: Record<VitalFlag, number> = { normal: 0, low: 1, high: 1, "critical-low": 2, "critical-high": 2 };
  return rank[b] > rank[a] ? b : a;
}

const SUGAR_KIND = { random: "sugarRandom", fasting: "sugarFasting", pp: "sugarPP" } as const;

/** Every recorded item, in display order (BP, pulse, temperature, SpO₂, resp. rate, sugar, weight). */
export function vitalsItems(v: VitalsReading): SummaryItem[] {
  const items: SummaryItem[] = [];
  if (v.systolic != null && v.diastolic != null) {
    const flag = worst(flagOf(VITAL_SPECS.systolic, v.systolic), flagOf(VITAL_SPECS.diastolic, v.diastolic));
    items.push({ text: `BP ${v.systolic}/${v.diastolic}`, spoken: `blood pressure ${v.systolic} over ${v.diastolic}`, flag });
  }
  if (v.pulse != null) items.push({ text: `P ${v.pulse}`, spoken: `pulse ${v.pulse}`, flag: flagOf(VITAL_SPECS.pulse, v.pulse) });
  if (v.temperatureF != null)
    items.push({
      text: `${v.temperatureF.toFixed(1)}°F`,
      spoken: `temperature ${v.temperatureF.toFixed(1)} degrees Fahrenheit`,
      flag: flagOf(VITAL_SPECS.temperatureF, v.temperatureF),
    });
  if (v.spo2 != null) items.push({ text: `SpO₂ ${v.spo2}%`, spoken: `oxygen saturation ${v.spo2} percent`, flag: flagOf(VITAL_SPECS.spo2, v.spo2) });
  if (v.respRate != null)
    items.push({ text: `RR ${v.respRate}`, spoken: `respiratory rate ${v.respRate}`, flag: flagOf(VITAL_SPECS.respRate, v.respRate) });
  if (v.sugar != null) {
    const kind = SUGAR_KIND[v.sugarType ?? "random"];
    items.push({ text: `Sugar ${v.sugar}`, spoken: `blood sugar ${v.sugar}`, flag: flagOf(VITAL_SPECS[kind], v.sugar) });
  }
  if (v.weight != null) items.push({ text: `${v.weight} kg`, spoken: `weight ${v.weight} kilograms`, flag: "normal" });
  return items;
}

/**
 * The inline summary: at most three items. Flagged items come first (a high BP is never hidden behind a normal pulse),
 * then the display order.
 */
export function summarizeVitals(v: VitalsReading, max = 3): { shown: SummaryItem[]; all: SummaryItem[] } {
  const all = vitalsItems(v);
  const flagged = all.filter((i) => i.flag !== "normal");
  const normal = all.filter((i) => i.flag === "normal");
  return { shown: [...flagged, ...normal].slice(0, max), all };
}
