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
   * `false` when trying again cannot succeed (the `disabled` provider, R-16; a synthetic recipient; an MSG91 4xx,
   * R-20): the `message.send` handler dead-letters the row at once and queues no SMS fallback.
   */
  retryable?: boolean;
  /** A machine code for the queue row and the job (`provider_disabled`, `msg91_http_400`); never provider text. */
  code?: string;
}

/** Per-call options a sender passes (V2-04 04-03a): the job runner's abort signal. */
export interface SendOptions {
  signal?: AbortSignal;
}

export interface MessagingProvider {
  readonly name: "dev" | "disabled" | "sink" | "msg91" | "twilio" | "gupshup";
  sendSms(
    to: string,
    templateId: string,
    params: Record<string, string>,
    options?: SendOptions
  ): Promise<MessagingSendResult>;
  sendWhatsApp(
    to: string,
    templateId: string,
    params: Record<string, string>,
    buttons?: InteractiveButton[],
    options?: SendOptions
  ): Promise<MessagingSendResult>;
}
