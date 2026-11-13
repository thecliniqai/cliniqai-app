import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { inboundDedupeKey, parseInboundAction, parseMsg91Payload } from "@/lib/messaging/webhook-helpers";

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

  describe("3. V2-04 04-03c: the inbound dedupe key (exactly-once effect per callback)", () => {
    const key = (body: unknown) => {
      const raw = typeof body === "string" ? body : JSON.stringify(body);
      return inboundDedupeKey(parseMsg91Payload(raw), raw);
    };

    it("a delivery report is keyed by request id and status; a repeat is the same key, the next status another", () => {
      expect(key({ direction: "outbound", status: "Delivered", request_id: "req-1" })).toBe("dlr:req-1:delivered");
      expect(key({ status: "delivered", requestId: "req-1", extra: "ignored" })).toBe("dlr:req-1:delivered");
      expect(key({ direction: "outbound", status: "Read", request_id: "req-1" })).toBe("dlr:req-1:read");
    });

    it("a report with nothing to apply has no key (no request id, or a status the route ignores)", () => {
      expect(key({ direction: "outbound", status: "Delivered" })).toBeNull();
      expect(key({ direction: "outbound", status: "Submitted", request_id: "req-2" })).toBeNull();
    });

    it("an inbound message uses its own id when the payload carries one, else the raw body's hash", () => {
      expect(key({ uuid: "msg-abc_123", customerNumber: "919000000001", text: "hi" })).toBe("in:msg-abc_123");
      expect(key({ messageId: "wamid.HBg", customerNumber: "919000000001", text: "hi" })).toBe("in:wamid.HBg");
      const raw = JSON.stringify({ customerNumber: "919000000001", text: "hi" });
      expect(key(raw)).toBe(`in:sha256:${createHash("sha256").update(raw).digest("hex")}`);
      // A message id with spaces or of a non-id type is not used (the hash is).
      expect(key({ uuid: "a b", customerNumber: "919000000001" })).toMatch(/^in:sha256:[0-9a-f]{64}$/);
      expect(key({ uuid: { id: 1 }, customerNumber: "919000000001" })).toMatch(/^in:sha256:[0-9a-f]{64}$/);
      expect(key({ uuid: -1, customerNumber: "919000000001" })).toMatch(/^in:sha256:[0-9a-f]{64}$/);
      expect(key({ uuid: 1.5, customerNumber: "919000000001" })).toMatch(/^in:sha256:[0-9a-f]{64}$/);
    });

    // V2-04 04-07a (review B L-5): the provider id is preferred whenever there is one (a numeric id too), so two
    // identical texts with different ids are two keys, and a retry whose envelope changed (field order, an added
    // field) is still the same key. Without an id the hash covers every field, so a timestamp separates two messages.
    it("04-07a: the provider id is preferred (numeric ids included); without one the body hash covers the timestamp", () => {
      expect(key({ uuid: 42, customerNumber: "919000000001", text: "hi" })).toBe("in:42");
      expect(key({ message_id: "m-1", customerNumber: "919000000001", text: "hi" })).toBe(
        key({ text: "hi", customerNumber: "919000000001", message_id: "m-1", retry: 2 })
      );
      expect(key({ message_id: "m-1", customerNumber: "919000000001", text: "hi" })).not.toBe(
        key({ message_id: "m-2", customerNumber: "919000000001", text: "hi" })
      );
      expect(key({ customerNumber: "919000000001", text: "hi", ts: "2026-11-14T05:00:00Z" })).not.toBe(
        key({ customerNumber: "919000000001", text: "hi", ts: "2026-11-14T05:00:09Z" })
      );
    });

    it("a key never exceeds the 200-character column and never carries the sender's number", () => {
      const long = key({ direction: "outbound", status: "Read", request_id: "r".repeat(300) });
      expect(long).toMatch(/^dlr:sha256:[0-9a-f]{64}$/);
      const inbound = key({ customerNumber: "919000000001", text: "hi" })!;
      expect(inbound.length).toBeLessThanOrEqual(200);
      expect(inbound).not.toContain("9000000001");
    });
  });
});
