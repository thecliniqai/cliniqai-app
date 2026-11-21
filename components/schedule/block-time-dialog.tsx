"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { createScheduleBlock } from "@/features/visits/scheduling";
import type { ScheduleBlock } from "@/lib/db/types";
import { zonedDateTimeToUtcIso } from "@/lib/datetime";
import { useClinicTimeZone, useClinicToday } from "@/lib/datetime/client";

/**
 * BlockTimeDialog (V2-08 08-04b; replaces the v1 `BlockTimeModal`): blocks a doctor's time or the whole clinic for a
 * window, a day or a date range (leave, surgery, a break, a closure), through the existing `createScheduleBlock` action.
 * The dates and times are clinic wall-clock values in the clinic's zone, never the browser's. Used by the Schedule and by
 * the profile's availability card.
 */
const MODES = [
  { value: "time", label: "Time window" },
  { value: "day", label: "Full day" },
  { value: "range", label: "Date range" },
] as const;
type Mode = (typeof MODES)[number]["value"];

const REASON_PRESETS = ["Surgery", "On leave", "Personal break", "Medical conference", "Clinic maintenance"];

export interface BlockTimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (block: ScheduleBlock) => void;
  /** Fixed doctor (the profile card); otherwise the doctor select appears when there is more than one. */
  doctorId?: string;
  doctors?: { id: string; name: string }[];
  initialDate?: string;
}

function BlockTimeForm({ onDone, onSuccess, doctorId, doctors = [], initialDate }: Omit<BlockTimeDialogProps, "open" | "onOpenChange"> & { onDone: () => void }) {
  const timeZone = useClinicTimeZone();
  const clinicToday = useClinicToday();
  const day = initialDate || clinicToday;
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<Mode>("time");
  const [target, setTarget] = useState(doctorId ?? doctors[0]?.id ?? "clinic");
  const [date, setDate] = useState(day);
  const [startTime, setStartTime] = useState("14:00");
  const [endTime, setEndTime] = useState("17:00");
  const [endDate, setEndDate] = useState(day);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    let startIso: string;
    let endIso: string;
    const allDay = mode !== "time";
    if (mode === "time") {
      if (startTime >= endTime) return setError("End time must be after start time.");
      startIso = zonedDateTimeToUtcIso(date, startTime, timeZone);
      endIso = zonedDateTimeToUtcIso(date, endTime, timeZone);
    } else if (mode === "day") {
      startIso = zonedDateTimeToUtcIso(date, "00:00", timeZone);
      endIso = zonedDateTimeToUtcIso(date, "23:59:59", timeZone);
    } else {
      if (date > endDate) return setError("End date must be on or after start date.");
      startIso = zonedDateTimeToUtcIso(date, "00:00", timeZone);
      endIso = zonedDateTimeToUtcIso(endDate, "23:59:59", timeZone);
    }
    setPending(true);
    const res = await createScheduleBlock({
      doctor_id: target === "clinic" || !target ? null : target,
      start_time: startIso,
      end_time: endIso,
      reason: reason.trim() || (allDay ? "Day off" : "Blocked time"),
      all_day: allDay,
    });
    setPending(false);
    if (!res.success) return setError(res.error || "Failed to block time.");
    if (res.block) onSuccess?.(res.block);
    onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-block-time-form="">
      {error && <Alert tone="danger">{error}</Alert>}
      {!doctorId && doctors.length > 0 && (
        <Field label="Doctor or scope">
          <NativeSelect value={target} onChange={(e) => setTarget(e.target.value)}>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value="clinic">Entire clinic (all doctors)</option>
          </NativeSelect>
        </Field>
      )}
      <SegmentedControl aria-label="Block" block value={mode} onValueChange={(v) => setMode(v as Mode)} options={MODES} />
      <Field label={mode === "range" ? "From" : "Date"}>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      {mode === "range" && (
        <Field label="To">
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
        </Field>
      )}
      {mode === "time" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start time">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} step={900} required />
          </Field>
          <Field label="End time">
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} step={900} required />
          </Field>
        </div>
      )}
      <Field label="Reason" optional>
        <Input type="text" placeholder="e.g. Operation theatre, vacation, CME" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {REASON_PRESETS.map((preset) => (
          <Button key={preset} type="button" size="sm" variant="secondary" onClick={() => setReason(preset)}>
            {preset}
          </Button>
        ))}
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" requiresNetwork loading={pending}>
          Block time
        </Button>
      </DialogFooter>
    </form>
  );
}

export function BlockTimeDialog({ open, onOpenChange, ...rest }: BlockTimeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Block time</DialogTitle>
          <DialogDescription>Stops bookings during leave, breaks, surgeries or a closure.</DialogDescription>
        </DialogHeader>
        <DialogBody>{open && <BlockTimeForm onDone={() => onOpenChange(false)} {...rest} />}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}
