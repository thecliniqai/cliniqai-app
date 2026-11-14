"use client";

import React, { useId, useMemo, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Minus, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { focusBoxInput } from "@/lib/ui/focus-box";
import { CONTROL_BASE, CONTROL_HEIGHT, CONTROL_STATE, FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import {
  DEFAULT_DOSE,
  DURATION_PRESETS,
  FREQUENCY_PRESETS,
  MAX_DAYS,
  MIN_DAYS,
  TIMING_PRESETS,
  clampDays,
  doseSummary,
  durationLabel,
  frequencyWords,
  parseDuration,
  searchMedicines,
  type Medicine,
  type RxLine,
} from "@/lib/clinical/rx";

/**
 * RxEntryRow (V2-06 06-03b; 06-UI-SPEC RxEntryRow, CD-07, CD-33; DESIGN_SYSTEM §7.6): the keyboard-first way to add a
 * medicine. A combobox (cmdk through `Command`) searches the doctor's list; Enter (or ↓ then Enter) picks a match and
 * opens the dose builder with the doctor's usual dose. Focus stays in the search field, which now reads the dose keys:
 * a digit 1–5 picks the frequency preset, then a duration like `5d`, `2w` or `1m`, and Enter adds the line and empties
 * the search for the next medicine. So after typing the name a line costs five keystrokes: Enter, 2, 5, d, Enter.
 * Everything is also tap-first: the presets are tiles, the duration has a stepper, Tab walks into the builder.
 *
 * Typing any other character while the builder is open searches again (the pending line is dropped). Escape closes
 * the builder (or the list) and keeps focus in the field. The list opens only while there is a query, never on page
 * load, and it scrolls itself, never the page (the `Command` wrapper confines cmdk's `scrollIntoView`).
 */
export interface RxEntryRowProps {
  /** The searchable list (the gallery passes a synthetic in-memory list; V2-09 wires the doctor's formulary). */
  medicines: readonly Medicine[];
  onAdd: (line: RxLine) => void;
  /** Accessible name of the combobox. */
  label?: string;
  className?: string;
}

export interface DoseDraft {
  medicine: Medicine;
  frequency: string;
  timing: string;
  days: number;
  instruction: string;
}

const DIGIT_PRESET = /^[1-5]$/;

function pendingFor(medicine: Medicine): DoseDraft {
  const usual = medicine.usual ?? DEFAULT_DOSE;
  return { medicine, frequency: usual.frequency, timing: usual.timing, days: usual.days, instruction: "" };
}

function customMedicine(name: string): Medicine {
  const clean = name.trim().replace(/\s+/g, " ");
  return { id: `custom:${clean.toLowerCase()}`, name: clean, form: "Custom", generic: clean };
}

export function RxEntryRow({ medicines, onAdd, label = "Medicine", className }: RxEntryRowProps) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<DoseDraft | null>(null);
  // Keys typed into the field while the builder is open: whether the frequency digit has been typed, and the digits
  // of a duration waiting for its unit.
  const [freqTyped, setFreqTyped] = useState(false);
  const [durBuffer, setDurBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hintId = useId();

  const results = useMemo(() => searchMedicines(medicines, query), [medicines, query]);
  const trimmed = query.trim();
  const exact = results.some((m) => m.name.toLowerCase() === trimmed.toLowerCase());
  const listOpen = trimmed !== "" && pending === null;

  function openBuilder(medicine: Medicine) {
    setPending(pendingFor(medicine));
    setQuery(medicine.name);
    setFreqTyped(false);
    setDurBuffer("");
    setError(null);
    inputRef.current?.focus();
  }

  function closeBuilder() {
    setPending(null);
    setQuery("");
    setFreqTyped(false);
    setDurBuffer("");
    setError(null);
    inputRef.current?.focus();
  }

  function commit(next: DoseDraft | null = pending) {
    if (!next) return;
    let days = next.days;
    if (durBuffer) {
      // Digits without a unit are days ("5" then Enter = 5 days).
      days = Number(durBuffer);
    }
    if (!(days >= MIN_DAYS && days <= MAX_DAYS)) {
      setError(`Enter a duration from ${MIN_DAYS} to ${MAX_DAYS} days`);
      setDurBuffer("");
      return;
    }
    onAdd({
      medicine: next.medicine,
      frequency: next.frequency,
      timing: next.timing,
      days,
      instruction: next.instruction.trim() || undefined,
    });
    closeBuilder();
  }

  function update(patch: Partial<DoseDraft>) {
    setPending((p) => (p ? { ...p, ...patch } : p));
    setError(null);
  }

  function onFieldKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      if (pending || query) {
        event.preventDefault();
        event.stopPropagation();
        closeBuilder();
      }
      return;
    }
    if (!pending) return;
    const key = event.key;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault();
      return;
    }
    if (/^\d$/.test(key)) {
      event.preventDefault();
      if (!freqTyped && durBuffer === "" && DIGIT_PRESET.test(key)) {
        update({ frequency: FREQUENCY_PRESETS[Number(key) - 1] });
        setFreqTyped(true);
      } else if (durBuffer.length < 3) {
        setFreqTyped(true);
        setDurBuffer((b) => b + key);
      }
      return;
    }
    if (/^[dwm]$/i.test(key) && durBuffer !== "") {
      event.preventDefault();
      const days = parseDuration(durBuffer + key);
      setDurBuffer("");
      if (days === null || days > MAX_DAYS) setError(`Enter a duration from ${MIN_DAYS} to ${MAX_DAYS} days`);
      else update({ days });
      return;
    }
    if (key === "Backspace" && durBuffer !== "") {
      event.preventDefault();
      setDurBuffer((b) => b.slice(0, -1));
    }
  }

  const durationShown = durBuffer ? `${durBuffer}…` : pending ? durationLabel(pending.days) : "";

  return (
    <div data-rx-entry="" className={cn("flex flex-col gap-3", className)}>
      <Command
        label={label}
        shouldFilter={false}
        loop
        expanded={listOpen}
        className="relative overflow-visible bg-transparent"
      >
        <div
          data-rx-box=""
          role="presentation"
          onMouseDown={focusBoxInput}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2.5",
            CONTROL_HEIGHT,
            CONTROL_STATE.default,
            TRANSITION,
            "has-[input:focus-visible]:focus-ring",
          )}
        >
          <Search aria-hidden="true" className="size-4 shrink-0 text-fg-icon" />
          <CommandPrimitive.Input
            ref={inputRef}
            value={query}
            onValueChange={(next) => {
              setQuery(next);
              if (pending) {
                setPending(null);
                setFreqTyped(false);
                setDurBuffer("");
                setError(null);
              }
            }}
            onKeyDown={onFieldKeyDown}
            placeholder="Type a medicine or salt · Enter picks the top match"
            aria-describedby={pending ? hintId : undefined}
            enterKeyHint={pending ? "done" : "search"}
            autoCapitalize="none"
            data-rx-search=""
            className={cn(CONTROL_BASE, "h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 outline-none")}
          />
        </div>
        <CommandList
          hidden={!listOpen}
          label="Medicines"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-75 rounded-lg border border-border bg-surface shadow-popover"
        >
          {results.length > 0
            ? results.map((m) => (
                <CommandItem key={m.id} value={m.id} onSelect={() => openBuilder(m)}>
                  <span className="flex min-w-0 flex-col py-1 leading-tight">
                    <span className="truncate font-medium text-fg">{m.name}</span>
                    <span className="truncate text-label text-fg-muted">
                      {m.form} · {m.generic}
                    </span>
                  </span>
                </CommandItem>
              ))
            : null}
          {trimmed && !exact && (
            <CommandGroup heading={results.length === 0 ? `No medicine matches “${trimmed}”` : undefined}>
              <CommandItem
                value={`create:${trimmed}`}
                onSelect={() => openBuilder(customMedicine(trimmed))}
                className="font-medium text-accent-fg"
                icon={<Plus />}
              >
                Add “{trimmed}”
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
      <p id={hintId} className="sr-only">
        Keys 1 to 5 pick the frequency, then a duration such as 5d, 2w or 1m. Enter adds the medicine.
      </p>
      {pending && (
        <DoseBuilder
          value={pending}
          onChange={update}
          onAdd={() => commit()}
          onCancel={closeBuilder}
          durationShown={durationShown}
          error={error}
        />
      )}
    </div>
  );
}

