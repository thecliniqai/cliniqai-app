"use client";

import { useState } from "react";
import { BookOpen, RotateCcw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { DoseBuilder, RxEntryRow, type DoseDraft, type RxAddResult } from "@/components/clinical/rx-entry-row";
import { RxLineItem } from "@/components/clinical/rx-line-item";
import { fetchMedicines } from "@/features/prescriptions/search";
import { itemToAdd, itemToLine, lineToAdd, lineToUpdate } from "@/features/prescriptions/lines";
import type { PrescriptionItem } from "@/lib/db/types";
import { lineDuration, MAX_DAYS, MIN_DAYS, type Medicine, type RxLine } from "@/lib/clinical/rx";
import { RxTemplatesSheet } from "../rx-templates-sheet";
import { allergyMatches, matchText, type AllergyEntry, type AllergyState } from "@/features/prescriptions/allergy";
import type { UseRxLines } from "../use-rx-lines";

/**
 * The Prescription section of the consult (V2-09c 09C-01, R-4, R-5; DESIGN_SYSTEM §7.6; M4.4). Replaces the v1 `prescription-builder.tsx` and its React Compiler
 * waiver. The doctor adds medicines from the keyboard (`RxEntryRow`: Enter picks the top match, 1 to 5 the frequency, `5d` the duration, Enter adds) or by
 * tap; a committed line is edited in place from its pills and removed with an 8 s Undo. Every change is one `change_prescription` command (`useRxLines`),
 * so the lines shown are the server's. Nothing is prefilled that the doctor did not choose or has not prescribed before (R-4).
 *
 * A sealed, completed unsigned or cancelled record shows the lines as text with no entry row and no pills (`readOnly`); an amending record is editable. The
 * workspace remounts the section when the record state changes, which drops an open dose builder (V2-09a review B-1).
 */
/** The allergy picture the section draws (V2-09c 09C-02, R-7): absent or `entitled: false` = nothing of the check is shown. */
export interface RxAllergyView {
  state: AllergyState;
  entitled: boolean;
  entries: readonly AllergyEntry[];
  /** What each current line matches and how it was checked (`rx_allergy_context`); a line not listed is unchecked. */
  items: Readonly<Record<string, { matches: readonly string[]; checkedBy: "substance" | "name"; overridden: boolean; overrideReason: string | null }>>;
  /** "Record now" while the allergies are not recorded (the role may record them and the record is editable). */
  onRecord?: () => void;
}

export interface PrescriptionSectionProps {
  rx: UseRxLines;
  allergy?: RxAllergyView | null;
  readOnly: boolean;
  /** The patient has a past prescription to repeat (the history list's first one). */
  canRepeatLast: boolean;
  /** Repeats it as one command; the answer shows its text on failure. */
  onRepeatLast: () => Promise<{ ok: boolean; error?: string }>;
}

interface Editing {
  id: string;
  draft: DoseDraft;
  error: string | null;
}

export const RX_EMPTY_TEXT = "No medicines yet. Type a medicine above: Enter picks the top match.";

function draftOf(item: PrescriptionItem): DoseDraft {
  const line = itemToLine(item);
  return {
    medicine: line.medicine,
    frequency: line.frequency,
    timing: line.timing,
    days: line.days,
    durationText: line.durationText,
    instruction: line.instruction ?? "",
  };
}

export function PrescriptionSection({ rx, allergy = null, readOnly, canRepeatLast, onRepeatLast }: PrescriptionSectionProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [repeating, setRepeating] = useState(false);

  const checking = Boolean(allergy?.entitled);
  // The recorded allergies a medicine matches, from the search row's substance ids (empty: checked by name), or null (V2-09c R-7).
  const allergyOf =
    checking && allergy && allergy.entries.length > 0
      ? (medicine: Medicine): string | null => {
          const matched = allergyMatches(allergy.entries, { substanceIds: medicine.substanceIds ?? [], names: [medicine.name, medicine.generic] });
          return matched.length > 0 ? matchText(matched) : null;
        }
      : undefined;

  const addLine = async (line: RxLine, opts?: { allergyReason?: string }): Promise<RxAddResult> => {
    setListError(null);
    const sent = await rx.add([lineToAdd(line)], opts?.allergyReason);
    if (sent.ok) return { ok: true };
    // The database refused a medicine the screen did not flag (a name the rule found there): the dose builder asks for the reason.
    return { ok: false, error: sent.error ?? "Failed to add the medicine.", needsReason: sent.reason === "ALLERGY_MATCH" };
  };

  const confirmWithReason = async (item: PrescriptionItem, reason: string) => {
    setListError(null);
    const sent = await rx.send({ update: [{ id: item.id, dosage: item.dosage }], allergy_override_reason: reason });
    if (!sent.ok) setListError(sent.error ?? "Failed to confirm the medicine.");
  };

  const saveEdit = async (item: PrescriptionItem) => {
    if (!editing) return;
    const d = editing.draft;
    const noDuration = !d.durationText && !(d.days >= MIN_DAYS && d.days <= MAX_DAYS);
    if (d.frequency.trim() === "" || noDuration) {
      setEditing({ ...editing, error: "Choose a frequency and a duration." });
      return;
    }
    const line: RxLine = { ...itemToLine(item), frequency: d.frequency, timing: d.timing, days: d.days, durationText: d.durationText, instruction: d.instruction.trim() || undefined };
    const update = lineToUpdate(item, line);
    if (!update) {
      setEditing(null);
      return;
    }
    const sent = await rx.update([update]);
    if (sent.ok) setEditing(null);
    else setEditing({ ...editing, error: sent.error ?? "Failed to update the medicine." });
  };

  const removeItem = async (item: PrescriptionItem) => {
    setListError(null);
    const sent = await rx.remove([item.id]);
    if (!sent.ok) {
      setListError(sent.error ?? "Failed to remove the medicine.");
      return;
    }
    if (editing?.id === item.id) setEditing(null);
    notify.info(`${item.medicine_name} removed`, {
      undo: () => {
        void rx.add([itemToAdd(item)]).then((again) => {
          if (!again.ok) notify.error(again.error ?? "Could not put the medicine back.");
        });
      },
    });
  };

  const repeatLast = async () => {
    setRepeating(true);
    setListError(null);
    try {
      const sent = await onRepeatLast();
      if (!sent.ok) setListError(sent.error ?? "Failed to repeat the last prescription.");
    } finally {
      setRepeating(false);
    }
  };

  return (
    <div data-rx-section="" className="flex flex-col gap-3">
      {!readOnly && checking && allergy?.state === "not_recorded" && (
        <p data-rx-allergy-unrecorded="" className="flex flex-wrap items-center gap-2 rounded-md bg-alert-unrecorded-bg px-3 py-1.5 text-body-sm font-medium text-alert-unrecorded-fg">
          Allergies not recorded
          {allergy.onRecord && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={allergy.onRecord} className="cursor-pointer font-semibold underline underline-offset-2 touch:min-h-control">
                Record now
              </button>
            </>
          )}
        </p>
      )}
      {!readOnly && (
        <RxEntryRow
          label="Medicine"
          allergyOf={allergyOf}
          search={(query, signal) => fetchMedicines(query, signal)}
          onAdd={addLine}
        />
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          {canRepeatLast && (
            <Button type="button" variant="secondary" size="sm" startIcon={<RotateCcw />} loading={repeating} onClick={() => void repeatLast()}>
              Repeat last Rx
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" startIcon={<BookOpen />} onClick={() => setTemplatesOpen(true)}>
            Templates
          </Button>
        </div>
      )}
      {listError && <Alert tone="danger">{listError}</Alert>}
      {rx.items.length === 0 ? (
        <p data-rx-empty="" className="rounded-lg border border-dashed border-border p-6 text-center text-body-sm text-fg-muted">
          {readOnly ? "No medicines were prescribed." : RX_EMPTY_TEXT}
        </p>
      ) : (
        <ol aria-label="Prescribed medicines" className="flex flex-col">
          {rx.items.flatMap((item, index) => {
            const line = itemToLine(item);
            const open = editing?.id === item.id ? editing : null;
            const info = checking ? allergy?.items[item.id] : undefined;
            const unresolved = info && info.matches.length > 0 && !info.overridden ? matchText(info.matches) : null;
            const note =
              info?.overridden
                ? { text: `Prescribed despite allergy${info.overrideReason ? `: ${info.overrideReason}` : ""}`, tone: "danger" as const }
                : info && info.checkedBy === "name" && allergy?.state === "known"
                  ? { text: "Checked by name only", tone: "info" as const }
                  : null;
            const row = (
              <RxLineItem
                key={item.id}
                index={index + 1}
                line={line}
                readOnly={readOnly}
                note={note}
                allergyMatch={readOnly ? null : unresolved}
                onOverride={(reason) => void confirmWithReason(item, reason)}
                onEdit={() => setEditing({ id: item.id, draft: draftOf(item), error: null })}
                onRemove={() => void removeItem(item)}
              />
            );
            if (!open) return [row];
            return [
              row,
              <li key={`${item.id}:edit`} className="list-none pb-2" data-rx-editing={item.id}>
                <DoseBuilder
                  value={open.draft}
                  submitLabel="Update line"
                  busy={rx.busy}
                  error={open.error}
                  durationShown={lineDuration(open.draft)}
                  onChange={(next) =>
                    setEditing({
                      ...open,
                      error: null,
                      draft: { ...open.draft, ...next, ...(next.days !== undefined ? { durationText: undefined } : {}) },
                    })
                  }
                  onAdd={() => void saveEdit(item)}
                  onCancel={() => setEditing(null)}
                />
              </li>,
            ];
          })}
        </ol>
      )}
      {!readOnly && (
        <RxTemplatesSheet open={templatesOpen} onOpenChange={setTemplatesOpen} items={rx.items} onApply={(lines) => rx.add(lines)} />
      )}
    </div>
  );
}
