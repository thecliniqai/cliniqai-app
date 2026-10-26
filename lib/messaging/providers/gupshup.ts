import {
  InteractiveButton,
  MessagingProvider,
  MessagingSendResult,
} from "../types";

export class GupshupProvider implements MessagingProvider {
  readonly name = "gupshup" as const;
  private apiKey: string;
  private appName: string;
  private srcPhone: string;

  constructor(options?: {
    apiKey?: string;
    appName?: string;
    srcPhone?: string;
  }) {
    this.apiKey = options?.apiKey || process.env.GUPSHUP_API_KEY || "";
    this.appName = options?.appName || process.env.GUPSHUP_APP_NAME || "";
    this.srcPhone = options?.srcPhone || process.env.GUPSHUP_SRC_PHONE || "";
  }

  async sendSms(
    _to: string,
    _templateId: string,
    _params: Record<string, string>
  ): Promise<MessagingSendResult> {
    return {
      success: false,
      channelUsed: "sms",
      error: "GupshupProvider is dedicated to WhatsApp and does not support direct SMS dispatch",
    };
  }

  async sendWhatsApp(
    to: string,
    templateId: string,
    params: Record<string, string>,
    buttons?: InteractiveButton[]
  ): Promise<MessagingSendResult> {
    if (!this.apiKey) {
      return {
        success: false,
        channelUsed: "whatsapp",
        error: "GUPSHUP_API_KEY is not configured",
      };
    }

    try {
      const normalizedPhone = to.replace(/[^0-9]/g, "");
      const formData = new URLSearchParams();
      formData.append("channel", "whatsapp");
      formData.append("source", this.srcPhone);
      formData.append("destination", normalizedPhone);
      formData.append("src.name", this.appName);

      const messagePayload: Record<string, unknown> = {
        type: "template",
        template: {
          id: templateId,
          params: Object.values(params),
        },
      };

      if (buttons && buttons.length > 0) {
        messagePayload.interactive = {
          type: "quick_reply",
          buttons: buttons.map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.text },
          })),
        };
      }

      formData.append("message", JSON.stringify(messagePayload));

      const res = await fetch("https://api.gupshup.io/sm/api/v1/msg", {
        method: "POST",
        headers: {
          apikey: this.apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        messageId?: string;
        message?: string;
      };

      if (!res.ok || data.status === "error") {
        return {
          success: false,
          channelUsed: "whatsapp",
          error: data.message || `Gupshup WhatsApp failed with HTTP ${res.status}`,
          statusCode: res.status,
        };
      }

      return {
        success: true,
        channelUsed: "whatsapp",
        externalMessageId: data.messageId || `gupshup-wa-${Date.now()}`,
        statusCode: res.status,
      };
    } catch (err: unknown) {
      return {
        success: false,
        channelUsed: "whatsapp",
        error: err instanceof Error ? err.message : "Unknown Gupshup WhatsApp error",
      };
    }
  }
}
