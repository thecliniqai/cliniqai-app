/**
 * Money display (DESIGN_SYSTEM §5 "Money (display)", §7.7; V2-10 10-01, D-1). The one formatter for rupee amounts:
 * `formatINR(paise)` takes integer paise and prints en-IN grouping with paise only when non-zero: `₹1,25,000`,
 * `₹499.50`, and a negative with a true minus sign (U+2212): `−₹50`.
 *
 * The grouping is done here (last three digits, then pairs), not by ICU, so the text is the same on every runtime (the
 * printed receipt and its golden text depend on it). The ui-policy rule `money-format` bans `toLocaleString("en-IN")`
 * on numbers and literal `"₹" +` / `` `₹${…}` `` outside `lib/money`.
 */

/** U+2212 MINUS SIGN: negative amounts (discounts, refunds) on screens and receipts. */
export const MINUS = "−";
export const RUPEE = "₹";

/** `1,25,000` for 125000: Indian digit grouping of a non-negative integer. */
export function groupIndian(whole: number | bigint): string {
  const digits = String(whole);
  if (!/^\d+$/.test(digits)) throw new RangeError("groupIndian expects a non-negative integer");
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+$)/g, ",")},${tail}`;
}

function assertPaise(paise: number): void {
  if (!Number.isSafeInteger(paise)) throw new RangeError("Money amounts are integer paise");
}

/** `₹1,25,000` / `₹499.50` / `−₹50` for an amount in integer paise. */
export function formatINR(paise: number): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  const text = `${RUPEE}${groupIndian(rupees)}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
  return negative ? `${MINUS}${text}` : text;
}

/**
 * `Rs. 1,25,000` / `Rs. 499.50` / `-Rs. 50`: the same amount for a PDF drawn with the standard PDF fonts (Helvetica,
 * WinAnsi), which have no `₹` (U+20B9) or `−` (U+2212) glyph: drawn there they come out as `¹` and a control character.
 * The receipt PDF uses this until it embeds a font that has the rupee sign (V2-10 10-05, receipt letterhead).
 */
export function formatINRAscii(paise: number): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  const text = `Rs. ${groupIndian(rupees)}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
  return negative ? `-${text}` : text;
}

/**
 * The value text of a money field without the symbol (`1,25,000`, `499.50`): what `MoneyInput` shows on blur next to its
 * "₹" adornment. Negative amounts are not field values and are refused.
 */
export function formatINRPlain(paise: number): string {
  assertPaise(paise);
  if (paise < 0) throw new RangeError("A money field holds a non-negative amount");
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `${groupIndian(rupees)}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}
