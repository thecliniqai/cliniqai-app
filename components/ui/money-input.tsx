"use client";

import React, { useState } from "react";
import { MAX_MONEY_PAISE, RUPEE, formatINRPlain, parseINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "./input";

/**
 * MoneyInput (DESIGN_SYSTEM §7.7; V2-10 10-01, D-1). A "₹" adornment and a right-aligned tabular value; `type="text"`,
 * `inputMode="decimal"` (the `decimal` input kind: no wheel-scroll, no `e`). While focused it shows the digits as typed
 * (grouping stripped); on blur it shows en-IN grouping (`1,25,000`, `499.50`). The value is integer **paise**:
 * `onValueChange` receives `parseINR(text)`, or null when the text is empty, not an amount with at most 2 decimals, or
 * above `maxPaise` (default the invoice cap, 10 crore rupees). Keystrokes that cannot become an amount are ignored.
 */
export interface MoneyInputProps
  extends Omit<InputProps, "value" | "defaultValue" | "onChange" | "kind" | "type" | "inputMode" | "startAdornment"> {
  /** Integer paise, or null for an empty field. */
  value: number | null;
  onValueChange: (paise: number | null) => void;
  /** Largest accepted amount in paise (inclusive). */
  maxPaise?: number;
}

/** Text a person may be in the middle of typing: digits with optional grouping commas, one point, at most 2 decimals. */
const TYPING = /^\d[\d,]*(?:\.\d{0,2})?$|^\.\d{0,2}$|^$/;

/** The paise of `text` within `maxPaise`, or null. */
export function moneyInputValue(text: string, maxPaise: number = MAX_MONEY_PAISE): number | null {
  const paise = parseINR(text);
  return paise !== null && paise <= maxPaise ? paise : null;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onValueChange, maxPaise = MAX_MONEY_PAISE, onFocus, onBlur, className, invalid, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");
  const shown = focused ? text : value === null ? "" : formatINRPlain(value);
  const typedInvalid = focused && text !== "" && moneyInputValue(text, maxPaise) === null;

  return (
    <Input
      ref={ref}
      {...props}
      kind="decimal"
      startAdornment={RUPEE}
      value={shown}
      invalid={invalid || typedInvalid}
      className={cn("text-right tabular-nums", className)}
      onFocus={(event) => {
        setText(value === null ? "" : formatINRPlain(value).replace(/,/g, ""));
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      onChange={(event) => {
        const next = event.target.value.trim();
        if (!TYPING.test(next)) return;
        setText(next);
        onValueChange(moneyInputValue(next, maxPaise));
      }}
    />
  );
});

MoneyInput.displayName = "MoneyInput";
