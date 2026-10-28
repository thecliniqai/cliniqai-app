import { describe, it, expect } from "vitest";
import {
  extractTenDigits,
  toE164,
  isValidIndianMobile,
  formatTenDigitsDisplay,
  INDIAN_MOBILE_REGEX,
} from "@/lib/utils/phone";

describe("Indian Mobile Phone Utility Suite (Phase 05.2 / ITU-T E.164)", () => {
  describe("INDIAN_MOBILE_REGEX", () => {
    it("matches 10 digits starting with 6, 7, 8, or 9", () => {
      expect(INDIAN_MOBILE_REGEX.test("9876543210")).toBe(true);
      expect(INDIAN_MOBILE_REGEX.test("8123456789")).toBe(true);
      expect(INDIAN_MOBILE_REGEX.test("7000000000")).toBe(true);
      expect(INDIAN_MOBILE_REGEX.test("6999999999")).toBe(true);
    });

    it("rejects numbers starting with 0 through 5", () => {
      expect(INDIAN_MOBILE_REGEX.test("0123456789")).toBe(false);
      expect(INDIAN_MOBILE_REGEX.test("1234567890")).toBe(false);
      expect(INDIAN_MOBILE_REGEX.test("2345678901")).toBe(false);
      expect(INDIAN_MOBILE_REGEX.test("3456789012")).toBe(false);
      expect(INDIAN_MOBILE_REGEX.test("4567890123")).toBe(false);
      expect(INDIAN_MOBILE_REGEX.test("5555555555")).toBe(false);
    });

    it("rejects strings with length other than 10", () => {
      expect(INDIAN_MOBILE_REGEX.test("987654321")).toBe(false);
      expect(INDIAN_MOBILE_REGEX.test("98765432100")).toBe(false);
      expect(INDIAN_MOBILE_REGEX.test("")).toBe(false);
    });
  });

  describe("extractTenDigits", () => {
    it("returns 10 digits as-is when input is bare 10 digits", () => {
      expect(extractTenDigits("9876543210")).toBe("9876543210");
    });

    it("strips +91 prefix and non-digits from standard formatted numbers", () => {
      expect(extractTenDigits("+919876543210")).toBe("9876543210");
      expect(extractTenDigits("+91 98765 43210")).toBe("9876543210");
      expect(extractTenDigits("+91 (98765) 43210")).toBe("9876543210");
    });

    it("strips 91 prefix when 12 digits starting with 91", () => {
      expect(extractTenDigits("919876543210")).toBe("9876543210");
    });

    it("strips leading 0 when 11 digits starting with 0", () => {
      expect(extractTenDigits("09876543210")).toBe("9876543210");
    });

    it("strips dashes and whitespace", () => {
      expect(extractTenDigits("98765-43210")).toBe("9876543210");
      expect(extractTenDigits(" 98765 43210 ")).toBe("9876543210");
    });

    it("slices last 10 digits if more than 10 digits and not 91/0 prefix pattern", () => {
      expect(extractTenDigits("00919876543210")).toBe("9876543210");
    });

    it("handles partial numbers gracefully", () => {
      expect(extractTenDigits("98765")).toBe("98765");
      expect(extractTenDigits("9")).toBe("9");
    });

    it("returns empty string for null, undefined, or empty values", () => {
      expect(extractTenDigits("")).toBe("");
      expect(extractTenDigits(null)).toBe("");
      expect(extractTenDigits(undefined)).toBe("");
    });
  });

  describe("isValidIndianMobile", () => {
    it("returns true for valid 10-digit mobile numbers starting with 6, 7, 8, or 9", () => {
      expect(isValidIndianMobile("9876543210")).toBe(true);
      expect(isValidIndianMobile("8888888888")).toBe(true);
      expect(isValidIndianMobile("7777777777")).toBe(true);
      expect(isValidIndianMobile("6666666666")).toBe(true);
    });

    it("returns true for formatted numbers that resolve to valid 10 digits", () => {
      expect(isValidIndianMobile("+919876543210")).toBe(true);
      expect(isValidIndianMobile("+91 98765 43210")).toBe(true);
      expect(isValidIndianMobile("09876543210")).toBe(true);
      expect(isValidIndianMobile("98765-43210")).toBe(true);
    });

    it("returns false for landline or invalid prefixes starting with 0-5", () => {
      expect(isValidIndianMobile("0123456789")).toBe(false);
      expect(isValidIndianMobile("1234567890")).toBe(false);
      expect(isValidIndianMobile("2345678901")).toBe(false);
      expect(isValidIndianMobile("3456789012")).toBe(false);
      expect(isValidIndianMobile("4567890123")).toBe(false);
      expect(isValidIndianMobile("5555555555")).toBe(false);
    });

    it("returns false for strings with fewer or more than 10 digits", () => {
      expect(isValidIndianMobile("98765")).toBe(false);
      expect(isValidIndianMobile("987654321")).toBe(false);
      expect(isValidIndianMobile("")).toBe(false);
      expect(isValidIndianMobile("abc")).toBe(false);
    });

    it("returns false for null and undefined", () => {
      expect(isValidIndianMobile(null)).toBe(false);
      expect(isValidIndianMobile(undefined)).toBe(false);
    });
  });

  describe("toE164", () => {
    it("converts a bare 10-digit number to +91XXXXXXXXXX", () => {
      expect(toE164("9876543210")).toBe("+919876543210");
    });

    it("normalizes prefixed or formatted numbers to +91XXXXXXXXXX", () => {
      expect(toE164("+91 98765 43210")).toBe("+919876543210");
      expect(toE164("+919876543210")).toBe("+919876543210");
      expect(toE164("09876543210")).toBe("+919876543210");
      expect(toE164("919876543210")).toBe("+919876543210");
      expect(toE164("98765-43210")).toBe("+919876543210");
    });

    it("returns trimmed original string when input does not satisfy 10-digit Indian mobile", () => {
      expect(toE164("5555555555")).toBe("5555555555");
      expect(toE164("12345")).toBe("12345");
      expect(toE164("invalid-phone")).toBe("invalid-phone");
    });

    it("handles null and undefined gracefully", () => {
      expect(toE164(null)).toBe("");
      expect(toE164(undefined)).toBe("");
      expect(toE164("")).toBe("");
    });
  });

  describe("formatTenDigitsDisplay", () => {
    it("formats 10 digits with 5+5 space separation", () => {
      expect(formatTenDigitsDisplay("9876543210")).toBe("98765 43210");
      expect(formatTenDigitsDisplay("+919876543210")).toBe("98765 43210");
      expect(formatTenDigitsDisplay("09876543210")).toBe("98765 43210");
    });

    it("returns input as-is if 5 or fewer digits", () => {
      expect(formatTenDigitsDisplay("98765")).toBe("98765");
      expect(formatTenDigitsDisplay("98")).toBe("98");
      expect(formatTenDigitsDisplay("")).toBe("");
    });

    it("formats partial numbers between 6 and 9 digits", () => {
      expect(formatTenDigitsDisplay("987654")).toBe("98765 4");
      expect(formatTenDigitsDisplay("98765432")).toBe("98765 432");
    });

    it("handles null and undefined gracefully", () => {
      expect(formatTenDigitsDisplay(null)).toBe("");
      expect(formatTenDigitsDisplay(undefined)).toBe("");
    });
  });
});
