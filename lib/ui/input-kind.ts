/**
 * Input kinds (V2-06 06-02a step 4, PWA-07; PWA_STRATEGY §3.5): one `kind` sets the attributes that pick the right
 * mobile keyboard and autofill, so a call site cannot forget them. Explicit props on `<Input>` still win.
 *
 * - Every numeric-like kind (`tel`, `otp`, `pincode`, `numeric`, `decimal`) has an `inputMode` and an `enterKeyHint`
 *   (the PWA §3.5 guard; tests/design/input-kind.spec.ts and tests/e2e/design/input-modes.spec.ts).
 * - Numbers that are not quantities (mobile numbers, codes, pincodes, vitals, money) are `type="text"` with an
 *   `inputMode`, never `type="number"` (no spinners, no scroll-to-change, leading zeros kept).
 * - Patient names: `autoComplete="off"` so the staff member's own autofill never fills a patient's name.
 * - `otp` sets no `pattern` or length: the reset code is 8 digits, the sign-up code 6 (the caller sets `maxLength`).
 */
export const INPUT_KINDS = [
  "tel",
  "otp",
  "email",
  "password-current",
  "password-new",
  "pincode",
  "numeric",
  "decimal",
  "search",
  "name",
] as const;

export type InputKind = (typeof INPUT_KINDS)[number];

export interface InputKindAttributes {
  type: "text" | "tel" | "email" | "password" | "search";
  inputMode: "text" | "tel" | "email" | "numeric" | "decimal" | "search";
  autoComplete: string;
  enterKeyHint: "enter" | "done" | "go" | "next" | "previous" | "search" | "send";
  autoCapitalize: "none" | "off" | "sentences" | "words" | "characters";
  maxLength?: number;
  spellCheck?: boolean;
}

export const INPUT_KIND_ATTRIBUTES: Readonly<Record<InputKind, Readonly<InputKindAttributes>>> = {
  tel: { type: "tel", inputMode: "numeric", autoComplete: "tel-national", enterKeyHint: "next", autoCapitalize: "none", spellCheck: false },
  otp: { type: "text", inputMode: "numeric", autoComplete: "one-time-code", enterKeyHint: "go", autoCapitalize: "none", spellCheck: false },
  email: { type: "email", inputMode: "email", autoComplete: "email", enterKeyHint: "next", autoCapitalize: "none", spellCheck: false },
  "password-current": { type: "password", inputMode: "text", autoComplete: "current-password", enterKeyHint: "go", autoCapitalize: "none", spellCheck: false },
  "password-new": { type: "password", inputMode: "text", autoComplete: "new-password", enterKeyHint: "next", autoCapitalize: "none", spellCheck: false },
  pincode: { type: "text", inputMode: "numeric", autoComplete: "postal-code", enterKeyHint: "next", autoCapitalize: "none", maxLength: 6, spellCheck: false },
  numeric: { type: "text", inputMode: "numeric", autoComplete: "off", enterKeyHint: "next", autoCapitalize: "none", spellCheck: false },
  decimal: { type: "text", inputMode: "decimal", autoComplete: "off", enterKeyHint: "next", autoCapitalize: "none", spellCheck: false },
  search: { type: "search", inputMode: "search", autoComplete: "off", enterKeyHint: "search", autoCapitalize: "none", spellCheck: false },
  name: { type: "text", inputMode: "text", autoComplete: "off", enterKeyHint: "next", autoCapitalize: "words" },
};

/** Kinds whose keyboard must be numeric-like (the PWA §3.5 guard). */
export const NUMERIC_LIKE_KINDS: readonly InputKind[] = ["tel", "otp", "pincode", "numeric", "decimal"];

export function inputKindAttributes(kind: InputKind | undefined): Partial<InputKindAttributes> {
  return kind ? { ...INPUT_KIND_ATTRIBUTES[kind] } : {};
}
