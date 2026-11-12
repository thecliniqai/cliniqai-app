import { AiChatClient, AiUnavailableError, getAiChatClient } from "./client";
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

/**
 * Drafts a SOAP note from the doctor's shorthand through the configured provider.
 *
 * Fails closed (AI-01, AI_STRATEGY.md §4.6): when no provider is configured, the provider errors, or the output
 * is not valid JSON matching `SoapDraftZodSchema`, it throws `AiUnavailableError` and produces no draft. There is
 * no regex, partial or mock fallback. The availability check runs before anything else, so an unconfigured
 * deployment makes no outbound call. `aiClient` lets tests inject a fake adapter.
 */
export async function generateSoapFromShorthand(
  input: {
    shorthand: string;
    patientContext?: Record<string, unknown>;
  },
  aiClient?: AiChatClient
): Promise<SoapDraft> {
  const client = aiClient ?? getAiChatClient();
  if (!client) {
    throw new AiUnavailableError("not_configured");
  }

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

  let rawOutput: string;
  try {
    rawOutput = await client.chatCompletion({
      messages,
      responseFormat: { type: "json_object" },
      temperature: 0.1,
    });
  } catch (err) {
    if (err instanceof AiUnavailableError) throw err;
    throw new AiUnavailableError("provider_error");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawOutput);
  } catch {
    throw new AiUnavailableError("invalid_output");
  }

  const validated = SoapDraftZodSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new AiUnavailableError("invalid_output");
  }
  return validated.data;
}
