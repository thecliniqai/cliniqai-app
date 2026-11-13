/**
 * Synthetic phone numbers (V2-03 03-13, M-SEEDPHONE; review A M-5). India has no reserved fictional mobile range, so
 * seeded and test data use numbers that could belong to a real person. Every seed and fixture uses numbers starting
 * with {@link SYNTHETIC_PHONE_PREFIX} (`+91 90000 000xx`, 100 numbers), and every real messaging provider refuses to
 * send to them on every tier (`syntheticRecipientRefusal`), so a demo or staging clinic can never message a stranger.
 *
 * Accepts any of `+919000000012`, `919000000012`, `09000000012`, `9000000012`, with spaces or dashes.
 */
export const SYNTHETIC_PHONE_PREFIX = "+9190000000";

/** The 10-digit national number for a `+91` / `91` / `0`-prefixed or bare Indian mobile, or `null`. */
function nationalNumber(phone: string): string | null {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

/** Whether `phone` is in the synthetic range (never sent to). */
export function isSyntheticPhone(phone: unknown): boolean {
  if (typeof phone !== "string") return false;
  const national = nationalNumber(phone);
  return national !== null && `+91${national}`.startsWith(SYNTHETIC_PHONE_PREFIX);
}
