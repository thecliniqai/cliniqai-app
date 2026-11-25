"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
} from "@/components/ui/responsive-sheet";
import { notify } from "@/components/ui/toast";
import { SaveStatus } from "@/components/clinical/save-status";
import { PatientSearch, registerHref } from "@/components/front-desk/patient-search";
import { SlotConflictDialog } from "@/components/front-desk/slot-conflict-dialog";
import { SlotSection, type SlotPlan } from "@/components/front-desk/slot-section";
import { slotInstant } from "@/components/front-desk/slot-adapter";
import { useClinicDoctors, type DoctorChoice } from "@/components/front-desk/use-doctors";
import type { PatientHit } from "@/features/patients/search";
import type { ScheduleData, WaitlistView } from "@/features/schedule/schema";
import { isSlotConflictReason } from "@/features/visits/slot-conflicts";
import { addToWaitlist, promoteWaitlistEntry } from "@/features/waitlist/actions";
import { saveStatusProps } from "@/lib/commands/save-state";
import { useConfirmedCall } from "@/lib/query/mutations";
import { useAfterSave } from "@/lib/query/after-save";
import { useClinicTimeZone } from "@/lib/datetime/client";
import { formatClinicDateWithWeekday, formatClinicTime } from "@/lib/datetime/format";

/**
 * WaitlistSheet (V2-08 08-04b, D-08, R-15; the v1 waitlist drawer): the day's waitlist, "Add to waitlist" and "Book a slot" for an
 * entry. Adding is one command (`add_to_waitlist`) for a patient found with `PatientSearch` (a new patient is registered first
 * from the Patients register link: a waitlist entry needs a patient). Promoting is one command (`promote_waitlist_entry`): the
 * same slot choice as booking, the slot is checked like a booking, and a refused slot opens `SlotConflictDialog` before the
 * entry is booked flagged overbooked. A cancelled appointment promotes the next waiting entry by itself (`cancel_visit`).
 */
const PRIORITIES = [
  { value: "0", label: "Normal" },
  { value: "1", label: "High" },
  { value: "2", label: "Urgent" },
] as const;

function AddForm({ data, doctors, onDone }: { data: ScheduleData; doctors: readonly DoctorChoice[]; onDone: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { command, run } = useConfirmedCall();
  const [patient, setPatient] = useState<PatientHit | null>(null);
  const [doctorId, setDoctorId] = useState("any");
  const [priority, setPriority] = useState("0");
  const [timeWindow, setTimeWindow] = useState("");
  const lastSend = useRef<(() => Promise<unknown>) | null>(null);
  const saveStatus = { ...saveStatusProps(command), onRetry: command.saveState === "error" ? () => void lastSend.current?.() : undefined };

  const send = async () => {
    if (!patient) return;
    lastSend.current = send;
    const result = await run((id) =>
      addToWaitlist(
        {
          patient_id: patient.id,
          doctor_id: doctorId === "any" ? null : doctorId,
          target_date: data.date,
          time_window: timeWindow.trim() || null,
          priority: Number(priority),
          notes: null,
        },
        id,
      ),
    );
    if (!result.ok) return;
    notify.success(`${patient.name} added to the waitlist for ${formatClinicDateWithWeekday(data.date)}.`);
    onDone();
  };

  return (
    <section aria-label="Add to waitlist" className="flex flex-col gap-3 border-t border-border pt-3" data-waitlist-add="">
      <h3 className="font-display text-title-3 text-fg">Add to waitlist</h3>
      {patient ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-soft px-3 py-2.5">
          <p className="text-body-md font-semibold text-fg">{patient.name}</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setPatient(null); command.reset(); }}>
            Change
          </Button>
        </div>
      ) : (
        <PatientSearch
          actionLabel="Select"
          label="Patient"
          placeholder="Name or mobile number"
          onPick={(hit) => setPatient(hit)}
          onCreate={(query) => {
            // A waitlist entry needs a registered patient: the register sheet opens with what was typed.
            onDone();
            router.push(registerHref(query, pathname));
          }}
        />
      )}
      <Field label="Doctor">
        <NativeSelect value={doctorId} onChange={(event) => { setDoctorId(event.target.value); command.reset(); }}>
          <option value="any">Any doctor</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority">
          <NativeSelect value={priority} onChange={(event) => { setPriority(event.target.value); command.reset(); }}>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Preferred time" optional>
          <Input value={timeWindow} maxLength={100} onChange={(event) => { setTimeWindow(event.target.value); command.reset(); }} placeholder="e.g. morning" />
        </Field>
      </div>
      {command.error && <Alert tone="danger">{command.error.message}</Alert>}
      <div className="flex items-center justify-end gap-3">
        <SaveStatus {...saveStatus} />
        <Button type="button" requiresNetwork disabled={!patient} loading={command.pending} onClick={() => void send()}>
          Add to waitlist
        </Button>
      </div>
    </section>
  );
}

