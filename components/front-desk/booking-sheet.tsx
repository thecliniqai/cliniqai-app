"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
} from "@/components/ui/responsive-sheet";
import { notify } from "@/components/ui/toast";
import { maskPhone } from "@/components/clinical/patient-identity-header";
import { QuickRegisterForm, type QuickRegisterValues } from "@/components/clinical/quick-register-form";
import { SaveStatus } from "@/components/clinical/save-status";
import { getPatient } from "@/features/patients/actions";
import type { PatientHit } from "@/features/patients/search";
import { quickRegisterToPatientInput } from "@/features/patients/register-input";
import { registerAndBook } from "@/features/visits/scheduling";
import { isSlotConflictReason } from "@/features/visits/slot-conflicts";
import { saveStatusProps } from "@/lib/commands/save-state";
import { appError } from "@/lib/errors/app-error";
import { useCommand } from "@/lib/commands/use-command";
import { useClinicTimeZone, useClinicToday } from "@/lib/datetime/client";
import { formatClinicDateWithWeekday, formatClinicTime } from "@/lib/datetime/format";
import { formatAgeToday } from "@/lib/ui/age";
import { PatientSearch, splitTypedQuery } from "./patient-search";
import { slotInstant } from "./slot-adapter";
import { SlotConflictDialog } from "./slot-conflict-dialog";
import { SlotSection, type SlotPlan } from "./slot-section";
import { useClinicDoctors } from "./use-doctors";
import { useDuplicateLookup } from "./use-duplicate-lookup";

/**
 * BookingSheet (V2-08 08-04b, P1-31, R-6, R-13; `?book=1&patient=&doctor=&date=&time=`): books an appointment as one command,
 * `register_and_book` (the patient when new, the slot check, the visit and the booking message commit together or not at
 * all), through `useCommand` (one `client_request_id` per submit, a 15 s timeout, one retry, SaveStatus with Retry).
 *
 * Existing patient: `PatientSearch` (a link may name the patient, then the sheet opens on the plan), the doctor (clinicians
 * only), the day strip and the free slots from the database in the clinic's time (the earliest is preselected), an optional
 * reason, Book. New patient: "Register as new patient" opens `QuickRegisterForm` under the same slot choice; its submit
 * registers and books in the one command. A slot that is taken, off duty or blocked writes nothing and opens
 * `SlotConflictDialog`; confirming sends the same booking again flagged overbooked (with the matching override), so a refused
 * slot never leaves a patient behind.
 */
type Stage = { kind: "find" } | { kind: "plan"; patient: PatientHit } | { kind: "register"; phone?: string; name?: string };

export interface BookingDefaults {
  patientId?: string;
  doctorId?: string;
  date?: string;
  time?: string;
}

type Who = { patient_id: string } | { new_patient: ReturnType<typeof quickRegisterToPatientInput> };

