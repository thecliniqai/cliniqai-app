"use client";

import { useCallback, useRef, useState } from "react";
import { changePrescriptionAction, repeatVisitPlanAction } from "@/features/prescriptions/actions";
import type { ConsultationDiagnosisItem } from "@/features/terminology/schema";
import {
  changesKey,
  itemFromAdd,
  type ChangeLine,
  type ChangeUpdate,
  type PrescriptionChanges,
} from "@/features/prescriptions/lines";
import type { PrescriptionItem } from "@/lib/db/types";
import { isOutcomeUnknownCode, OUTCOME_UNKNOWN_MESSAGE, useCommand } from "@/lib/commands/use-command";
import { reportClientError } from "@/lib/log/client";

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
  items: PrescriptionItem[];
  /** True while a command is in flight. */
  busy: boolean;
  /**
   * The ids of lines put in by a tile, a template or a repeat that the doctor has not touched yet: the "Repeated" marker stays until they edit, confirm
   * or remove the line (session state; nothing is stored).
   */
  repeated: ReadonlySet<string>;
  markRepeated(ids: readonly string[]): void;
  touch(id: string): void;
  /** "Same as last visit": one `repeat_visit_plan` command; the lines shown become the database's. */
  repeat(sourceVisitId: string, parts: readonly RepeatPart[]): Promise<RepeatSendResult>;
  add(lines: ChangeLine[], allergyReason?: string): Promise<RxSendResult>;
  update(updates: ChangeUpdate[]): Promise<RxSendResult>;
  remove(ids: string[]): Promise<RxSendResult>;
  /** Several kinds in one command (a template apply, an Undo). */
  send(changes: PrescriptionChanges): Promise<RxSendResult>;
}

export function useRxLines({
  visitId,
  initialItems,
  onItemsChange,
}: {
  visitId: string;
  initialItems: PrescriptionItem[];
  onItemsChange?: (items: PrescriptionItem[]) => void;
}): UseRxLines {
  const command = useCommand();
  const [items, setItems] = useState<PrescriptionItem[]>(initialItems);
  const current = useRef<PrescriptionItem[]>(initialItems);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const lastKey = useRef<string | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [repeated, setRepeated] = useState<ReadonlySet<string>>(new Set());

  const commit = useCallback(
    (next: PrescriptionItem[]) => {
      current.current = next;
      setItems(next);
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
        if (!result.ok) return failure(result.error, "prescriptions.repeat.failed");
        lastKey.current = null;
        const value = result.value;
        // The database decided what was copied: the lines shown are its answer.
        commit(value.items);
        const added = value.items.filter((i) => value.addedItemIds.includes(i.id));
        return {
          ok: true,
          added,
          skipped: value.skippedItems,
          diagnoses: parts.includes("diagnoses") ? value.diagnoses : undefined,
          diagnosesAdded: value.diagnosesAdded,
        };
      };
      return queue(run);
    },
    [command, commit, failure, queue, visitId],
  );

  const send = useCallback(
    (changes: PrescriptionChanges): Promise<RxSendResult> => {
      const run = async (): Promise<RxSendResult> => {
        const key = changesKey(visitId, changes);
        // Other changes than the last failed send's are a new request; the same ones keep their id (an idempotent retry).
        if (lastKey.current !== key) command.reset();
        lastKey.current = key;
        const result = await command.run((clientRequestId) =>
          changePrescriptionAction({ visit_id: visitId, changes, client_request_id: clientRequestId }),
        );
        if (!result.ok) return failure(result.error, "prescriptions.change.failed");
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
        commit(next);
        return { ok: true, added };
      };
      return queue(run);
    },
    [command, commit, failure, queue, visitId],
  );

  return {
    items,
    busy: inFlight > 0,
    repeated,
    markRepeated,
    touch,
    repeat,
    add: (lines, allergyReason) => send({ add: lines, ...(allergyReason ? { allergy_override_reason: allergyReason } : {}) }),
    update: (updates) => send({ update: updates }),
    remove: (ids) => send({ remove: ids }),
    send,
  };
}
