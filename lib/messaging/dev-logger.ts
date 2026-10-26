import fs from "fs";
import path from "path";
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

    console.log(lines);
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

    const simulatedWebhookLinks = buttons && buttons.length > 0
      ? buttons.map((b) => `  ↳ Click ${b.text}: http://localhost:3000/api/webhooks/messaging/dev?action=${encodeURIComponent(b.id)}&from=${encodeURIComponent(to)}`).join("\n")
      : null;

    const lines = [
      `\n${bannerBorder}`,
      `[CLINICOS DEV MESSAGING] 📱 WhatsApp — ${timestamp}`,
      `Message ID: ${externalMessageId}`,
      `Recipient:  ${to}`,
      `Template:   ${templateId}`,
      `Parameters: ${JSON.stringify(params, null, 2)}`,
      buttonSummary ? `Buttons:    ${buttonSummary}` : null,
      simulatedWebhookLinks ? `Simulated Inbound Actions:\n${simulatedWebhookLinks}` : null,
      `${bannerBorder}\n`,
    ]
      .filter(Boolean)
      .join("\n");

    console.log(lines);
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
      console.warn("[DevLoggerProvider] Failed to write to .planning/dev-messages.txt:", err);
    }
  }
}
