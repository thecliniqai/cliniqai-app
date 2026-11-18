"use client";

import React, { useState, useEffect } from "react";
import { extractTenDigits } from "@/lib/utils/phone";
import { Input } from "./input";

/**
 * PhoneInput (V2-06 06-02c; 06-UI-SPEC PhoneInput, DESIGN_SYSTEM §6.2): an Indian mobile number. Restyled onto the
 * Input primitive, logic unchanged from v1 (06-PLAN 06-02c: "PhoneInput restyled, logic unchanged"; `lib/utils/phone.ts`
 * kept): the field holds the 10 subscriber digits, non-digits are stripped and the length capped at 10, a pasted
 * number loses its `+91` / `91` / `0` prefix, and `onChange` receives the 10 digits and the E.164 form.
 *
 * Look: a "+91" start adornment (the v1 flag emoji is gone: no emoji in UI), `kind="tel"` (`type="tel"`, numeric
 * keypad, `autoComplete="tel-national"`, `enterKeyHint="next"`), 16 px text and 44 px on touch, 36 px on a fine
 * pointer. Read-only display elsewhere uses `+91 98765 43210` (`formatTenDigitsDisplay`).
 *
 * v1 props kept: `value`, `onChange(tenDigits, e164)`, `invalid`, `disabled`, `id`, `placeholder`, `className` (on the
 * box, as in v1), and the rest on the `<input>`. Inside a `Field` it takes the field's id and description.
 */
export interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size"> {
  value?: string;
  onChange?: (tenDigits: string, e164: string) => void;
  invalid?: boolean;
}

/**
 * Strips all non-digit characters and caps the input at 10 digits.
 */
export function cleanPhoneInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 10);
}

/**
 * Normalizes pasted phone number strings by stripping country codes/prefixes
 * and extracting strictly the 10 subscriber digits.
 */
export function normalizePastedPhone(pasted: string): string {
  if (!pasted) return "";
  const digits = pasted.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length > 10 && digits.startsWith("0")) return digits.slice(1, 11);
  if (digits.length > 10 && digits.startsWith("91")) return digits.slice(2, 12);
  return digits.slice(0, 10);
}

export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  (
    {
      value,
      onChange,
      invalid = false,
      disabled = false,
      className,
      id,
      placeholder = "98765 43210",
      ...props
    },
    ref
  ) => {
    const [digits, setDigits] = useState<string>(() => extractTenDigits(value));

    useEffect(() => {
      setDigits(extractTenDigits(value));
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const cleaned = cleanPhoneInput(e.target.value);
      setDigits(cleaned);
      const e164 = cleaned.length === 10 ? `+91${cleaned}` : cleaned;
      onChange?.(cleaned, e164);
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData?.getData("text") || "";
      const cleaned = normalizePastedPhone(pasted);
      setDigits(cleaned);
      const e164 = cleaned.length === 10 ? `+91${cleaned}` : cleaned;
      onChange?.(cleaned, e164);
    };

    return (
      <Input
        ref={ref}
        kind="tel"
        id={id}
        maxLength={10}
        placeholder={placeholder}
        disabled={disabled}
        invalid={invalid}
        value={digits}
        onChange={handleChange}
        onPaste={handlePaste}
        startAdornment={<span className="tabular-nums">+91</span>}
        wrapperClassName={className}
        className="tabular-nums"
        {...props}
      />
    );
  }
);

PhoneInput.displayName = "PhoneInput";
