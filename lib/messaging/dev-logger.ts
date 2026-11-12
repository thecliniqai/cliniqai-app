import fs from "fs";
import path from "path";
import { errorTag, log } from "@/lib/log";
import {
  InteractiveButton,
  MessagingProvider,
  MessagingSendResult,
} from "./types";

export class DevLoggerProvider implements MessagingProvider {
  readonly name = "dev" as const;

  async sendSms(
    to: string,
    templateId: string,
    params: Record<string, string>
  ): Promise<MessagingSendResult> {
    const timestamp = new Date().toISOString();
    const externalMessageId = `dev-sms-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const bannerBorder = "════════════════════════════════════════════════════════════════════";

    const lines = [
      `\n${bannerBorder}`,
      `[CLINICOS DEV MESSAGING] 💬 SMS — ${timestamp}`,
      `Message ID: ${externalMessageId}`,
      `Recipient:  ${to}`,
      `Template:   ${templateId}`,
      `Parameters: ${JSON.stringify(params, null, 2)}`,
      `${bannerBorder}\n`,
    ].join("\n");

    // Recipient, template and parameters go only to the dev-only file below; the log line carries no message data.
    log.info({ event: "messaging.dev.recorded", action: "sms", count: 1 });
    this.appendToFile(lines);

    return {
      success: true,
      externalMessageId,
      channelUsed: "sms",
    };
  }

  async sendWhatsApp(
    to: string,
    templateId: string,
    params: Record<string, string>,
    buttons?: InteractiveButton[]
  ): Promise<MessagingSendResult> {
    const timestamp = new Date().toISOString();
    const externalMessageId = `dev-wa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const bannerBorder = "════════════════════════════════════════════════════════════════════";

    const buttonSummary = buttons && buttons.length > 0
      ? buttons.map((b) => `[${b.text}] (${b.id})`).join("  ")
      : null;

    const lines = [
      `\n${bannerBorder}`,
      `[CLINICOS DEV MESSAGING] 📱 WhatsApp — ${timestamp}`,
      `Message ID: ${externalMessageId}`,
      `Recipient:  ${to}`,
      `Template:   ${templateId}`,
      `Parameters: ${JSON.stringify(params, null, 2)}`,
      buttonSummary ? `Buttons:    ${buttonSummary}` : null,
      `${bannerBorder}\n`,
    ]
      .filter(Boolean)
      .join("\n");

    log.info({ event: "messaging.dev.recorded", action: "whatsapp", count: 1 });
    this.appendToFile(lines);

    return {
      success: true,
      externalMessageId,
      channelUsed: "whatsapp",
    };
  }

  private appendToFile(content: string): void {
    try {
      const logDir = path.join(process.cwd(), ".planning");
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logFilePath = path.join(logDir, "dev-messages.txt");
      fs.appendFileSync(logFilePath, content + "\n", "utf8");
    } catch (err) {
      log.warn({ event: "messaging.dev.write_failed", code: errorTag(err) });
    }
  }
}
