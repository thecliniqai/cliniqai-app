"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DayStrip } from "@/components/ui/day-strip";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SlotPicker, type Slot } from "@/components/ui/slot-picker";
import { getAvailableSlots } from "@/features/visits/scheduling";
import { useClinicTimeZone, useClinicToday } from "@/lib/datetime/client";
import type { DoctorChoice } from "./use-doctors";
import { earliestSlot, slotLengths, toPickerSlots } from "./slot-adapter";

/**
 * SlotSection (V2-08 08-04b, R-15, R-16): the doctor, the day and the time of a booking, a move or a waitlist promotion,
 * one component for all three. The free slots come from the database (`getAvailableSlots` -> `available_slots`, the list
 * the commands check again) and are shown in the clinic's wall-clock time through the slot adapter. In booking the earliest
 * free slot is preselected (`preselect`); in a move nothing is preselected. "Pick another time" takes any quarter hour: the
 * command refuses it when the doctor is off duty, blocked or booked, and the caller then asks for the overbooking or the
 * override (`SlotConflictDialog`).
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
}

interface Loaded {
  key: string;
  slots: Slot[] | null;
  minutes: Map<string, number>;
  error: string | null;
}

export function SlotSection({ doctors, plan, onPlanChange, excludeVisitId, preselect = false, days = 21 }: SlotSectionProps) {
  const timeZone = useClinicTimeZone();
  const today = useClinicToday();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [otherTime, setOtherTime] = useState(false);
  const key = `${plan.doctorId}|${plan.date}|${excludeVisitId ?? ""}|${attempt}`;
  const latest = useRef({ plan, onPlanChange, preselect });
  useEffect(() => {
    latest.current = { plan, onPlanChange, preselect };
  });

  useEffect(() => {
    if (!plan.doctorId) return;
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
        const now = latest.current;
        if (now.preselect && now.plan.time === null) {
          const first = earliestSlot(slots);
          if (first) now.onPlanChange({ ...now.plan, time: first, minutes: minutes.get(first) ?? null });
        }
      })
      .catch(() => live && setLoaded({ key, slots: null, minutes: new Map(), error: "Couldn't load the free slots." }));
    return () => {
      live = false;
    };
    // `key` carries doctor, date, excluded visit and the retry counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, timeZone]);

  const current = loaded?.key === key ? loaded : null;
  const slots = current?.slots ?? [];
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
