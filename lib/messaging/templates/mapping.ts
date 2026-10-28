/**
 * Template Positional Variable Mapping & Parameter Sanitization Engine
 * 
 * Maps pre-approved WhatsApp templates to MSG91's positional components
 * schema (`body_1`, `body_2`, `button_1`), normalizing caller parameter aliases
 * and enforcing Meta's parameter validation constraints.
 * 
 * Traceability: REQ-reminders-notifications, T-05.1-01, T-05.1-02
 */

export interface TemplatePositionalConfig {
  body: string[];
  button_1?: string;
}

export interface ComponentItem {
  type: "text" | "url";
  value: string;
}

export type TemplateComponents = Record<string, ComponentItem>;

/**
 * Positional mapping dictionary for all 13 pre-approved ClinicQ WhatsApp templates.
 */
export const TEMPLATE_POSITIONAL_MAP: Record<string, TemplatePositionalConfig> = {
  appointment_booked: {
    body: ["patient_name", "doctor_name", "clinic_name", "appointment_time"],
  },
  appointment_rescheduled: {
    body: ["patient_name", "doctor_name", "clinic_name", "new_appointment_time"],
  },
  appointment_cancelled: {
    body: ["patient_name", "clinic_name", "cancellation_reason"],
  },
  appointment_reminder: {
    body: ["patient_name", "doctor_name", "clinic_name", "appointment_time"],
  },
  prescription_ready: {
    body: ["patient_name", "doctor_name", "clinic_name"],
    button_1: "token",
  },
  lab_report_uploaded: {
    body: ["patient_name", "test_name", "clinic_name"],
    button_1: "token",
  },
  referral_letter_issued: {
    body: ["patient_name", "doctor_name", "referred_to_name", "clinic_name"],
    button_1: "token",
  },
  receipt_issued: {
    body: ["patient_name", "invoice_number", "amount_inr", "clinic_name"],
    button_1: "token",
  },
  consultation_documents: {
    body: ["patient_name", "doctor_name", "clinic_name", "amount_inr", "invoice_number"],
    button_1: "token",
  },
  follow_up_due: {
    body: ["patient_name", "doctor_name", "clinic_name"],
  },
  pediatric_vaccine_due: {
    body: ["child_name", "vaccine_name", "due_date", "clinic_name"],
  },
  balance_due_reminder: {
    body: ["patient_name", "balance_amount_inr", "invoice_number", "clinic_name"],
  },
  staff_onboarding_otp: {
    body: ["otp_code"],
  },
};

/**
 * Caller parameter alias dictionary mapping real caller parameter names
 * from `features/* /actions.ts` into standard template variables.
 */
export const PARAMETER_ALIASES: Record<string, string[]> = {
  patient_name: ["patient_name", "patientName", "child_name", "childName", "patient"],
  doctor_name: ["doctor_name", "doctorName", "doctor"],
  clinic_name: ["clinic_name", "clinicName", "clinic"],
  appointment_time: ["appointment_time", "appointmentTime", "date_time", "dateTime", "time"],
  new_appointment_time: [
    "new_appointment_time",
    "new_date_time",
    "newDateTime",
    "new_appointment_date_time",
    "rescheduled_time",
    "appointment_time",
    "date_time",
  ],
  cancellation_reason: ["cancellation_reason", "reason", "cancel_reason"],
  test_name: ["test_name", "document_title", "documentTitle", "test_type", "report_name", "lab_test"],
  referred_to_name: ["referred_to_name", "specialist_name", "specialistName", "referred_doctor", "specialist"],
  invoice_number: ["invoice_number", "invoiceNumber", "invoice_no", "receipt_number"],
  amount_inr: ["amount_inr", "amount", "total_amount", "amountInr"],
  balance_amount_inr: ["balance_amount_inr", "balance_amount", "amount", "balance"],
  child_name: ["child_name", "childName", "patient_name", "patient"],
  vaccine_name: ["vaccine_name", "vaccineName", "vaccine"],
  due_date: ["due_date", "dueDate", "date"],
  otp_code: ["otp_code", "otp", "code"],
  token: [
    "token",
    "document_url",
    "documentUrl",
    "url",
    "share_url",
    "link_url",
    "prescription_url",
    "receipt_url",
  ],
};

/**
 * Safe default fallbacks for mandatory Meta parameters.
 */
