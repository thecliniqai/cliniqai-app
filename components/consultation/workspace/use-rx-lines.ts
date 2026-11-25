"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { changePrescriptionAction, getVisitPrescription, repeatVisitPlanAction } from "@/features/prescriptions/actions";
import type { ConsultationDiagnosisItem } from "@/features/terminology/schema";
import {
  changesKey,
  itemFromAdd,
  type ChangeLine,
  type ChangeUpdate,
  type PrescriptionChanges,
} from "@/features/prescriptions/lines";
import type { PrescriptionItem } from "@/lib/db/types";
import { overlay, type Op } from "@/features/prescriptions/rx-overlay";
import { isOutcomeUnknownCode, OUTCOME_UNKNOWN_MESSAGE, useCommand } from "@/lib/commands/use-command";
import { reportClientError } from "@/lib/log/client";
import { rum } from "@/lib/observability/rum/collector";

/**
 * The visit's prescription lines and the one way they change (V2-09c 09C-01, R-2, R-5; ADR-004, PWA-06a). Every change (add, edit, remove, a template, a
 * repeat) is ONE `change_prescription` command: the lines are the server's answer applied to local state, never a guess.
 *
 * - One request id per logical send: the same changes sent again after a failure keep the same id (a lost response may hide a commit, the command replays
 *   its first result), other changes start a new one (`changesKey`). After a failure whose outcome is unknown (a timeout, a lost response) the id is kept
 *   until the answer is known, whatever the doctor edits meanwhile (`useCommand`: 15 s timeout, one retry with the same id).
 * - Sends run one after the other: Next runs server actions through one queue anyway, and `useCommand` hands a second `run` the first one's answer, so a
 *   remove sent while an add is on its way waits for it.
 * - Rx lines are row-level writes outside the draft's `draft_version` (09B R-2): they never conflict with the draft saver.
 * - 09C-06a (A-1): an outcome-unknown failure (a timeout, a lost response) is reconciled at once: the visit's lines are read again (a server action, so it
 *   runs after the stalled request in Next's one action queue) and replace the local list, then the request id is settled. If the change is in the list it
 *   landed and the send answers ok; otherwise it did not, and the doctor sees the stored list with a plain message. A line the database holds is never
 *   missing from the screen. `reconcile()` and `whenIdle()` let Finish wait for the queue and read the lines before the review (A-11).
 * - 09C-06a (A-12): `announcement` is a polite live-region text for adds and removes.
 * - 09E-08 (R-11, reversible class): a change shows at once. `items` is the database's list (`confirmed`) with the changes still on their way laid over it
 *   (`ops`, in the order they were made): an added line appears with a pending marker (`pending`), an edit shows its new dose, a removed line is gone. The
 *   answer replaces the overlay with the database's list; a refusal or a failure takes the overlay back (the previous list returns) and the caller shows
 *   the fixed error with Retry. Nothing here re-reads: no allergy context, no page.
 */
export interface RxSendResult {
  ok: boolean;
  /** A fixed, data-free text when `ok` is false. */
  error?: string;
  /** The `AppError` code and reason of a refusal (the entry row opens the allergy reason on `ALLERGY_MATCH`). */
  code?: string;
  reason?: string;
  /** The items the send added, in the order they were sent. */
  added?: PrescriptionItem[];
}

/** The answer of "Same as last visit" (V2-09c R-10): what the database copied and what it left for the doctor. */
export interface RepeatSendResult extends RxSendResult {
  /** The source lines left out because they match a recorded allergy (stored values; the screen opens each in the dose builder). */
  skipped?: PrescriptionItem[];
  /** The visit's diagnoses after the copy, when the diagnoses were part of it. */
  diagnoses?: ConsultationDiagnosisItem[];
  diagnosesAdded?: number;
}

export type RepeatPart = "diagnoses" | "prescription";

