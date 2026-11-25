"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DayStrip } from "@/components/ui/day-strip";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ChipGroup } from "@/components/ui/chip-group";
import { SlotPicker, type Slot } from "@/components/ui/slot-picker";
import { SmartAssistLabel } from "@/components/clinical/smart-assist-label";
import { getAvailableSlots } from "@/features/visits/scheduling";
import { freeSlotsOf as rangeFreeSlots, serverNowOf, type ScheduleRange } from "@/features/schedule/range";
import { suggestSlots, type FreeSlot, type TimeBand } from "@/features/visits/suggest-slots";
import { useClinicTimeZone, useClinicToday } from "@/lib/datetime/client";
import { formatClinicTime } from "@/lib/datetime/format";
import type { DoctorChoice } from "./use-doctors";
import { earliestSlot, slotLengths, toPickerSlots } from "./slot-adapter";

/**
 * SlotSection (V2-08 08-04b, R-15, R-16): the doctor, the day and the time of a booking, a move or a waitlist promotion,
 * one component for all three. The free slots come from the database (`getAvailableSlots` -> `available_slots`, the list
 * the commands check again) and are shown in the clinic's wall-clock time through the slot adapter. In booking the earliest
 * free slot is preselected (`preselect`); in a move nothing is preselected. "Pick another time" takes any quarter hour: the
 * command refuses it when the doctor is off duty, blocked or booked, and the caller then asks for the overbooking or the
 * override (`SlotConflictDialog`).
 *
 * Smart Assist (V2-08 08-05, AI-13, R-18): with `assist` (the clinic holds `assist.slots`) the top three free starts that cover the
 * doctor's average consult, ranked by the patient's usual time of day and then the earliest, show above the picker as chips
 * labelled "Smart Assist", and `preselect` chooses the first of them instead of the earliest free slot. Without `assist` the
 * section behaves as before. `assistPending` holds the preselection back until the assist inputs have arrived.
 * V2-09e 09E-12 (R-10): when the Schedule's range query holds the date and the doctor (a booking opened from the Schedule), the slots come from it (the
 * same SQL list, read with the range; kept current by the live layer) with no call; otherwise, and always for a move (the visit's own slot must be listed
 * again), `getAvailableSlots` as before.
 */
export interface SlotPlan {
  doctorId: string;
  /** Clinic date `YYYY-MM-DD`. */
  date: string;
  /** Clinic wall-clock `HH:mm`; null until a slot is chosen. */
  time: string | null;
  /** The chosen free slot's length in minutes; null for a time typed by hand. */
  minutes: number | null;
}

export interface SlotSectionProps {
  doctors: readonly DoctorChoice[];
  plan: SlotPlan;
  onPlanChange: (plan: SlotPlan) => void;
  /** A visit being moved: its own slot is listed again. */
  excludeVisitId?: string;
  /** Choose the earliest free slot as soon as the list arrives and nothing is chosen. */
  preselect?: boolean;
  /** Days offered in the strip (default 21). */
  days?: number;
  /** Smart Assist inputs when the clinic is entitled (`assist.slots`); null or absent: the basic earliest-slot rule. */
  assist?: { avgConsultMinutes: number | null; preferredBand: TimeBand | null } | null;
  /** The assist inputs are still being read: do not preselect yet. */
  assistPending?: boolean;
}

interface Loaded {
  key: string;
  slots: Slot[] | null;
  minutes: Map<string, number>;
  error: string | null;
}

/** The free slots of (doctor, date) from a Schedule range the device holds, or null when none holds them. */
function slotsFromRanges(queryClient: QueryClient, doctorId: string, date: string, timeZone: string): { slots: Slot[]; minutes: Map<string, number> } | null {
  for (const [, range] of queryClient.getQueriesData<ScheduleRange>({ predicate: (q) => q.queryKey[1] === "schedule" && q.queryKey[4] === "slots" })) {
    if (!range?.slots || range.from > date || range.to < date || !range.clinicians.some((c) => c.id === doctorId)) continue;
    const free = rangeFreeSlots(range, doctorId, date, timeZone, serverNowOf(range));
    return { slots: free.map((f) => ({ time: f.time })), minutes: new Map(free.map((f) => [f.time, f.minutes])) };
  }
  return null;
}

/** Free grid slots (clinic `HH:mm` and length) for the suggestions. */
function freeSlotsOf(minutes: ReadonlyMap<string, number>): FreeSlot[] {
  return [...minutes].map(([time, length]) => ({ time, minutes: length }));
}

