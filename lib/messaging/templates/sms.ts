/**
 * MSG91 SMS Flow variables (V2-04 04-07a, review B H-1 / triage H-SMS).
 *
 * The Flow request is `{ <template variables…>, template_id, sender, short_url, mobiles }`. The control fields are
 * fixed by the provider; only a template's declared variables may come from the queued row's `template_params` (an
 * allow-list; an undeclared SMS template sends none, 04-07d), and they are written first, so a param named `mobiles`,
 * `template_id`, `sender` or `short_url` can never redirect a message, switch the Flow template or change the sender
 * id.
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

/**
 * The template variables of an SMS Flow request: exactly the template's declared variables that the params carry
 * (exact key match). An SMS template with no declared set gets no variables at all (04-07d, re-verification L-A: an
 * allow-list, not a deny-list of control keys, so a key such as `MOBİLES`, `mobiles ` or `schtime` can never reach the
 * Flow body whatever MSG91 does with letter case, spaces or extra fields). Never contains a Flow control key: no
 * declared set holds one.
 */
export function smsFlowVariables(templateId: string, params: Record<string, string>): Record<string, string> {
  if (!Object.prototype.hasOwnProperty.call(SMS_FLOW_VARIABLES, templateId)) return {};
  const vars: Record<string, string> = {};
  for (const key of SMS_FLOW_VARIABLES[templateId]) {
    if (Object.prototype.hasOwnProperty.call(params, key) && typeof params[key] === "string") vars[key] = params[key];
  }
  return vars;
}
