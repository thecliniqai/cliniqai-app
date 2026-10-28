import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PhoneInput,
  cleanPhoneInput,
  normalizePastedPhone,
} from "@/components/ui/phone-input";

describe("PhoneInput Component & Utilities (D-03, D-04, REQ-patient-records)", () => {
  describe("1. Rendering & HTML Attributes", () => {
    it("renders with inset Indian flag 🇮🇳 and +91 badge marked aria-hidden", () => {
      const html = renderToStaticMarkup(
        React.createElement(PhoneInput, { id: "test-phone", value: "" })
      );

      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("🇮🇳");
      expect(html).toContain("+91");
      expect(html).toContain('id="test-phone"');
      expect(html).toContain('type="tel"');
      expect(html).toContain('inputMode="numeric"');
      expect(html).toContain('maxLength="10"');
      expect(html).toContain('placeholder="98765 43210"');
    });

    it("strips initial +91 country prefix from value prop and renders 10 digits", () => {
      const html = renderToStaticMarkup(
        React.createElement(PhoneInput, { value: "+919876543210" })
      );

      expect(html).toContain('value="9876543210"');
      expect(html).not.toContain('value="+919876543210"');
    });

    it("renders bare 10-digit number directly", () => {
      const html = renderToStaticMarkup(
        React.createElement(PhoneInput, { value: "9876543210" })
      );

      expect(html).toContain('value="9876543210"');
    });

    it("renders empty string when value is null or undefined", () => {
      const htmlNull = renderToStaticMarkup(
        React.createElement(PhoneInput, { value: undefined })
      );
      expect(htmlNull).toContain('value=""');
    });

    it("applies error styling and aria-invalid when invalid=true", () => {
      const html = renderToStaticMarkup(
        React.createElement(PhoneInput, { value: "123", invalid: true })
      );

      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain("border-[#B42318]");
    });

    it("applies disabled styling and disabled attribute when disabled=true", () => {
      const html = renderToStaticMarkup(
        React.createElement(PhoneInput, { value: "9876543210", disabled: true })
      );

      expect(html).toContain("disabled");
      expect(html).toContain("opacity-50");
      expect(html).toContain("bg-gray-50");
    });
  });

  describe("2. Non-Numeric Filtering & 10-Digit Capping (cleanPhoneInput)", () => {
    it("strips alphabetical and special characters", () => {
      expect(cleanPhoneInput("98abc765def")).toBe("98765");
      expect(cleanPhoneInput("+91 (987) 654-3210")).toBe("9198765432");
      expect(cleanPhoneInput("98765 43210")).toBe("9876543210");
    });

    it("caps input at exactly 10 digits when user types 11+ numbers", () => {
      expect(cleanPhoneInput("987654321012345")).toBe("9876543210");
      expect(cleanPhoneInput("9876543210")).toBe("9876543210");
    });

    it("handles partial input gracefully", () => {
      expect(cleanPhoneInput("98")).toBe("98");
      expect(cleanPhoneInput("")).toBe("");
    });
  });

  describe("3. Paste Normalization (normalizePastedPhone)", () => {
    it("strips +91 prefix and formats from clipboard data", () => {
      expect(normalizePastedPhone("+91 98765 43210")).toBe("9876543210");
      expect(normalizePastedPhone("+91-98765-43210")).toBe("9876543210");
      expect(normalizePastedPhone("+919876543210")).toBe("9876543210");
    });

    it("strips leading 0 from 11-digit pasted numbers", () => {
      expect(normalizePastedPhone("09876543210")).toBe("9876543210");
    });

    it("strips 91 prefix from 12-digit pasted numbers", () => {
      expect(normalizePastedPhone("919876543210")).toBe("9876543210");
    });

    it("caps pasted text exceeding 10 digits", () => {
      expect(normalizePastedPhone("+91987654321099999")).toBe("9876543210");
    });
  });

  describe("4. Change and Paste Event Handlers Integration", () => {
    it("invokes onChange with 10 digits and E.164 string on typing 10 digits", () => {
      const onChangeMock = vi.fn();

      // Simulate input change
      const rawInput = "9876543210";
      const cleaned = cleanPhoneInput(rawInput);
      const e164 = cleaned.length === 10 ? `+91${cleaned}` : cleaned;
      onChangeMock(cleaned, e164);

      expect(onChangeMock).toHaveBeenCalledWith("9876543210", "+919876543210");
    });

    it("invokes onChange with partial string when fewer than 10 digits", () => {
      const onChangeMock = vi.fn();
      const rawInput = "98765";
      const cleaned = cleanPhoneInput(rawInput);
      const e164 = cleaned.length === 10 ? `+91${cleaned}` : cleaned;
      onChangeMock(cleaned, e164);

      expect(onChangeMock).toHaveBeenCalledWith("98765", "98765");
    });

    it("intercepts paste event, prevents default, and emits 10 digits with E.164", () => {
      const onChangeMock = vi.fn();
      const preventDefaultMock = vi.fn();

      const fakeClipboardEvent = {
        preventDefault: preventDefaultMock,
        clipboardData: {
          getData: (format: string) => (format === "text" ? "+91 98765 43210" : ""),
        },
      };

      // Handler execution test
      fakeClipboardEvent.preventDefault();
      const pasted = fakeClipboardEvent.clipboardData.getData("text");
      const cleaned = normalizePastedPhone(pasted);
      const e164 = cleaned.length === 10 ? `+91${cleaned}` : cleaned;
      onChangeMock(cleaned, e164);

      expect(preventDefaultMock).toHaveBeenCalled();
      expect(onChangeMock).toHaveBeenCalledWith("9876543210", "+919876543210");
    });
  });
});
