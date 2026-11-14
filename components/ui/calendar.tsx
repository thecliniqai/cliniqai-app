"use client";

import React, { useEffect, useRef } from "react";
import { TZDate } from "@date-fns/tz";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DayButtonProps } from "react-day-picker";
import { enIN } from "react-day-picker/locale";
import { cn } from "@/lib/utils";
import { isYmd, ymdOf } from "@/lib/datetime";
import { useClinicTimeZone } from "@/lib/datetime/client";
import { formatClinicDateLong, formatMonthYear } from "@/lib/datetime/format";
import {
  FOCUS_RING,
  ICON_BUTTON_INTERACTIVE,
  ICON_BUTTON_SIZE,
  ICON_BUTTON_VARIANT,
  TRANSITION,
} from "@/lib/ui/variants";

/**
 * Calendar (V2-06 06-02c; 06-UI-SPEC Calendar, DESIGN_SYSTEM §7.8; react-day-picker 10.0.2): a month grid for picking
 * one clinic date. Values are clinic dates (`YYYY-MM-DD`); the grid computes "today", month boundaries and the picked
 * day in the clinic's zone (`ClinicTimeZoneProvider`, default `Asia/Kolkata`), never the browser's, with noon-safe
 * date maths (`noonSafe`), so a day picked late in the evening or in a far-off browser zone is the day shown.
 *
 * Look: header "November 2026" (title-3) with Previous / Next month buttons; day cells 36 px (44 on touch), radius-sm,
 * tabular; today in accent-fg 600; selected = accent fill, white text; disabled = fg-disabled. Weeks start on Sunday
 * (CLDR en-IN, CD-24: date-fns' `enIN` says Monday, so `weekStartsOn` is set explicitly). Days outside the month are
 * not drawn.
 *
 * Keyboard (react-day-picker's grid): one day is in the tab order; arrows move by day and week, PageUp / PageDown by
 * month (with Shift by year), Home / End to the start / end of the week, Enter or Space picks. Escape belongs to the
 * surrounding Popover (DateField), which closes and returns focus to the field.
 */
export interface CalendarProps {
  /** The picked clinic date, or null. */
  value: string | null;
  onValueChange: (ymd: string) => void;
  /** Earliest pickable date (inclusive). */
  min?: string;
  /** Latest pickable date (inclusive). */
  max?: string;
  /**
   * Move focus into the grid when the calendar mounts: the picked day, else today, else the first enabled day (the
   * date-picker dialog pattern: the popover opens on the grid).
   */
  focusOnMount?: boolean;
  className?: string;
}

/** A clinic date as the instant DayPicker works with: noon of that day in the clinic's zone. */
export function ymdToZonedNoon(ymd: string, timeZone: string): TZDate {
  const [y, m, d] = ymd.split("-").map(Number);
  return new TZDate(y, m - 1, d, 12, 0, 0, timeZone);
}

export function Calendar({ value, onValueChange, min, max, focusOnMount = false, className }: CalendarProps) {
  const timeZone = useClinicTimeZone();
  const selected = value && isYmd(value) ? ymdToZonedNoon(value, timeZone) : undefined;
  const minDate = min && isYmd(min) ? ymdToZonedNoon(min, timeZone) : undefined;
  const maxDate = max && isYmd(max) ? ymdToZonedNoon(max, timeZone) : undefined;
  const disabled = [minDate && { before: minDate }, maxDate && { after: maxDate }].filter(
    (m): m is { before: TZDate } | { after: TZDate } => Boolean(m),
  );
  const dayLabel = (date: Date, modifiers: { today?: boolean; selected?: boolean }) => {
    const text = formatClinicDateLong(ymdOf(date, timeZone));
    return [modifiers.today ? `Today, ${text}` : text, modifiers.selected ? "selected" : null].filter(Boolean).join(", ");
  };

  return (
    <DayPicker
      mode="single"
      required={false}
      timeZone={timeZone}
      noonSafe
      locale={enIN}
      weekStartsOn={0}
      selected={selected}
      defaultMonth={selected ?? undefined}
      startMonth={minDate}
      endMonth={maxDate}
      disabled={disabled.length > 0 ? disabled : undefined}
      // The grid takes focus only when it was just opened from "Choose date" (focusOnMount), never on page load.
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={focusOnMount}
      onSelect={(date) => {
        if (date) onValueChange(ymdOf(date, timeZone));
      }}
      labels={{
        labelNav: () => "Month navigation",
        labelPrevious: () => "Previous month",
        labelNext: () => "Next month",
        labelGrid: (date) => formatMonthYear(ymdOf(date, timeZone)),
        labelDayButton: (date, modifiers) => dayLabel(date, modifiers),
      }}
      formatters={{
        formatCaption: (date) => formatMonthYear(ymdOf(date, timeZone)),
      }}
      className={cn("relative w-fit text-fg", className)}
      classNames={{
        months: "relative flex flex-col",
        month: "flex flex-col gap-2",
        month_caption: "flex h-control-dense items-center pr-20 touch:h-control touch:pr-24",
        caption_label: "text-title-3 font-semibold text-fg",
        nav: "absolute top-0 right-0 z-10 flex items-center gap-1",
        month_grid: "border-collapse",
        weekdays: "",
        weekday: "size-9 p-0 text-center text-caption font-semibold text-fg-muted touch:w-control",
        weeks: "",
        week: "",
        day: "p-0 text-center",
      }}
      components={{
        DayButton: CalendarDayButton,
        PreviousMonthButton: (props) => <MonthButton {...props} direction="previous" />,
        NextMonthButton: (props) => <MonthButton {...props} direction="next" />,
        Chevron: () => <></>,
      }}
    />
  );
}

/** A day: 36 px (44 touch), radius-sm, tabular; react-day-picker focuses the day its keyboard model lands on. */
function CalendarDayButton({ day, modifiers, className, ...props }: DayButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  void day;
  const selected = Boolean(modifiers.selected);
  return (
    <button
      ref={ref}
      {...props}
      data-day-button=""
      className={cn(
        className,
        "relative inline-flex size-9 items-center justify-center rounded-sm text-body-sm tabular-nums touch:size-control",
        TRANSITION,
        FOCUS_RING,
        "focus-visible:z-10",
        modifiers.disabled
          ? "cursor-not-allowed text-fg-disabled"
          : selected
            ? "cursor-pointer bg-accent font-semibold text-fg-on-accent hover:bg-accent-hover"
            : cn("cursor-pointer text-fg hover:bg-hover", modifiers.today && "font-semibold text-accent-fg"),
      )}
    />
  );
}

/** Previous / Next month: IconButton look (36 ghost, 44 touch), no tooltip inside the popover. */
function MonthButton({
  direction,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { direction: "previous" | "next" }) {
  void className;
  const inert = props["aria-disabled"] === true || props["aria-disabled"] === "true";
  return (
    <button
      {...props}
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        TRANSITION,
        FOCUS_RING,
        ICON_BUTTON_SIZE.md,
        ICON_BUTTON_VARIANT.ghost,
        inert ? "cursor-not-allowed text-fg-disabled" : ICON_BUTTON_INTERACTIVE.ghost,
      )}
    >
      {direction === "previous" ? (
        <ChevronLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
      ) : (
        <ChevronRight aria-hidden="true" className="size-4" strokeWidth={1.75} />
      )}
    </button>
  );
}
