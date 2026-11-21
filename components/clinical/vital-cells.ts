import type { Vitals } from "@/features/consultation/schema";
import { flagOf, VITAL_SPECS, type VitalFlag } from "@/lib/clinical/vitals";

/**
 * The six cells of the vitals grid (BP, pulse, temperature, SpO2, weight, respiratory rate) with the range flag of each value (V2-09b 09B-02b, AI-16).
 * Shared by the consult's patient context and the patient snapshot. Pure.
 */
export interface VitalCell {
  label: string;
  value: string | null;
  flag: VitalFlag;
}

function worseOf(a: VitalFlag, b: VitalFlag): VitalFlag {
  const rank: Record<VitalFlag, number> = { normal: 0, low: 1, high: 1, "critical-low": 2, "critical-high": 2 };
  return rank[b] > rank[a] ? b : a;
}

/** The six cells of the grid, in order; a value not recorded draws a dash. */
export function vitalCells(v: Vitals | null): VitalCell[] {
  const bp =
    v?.systolic != null && v?.diastolic != null
      ? { value: `${v.systolic}/${v.diastolic}`, flag: worseOf(flagOf(VITAL_SPECS.systolic, v.systolic), flagOf(VITAL_SPECS.diastolic, v.diastolic)) }
      : { value: null, flag: "normal" as VitalFlag };
  const one = (value: number | null | undefined, spec: (typeof VITAL_SPECS)[keyof typeof VITAL_SPECS], text: string): Pick<VitalCell, "value" | "flag"> =>
    value == null ? { value: null, flag: "normal" } : { value: text, flag: flagOf(spec, value) };
  return [
    { label: "BP", ...bp },
    { label: "Pulse", ...one(v?.pulse, VITAL_SPECS.pulse, `${v?.pulse}`) },
    { label: "Temp °F", ...one(v?.temperature, VITAL_SPECS.temperatureF, `${v?.temperature}`) },
    { label: "SpO₂ %", ...one(v?.spo2, VITAL_SPECS.spo2, `${v?.spo2}`) },
    { label: "Weight kg", value: v?.weight != null ? `${v.weight}` : null, flag: "normal" },
    { label: "Resp /min", ...one(v?.respiratory_rate, VITAL_SPECS.respRate, `${v?.respiratory_rate}`) },
  ];
}

