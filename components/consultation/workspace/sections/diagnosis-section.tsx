"use client";

import React, { useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { BookmarkCheck, Plus, Search } from "lucide-react";
import { addConsultationDiagnosis, removeConsultationDiagnosis, updateDiagnosisNote } from "@/features/terminology/actions";
import type { ConsultationDiagnosisItem } from "@/features/terminology/schema";
import { fetchDiagnosisHits, DIAGNOSIS_SEARCH_MIN_CHARS, type DiagnosisHit } from "@/features/terminology/search";
import { SPECIALTY_QUICK_DIAGNOSES } from "@/features/terminology/quick-diagnoses";
import type { ClinicalSpecialty } from "@/features/consultation/schema";
import { quickChipsBesideLearned, rankDiagnoses, type AssistContext } from "@/features/consultation/assist-ranking";
import { ChipGroup } from "@/components/ui/chip-group";
import { Command, CommandGroup, CommandItem, CommandList, CommandLoading } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SmartAssistLabel } from "@/components/clinical/smart-assist-label";
import { RemoveButton } from "./remove-button";
import { cn } from "@/lib/utils";
import { CONTROL_BASE, CONTROL_HEIGHT, CONTROL_STATE, TRANSITION } from "@/lib/ui/variants";
import { focusBoxInput } from "@/lib/ui/focus-box";
import { reportClientError } from "@/lib/log/client";
import { rum } from "@/lib/observability/rum/collector";

/**
 * The Diagnosis section of the consult (06-UI-SPEC §7; V2-09b 09B-04a, R-11, AI-07). Replaces the v1 `diagnosis-section.tsx` and its React Compiler waiver:
 * the list is the workspace's own state (no prop-to-state copy) and the typeahead runs from the input's change handler, so no effect sets state.
 *
 * - "Likely from the complaints" and "Your recent" tiles (Smart Assist label): this doctor's own signed history only, when the clinic has
 *   `assist.terminology` (`context`). The fixed chips of the specialty (the v1 list) are always there under them: the only group for a doctor with no
 *   history or no entitlement, and a way to a diagnosis the history does not hold. A chip whose diagnosis a learned tile already offers is left out
 *   (one diagnosis, one button; CI 44924479177).
 * - A combobox over `GET /api/terminology/diagnoses` (a route handler, never a server action: it aborts with each keystroke and runs beside a draft
 *   save), debounced 200 ms: the doctor's own custom diagnoses first, then the catalogue ranked by name, synonym and abbreviation expansion. Codes are
 *   labelled ICD-11. Enter or a tap adds the highlighted row; the last row adds what was typed as the doctor's own diagnosis.
 * - A tile or row is applied only by a tap or Enter; nothing is added for the doctor. Add, remove and note keep the existing actions and their sealed-
 *   refusal texts. Everything is read-only on a sealed record.
 */

export interface DiagnosisSectionProps {
  visitId: string;
  patientId: string;
  specialty: ClinicalSpecialty;
  /** The diagnoses on this visit: the workspace's state, which this section updates. */
  diagnoses: ConsultationDiagnosisItem[];
  onDiagnosesChange: React.Dispatch<React.SetStateAction<ConsultationDiagnosisItem[]>>;
  /** The complaints added so far (they rank the "likely" tiles). */
  complaints: readonly string[];
  /** The calling doctor's learned order (null: the fixed specialty chips, no label). */
  context?: AssistContext | null;
  disabled?: boolean;
  /** A diagnosis outside the catalogue the database accepted: it joins the doctor's own list in the consult's query (09E-08, R-11). */
  onCustomAdded?: (diagnosis: { diagnosis_name: string; specialty: string | null }) => void;
}

export const DIAGNOSIS_DEBOUNCE_MS = 200;
export const DIAGNOSIS_SEARCH_FAILED_TEXT = "Couldn't search diagnoses. Try again.";

