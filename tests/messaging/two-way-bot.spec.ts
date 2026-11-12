import { describe, it, expect } from "vitest";
import { parseInboundAction } from "@/lib/messaging/webhook-helpers";

// P0-03 (V2-01, plan 01-03): the dev/gupshup signature tests and the "GET dev simulator" route tests were retired
// with the dev, twilio and gupshup webhook providers. MSG91 authentication and the reply flows are covered in
// tests/messaging/msg91-webhook.spec.ts and tests/security/webhook-lockdown.spec.ts.
describe("Two-Way WhatsApp Bot action parsing (REQ-reminders-notifications, T-05-05, T-05-07)", () => {
  describe("2. Interactive Button & Action Parsing", () => {
    it("parses confirmation aliases", () => {
      expect(parseInboundAction("btn_confirm")).toBe("confirm");
      expect(parseInboundAction("Confirm")).toBe("confirm");
      expect(parseInboundAction("yes")).toBe("confirm");
      expect(parseInboundAction("1")).toBe("confirm");
    });

    it("parses cancellation aliases", () => {
      expect(parseInboundAction("btn_cancel")).toBe("cancel");
      expect(parseInboundAction("Cancel", true)).toBe("cancel");
      expect(parseInboundAction("no")).toBe("unhandled");
      expect(parseInboundAction("2")).toBe("unhandled");
    });

    it("parses reschedule aliases", () => {
      expect(parseInboundAction("btn_reschedule")).toBe("reschedule");
      expect(parseInboundAction("Reschedule")).toBe("reschedule");
      expect(parseInboundAction("3")).toBe("reschedule");
    });

    it("classifies conversational questions as unhandled", () => {
      expect(parseInboundAction("Can I come at 4pm instead?")).toBe("unhandled");
      expect(parseInboundAction("What is the doctor's fee?")).toBe("unhandled");
    });
  });
});
