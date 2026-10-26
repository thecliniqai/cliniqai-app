import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  getMessagingProvider,
  DevLoggerProvider,
  Msg91Provider,
  TwilioProvider,
  GupshupProvider,
  sendDirectSms,
  sendDirectWhatsApp,
} from "@/lib/messaging";

describe("Messaging Provider Layer (REQ-reminders-notifications, T-05-01)", () => {
  const originalEnv = { ...process.env };
  const devMessagesPath = path.join(process.cwd(), ".planning", "dev-messages.txt");

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. Provider Factory Resolution", () => {
    it("returns DevLoggerProvider by default when MESSAGING_PROVIDER is unset", () => {
      delete process.env.MESSAGING_PROVIDER;
      const provider = getMessagingProvider();
      expect(provider.name).toBe("dev");
      expect(provider).toBeInstanceOf(DevLoggerProvider);
    });

    it("returns DevLoggerProvider when MESSAGING_PROVIDER=dev", () => {
      process.env.MESSAGING_PROVIDER = "dev";
      const provider = getMessagingProvider();
      expect(provider.name).toBe("dev");
      expect(provider).toBeInstanceOf(DevLoggerProvider);
    });

    it("returns Msg91Provider when overrideName is 'msg91'", () => {
      const provider = getMessagingProvider("msg91");
      expect(provider.name).toBe("msg91");
      expect(provider).toBeInstanceOf(Msg91Provider);
    });

    it("returns TwilioProvider when overrideName is 'twilio'", () => {
      const provider = getMessagingProvider("twilio");
      expect(provider.name).toBe("twilio");
      expect(provider).toBeInstanceOf(TwilioProvider);
    });

    it("returns GupshupProvider when overrideName is 'gupshup'", () => {
      const provider = getMessagingProvider("gupshup");
      expect(provider.name).toBe("gupshup");
      expect(provider).toBeInstanceOf(GupshupProvider);
    });
  });

  describe("2. DevLogger Local Delivery & File Appending (T-05-01)", () => {
    it("sendDirectSms outputs to console and appends to .planning/dev-messages.txt", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const testPhone = "+919876543210";
      const templateId = "appointment_reminder";
      const testParams = {
        patient_name: "Rahul Sharma",
        doctor_name: "Dr. Ananya Rao",
        time: "10:30 AM",
      };

      const result = await sendDirectSms(testPhone, templateId, testParams, "dev");

      expect(result.success).toBe(true);
      expect(result.channelUsed).toBe("sms");
      expect(result.externalMessageId).toMatch(/^dev-sms-/);
      expect(consoleSpy).toHaveBeenCalled();

      // Verify file appending
      expect(fs.existsSync(devMessagesPath)).toBe(true);
      const fileContent = fs.readFileSync(devMessagesPath, "utf8");
      expect(fileContent).toContain("[CLINICOS DEV MESSAGING] 💬 SMS");
      expect(fileContent).toContain(testPhone);
      expect(fileContent).toContain("Rahul Sharma");
    });

    it("sendDirectWhatsApp formats buttons and simulated callback URLs", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const testPhone = "+919876543210";
      const templateId = "appointment_booked";
      const testParams = {
        patient_name: "Aarav Patel",
        doctor_name: "Dr. Deepak Mehta",
      };
      const buttons = [
        { id: "confirm", text: "Confirm" },
        { id: "cancel", text: "Cancel" },
        { id: "reschedule", text: "Reschedule" },
      ];

      const result = await sendDirectWhatsApp(
        testPhone,
        templateId,
        testParams,
        buttons,
        "dev"
      );

      expect(result.success).toBe(true);
      expect(result.channelUsed).toBe("whatsapp");
      expect(result.externalMessageId).toMatch(/^dev-wa-/);
      expect(consoleSpy).toHaveBeenCalled();

      // Verify file content has button actions
      const fileContent = fs.readFileSync(devMessagesPath, "utf8");
      expect(fileContent).toContain("[CLINICOS DEV MESSAGING] 📱 WhatsApp");
      expect(fileContent).toContain("[Confirm]");
      expect(fileContent).toContain("action=confirm");
      expect(fileContent).toContain("action=cancel");
    });
  });

  describe("3. Production Driver Resilience Without Secrets", () => {
    it("Msg91Provider gracefully reports error when MSG91_AUTH_KEY is missing", async () => {
      delete process.env.MSG91_AUTH_KEY;
      const provider = new Msg91Provider({ authKey: "" });
      const result = await provider.sendSms("+919999999999", "temp_1", { name: "Test" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("MSG91_AUTH_KEY is not configured");
    });

    it("TwilioProvider gracefully reports error when credentials are missing", async () => {
      const provider = new TwilioProvider({ accountSid: "", authToken: "" });
      const result = await provider.sendSms("+919999999999", "temp_1", { message: "Test" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("TWILIO_ACCOUNT_SID");
    });

    it("GupshupProvider reports error on SMS request", async () => {
      const provider = new GupshupProvider({ apiKey: "test" });
      const result = await provider.sendSms("+919999999999", "temp_1", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("does not support direct SMS");
    });
  });
});
