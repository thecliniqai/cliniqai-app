/**
 * The synthetic phone range (V2-03 03-13b, review finding M-SEEDPHONE).
 *
 * India has no reserved fictional mobile range, so any valid-looking number may belong to a real subscriber. The
 * project therefore fixes ONE block for seeded and demo data: `+91 60000 000NN` (E.164 `+9160000000NN`, NN = 00–99).
 * It passes the app's mobile rules (`[6-9]` + 9 digits, `lib/utils/phone.ts`), so seeded patients behave like real
 * ones in every screen, and it is visibly synthetic (all zeros, a two-digit index).
 *
 * Contract:
 *   - every phone the demo-clinic seed writes (`scripts/seed/demo-clinic.ts`; local stack and staging) is in this range
 *     (tests/utils/synthetic-phones.spec.ts);
 *   - the messaging layer refuses to send to any number in this range on every tier (the synthetic-number guard in
 *     `lib/messaging/**`, 03-13d), so a seeded environment can never message a stranger, even after a real provider
 *     is switched on.
 *
 * No imports: the seed scripts load this file directly with tsx (relative import, no path alias).
 */

/** The 10-digit national number of a synthetic phone starts with these 8 digits; the last 2 are the index. */
export const SYNTHETIC_PHONE_NATIONAL_PREFIX = "60000000";
/** E.164 form of the range: `+9160000000NN`. */
export const SYNTHETIC_PHONE_E164_PATTERN = /^\+9160000000\d{2}$/;
/** First and last numbers of the range, E.164. */
export const SYNTHETIC_PHONE_RANGE = { first: "+916000000000", last: "+916000000099" } as const;
/** How many numbers the range holds (indices 0–99). */
export const SYNTHETIC_PHONE_COUNT = 100;

/** The `index`-th synthetic phone in E.164 (`index` 0–99). Throws outside the range. */
export function syntheticPhone(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= SYNTHETIC_PHONE_COUNT) {
    throw new RangeError(`synthetic phone index must be an integer 0-${SYNTHETIC_PHONE_COUNT - 1}`);
  }
  return `+91${SYNTHETIC_PHONE_NATIONAL_PREFIX}${String(index).padStart(2, "0")}`;
}

/**
 * True when `phone` is a number of the synthetic range in any common spelling: E.164 (`+916000000001`), `91` /
 * `0091` / `0` prefixed, or the bare 10-digit national number, with spaces, dashes, dots or parentheses anywhere.
 * The messaging guard calls this before any provider send; false for null, empty or non-numeric input.
 */
export function isSyntheticPhone(phone: string | null | undefined): boolean {
  if (typeof phone !== "string") return false;
  const compact = phone.trim().replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(compact)) return false;
  const digits = compact.replace(/^\+/, "");
  let national: string | null = null;
  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith("0")) national = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith("91")) national = digits.slice(2);
  else if (digits.length === 14 && digits.startsWith("0091")) national = digits.slice(4);
  return national !== null && national.startsWith(SYNTHETIC_PHONE_NATIONAL_PREFIX) && /^\d{10}$/.test(national);
}
