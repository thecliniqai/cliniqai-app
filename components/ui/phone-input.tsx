"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { extractTenDigits } from "@/lib/utils/phone";

export interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
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
      <div
        className={cn(
          "relative flex items-center w-full min-h-[44px] rounded-lg border bg-white shadow-theme-xs transition-colors overflow-hidden",
          "focus-within:ring-3 focus-within:ring-offset-0",
          invalid
            ? "border-[#B42318] focus-within:border-[#B42318] focus-within:ring-[#B42318]/15"
            : "border-gray-300 focus-within:border-[#1769E0] focus-within:ring-[#1769E0]/15",
          disabled && "opacity-50 bg-gray-50 cursor-not-allowed",
          className
        )}
      >
        <div
          className="flex items-center gap-1.5 px-3 py-2 select-none border-r border-gray-200 bg-gray-50/80 rounded-l-lg text-gray-700 font-medium text-sm shrink-0 self-stretch"
          aria-hidden="true"
        >
          <span className="text-base leading-none">🇮🇳</span>
          <span className="font-semibold text-gray-700 tracking-tight text-xs sm:text-sm">
            +91
          </span>
        </div>
        <input
          ref={ref}
          id={id}
          type="tel"
          inputMode="numeric"
          maxLength={10}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={invalid}
          value={digits}
          onChange={handleChange}
          onPaste={handlePaste}
          className="flex-1 w-full bg-transparent px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:cursor-not-allowed"
          {...props}
        />
      </div>
    );
  }
);

PhoneInput.displayName = "PhoneInput";