export interface UseRxLines {
  /** The lines as shown: the database's list with the changes still on their way laid over it. */
  items: PrescriptionItem[];
  /** Ids of lines whose change has not been answered yet (an added line, an edited one): shown with a "Saving" marker and not editable. */
  pending: ReadonlySet<string>;
  /** What the allergy check needs of a line this session added or confirmed: its catalogue substance ids and the reason it was prescribed despite a match. */
  allergyNote(id: string): { substanceIds: readonly string[]; reason: string | null } | undefined;
  /** The doctor confirmed a flagged line with a reason (the screen's allergy picture follows without a re-read). */
  noteOverride(id: string, reason: string): void;
  /** True while a command is in flight or queued. */
  busy: boolean;
  /** The last add or remove in words, for a polite live region ("Paracetamol 650 added"). A trailing space alternates so a repeat is announced again. */
  announcement: string;
  announce(text: string): void;
  /** Reads the visit's lines again and shows them (true when the read succeeded). */
  reconcile(): Promise<boolean>;
  /** Resolves when every queued or in-flight command has answered. */
  whenIdle(): Promise<void>;
  /**
   * The ids of lines put in by a tile, a template or a repeat that the doctor has not touched yet: the "Repeated" marker stays until they edit, confirm
   * or remove the line (session state; nothing is stored).
   */
  repeated: ReadonlySet<string>;
  markRepeated(ids: readonly string[]): void;
  touch(id: string): void;
  /** "Same as last visit": one `repeat_visit_plan` command; the lines shown become the database's. */
  repeat(sourceVisitId: string, parts: readonly RepeatPart[]): Promise<RepeatSendResult>;
  /** `unique`: lines whose medicine is already on the Rx when the command starts are left out (a double tap adds once, A-4). */
  add(lines: ChangeLine[], allergyReason?: string, opts?: { unique?: boolean; substanceIds?: ReadonlyArray<readonly string[]> }): Promise<RxSendResult>;
  update(updates: ChangeUpdate[]): Promise<RxSendResult>;
  remove(ids: string[]): Promise<RxSendResult>;
  /** Several kinds in one command (a template apply, an Undo). */
  send(changes: PrescriptionChanges, opts?: { unique?: boolean; substanceIds?: ReadonlyArray<readonly string[]> }): Promise<RxSendResult>;
}

/** Text of an outcome-unknown failure once the lines were read again and the change is not among them. */
export const RX_NOT_SAVED_TEXT = "The change was not saved. The list shows what is saved; try again.";
/** Text when the lines could not be read again after "Same as last visit" or an unknown outcome: the list on screen is kept. */
export const RX_READ_FAILED_TEXT = "Could not read the prescription again. Reload the page before you finish the visit.";

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const nullable = (s: string | null | undefined) => (s ?? "").trim() || null;

/** Whether the lines read back show the change: every add is there (in order, by name), every removed id is gone, every update holds its values. */
function landed(changes: PrescriptionChanges, before: readonly PrescriptionItem[], read: readonly PrescriptionItem[]): PrescriptionItem[] | null {
  const had = new Set(before.map((i) => i.id));
  const fresh = read.filter((i) => !had.has(i.id));
  const adds = changes.add ?? [];
  if (fresh.length !== adds.length || adds.some((a, k) => norm(fresh[k]?.medicine_name) !== norm(a.medicine_name))) return null;
  if ((changes.remove ?? []).some((id) => read.some((i) => i.id === id))) return null;
  for (const u of changes.update ?? []) {
    const item = read.find((i) => i.id === u.id);
    if (!item) return null;
    if (u.dosage !== undefined && norm(item.dosage) !== norm(u.dosage)) return null;
    if (u.duration !== undefined && norm(item.duration) !== norm(u.duration)) return null;
    if (u.timing !== undefined && nullable(item.timing) !== nullable(u.timing)) return null;
    if (u.special_instructions !== undefined && nullable(item.special_instructions) !== nullable(u.special_instructions)) return null;
  }
  return fresh;
}

