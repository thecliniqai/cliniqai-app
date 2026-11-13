import { serverEnv } from "@/lib/env-server";
import {
  InteractiveButton,
  MessagingProvider,
  MessagingSendResult,
  SendOptions,
} from "../types";
import { MESSAGING_PROVIDER_TIMEOUT_MS, providerSignal, syntheticRecipientRefusal } from "../provider-guard";
import { errorTag } from "@/lib/errors/error-tag";
import { WHATSAPP_TEMPLATES } from "../templates";
import { buildPositionalComponents } from "../templates/mapping";

/**
 * MSG91 failure classification (V2-04 04-03a, R-20). A 4xx other than 408/429, or a 2xx body that reports an error, is
 * a rejected request: sending it again cannot succeed (`retryable: false`, the `message.send` handler dead-letters the
 * row at once). A 5xx, 408, 429, a network error, a timeout or the runner's abort may succeed later (`retryable:
 * true`). `error` and `code` are machine codes only, never MSG91's response text (which can echo the recipient).
 */
function httpFailure(channel: "sms" | "whatsapp", status: number): MessagingSendResult {
  const retryable = status >= 500 || status === 408 || status === 429;
  const code = `msg91_http_${status}`;
  return { success: false, channelUsed: channel, error: code, code, statusCode: status, retryable };
}

function rejected(channel: "sms" | "whatsapp", status: number): MessagingSendResult {
  return { success: false, channelUsed: channel, error: "msg91_rejected", code: "msg91_rejected", statusCode: status, retryable: false };
}

function requestFailed(channel: "sms" | "whatsapp", err: unknown): MessagingSendResult {
  const code = `msg91_request_failed:${errorTag(err)}`.slice(0, 64);
  return { success: false, channelUsed: channel, error: code, code, retryable: true };
}

function notConfigured(channel: "sms" | "whatsapp"): MessagingSendResult {
  return { success: false, channelUsed: channel, error: "msg91_not_configured", code: "msg91_not_configured", retryable: false };
}

export class Msg91Provider implements MessagingProvider {
  readonly name = "msg91" as const;
  private authKey: string;
  private senderId: string;
  private dltTeId?: string;
  private timeoutMs: number;

  constructor(options?: {
    authKey?: string;
    senderId?: string;
    integratedNumber?: string;
    dltTeId?: string;
    /** Bound for one HTTP call (default {@link MESSAGING_PROVIDER_TIMEOUT_MS}). */
    timeoutMs?: number;
  }) {
    this.timeoutMs = options?.timeoutMs ?? MESSAGING_PROVIDER_TIMEOUT_MS;
    const env = serverEnv();
    this.authKey = options?.authKey || env.MSG91_AUTH_KEY || "";
    this.senderId =
      options?.integratedNumber ||
      options?.senderId ||
      env.MSG91_INTEGRATED_NUMBER ||
      env.MSG91_SENDER_ID ||
      "";
    this.dltTeId = options?.dltTeId || env.MSG91_DLT_TE_ID || "";
  }

  async sendSms(
    to: string,
    templateId: string,
    params: Record<string, string>,
    options?: SendOptions
  ): Promise<MessagingSendResult> {
    const synthetic = syntheticRecipientRefusal(to, "sms");
    if (synthetic) return synthetic;
    if (!this.authKey) return notConfigured("sms");

    try {
      // MSG91 Flow API
      const normalizedPhone = to.replace(/[^0-9]/g, "");
      const res = await fetch("https://control.msg91.com/api/v5/flow/", {
        method: "POST",
        signal: providerSignal(options?.signal, this.timeoutMs),
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
        request_id?: string;
      };

      if (!res.ok) return httpFailure("sms", res.status);
      if (data.type === "error") return rejected("sms", res.status);

      return {
        success: true,
        channelUsed: "sms",
        externalMessageId: data.request_id || `msg91-${Date.now()}`,
        statusCode: res.status,
      };
    } catch (err: unknown) {
      return requestFailed("sms", err);
    }
  }

  async sendWhatsApp(
    to: string,
    templateId: string,
    params: Record<string, string>,
    _buttons?: InteractiveButton[],
    options?: SendOptions
  ): Promise<MessagingSendResult> {
    const synthetic = syntheticRecipientRefusal(to, "whatsapp");
    if (synthetic) return synthetic;
    if (!this.authKey) return notConfigured("whatsapp");

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
            signal: providerSignal(options?.signal, this.timeoutMs),
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
          request_id?: string;
          requestId?: string;
        };

        if (!res.ok) return httpFailure("whatsapp", res.status);
        if (data.status === "error" || data.hasError === true) return rejected("whatsapp", res.status);

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
            signal: providerSignal(options?.signal, this.timeoutMs),
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
          request_id?: string;
          requestId?: string;
          message_uuid?: string;
        };

        if (!res.ok) return httpFailure("whatsapp", res.status);
        if (data.status === "error" || data.hasError === true) return rejected("whatsapp", res.status);

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
      return requestFailed("whatsapp", err);
    }
  }
}
