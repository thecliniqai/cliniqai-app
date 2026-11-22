"use client";

import React, { useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Minus, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { Command, CommandGroup, CommandItem, CommandList, CommandLoading } from "@/components/ui/command";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { focusBoxInput } from "@/lib/ui/focus-box";
import { allergyReasonError } from "@/features/prescriptions/allergy";
import { CONTROL_BASE, CONTROL_HEIGHT, CONTROL_STATE, FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import {
  DURATION_PRESETS,
  FREQUENCY_PRESETS,
  MAX_DAYS,
  MIN_DAYS,
  TIMING_PRESETS,
  clampDays,
  doseSummary,
  durationLabel,
  frequencyWords,
  lineDuration,
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
 * 06-09c (M-RXKEYS, IND M-2) keyboard rules, so a line is never saved with a frequency or duration the doctor did not
 * see: each frequency tile shows its key (1 = 1-0-1, 2 = 1-0-0, 3 = 0-0-1, 4 = 1-1-1, 5 = SOS; `RX_KEY_HELP` is the
 * same mapping for screen readers); a lone digit followed by a unit is a duration ("3d" = 3 days, the frequency
 * stays); Enter right after a lone frequency digit, or with digits that have no unit yet, adds nothing and says why;
 * a tap on a duration tile or the stepper always wins over unfinished typed digits; once dose keys were typed, any
 * other character is refused with a hint instead of silently dropping the line. Before any dose key, typing searches
 * again (the pending line is dropped). Escape closes the builder (or the list) and keeps focus in the field. The list
 * opens only while there is a query, never on page load, and it scrolls itself, never the page (the `Command` wrapper
 * confines cmdk's `scrollIntoView`).
 */
export interface RxEntryRowProps {
  /** A searchable in-memory list (the gallery passes a synthetic one). With `search` the list is only the fallback and is not used. */
  medicines?: readonly Medicine[];
  /**
   * V2-09c R-5: the typeahead of the consult, a GET route (never a server action). It is called after {@link RxEntryRowProps.searchDebounceMs} of
   * quiet and aborted with the next keystroke; a rejected call shows "Couldn't search medicines".
   */
  search?: (query: string, signal: AbortSignal) => Promise<readonly Medicine[]>;
  searchDebounceMs?: number;
  /**
   * Adds the line. A promise answers `{ ok: false, error }` to keep the line in the dose builder with that error (Enter sends it again); `ok: true` or no
   * answer closes the builder and empties the field for the next medicine.
   */
  onAdd: (line: RxLine, opts?: { allergyReason?: string }) => void | Promise<RxAddResult | void>;
  /** Called with each change of the line being built (the host starts a new request after an error). */
  onEdit?: () => void;
  /** Accessible name of the combobox. */
  label?: string;
  /**
   * V2-09c 09C-02 (R-7): the recorded allergies a medicine matches ("Amoxicillin"), or null. A result row then carries the danger "Allergy" chip, the dose
   * builder says "Matches allergy: …", and the line is added only after "Prescribe anyway" with a reason of 5 to 300 characters.
   */
  allergyOf?: (medicine: Medicine) => string | null;
  /** V2-09c 09C-03 (R-9, R-10): an imperative handle; a tile or a repeat that must leave a medicine to the doctor opens the dose builder with {@link RxEntryHandle.prefill}. */
  handleRef?: React.Ref<RxEntryHandle>;
  className?: string;
}

/** What a host can ask of the entry row. */
export interface RxEntryHandle {
  /**
   * Opens the dose builder for `medicine` with its usual dose (only the parts that are known; nothing is invented) and focuses the field. `allergy` names a
   * match the host already knows (the database left the line out of a repeat): the builder then says "Matches allergy: …" and adds only with a reason.
   */
  prefill(medicine: Medicine, opts?: { allergy?: string }): void;
}

/** `needsReason`: the database refused the line because it matches a recorded allergy (the dose builder then asks for the reason). */
export type RxAddResult = { ok: true } | { ok: false; error: string; needsReason?: boolean };

export const RX_CHOOSE_DOSE_TEXT = "Choose a frequency (1 to 5) and a duration such as 5d";
export const RX_SEARCH_FAILED_TEXT = "Couldn't search medicines. Try again.";

export interface DoseDraft {
  medicine: Medicine;
  frequency: string;
  timing: string;
  /** 0 = none chosen yet (V2-09c R-4: no dose is invented). */
  days: number;
  /** A stored duration the days cannot express ("Continue"); dropped as soon as the doctor chooses days. */
  durationText?: string;
  instruction: string;
}

const DIGIT_PRESET = /^[1-5]$/;

/** The dose builder's start: the doctor's own usual dose, part by part, and otherwise nothing (V2-09c R-4: no frequency, timing or duration is invented). */
function pendingFor(medicine: Medicine): DoseDraft {
  const usual = medicine.usual ?? {};
  return {
    medicine,
    frequency: usual.frequency ?? "",
    timing: usual.timing ?? "",
    days: usual.days ?? 0,
    durationText: usual.days === undefined ? usual.durationText : undefined,
    instruction: "",
  };
}

function customMedicine(name: string): Medicine {
  const clean = name.trim().replace(/\s+/g, " ");
  return { id: `custom:${clean.toLowerCase()}`, name: clean, form: "Custom", generic: clean };
}

/** The inline help, built from the presets so the keys it names are exactly the keys the field reads (06-09c). */
export const RX_KEY_HELP = `Keys 1 to 5 pick the frequency: ${FREQUENCY_PRESETS.map((f, i) => `${i + 1} for ${f}`).join(", ")}. Then type the duration with its unit, such as 5d, 2w or 1m. Enter adds the medicine.`;

const UNIT_KEY = /^[dwm]$/i;

function rangeError(): string {
  return `Enter a duration from ${MIN_DAYS} to ${MAX_DAYS} days`;
}

/** A lone frequency digit is waiting for its duration (06-09c M-RXKEYS): what it picked and what it replaced. */
interface FrequencyKey {
  digit: string;
  before: string;
}

export function RxEntryRow({
  medicines = [],
  search,
  searchDebounceMs = 150,
  onAdd,
  onEdit,
  label = "Medicine",
  allergyOf,
  handleRef,
  className,
}: RxEntryRowProps) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<DoseDraft | null>(null);
  // Keys typed into the field while the builder is open: whether the frequency digit has been typed, the lone
  // frequency digit still waiting for what follows it, and the digits of a duration waiting for its unit.
  const [freqTyped, setFreqTyped] = useState(false);
  const [freqKey, setFreqKey] = useState<FrequencyKey | null>(null);
  const [durBuffer, setDurBuffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonOpen, setReasonOpen] = useState(false);
  // A match the host knows about and the screen's own rule may not (a line the repeat command left out): set by `prefill`, dropped when the builder closes.
  const [forcedAllergy, setForcedAllergy] = useState<string | null>(null);
  // The remote answer and the query it answers (results are never shown for another query: Enter must not pick a stale top row).
  const [answer, setAnswer] = useState<{ query: string; hits: readonly Medicine[]; failed: boolean }>({ query: "", hits: [], failed: false });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hintId = useId();
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  // Enter pressed while the answer is on its way picks the top row when it arrives (a fast typist never creates a custom medicine by accident).
  const pickWhenReady = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      seq.current += 1;
      if (timer.current) clearTimeout(timer.current);
      inflight.current?.abort();
    };
  }, []);

  const trimmed = query.trim();
  const staticResults = useMemo(() => (search ? [] : searchMedicines(medicines, query)), [search, medicines, query]);
  const remoteCurrent = search ? answer.query === trimmed : true;
  const results: readonly Medicine[] = search ? (remoteCurrent ? answer.hits : []) : staticResults;
  const exact = results.some((m) => m.name.toLowerCase() === trimmed.toLowerCase());
  const listOpen = trimmed !== "" && pending === null;
  const waiting = Boolean(search) && trimmed !== "" && !remoteCurrent && pending === null;

  function runSearch(next: string) {
    if (!search) return;
    const n = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    inflight.current?.abort();
    const q = next.trim();
    if (q === "") {
      setAnswer({ query: "", hits: [], failed: false });
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      inflight.current = controller;
      try {
        const hits = await search(q, controller.signal);
        if (n !== seq.current || !mounted.current) return;
        setAnswer({ query: q, hits, failed: false });
        if (pickWhenReady.current) {
          pickWhenReady.current = false;
          if (hits.length > 0) openBuilder(hits[0]);
        }
      } catch {
        if (n !== seq.current || !mounted.current) return;
        pickWhenReady.current = false;
        if (!controller.signal.aborted) setAnswer({ query: q, hits: [], failed: true });
      } finally {
        if (n === seq.current && mounted.current) setLoading(false);
      }
    }, searchDebounceMs);
  }

  function resetTyping() {
    setFreqTyped(false);
    setFreqKey(null);
    setDurBuffer("");
    setError(null);
    setReason("");
    setReasonOpen(false);
  }

  function openBuilder(medicine: Medicine, forced: string | null = null) {
    pickWhenReady.current = false;
    setForcedAllergy(forced);
    setPending(pendingFor(medicine));
    setQuery(medicine.name);
    resetTyping();
    inputRef.current?.focus();
  }

  useImperativeHandle(handleRef, () => ({
    prefill(medicine, opts) {
      // The builder opens in view: a tile far from the field must not leave the dose builder off screen.
      openBuilder(medicine, opts?.allergy ?? null);
      inputRef.current?.scrollIntoView({ block: "nearest" });
    },
  }));

  function closeBuilder() {
    pickWhenReady.current = false;
    seq.current += 1;
    if (timer.current) clearTimeout(timer.current);
    inflight.current?.abort();
    setLoading(false);
    setPending(null);
    setForcedAllergy(null);
    setQuery("");
    setAnswer({ query: "", hits: [], failed: false });
    resetTyping();
    inputRef.current?.focus();
  }

  /**
   * Adds the line exactly as the builder shows it. 06-09c (M-RXKEYS): never with an unfinished typed duration ("1…"
   * has no unit yet: the doctor is told to add one), and from the keyboard never right after a lone frequency digit
   * ("5" then Enter meant "5 days" as often as "SOS": the doctor is told what the digit picked and asked for the
   * duration). A tap on "Add to prescription" adds what the tiles show. V2-09c R-4: a line with no frequency or no duration is not added and the doctor
   * is told what to choose; nothing is prefilled. The host may answer that the line could not be saved: it stays in the builder with that text.
   */
  async function commit(source: "key" | "tap") {
    if (!pending || sending) return;
    if (durBuffer) {
      setError(`Add the unit to ${durBuffer}: d, w or m (for example ${durBuffer}d)`);
      return;
    }
    if (source === "key" && freqKey) {
      setError(`${freqKey.digit} picked ${pending.frequency}. Type the duration, such as 5d, or choose “Add to prescription”.`);
      return;
    }
    const noFrequency = pending.frequency.trim() === "";
    const noDuration = !pending.durationText && pending.days < MIN_DAYS;
    if (noFrequency && noDuration) {
      setError(RX_CHOOSE_DOSE_TEXT);
      return;
    }
    if (noFrequency) {
      setError("Choose a frequency (1 to 5)");
      return;
    }
    if (noDuration) {
      setError("Choose a duration such as 5d");
      return;
    }
    if (!pending.durationText && !(pending.days >= MIN_DAYS && pending.days <= MAX_DAYS)) {
      setError(rangeError());
      return;
    }
    const line: RxLine = {
      medicine: pending.medicine,
      frequency: pending.frequency,
      timing: pending.timing,
      days: pending.days,
      durationText: pending.durationText,
      instruction: pending.instruction.trim() || undefined,
    };
    // A medicine that matches a recorded allergy is added only with a reason (R-7): the first Enter or tap opens the reason field, the next sends.
    const matched = (allergyOf ? allergyOf(pending.medicine) : null) ?? forcedAllergy;
    const asking = Boolean(matched) || reasonOpen;
    if (asking) {
      if (!reasonOpen) {
        setReasonOpen(true);
        setError(`Matches allergy: ${matched}. Give a reason to prescribe it.`);
        return;
      }
      const reasonError = allergyReasonError(reason);
      if (reasonError) {
        setError(reasonError);
        return;
      }
    }
    setSending(true);
    setError(null);
    let answered: RxAddResult | void = undefined;
    try {
      answered = await onAdd(line, asking ? { allergyReason: reason.trim() } : undefined);
    } finally {
      if (mounted.current) setSending(false);
    }
    if (!mounted.current) return;
    if (answered && !answered.ok) {
      setError(answered.error);
      if (answered.needsReason) setReasonOpen(true);
      if (!answered.needsReason) inputRef.current?.focus();
      return;
    }
    closeBuilder();
  }

  function patch(next: Partial<DoseDraft>) {
    setPending((p) => (p ? { ...p, ...next, ...(next.days !== undefined ? { durationText: undefined } : {}) } : p));
    setError(null);
    onEdit?.();
  }

  /**
   * A change made in the builder itself (a tile, the stepper, the instruction). 06-09c (M-RXKEYS): it always wins over
   * anything half-typed in the search field — an unfinished duration ("1…") is dropped, so a tap on "7 days" saves 7
   * days, never the typed 1.
   */
  function fromBuilder(next: Partial<DoseDraft>) {
    patch(next);
    setDurBuffer("");
    setFreqKey(null);
  }

  function refuse(event: React.KeyboardEvent<HTMLInputElement>, message: string) {
    event.preventDefault();
    setError(message);
  }

  function onFieldKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (sending) {
      // The line is on its way: the field keeps focus and takes no key until the answer arrives.
      if (event.key !== "Tab") event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      if (pending || query) {
        event.preventDefault();
        event.stopPropagation();
        closeBuilder();
      }
      return;
    }
    if (!pending) {
      if (event.key === "Enter" && search && waiting && !event.metaKey && !event.ctrlKey && !event.altKey) {
        // The answer for what was typed is not here yet: wait for it, then pick its top row (cmdk has nothing to pick).
        event.preventDefault();
        event.stopPropagation();
        pickWhenReady.current = true;
      }
      return;
    }
    const key = event.key;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (key === "Enter") {
      event.preventDefault();
      void commit("key");
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault();
      return;
    }
    if (/^\d$/.test(key)) {
      event.preventDefault();
      if (!freqTyped && durBuffer === "" && DIGIT_PRESET.test(key)) {
        // The first digit picks the frequency preset shown on its tile (1 = 1-0-1 … 5 = SOS, RX_KEY_HELP).
        setFreqKey({ digit: key, before: pending.frequency });
        patch({ frequency: FREQUENCY_PRESETS[Number(key) - 1] });
        setFreqTyped(true);
      } else if (durBuffer.length < 3) {
        setFreqTyped(true);
        setFreqKey(null);
        setDurBuffer((b) => b + key);
        setError(null);
      }
      return;
    }
    if (UNIT_KEY.test(key)) {
      if (durBuffer !== "") {
        event.preventDefault();
        const days = parseDuration(durBuffer + key);
        setDurBuffer("");
        if (days === null || days > MAX_DAYS) setError(rangeError());
        else patch({ days });
        return;
      }
      if (freqKey) {
        // "3d": the lone digit was a duration, not a frequency. The frequency goes back to what it was.
        event.preventDefault();
        const days = parseDuration(freqKey.digit + key);
        patch({ frequency: freqKey.before });
        setFreqKey(null);
        setFreqTyped(false);
        if (days === null || days > MAX_DAYS) setError(rangeError());
        else patch({ days });
        return;
      }
    }
    if (key === "Backspace") {
      if (durBuffer !== "") {
        event.preventDefault();
        setDurBuffer((b) => b.slice(0, -1));
        return;
      }
      if (freqKey) {
        // Undo the lone frequency digit.
        event.preventDefault();
        patch({ frequency: freqKey.before });
        setFreqKey(null);
        setFreqTyped(false);
        return;
      }
    }
    // Any other character after dose keys were typed would search again and silently drop the line being built:
    // refuse it and say which keys work (Escape searches again).
    if (key.length === 1 && (freqTyped || durBuffer !== "" || freqKey)) {
      refuse(event, "Type a duration such as 5d, 2w or 1m, or press Escape to search again");
    }
  }

  const durationShown = durBuffer ? `${durBuffer}…` : pending ? lineDuration(pending) : "";
  const pendingAllergy = pending ? ((allergyOf ? allergyOf(pending.medicine) : null) ?? forcedAllergy) : null;

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
            readOnly={sending}
            onValueChange={(next) => {
              setQuery(next);
              if (pending) {
                setPending(null);
                resetTyping();
              }
              pickWhenReady.current = false;
              runSearch(next);
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
          {search && waiting && loading ? <CommandLoading label="Searching…" /> : null}
          {search && !waiting && answer.failed && answer.query === trimmed ? (
            <div role="presentation" className="px-3 py-3 text-body-sm text-danger-fg">
              {RX_SEARCH_FAILED_TEXT}
            </div>
          ) : null}
          {results.length > 0
            ? results.map((m) => {
                const allergy = allergyOf ? allergyOf(m) : null;
                return (
                  <CommandItem key={m.id} value={m.id} onSelect={() => openBuilder(m)}>
                    <span className="flex min-w-0 flex-1 flex-col py-1 leading-tight">
                      <span className="truncate font-medium text-fg">{m.name}</span>
                      <span className="truncate text-label text-fg-muted">
                        {[m.form, m.generic].filter(Boolean).join(" · ")}
                        {m.kind === "custom" ? " · Yours" : ""}
                      </span>
                    </span>
                    {allergy ? (
                      <span data-allergy-chip="" className="ml-2 inline-flex h-5 shrink-0 items-center rounded-pill bg-danger-bg px-2 text-caption font-semibold text-danger-fg">
                        Allergy
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })
            : null}
          {trimmed && !exact && !waiting && (
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
        {RX_KEY_HELP}
      </p>
      {pending && (
        <DoseBuilder
          value={pending}
          onChange={fromBuilder}
          onAdd={() => void commit("tap")}
          onCancel={closeBuilder}
          durationShown={durationShown}
          error={error}
          busy={sending}
          notice={pendingAllergy ? `Matches allergy: ${pendingAllergy}` : null}
          submitLabel={pendingAllergy || reasonOpen ? (reasonOpen ? "Prescribe anyway" : "Prescribe anyway…") : undefined}
          extra={
            reasonOpen ? (
              <Input
                kind="name"
                autoCapitalize="sentences"
                aria-label="Reason to prescribe anyway"
                placeholder="Reason to prescribe despite the allergy"
                maxLength={300}
                value={reason}
                // The reason field opens on the doctor's own Enter or tap; focus moves into it.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commit("tap");
                  }
                }}
              />
            ) : null
          }
          keyHints
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
  /** Show each frequency tile's key (1–5) on ≥ lg screens: only where the search field reads those keys (06-09c). */
  keyHints?: boolean;
  /** The line is on its way to the server: the submit shows "Adding…" and does nothing. */
  busy?: boolean;
  /** A warning above the tiles (V2-09c 09C-02: "Matches allergy: Amoxicillin"). */
  notice?: string | null;
  /** Extra content above the footer (the allergy reason field). */
  extra?: React.ReactNode;
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
  keyHints = false,
  busy = false,
  notice = null,
  extra = null,
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
      {notice && (
        <p role="alert" data-dose-notice="" className="text-label font-semibold text-danger-fg">
          {notice}
        </p>
      )}
      <DoseRow label="Frequency">
        <ChipGroup
          type="single"
          variant="tile"
          aria-label="Frequency"
          value={value.frequency}
          onValueChange={(frequency) => onChange({ frequency })}
          items={FREQUENCY_PRESETS.map((f, i) => ({
            value: f,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <span className="min-w-10 text-center tracking-[0.04em]">{f}</span>
                {/* 06-09c (M-RXKEYS): the key next to the frequency it picks, not a 1–5 row beside the label. */}
                {keyHints && (
                  <Kbd className="hidden lg:inline-flex" data-frequency-key={i + 1}>
                    {i + 1}
                  </Kbd>
                )}
              </span>
            ),
            "aria-label": `${f}, ${frequencyWords(f)}`,
          }))}
        />
      </DoseRow>
      <Input
        kind="name"
        autoCapitalize="none"
        aria-label="Other frequency"
        placeholder="Other frequency, e.g. 1-0-2"
        maxLength={50}
        value={(FREQUENCY_PRESETS as readonly string[]).includes(value.frequency) ? "" : value.frequency}
        enterKeyHint="done"
        onChange={(e) => onChange({ frequency: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdd();
          }
        }}
      />
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
              {durationShown || lineDuration(value) || "Choose"}
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
      {extra}
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
          <Button
            variant="primary"
            loading={busy}
            onClick={onAdd}
            kbd={<Kbd tone="on-accent" className="hidden lg:inline-flex">↵</Kbd>}
          >
            {busy ? "Adding…" : submitLabel}
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
