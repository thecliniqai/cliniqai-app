import { AnonymizedPatientContext } from "./types";

export const INDIAN_MOBILE_PII_REGEX = /(?:\+?91[\s-]?)?[6-9]\d{9}/g;
export const AADHAAR_REGEX = /\b\d{4}\s?\d{4}\s?\d{4}\b/g;
export const ABHA_REGEX = /\b\d{2}-\d{4}-\d{4}-\d{4}\b/g;

/**
 * Sanitizes patient context before sending to external LLM providers (DPDP Act 2023 compliance).
 * Strips all direct patient identifiers (Name, Phone, Aadhaar, ABHA, Address, Email, UHID, Emergency Contact).
 * Retains only de-identified clinical parameters: age, sex/gender, vitals, and chronic_conditions.
 */
export function sanitizePatientContextForPrompt(
  patient?: Record<string, unknown> | null
): AnonymizedPatientContext & { chronic_conditions?: string[] } {
  if (!patient) return {};

  const clean: AnonymizedPatientContext & { chronic_conditions?: string[] } = {};

  if (patient.age !== undefined && patient.age !== null) {
    clean.age = patient.age as number | string;
  }

  const sex = patient.sex || patient.gender;
  if (typeof sex === "string") {
    clean.sex = sex;
  }

  const conditions = patient.chronic_conditions || patient.existing_conditions;
  if (Array.isArray(conditions)) {
    const list = conditions.map(String);
    clean.chronic_conditions = list;
    clean.existing_conditions = list;
  }

  if (patient.vitals && typeof patient.vitals === "object") {
    clean.vitals = patient.vitals as Record<string, unknown>;
  }

  return clean;
}

/**
 * Scrubs direct PII tokens (phone, Aadhaar, ABHA) from free-form text.
 */
export function stripPiiFromText(text: string): string {
  if (!text) return "";

  return text
    .replace(INDIAN_MOBILE_PII_REGEX, "[PHONE REDACTED]")
    .replace(AADHAAR_REGEX, "[AADHAAR REDACTED]")
    .replace(ABHA_REGEX, "[ABHA REDACTED]");
}

/**
 * Returns true if the text contains any detectable direct PII (Indian phone, Aadhaar, ABHA).
 */
export function containsDirectPii(text: string): boolean {
  if (!text) return false;

  INDIAN_MOBILE_PII_REGEX.lastIndex = 0;
  AADHAAR_REGEX.lastIndex = 0;
  ABHA_REGEX.lastIndex = 0;

  return (
    INDIAN_MOBILE_PII_REGEX.test(text) ||
    AADHAAR_REGEX.test(text) ||
    ABHA_REGEX.test(text)
  );
}
