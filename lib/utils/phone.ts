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
 * Strict E.164 for an Indian mobile, for identity comparisons (AR2-L3): `+91` + `[6-9]` + 9 digits, or null.
 * Accepts only a bare 10-digit mobile, `0` + 10 digits, `91` + 10 digits or `0091` + 10 digits (separators ignored).
 * Unlike `extractTenDigits`, it never keeps "the last 10 digits" of a longer number, so `+1 917 123 4567` is not
 * `+919171234567`.
 */
export function toIndianMobileE164Strict(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  let local: string | null = null;
  if (digits.length === 10) local = digits;
  else if (digits.length === 11 && digits.startsWith("0")) local = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith("91")) local = digits.slice(2);
  else if (digits.length === 14 && digits.startsWith("0091")) local = digits.slice(4);
  if (!local || !INDIAN_MOBILE_REGEX.test(local)) return null;
  return `+91${local}`;
}

/**
 * Strict E.164 for an Indian mobile given in international form only (AR3-N3), for an inbound sender: `+91` / `91` /
 * `0091` + `[6-9]` + 9 digits (spaces, dashes, dots and parentheses ignored), or null. A bare 10-digit or `0`-prefixed
 * number carries no country code and is refused, so a foreign number whose international digits happen to be ten
 * (`+65 9123 4567` -> `6591234567`) never reads as an Indian mobile.
 */
export function toIndianMobileE164FromInternational(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const compact = phone.trim().replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;
  const digits = compact.replace(/^\+/, "");
  let local: string | null = null;
  if (digits.length === 12 && digits.startsWith("91")) local = digits.slice(2);
  else if (!compact.startsWith("+") && digits.length === 14 && digits.startsWith("0091")) local = digits.slice(4);
  if (!local || !INDIAN_MOBILE_REGEX.test(local)) return null;
  return `+91${local}`;
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
