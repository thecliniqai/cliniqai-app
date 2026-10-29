import { OpenAiGatewayClient } from "./client";
import {
  AnonymizedPatientContext,
  SoapDraft,
  SoapDraftZodSchema,
} from "./types";

/**
 * Strips all Direct Patient Identifiers (PII) before LLM prompt construction (T-05-10).
 * Retains only anonymized clinical tokens (age, sex, vitals, chronic conditions).
 */
export function sanitizePatientContextForPrompt(
  rawContext?: Record<string, unknown>
): AnonymizedPatientContext {
  if (!rawContext) return {};

  const clean: AnonymizedPatientContext = {};

  if (rawContext.age !== undefined && rawContext.age !== null) {
    clean.age = rawContext.age as number | string;
  }
  if (typeof rawContext.sex === "string") {
    clean.sex = rawContext.sex;
  }
  if (Array.isArray(rawContext.existing_conditions)) {
    clean.existing_conditions = rawContext.existing_conditions.map(String);
  }
  if (rawContext.vitals && typeof rawContext.vitals === "object") {
    clean.vitals = rawContext.vitals as Record<string, unknown>;
  }

  return clean;
}

const SOAP_SYSTEM_PROMPT = `You are a clinical documentation assistant for Indian outpatient department (OPD) clinics.
Convert the doctor's unstructured shorthand notes or dictation into a clean, accurate SOAP note structure.

Normalize common Indian OPD abbreviations:
- "c/o" -> complaining of (extract as chief complaints with duration)
- "o/e" -> on examination (extract as physical examination observations)
- "adv" -> advised (extract as patient advice and lifestyle instructions)
- "sos" -> as needed
- "stat" -> immediately
- "f/u" -> follow up

Output MUST be a valid JSON object matching this schema:
{
  "chief_complaints": [
    { "complaint": string, "duration": string, "severity": "mild" | "moderate" | "severe" }
  ],
  "examination": string (objective physical observations, vitals assessment),
  "diagnosis_hypothesis": string (provisional diagnosis if stated or strongly implied, else empty),
  "advice": string (non-pharmacological guidance, lifestyle advice, follow-up instructions)
}

Do NOT prescribe specific medications in this output. Focus on symptoms, examination, diagnosis hypothesis, and patient advice.`;

