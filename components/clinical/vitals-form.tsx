"use client";

import React, { useId, useState } from "react";
import { CircleAlert, OctagonAlert, TriangleAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import {
  VITAL_SPECS,
  assessVital,
  bmi,
  bmiBand,
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  flagWord,
  isCritical,
  parseVital,
  roundTo,
  type VitalAssessment,
  type VitalKind,
  type VitalsReading,
} from "@/lib/clinical/vitals";

/**
 * VitalsForm (V2-06 06-03b; 06-UI-SPEC VitalsForm; DESIGN_SYSTEM §7.3): blood pressure (two inputs, "/", mmHg), pulse,
 * temperature (°F default, °C switch), SpO₂, resp. rate, weight + height with the derived BMI, blood sugar with
 * Random / Fasting / PP; the last recorded line under the title.
 *
 * Inputs are numeric or decimal kinds (numeric keypad on phones, 16 px, 44 px on touch; 36 px on a fine pointer).
 * Enter moves to the next field and submits from the last. Labels sit above the input below 768 px and in a 120 px
 * column from 768 px. Checks run on blur and then on every change: a value outside the usual range is flagged in text
 * and icon ("High", "Low"; critical values in danger, e.g. SpO₂ under 90) and never blocks saving; an implausible
 * value (BP 1500) is a field error, and only those stop the save: the first one gets focus and a summary says how many.
 * The footer with "Save vitals" stays in view (sticky); the button is disabled offline (Button's submit rule).
 */
export interface VitalsFormProps {
  /** "Last recorded 12 Oct: BP 142/90 · Wt 79 kg" — formatted by the caller from the last visit. */
  lastRecorded?: string;
  /** Resolve `false` when the save failed (the caller says why): the form then does not show "Saved". */
  onSave: (reading: VitalsReading) => Promise<void | boolean> | void | boolean;
  className?: string;
}

type Field =
  | "systolic"
  | "diastolic"
  | "pulse"
  | "temperature"
  | "spo2"
  | "respRate"
  | "weight"
  | "height"
  | "sugar";

const ORDER: Field[] = ["systolic", "diastolic", "pulse", "temperature", "spo2", "respRate", "weight", "height", "sugar"];

type TempUnit = "F" | "C";
type SugarType = "random" | "fasting" | "pp";
const SUGAR_KIND: Record<SugarType, VitalKind> = { random: "sugarRandom", fasting: "sugarFasting", pp: "sugarPP" };

/** Plausible °C range shown in the error when the unit is °C (from the °F limits). */
const C_MIN = fahrenheitToCelsius(VITAL_SPECS.temperatureF.min);
const C_MAX = fahrenheitToCelsius(VITAL_SPECS.temperatureF.max);

interface FieldInputProps {
  "data-vital": Field;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  enterKeyHint: "done" | "next";
  invalid: boolean;
}

function assess(field: Field, text: string, unit: TempUnit, sugar: SugarType): VitalAssessment {
  if (field === "temperature") {
    if (unit === "F") return assessVital("temperatureF", text);
    const c = parseVital(text);
    if (c === null) return { state: "empty" };
    if (Number.isNaN(c)) return { state: "invalid", message: "Enter temperature as a number" };
    const a = assessVital("temperatureF", String(celsiusToFahrenheit(c)));
    return a.state === "implausible" ? { state: "implausible", message: `Enter a value between ${C_MIN} and ${C_MAX}` } : a;
  }
  if (field === "sugar") return assessVital(SUGAR_KIND[sugar], text);
  return assessVital(field, text);
}

export function VitalsForm({ lastRecorded, onSave, className }: VitalsFormProps) {
  const [values, setValues] = useState<Record<Field, string>>({
    systolic: "",
    diastolic: "",
    pulse: "",
    temperature: "",
    spo2: "",
    respRate: "",
    weight: "",
    height: "",
    sugar: "",
  });
  const [checked, setChecked] = useState<Set<Field>>(new Set());
  const [unit, setUnit] = useState<TempUnit>("F");
  const [sugarType, setSugarType] = useState<SugarType>("random");
  const [summary, setSummary] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const id = useId();

  const result = Object.fromEntries(ORDER.map((f) => [f, assess(f, values[f], unit, sugarType)])) as Record<Field, VitalAssessment>;
  // Diastolic at or above systolic cannot be a reading.
  if (result.systolic.state === "ok" && result.diastolic.state === "ok" && result.diastolic.value >= result.systolic.value) {
    result.diastolic = { state: "implausible", message: "Diastolic must be lower than systolic" };
  }
  const errorOf = (f: Field) => {
    const r = result[f];
    return checked.has(f) && (r.state === "invalid" || r.state === "implausible") ? r.message : null;
  };

  const weight = result.weight.state === "ok" ? result.weight.value : null;
  const height = result.height.state === "ok" ? result.height.value : null;
  const bmiValue = bmi(weight, height);

  function set(field: Field, text: string) {
    setValues((v) => ({ ...v, [field]: text }));
    setSaved(false);
  }

  function check(field: Field) {
    setChecked((c) => (c.has(field) ? c : new Set(c).add(field)));
  }

  function inputProps(field: Field): FieldInputProps {
    const i = ORDER.indexOf(field);
    return {
      "data-vital": field,
      value: values[field],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(field, e.target.value),
      onBlur: () => check(field),
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
        e.preventDefault();
        check(field);
        const next = ORDER[i + 1];
        const form = e.currentTarget.form;
        if (next) form?.querySelector<HTMLInputElement>(`[data-vital="${next}"]`)?.focus();
        else form?.requestSubmit();
      },
      enterKeyHint: i === ORDER.length - 1 ? "done" : "next",
      invalid: errorOf(field) !== null,
    };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecked(new Set(ORDER));
    const bad = ORDER.filter((f) => result[f].state === "invalid" || result[f].state === "implausible");
    if (bad.length > 0) {
      setSummary(`Fix ${bad.length === 1 ? "1 value" : `${bad.length} values`} before saving`);
      event.currentTarget.querySelector<HTMLInputElement>(`[data-vital="${bad[0]}"]`)?.focus();
      return;
    }
    setSummary(null);
    const num = (f: Field) => {
      const r = result[f];
      return r.state === "ok" ? r.value : null;
    };
    const t = num("temperature");
    const reading: VitalsReading = {
      systolic: num("systolic"),
      diastolic: num("diastolic"),
      pulse: num("pulse"),
      temperatureF: t === null ? null : unit === "F" ? t : roundTo(celsiusToFahrenheit(t), 1),
      spo2: num("spo2"),
      respRate: num("respRate"),
      weight: num("weight"),
      height: num("height"),
      sugar: num("sugar"),
      sugarType: num("sugar") === null ? null : sugarType,
    };
    setSaving(true);
    try {
      const outcome = await onSave(reading);
      setSaved(outcome !== false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} aria-labelledby={`${id}-title`} className={cn("flex flex-col", className)} data-vitals-form="">
      <div className="flex flex-col gap-0.5 pb-3">
        <h4 id={`${id}-title`} className="font-display text-title-2 text-fg">
          Vitals
        </h4>
        {lastRecorded && <p className="text-label text-fg-muted tabular-nums">{lastRecorded}</p>}
      </div>
      {summary && (
        <Alert tone="danger" className="mb-3">
          {summary}
        </Alert>
      )}
      <div className="flex flex-col divide-y divide-border">
        <Row label="Blood pressure" labelId={`${id}-bp`} group>
          <div className="flex items-center gap-1.5">
            <Input kind="numeric" aria-label="Systolic" aria-describedby={`${id}-bp-msg`} wrapperClassName="w-30" className="tabular-nums" endAdornment="mmHg" {...inputProps("systolic")} />
            <span aria-hidden="true" className="text-body-md text-fg-muted">
              /
            </span>
            <Input kind="numeric" aria-label="Diastolic" aria-describedby={`${id}-bp-msg`} wrapperClassName="w-30" className="tabular-nums" endAdornment="mmHg" {...inputProps("diastolic")} />
          </div>
          <Messages id={`${id}-bp-msg`} items={[["Systolic", result.systolic, errorOf("systolic"), checked.has("systolic")], ["Diastolic", result.diastolic, errorOf("diastolic"), checked.has("diastolic")]]} />
        </Row>
        <SingleRow id={id} field="pulse" label="Pulse" unit="bpm" kind="numeric" result={result.pulse} error={errorOf("pulse")} shown={checked.has("pulse")} inputProps={inputProps("pulse")} />
        <SingleRow
          id={id}
          field="temperature"
          label="Temperature"
          unit={unit === "F" ? "°F" : "°C"}
          kind="decimal"
          result={result.temperature}
          error={errorOf("temperature")}
          shown={checked.has("temperature")}
          inputProps={inputProps("temperature")}
          extra={
            <SegmentedControl
              aria-label="Temperature unit"
              value={unit}
              onValueChange={(v) => {
                const next = v as TempUnit;
                const n = parseVital(values.temperature);
                if (n !== null && !Number.isNaN(n)) {
                  set("temperature", String(next === "C" ? fahrenheitToCelsius(n) : celsiusToFahrenheit(n)));
                }
                setUnit(next);
              }}
              options={[
                { value: "F", label: "°F" },
                { value: "C", label: "°C" },
              ]}
            />
          }
        />
        <SingleRow id={id} field="spo2" label="SpO₂" unit="%" kind="numeric" result={result.spo2} error={errorOf("spo2")} shown={checked.has("spo2")} inputProps={inputProps("spo2")} />
        <SingleRow id={id} field="respRate" label="Resp. rate" unit="/min" kind="numeric" result={result.respRate} error={errorOf("respRate")} shown={checked.has("respRate")} inputProps={inputProps("respRate")} />
        <Row label="Weight and height" labelId={`${id}-wh`} group>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Input kind="decimal" aria-label="Weight" aria-describedby={`${id}-wh-msg`} wrapperClassName="w-28" className="tabular-nums" endAdornment="kg" {...inputProps("weight")} />
            <Input kind="decimal" aria-label="Height" aria-describedby={`${id}-wh-msg`} wrapperClassName="w-28" className="tabular-nums" endAdornment="cm" {...inputProps("height")} />
            <p className="text-body-sm text-fg-secondary tabular-nums" aria-live="polite" data-bmi="">
              BMI {bmiValue === null ? "–" : `${bmiValue.toFixed(1)} · ${bmiBand(bmiValue)}`}
            </p>
          </div>
          <Messages id={`${id}-wh-msg`} items={[["Weight", result.weight, errorOf("weight"), checked.has("weight")], ["Height", result.height, errorOf("height"), checked.has("height")]]} />
        </Row>
        <SingleRow
          id={id}
          field="sugar"
          label="Blood sugar"
          unit="mg/dL"
          kind="numeric"
          result={result.sugar}
          error={errorOf("sugar")}
          shown={checked.has("sugar")}
          inputProps={inputProps("sugar")}
          extra={
            <SegmentedControl
              aria-label="Blood sugar type"
              value={sugarType}
              onValueChange={(v) => setSugarType(v as SugarType)}
              options={[
                { value: "random", label: "Random" },
                { value: "fasting", label: "Fasting" },
                { value: "pp", label: "PP" },
              ]}
            />
          }
        />
      </div>
      <div className="sticky bottom-0 z-10 -mx-1 mt-3 flex items-center justify-end gap-3 border-t border-border bg-surface px-1 pt-3 pb-safe">
        <p role="status" className="text-label text-fg-muted">
          {saved ? "Vitals saved" : ""}
        </p>
        <Button type="submit" loading={saving}>
          Save vitals
        </Button>
      </div>
    </form>
  );
}

function Row({ label, labelId, group = false, children }: { label: string; labelId: string; group?: boolean; children: React.ReactNode }) {
  return (
    <div
      role={group ? "group" : undefined}
      aria-labelledby={group ? labelId : undefined}
      className="grid gap-1.5 py-2.5 md:grid-cols-[var(--spacing-label-col)_minmax(0,1fr)] md:items-start md:gap-3"
    >
      <span id={labelId} className="text-label font-medium text-fg md:pt-2.5">
        {label}
      </span>
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </div>
  );
}

function SingleRow({
  id,
  field,
  label,
  unit,
  kind,
  result,
  error,
  shown,
  inputProps,
  extra,
}: {
  id: string;
  field: Field;
  label: string;
  unit: string;
  kind: "numeric" | "decimal";
  result: VitalAssessment;
  error: string | null;
  shown: boolean;
  inputProps: FieldInputProps;
  extra?: React.ReactNode;
}) {
  const inputId = `${id}-${field}`;
  return (
    <div className="grid gap-1.5 py-2.5 md:grid-cols-[var(--spacing-label-col)_minmax(0,1fr)] md:items-start md:gap-3">
      <label htmlFor={inputId} className="text-label font-medium text-fg md:pt-2.5">
        {label}
      </label>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Input id={inputId} kind={kind} aria-describedby={`${inputId}-msg`} wrapperClassName="w-32" className="tabular-nums" endAdornment={unit} {...inputProps} />
          {extra}
        </div>
        <Messages id={`${inputId}-msg`} items={[[label, result, error, shown]]} />
      </div>
    </div>
  );
}

/** Flags and errors under a row: text plus icon, never colour alone. `id` is the inputs' description. */
function Messages({ id, items }: { id: string; items: [string, VitalAssessment, string | null, boolean][] }) {
  type Line = { key: string; tone: "error" | "flag" | "critical"; text: string };
  const lines = items.flatMap(([label, r, error, shown]): Line[] => {
    if (error) return [{ key: label, tone: "error", text: items.length > 1 ? `${label}: ${error}` : error }];
    if (shown && r.state === "ok") {
      const word = flagWord(r.flag);
      if (word) {
        const critical = isCritical(r.flag);
        const text = `${items.length > 1 ? `${label} ` : ""}${word}${critical ? " · critical" : ""}`;
        return [{ key: label, tone: critical ? "critical" : "flag", text }];
      }
    }
    return [];
  });
  return (
    <div id={id} className="flex flex-col gap-0.5 empty:hidden">
      {lines.map((l) => (
        <p
          key={l.key}
          data-vital-message={l.tone}
          className={cn(
            "flex items-center gap-1 text-label",
            l.tone === "flag" ? "font-medium text-warning-fg" : "font-semibold text-danger-fg",
          )}
        >
          {l.tone === "error" ? (
            <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          ) : l.tone === "critical" ? (
            <OctagonAlert aria-hidden="true" className="size-3.5 shrink-0" />
          ) : (
            <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          )}
          {l.text}
        </p>
      ))}
    </div>
  );
}
