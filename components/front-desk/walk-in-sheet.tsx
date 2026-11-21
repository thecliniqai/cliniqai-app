"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
} from "@/components/ui/responsive-sheet";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { notify } from "@/components/ui/toast";
import { QuickRegisterForm, type QuickRegisterValues } from "@/components/clinical/quick-register-form";
import { SaveStatus } from "@/components/clinical/save-status";
import { maskPhone } from "@/components/clinical/patient-identity-header";
import { enqueueWalkIn } from "@/features/queue/actions";
import { getActiveClinicDoctors } from "@/features/visits/actions";
import { quickRegisterToPatientInput } from "@/features/patients/register-input";
import type { PatientHit } from "@/features/patients/search";
import { saveStatusProps } from "@/lib/commands/save-state";
import { useCommand } from "@/lib/commands/use-command";
import { PatientSearch, splitTypedQuery } from "./patient-search";
import { useDuplicateLookup } from "./use-duplicate-lookup";

/**
 * WalkInSheet (V2-08 08-03b, P1-29, R-6, R-13): a walk-in is one command, `enqueue_walk_in` (the patient when new, the visit
 * and its token commit together or not at all), through `useCommand` (one `client_request_id` per submit, a 15 s timeout, one
 * retry, SaveStatus with Retry, "Start over" after an unknown outcome).
 *
 * Existing patient: type a name or mobile number, Enter picks the highlighted patient, Enter on the focused "Add to queue"
 * adds them (W, Enter, Enter besides the typing). New patient: "Register as new patient" opens `QuickRegisterForm` inline with
 * what was typed; its submit registers the patient and queues the visit in the same command. The doctor select shows only
 * when the clinic has more than one doctor (the last one used is preselected); priority is Normal, Urgent or VIP.
 */
const PRIORITIES = [
  { value: "normal", label: "Normal" },
  { value: "urgent", label: "Urgent" },
  { value: "vip", label: "VIP" },
] as const;
type Priority = (typeof PRIORITIES)[number]["value"];

interface DoctorChoice {
  /** The doctor's user id (what a visit stores). */
  id: string;
  label: string;
}

/** The doctor picked last in this browser session (not stored: a preference key may not hold an identifier, D-3). */
let lastDoctorId: string | null = null;
const rememberDoctor = (id: string) => {
  lastDoctorId = id;
};
const recalledDoctor = () => lastDoctorId;

const doctorLabel = (name: string, specialty: string | null) => {
  const named = /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`;
  return specialty ? `${named} (${specialty.replace(/_/g, " ")})` : named;
};

type Stage = { kind: "find" } | { kind: "confirm"; patient: PatientHit } | { kind: "register"; phone?: string; name?: string };

function WalkInBody({ onDone }: { onDone: () => void }) {
  const command = useCommand();
  const findDuplicates = useDuplicateLookup();
  const [stage, setStage] = useState<Stage>({ kind: "find" });
  const [doctors, setDoctors] = useState<DoctorChoice[] | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getActiveClinicDoctors()
      .then((list) => {
        if (!live) return;
        const choices = list.map((d) => ({ id: d.user_id, label: doctorLabel(d.full_name, d.specialty ?? null) }));
        setDoctors(choices);
        setDoctorId(choices.find((c) => c.id === recalledDoctor())?.id ?? choices[0]?.id ?? "");
        setLoadFailed(choices.length === 0);
      })
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const edited = () => command.reset();

  // Picking a patient moves focus to "Add to queue", so Enter adds them (W, Enter, Enter).
  const addButton = useRef<HTMLButtonElement>(null);
  const confirming = stage.kind === "confirm";
  useEffect(() => {
    if (confirming) addButton.current?.focus();
  }, [confirming]);

  // "Retry" on the SaveStatus runs the same send again (same request id), so a retry that succeeds also queues the success
  // text and closes the sheet; `command.retry()` alone would re-run the call and leave the sheet open.
  const lastSend = useRef<(() => Promise<unknown>) | null>(null);
  const saveStatus = {
    ...saveStatusProps(command),
    onRetry: command.saveState === "error" ? () => void lastSend.current?.() : undefined,
  };

  const send = async (who: { patient_id: string } | { new_patient: ReturnType<typeof quickRegisterToPatientInput> }, name: string) => {
    lastSend.current = () => send(who, name);
    const result = await command.run((clientRequestId) =>
      enqueueWalkIn({ ...who, doctor_id: doctorId, priority, reason_for_visit: "Walk-in consultation" }, clientRequestId),
    );
    if (result.ok) {
      rememberDoctor(doctorId);
      notify.success(`${name} added to the queue · token ${result.value.tokenNumber}`);
      onDone();
    }
    return result;
  };

  const ready = doctors !== null && doctorId !== "";
  const visitFields = doctors && (
    <div className="flex flex-col gap-3" data-walkin-visit-fields="">
      {doctors.length > 1 && (
        <Field label="Doctor">
          <NativeSelect
            value={doctorId}
            onChange={(event) => {
              setDoctorId(event.target.value);
              edited();
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
        <span className="text-label font-medium text-fg-secondary">
          Priority
        </span>
        <SegmentedControl
          aria-label="Priority"
          value={priority}
          onValueChange={(value) => {
            setPriority(value as Priority);
            edited();
          }}
          options={PRIORITIES}
        />
      </div>
    </div>
  );

  if (loadFailed) {
    return <Alert tone="danger">No doctor is available to see a walk-in. Add a doctor in Staff & Team, then try again.</Alert>;
  }

  return (
    <div className="flex flex-col gap-4" data-walkin-sheet="">
      {!ready && <p className="text-body-sm text-fg-muted">Loading doctors…</p>}
      {stage.kind === "find" && (
        <PatientSearch
          actionLabel="Add to queue"
          label="Patient"
          placeholder="Name or mobile number"
          onPick={(patient) => setStage({ kind: "confirm", patient })}
          onCreate={(query) => setStage({ kind: "register", ...splitTypedQuery(query) })}
        />
      )}
      {stage.kind === "confirm" && (
        <>
          <div className="rounded-md border border-border bg-surface-soft px-3 py-2.5" data-walkin-patient="">
            <p className="text-body-md font-semibold text-fg">{stage.patient.name}</p>
            <p className="text-body-sm text-fg-muted">
              {[
                [stage.patient.ageSex?.age, stage.patient.ageSex?.sex].filter(Boolean).join(" · "),
                stage.patient.phoneLast4 ? maskPhone(stage.patient.phoneLast4) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {visitFields}
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
                Add to queue
              </Button>
            </div>
          </div>
        </>
      )}
      {stage.kind === "register" && (
        <>
          {visitFields}
          <QuickRegisterForm
            defaultValues={{ phone: stage.phone, name: stage.name }}
            submitLabel="Register and add to queue"
            findDuplicates={findDuplicates}
            onUseExisting={(match) =>
              setStage({
                kind: "confirm",
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
              if (!ready) return;
              return send({ new_patient: quickRegisterToPatientInput(values) }, values.name);
            }}
          />
          <Button type="button" variant="ghost" onClick={() => setStage({ kind: "find" })} className="self-start">
            Back to search
          </Button>
        </>
      )}
    </div>
  );
}

export interface WalkInSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WalkInSheet({ open, onOpenChange }: WalkInSheetProps) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent data-walkin-sheet-root="" aria-describedby={undefined}>
        <ResponsiveSheetHeader title="Add walk-in" />
        <ResponsiveSheetBody>
          <WalkInBody onDone={() => onOpenChange(false)} />
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