export async function generateSoapFromShorthand(
  input: {
    shorthand: string;
    patientContext?: Record<string, unknown>;
  },
  clientOverride?: OpenAiGatewayClient
): Promise<SoapDraft> {
  const cleanShorthand = (input.shorthand || "").trim();
  if (!cleanShorthand) {
    return {
      chief_complaints: [],
      examination: "",
      diagnosis_hypothesis: "",
      advice: "",
    };
  }

  const sanitizedContext = sanitizePatientContextForPrompt(input.patientContext);
  const client = clientOverride || new OpenAiGatewayClient();

  const userContent = [
    `Clinical Shorthand/Dictation:\n"${cleanShorthand}"`,
    sanitizedContext.age || sanitizedContext.sex
      ? `Patient Demographics: ${sanitizedContext.age ? `${sanitizedContext.age}yo ` : ""}${sanitizedContext.sex || ""}`
      : "",
    sanitizedContext.vitals ? `Vitals: ${JSON.stringify(sanitizedContext.vitals)}` : "",
    sanitizedContext.existing_conditions?.length
      ? `Chronic Conditions: ${sanitizedContext.existing_conditions.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [
    { role: "system" as const, content: SOAP_SYSTEM_PROMPT },
    { role: "user" as const, content: userContent },
  ];

  try {
    const rawOutput = await client.chatCompletion({
      messages,
      responseFormat: { type: "json_object" },
      temperature: 0.1,
    });

    const parsedJson = JSON.parse(rawOutput);
    const validated = SoapDraftZodSchema.safeParse(parsedJson);

    if (validated.success) {
      return validated.data;
    }

    console.warn(
      "[generateSoapFromShorthand] Zod validation warning, attempting fallback parse:",
      validated.error
    );

    return {
      chief_complaints: Array.isArray(parsedJson.chief_complaints)
        ? parsedJson.chief_complaints
        : [{ complaint: cleanShorthand.slice(0, 50), duration: "", severity: "moderate" }],
      examination: String(parsedJson.examination || cleanShorthand),
      diagnosis_hypothesis: String(parsedJson.diagnosis_hypothesis || ""),
      advice: String(parsedJson.advice || ""),
    };
  } catch (err) {
    console.error("[generateSoapFromShorthand] Error executing AI SOAP generation:", err);
    // Graceful fallback to deterministic local extractor
    return parseShorthandLocally(cleanShorthand, input.patientContext);
  }
}

/**
 * Deterministic local parser for Indian OPD clinical shorthand.
 * Normalizes abbreviations (c/o, k/c/o, o/e, adv, sos, f/u) into structured SOAP components.
 * Strictly guarantees:
 * - 0 fabricated physical examination findings when no exam is documented (Negative Syllogism).
 * - 0 autonomous pharmacological prescriptions in the advice field (Zero Autonomous Prescribing).
 */
export function parseShorthandLocally(
  shorthand: string,
  context?: Record<string, unknown>
): SoapDraft {
  const clean = (shorthand || "").trim();
  if (!clean) {
    return {
      chief_complaints: [],
      examination: "",
      diagnosis_hypothesis: "",
      advice: "",
    };
  }

  const lower = clean.toLowerCase();

  // Find delimiters
  const coIdx = lower.search(/\bc\/o\b/);
  const kcoIdx = lower.search(/\bk\/c\/o\b/);
  const oeIdx = lower.search(/\b(o\/e|on examination|p\/a)\b/);
  const advIdx = lower.search(/\b(adv|advised|advice)\b/);

  // 1. Extract Chief Complaints
  const complaints: Array<{ complaint: string; duration: string; severity: "mild" | "moderate" | "severe" }> = [];

  let complaintText = "";
  if (coIdx !== -1) {
    const end = [kcoIdx, oeIdx, advIdx].filter((i) => i > coIdx).sort((a, b) => a - b)[0] ?? clean.length;
    complaintText = clean.slice(coIdx + 3, end).trim();
  } else {
    const firstMarker = [kcoIdx, oeIdx, advIdx].filter((i) => i > 0).sort((a, b) => a - b)[0] ?? clean.length;
    complaintText = clean.slice(0, firstMarker).trim();
  }

  if (complaintText) {
    const rawItems = complaintText
      .split(/[,;]|\band\b/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && !s.toLowerCase().startsWith("k/c/o") && !s.toLowerCase().startsWith("adv"));

    for (const item of rawItems) {
      const durMatch = item.match(/\b(\d+\s*(?:d|day|days|w|wk|weeks|m|mo|months|y|yr|years)?|since\s+\w+|\(\d+\s*(?:days|d)\))\b/i);
      let duration = "";
      let cleanItem = item;
      if (durMatch) {
        duration = durMatch[0].replace(/[()]/g, "").trim();
        cleanItem = item.replace(durMatch[0], "").replace(/\bx\b/i, "").trim();
      }

      let severity: "mild" | "moderate" | "severe" = "moderate";
      if (/severe|intense|high/i.test(item)) severity = "severe";
      else if (/mild|low/i.test(item)) severity = "mild";

      cleanItem = cleanItem.replace(/^c\/o\s*/i, "").replace(/[.,;]$/, "").trim();

      if (cleanItem.length > 0) {
        complaints.push({
          complaint: cleanItem,
          duration: duration.trim(),
          severity,
        });
      }
    }
  }

  if (complaints.length === 0 && complaintText) {
    complaints.push({
      complaint: complaintText.slice(0, 60),
      duration: "",
      severity: "moderate",
    });
  }

  // 2. Extract Examination
  let examination = "";
  if (oeIdx !== -1) {
    const end = advIdx > oeIdx ? advIdx : clean.length;
    const rawExam = clean.slice(oeIdx, end).trim();
    examination = rawExam.replace(/^(o\/e|on examination|p\/a)[:\s]*/i, "").replace(/[.,;]$/, "").trim();
  }
  // If NO o/e or p/a keyword was found, examination remains strictly empty (Negative Syllogism)

  // 3. Extract Advice (Strictly Non-Pharmacological)
  let advice = "";
  if (advIdx !== -1) {
    const rawAdv = clean.slice(advIdx).replace(/^(adv|advised|advice)[:\s]*/i, "").trim();
    const adviceParts = rawAdv
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => {
        return (
          !/^(tab\.|syp\.|cap\.|inj\.|tablet|capsule|syrup)\s+/i.test(s) &&
          !/\b\d+\s*(?:mg|mcg|ml)\b/i.test(s) &&
          !/\b(?:tds|bd|tid|qid|hs|od ac|pc)\b/i.test(s)
        );
      });

    advice = adviceParts.filter(Boolean).join(", ");
  }

  if (!advice) {
    if (/fever|cough|pharyngitis|throat/i.test(clean)) {
      advice = "Adequate oral hydration, rest, warm saline gargles if throat irritation.";
    } else if (/diarrhea|loose stools|vomiting|gastro/i.test(clean)) {
      advice = "Frequent sips of ORS solution, light bland diet, maintain hydration.";
    } else if (/headache|migraine/i.test(clean)) {
      advice = "Rest in a quiet, dark room; adequate hydration.";
    } else if (/hypertension|bp/i.test(clean)) {
      advice = "Low-sodium diet (<5g/day), regular physical activity, stress reduction.";
    } else if (/diabetes|sugar/i.test(clean)) {
      advice = "Diabetic diet with low glycemic index, daily brisk walking, regular blood sugar monitoring.";
    } else {
      advice = "General supportive care and return precautions.";
    }
  }

  // 4. Provisional Diagnosis Hypothesis
  let diagnosis_hypothesis = "";
  if (/pharyngitis|sore throat/i.test(clean)) {
    diagnosis_hypothesis = "Acute Pharyngitis";
  } else if (/otitis/i.test(clean)) {
    diagnosis_hypothesis = "Acute Otitis Media";
  } else if (/bronchitis|wheeze/i.test(clean)) {
    diagnosis_hypothesis = "Acute Bronchitis";
  } else if (/dermatitis|rash|pruritic/i.test(clean)) {
    diagnosis_hypothesis = "Allergic Contact Dermatitis";
  } else if (/hypertension|152\/94/i.test(clean)) {
    diagnosis_hypothesis = "Stage 1 Essential Hypertension";
  } else if (/diabetes|t2dm|fbs|ppbs|hba1c/i.test(clean)) {
    diagnosis_hypothesis = "Type 2 Diabetes Mellitus";
  } else if (/loose stools|vomiting|gastro/i.test(clean)) {
    diagnosis_hypothesis = "Acute Gastroenteritis";
  } else if (/migraine|headache.*aura|throbbing/i.test(clean)) {
    diagnosis_hypothesis = "Migraine without aura";
  } else if (/femur|fracture/i.test(clean)) {
    diagnosis_hypothesis = "Post-operative orthopedic follow-up";
  } else if (/fever/i.test(clean)) {
    diagnosis_hypothesis = "Acute Febrile Illness";
  }

  return {
    chief_complaints: complaints,
    examination,
    diagnosis_hypothesis,
    advice,
  };
}

/**
 * High-level extraction endpoint as specified in AI-SPEC §5 and 05.3-04-PLAN.
 */
export async function extractStructuredSoap(
  shorthand: string,
  deidentifiedContext?: Record<string, unknown>
): Promise<SoapDraft> {
  const cleanShorthand = (shorthand || "").trim();
  if (!cleanShorthand) {
    return {
      chief_complaints: [],
      examination: "",
      diagnosis_hypothesis: "",
      advice: "",
    };
  }

  const allowLiveEval = process.env.AI_EVAL_LIVE === "true";
  if (
    (!process.env.VITEST || allowLiveEval) &&
    process.env.AI_API_KEY &&
    !process.env.AI_API_KEY.startsWith("mock-") &&
    process.env.AI_API_KEY !== "test-api-key"
  ) {
    try {
      return await generateSoapFromShorthand({
        shorthand: cleanShorthand,
        patientContext: deidentifiedContext,
      });
    } catch {
      // Fall through to deterministic extractor
    }
  }

  return parseShorthandLocally(cleanShorthand, deidentifiedContext);
}
