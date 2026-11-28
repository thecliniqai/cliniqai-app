/**
 * Money conversion and parsing (DESIGN_SYSTEM §7.7; V2-10 10-01, D-1). The database keeps rupees as `NUMERIC(10,2)`;
 * the app works in integer paise and converts only at the service boundary:
 *   - `toPaise(rupees)`  a database/rupee value (number or numeric text) → integer paise, exact for 2-decimal values;
 *   - `fromPaise(paise)` integer paise → the rupee number a command parameter or column takes;
 *   - `parseINR(text)`   what a person typed (`1,25,000`, `₹499.5`) → integer paise, or null when it is not a plain
 *                        non-negative amount with at most 2 decimals (`1e3`, `1.234`, `-5`, `abc`, `` are refused).
 */

/** The largest amount the app accepts anywhere (paise): the invoice cap of 10 crore rupees (CHECK invoices_total_cap). */
export const MAX_MONEY_PAISE = 100_000_000 * 100;

const DECIMAL_TEXT = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Integer paise of a rupee value. Values with more than 2 decimals are rounded half away from zero to the paisa. */
export function toPaise(rupees: number | string): number {
  if (typeof rupees === "string") {
    const m = DECIMAL_TEXT.exec(rupees.trim());
    if (!m) throw new RangeError("Not a decimal amount");
    const [, sign, whole, frac = ""] = m;
    const two = (frac + "00").slice(0, 2);
    let paise = Number(whole) * 100 + Number(two);
    if (frac.length > 2 && Number(frac[2]) >= 5) paise += 1;
    if (!Number.isSafeInteger(paise)) throw new RangeError("Amount out of range");
    return sign && paise !== 0 ? -paise : paise;
  }
  if (!Number.isFinite(rupees)) throw new RangeError("Not a finite amount");
  // `x * 100` of a 2-decimal double lies within a few ulps of an integer; 15 significant digits removes that noise
  // before rounding (0.29 * 100 = 28.999999999999996 → 29).
  const scaled = Number((Math.abs(rupees) * 100).toPrecision(15));
  const paise = Math.round(scaled);
  if (!Number.isSafeInteger(paise)) throw new RangeError("Amount out of range");
  return rupees < 0 && paise !== 0 ? -paise : paise;
}

/** Rupees of an integer paise amount (the value a `numeric(10,2)` parameter takes). */
export function fromPaise(paise: number): number {
  if (!Number.isSafeInteger(paise)) throw new RangeError("Money amounts are integer paise");
  return paise / 100;
}

/** A rupee value rounded to the paisa (what the commands accept): `fromPaise(toPaise(x))`. */
export function roundRupees(rupees: number | string): number {
  return fromPaise(toPaise(rupees));
}

// Digits with optional en-IN (`1,25,000`) or international (`125,000`) grouping, then up to 2 decimals.
const TYPED = /^(\d{1,3}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{0,2}))?$/;

/** Integer paise of a typed amount, or null. Accepts an optional leading `₹` and surrounding blanks. */
export function parseINR(text: string): number | null {
  if (typeof text !== "string") return null;
  const raw = text.trim().replace(/^₹\s*/, "");
  if (raw === "" || raw === ".") return null;
  const m = TYPED.exec(raw);
  if (!m) return null;
  const [, whole = "", frac] = m;
  if (whole === "" && (frac === undefined || frac === "")) return null;
  const rupees = Number(whole.replace(/,/g, "") || "0");
  const paise = rupees * 100 + Number(((frac ?? "") + "00").slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise > MAX_MONEY_PAISE) return null;
  return paise;
}
