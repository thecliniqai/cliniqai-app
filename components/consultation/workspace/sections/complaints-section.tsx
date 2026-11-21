"use client";

import React, { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import type { ChiefComplaintItem } from "@/features/consultation/schema";
import { COMPLAINTS, COMPLAINT_DURATIONS, DEFAULT_COMPLAINT_DURATION } from "@/features/consultation/catalogue";
import { rankComplaints, type AssistContext } from "@/features/consultation/assist-ranking";
import { ChipGroup } from "@/components/ui/chip-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { SmartAssistLabel } from "@/components/clinical/smart-assist-label";
import { RemoveButton } from "./remove-button";

/**
 * The Complaints section of the consult (06-UI-SPEC §7; V2-09b 09B-03, R-9, R-12). Complaints are added by tapping a tile (no typing): the tiles are the
 * catalogue ordered by this doctor's own history when the clinic has Smart Assist terminology (`context`), the catalogue order otherwise. A tapped
 * complaint is added with the v1 default duration (3 days) and the doctor changes it with the option pills. Per-complaint notes, free entry of a new
 * complaint and the history-of-present-illness note are the v1 controls, unchanged. The whole section is read-only on a sealed record (the notes stay
 * focusable and scrollable, 09A review B-6).
 */

export interface ComplaintsSectionProps {
  complaints: ChiefComplaintItem[];
  clinicalNotes: string;
  onComplaintsChange: (updated: ChiefComplaintItem[]) => void;
  onClinicalNotesChange: (notes: string) => void;
  disabled?: boolean;
  /** The calling doctor's learned order (null: the catalogue order, no label). */
  context?: AssistContext | null;
  /** Opens the shorthand bar (09B-04b); absent when the clinic has no `assist.shorthand` or the record is read-only. */
  onOpenShorthand?: () => void;
}

// Module level (V2-06 06-08, R-30): React Compiler's `purity` rule reports a random read inside a component, even in an event handler.
function newComplaintId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function durationIdOf(item: ChiefComplaintItem): string {
  return COMPLAINT_DURATIONS.find((d) => d.val === item.duration_val && d.unit === item.duration_unit)?.id ?? "";
}

export function ComplaintsSection({
  complaints,
  clinicalNotes,
  onComplaintsChange,
  onClinicalNotesChange,
  disabled = false,
  context = null,
  onOpenShorthand,
}: ComplaintsSectionProps) {
  const [customSymptom, setCustomSymptom] = useState("");
  // After a complaint is added the tile that was tapped is gone: focus moves to the new row's duration pills (the next step of the entry).
  const focusRowRef = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const id = focusRowRef.current;
    if (!id) return;
    focusRowRef.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-complaint-row="${id}"] [role="radio"]`)?.focus();
  }, [complaints]);

  const ranked = rankComplaints({ catalogue: COMPLAINTS, context, added: complaints.map((c) => c.symptom) });

  const addSymptom = (symptom: string) => {
    const name = symptom.trim();
    if (!name) return;
    if (complaints.some((c) => c.symptom.toLowerCase() === name.toLowerCase())) return;
    const id = newComplaintId();
    focusRowRef.current = id;
    onComplaintsChange([
      ...complaints,
      { id, symptom: name, duration_val: DEFAULT_COMPLAINT_DURATION.val, duration_unit: DEFAULT_COMPLAINT_DURATION.unit, notes: null },
    ]);
    setCustomSymptom("");
  };
  const updateAt = (index: number, change: Partial<ChiefComplaintItem>) => {
    const updated = [...complaints];
    updated[index] = { ...updated[index], ...change };
    onComplaintsChange(updated);
  };

  return (
    <div className="flex flex-col gap-5">
      {!disabled && (
        <div data-complaint-tiles="" data-smart-assist={ranked.learned ? "on" : "off"}>
          <p className="mb-2 flex flex-wrap items-center gap-x-2 text-label font-semibold text-fg-secondary">
            Tap to add
            {ranked.learned && (
              <>
                <span aria-hidden="true">·</span>
                <SmartAssistLabel />
                <span className="font-normal text-fg-muted">ranked for you</span>
              </>
            )}
          </p>
          <ChipGroup
            type="multiple"
            variant="tile"
            aria-label="Complaints"
            // Tapping adds the complaint and the tile leaves the group: the group never holds a selection of its own.
            value={[]}
            onValueChange={(next) => {
              if (next.length > 0) addSymptom(next[next.length - 1]);
            }}
            items={ranked.tiles.map((t) => ({ value: t.name, label: t.name }))}
          />
          <div className="mt-3 flex max-w-sm items-center gap-2">
            <Input
              type="text"
              aria-label="Other complaint"
              placeholder="Or type custom complaint..."
              value={customSymptom}
              onChange={(e) => setCustomSymptom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSymptom(customSymptom);
                }
              }}
            />
            <Button type="button" variant="secondary" disabled={!customSymptom.trim()} onClick={() => addSymptom(customSymptom)} className="shrink-0">
              Add
            </Button>
          </div>
        </div>
      )}

      {complaints.length > 0 ? (
        <ul ref={listRef} aria-label="Complaints added" className="flex flex-col gap-2">
          {complaints.map((item, index) => (
            <li
              key={item.id ?? `${item.symptom}-${index}`}
              data-complaint-row={item.id ?? ""}
              className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-body-md font-semibold text-fg">{item.symptom}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-label text-fg-muted">for</span>
                  <ChipGroup
                    type="single"
                    variant="option"
                    aria-label={`Duration of ${item.symptom}`}
                    disabled={disabled}
                    value={durationIdOf(item)}
                    onValueChange={(id) => {
                      const d = COMPLAINT_DURATIONS.find((x) => x.id === id);
                      if (d) updateAt(index, { duration_val: d.val, duration_unit: d.unit });
                    }}
                    items={COMPLAINT_DURATIONS.map((d) => ({ value: d.id, label: d.label }))}
                  />
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  aria-label={`Note on ${item.symptom}`}
                  placeholder="Notes (e.g. nocturnal, dry)..."
                  value={item.notes || ""}
                  disabled={disabled}
                  onChange={(e) => updateAt(index, { notes: e.target.value || null })}
                  className="sm:w-72 md:w-80"
                />
                {!disabled && <RemoveButton label={`Remove ${item.symptom}`} disabled={false} onClick={() => onComplaintsChange(complaints.filter((_, i) => i !== index))} />}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border-strong p-3 text-center text-body-sm text-fg-muted">
          No complaints added yet. Tap a tile above or type a complaint.
        </p>
      )}

      <div className="border-t border-border pt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="clinical-notes" className="flex items-center gap-1.5 text-label font-semibold text-fg-secondary">
            <FileText aria-hidden="true" className="size-4 text-fg-icon" />
            History of Present Illness & Clinical Notes
          </label>
          {onOpenShorthand && !disabled && (
            <Button type="button" variant="secondary" size="sm" onClick={onOpenShorthand} data-open-shorthand="">
              Shorthand
              <Kbd className="ml-1">/</Kbd>
            </Button>
          )}
        </div>
        <Textarea
          id="clinical-notes"
          rows={3}
          value={clinicalNotes}
          // V2-09a review B-6: a read-only record keeps its notes focusable and scrollable (readOnly, not disabled), so a keyboard user can reach,
          // read and copy long signed notes; typing is still blocked.
          readOnly={disabled}
          aria-readonly={disabled || undefined}
          onChange={(e) => {
            if (!disabled) onClinicalNotesChange(e.target.value);
          }}
          placeholder="Detailed notes on symptom onset, progression, aggravating/relieving factors, prior medications taken..."
        />
      </div>
    </div>
  );
}
