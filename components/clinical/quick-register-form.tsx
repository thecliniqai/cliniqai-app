"use client";

import React, { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { AgeOrDobInput, type AgeOrDobValue } from "@/components/ui/age-or-dob-input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import type { PatientSex } from "./patient-identity-header";

/**
 * QuickRegisterForm (V2-06 06-03b; 06-UI-SPEC QuickRegisterForm, CD-32; DESIGN_SYSTEM §6.2 forms): the four facts a
 * walk-in needs — mobile number (PhoneInput, "+91"), full name (`kind="name"`), age or date of birth (AgeOrDobInput),
 * sex (SegmentedControl "Male / Female / Other") — and "Register patient".
 *
 * Validation runs on blur and then on every change of a field already in error. Submitting with errors focuses the
 * first invalid field and shows a summary; the submit button is never disabled for validation (only while submitting,
 * and offline through Button's submit rule). A ten-digit number that matches a patient shows an info Alert ("Same
 * mobile · last visit 3 Aug") with "Use this patient". The form posts nothing itself: `onSubmit` is the caller's (the
 * gallery's is a no-op; V2-08 wires the existing registration action).
 *
 * 06-09c (IND L-6): the age field counts as visited only when focus leaves the whole age group (not when it moves
 * from the Age/DOB toggle into the age box, nor into the calendar popover); a failing `onSubmit` (it rejects or throws)
 * shows "Couldn't register the patient. Try again." and keeps everything typed.
 */
export const REGISTER_FAILED_TEXT = "Couldn't register the patient. Try again.";
export interface QuickRegisterValues {
  /** Ten digits. */
  phone: string;
  name: string;
  dob: string;
  dobApproximate: boolean;
  sex: PatientSex;
}

export interface DuplicateMatch {
  id: string;
  name: string;
  /** "last visit 3 Aug" */
  lastVisit?: string;
}

export interface QuickRegisterFormProps {
  onSubmit: (values: QuickRegisterValues) => Promise<void> | void;
  /** Looks up a patient with this ten-digit number (the caller's search). */
  findDuplicate?: (phone: string) => DuplicateMatch | null;
  onUseExisting?: (match: DuplicateMatch) => void;
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

export function QuickRegisterForm({ onSubmit, findDuplicate, onUseExisting, className }: QuickRegisterFormProps) {
  const id = useId();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [age, setAge] = useState<AgeOrDobValue>({ mode: "age", dob: null, approximate: true });
  const [sex, setSex] = useState<PatientSex | "">("");
  const [checked, setChecked] = useState<Set<FieldName>>(new Set());
  const [summary, setSummary] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  const invalid: Record<FieldName, boolean> = {
    phone: !/^\d{10}$/.test(phone),
    name: name.trim().length < 2,
    age: !age.dob,
    sex: sex === "",
  };
  const errorOf = (f: FieldName) => (checked.has(f) && invalid[f] ? MESSAGES[f] : undefined);
  const check = (f: FieldName) => setChecked((c) => (c.has(f) ? c : new Set(c).add(f)));
  const duplicate = phone.length === 10 && findDuplicate ? findDuplicate(phone) : null;

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
    setFailed(false);
    setSubmitting(true);
    try {
      await onSubmit({ phone, name: name.trim().replace(/\s+/g, " "), dob: age.dob!, dobApproximate: age.approximate, sex: sex as PatientSex });
      setDone(true);
    } catch {
      // The caller reports its own failure (a server action returns its error); here the user is told, nothing is lost.
      setFailed(true);
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
      {failed && <Alert tone="danger">{REGISTER_FAILED_TEXT}</Alert>}
      <div data-register-field="phone" className="flex flex-col gap-2">
        <Field label="Mobile number" error={errorOf("phone")}>
          <PhoneInput
            value={phone}
            onChange={(digits) => {
              setPhone(digits);
              setDone(false);
            }}
            onBlur={() => check("phone")}
          />
        </Field>
        {duplicate && (
          <Alert
            tone="info"
            action={
              onUseExisting && (
                <Button size="sm" variant="secondary" onClick={() => onUseExisting(duplicate)}>
                  Use this patient
                </Button>
              )
            }
          >
            {["Same mobile", duplicate.name, duplicate.lastVisit].filter(Boolean).join(" · ")}
          </Alert>
        )}
      </div>
      <div data-register-field="name">
        <Field label="Full name" error={errorOf("name")}>
          <Input
            kind="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDone(false);
            }}
            onBlur={() => check("name")}
          />
        </Field>
      </div>
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
        <AgeOrDobInput value={age} onValueChange={setAge} error={errorOf("age")} />
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
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p role="status" className="text-label text-fg-muted">
          {done ? "Registered" : ""}
        </p>
        <Button type="submit" loading={submitting}>
          Register patient
        </Button>
      </div>
    </form>
  );
}
