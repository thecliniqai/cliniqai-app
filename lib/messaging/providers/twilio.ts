import {
  InteractiveButton,
  MessagingProvider,
  MessagingSendResult,
} from "../types";

export class TwilioProvider implements MessagingProvider {
  readonly name = "twilio" as const;
  private accountSid: string;
  private authToken: string;
  private fromPhone: string;
  private whatsappFrom: string;

  constructor(options?: {
    accountSid?: string;
    authToken?: string;
    fromPhone?: string;
    whatsappFrom?: string;
  }) {
    this.accountSid = options?.accountSid || process.env.TWILIO_ACCOUNT_SID || "";
    this.authToken = options?.authToken || process.env.TWILIO_AUTH_TOKEN || "";
    this.fromPhone = options?.fromPhone || process.env.TWILIO_FROM_PHONE || "";
    this.whatsappFrom = options?.whatsappFrom || process.env.TWILIO_WHATSAPP_FROM || "+14155238886";
  }

  async sendSms(
    to: string,
    templateId: string,
    params: Record<string, string>
  ): Promise<MessagingSendResult> {
    if (!this.accountSid || !this.authToken) {
      return {
        success: false,
        channelUsed: "sms",
        error: "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not configured",
      };
    }

    try {
      const basicAuth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
      const bodyText = params.message || `${templateId}: ${JSON.stringify(params)}`;

      const formData = new URLSearchParams();
      formData.append("To", to);
      formData.append("From", this.fromPhone);
      formData.append("Body", bodyText);

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        }
      );

      const data = (await res.json().catch(() => ({}))) as {
        sid?: string;
        message?: string;
        error_message?: string;
      };

      if (!res.ok) {
        return {
          success: false,
          channelUsed: "sms",
          error: data.message || data.error_message || `Twilio SMS failed with HTTP ${res.status}`,
          statusCode: res.status,
        };
      }

      return {
        success: true,
        channelUsed: "sms",
        externalMessageId: data.sid || `twilio-${Date.now()}`,
        statusCode: res.status,
      };
    } catch (err: unknown) {
      return {
        success: false,
        channelUsed: "sms",
        error: err instanceof Error ? err.message : "Unknown Twilio SMS error",
      };
    }
  }

  async sendWhatsApp(
    to: string,
    templateId: string,
    params: Record<string, string>,
    buttons?: InteractiveButton[]
  ): Promise<MessagingSendResult> {
    if (!this.accountSid || !this.authToken) {
      return {
        success: false,
        channelUsed: "whatsapp",
        error: "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not configured",
      };
    }

    try {
      const basicAuth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
      const normalizedTo = to.startsWith("+") ? to : `+${to}`;
      const toWhatsApp = `whatsapp:${normalizedTo}`;
      const fromWhatsApp = this.whatsappFrom.startsWith("whatsapp:")
        ? this.whatsappFrom
        : `whatsapp:${this.whatsappFrom}`;

      let bodyText = params.message || `${templateId}: ${JSON.stringify(params)}`;
      if (buttons && buttons.length > 0) {
        bodyText += `\n\nReply with:\n${buttons.map((b, i) => `${i + 1}. ${b.text}`).join("\n")}`;
      }

      const formData = new URLSearchParams();
      formData.append("To", toWhatsApp);
      formData.append("From", fromWhatsApp);
      formData.append("Body", bodyText);

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        }
      );

      const data = (await res.json().catch(() => ({}))) as {
        sid?: string;
        message?: string;
        error_message?: string;
      };

      if (!res.ok) {
        return {
          success: false,
          channelUsed: "whatsapp",
          error: data.message || data.error_message || `Twilio WhatsApp failed with HTTP ${res.status}`,
          statusCode: res.status,
        };
      }

      return {
        success: true,
        channelUsed: "whatsapp",
        externalMessageId: data.sid || `twilio-wa-${Date.now()}`,
        statusCode: res.status,
      };
    } catch (err: unknown) {
      return {
        success: false,
        channelUsed: "whatsapp",
        error: err instanceof Error ? err.message : "Unknown Twilio WhatsApp error",
      };
    }
  }
}
