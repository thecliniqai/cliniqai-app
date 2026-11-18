"use client";

import React, { useId, useState } from "react";
import { CalendarX2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatClinicTime } from "@/lib/datetime/format";
import { Alert } from "./alert";
import { Checkbox } from "./checkbox";
import { ChipGroup } from "./chip-group";

/**
 * SlotPicker (V2-06 06-02c; 06-UI-SPEC SlotPicker, DESIGN_SYSTEM §6.2): appointment slots for one clinic day, grouped
 * "Morning" (before 12:00), "Afternoon" (12:00-16:59) and "Evening" (17:00 on), each group label 12/500 fg-muted.
 * Slots are `chip`s, min-width 92, tabular ("11:30 am"). Each group is a `radiogroup` (one choice across the day:
 * picking in one group clears the others); roving focus inside a group, Tab moves between groups.
 *
 * Full slots are hidden unless "Show full slots" is on; a full slot then reads "11:30 am · Full", and picking it is an
 * overbooking, so a warning Alert says so with the reason ("3 of 3 booked"). With no free slot (and full ones
 * hidden) it says "No free slots on this day".
 *
 * Presentational: slots arrive as props and the value is the slot's `HH:mm`; booking (V2-08) owns the data.
 */
export interface Slot {
  /** Wall-clock start in the clinic's zone, `HH:mm`. */
  time: string;
  full?: boolean;
  booked?: number;
  capacity?: number;
}

export interface SlotPickerProps {
  slots: readonly Slot[];
  value: string | null;
  onValueChange: (time: string) => void;
  /** Start with full slots shown. */
  defaultShowFull?: boolean;
  className?: string;
}

const GROUPS = [
  { id: "morning", label: "Morning", test: (h: number) => h < 12 },
  { id: "afternoon", label: "Afternoon", test: (h: number) => h >= 12 && h < 17 },
  { id: "evening", label: "Evening", test: (h: number) => h >= 17 },
] as const;

export function groupSlots(slots: readonly Slot[]): { id: string; label: string; slots: Slot[] }[] {
  return GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    slots: slots.filter((slot) => group.test(Number(slot.time.slice(0, 2)))).sort((a, b) => a.time.localeCompare(b.time)),
  })).filter((group) => group.slots.length > 0);
}

export function SlotPicker({ slots, value, onValueChange, defaultShowFull = false, className }: SlotPickerProps) {
  const id = useId();
  const [showFull, setShowFull] = useState(defaultShowFull);
  const visible = slots.filter((slot) => showFull || !slot.full || slot.time === value);
  const groups = groupSlots(visible);
  const picked = slots.find((slot) => slot.time === value);
  const anyFull = slots.some((slot) => slot.full);

  return (
    <div className={cn("flex flex-col gap-4", className)} data-slot-picker="">
      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-border-strong px-4 py-6 text-center">
          <CalendarX2 aria-hidden="true" className="size-6 text-fg-icon" strokeWidth={1.75} />
          <p className="text-title-3 font-semibold text-fg">No free slots on this day</p>
          {anyFull && <p className="text-body-sm text-fg-muted">Show full slots to overbook one.</p>}
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.id} className="flex flex-col gap-2">
            <p id={`${id}-${group.id}`} className="text-label font-medium text-fg-muted">
              {group.label}
            </p>
            <ChipGroup
              type="single"
              aria-labelledby={`${id}-${group.id}`}
              value={group.slots.some((slot) => slot.time === value) ? (value ?? "") : ""}
              onValueChange={onValueChange}
              items={group.slots.map((slot) => {
                const time = formatClinicTime(slot.time);
                return {
                  value: slot.time,
                  label: <span className="inline-block min-w-[4.75rem] text-center tabular-nums">{time}</span>,
                  meta: slot.full ? "Full" : undefined,
                  "aria-label": slot.full ? `${time}, full` : time,
                };
              })}
            />
          </div>
        ))
      )}
      {anyFull && (
        <Checkbox checked={showFull} onCheckedChange={(next) => setShowFull(next === true)} label="Show full slots" />
      )}
      {picked?.full && (
        <Alert tone="warning" title="This slot is full">
          {formatClinicTime(picked.time)} already has
          {picked.capacity ? ` ${picked.booked ?? picked.capacity} of ${picked.capacity} booked` : " its bookings"}. Booking it
          overbooks the slot.
        </Alert>
      )}
    </div>
  );
}
