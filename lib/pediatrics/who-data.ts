/**
 * WHO Child Growth Standards (LMS Parameters) & IAP Immunization Schedule.
 * Reference: World Health Organization Multicentre Growth Reference Study.
 * LMS method: L (Box-Cox power/skewness), M (Median/50th percentile), S (Coefficient of variation).
 */

export interface LmsParams {
  l: number;
  m: number;
  s: number;
}

export type Gender = "male" | "female";
export type MetricType = "weight" | "height" | "head_circumference";

export interface WhoGrowthInput {
  ageMonths: number;
  gender: Gender;
  metric: MetricType;
  value: number;
}

export type GrowthBadgeCategory =
  | "underweight"
  | "stunted"
  | "microcephaly"
  | "below_average"
  | "normal"
  | "above_average"
  | "overweight"
  | "tall"
  | "macrocephaly";

export interface WhoGrowthResult {
  zScore: number;
  percentile: number; // 0 to 100
  badgeCategory: GrowthBadgeCategory;
  label: string;
  variant: "default" | "success" | "warning" | "error";
}

// High-precision standard normal error function approximation (Abramowitz & Stegun formula 7.1.26)
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Standard WHO Child Growth LMS Tables (0 - 60 Months).
 * Representative milestone values sampled at 0, 1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60 months.
 */
export const WHO_LMS_TABLES: Record<
  Gender,
  Record<MetricType, { months: number[]; l: number[]; m: number[]; s: number[] }>
> = {
  male: {
    weight: {
      months: [0, 1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60],
      l: [0.3487, 0.2297, 0.1479, 0.0888, -0.0135, -0.0768, -0.1189, -0.1583, -0.1600, -0.1437, -0.1082, -0.0617],
      m: [3.346, 4.471, 5.577, 6.402, 7.935, 8.923, 9.676, 10.938, 12.200, 14.338, 16.326, 18.252],
      s: [0.1460, 0.1339, 0.1243, 0.1172, 0.1066, 0.1041, 0.1048, 0.1078, 0.1105, 0.1167, 0.1235, 0.1306],
    },
    height: {
      months: [0, 1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60],
      l: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      m: [49.88, 54.72, 58.42, 61.43, 67.62, 71.96, 75.75, 82.31, 87.82, 96.08, 103.31, 109.95],
      s: [0.0379, 0.0355, 0.0345, 0.0339, 0.0326, 0.0325, 0.0330, 0.0345, 0.0357, 0.0372, 0.0384, 0.0395],
    },
    head_circumference: {
      months: [0, 1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60],
      l: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      m: [34.50, 36.90, 38.80, 40.30, 43.10, 44.80, 46.00, 47.40, 48.30, 49.50, 50.40, 51.00],
      s: [0.0350, 0.0330, 0.0320, 0.0310, 0.0290, 0.0290, 0.0290, 0.0300, 0.0300, 0.0300, 0.0310, 0.0310],
    },
  },
  female: {
    weight: {
      months: [0, 1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60],
      l: [0.3809, 0.2574, 0.1706, 0.1066, -0.0108, -0.0817, -0.1298, -0.1770, -0.1800, -0.1651, -0.1287, -0.0805],
      m: [3.232, 4.187, 5.128, 5.845, 7.297, 8.247, 8.949, 10.155, 11.480, 13.854, 16.071, 18.237],
      s: [0.1417, 0.1340, 0.1257, 0.1193, 0.1085, 0.1054, 0.1057, 0.1090, 0.1120, 0.1190, 0.1265, 0.1345],
    },
    height: {
      months: [0, 1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60],
      l: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      m: [49.14, 53.69, 57.07, 59.84, 65.73, 70.14, 74.02, 80.73, 86.37, 95.10, 102.70, 109.40],
      s: [0.0379, 0.0357, 0.0347, 0.0341, 0.0329, 0.0328, 0.0334, 0.0350, 0.0363, 0.0380, 0.0392, 0.0402],
    },
    head_circumference: {
      months: [0, 1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60],
      l: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      m: [33.88, 36.19, 37.98, 39.46, 42.15, 43.83, 44.97, 46.40, 47.30, 48.60, 49.50, 50.10],
      s: [0.0350, 0.0330, 0.0320, 0.0310, 0.0290, 0.0290, 0.0290, 0.0300, 0.0300, 0.0300, 0.0310, 0.0310],
    },
  },
};

