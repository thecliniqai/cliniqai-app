"use client";

import React, { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { useClinicToday } from "@/lib/datetime/client";
import { formatMonthShortYear } from "@/lib/datetime/format";
import { dobFromAge, formatAge, parseAgeAmount, type AgeUnit } from "@/lib/ui/age";
import { DateField } from "./date-field";
import { Input } from "./input";
import { Label } from "./label";
import { NativeSelect } from "./native-select";
import { SegmentedControl } from "./segmented-control";

/**
 * AgeOrDobInput (V2-06 06-02c; 06-UI-SPEC AgeOrDobInput, DESIGN_SYSTEM §5 "Age", §6.2): reception often knows a
 * patient's age, not the date of birth. A SegmentedControl "Age" / "Date of birth" picks the entry:
 * - Age: a numeric Input and its unit (a NativeSelect "Age unit": years by default, months below 2 years; a control
 *   of its own, so it keeps the 44 px touch target instead of sitting inside the input's box); the derived
 *   date of birth is shown as a hint ("Born about 1984", "Born about Mar 2026") and reported as approximate
 *   (`lib/ui/age.ts` `dobFromAge`: 1 Jan of the birth year, the server's convention).
 * - Date of birth: a DateField (max = the clinic's today); the derived age is the hint ("42 y", "8 m", "12 d").
 * Everything is counted from the clinic's date in its zone (`useClinicToday`), never the browser's.
 *
 * The value reported: `{ dob, approximate, mode }` (`dob` null until it is usable). `error` is shown under the
 * control and marks it invalid; the control's own range errors ("Enter an age from 0 to 130 years") appear the same
 * way.
 */
export type AgeOrDobMode = "age" | "dob";

export interface AgeOrDobValue {
  mode: AgeOrDobMode;
  /** The (possibly approximate) date of birth, `YYYY-MM-DD`, or null. */
  dob: string | null;
  /** True when `dob` was derived from an age. */
  approximate: boolean;
}

export interface AgeOrDobInputProps {
  value: AgeOrDobValue;
  onValueChange: (value: AgeOrDobValue) => void;
  /** The control's label ("Age or date of birth"). */
  label?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
}

const RANGE_ERROR: Record<AgeUnit, string> = {
  y: "Enter an age from 0 to 130 years",
  m: "Enter an age from 0 to 23 months",
};

export function AgeOrDobInput({
  value,
  onValueChange,
  label = "Age or date of birth",
  error,
  disabled = false,
  className,
}: AgeOrDobInputProps) {
  const id = useId();
  const today = useClinicToday();
  const [ageText, setAgeText] = useState("");
  const [unit, setUnit] = useState<AgeUnit>("y");
  const [rangeError, setRangeError] = useState<string | null>(null);

  const shownError = error ?? rangeError ?? undefined;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const fromAge = (text: string, nextUnit: AgeUnit) => {
    if (text.trim() === "") {
      setRangeError(null);
      onValueChange({ mode: "age", dob: null, approximate: true });
      return;
    }
    const amount = parseAgeAmount(text, nextUnit);
    if (amount === null) {
      setRangeError(RANGE_ERROR[nextUnit]);
      onValueChange({ mode: "age", dob: null, approximate: true });
      return;
    }
    setRangeError(null);
    onValueChange({ mode: "age", dob: dobFromAge(amount, nextUnit, today), approximate: true });
  };

  let hint: string | null = null;
  if (value.dob) {
    if (value.mode === "age") {
      hint = unit === "m" ? `Born about ${formatMonthShortYear(value.dob)}` : `Born about ${value.dob.slice(0, 4)}`;
    } else {
      const age = formatAge(value.dob, today);
      hint = age;
    }
  }

  return (
    <div role="group" aria-labelledby={`${id}-label`} className={cn("grid w-full gap-1.5", className)} data-age-or-dob="">
      <span id={`${id}-label`} className="text-label font-medium text-fg-secondary">
        {label}
      </span>
      <SegmentedControl
        aria-label="Enter age or date of birth"
        value={value.mode}
        disabled={disabled}
        onValueChange={(next) => {
          setRangeError(null);
          setAgeText("");
          onValueChange({ mode: next as AgeOrDobMode, dob: null, approximate: next === "age" });
        }}
        options={[
          { value: "age", label: "Age" },
          { value: "dob", label: "Date of birth" },
        ]}
      />
      {value.mode === "age" ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-age`} className="sr-only">
            Age
          </Label>
          <div className="flex items-start gap-1.5">
            <Input
              id={`${id}-age`}
              kind="numeric"
              maxLength={3}
              placeholder={unit === "y" ? "e.g. 42" : "e.g. 8"}
              disabled={disabled}
              value={ageText}
              invalid={Boolean(shownError)}
              aria-describedby={[hint ? hintId : null, shownError ? errorId : null].filter(Boolean).join(" ") || undefined}
              onChange={(event) => {
                const text = event.target.value.replace(/\D/g, "").slice(0, 3);
                setAgeText(text);
                fromAge(text, unit);
              }}
              wrapperClassName="flex-1"
              className="tabular-nums"
            />
            <NativeSelect
              aria-label="Age unit"
              value={unit}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value as AgeUnit;
                setUnit(next);
                fromAge(ageText, next);
              }}
              wrapperClassName="w-28 shrink-0"
            >
              <option value="y">years</option>
              <option value="m">months</option>
            </NativeSelect>
          </div>
        </div>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-dob`} className="sr-only">
            Date of birth
          </Label>
          <DateField
            id={`${id}-dob`}
            value={value.dob}
            max={today}
            disabled={disabled}
            invalid={Boolean(error)}
            aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
            onValueChange={(dob) => onValueChange({ mode: "dob", dob, approximate: false })}
          />
        </div>
      )}
      {hint && (
        <p id={hintId} className="text-label tabular-nums text-fg-muted">
          {hint}
        </p>
      )}
      {shownError && (
        <p id={errorId} className="text-label text-danger-fg">
          {shownError}
        </p>
      )}
    </div>
  );
}
