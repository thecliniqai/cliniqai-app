"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { AgeOrDobInput, type AgeOrDobValue } from "@/components/ui/age-or-dob-input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import type { Result } from "@/lib/errors/app-error";
import type { DuplicateReason } from "@/features/patients/search";
import { AiObjectionField } from "./ai-objection-field";
import { maskPhone, type PatientSex } from "./patient-identity-header";
import { SaveStatus, type SaveStatusProps } from "./save-status";

/**
 * QuickRegisterForm (V2-06 06-03b, V2-08 08-02; 06-UI-SPEC QuickRegisterForm, CD-32; DESIGN_SYSTEM §6.2 forms): the four facts
 * a walk-in needs — mobile number (PhoneInput, "+91"), full name (`kind="name"`), age or date of birth (AgeOrDobInput),
 * sex (SegmentedControl "Male / Female / Other") — the patient's AI-objection checkbox with its interim notice
 * (`AiObjectionField`, R-12) and "Register patient".
 *
 * Validation runs on blur and then on every change of a field already in error. Submitting with errors focuses the
 * first invalid field and shows a summary; the submit button is never disabled for validation (only while submitting,
 * and offline through Button's submit rule).
 *
 * Duplicates (V2-08, R-11): once a ten-digit mobile number is typed, or a name of three letters with an age or date of
 * birth, the caller's async `findDuplicates` runs after a short pause (the newest answer wins; a failed lookup shows
 * nothing, it is advisory). Candidates show in an info Alert, one row each: the reason ("Same mobile"), the name, age and
 * sex (so patients who share a family number stay distinguishable), the last four digits and the last visit, with "Use
 * this patient". Registration is never blocked: the receptionist decides.
 *
 * The form posts nothing itself: `onSubmit` is the caller's. It may return a `Result` (a command): a failed one keeps
 * everything typed and shows its message; `saveStatus` (from `useCommand`, `lib/commands/save-state.ts`) renders the
 * SaveStatus with Retry; `onEdit` tells the caller the input changed (a new submit gets a new request id).
 *
 * 06-09c (IND L-6): the age field counts as visited only when focus leaves the whole age group (not when it moves
 * from the Age/DOB toggle into the age box, nor into the calendar popover); a failing `onSubmit` (it rejects or throws)
 * shows "Couldn't register the patient. Try again." and keeps everything typed.
 */
export const REGISTER_FAILED_TEXT = "Couldn't register the patient. Try again.";
/** Pause after the last keystroke before the duplicate lookup runs. */
export const DUPLICATE_LOOKUP_DEBOUNCE_MS = 400;

export interface QuickRegisterValues {
  /** Ten digits. */
  phone: string;
  name: string;
  dob: string;
  dobApproximate: boolean;
  sex: PatientSex;
  /** The patient objects to AI-assisted processing (R-12). */
  aiObjected: boolean;
}

/** A patient that may be the same person (the minimal projection the server answers, with the formatted last visit). */
export interface DuplicateMatch {
  id: string;
  name: string;
  /** Display age, `42 y`. */
  age?: string | null;
  sex?: PatientSex | null;
  phoneLast4?: string | null;
  /** "last visit 3 Aug" */
  lastVisit?: string;
  reasons?: readonly DuplicateReason[];
}

/** What the lookup is asked: what has been typed so far (a ten-digit mobile or an empty string, a name, the date). */
export interface DuplicateQuery {
  phone: string;
  name: string;
  dob: string | null;
  dobApproximate: boolean;
}

export interface QuickRegisterFormProps {
  /** Returns a `Result` when the registration is a command; a failed one is shown, a thrown error shows the generic text. */
  onSubmit: (values: QuickRegisterValues) => Promise<Result<unknown> | void> | Result<unknown> | void;
  /** Advisory duplicate candidates for what has been typed (the caller's server lookup). */
  findDuplicates?: (query: DuplicateQuery) => Promise<readonly DuplicateMatch[]>;
  onUseExisting?: (match: DuplicateMatch) => void;
  /** Called when any field changes (a new submit is a new request). */
  onEdit?: () => void;
  /** The command's SaveStatus; replaces the plain "Registered" text. */
  saveStatus?: SaveStatusProps;
  /** Typed ahead of the form (the picker's "Register as new patient"): ten digits and/or a name. */
  defaultValues?: { phone?: string; name?: string };
  /** The submit button's text ("Register patient"; the walk-in sheet says "Register and add to queue"). */
  submitLabel?: string;
  className?: string;
}

