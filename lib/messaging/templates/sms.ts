/**
 * MSG91 SMS Flow variables (V2-04 04-07a, review B H-1 / triage H-SMS).
 *
 * The Flow request is `{ <template variables…>, template_id, sender, short_url, mobiles }`. The control fields are
 * fixed by the provider; only a template's declared variables may come from the queued row's `template_params`, and
 * they are written first, so a param named `mobiles`, `template_id`, `sender` or `short_url` can never redirect a
 * message, switch the Flow template or change the sender id.
 *
 * The declared sets equal `ops.message_templates.params` of the same template (migration 000041); the SMS fallback
 * rows carry a copy of their WhatsApp row's params, so the sets are the WhatsApp templates' sets.
 */
export const SMS_FLOW_VARIABLES: Readonly<Record<string, readonly string[]>> = {
  appointment_booked_sms_fallback: ["patient_name", "doctor_name", "clinic_name", "appointment_time", "date_time"],
  appointment_rescheduled_sms_fallback: [
    "patient_name",
    "doctor_name",
    "clinic_name",
    "new_appointment_time",
    "new_date_time",
  ],
};

/** Keys of the Flow request itself (and of its `recipients[]` form): never taken from params, in any letter case. */
const FLOW_CONTROL_KEYS = new Set([
  "template_id",
  "flow_id",
  "sender",
  "short_url",
  "mobiles",
  "mobile",
  "recipients",
  "authkey",
  "unicode",
  "realtimeresponse",
]);

/**
 * The template variables of an SMS Flow request: the template's declared variables when it has a declared set, else
 * every param that is not a Flow control key. Never contains a control key.
 */
export function smsFlowVariables(templateId: string, params: Record<string, string>): Record<string, string> {
  const declared = Object.prototype.hasOwnProperty.call(SMS_FLOW_VARIABLES, templateId)
    ? SMS_FLOW_VARIABLES[templateId]
    : null;
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (FLOW_CONTROL_KEYS.has(key.toLowerCase()) || key === "__proto__") continue;
    if (declared && !declared.includes(key)) continue;
    vars[key] = value;
  }
  return vars;
}