export const DEFAULT_PARAMETER_FALLBACKS: Record<string, string> = {
  patient_name: "Patient",
  doctor_name: "Doctor",
  clinic_name: "Clinic",
  child_name: "Child",
  cancellation_reason: "Schedule change",
  amount_inr: "0",
  balance_amount_inr: "0",
};

/**
 * Sanitizes template parameters to comply with Meta WABA validation:
 * - Strips newlines and carriage returns.
 * - Collapses consecutive whitespace to a single space and trims.
 * - Enforces Meta maximum length envelopes (1024 for body, 60 for header, 128 for button URL).
 * - Supplies deterministic fallback string if resulting parameter is empty.
 */
export function sanitizeTemplateParameter(
  val: unknown,
  fallback = "-",
  maxLength = 1024
): string {
  if (val === null || val === undefined) {
    return fallback;
  }
  let str = String(val);
  // Strip carriage returns and newlines, replacing with space
  str = str.replace(/[\r\n]+/g, " ");
  // Collapse whitespace
  str = str.replace(/\s+/g, " ").trim();
  if (!str) {
    return fallback;
  }
  if (str.length > maxLength) {
    return str.slice(0, maxLength);
  }
  return str;
}

export const sanitizeParameter = sanitizeTemplateParameter;

/**
 * Extracts the trailing document token from full or relative URLs:
 * e.g. "https://app.thecliniqai.com/r/rx-token-7a8f" -> "rx-token-7a8f"
 * e.g. "/r/rx-token-7a8f" -> "rx-token-7a8f"
 * e.g. "rx-token-7a8f" -> "rx-token-7a8f"
 */
export function extractUrlToken(urlOrToken: string): string {
  if (!urlOrToken || typeof urlOrToken !== "string") {
    return "-";
  }
  const trimmed = urlOrToken.trim();
  if (!trimmed) {
    return "-";
  }

  // Handle full HTTP / HTTPS URLs
  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const parsed = new URL(trimmed);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1];
      if (last) {
        return sanitizeTemplateParameter(last, "-", 128);
      }
    }
  } catch {
    // Fall back to regex
  }

  // Handle path with /r/ or /share/ or /
  const match = trimmed.match(/(?:\/r\/|\/share\/|\/)?([a-zA-Z0-9_\-\.]+)(?:[?#].*)?$/);
  if (match && match[1]) {
    return sanitizeTemplateParameter(match[1], "-", 128);
  }

  return sanitizeTemplateParameter(trimmed.replace(/[?#].*$/, ""), "-", 128);
}

export const extractDocumentToken = extractUrlToken;

/**
 * Resolves parameter value from input dictionary using canonical key and alias fallbacks.
 */
function resolveParameterValue(
  canonicalKey: string,
  params: Record<string, unknown>
): unknown {
  if (params[canonicalKey] !== undefined && params[canonicalKey] !== null && String(params[canonicalKey]).trim() !== "") {
    return params[canonicalKey];
  }

  const aliases = PARAMETER_ALIASES[canonicalKey] || [];
  for (const alias of aliases) {
    if (params[alias] !== undefined && params[alias] !== null && String(params[alias]).trim() !== "") {
      return params[alias];
    }
  }

  return undefined;
}

/**
 * Builds the positional `components` dictionary required by MSG91's `template-bulk` endpoint.
 *
 * @param templateName The registered template name
 * @param params Key-value parameter dictionary supplied by caller
 * @returns Record mapping `body_1`, `body_2`, ..., `button_1` to { type, value }
 */
export function buildPositionalComponents(
  templateName: string,
  params: Record<string, unknown>
): TemplateComponents {
  const config = TEMPLATE_POSITIONAL_MAP[templateName];
  if (!config) {
    // Non-catalogue template: return empty components
    return {};
  }

  const components: TemplateComponents = {};

  // Map body positional parameters (body_1, body_2, ...)
  config.body.forEach((key, idx) => {
    const rawVal = resolveParameterValue(key, params);
    const fallback = DEFAULT_PARAMETER_FALLBACKS[key] || "-";
    const sanitized = sanitizeTemplateParameter(rawVal, fallback, 1024);
    components[`body_${idx + 1}`] = {
      type: "text",
      value: sanitized,
    };
  });

  // Map dynamic CTA button parameter (button_1)
  if (config.button_1) {
    const rawButtonVal = resolveParameterValue(config.button_1, params);
    const token = extractUrlToken(rawButtonVal ? String(rawButtonVal) : "");
    components.button_1 = {
      type: "url",
      value: token,
    };
  }

  return components;
}

export const mapTemplateParameters = buildPositionalComponents;
