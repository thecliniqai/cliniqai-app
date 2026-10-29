import { tool } from "ai";
import { z } from "zod";
import { assertRoleAllowed } from "./operations-tools";
import { generatePatientCatchUpSummary } from "../catch-up-summary";

export interface ClinicalToolsContext {
  tenantId: string;
  userId: string;
  role: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
}

const CURATED_ICD10_LIST = [
  {
    code: "J06.9",
    description: "Acute upper respiratory infection, unspecified",
    differential_criteria:
      "When upper airway symptoms (coryza, sore throat, sneezing) dominate without focal lung signs.",
    keywords: ["urti", "cold", "cough", "upper respiratory", "sore throat", "fever"],
  },
  {
    code: "J00",
    description: "Acute nasopharyngitis [common cold]",
    differential_criteria:
      "When predominant presentation is profuse rhinorrhea, nasal obstruction, and afebrile/low-grade coryza.",
    keywords: ["nasopharyngitis", "common cold", "rhinorrhea", "runny nose"],
  },
  {
    code: "J20.9",
    description: "Acute bronchitis, unspecified",
    differential_criteria:
      "When productive cough and rhonchi/wheezing persist post-viral infection without baseline COPD.",
    keywords: ["bronchitis", "productive cough", "chest cough"],
  },
  {
    code: "I10",
    description: "Essential (primary) hypertension",
    differential_criteria:
      "When sustained clinic SBP >= 140 or DBP >= 90 mmHg without secondary identifiable etiology.",
    keywords: ["hypertension", "bp", "high blood pressure", "essential hypertension"],
  },
  {
    code: "E11.9",
    description: "Type 2 diabetes mellitus without complications",
    differential_criteria:
      "When fasting glucose >= 126 mg/dL or HbA1c >= 6.5% with no macro/microvascular end-organ damage.",
    keywords: ["diabetes", "t2dm", "sugar", "type 2 diabetes", "hyperglycemia"],
  },
  {
    code: "A09",
    description: "Infectious gastroenteritis and colitis, unspecified",
    differential_criteria:
      "When acute loose stools (>3/day) with nausea/vomiting indicate acute infectious etiology.",
    keywords: ["gastroenteritis", "diarrhea", "loose stools", "stomach infection", "vomiting"],
  },
  {
    code: "K21.9",
    description: "Gastro-esophageal reflux disease without esophagitis",
    differential_criteria:
      "When retrosternal heartburn or acid regurgitation responds to PPI without documented endoscopic mucosal breaks.",
    keywords: ["gerd", "acid reflux", "heartburn", "acidity", "reflux"],
  },
  {
    code: "J45.9",
    description: "Other and unspecified asthma",
    differential_criteria:
      "When reversible bronchospasm, recurrent expiratory wheezing, and nocturnal cough occur with atopy.",
    keywords: ["asthma", "wheezing", "bronchial asthma", "breathlessness"],
  },
  {
    code: "G44.2",
    description: "Tension-type headache",
    differential_criteria:
      "When band-like bilateral pressing headache lacks migraine features (nausea, photophobia, aura).",
    keywords: ["headache", "tension headache", "head pain"],
  },
  {
    code: "N39.0",
    description: "Urinary tract infection, site not specified",
    differential_criteria:
      "When dysuria, urinary frequency, and pyuria occur without loin pain or high-grade systemic sepsis.",
    keywords: ["uti", "urinary infection", "dysuria", "burning urination"],
  },
  {
    code: "J02.9",
    description: "Acute pharyngitis, unspecified",
    differential_criteria:
      "When acute throat soreness and tonsillar erythema occur without lower respiratory adventitious sounds.",
    keywords: ["pharyngitis", "sore throat", "throat pain", "throat infection"],
  },
  {
    code: "H66.9",
    description: "Otitis media, unspecified",
    differential_criteria:
      "When otalgia, ear discharge, or erythematous tympanic membrane indicate middle ear inflammation.",
    keywords: ["otitis", "otitis media", "ear pain", "ear discharge", "middle ear"],
  },
];

export function getClinicalTools(context: ClinicalToolsContext) {
  const { tenantId, role, supabase } = context;

  return {
    suggest_icd10: tool({
      description:
        "Suggest up to 4 ranked ICD-10 diagnostic codes with 1-line differential criteria bullets ('When to choose')",
      parameters: z.object({
        query: z.string().min(2).describe("Clinical condition or shorthand diagnosis (e.g., 'fever with cough', 'type 2 diabetes')"),
        specialty: z.string().optional().describe("Clinical specialty context (e.g., 'general_physician', 'pediatrics')"),
      }),
      execute: async ({ query }) => {
        // Strict RBAC: only doctor, admin, or owner can request diagnostic coding
        assertRoleAllowed(role, ["doctor", "admin", "owner"]);

        const cleanQuery = query.toLowerCase().trim();

        // Check if database has opd_diagnoses
        if (supabase) {
          const { data: dbDiagnoses } = await supabase
            .from("opd_diagnoses")
            .select("name, icd11_code, category, synonyms")
            .or(`name.ilike.%${cleanQuery}%,category.ilike.%${cleanQuery}%`)
            .limit(4);

          if (dbDiagnoses && dbDiagnoses.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const candidates = dbDiagnoses.map((d: any) => ({
              code: d.icd11_code || "R69",
              description: d.name,
              differential_criteria: `Select when presentation aligns with documented ${d.category || d.name}.`,
            }));

            return {
              query,
              candidates,
            };
          }
        }

        // Match against curated list
        const matches = CURATED_ICD10_LIST.filter(
          (item) =>
            item.keywords.some((k) => cleanQuery.includes(k)) ||
            item.description.toLowerCase().includes(cleanQuery) ||
            cleanQuery.includes(item.code.toLowerCase())
        );

        const candidates = (matches.length > 0 ? matches : CURATED_ICD10_LIST.slice(0, 3)).slice(0, 4).map((c) => ({
          code: c.code,
          description: c.description,
          differential_criteria: c.differential_criteria,
        }));

        return {
          query,
          candidates,
        };
      },
    }),

    get_catch_up_summary: tool({
      description:
        "Generate a 3-bullet clinical brief for returning patients synthesizing longitudinal history",
      parameters: z.object({
        patient_id: z.string().uuid().describe("Target patient UUID"),
      }),
      execute: async ({ patient_id }) => {
        assertRoleAllowed(role, ["doctor", "nurse", "admin", "owner"]);

        const summary = await generatePatientCatchUpSummary({
          tenantId,
          patientId: patient_id,
          clientOverride: supabase,
        });

        return summary;
      },
    }),
  };
}
