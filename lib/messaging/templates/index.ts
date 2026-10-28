import templatesJson from "./whatsapp-templates.json";

export interface WhatsAppTemplateButton {
  type: "QUICK_REPLY" | "URL" | "OTP";
  text: string;
  url?: string;
  otp_type?: string;
  example?: string[];
}

export interface WhatsAppTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO";
  text?: string;
  example?: {
    header_text?: string[];
    body_text?: string[][];
  };
  buttons?: WhatsAppTemplateButton[];
}

export interface WhatsAppTemplateDefinition {
  template_name: string;
  language: string;
  category: "UTILITY" | "AUTHENTICATION" | "MARKETING";
  button_url: boolean;
  description: string;
  components: WhatsAppTemplateComponent[];
}

export const WHATSAPP_TEMPLATES: WhatsAppTemplateDefinition[] =
  templatesJson as WhatsAppTemplateDefinition[];

export function getWhatsAppTemplate(name: string): WhatsAppTemplateDefinition | undefined {
  return WHATSAPP_TEMPLATES.find((t) => t.template_name === name);
}

/**
 * Builds the MSG91 API payload for creating a WhatsApp template.
 */
export function buildMsg91CreateTemplatePayload(
  template: WhatsAppTemplateDefinition,
  integratedNumber: string
) {
  return {
    integrated_number: integratedNumber,
    template_name: template.template_name,
    language: template.language,
    category: template.category,
    button_url: template.button_url,
    components: template.components,
  };
}

export * from "./mapping";