/**
 * Linearly interpolates L, M, S parameters for a given age in months.
 */
export function getLmsParams(gender: Gender, metric: MetricType, ageMonths: number): LmsParams {
  const table = WHO_LMS_TABLES[gender][metric];
  const clampedAge = Math.max(0, Math.min(60, ageMonths));

  const idx = table.months.findIndex((m) => m >= clampedAge);
  if (idx === 0) {
    return { l: table.l[0], m: table.m[0], s: table.s[0] };
  }
  if (idx === -1) {
    const last = table.months.length - 1;
    return { l: table.l[last], m: table.m[last], s: table.s[last] };
  }

  const prevIdx = idx - 1;
  const t = (clampedAge - table.months[prevIdx]) / (table.months[idx] - table.months[prevIdx]);

  return {
    l: table.l[prevIdx] + t * (table.l[idx] - table.l[prevIdx]),
    m: table.m[prevIdx] + t * (table.m[idx] - table.m[prevIdx]),
    s: table.s[prevIdx] + t * (table.s[idx] - table.s[prevIdx]),
  };
}

/**
 * Calculates WHO Child Growth Percentile and Z-score using the exact LMS formulation.
 */
export function calculateWhoGrowthPercentile(input: WhoGrowthInput): WhoGrowthResult {
  const { ageMonths, gender, metric, value } = input;
  const { l, m, s } = getLmsParams(gender, metric, ageMonths);

  let zScore: number;
  if (Math.abs(l) < 0.001) {
    zScore = Math.log(value / m) / s;
  } else {
    zScore = (Math.pow(value / m, l) - 1) / (l * s);
  }

  const percentile = Math.min(99.9, Math.max(0.1, normalCdf(zScore) * 100));

  let badgeCategory: GrowthBadgeCategory;
  let variant: "default" | "success" | "warning" | "error";
  let label: string;

  const roundedPct = Math.round(percentile);

  if (percentile < 3) {
    variant = "error";
    if (metric === "weight") {
      badgeCategory = "underweight";
      label = `Underweight (<3rd %ile)`;
    } else if (metric === "height") {
      badgeCategory = "stunted";
      label = `Stunted (<3rd %ile)`;
    } else {
      badgeCategory = "microcephaly";
      label = `Microcephaly (<3rd %ile)`;
    }
  } else if (percentile < 15) {
    variant = "warning";
    badgeCategory = "below_average";
    label = `Below Average (${roundedPct}th %ile)`;
  } else if (percentile <= 85) {
    variant = "success";
    badgeCategory = "normal";
    label = `Normal (${roundedPct}th %ile)`;
  } else if (percentile <= 97) {
    variant = "warning";
    badgeCategory = "above_average";
    label = `Above Average (${roundedPct}th %ile)`;
  } else {
    variant = "error";
    if (metric === "weight") {
      badgeCategory = "overweight";
      label = `Overweight / Obese (>97th %ile)`;
    } else if (metric === "height") {
      badgeCategory = "tall";
      label = `Very Tall (>97th %ile)`;
    } else {
      badgeCategory = "macrocephaly";
      label = `Macrocephaly (>97th %ile)`;
    }
  }

  return {
    zScore: Number(zScore.toFixed(2)),
    percentile: Number(percentile.toFixed(1)),
    badgeCategory,
    label,
    variant,
  };
}

export interface VaccineMilestone {
  id: string;
  ageLabel: string;
  vaccines: { code: string; name: string; description?: string }[];
}

