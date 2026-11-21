/**
 * The fixed lists behind the consult's tap-first entry (V2-09b 09B-03, R-9). Static data, no import: the sections, the ranking and the tests read it.
 *
 * Sources, so a reviewer can find each string:
 *  - complaints: the approved V2-DX prototype (`.planning/sketches/004-consult/consult.js`, COMPLAINTS) plus the two v1 chips it does not carry
 *    ("Cold & Congestion", "Loss of Appetite"; v1 `chief-complaints-section.tsx`). Where both name the same complaint the prototype's spelling is kept.
 *  - general signs: v1 `gp-systemic-review.tsx` PICCLE keys, with the prototype's label "Lymph nodes" for lymphadenopathy.
 *  - investigations: v1 `COMMON_INVESTIGATIONS` verbatim, then the prototype's INV_ALL entries that have no v1 equivalent (Dengue NS1, Malaria
 *    antigen, Stool routine, Urine culture).
 *  - advice: v1 `COMMON_ADVICE_CHIPS` verbatim, then the prototype's ADV_ALL entries that have no v1 equivalent (Low salt diet, Walk 30 min daily,
 *    Check BP at home).
 *  - follow-up intervals and complaint durations: the prototype (FU, DUR).
 * Nothing here is clinical logic: these are the words a doctor taps, in a fixed order that the doctor's own history may reorder (assist-ranking.ts).
 */

export const COMPLAINTS: readonly string[] = [
  "Fever",
  "Cough",
  "Cold",
  "Headache",
  "Body ache",
  "Sore throat",
  "Loose stools",
  "Vomiting",
  "Acidity",
  "Giddiness",
  "Abdominal pain",
  "Breathlessness",
  "Weakness",
  "Skin rash",
  "Back pain",
  "Burning urination",
  "Cold & Congestion",
  "Loss of Appetite",
];

/** Complaint duration option pills (prototype DUR): the label, the stored number and unit. */
export const COMPLAINT_DURATIONS = [
  { id: "1d", label: "1d", val: 1, unit: "days" },
  { id: "2d", label: "2d", val: 2, unit: "days" },
  { id: "3d", label: "3d", val: 3, unit: "days" },
  { id: "5d", label: "5d", val: 5, unit: "days" },
  { id: "1w", label: "1w", val: 1, unit: "weeks" },
  { id: "2w", label: "2w", val: 2, unit: "weeks" },
  { id: "1m", label: "1m", val: 1, unit: "months" },
] as const;

export type ComplaintDurationUnit = (typeof COMPLAINT_DURATIONS)[number]["unit"];

/** The duration a complaint tile is added with (v1 behaviour, unchanged); the doctor changes it with the pills. */
export const DEFAULT_COMPLAINT_DURATION = { val: 3, unit: "days" } as const;

/** General signs (PICCLE): the `general_exam` key and the tile label. */
export const GENERAL_SIGNS = [
  { key: "pallor", label: "Pallor" },
  { key: "icterus", label: "Icterus" },
  { key: "cyanosis", label: "Cyanosis" },
  { key: "clubbing", label: "Clubbing" },
  { key: "lymphadenopathy", label: "Lymph nodes" },
  { key: "edema", label: "Edema" },
] as const;

export type GeneralSignKey = (typeof GENERAL_SIGNS)[number]["key"];

export const INVESTIGATIONS: readonly string[] = [
  "Complete Blood Count (CBC)",
  "Fasting Blood Sugar (FBS)",
  "Postprandial Blood Sugar (PPBS)",
  "HbA1c",
  "Thyroid Profile (TSH, T3, T4)",
  "Lipid Profile",
  "Urine Routine & Microscopic",
  "Chest X-Ray (PA View)",
  "Serum Creatinine / KFT",
  "Liver Function Test (LFT)",
  "Serum Electrolytes",
  "Serum Uric Acid",
  "ECG (12-Lead)",
  "Ultrasound Whole Abdomen",
  "Dengue NS1",
  "Malaria antigen",
  "Stool routine",
  "Urine culture",
];

export const ADVICE: readonly string[] = [
  "Warm saline gargles 3-4 times daily",
  "Steam inhalation twice daily",
  "Plenty of oral fluids (3-4 litres/day)",
  "Avoid cold, fried and spicy food",
  "Diabetic diet: low glycemic index, small frequent meals",
  "Soft, easily digestible bland diet",
  "Adequate bed rest for 2-3 days",
  "Avoid heavy lifting and strenuous exertion",
  "Keep wound clean and dry",
  "Take medications strictly after meals",
  "Low salt diet",
  "Walk 30 min daily",
  "Check BP at home",
];

export type FollowUpInterval = "none" | "3_days" | "5_days" | "1_week" | "2_weeks" | "1_month" | "custom";

/** Follow-up interval tiles, in order: the label, and the days added to the clinic's today (null: none or a date the doctor picks). */
export const FOLLOW_UP_INTERVALS: ReadonlyArray<{ id: FollowUpInterval; label: string; days: number | null }> = [
  { id: "none", label: "None", days: null },
  { id: "3_days", label: "3 days", days: 3 },
  { id: "5_days", label: "5 days", days: 5 },
  { id: "1_week", label: "1 week", days: 7 },
  { id: "2_weeks", label: "2 weeks", days: 14 },
  { id: "1_month", label: "1 month", days: 30 },
  { id: "custom", label: "Custom date", days: null },
];

/** The interval tile that matches a gap in days (the doctor's usual, from `consult_assist_context`), or null when no tile does. */
export function intervalForDays(days: number | null | undefined): FollowUpInterval | null {
  if (days === null || days === undefined) return null;
  const hit = FOLLOW_UP_INTERVALS.find((i) => i.days === days);
  return hit ? hit.id : null;
}

/** Days for an interval id (the date is the clinic's today plus this); 0 for `none` and `custom`. */
export function daysForInterval(interval: FollowUpInterval): number {
  return FOLLOW_UP_INTERVALS.find((i) => i.id === interval)?.days ?? 0;
}
