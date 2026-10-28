import {
  InteractiveButton,
  MessagingProvider,
  MessagingSendResult,
} from "../types";
import { WHATSAPP_TEMPLATES } from "../templates";
import { buildPositionalComponents } from "../templates/mapping";

export class Msg91Provider implements MessagingProvider {
  readonly name = "msg91" as const;
  private authKey: string;
  private senderId: string;
  private dltTeId?: string;

  constructor(options?: {
    authKey?: string;
    senderId?: string;
    integratedNumber?: string;
    dltTeId?: string;
  }) {
    this.authKey = options?.authKey || process.env.MSG91_AUTH_KEY || "";
    this.senderId =
      options?.integratedNumber ||
      options?.senderId ||
      process.env.MSG91_INTEGRATED_NUMBER ||
      process.env.MSG91_SENDER_ID ||
      "";
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
    _buttons?: InteractiveButton[]
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
      const isCatalogueTemplate = WHATSAPP_TEMPLATES.some(
        (t) => t.template_name === templateId
      );

      if (isCatalogueTemplate) {
        const mappedComponents = buildPositionalComponents(templateId, params);

        const res = await fetch(
          "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/",
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
                type: "template",
                template: {
                  name: templateId,
                  language: {
                    code: "en",
                    policy: "deterministic",
                  },
                  to_and_components: [
                    {
                      to: [normalizedPhone],
                      components: mappedComponents,
                    },
                  ],
                },
                messaging_product: "whatsapp",
              },
            }),
          }
        );

        const data = (await res.json().catch(() => ({}))) as {
          status?: string;
          hasError?: boolean;
          message?: string;
          errors?: unknown;
          request_id?: string;
          requestId?: string;
        };

        if (!res.ok || data.status === "error" || data.hasError === true) {
          const errMsg =
            data.message ||
            (typeof data.errors === "string" ? data.errors : JSON.stringify(data.errors)) ||
            `MSG91 WhatsApp failed with HTTP ${res.status}`;

          return {
            success: false,
            channelUsed: "whatsapp",
            error: errMsg,
            statusCode: res.status,
          };
        }

        return {
          success: true,
          channelUsed: "whatsapp",
          externalMessageId:
            data.request_id || data.requestId || `msg91-wa-${Date.now()}`,
          statusCode: res.status,
        };
      } else {
        // Active session text endpoint fallback for non-catalogue conversational messages
        const textContent =
          params.message || params.text || Object.values(params).join(" ");

        const res = await fetch(
          "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              authkey: this.authKey,
            },
            body: JSON.stringify({
              integrated_number: this.senderId,
              recipient_number: normalizedPhone,
              content_type: "text",
              text: textContent,
            }),
          }
        );

        const data = (await res.json().catch(() => ({}))) as {
          status?: string;
          hasError?: boolean;
          message?: string;
          errors?: unknown;
          request_id?: string;
          requestId?: string;
          message_uuid?: string;
        };

        if (!res.ok || data.status === "error" || data.hasError === true) {
          const errMsg =
            data.message ||
            (typeof data.errors === "string" ? data.errors : JSON.stringify(data.errors)) ||
            `MSG91 session text failed with HTTP ${res.status}`;

          return {
            success: false,
            channelUsed: "whatsapp",
            error: errMsg,
            statusCode: res.status,
          };
        }

        return {
          success: true,
          channelUsed: "whatsapp",
          externalMessageId:
            data.request_id ||
            data.requestId ||
            data.message_uuid ||
            `msg91-wa-text-${Date.now()}`,
          statusCode: res.status,
        };
      }
    } catch (err: unknown) {
      return {
        success: false,
        channelUsed: "whatsapp",
        error: err instanceof Error ? err.message : "Unknown MSG91 WhatsApp error",
      };
    }
  }
}
