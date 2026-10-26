import {
  InteractiveButton,
  MessagingProvider,
  MessagingSendResult,
} from "../types";

export class Msg91Provider implements MessagingProvider {
  readonly name = "msg91" as const;
  private authKey: string;
  private senderId: string;
  private dltTeId?: string;

  constructor(options?: { authKey?: string; senderId?: string; dltTeId?: string }) {
    this.authKey = options?.authKey || process.env.MSG91_AUTH_KEY || "";
    this.senderId = options?.senderId || process.env.MSG91_SENDER_ID || "";
    this.dltTeId = options?.dltTeId || process.env.MSG91_DLT_TE_ID || "";
  }

  async sendSms(
    to: string,
    templateId: string,
    params: Record<string, string>
  ): Promise<MessagingSendResult> {
    if (!this.authKey) {
      return {
        success: false,
        channelUsed: "sms",
        error: "MSG91_AUTH_KEY is not configured",
      };
    }

    try {
      // MSG91 Flow API
      const normalizedPhone = to.replace(/[^0-9]/g, "");
      const res = await fetch("https://control.msg91.com/api/v5/flow/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authkey: this.authKey,
        },
        body: JSON.stringify({
          template_id: templateId,
          sender: this.senderId,
          short_url: "0",
          mobiles: normalizedPhone,
          ...params,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        type?: string;
        message?: string;
        request_id?: string;
      };

      if (!res.ok || data.type === "error") {
        return {
          success: false,
          channelUsed: "sms",
          error: data.message || `MSG91 SMS failed with HTTP ${res.status}`,
          statusCode: res.status,
        };
      }

      return {
        success: true,
        channelUsed: "sms",
        externalMessageId: data.request_id || `msg91-${Date.now()}`,
        statusCode: res.status,
      };
    } catch (err: unknown) {
      return {
        success: false,
        channelUsed: "sms",
        error: err instanceof Error ? err.message : "Unknown MSG91 SMS error",
      };
    }
  }

  async sendWhatsApp(
    to: string,
    templateId: string,
    params: Record<string, string>,
    buttons?: InteractiveButton[]
  ): Promise<MessagingSendResult> {
    if (!this.authKey) {
      return {
        success: false,
        channelUsed: "whatsapp",
        error: "MSG91_AUTH_KEY is not configured",
      };
    }

    try {
      const normalizedPhone = to.replace(/[^0-9]/g, "");
      const res = await fetch(
        "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authkey: this.authKey,
          },
          body: JSON.stringify({
            integrated_number: this.senderId,
            content_type: "template",
            payload: {
              to: normalizedPhone,
              type: "template",
              template: {
                name: templateId,
                language: { code: "en" },
                components: [
                  {
                    type: "body",
                    parameters: Object.entries(params).map(([, val]) => ({
                      type: "text",
                      text: String(val),
                    })),
                  },
                  ...(buttons && buttons.length > 0
                    ? buttons.map((b, idx) => ({
                        type: "button",
                        sub_type: "quick_reply",
                        index: String(idx),
                        parameters: [{ type: "payload", payload: b.id }],
                      }))
                    : []),
                ],
              },
            },
          }),
        }
      );

      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        message?: string;
        request_id?: string;
      };

      if (!res.ok || data.status === "error") {
        return {
          success: false,
          channelUsed: "whatsapp",
          error: data.message || `MSG91 WhatsApp failed with HTTP ${res.status}`,
          statusCode: res.status,
        };
      }

      return {
        success: true,
        channelUsed: "whatsapp",
        externalMessageId: data.request_id || `msg91-wa-${Date.now()}`,
        statusCode: res.status,
      };
    } catch (err: unknown) {
      return {
        success: false,
        channelUsed: "whatsapp",
        error: err instanceof Error ? err.message : "Unknown MSG91 WhatsApp error",
      };
    }
  }
}