function PromoteForm({ entry, data, doctors, onDone }: { entry: WaitlistView; data: ScheduleData; doctors: readonly DoctorChoice[]; onDone: () => void }) {
  const { command, run } = useConfirmedCall();
  const afterSave = useAfterSave();
  const timeZone = useClinicTimeZone();
  const [plan, setPlan] = useState<SlotPlan>({
    doctorId: entry.doctorId ?? data.doctors[0]?.id ?? "",
    date: data.date < data.today ? data.today : data.date,
    time: null,
    minutes: null,
  });
  const [conflict, setConflict] = useState<string | null>(null);
  const lastSend = useRef<(() => Promise<unknown>) | null>(null);
  const saveStatus = { ...saveStatusProps(command), onRetry: command.saveState === "error" ? () => void lastSend.current?.() : undefined };

  const send = async (overbook = false) => {
    if (!plan.time) return;
    lastSend.current = () => send(overbook);
    const time = plan.time;
    const result = await run((id) =>
      promoteWaitlistEntry(
        {
          entry_id: entry.id,
          scheduled_at: slotInstant(plan.date, time, timeZone),
          doctor_id: plan.doctorId,
          ...(plan.minutes ? { estimated_duration_minutes: plan.minutes } : {}),
          is_overbooked: overbook,
        },
        id,
      ),
    );
    if (result.ok) {
      afterSave.refreshScreens({ closing: true });
      notify.success(`${entry.patientName} booked · ${formatClinicDateWithWeekday(plan.date)}, ${formatClinicTime(time)}`);
      onDone();
      return;
    }
    if (isSlotConflictReason(result.error.reason)) {
      command.reset();
      setConflict(result.error.reason ?? "SLOT_TAKEN");
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-soft p-3" data-waitlist-promote={entry.id}>
      <SlotSection doctors={doctors} plan={plan} onPlanChange={(next) => { setPlan(next); command.reset(); }} preselect />
      {command.error && <Alert tone="danger">{command.error.message}</Alert>}
      <div className="flex items-center justify-end gap-3">
        <SaveStatus {...saveStatus} />
        <Button type="button" requiresNetwork disabled={plan.time === null} loading={command.pending} onClick={() => void send()}>
          Book this slot
        </Button>
      </div>
      <SlotConflictDialog
        reason={conflict}
        date={plan.date}
        time={plan.time}
        verb="Book"
        onConfirm={() => {
          setConflict(null);
          void send(true);
        }}
        onCancel={() => setConflict(null)}
      />
    </div>
  );
}

function WaitlistBody({ data, onDone }: { data: ScheduleData; onDone: () => void }) {
  const doctors = useClinicDoctors();
  const [promoting, setPromoting] = useState<string | null>(null);
  if (doctors === null) return <p className="text-body-sm text-fg-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-4" data-waitlist-sheet="">
      <section aria-label="Waiting" className="flex flex-col gap-2">
        <p className="text-label text-fg-muted">For {formatClinicDateWithWeekday(data.date)}</p>
        {data.waitlist.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Nobody is on the waitlist for this day.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.waitlist.map((entry) => (
              <li key={entry.id} data-waitlist-entry={entry.id} className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-body-md font-medium text-fg">{entry.patientName}</p>
                    <p className="text-label text-fg-muted">
                      {[entry.doctorName ?? "Any doctor", entry.timeWindow, entry.priority > 0 ? `Priority ${entry.priority}` : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {data.canEdit && (
                    <Button type="button" size="sm" variant="secondary" aria-expanded={promoting === entry.id} onClick={() => setPromoting(promoting === entry.id ? null : entry.id)}>
                      Book a slot
                    </Button>
                  )}
                </div>
                {promoting === entry.id && <PromoteForm entry={entry} data={data} doctors={doctors} onDone={onDone} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      {data.canEdit && <AddForm data={data} doctors={doctors} onDone={onDone} />}
    </div>
  );
}

export function WaitlistSheet({ open, onOpenChange, data }: { open: boolean; onOpenChange: (open: boolean) => void; data: ScheduleData }) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent data-waitlist-sheet-root="" aria-describedby={undefined}>
        <ResponsiveSheetHeader title="Waitlist" />
        <ResponsiveSheetBody>{open && <WaitlistBody data={data} onDone={() => onOpenChange(false)} />}</ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
