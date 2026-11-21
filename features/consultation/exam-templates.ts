/**
 * The six exam templates of the approved V2-DX consult prototype (`.planning/sketches/004-consult/consult.js`, EXAM_TEMPLATES), copied verbatim:
 * names, the systems, their normal texts and their finding lists (V2-09b 09B-03, R-9, Q-7). Documentation boilerplate that starts normal, is edited per
 * visit and drives no suggestion or diagnosis. Doctor-authored templates are v2.1.
 *
 * `for` names the complaints a template suits: it only orders the template tiles (assist-ranking.ts), it never selects one.
 * `specialty` marks the two templates that are not a structured GP exam: Dental and Child switch the visit's specialty to the existing odontogram and
 * paediatrics tools (their systems are kept here as the prototype has them but are not rendered; the tools replace them).
 */

export interface ExamSystemDef {
  /** The key in `specialty_data.exam.systems`. */
  key: string;
  label: string;
  /** The text the system reads as while it is normal. */
  normal: string;
  /** The finding tiles offered when the system is marked abnormal. */
  findings: readonly string[];
  /** The system asks for a side (Right, Left, Bilateral). */
  side?: boolean;
}

export interface ExamTemplate {
  id: string;
  name: string;
  for: readonly string[];
  systems: readonly ExamSystemDef[];
  specialty?: "dental" | "pediatrics";
}

const RS_FINDINGS = ["Crepts", "Wheeze", "Rhonchi", "Reduced air entry", "Bronchial breathing"] as const;

export const EXAM_TEMPLATES: readonly ExamTemplate[] = [
  {
    id: "fever",
    name: "Fever workup",
    for: ["Fever", "Body ache"],
    systems: [
      { key: "gen", label: "General", normal: "Febrile to touch, no toxic look, hydration adequate", findings: ["Toxic look", "Dehydrated", "Rash", "Throat congested", "Tonsils enlarged"] },
      { key: "cvs", label: "CVS", normal: "S1 S2 normal, no murmur", findings: ["Murmur", "Tachycardia", "Irregular rhythm"] },
      { key: "rs", label: "RS", normal: "Bilateral air entry equal, no added sounds", findings: RS_FINDINGS, side: true },
      { key: "pa", label: "Abdomen", normal: "Soft, non-tender, no organomegaly", findings: ["Tenderness", "Hepatomegaly", "Splenomegaly", "Guarding"] },
    ],
  },
  {
    id: "gp",
    name: "GP general",
    for: ["Headache", "Giddiness", "Weakness", "Back pain"],
    systems: [
      { key: "cvs", label: "CVS", normal: "S1 S2 normal, no murmur", findings: ["Murmur", "Tachycardia", "Irregular rhythm"] },
      { key: "rs", label: "RS", normal: "Bilateral vesicular breath sounds, no added sounds", findings: RS_FINDINGS, side: true },
      { key: "pa", label: "Abdomen", normal: "Soft, non-tender, no organomegaly", findings: ["Tenderness", "Hepatomegaly", "Splenomegaly", "Guarding"] },
      { key: "cns", label: "CNS", normal: "Conscious, oriented, no focal deficit", findings: ["Neck stiffness", "Focal deficit", "Drowsy", "Gait abnormal"] },
    ],
  },
  {
    id: "resp",
    name: "Respiratory",
    for: ["Cough", "Cold", "Sore throat", "Breathlessness"],
    systems: [
      { key: "ent", label: "ENT", normal: "Throat not congested, tonsils normal, no post-nasal drip", findings: ["Throat congested", "Tonsils enlarged", "Post-nasal drip", "Ear drum dull"] },
      { key: "rs", label: "RS", normal: "Bilateral air entry equal, no added sounds", findings: RS_FINDINGS, side: true },
      { key: "cvs", label: "CVS", normal: "S1 S2 normal, no murmur", findings: ["Murmur", "Tachycardia"] },
    ],
  },
  {
    id: "abd",
    name: "Abdomen",
    for: ["Loose stools", "Vomiting", "Abdominal pain", "Acidity"],
    systems: [
      { key: "gen", label: "General", normal: "Hydration adequate, no pallor", findings: ["Dehydrated", "Pallor", "Icterus"] },
      { key: "pa", label: "Abdomen", normal: "Soft, non-tender, bowel sounds normal", findings: ["Epigastric tenderness", "RIF tenderness", "Guarding", "Distension", "Hepatomegaly"] },
      { key: "cvs", label: "CVS", normal: "S1 S2 normal", findings: ["Tachycardia"] },
    ],
  },
  {
    id: "dental",
    name: "Dental",
    for: [],
    specialty: "dental",
    systems: [{ key: "oral", label: "Oral cavity", normal: "No caries, gingiva healthy, no mobility", findings: ["Caries", "Gingivitis", "Mobility", "Abscess"] }],
  },
  {
    id: "child",
    name: "Child",
    for: [],
    specialty: "pediatrics",
    systems: [
      { key: "gen", label: "General", normal: "Active, playful, well hydrated", findings: ["Lethargic", "Dehydrated", "Rash"] },
      { key: "rs", label: "RS", normal: "No distress, air entry equal", findings: ["Retractions", "Wheeze", "Crepts"], side: true },
    ],
  },
];

/** The structured GP templates (the four that write `specialty_data.exam`). */
export const GP_EXAM_TEMPLATES: readonly ExamTemplate[] = EXAM_TEMPLATES.filter((t) => !t.specialty);

export function examTemplateById(id: string | null | undefined): ExamTemplate | null {
  return EXAM_TEMPLATES.find((t) => t.id === id) ?? null;
}
