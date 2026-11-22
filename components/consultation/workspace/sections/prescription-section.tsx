"use client";

import { useState, type RefObject } from "react";
import { BookOpen, RotateCcw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { DoseBuilder, RxEntryRow, type DoseDraft, type RxAddResult, type RxEntryHandle } from "@/components/clinical/rx-entry-row";
import { RxLineItem } from "@/components/clinical/rx-line-item";
import { SmartAssistLabel } from "@/components/clinical/smart-assist-label";
import { fetchMedicines } from "@/features/prescriptions/search";
import { itemToAdd, itemToLine, lineToAdd, lineToUpdate, pastItemToMedicine, rxEntryToAdd, rxEntryToMedicine, type ChangeLine } from "@/features/prescriptions/lines";
import { rxBundlesFor, rxFavouritesFor, type AssistContext, type RxAssistEntry } from "@/features/consultation/assist-ranking";
import type { PrescriptionItem } from "@/lib/db/types";
import { lineDuration, MAX_DAYS, MIN_DAYS, type Medicine, type RxLine } from "@/lib/clinical/rx";
import { cn } from "@/lib/utils";
import { CHIP_DISABLED, CHIP_INTERACTIVE, CHIP_ITEM, FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
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
 *
 * 09C-06a: a role without `prescriptions:edit` gets the lines as text (no entry row, no tiles, no Templates), and one without `prescriptions:view` is told
 * the prescription is the doctor's instead of "No medicines yet" (RLS hides the lines from it, A-5). A template, a tile and Undo add per line: the safe lines
 * are added and a line that matches a recorded allergy is left to the dose builder, flagged (A-3). A tile is a plain button, disabled while a command runs,
 * and a line already on the Rx is not added twice (A-4). Adds and removes are announced in a polite live region (A-12).
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
  /** The signed-in role holds `prescriptions:edit` (A-5): without it the lines are text, with no entry row, tiles or Templates. */
  canEdit?: boolean;
  /** The signed-in role holds `prescriptions:view` (A-5): without it RLS hides the lines, and the section says so instead of "No medicines yet". */
  canView?: boolean;
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
/** A-5: what a role that may not read prescriptions sees in place of the lines. */
export const RX_HIDDEN_TEXT = "The prescription is written by the doctor. It is not shown to your role.";
/** The notice of a line the database (not the screen's own rule) found matching an allergy: it returns that a match exists, not which. */
const DB_MATCH_TEXT = "a recorded allergy (see the allergy strip)";
const TILE_CLASS = cn(CHIP_ITEM.tile, TRANSITION, FOCUS_RING);

/** A line on its way in from a tile, a template or Undo (A-3): what to send, the medicine for the dose builder, and the screen's own match, if any. */
interface Candidate {
  key: string;
  line: ChangeLine | null;
  medicine: Medicine;
  flagged: string | null;
}

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
  canEdit = true,
  canView = true,
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
  // A-5: an editable record AND a role that may write prescriptions.
  const editable = !readOnly && canEdit;

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
   * A-3: adds the lines that the screen's rule does not flag in ONE command (a medicine already on the Rx is not added again, A-4). When the database finds
   * a match the screen did not, each line is sent alone so the safe ones still go in. Every flagged or refused line is left to the dose builder, flagged
   * ("Prescribe anyway…"); nothing is dropped silently. `reason` (Undo) is sent with the lines.
   */
  const addPerLine = async (candidates: readonly Candidate[], reason?: string): Promise<{ ok: boolean; error?: string; added: PrescriptionItem[]; left: RxLeftOut[] }> => {
    const left: RxLeftOut[] = [];
    const safe: { c: Candidate; line: ChangeLine }[] = [];
    for (const c of candidates) {
      if (!c.line || c.flagged) left.push({ key: c.key, medicine: c.medicine, ...(c.flagged ? { allergy: c.flagged } : {}) });
      else safe.push({ c, line: c.line });
    }
    const added: PrescriptionItem[] = [];
    if (safe.length > 0) {
      const sent = await rx.add(safe.map((s) => s.line), reason, { unique: true });
      if (sent.ok) {
        added.push(...(sent.added ?? []));
      } else if (sent.reason === "ALLERGY_MATCH") {
        for (const s of safe) {
          const one = await rx.add([s.line], reason, { unique: true });
          if (one.ok) added.push(...(one.added ?? []));
          else if (one.reason === "ALLERGY_MATCH") left.push({ key: s.c.key, medicine: s.c.medicine, allergy: DB_MATCH_TEXT });
          else return { ok: false, error: one.error, added, left };
        }
      } else {
        return { ok: false, error: sent.error, added, left };
      }
    }
    return { ok: true, added, left };
  };

  /** After a per-line add: the added lines carry the "Repeated" marker, the left ones go to the dose builder, and the live region says what happened. */
  const settleAdd = (result: { added: PrescriptionItem[]; left: RxLeftOut[] }) => {
    rx.markRepeated(result.added.map((i) => i.id));
    if (result.left.length > 0) {
      const names = result.left.map((l) => l.medicine.name).join(", ");
      rx.announce(`${result.added.length} added, ${names} left for you to decide`);
      leaveToDoctor(result.left);
    }
  };

  /**
   * One tap adds the entries that have a complete usual dose and match no recorded allergy (stored values only); the others (an allergy match, or no
   * complete usual dose) are left to the dose builder, flagged where they match. Nothing is added without the tap.
   */
  const addEntries = async (entries: readonly RxAssistEntry[]) => {
    setListError(null);
    const result = await addPerLine(
      entries.map((entry) => ({ key: `entry:${entry.name.toLowerCase()}`, line: rxEntryToAdd(entry), medicine: rxEntryToMedicine(entry), flagged: entryAllergy(entry) })),
    );
    if (!result.ok) setListError(result.error ?? "Failed to add the medicines.");
    settleAdd(result);
  };

  /** A template's lines (A-3): per line, as a tile's. */
  const applyTemplate = async (lines: readonly ChangeLine[]) => {
    const result = await addPerLine(
      lines.map((line, k) => {
        const medicine = pastItemToMedicine(line);
        return { key: `template:${k}:${line.medicine_name.toLowerCase()}`, line, medicine, flagged: allergyOf ? allergyOf(medicine) : null };
      }),
    );
    settleAdd(result);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
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
    // A-3: Undo puts the line back with the reason it was prescribed despite an allergy (the override is kept); a line that now matches goes to the builder.
    const overrideReason = allergy?.items[item.id]?.overrideReason ?? undefined;
    notify.info(`${item.medicine_name} removed`, {
      undo: () => {
        void addPerLine([{ key: `undo:${item.id}`, line: itemToAdd(item), medicine: pastItemToMedicine(item), flagged: null }], overrideReason).then((again) => {
          if (!again.ok) notify.error(again.error ?? "Could not put the medicine back.");
          else settleAdd(again);
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

  const showAssist = editable && (Boolean(lastVisit) || bundles.length > 0 || favourites.length > 0);

  return (
    <div data-rx-section="" className="flex flex-col gap-3">
      {editable && checking && allergy?.state === "not_recorded" && (
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
      {editable && (
        <RxEntryRow
          label="Medicine"
          allergyOf={allergyOf}
          search={(query, signal) => fetchMedicines(query, signal)}
          onAdd={addLine}
          handleRef={entryRef}
        />
      )}
      {editable && leftOut.length > 0 && (
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
              <ul aria-label="Your usual prescriptions" className="flex flex-wrap items-center gap-1.5">
                {bundles.map((b) => (
                  <li key={b.diagnosis}>
                    <button
                      type="button"
                      disabled={rx.busy}
                      aria-label={`Your usual for ${b.diagnosis}: ${b.entries.map((e) => e.name).join(", ")}`}
                      onClick={() => void addEntries(b.entries)}
                      className={cn(TILE_CLASS, rx.busy ? CHIP_DISABLED : CHIP_INTERACTIVE.tile)}
                    >
                      <span>{`Your usual for ${b.diagnosis}`}</span>
                      <small className="text-caption font-normal tabular-nums text-fg-muted">{b.entries.length}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {favourites.length > 0 && (
            <div data-rx-favourites="">
              <p className="mb-2 flex flex-wrap items-center gap-x-2 text-label font-semibold text-fg-secondary">
                Your favourites
                {bundles.length === 0 && <SmartAssistLabel />}
              </p>
              <ul aria-label="Your favourite medicines" className="flex flex-wrap items-center gap-1.5">
                {favourites.map((f) => {
                  const meta = f.usual ? [f.usual.dosage, f.usual.duration].filter(Boolean).join(" · ") : "";
                  return (
                    <li key={f.name}>
                      <button
                        type="button"
                        disabled={rx.busy}
                        onClick={() => void addEntries([f])}
                        className={cn(TILE_CLASS, rx.busy ? CHIP_DISABLED : CHIP_INTERACTIVE.tile)}
                      >
                        <span>{f.name}</span>
                        {meta && <small className="text-caption font-normal tabular-nums text-fg-muted">{meta}</small>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" startIcon={<BookOpen />} onClick={() => setTemplatesOpen(true)}>
            Templates
          </Button>
        </div>
      )}
      {listError && <Alert tone="danger">{listError}</Alert>}
      {rx.items.length === 0 ? (
        <p data-rx-empty="" className="rounded-lg border border-dashed border-border p-6 text-center text-body-sm text-fg-muted">
          {!canView ? RX_HIDDEN_TEXT : editable ? RX_EMPTY_TEXT : "No medicines were prescribed."}
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
                lineId={item.id}
                index={index + 1}
                line={line}
                readOnly={!editable}
                note={note}
                repeated={rx.repeated.has(item.id)}
                allergyMatch={editable ? unresolved : null}
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
      {editable && (
        <RxTemplatesSheet
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
          items={rx.items}
          specialty={specialty}
          diagnoses={diagnosisNames}
          onApply={applyTemplate}
        />
      )}
    </div>
  );
}