export interface DoseBuilderProps {
  value: DoseDraft;
  onChange: (patch: Partial<DoseDraft>) => void;
  onAdd: () => void;
  onCancel: () => void;
  /** Stepper text ("5 days", or the digits being typed "1…"). */
  durationShown?: string;
  error?: string | null;
  /** "Add to prescription" or, when editing a line, "Update line". */
  submitLabel?: string;
  /** Show the head's Close button (off inside a sheet that has its own). */
  closable?: boolean;
}

/**
 * The dose builder: hairline panel, radius-lg, padding 12, gap 10. Frequency tiles (keys 1–5), timing tiles, duration
 * tiles plus a − N days + stepper, an optional instruction, and "Add to prescription" (Enter) / "Cancel". A polite live
 * region reads the line as it stands ("1-0-0 · After food · 5 days").
 */
export function DoseBuilder({
  value,
  onChange,
  onAdd,
  onCancel,
  durationShown,
  error,
  submitLabel = "Add to prescription",
  closable = true,
}: DoseBuilderProps) {
  const headingId = useId();
  const presetDays = (DURATION_PRESETS as readonly number[]).includes(value.days) ? String(value.days) : "";
  const stepButton = cn(
    "flex size-8 shrink-0 cursor-pointer items-center justify-center text-fg-secondary hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:text-fg-disabled touch:size-control",
    TRANSITION,
    FOCUS_RING,
  );
  return (
    // Escape from any control inside closes the builder: a bubbling key handler, not a pointer target.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      aria-labelledby={headingId}
      data-dose-builder=""
      className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="flex items-start gap-2">
        <h4 id={headingId} className="flex min-w-0 flex-1 flex-col text-body-md font-semibold text-fg">
          {value.medicine.name}
          <small className="text-label font-normal text-fg-muted">
            {value.medicine.form} · {value.medicine.generic}
          </small>
        </h4>
        {closable && <IconButton size="sm" label="Close dose builder" icon={<X />} tooltip={false} onClick={onCancel} />}
      </div>
      <DoseRow label="Frequency" hint={<span className="hidden gap-0.5 lg:inline-flex">{FREQUENCY_PRESETS.map((_, i) => <Kbd key={i}>{i + 1}</Kbd>)}</span>}>
        <ChipGroup
          type="single"
          variant="tile"
          aria-label="Frequency"
          value={value.frequency}
          onValueChange={(frequency) => onChange({ frequency })}
          items={FREQUENCY_PRESETS.map((f) => ({ value: f, label: <span className="min-w-10 text-center tracking-[0.04em]">{f}</span>, "aria-label": `${f}, ${frequencyWords(f)}` }))}
        />
      </DoseRow>
      <DoseRow label="Timing">
        <ChipGroup
          type="single"
          variant="tile"
          aria-label="Timing"
          value={value.timing}
          onValueChange={(timing) => onChange({ timing })}
          items={TIMING_PRESETS.map((t) => ({ value: t, label: t }))}
        />
      </DoseRow>
      <DoseRow label="Duration">
        <div className="flex flex-wrap items-center gap-1.5">
          <ChipGroup
            type="single"
            variant="tile"
            aria-label="Duration"
            value={presetDays}
            onValueChange={(d) => onChange({ days: Number(d) })}
            items={DURATION_PRESETS.map((d) => ({ value: String(d), label: durationLabel(d) }))}
          />
          <span role="group" aria-label="Duration in days" className="inline-flex h-tile items-center overflow-hidden rounded-md border border-(--tile-border) touch:h-control">
            <button type="button" aria-label="One day less" disabled={value.days <= MIN_DAYS} onClick={() => onChange({ days: clampDays(value.days - 1) })} className={stepButton}>
              <Minus aria-hidden="true" className="size-3.5" />
            </button>
            <output aria-live="off" className="min-w-16 px-1 text-center text-body-sm font-medium text-fg tabular-nums">
              {durationShown || durationLabel(value.days)}
            </output>
            <button type="button" aria-label="One day more" disabled={value.days >= MAX_DAYS} onClick={() => onChange({ days: clampDays(value.days + 1) })} className={stepButton}>
              <Plus aria-hidden="true" className="size-3.5" />
            </button>
          </span>
        </div>
      </DoseRow>
      <Input
        kind="name"
        autoCapitalize="sentences"
        aria-label="Instruction"
        placeholder="Instruction (optional), e.g. with warm water"
        value={value.instruction}
        enterKeyHint="done"
        onChange={(e) => onChange({ instruction: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdd();
          }
        }}
      />
      {error && (
        <p role="alert" className="text-label text-danger-fg">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-label text-fg-muted" data-dose-summary="">
          {doseSummary(value)}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onAdd} kbd={<Kbd tone="on-accent" className="hidden lg:inline-flex">↵</Kbd>}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}

function DoseRow({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-caption font-semibold tracking-caps text-fg-muted uppercase">
        {label}
        {hint}
      </div>
      {children}
    </div>
  );
}
