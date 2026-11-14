"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { addDaysYmd } from "@/lib/datetime";
import { formatClinicDate, formatDayChip } from "@/lib/datetime/format";
import { ChipGroup } from "./chip-group";

/**
 * DayStrip (V2-06 06-02c; 06-UI-SPEC DayStrip, DESIGN_SYSTEM §7.8): a horizontally scrollable row of `chip`s for
 * picking a clinic day: "Today", "Tomorrow", then "Mon 16", "Tue 17" … One choice (`radiogroup`, `aria-checked`);
 * roving focus, the arrow keys move and wrap, Home / End jump; selected = the `chip` selected look. Each chip's
 * accessible name carries the full date ("Today, 15 Nov 2026", "Mon 16 Nov 2026") so the visible text is part of it.
 *
 * `today` is the clinic's date (`useClinicToday()` from the caller, which computes it in the clinic's zone); the strip
 * does no zone maths of its own. On mount and on a new selection the selected chip is scrolled into view.
 */
export interface DayStripProps {
  /** The clinic's today, `YYYY-MM-DD`. */
  today: string;
  value: string;
  onValueChange: (ymd: string) => void;
  /** How many days from today (default 14). */
  days?: number;
  "aria-label"?: string;
  className?: string;
}

export function dayStripDays(today: string, count: number): { value: string; label: string; name: string }[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) => {
    const ymd = addDaysYmd(today, i);
    const date = formatClinicDate(ymd);
    if (i === 0) return { value: ymd, label: "Today", name: `Today, ${date}` };
    if (i === 1) return { value: ymd, label: "Tomorrow", name: `Tomorrow, ${date}` };
    const chip = formatDayChip(ymd);
    return { value: ymd, label: chip, name: `${chip} ${date.split(" ").slice(1).join(" ")}` };
  });
}

export function DayStrip({ today, value, onValueChange, days = 14, "aria-label": ariaLabel = "Day", className }: DayStripProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const items = dayStripDays(today, days);

  useEffect(() => {
    const selected = scroller.current?.querySelector<HTMLElement>('[data-state="on"]');
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);

  return (
    <div
      ref={scroller}
      data-day-strip=""
      className={cn("no-scrollbar -mx-1 max-w-full overflow-x-auto overscroll-x-contain px-1 py-1", className)}
    >
      <ChipGroup
        type="single"
        aria-label={ariaLabel}
        value={value}
        onValueChange={onValueChange}
        className="w-max flex-nowrap"
        items={items.map((day) => ({ value: day.value, label: day.label, "aria-label": day.name }))}
      />
    </div>
  );
}