// Module level (V2-06 06-08, R-30): React Compiler's `purity` rule reports a clock read inside a component, even in an event handler.
function optimisticDiagnosisId(): string {
  return `temp-${Date.now()}`;
}

interface DiagnosisInput {
  name: string;
  icd11?: string | null;
  snomed?: string | null;
  custom?: boolean;
  chronic?: boolean;
}

export function DiagnosisSection({ visitId, patientId, specialty, diagnoses, onDiagnosesChange, complaints, context = null, disabled = false, onCustomAdded }: DiagnosisSectionProps) {
  const [query, setQuery] = useState("");
  // The answer and the query it answers (results are never shown for another query).
  const [answer, setAnswer] = useState<{ query: string; hits: readonly DiagnosisHit[]; failed: boolean }>({ query: "", hits: [], failed: false });
  const [loading, setLoading] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 09E-08 (R-11, reversible): a refused or lost change is taken back on screen; the notice says so and Retry sends the same change again.
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const fail = (text: string, again?: () => void) => {
    setErrorMsg(text);
    setRetry(again ? () => again : null);
  };
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<AbortController | null>(null);
  const trimmed = query.trim();
  const listOpen = trimmed.length >= DIAGNOSIS_SEARCH_MIN_CHARS;

  useEffect(
    () => () => {
      seq.current += 1;
      if (timer.current) clearTimeout(timer.current);
      pending.current?.abort();
    },
    [],
  );

  function run(next: string) {
    const n = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    pending.current?.abort();
    const q = next.trim();
    if (q.length < DIAGNOSIS_SEARCH_MIN_CHARS) {
      setAnswer({ query: "", hits: [], failed: false });
      setLoading(false);
      return;
    }
    setLoading(true);
    const stopTimer = rum.timer("search_server");
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      pending.current = controller;
      try {
        const hits = await fetchDiagnosisHits(q, specialty, controller.signal);
        if (n !== seq.current) return;
        setAnswer({ query: q, hits, failed: false });
        stopTimer();
      } catch (err) {
        if (n !== seq.current) return;
        if (!controller.signal.aborted) reportClientError("terminology.diagnosis_search.failed", err);
        setAnswer({ query: q, hits: [], failed: true });
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, DIAGNOSIS_DEBOUNCE_MS);
  }

  const current = answer.query === trimmed;
  const hits = current ? answer.hits : [];
  const settled = !loading && current;
  const failed = settled && answer.failed;
  const exactHit = hits.some((h) => h.name.toLowerCase() === trimmed.toLowerCase());

  const addedKeys = new Set(diagnoses.map((d) => d.diagnosis_name.toLowerCase()));
  const ranked = rankDiagnoses({ context, complaints, added: diagnoses.map((d) => d.diagnosis_name) });

  const handleAdd = async (input: DiagnosisInput) => {
    if (disabled) return;
    setErrorMsg(null);
    const stop = rum.timer("save_reversible");
    const tempId = optimisticDiagnosisId();
    const added: ConsultationDiagnosisItem = {
      id: tempId,
      visit_id: visitId,
      patient_id: patientId,
      diagnosis_name: input.name,
      icd11_code: input.icd11 || null,
      snomed_concept_id: input.snomed || null,
      is_custom: input.custom ?? false,
      is_chronic: input.chronic ?? false,
      notes: null,
      created_at: new Date().toISOString(),
    };
    onDiagnosesChange((list) => [...list, added]);
    // The diagnosis is in the list: the next frame is the first the doctor sees it in.
    requestAnimationFrame(() => stop());
    setQuery("");
    run("");
    try {
      const res = await addConsultationDiagnosis({
        visit_id: visitId,
        patient_id: patientId,
        diagnosis_name: input.name,
        icd11_code: input.icd11,
        snomed_concept_id: input.snomed,
        is_custom: input.custom ?? false,
        is_chronic: input.chronic ?? false,
      });
      if (res.success) {
        onDiagnosesChange((list) => list.map((d) => (d.id === tempId ? { ...d, id: res.diagnosisId } : d)));
        if (input.custom) onCustomAdded?.({ diagnosis_name: input.name, specialty: null });
      } else {
        onDiagnosesChange((list) => list.filter((d) => d.id !== tempId));
        fail(res.error || "Failed to add diagnosis.", () => void handleAdd(input));
      }
    } catch (err: unknown) {
      onDiagnosesChange((list) => list.filter((d) => d.id !== tempId));
      fail(err instanceof Error ? err.message : "Failed to record diagnosis.", () => void handleAdd(input));
    }
  };

  const handleRemove = async (id: string) => {
    if (disabled) return;
    setErrorMsg(null);
    const stop = rum.timer("save_reversible");
    const before = diagnoses;
    onDiagnosesChange((list) => list.filter((d) => d.id !== id));
    requestAnimationFrame(() => stop());
    try {
      const res = await removeConsultationDiagnosis(id, visitId);
      if (!res.success) {
        onDiagnosesChange(before);
        fail(res.error || "Failed to remove diagnosis.", () => void handleRemove(id));
      }
    } catch (err: unknown) {
      onDiagnosesChange(before);
      fail(err instanceof Error ? err.message : "Failed to remove diagnosis.", () => void handleRemove(id));
    }
  };

  const handleSaveNote = async (id: string, notes: string) => {
    if (disabled) return;
    const cleaned = notes.trim() || null;
    const stop = rum.timer("save_reversible");
    const previous = diagnoses.find((d) => d.id === id)?.notes ?? null;
    onDiagnosesChange((list) => list.map((d) => (d.id === id ? { ...d, notes: cleaned } : d)));
    requestAnimationFrame(() => stop());
    setEditingNoteId(null);
    try {
      const res = await updateDiagnosisNote(id, visitId, cleaned);
      if (!res.success) {
        onDiagnosesChange((list) => list.map((d) => (d.id === id ? { ...d, notes: previous } : d)));
        fail(res.error || "Failed to save the note.", () => void handleSaveNote(id, notes));
      }
    } catch (err) {
      reportClientError("terminology.diagnosis_note_update.failed", err);
      onDiagnosesChange((list) => list.map((d) => (d.id === id ? { ...d, notes: previous } : d)));
      fail("Failed to save the note.", () => void handleSaveNote(id, notes));
    }
  };

  const fromEntry = (d: NonNullable<typeof context>["diagnoses"][number]): DiagnosisInput => ({
    name: d.name,
    icd11: d.icd11,
    snomed: d.snomed,
    custom: d.custom ?? false,
    chronic: d.chronic ?? false,
  });
  const tapDiagnosis = (entries: ReadonlyArray<NonNullable<typeof context>["diagnoses"][number]>, name: string | undefined) => {
    const entry = entries.find((e) => e.name === name);
    if (entry) void handleAdd(fromEntry(entry));
  };
  // A diagnosis the learned tiles offer is not offered a second time by the fixed chips (CI 44924479177: "Viral Fever" was two buttons).
  const quick = quickChipsBesideLearned(SPECIALTY_QUICK_DIAGNOSES[specialty] ?? SPECIALTY_QUICK_DIAGNOSES.general_physician, ranked);

  return (
    <div className="flex flex-col gap-4">
      {errorMsg && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-fg">
          <span>{errorMsg}</span>
          <span className="flex shrink-0 gap-1">
            {retry && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  const again = retry;
                  setErrorMsg(null);
                  setRetry(null);
                  again();
                }}
              >
                Retry
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setErrorMsg(null)}>
              Dismiss
            </Button>
          </span>
        </div>
      )}

      {ranked.likely.length > 0 && (
        <div data-diagnosis-likely="">
          <p className="mb-2 flex flex-wrap items-center gap-x-2 text-label font-semibold text-fg-secondary">
            Likely from the complaints
            <SmartAssistLabel />
          </p>
          <ChipGroup
            type="multiple"
            variant="tile"
            aria-label="Likely diagnoses"
            disabled={disabled}
            value={[]}
            onValueChange={(next) => tapDiagnosis(ranked.likely, next[next.length - 1])}
            items={ranked.likely.map((d) => ({ value: d.name, label: d.name, meta: d.icd11 ?? undefined }))}
          />
        </div>
      )}
      {ranked.recent.length > 0 && (
        <div data-diagnosis-recent="">
          <p className="mb-2 flex flex-wrap items-center gap-x-2 text-label font-semibold text-fg-secondary">
            Your recent
            {ranked.likely.length === 0 && <SmartAssistLabel />}
          </p>
          <ChipGroup
            type="multiple"
            variant="tile"
            aria-label="Your recent diagnoses"
            disabled={disabled}
            value={[]}
            onValueChange={(next) => tapDiagnosis(ranked.recent, next[next.length - 1])}
            items={ranked.recent.map((d) => ({ value: d.name, label: d.name, meta: d.icd11 ?? undefined }))}
          />
        </div>
      )}
      {/* The v1 chips of the specialty stay whatever the history offers: a doctor with no history relies on them, and one with history may want a diagnosis the history does not hold. */}
        <div>
          <p className="mb-2 text-label font-semibold text-fg-secondary">Quick OPD diagnoses · {specialty.replace("_", " ")}</p>
          <ChipGroup
            type="multiple"
            variant="tile"
            aria-label="Quick OPD diagnoses"
            disabled={disabled}
            value={diagnoses.map((d) => d.diagnosis_name).filter((n) => quick.some((q) => q.name.toLowerCase() === n.toLowerCase()))}
            onValueChange={(next) => {
              const tapped = next.find((n) => !addedKeys.has(n.toLowerCase()));
              const item = quick.find((q) => q.name === tapped);
              if (item) void handleAdd({ name: item.name, icd11: item.icd11, snomed: item.snomed, custom: false, chronic: item.isChronic ?? false });
            }}
            items={quick.map((q) => ({ value: q.name, label: q.name, meta: q.icd11, disabled: addedKeys.has(q.name.toLowerCase()) }))}
          />
        </div>

      <Command
        label="Search diagnoses"
        shouldFilter={false}
        loop
        expanded={listOpen && !disabled}
        className="relative overflow-visible bg-transparent"
        data-diagnosis-search=""
        onKeyDown={(event) => {
          // Enter acts only on the answer to what the field holds now.
          if (event.key === "Enter" && !settled) event.preventDefault();
        }}
      >
        <div
          role="presentation"
          onMouseDown={focusBoxInput}
          className={cn("flex items-center gap-2 rounded-md border px-2.5", CONTROL_HEIGHT, disabled ? CONTROL_STATE.disabled : CONTROL_STATE.default, TRANSITION, "has-[input:focus-visible]:focus-ring")}
        >
          <Search aria-hidden="true" className="size-4 shrink-0 text-fg-icon" />
          <CommandPrimitive.Input
            value={query}
            disabled={disabled}
            onValueChange={(next) => {
              setQuery(next);
              run(next);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
                run("");
              }
            }}
            placeholder="Search diagnosis name, ICD-11, SNOMED CT, or custom condition..."
            enterKeyHint="search"
            autoCapitalize="none"
            className={cn(CONTROL_BASE, "h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 outline-none")}
          />
        </div>
        <div hidden={!listOpen || disabled} className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-popover">
          {loading && <CommandLoading label="Searching diagnoses…" />}
          {failed && (
            <p role="alert" className="px-3 py-2.5 text-body-sm text-danger-fg" data-diagnosis-search-failed="">
              {DIAGNOSIS_SEARCH_FAILED_TEXT}
            </p>
          )}
          <CommandList label="Diagnoses" className="max-h-72">
            {hits.map((hit) => (
              <CommandItem
                key={`${hit.id}-${hit.name}`}
                value={`${hit.id}-${hit.name}`}
                multiline
                onSelect={() => void handleAdd({ name: hit.name, icd11: hit.icd11, snomed: hit.snomed, custom: hit.custom, chronic: hit.chronic })}
                hint={<span className="hidden in-data-[selected=true]:inline">Add</span>}
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium text-fg">{hit.name}</span>
                  {hit.custom && <span className="rounded-xs border border-border-strong px-1.5 text-caption text-fg-secondary">My diagnosis</span>}
                  {hit.chronic && <span className="rounded-xs border border-warning-border bg-warning-bg px-1.5 text-caption font-semibold text-warning-fg">Chronic</span>}
                  {hit.icd11 && <span className="text-caption text-fg-muted tabular-nums">ICD-11 {hit.icd11}</span>}
                </span>
              </CommandItem>
            ))}
            {settled && !failed && trimmed.length >= 2 && !exactHit && (
              <CommandGroup heading={hits.length === 0 ? `No diagnosis matches “${trimmed}”` : undefined}>
                <CommandItem value="custom" onSelect={() => void handleAdd({ name: trimmed, custom: true, chronic: false })} icon={<Plus />} className="font-medium text-accent-fg">
                  Add “{trimmed}” as my own diagnosis
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </div>
        <p role="status" className="sr-only">
          {settled && !failed ? (hits.length === 1 ? "1 diagnosis" : `${hits.length} diagnoses`) : ""}
        </p>
      </Command>

      <div>
        <p className="mb-2 text-label font-semibold text-fg-secondary">
          Selected diagnoses · {diagnoses.length} {diagnoses.length === 1 ? "condition" : "conditions"} coded
        </p>
        {diagnoses.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-strong p-3 text-center text-body-sm text-fg-muted">
            No diagnoses selected yet. Tap one above or type to search.
          </p>
        ) : (
          <ul aria-label="Diagnoses" className="flex flex-col gap-2">
            {diagnoses.map((item) => {
              // V2-09a 09A-06a (review B-7): a read-only record never shows the note editor, even one opened before the record was sealed.
              const isEditingNote = editingNoteId === item.id && !disabled;
              return (
                <li key={item.id} className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-body-md font-semibold text-fg">{item.diagnosis_name}</span>
                      {item.icd11_code && <span className="text-caption text-fg-muted tabular-nums">ICD-11 {item.icd11_code}</span>}
                      {item.snomed_concept_id && <span className="text-caption text-fg-muted tabular-nums">SNOMED {item.snomed_concept_id}</span>}
                      {item.is_chronic && (
                        <span className="inline-flex items-center gap-1 rounded-xs border border-warning-border bg-warning-bg px-1.5 text-caption font-semibold text-warning-fg">
                          <BookmarkCheck aria-hidden="true" className="size-3" />
                          Chronic
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!isEditingNote && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          onClick={() => {
                            setEditingNoteId(item.id);
                            setEditingNote(item.notes || "");
                          }}
                        >
                          {item.notes ? "Edit note" : "+ Note"}
                        </Button>
                      )}
                      <RemoveButton label="Remove diagnosis" disabled={disabled} onClick={() => void handleRemove(item.id)} />
                    </div>
                  </div>
                  {item.notes && !isEditingNote && <p className="rounded-sm bg-surface-soft px-2 py-1.5 text-body-sm text-fg-secondary">Note: {item.notes}</p>}
                  {isEditingNote && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        aria-label={`Note on ${item.diagnosis_name}`}
                        value={editingNote}
                        autoFocus
                        placeholder="e.g. Mild flare-up, symptoms onset 3 days ago"
                        maxLength={500}
                        onChange={(e) => setEditingNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleSaveNote(item.id, editingNote);
                          } else if (e.key === "Escape") {
                            setEditingNoteId(null);
                          }
                        }}
                      />
                      <Button type="button" size="sm" onClick={() => void handleSaveNote(item.id, editingNote)}>
                        Save
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditingNoteId(null)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
