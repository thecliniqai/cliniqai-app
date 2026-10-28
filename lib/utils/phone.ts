/**
 * Phone utilities for Indian mobile number standardization conforming to the
 * Indian National Numbering Plan (NNP) and ITU-T E.164.
 *
 * Rules:
 * - 10-digit subscriber numbers starting with 6, 7, 8, or 9
 * - ITU-T E.164 database format: +91XXXXXXXXXX
 * - 5+5 display grouping: 98765 43210
 */

export const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

/**
 * Strips all non-digit characters and extracts the 10-digit Indian subscriber number.
 * Handles inputs with "+91", "91", leading "0", or formatted dashes/spaces.
 */
export function extractTenDigits(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

/**
 * Normalizes input to international ITU-T E.164 format (+91XXXXXXXXXX).
 * Returns +91${digits} if valid 10-digit Indian mobile, otherwise returns
 * trimmed input or empty string.
 */
export function toE164(phone: string | null | undefined): string {
  const digits = extractTenDigits(phone);
  if (digits.length === 10 && INDIAN_MOBILE_REGEX.test(digits)) {
    return `+91${digits}`;
  }
  return phone?.trim() || "";
}

/**
 * Validates whether the given string is a valid 10-digit Indian mobile number.
 * Accepts strings with +91, 0, or formatting if the extracted 10 digits
 * match the Indian National Numbering Plan (/^[6-9]\d{9}$/).
 */
export function isValidIndianMobile(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = extractTenDigits(phone);
  return digits.length === 10 && INDIAN_MOBILE_REGEX.test(digits);
}

/**
 * Formats a 10-digit number for display with standard grouping (5+5):
 * "9876543210" -> "98765 43210"
 * If 5 or fewer digits, returns as-is.
 */
export function formatTenDigitsDisplay(phone: string | null | undefined): string {
  const digits = extractTenDigits(phone);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5, 10)}`;
}
