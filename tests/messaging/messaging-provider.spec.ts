import { describe, it, expect } from "vitest";

describe("Wave 0: Messaging Provider Architecture (REQ-reminders-notifications, T-05-01)", () => {
  describe("Provider Factory Resolution", () => {
    it("defines the expected provider types for SMS and WhatsApp", () => {
      const supportedProviders = ["dev", "msg91", "twilio", "gupshup"];
      expect(supportedProviders).toContain("dev");
      expect(supportedProviders).toHaveLength(4);
    });

    it.todo("selects DevLoggerProvider by default when MESSAGING_PROVIDER is unset or dev");
    it.todo("instantiates MSG91Provider when MESSAGING_PROVIDER=msg91");
    it.todo("instantiates TwilioProvider when MESSAGING_PROVIDER=twilio");
    it.todo("instantiates GupshupProvider when MESSAGING_PROVIDER=gupshup");
  });

  describe("DevLogger Provider Logging (Zero-leak / Local DX)", () => {
    it.todo("formats outbound SMS with clean borders and recipient phone");
    it.todo("formats outbound WhatsApp with button links and interactive actions");
    it.todo("appends log entries to .planning/dev-messages.txt");
    it.todo("never leaks production API tokens or credentials");
  });

  describe("PII & Security Sanitization (T-05-01)", () => {
    it.todo("strips sensitive diagnostic medical notes from SMS payloads and replaces with secure tokenized link");
  });
});
