"use client";

import { useState, type RefObject } from "react";
import { BookOpen, RotateCcw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { notify } from "@/components/ui/toast";
import { DoseBuilder, RxEntryRow, type DoseDraft, type RxAddResult, type RxEntryHandle } from "@/components/clinical/rx-entry-row";
import { RxLineItem } from "@/components/clinical/rx-line-item";
import { SmartAssistLabel } from "@/components/clinical/smart-assist-label";
import { fetchMedicines } from "@/features/prescriptions/search";
import { itemToAdd, itemToLine, lineToAdd, lineToUpdate, rxEntryToAdd, rxEntryToMedicine } from "@/features/prescriptions/lines";
import { rxBundlesFor, rxFavouritesFor, type AssistContext, type RxAssistEntry } from "@/features/consultation/assist-ranking";
import type { PrescriptionItem } from "@/lib/db/types";
import { lineDuration, MAX_DAYS, MIN_DAYS, type Medicine, type RxLine } from "@/lib/clinical/rx";
import { RxTemplatesSheet } from "../rx-templates-sheet";
import { allergyMatches, matchText, type AllergyEntry, type AllergyState } from "@/features/prescriptions/allergy";
import type { RepeatPart, UseRxLines } from "../use-rx-lines";

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

/** A medicine the database or the screen left out of a one-tap add because it matches a recorded allergy: the doctor decides in the dose builder. */
export interface RxLeftOut {
  key: string;
  medicine: Medicine;
  /** The match the screen could not name itself (the database decided): shown in the builder as "Matches allergy: …". */
  allergy?: string;
}

/** "Same as last visit" (V2-09c R-10): the patient's last signed visit and what is still missing from this one. */
export interface RxLastVisit {
  visitId: string;
  /** The visit's date in the clinic's zone, for the tile. */
  dateLabel: string;
  /** What copying would add now: parts with nothing missing are not offered. */
  parts: readonly RepeatPart[];
}

export interface PrescriptionSectionProps {
  rx: UseRxLines;
  allergy?: RxAllergyView | null;
  readOnly: boolean;
  /**
   * The calling doctor's own history (`consult_assist_context` rx keys), only when the clinic is entitled to `assist.frequent_rx` (R-9); null: no
   * favourites and no "your usual" tile, "Same as last visit" stays.
   */
  assistContext?: AssistContext | null;
  /** The diagnoses on the visit, for "your usual for {diagnosis}". */
  diagnosisNames?: readonly string[];
  /** The visit's specialty (ranks the templates). */
  specialty?: string | null;
  lastVisit?: RxLastVisit | null;
  /** "Same as last visit" or "Repeat this Rx": one command, answered with its text on failure. */
  onRepeat: (sourceVisitId: string, parts: readonly RepeatPart[]) => Promise<{ ok: boolean; error?: string }>;
  /** The entry row's handle: the host opens the dose builder for a medicine left to the doctor. */
  entryRef: RefObject<RxEntryHandle | null>;
  leftOut: readonly RxLeftOut[];
  onLeftOut: (next: readonly RxLeftOut[]) => void;
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

export function PrescriptionSection({
  rx,
  allergy = null,
  readOnly,
  assistContext = null,
  diagnosisNames = [],
  specialty = null,
  lastVisit = null,
  onRepeat,
  entryRef,
  leftOut,
  onLeftOut,
}: PrescriptionSectionProps) {
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

  // The recorded allergies a favourite or bundle medicine matches, by its catalogue substance ids or by name (the rule of the commands).
  const entryAllergy = (entry: RxAssistEntry): string | null => {
    if (!checking || !allergy || allergy.entries.length === 0) return null;
    const matched = allergyMatches(allergy.entries, { substanceIds: entry.substance_ids, names: [entry.name, entry.generic_name ?? ""] });
    return matched.length > 0 ? matchText(matched) : null;
  };

  const onRxNames = rx.items.map((i) => i.medicine_name);
  const bundles = rxBundlesFor({ context: assistContext, diagnoses: diagnosisNames, onRx: onRxNames });
  const favourites = rxFavouritesFor({ context: assistContext, onRx: onRxNames });

  /** Opens the dose builder for the first medicine left to the doctor; the rest wait in the list under the entry row. */
  const leaveToDoctor = (list: readonly RxLeftOut[]) => {
    const [first, ...rest] = list;
    if (!first) return;
    onLeftOut(rest);
    entryRef.current?.prefill(first.medicine, first.allergy ? { allergy: first.allergy } : undefined);
  };

  /**
   * One tap adds the entries that have a complete usual dose and match no recorded allergy, in ONE command (stored values only); the others (an allergy
   * match, or no complete usual dose) are left to the dose builder, flagged where they match. Nothing is added without the tap.
   */
  const addEntries = async (entries: readonly RxAssistEntry[]) => {
    setListError(null);
    const direct: { entry: RxAssistEntry; line: NonNullable<ReturnType<typeof rxEntryToAdd>> }[] = [];
    const toDoctor: RxLeftOut[] = [];
    for (const entry of entries) {
      const line = rxEntryToAdd(entry);
      const flagged = entryAllergy(entry);
      if (!line || flagged) toDoctor.push({ key: `entry:${entry.name.toLowerCase()}`, medicine: rxEntryToMedicine(entry) });
      else direct.push({ entry, line });
    }
    if (direct.length > 0) {
      const sent = await rx.add(direct.map((d) => d.line));
      if (sent.ok) {
        rx.markRepeated((sent.added ?? []).map((i) => i.id));
      } else if (sent.reason === "ALLERGY_MATCH" && direct.length === 1) {
        // The database found a match the screen's rule did not (a name): the dose builder asks for the reason.
        toDoctor.push({ key: `entry:${direct[0].entry.name.toLowerCase()}`, medicine: rxEntryToMedicine(direct[0].entry), allergy: "a recorded allergy" });
      } else {
        setListError(sent.error ?? "Failed to add the medicines.");
        return;
      }
    }
    if (toDoctor.length > 0) leaveToDoctor(toDoctor);
  };

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
    else rx.touch(item.id);
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
    if (sent.ok) {
      rx.touch(item.id);
      setEditing(null);
    }
    else setEditing({ ...editing, error: sent.error ?? "Failed to update the medicine." });
  };

  const removeItem = async (item: PrescriptionItem) => {
    setListError(null);
    const sent = await rx.remove([item.id]);
    if (!sent.ok) {
      setListError(sent.error ?? "Failed to remove the medicine.");
      return;
    }
    rx.touch(item.id);
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
    if (!lastVisit) return;
    setRepeating(true);
    setListError(null);
    try {
      const sent = await onRepeat(lastVisit.visitId, lastVisit.parts);
      if (!sent.ok) setListError(sent.error ?? "Failed to repeat the last visit.");
    } finally {
      setRepeating(false);
    }
  };

  const showAssist = !readOnly && (Boolean(lastVisit) || bundles.length > 0 || favourites.length > 0);

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
          handleRef={entryRef}
        />
      )}
      {!readOnly && leftOut.length > 0 && (
        <ul data-rx-left-out="" aria-label="Medicines left for you to decide" className="flex flex-col gap-1.5">
          {leftOut.map((l) => (
            <li key={l.key} className="flex flex-wrap items-center gap-2 rounded-md bg-danger-bg px-3 py-1.5 text-label text-danger-fg">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{l.medicine.name}</span> was not added: it may match a recorded allergy.
              </span>
              <Button type="button" size="sm" variant="danger-quiet" onClick={() => leaveToDoctor([l])}>
                Review {l.medicine.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {showAssist && (
        <div data-rx-assist="" className="flex flex-col gap-3">
          {lastVisit && (
            <div>
              <Button type="button" variant="secondary" size="sm" startIcon={<RotateCcw />} loading={repeating} onClick={() => void repeatLast()}>
                Same as last visit · {lastVisit.dateLabel}
              </Button>
            </div>
          )}
          {bundles.length > 0 && (
            <div data-rx-bundles="">
              <p className="mb-2 flex flex-wrap items-center gap-x-2 text-label font-semibold text-fg-secondary">
                Your usual
                <SmartAssistLabel />
              </p>
              <ChipGroup
                type="multiple"
                variant="tile"
                aria-label="Your usual prescriptions"
                value={[]}
                onValueChange={(next) => {
                  const bundle = bundles.find((b) => b.diagnosis === next[next.length - 1]);
                  if (bundle) void addEntries(bundle.entries);
                }}
                items={bundles.map((b) => ({
                  value: b.diagnosis,
                  label: `Your usual for ${b.diagnosis}`,
                  meta: b.entries.length,
                  "aria-label": `Your usual for ${b.diagnosis}: ${b.entries.map((e) => e.name).join(", ")}`,
                }))}
              />
            </div>
          )}
          {favourites.length > 0 && (
            <div data-rx-favourites="">
              <p className="mb-2 flex flex-wrap items-center gap-x-2 text-label font-semibold text-fg-secondary">
                Your favourites
                {bundles.length === 0 && <SmartAssistLabel />}
              </p>
              <ChipGroup
                type="multiple"
                variant="tile"
                aria-label="Your favourite medicines"
                value={[]}
                onValueChange={(next) => {
                  const entry = favourites.find((f) => f.name === next[next.length - 1]);
                  if (entry) void addEntries([entry]);
                }}
                items={favourites.map((f) => ({
                  value: f.name,
                  label: f.name,
                  meta: f.usual ? [f.usual.dosage, f.usual.duration].filter(Boolean).join(" · ") : undefined,
                }))}
              />
            </div>
          )}
        </div>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
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
                repeated={rx.repeated.has(item.id)}
                allergyMatch={readOnly ? null : unresolved}
                onOverride={(reason) => void confirmWithReason(item, reason)}
                onEdit={() => {
                  rx.touch(item.id);
                  setEditing({ id: item.id, draft: draftOf(item), error: null });
                }}
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
        <RxTemplatesSheet
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
          items={rx.items}
          specialty={specialty}
          diagnoses={diagnosisNames}
          onApply={async (lines) => {
            const sent = await rx.add(lines);
            if (sent.ok) rx.markRepeated((sent.added ?? []).map((i) => i.id));
            return sent;
          }}
        />
      )}
    </div>
  );
}
