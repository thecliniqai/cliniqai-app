import type { DiagnosisSpecialty } from "./search";

/**
 * The fixed OPD diagnosis chips of each specialty (the v1 consult's "Quick OPD Diagnoses", moved here unchanged by V2-09b 09B-04a). They are the fallback
 * the consult shows when there is no learned history to offer (not entitled to `assist.terminology`, or a doctor with no signed visit yet); the codes are
 * the ones v1 stored with them. Static data: no clinical logic.
 */
export interface QuickDiagnosis {
  name: string;
  icd11?: string;
  snomed?: string;
  isChronic?: boolean;
}

export const SPECIALTY_QUICK_DIAGNOSES: Record<DiagnosisSpecialty, QuickDiagnosis[]> = {
  general_physician: [
    { name: "Acute Upper Respiratory Tract Infection", icd11: "CA40", snomed: "54150009" },
    { name: "Viral Fever", icd11: "MG26", snomed: "386661006" },
    { name: "Acute Gastroenteritis", icd11: "1A40.0", snomed: "442436004" },
    { name: "Essential Hypertension", icd11: "BA00", snomed: "59621000", isChronic: true },
    { name: "Type 2 Diabetes Mellitus", icd11: "5A11", snomed: "44054006", isChronic: true },
    { name: "Acute Bronchitis", icd11: "CA42", snomed: "10509002" },
    { name: "Allergic Rhinitis", icd11: "CA08.0", snomed: "61582004" },
    { name: "Migraine", icd11: "8A80", snomed: "37796009" },
  ],
  dental: [
    { name: "Dental Caries", icd11: "DA08.0", snomed: "80967001" },
    { name: "Gingivitis", icd11: "DA01.0", snomed: "66383009" },
    { name: "Pulpitis", icd11: "DA02.0", snomed: "78848006" },
    { name: "Chronic Periodontitis", icd11: "DA01.1", snomed: "235003009", isChronic: true },
    { name: "Periapical Abscess", icd11: "DA02.2", snomed: "55129006" },
    { name: "Impacted Tooth", icd11: "DA07.0", snomed: "37163004" },
    { name: "Aphthous Stomatitis", icd11: "DA03.0", snomed: "427617000" },
    { name: "Tooth Wear / Attrition", icd11: "DA08.2", snomed: "234976004" },
  ],
  pediatrics: [
    { name: "Acute Upper Respiratory Tract Infection", icd11: "CA40", snomed: "54150009" },
    { name: "Viral Gastroenteritis", icd11: "1A40.0", snomed: "442436004" },
    { name: "Acute Bronchiolitis", icd11: "CA43", snomed: "420038006" },
    { name: "Acute Otitis Media", icd11: "AA00", snomed: "65363002" },
    { name: "Febrile Convulsion", icd11: "8A68.0", snomed: "41497008" },
    { name: "Chickenpox (Varicella)", icd11: "1E90", snomed: "38907003" },
    { name: "Hand, Foot and Mouth Disease", icd11: "1F03", snomed: "70417006" },
    { name: "Childhood Asthma", icd11: "CA23", snomed: "195967001", isChronic: true },
  ],
};
