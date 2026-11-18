"use client";

import React, { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { useClinicToday } from "@/lib/datetime/client";
import { formatMonthShortYear } from "@/lib/datetime/format";
import { ageEntryFor, dobFromAge, formatAge, parseAgeAmount, type AgeUnit } from "@/lib/ui/age";
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
 *   (`lib/ui/age.ts` `dobFromAge`: 1 Jan of the birth year from 2 years, the server's convention).
 *   06-09c (M-INFANTAGE, IND M-5): "0" in years switches the unit to months and asks for the infant's age in months
 *   (no date of birth until then); "1 year" is 12 months. So the date of birth reads back as what was typed on every
 *   later screen ("12 m", never "22 m").
 * - 06-09c (IND L-7): a value set from outside (editing a patient, a reset) fills the age box ("42" years, "8"
 *   months), as DateField shows an outside value.
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

export const INFANT_MONTHS_NOTICE = "Below 1 year, enter the age in months";

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
  const initial = value.mode === "age" && value.dob ? ageEntryFor(value.dob, today) : null;
  const [ageText, setAgeText] = useState(initial?.text ?? "");
  const [unit, setUnit] = useState<AgeUnit>(initial?.unit ?? "y");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The last value this control reported (or was given): a different one came from outside (L-7).
  const [known, setKnown] = useState<{ mode: AgeOrDobMode; dob: string | null }>({ mode: value.mode, dob: value.dob });
  if (value.mode !== known.mode || value.dob !== known.dob) {
    setKnown({ mode: value.mode, dob: value.dob });
    if (value.mode === "age") {
      const entry = value.dob ? ageEntryFor(value.dob, today) : null;
      setAgeText(entry?.text ?? "");
      if (entry) setUnit(entry.unit);
      setRangeError(null);
      setNotice(null);
    }
  }

  const report = (next: AgeOrDobValue) => {
    setKnown({ mode: next.mode, dob: next.dob });
    onValueChange(next);
  };

  const shownError = error ?? rangeError ?? undefined;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const fromAge = (text: string, nextUnit: AgeUnit) => {
    setNotice(null);
    if (text.trim() === "") {
      setRangeError(null);
      report({ mode: "age", dob: null, approximate: true });
      return;
    }
    const amount = parseAgeAmount(text, nextUnit);
    if (amount === null) {
      setRangeError(RANGE_ERROR[nextUnit]);
      report({ mode: "age", dob: null, approximate: true });
      return;
    }
    setRangeError(null);
    if (nextUnit === "y" && amount === 0) {
      // An infant: the age is entered in months (06-09c M-INFANTAGE).
      setUnit("m");
      setAgeText("");
      setNotice(INFANT_MONTHS_NOTICE);
      report({ mode: "age", dob: null, approximate: true });
      return;
    }
    report({ mode: "age", dob: dobFromAge(amount, nextUnit, today), approximate: true });
  };

  let hint: string | null = value.mode === "age" ? notice : null;
  if (value.dob) {
    if (value.mode === "age") {
      // Month precision below 2 years ("1 year" is 12 months), the year above.
      const shownAge = formatAge(value.dob, today);
      const monthsOrDays = shownAge !== null && !shownAge.endsWith(" y");
      hint = monthsOrDays ? `Born about ${formatMonthShortYear(value.dob)}` : `Born about ${value.dob.slice(0, 4)}`;
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
          setNotice(null);
          setAgeText("");
          report({ mode: next as AgeOrDobMode, dob: null, approximate: next === "age" });
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
            onValueChange={(dob) => report({ mode: "dob", dob, approximate: false })}
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