export const IAP_IMMUNIZATION_SCHEDULE: VaccineMilestone[] = [
  {
    id: "birth",
    ageLabel: "Birth",
    vaccines: [
      { code: "BCG", name: "BCG", description: "Bacillus Calmette-Guérin (Tuberculosis)" },
      { code: "OPV_0", name: "OPV 0", description: "Oral Polio Vaccine" },
      { code: "HEP_B_1", name: "Hepatitis B 1", description: "Within 24 hours of birth" },
    ],
  },
  {
    id: "6w",
    ageLabel: "6 Weeks",
    vaccines: [
      { code: "DTWP_1", name: "DTwP / DTaP 1", description: "Diphtheria, Tetanus, Pertussis" },
      { code: "IPV_1", name: "IPV 1", description: "Inactivated Polio Vaccine" },
      { code: "HEP_B_2", name: "Hepatitis B 2", description: "Dose 2" },
      { code: "HIB_1", name: "Hib 1", description: "Haemophilus influenzae type b" },
      { code: "ROTA_1", name: "Rotavirus 1", description: "Diarrheal protection" },
      { code: "PCV_1", name: "PCV 1", description: "Pneumococcal Conjugate Vaccine" },
    ],
  },
  {
    id: "10w",
    ageLabel: "10 Weeks",
    vaccines: [
      { code: "DTWP_2", name: "DTwP / DTaP 2", description: "Diphtheria, Tetanus, Pertussis" },
      { code: "IPV_2", name: "IPV 2", description: "Inactivated Polio Vaccine" },
      { code: "HIB_2", name: "Hib 2", description: "Dose 2" },
      { code: "ROTA_2", name: "Rotavirus 2", description: "Dose 2" },
      { code: "PCV_2", name: "PCV 2", description: "Pneumococcal Dose 2" },
    ],
  },
  {
    id: "14w",
    ageLabel: "14 Weeks",
    vaccines: [
      { code: "DTWP_3", name: "DTwP / DTaP 3", description: "Diphtheria, Tetanus, Pertussis" },
      { code: "IPV_3", name: "IPV 3", description: "Inactivated Polio Vaccine" },
      { code: "HIB_3", name: "Hib 3", description: "Dose 3" },
      { code: "ROTA_3", name: "Rotavirus 3", description: "Dose 3" },
      { code: "PCV_3", name: "PCV 3", description: "Pneumococcal Dose 3" },
    ],
  },
  {
    id: "6m",
    ageLabel: "6 Months",
    vaccines: [
      { code: "INFLUENZA_1", name: "Influenza 1", description: "Annual Flu vaccine dose 1" },
      { code: "TCV", name: "Typhoid Conjugate (TCV)", description: "Typhoid protection" },
    ],
  },
  {
    id: "9m",
    ageLabel: "9 Months",
    vaccines: [
      { code: "MMR_1", name: "MMR 1", description: "Measles, Mumps, Rubella" },
      { code: "OPV_1", name: "OPV 1", description: "Oral Polio Booster" },
    ],
  },
  {
    id: "12m",
    ageLabel: "12 Months",
    vaccines: [
      { code: "HEP_A_1", name: "Hepatitis A 1", description: "Dose 1 (Live or Inactivated)" },
    ],
  },
  {
    id: "15m",
    ageLabel: "15 Months",
    vaccines: [
      { code: "MMR_2", name: "MMR 2", description: "Measles, Mumps, Rubella Dose 2" },
      { code: "VARICELLA_1", name: "Varicella 1", description: "Chickenpox Dose 1" },
      { code: "PCV_B", name: "PCV Booster", description: "Pneumococcal Booster" },
    ],
  },
  {
    id: "18m",
    ageLabel: "18 Months",
    vaccines: [
      { code: "DTWP_B1", name: "DTwP / DTaP B1", description: "First Booster" },
      { code: "IPV_B1", name: "IPV B1", description: "Polio Booster" },
      { code: "HIB_B1", name: "Hib B1", description: "Hib Booster" },
      { code: "HEP_A_2", name: "Hepatitis A 2", description: "Dose 2 (if inactivated)" },
    ],
  },
  {
    id: "2y",
    ageLabel: "2 Years",
    vaccines: [
      { code: "TYPHOID_B", name: "Typhoid Booster", description: "If polysaccharide vaccine used" },
    ],
  },
  {
    id: "5y",
    ageLabel: "5 Years",
    vaccines: [
      { code: "DTWP_B2", name: "DTwP / DTaP B2", description: "Second Booster" },
      { code: "MMR_3", name: "MMR 3", description: "Third MMR dose" },
      { code: "VARICELLA_2", name: "Varicella 2", description: "Chickenpox Dose 2" },
    ],
  },
  {
    id: "10y",
    ageLabel: "10 Years",
    vaccines: [
      { code: "TDAP", name: "Tdap / Td", description: "Tetanus, Diphtheria, Pertussis booster" },
      { code: "HPV", name: "HPV (Human Papillomavirus)", description: "Recommended for adolescent girls" },
    ],
  },
];