type FieldName = "phone" | "name" | "age" | "sex";
const ORDER: FieldName[] = ["phone", "name", "age", "sex"];

const MESSAGES: Record<FieldName, string> = {
  phone: "Enter a 10-digit mobile number",
  name: "Enter the patient's full name",
  age: "Enter an age or a date of birth",
  sex: "Choose the patient's sex",
};

const REASON_LABEL: Record<DuplicateReason, string> = {
  same_mobile: "Same mobile",
  same_name_dob: "Same name and date of birth",
  same_name_age: "Same name and age",
};

function duplicateLine(match: DuplicateMatch): string {
  const reason = match.reasons?.[0] ? REASON_LABEL[match.reasons[0]] : null;
  const ageSex = [match.age, match.sex].filter(Boolean).join(" · ");
  return [reason, match.name, ageSex, match.phoneLast4 ? maskPhone(match.phoneLast4) : null, match.lastVisit]
    .filter(Boolean)
    .join(" · ");
}

export function QuickRegisterForm({
  onSubmit,
  findDuplicates,
  onUseExisting,
  onEdit,
  saveStatus,
  defaultValues,
  submitLabel = "Register patient",
  className,
}: QuickRegisterFormProps) {
  const id = useId();
  const [phone, setPhone] = useState(() => (defaultValues?.phone ?? "").replace(/\D/g, "").slice(-10));
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [age, setAge] = useState<AgeOrDobValue>({ mode: "age", dob: null, approximate: true });
  const [sex, setSex] = useState<PatientSex | "">("");
  const [aiObjected, setAiObjected] = useState(false);
  const [checked, setChecked] = useState<Set<FieldName>>(new Set());
  const [summary, setSummary] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // The newest answer and the question it answers: candidates show only while the form still holds that question.
  const [answer, setAnswer] = useState<{ key: string; matches: readonly DuplicateMatch[] }>({ key: "", matches: [] });
  const lookup = useRef(0);

  const invalid: Record<FieldName, boolean> = {
    phone: !/^\d{10}$/.test(phone),
    name: name.trim().length < 2,
    age: !age.dob,
    sex: sex === "",
  };
  const errorOf = (f: FieldName) => (checked.has(f) && invalid[f] ? MESSAGES[f] : undefined);
  const check = (f: FieldName) => setChecked((c) => (c.has(f) ? c : new Set(c).add(f)));
  const edited = () => {
    setDone(false);
    onEdit?.();
  };

  // The advisory duplicate lookup: after a pause, the newest question only; a failure shows nothing.
  const fullPhone = /^\d{10}$/.test(phone) ? phone : "";
  const trimmedName = name.trim().replace(/\s+/g, " ");
  const dob = age.dob;
  const approximate = age.approximate;
  const askable = fullPhone !== "" || (trimmedName.length >= 3 && Boolean(dob));
  const question = askable ? [fullPhone, trimmedName, dob ?? "", approximate].join("|") : "";
  const duplicates = question !== "" && answer.key === question ? answer.matches : [];
  useEffect(() => {
    const n = ++lookup.current;
    if (!findDuplicates || question === "") return;
    const timer = setTimeout(async () => {
      let matches: readonly DuplicateMatch[] = [];
      try {
        matches = await findDuplicates({ phone: fullPhone, name: trimmedName, dob: dob ?? null, dobApproximate: approximate });
      } catch {
        // Advisory: a failed lookup shows nothing.
      }
      if (n === lookup.current) setAnswer({ key: question, matches });
    }, DUPLICATE_LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [findDuplicates, question, fullPhone, trimmedName, dob, approximate]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecked(new Set(ORDER));
    const bad = ORDER.filter((f) => invalid[f]);
    if (bad.length > 0) {
      setSummary(`Fix ${bad.length === 1 ? "1 field" : `${bad.length} fields`} before registering`);
      const target = event.currentTarget.querySelector<HTMLElement>(`[data-register-field="${bad[0]}"] input, [data-register-field="${bad[0]}"] [role=radio]`);
      target?.focus();
      return;
    }
    setSummary(null);
    setFailure(null);
    setSubmitting(true);
    try {
      const outcome = await onSubmit({
        phone,
        name: trimmedName,
        dob: age.dob!,
        dobApproximate: age.approximate,
        sex: sex as PatientSex,
        aiObjected,
      });
      if (outcome && typeof outcome === "object" && "ok" in outcome && !outcome.ok) {
        // A failed command keeps what was typed; its fixed message says why.
        setFailure(outcome.error.message || REGISTER_FAILED_TEXT);
        return;
      }
      setDone(true);
    } catch {
      // The caller reports its own failure (a server action returns its error); here the user is told, nothing is lost.
      setFailure(REGISTER_FAILED_TEXT);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} aria-labelledby={`${id}-title`} className={cn("flex flex-col gap-4", className)} data-quick-register="">
      <h4 id={`${id}-title`} className="font-display text-title-2 text-fg">
        New patient
      </h4>
      {summary && <Alert tone="danger">{summary}</Alert>}
      {failure && <Alert tone="danger">{failure}</Alert>}
      <div data-register-field="phone" className="flex flex-col gap-2">
        <Field label="Mobile number" error={errorOf("phone")}>
          <PhoneInput
            value={phone}
            onChange={(digits) => {
              setPhone(digits);
              edited();
            }}
            onBlur={() => check("phone")}
          />
        </Field>
      </div>
      <div data-register-field="name">
        <Field label="Full name" error={errorOf("name")}>
          <Input
            kind="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              edited();
            }}
            onBlur={() => check("name")}
          />
        </Field>
      </div>
      {duplicates.length > 0 && (
        <Alert tone="info" title={duplicates.length === 1 ? "This patient may already be registered" : "These patients may already be registered"}>
          <ul className="mt-1 flex flex-col gap-2" data-duplicate-matches="">
            {duplicates.map((match) => (
              <li key={match.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{duplicateLine(match)}</span>
                {onUseExisting && (
                  <Button type="button" size="sm" variant="secondary" aria-label={`Use this patient: ${match.name}`} onClick={() => onUseExisting(match)}>
                    Use this patient
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <div
        data-register-field="age"
        onBlur={(event) => {
          // Only when focus leaves the age group (its toggle, box, unit and the date picker's popover stay inside).
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          if (next instanceof Element && next.closest("[data-radix-popper-content-wrapper]")) return;
          check("age");
        }}
      >
        <AgeOrDobInput
          value={age}
          onValueChange={(next) => {
            setAge(next);
            edited();
          }}
          error={errorOf("age")}
        />
      </div>
      <div data-register-field="sex" role="group" aria-labelledby={`${id}-sex`} className="grid gap-1.5">
        <span id={`${id}-sex`} className="text-label font-medium text-fg-secondary">
          Sex
        </span>
        <SegmentedControl
          aria-label="Sex"
          aria-describedby={errorOf("sex") ? `${id}-sex-error` : undefined}
          value={sex}
          onValueChange={(v) => {
            setSex(v as PatientSex);
            check("sex");
            edited();
          }}
          options={[
            { value: "M", label: "Male" },
            { value: "F", label: "Female" },
            { value: "O", label: "Other" },
          ]}
        />
        {errorOf("sex") && (
          <p id={`${id}-sex-error`} className="text-label text-danger-fg">
            {errorOf("sex")}
          </p>
        )}
      </div>
      <AiObjectionField
        checked={aiObjected}
        onCheckedChange={(next) => {
          setAiObjected(next);
          edited();
        }}
      />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {saveStatus ? (
          <SaveStatus {...saveStatus} />
        ) : (
          <p role="status" className="text-label text-fg-muted">
            {done ? "Registered" : ""}
          </p>
        )}
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
