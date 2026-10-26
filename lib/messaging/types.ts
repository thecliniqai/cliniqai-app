export type MessagingChannel = "whatsapp" | "sms" | "in_app";

export interface InteractiveButton {
  id: string;
  text: string;
  action?: string;
  url?: string;
}

export interface OutboundMessagePayload {
  tenantId: string;
  patientId?: string;
  recipientPhone: string;
  channel: "whatsapp" | "sms";
  templateId: string;
  templateParams: Record<string, string>;
  language?: "en" | "mr";
  buttons?: InteractiveButton[];
  fallbackToSms?: boolean;
  metadata?: Record<string, unknown>;
}

export interface MessagingSendResult {
  success: boolean;
  externalMessageId?: string;
  channelUsed: "whatsapp" | "sms";
  error?: string;
  statusCode?: number;
}

export interface MessagingProvider {
  readonly name: "dev" | "msg91" | "twilio" | "gupshup";
  sendSms(
    to: string,
    templateId: string,
    params: Record<string, string>
  ): Promise<MessagingSendResult>;
  sendWhatsApp(
    to: string,
    templateId: string,
    params: Record<string, string>,
    buttons?: InteractiveButton[]
  ): Promise<MessagingSendResult>;
}
