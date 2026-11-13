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
  /**
   * `false` when trying again cannot succeed (the `disabled` provider, R-16): the dispatcher records the failure with
   * the existing statuses but queues no SMS fallback.
   */
  retryable?: boolean;
}

export interface MessagingProvider {
  readonly name: "dev" | "disabled" | "msg91" | "twilio" | "gupshup";
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