export function SlotSection({
  doctors,
  plan,
  onPlanChange,
  excludeVisitId,
  preselect = false,
  days = 21,
  assist = null,
  assistPending = false,
}: SlotSectionProps) {
  const timeZone = useClinicTimeZone();
  const today = useClinicToday();
  const queryClient = useQueryClient();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [otherTime, setOtherTime] = useState(false);
  const key = `${plan.doctorId}|${plan.date}|${excludeVisitId ?? ""}|${attempt}`;
  const preselected = useRef<string | null>(null);
  const assistLabelId = useId();

  // The Schedule's range holds this day (a booking, not a move): no call. The first try only: "Try again" always asks the server.
  const held = useMemo(
    () => (plan.doctorId && !excludeVisitId && attempt === 0 ? slotsFromRanges(queryClient, plan.doctorId, plan.date, timeZone) : null),
    [queryClient, plan.doctorId, plan.date, excludeVisitId, attempt, timeZone],
  );
  useEffect(() => {
    if (!plan.doctorId || held) return;
    let live = true;
    void getAvailableSlots(plan.doctorId, plan.date, excludeVisitId)
      .then((result) => {
        if (!live) return;
        if (!result.ok) {
          setLoaded({ key, slots: null, minutes: new Map(), error: result.error.message });
          return;
        }
        // A slot that has started is not offered: the command refuses a time that has passed (SLOT_IN_PAST).
        const upcoming = result.value.filter((s) => Date.parse(s.start) >= Date.now());
        const slots = toPickerSlots(upcoming, timeZone);
        const minutes = slotLengths(upcoming, timeZone);
        setLoaded({ key, slots, minutes, error: null });
      })
      .catch(() => live && setLoaded({ key, slots: null, minutes: new Map(), error: "Couldn't load the free slots." }));
    return () => {
      live = false;
    };
    // `key` carries doctor, date, excluded visit and the retry counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, timeZone, held]);

  const current = useMemo<Loaded | null>(
    () => (held ? { key, slots: held.slots, minutes: held.minutes, error: null } : loaded?.key === key ? loaded : null),
    [held, key, loaded],
  );
  const slots = current?.slots ?? [];
  const suggestions = useMemo(
    () =>
      assist && current?.slots
        ? suggestSlots({ slots: freeSlotsOf(current.minutes), avgConsultMinutes: assist.avgConsultMinutes, preferredBand: assist.preferredBand })
        : null,
    [assist, current],
  );

  // Preselect once per list: the first suggestion (Smart Assist), else the earliest free slot; never over a chosen time.
  useEffect(() => {
    if (!preselect || assistPending || !current?.slots || plan.time !== null || preselected.current === key) return;
    const pick = suggestions?.top[0]?.time ?? earliestSlot(current.slots);
    preselected.current = key;
    if (pick) onPlanChange({ ...plan, time: pick, minutes: current.minutes.get(pick) ?? null });
  }, [preselect, assistPending, current, plan, key, suggestions, onPlanChange]);

  const handPicked = plan.time !== null && current?.slots != null && !slots.some((s) => s.time === plan.time);
  const doctorName = doctors.find((d) => d.id === plan.doctorId)?.label ?? "The doctor";

  return (
    <div className="flex flex-col gap-3" data-slot-section="">
      {doctors.length > 1 && (
        <Field label="Doctor">
          <NativeSelect
            value={plan.doctorId}
            onChange={(event) => {
              setOtherTime(false);
              onPlanChange({ ...plan, doctorId: event.target.value, time: null, minutes: null });
            }}
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <div className="grid gap-1.5">
        <span className="text-label font-medium text-fg-secondary">Day</span>
        <DayStrip
          today={today}
          days={Math.max(days, 1)}
          value={plan.date}
          onValueChange={(date) => {
            setOtherTime(false);
            onPlanChange({ ...plan, date, time: null, minutes: null });
          }}
        />
      </div>
      {!current && <p className="text-body-sm text-fg-muted">Loading free slots…</p>}
      {current?.error && (
        <Alert
          tone="danger"
          action={
            <Button type="button" size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          {current.error}
        </Alert>
      )}
      {current && !current.error && (
        <>
          {slots.length === 0 && (
            <p className="text-body-sm text-fg-muted" data-no-free-slots="">
              {doctorName} has no free slot on this day: they may be off duty, blocked or fully booked. Pick another day, or choose
              another time below.
            </p>
          )}
          {suggestions && suggestions.top.length > 0 && (
            <div className="grid gap-1.5" data-smart-assist-slots="">
              <div className="flex items-center gap-2">
                <span id={assistLabelId} className="text-label font-medium text-fg-secondary">
                  Suggested times
                </span>
                <SmartAssistLabel />
              </div>
              <ChipGroup
                type="single"
                aria-labelledby={assistLabelId}
                value={suggestions.top.some((s) => s.time === plan.time) ? (plan.time ?? "") : ""}
                onValueChange={(time) => {
                  setOtherTime(false);
                  onPlanChange({ ...plan, time, minutes: current.minutes.get(time) ?? null });
                }}
                items={suggestions.top.map((s) => ({
                  value: s.time,
                  label: <span className="inline-block min-w-[4.75rem] text-center tabular-nums">{formatClinicTime(s.time)}</span>,
                  "aria-label": `Suggested ${formatClinicTime(s.time)}`,
                }))}
              />
              {suggestions.nextFree && !suggestions.top.some((s) => s.time === suggestions.nextFree?.time) && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => onPlanChange({ ...plan, time: suggestions.nextFree!.time, minutes: current.minutes.get(suggestions.nextFree!.time) ?? null })}
                >
                  Next free: {formatClinicTime(suggestions.nextFree.time)}
                </Button>
              )}
            </div>
          )}
          <SlotPicker
            slots={slots}
            value={handPicked ? null : plan.time}
            onValueChange={(time) => {
              setOtherTime(false);
              onPlanChange({ ...plan, time, minutes: current.minutes.get(time) ?? null });
            }}
          />
          {otherTime || handPicked ? (
            <Field label="Other time" hint="Any time of the day. The doctor's shifts and bookings are checked when you save.">
              <Input
                type="time"
                step={900}
                value={plan.time ?? ""}
                onChange={(event) => onPlanChange({ ...plan, time: event.target.value || null, minutes: null })}
              />
            </Field>
          ) : (
            <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setOtherTime(true)}>
              Pick another time
            </Button>
          )}
        </>
      )}
    </div>
  );
}
