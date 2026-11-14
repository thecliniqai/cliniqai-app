"use client";

import React, { useId, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDaysYmd, isYmd } from "@/lib/datetime";
import { useClinicToday } from "@/lib/datetime/client";
import { formatClinicDate, formatClinicDateWithWeekday, formatDmy, parseDmy } from "@/lib/datetime/format";
import { joinIds } from "@/lib/ui/ids";
import { Calendar } from "./calendar";
import { ChipGroup } from "./chip-group";
import { useFieldProps } from "./field";
import { IconButton } from "./icon-button";
import { Input } from "./input";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "./popover";

/**
 * DateField (V2-06 06-02c; 06-UI-SPEC DateField, DESIGN_SYSTEM §5 "Date (entry)", §6.2, §7.8): a clinic date typed as
 * `dd/mm/yyyy` (never mm/dd) or picked from the Calendar popover ("Choose date"). The value is a clinic date string
 * (`YYYY-MM-DD`) or null; "today" is the clinic's date in its zone (`ClinicTimeZoneProvider`), never the browser's.
 *
 * - Typing: digits only, the slashes are added as you type ("12112026" → "12/11/2026"); "1/2/2026" works too. The
 *   date is read on blur (and as soon as the year has four digits): a real date inside `min`..`max` becomes the value;
 *   anything else keeps the text and shows what to do ("Enter the date as dd/mm/yyyy", "Enter a date on or before
 *   15 Nov 2026"). Clearing the text clears the value.
 * - Under the field the picked date reads `Thu, 12 Nov 2026` (formatted through `lib/datetime/format`), and it is part
 *   of the input's description.
 * - "Choose date" opens the Calendar on the picked day (else today); Enter picks, Escape closes; either way focus goes
 *   back to the text field.
 * - `quickPicks` adds the "Today" / "Tomorrow" chips for scheduling contexts.
 * Inside a `Field` the input takes the field's id, label and description.
 */
export interface DateFieldProps {
  value: string | null;
  onValueChange: (ymd: string | null) => void;
  min?: string;
  max?: string;
  /** Show the "Today" / "Tomorrow" chips (scheduling contexts). */
  quickPicks?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  name?: string;
  "aria-describedby"?: string;
  className?: string;
}

const PLACEHOLDER = "dd/mm/yyyy";

/**
 * Normalises what was typed into the `dd/mm/yyyy` shape: digits fill day (2), month (2), year (4) in order; a
 * separator (/, ., -, space) closes the current part early, so "1/2/2026" stays as typed. An ISO date pasted in
 * (`2026-11-12`) is turned round.
 */
export function normaliseDmyText(raw: string): string {
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(raw);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const max = [2, 2, 4];
  const parts = ["", "", ""];
  let index = 0;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      if (parts[index].length === max[index]) {
        if (index === 2) continue;
        index += 1;
      }
      parts[index] += ch;
    } else if (/[/.\-\s]/.test(ch) && parts[index].length > 0 && index < 2) {
      index += 1;
    }
  }
  return parts[0] + (index >= 1 ? `/${parts[1]}` : "") + (index >= 2 ? `/${parts[2]}` : "");
}

type Reading = { kind: "empty" } | { kind: "date"; ymd: string } | { kind: "error"; message: string };

function readText(text: string, min?: string, max?: string): Reading {
  if (text.trim() === "") return { kind: "empty" };
  const ymd = parseDmy(text);
  if (!ymd) return { kind: "error", message: "Enter the date as dd/mm/yyyy" };
  if (min && isYmd(min) && ymd < min) return { kind: "error", message: `Enter a date on or after ${formatClinicDate(min)}` };
  if (max && isYmd(max) && ymd > max) return { kind: "error", message: `Enter a date on or before ${formatClinicDate(max)}` };
  return { kind: "date", ymd };
}

export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  {
    value,
    onValueChange,
    min,
    max,
    quickPicks = false,
    disabled = false,
    invalid,
    id,
    name,
    "aria-describedby": describedBy,
    className,
  },
  ref,
) {
  const field = useFieldProps({ id, "aria-describedby": describedBy, invalid });
  const own = useId();
  const inputId = field.id ?? `${own}-input`;
  const readableId = `${own}-date`;
  const errorId = `${own}-error`;
  const today = useClinicToday();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => (value && isYmd(value) ? formatDmy(value) : ""));
  const [error, setError] = useState<string | null>(null);
  // The value changed from outside (calendar, quick chip, parent): show it.
  const [shown, setShown] = useState<string | null>(value);
  if (value !== shown) {
    setShown(value);
    setText(value && isYmd(value) ? formatDmy(value) : "");
    setError(null);
  }

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const commit = (nextText: string) => {
    const reading = readText(nextText, min, max);
    if (reading.kind === "error") {
      setError(reading.message);
      return;
    }
    setError(null);
    const next = reading.kind === "date" ? reading.ymd : null;
    if (next !== value) {
      setShown(next);
      onValueChange(next);
    }
  };

  const pick = (ymd: string) => {
    setShown(ymd);
    setText(formatDmy(ymd));
    setError(null);
    if (ymd !== value) onValueChange(ymd);
  };

  const tomorrow = addDaysYmd(today, 1);
  const quickValue = value === today ? "today" : value === tomorrow ? "tomorrow" : "";
  const showError = Boolean(error);
  const readable = !showError && value && isYmd(value) ? formatClinicDateWithWeekday(value) : null;

  return (
    <div className={cn("grid w-full gap-1.5", className)} data-date-field="">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="flex w-full items-start gap-1.5">
            <Input
              ref={setRefs}
              id={inputId}
              name={name}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
              spellCheck={false}
              placeholder={PLACEHOLDER}
              maxLength={10}
              disabled={disabled}
              value={text}
              invalid={field.invalid || showError}
              aria-describedby={joinIds(field["aria-describedby"], readable ? readableId : null, showError ? errorId : null)}
              onChange={(event) => {
                const next = normaliseDmyText(event.target.value);
                setText(next);
                if (error) setError(null);
                // A full date (four-digit year) is read at once; a partial one waits for blur.
                if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(next) || next === "") commit(next);
              }}
              onBlur={() => commit(text)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit(text);
              }}
              wrapperClassName="flex-1"
              className="tabular-nums"
            />
            <PopoverTrigger asChild>
              <IconButton
                label="Choose date"
                icon={<CalendarDays />}
                variant="bordered"
                disabled={disabled}
                aria-haspopup="dialog"
              />
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent
          aria-label="Choose date"
          align="end"
          className="max-h-(--radix-popover-content-available-height) touch:p-2"
          // The calendar focuses its own day (autoFocus); closing returns focus to the text field, not the button.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Calendar
            value={value}
            min={min}
            max={max}
            focusOnMount
            onValueChange={(ymd) => {
              pick(ymd);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {quickPicks && (
        <ChipGroup
          type="single"
          aria-label="Quick dates"
          disabled={disabled}
          value={quickValue}
          onValueChange={(next) => pick(next === "today" ? today : tomorrow)}
          items={[
            { value: "today", label: "Today", disabled: Boolean(max && today > max) || Boolean(min && today < min) },
            {
              value: "tomorrow",
              label: "Tomorrow",
              disabled: Boolean(max && tomorrow > max) || Boolean(min && tomorrow < min),
            },
          ]}
        />
      )}
      {readable && (
        <p id={readableId} className="text-label tabular-nums text-fg-muted">
          {readable}
        </p>
      )}
      {showError && (
        <p id={errorId} className="text-label text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
});

DateField.displayName = "DateField";