function addedText(added: readonly PrescriptionItem[]): string {
  if (added.length === 1) return `${added[0].medicine_name} added${added[0].duration ? `, ${added[0].duration}` : ""}`;
  return `${added.length} medicines added`;
}

export function useRxLines({
  visitId,
  initialItems,
  onItemsChange,
  onAdded,
}: {
  visitId: string;
  initialItems: PrescriptionItem[];
  onItemsChange?: (items: PrescriptionItem[]) => void;
  /** The lines the database accepted (a custom medicine joins the doctor's own list: 09C R-2, mirrored in the consult's query). */
  onAdded?: (lines: readonly ChangeLine[]) => void;
}): UseRxLines {
  const command = useCommand();
  const [confirmed, setConfirmed] = useState<PrescriptionItem[]>(initialItems);
  const [ops, setOps] = useState<Op[]>([]);
  const { items, pending } = useMemo(() => overlay(confirmed, ops), [confirmed, ops]);
  // The changes on their way, kept in step with `ops` synchronously: a second tap decides "is this medicine already on the list" against these, not against
  // the last render (an effect would be one commit late, and a refused first tap's line would still count).
  const opsNow = useRef<Op[]>([]);
  const updateOps = useCallback((change: (prev: Op[]) => Op[]) => {
    opsNow.current = change(opsNow.current);
    setOps(opsNow.current);
  }, []);
  const opSeq = useRef(0);
  const [notes, setNotes] = useState<ReadonlyMap<string, { substanceIds: readonly string[]; reason: string | null }>>(new Map());
  const current = useRef<PrescriptionItem[]>(initialItems);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const lastKey = useRef<string | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [repeated, setRepeated] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((text: string) => setAnnouncement((prev) => (prev === text ? `${text} ` : text)), []);

  /** The visit's lines as the database holds them, or null when the read failed. */
  const readLines = useCallback(async (): Promise<PrescriptionItem[] | null> => {
    try {
      const res = await getVisitPrescription(visitId);
      if (!res.success) return null;
      return [...(res.prescription?.items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    } catch {
      return null;
    }
  }, [visitId]);

  const commit = useCallback(
    (next: PrescriptionItem[]) => {
      current.current = next;
      setConfirmed(next);
      onItemsChange?.(next);
    },
    [onItemsChange],
  );

  /** A failed command as the doctor sees it: a definite refusal starts a new request next time, an unknown outcome keeps the id (an idempotent retry). */
  const failure = useCallback(
    (error: { code: string; message: string; reason?: string }, event: `${string}.${string}`): RxSendResult => {
      if (error.code !== "DEPENDENCY_FAILED" && error.code !== "INTERNAL") {
        lastKey.current = null;
      } else {
        reportClientError(event, new Error(error.code));
      }
      const unknown = isOutcomeUnknownCode(error.code);
      return {
        ok: false,
        error: unknown ? `${error.message} ${OUTCOME_UNKNOWN_MESSAGE}`.trim() : error.message,
        code: error.code,
        reason: error.reason,
      };
    },
    [],
  );

  const queue = useCallback((run: () => Promise<RxSendResult>): Promise<RxSendResult> => {
    // One command at a time: this one starts when the previous one has answered.
    setInFlight((n) => n + 1);
    const queued = chain.current.then(run, run);
    const settled = queued.finally(() => setInFlight((n) => Math.max(0, n - 1)));
    chain.current = settled.catch(() => undefined);
    return settled;
  }, []);

  const markRepeated = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setRepeated((prev) => new Set([...prev, ...ids]));
  }, []);
  const touch = useCallback((id: string) => {
    setRepeated((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const repeat = useCallback(
    (sourceVisitId: string, parts: readonly RepeatPart[]): Promise<RepeatSendResult> => {
      const run = async (): Promise<RepeatSendResult> => {
        const key = JSON.stringify(["repeat", visitId, sourceVisitId, [...parts].sort()]);
        if (lastKey.current !== key) command.reset();
        lastKey.current = key;
        const result = await command.run((clientRequestId) =>
          repeatVisitPlanAction({ visit_id: visitId, source_visit_id: sourceVisitId, parts: [...parts], client_request_id: clientRequestId }),
        );
        if (!result.ok) {
          const failed = failure(result.error, "prescriptions.repeat.failed");
          if (!isOutcomeUnknownCode(result.error.code)) return failed;
          // A-1: the copy may have committed. The lines shown become the database's; the doctor checks the diagnoses after a reload.
          const read = await readLines();
          if (!read) return failed;
          command.settle();
          lastKey.current = null;
          commit(read);
          return { ok: false, error: "Same as last visit may have been copied. The list shows what is saved; check the diagnoses after a reload." };
        }
        lastKey.current = null;
        const value = result.value;
        // A-2: a failed read after the copy is never taken as an empty list. The lines are read once more; if that fails too, the list on screen stays.
        const items = value.items ?? (await readLines());
        if (items) commit(items);
        const added = (items ?? []).filter((i) => value.addedItemIds.includes(i.id));
        if (added.length > 0) announce(addedText(added));
        return {
          ok: items !== null,
          ...(items === null ? { error: RX_READ_FAILED_TEXT } : {}),
          added,
          skipped: value.skippedItems,
          diagnoses: parts.includes("diagnoses") && value.diagnoses ? value.diagnoses : undefined,
          diagnosesAdded: value.diagnosesAdded,
        };
      };
      return queue(run);
    },
    [announce, command, commit, failure, queue, readLines, visitId],
  );

  const announceAdded = useCallback((list: readonly PrescriptionItem[]) => announce(addedText(list)), [announce]);

  const send = useCallback(
    (requested: PrescriptionChanges, opts?: { unique?: boolean; substanceIds?: ReadonlyArray<readonly string[]> }): Promise<RxSendResult> => {
      let asked = requested;
      if (opts?.unique && asked.add?.length) {
        // A-4: a second tap on the same medicine adds nothing; decided against the lines as shown (the first tap's pending line counts).
        const on = new Set(overlay(current.current, opsNow.current).items.map((i) => norm(i.medicine_name)));
        const add = asked.add.filter((l) => !on.has(norm(l.medicine_name)));
        if (add.length === 0 && !asked.update?.length && !asked.remove?.length) return Promise.resolve({ ok: true, added: [] });
        asked = { ...asked, add };
      }
      // Shown at once (R-11): the change is laid over the lines, with a pending marker, before it is sent.
      const opId = ++opSeq.current;
      const ids = (asked.add ?? []).map((_, k) => `pending:${opId}:${k}`);
      updateOps((prev) => [...prev, { opId, changes: asked, ids }]);
      const dropOp = () => updateOps((prev) => prev.filter((o) => o.opId !== opId));

      const run = async (): Promise<RxSendResult> => {
        let changes = asked;
        if (opts?.unique && changes.add?.length) {
          // A-4: decided again when the command starts, against the database's lines (a queued second tap sees the first one's).
          const on = new Set(current.current.map((i) => norm(i.medicine_name)));
          const add = changes.add.filter((l) => !on.has(norm(l.medicine_name)));
          if (add.length === 0 && !changes.update?.length && !changes.remove?.length) {
            dropOp();
            return { ok: true, added: [] };
          }
          changes = { ...changes, add };
        }
        const before = current.current;
        const key = changesKey(visitId, changes);
        // Other changes than the last failed send's are a new request; the same ones keep their id (an idempotent retry).
        if (lastKey.current !== key) command.reset();
        lastKey.current = key;
        const stop = rum.timer("save_reversible");
        // The pending line is on screen: the next frame is the first the doctor sees it in (the timing of a reversible save is the result shown).
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => stop());
        else stop();
        const result = await command.run((clientRequestId) =>
          changePrescriptionAction({ visit_id: visitId, changes, client_request_id: clientRequestId }),
        );
        if (!result.ok) {
          const failed = failure(result.error, "prescriptions.change.failed");
          if (!isOutcomeUnknownCode(result.error.code)) {
            dropOp();
            return failed;
          }
          // A-1: the outcome is unknown. Read the lines (after the stalled request, in the action queue), show them, and settle the request id.
          const read = await readLines();
          if (!read) {
            dropOp();
            return failed;
          }
          command.settle();
          lastKey.current = null;
          commit(read);
          dropOp();
          const fresh = landed(changes, before, read);
          if (fresh) {
            if (fresh.length > 0) announceAdded(fresh);
            return { ok: true, added: fresh };
          }
          return { ok: false, error: RX_NOT_SAVED_TEXT, code: result.error.code };
        }
        lastKey.current = null;
        const { prescriptionId, addedItemIds } = result.value;
        let next = current.current;
        if (changes.remove?.length) next = next.filter((i) => !changes.remove!.includes(i.id));
        if (changes.update?.length) {
          next = next.map((i) => {
            const u = changes.update!.find((x) => x.id === i.id);
            if (!u) return i;
            return {
              ...i,
              dosage: u.dosage ?? i.dosage,
              timing: u.timing === undefined ? i.timing : u.timing?.trim() || null,
              duration: u.duration ?? i.duration,
              special_instructions: u.special_instructions === undefined ? i.special_instructions : u.special_instructions?.trim() || null,
            };
          });
        }
        const added: PrescriptionItem[] = [];
        if (changes.add?.length) {
          let sort = next.reduce((max, i) => Math.max(max, i.sort_order), -1) + 1;
          changes.add.forEach((line, index) => {
            const id = addedItemIds[index];
            if (!id) return;
            added.push(itemFromAdd(line, id, prescriptionId, sort++));
          });
          next = [...next, ...added];
        }
        if (added.length > 0 || changes.allergy_override_reason) {
          setNotes((prev) => {
            const map = new Map(prev);
            added.forEach((item, index) => {
              const originalIndex = asked.add?.indexOf(changes.add![index]) ?? index;
              map.set(item.id, { substanceIds: (originalIndex >= 0 ? opts?.substanceIds?.[originalIndex] : undefined) ?? [], reason: changes.allergy_override_reason ?? null });
            });
            return map;
          });
        }
        commit(next);
        dropOp();
        if (changes.add?.length) onAdded?.(changes.add);
        if (added.length > 0) announceAdded(added);
        else if (changes.remove?.length) {
          const gone = before.filter((i) => changes.remove!.includes(i.id));
          announce(gone.length === 1 ? `${gone[0].medicine_name} removed` : `${gone.length} medicines removed`);
        }
        return { ok: true, added };
      };
      return queue(run);
    },
    [announce, announceAdded, command, commit, failure, onAdded, queue, readLines, updateOps, visitId],
  );

  const reconcile = useCallback(async (): Promise<boolean> => {
    const read = await readLines();
    if (!read) return false;
    commit(read);
    return true;
  }, [commit, readLines]);

  const whenIdle = useCallback(() => chain.current.then(() => undefined), []);

  const allergyNote = useCallback((id: string) => notes.get(id), [notes]);
  const noteOverride = useCallback((id: string, reason: string) => {
    setNotes((prev) => {
      const map = new Map(prev);
      map.set(id, { substanceIds: prev.get(id)?.substanceIds ?? [], reason });
      return map;
    });
  }, []);

  return {
    items,
    pending,
    allergyNote,
    noteOverride,
    busy: inFlight > 0,
    announcement,
    announce,
    reconcile,
    whenIdle,
    repeated,
    markRepeated,
    touch,
    repeat,
    add: (lines, allergyReason, opts) => send({ add: lines, ...(allergyReason ? { allergy_override_reason: allergyReason } : {}) }, opts),
    update: (updates) => send({ update: updates }),
    remove: (ids) => send({ remove: ids }),
    send,
  };
}