function BookingBody({ defaults, onDone }: { defaults: BookingDefaults; onDone: () => void }) {
  const command = useCommand();
  const timeZone = useClinicTimeZone();
  const today = useClinicToday();
  const doctors = useClinicDoctors();
  const findDuplicates = useDuplicateLookup();
  const [stage, setStage] = useState<Stage>({ kind: "find" });
  const [loadingPatient, setLoadingPatient] = useState(Boolean(defaults.patientId));
  const [patientFailed, setPatientFailed] = useState(false);
  const [plan, setPlan] = useState<SlotPlan>({
    doctorId: defaults.doctorId ?? "",
    date: defaults.date ?? today,
    time: defaults.time ?? null,
    minutes: null,
  });
  const [reason, setReason] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  const lastWho = useRef<{ who: Who; name: string } | null>(null);

  // The patient a link named (`?patient=<id>`): read once through the existing guarded action.
  useEffect(() => {
    if (!defaults.patientId) return;
    let live = true;
    getPatient(defaults.patientId)
      .then((p) => {
        if (!live) return;
        if (p) {
          setStage({
            kind: "plan",
            patient: {
              id: p.id,
              name: p.full_name,
              ageSex: { age: p.date_of_birth ? formatAgeToday(p.date_of_birth, timeZone) : p.age != null ? `${p.age} y` : null, sex: null },
              phoneLast4: p.phone ? p.phone.replace(/\D/g, "").slice(-4) : null,
              lastVisit: null,
            },
          });
        } else setPatientFailed(true);
        setLoadingPatient(false);
      })
      .catch(() => {
        if (!live) return;
        setPatientFailed(true);
        setLoadingPatient(false);
      });
    return () => {
      live = false;
    };
  }, [defaults.patientId, timeZone]);

  // The doctor: the link's, else the first; set once the list is known.
  const doctorList = useMemo(() => doctors ?? [], [doctors]);
  const doctorId = plan.doctorId || doctorList[0]?.id || "";
  const effectivePlan = { ...plan, doctorId };

  const edited = () => command.reset();
  const changePlan = (next: SlotPlan) => {
    setPlan(next);
    edited();
  };

  // Once a slot is chosen on the plan stage (a link's time, or the preselected earliest) focus moves to "Book", so Enter books
  // (find the patient, Enter, Enter besides the typing); it moves once, never while the user is picking another slot.
  const addButton = useRef<HTMLButtonElement>(null);
  const focusedBook = useRef(false);
  const planning = stage.kind === "plan";
  const hasSlot = plan.time !== null;
  useEffect(() => {
    if (!planning) focusedBook.current = false;
    else if (hasSlot && !focusedBook.current) {
      focusedBook.current = true;
      addButton.current?.focus();
    }
  }, [planning, hasSlot]);

  const lastSend = useRef<(() => Promise<unknown>) | null>(null);
  const saveStatus = {
    ...saveStatusProps(command),
    onRetry: command.saveState === "error" ? () => void lastSend.current?.() : undefined,
  };

  const send = async (
    who: Who,
    name: string,
    flags: { overbook: boolean; offDuty: boolean; block: boolean } = { overbook: false, offDuty: false, block: false },
  ) => {
    if (!doctorId || !plan.time) return;
    lastWho.current = { who, name };
    lastSend.current = () => send(who, name, flags);
    const time = plan.time;
    const result = await command.run((clientRequestId) =>
      registerAndBook(
        {
          ...who,
          doctor_id: doctorId,
          scheduled_at: slotInstant(plan.date, time, timeZone),
          ...(plan.minutes ? { estimated_duration_minutes: plan.minutes } : {}),
          reason_for_visit: reason.trim() || null,
          is_overbooked: flags.overbook,
          override_off_duty: flags.offDuty,
          override_block: flags.block,
        },
        clientRequestId,
      ),
    );
    if (result.ok) {
      notify.success(`${name} booked · ${formatClinicDateWithWeekday(plan.date)}, ${formatClinicTime(time)}`);
      onDone();
      return result;
    }
    if (isSlotConflictReason(result.error.reason)) {
      // Nothing was written: a definite refusal, so the next send is a new request (with the overbook flag).
      command.reset();
      setConflict(result.error.reason ?? "SLOT_TAKEN");
      return undefined;
    }
    return result;
  };

  const confirmConflict = () => {
    const reasonCode = conflict;
    const last = lastWho.current;
    setConflict(null);
    if (!last || !reasonCode) return;
    void send(last.who, last.name, { overbook: true, offDuty: reasonCode === "SLOT_OFF_DUTY", block: reasonCode === "SLOT_BLOCKED" });
  };

  const ready = doctors !== null && doctorId !== "" && plan.time !== null;
  const noDoctor = doctors !== null && doctors.length === 0;

  const slots = doctors !== null && doctorId !== "" && (
    <SlotSection doctors={doctorList} plan={effectivePlan} onPlanChange={changePlan} preselect={!defaults.time} />
  );
  const reasonField = (
    <Field label="Reason for visit" optional>
      <Input
        value={reason}
        maxLength={500}
        onChange={(event) => {
          setReason(event.target.value);
          edited();
        }}
        placeholder="e.g. follow-up, fever"
      />
    </Field>
  );

  if (noDoctor) {
    return <Alert tone="danger">No doctor is available to book. Add a doctor in Staff & Team, then try again.</Alert>;
  }

  return (
    <div className="flex flex-col gap-4" data-booking-sheet="">
      {loadingPatient && <p className="text-body-sm text-fg-muted">Loading patient…</p>}
      {patientFailed && <Alert tone="warning">That patient could not be opened. Search for them below.</Alert>}
      {!loadingPatient && stage.kind === "find" && (
        <PatientSearch
          actionLabel="Select"
          label="Patient"
          placeholder="Name or mobile number"
          onPick={(patient) => setStage({ kind: "plan", patient })}
          onCreate={(query) => setStage({ kind: "register", ...splitTypedQuery(query) })}
        />
      )}
      {stage.kind === "plan" && (
        <>
          <div className="rounded-md border border-border bg-surface-soft px-3 py-2.5" data-booking-patient="">
            <p className="text-body-md font-semibold text-fg">{stage.patient.name}</p>
            <p className="text-body-sm text-fg-muted">
              {[stage.patient.ageSex?.age, stage.patient.phoneLast4 ? maskPhone(stage.patient.phoneLast4) : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          {slots}
          {reasonField}
          {command.error && (
            <Alert tone="danger">
              {command.error.message}
              {command.unresolved && (
                <Button type="button" size="sm" variant="secondary" className="ml-2" onClick={() => command.startOver()}>
                  Start over
                </Button>
              )}
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                command.startOver();
                setStage({ kind: "find" });
              }}
            >
              Change patient
            </Button>
            <div className="flex items-center gap-3">
              <SaveStatus {...saveStatus} />
              <Button
                type="button"
                ref={addButton}
                requiresNetwork
                disabled={!ready}
                loading={command.pending}
                onClick={() => void send({ patient_id: stage.patient.id }, stage.patient.name)}
              >
                Book
              </Button>
            </div>
          </div>
        </>
      )}
      {stage.kind === "register" && (
        <>
          {slots}
          {reasonField}
          <QuickRegisterForm
            defaultValues={{ phone: stage.phone, name: stage.name }}
            submitLabel="Register and book"
            findDuplicates={findDuplicates}
            onUseExisting={(match) =>
              setStage({
                kind: "plan",
                patient: {
                  id: match.id,
                  name: match.name,
                  ageSex: match.age || match.sex ? { age: match.age ?? null, sex: match.sex ?? null } : null,
                  phoneLast4: match.phoneLast4 ?? null,
                  lastVisit: null,
                },
              })
            }
            onEdit={edited}
            saveStatus={saveStatus}
            onSubmit={(values: QuickRegisterValues) => {
              if (!ready) return { ok: false, error: appError("VALIDATION_FAILED", { message: "Choose a time for the appointment." }) };
              return send({ new_patient: quickRegisterToPatientInput(values) }, values.name);
            }}
          />
          <Button type="button" variant="ghost" onClick={() => setStage({ kind: "find" })} className="self-start">
            Back to search
          </Button>
        </>
      )}
      <SlotConflictDialog reason={conflict} date={plan.date} time={plan.time} verb="Book" onConfirm={confirmConflict} onCancel={() => setConflict(null)} />
    </div>
  );
}

export interface BookingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults: BookingDefaults;
}

export function BookingSheet({ open, onOpenChange, defaults }: BookingSheetProps) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent data-booking-sheet-root="" aria-describedby={undefined}>
        <ResponsiveSheetHeader title="Book appointment" />
        <ResponsiveSheetBody>
          <BookingBody defaults={defaults} onDone={() => onOpenChange(false)} />
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
