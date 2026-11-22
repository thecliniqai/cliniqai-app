"use client";

import { useCallback, useRef, useState } from "react";
import { changePrescriptionAction } from "@/features/prescriptions/actions";
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

export interface UseRxLines {
  items: PrescriptionItem[];
  /** True while a command is in flight. */
  busy: boolean;
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

  const commit = useCallback(
    (next: PrescriptionItem[]) => {
      current.current = next;
      setItems(next);
      onItemsChange?.(next);
    },
    [onItemsChange],
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
        if (!result.ok) {
          if (result.error.code !== "DEPENDENCY_FAILED" && result.error.code !== "INTERNAL") {
            // A definite refusal: nothing was written, the next send is a new request.
            lastKey.current = null;
          } else {
            reportClientError("prescriptions.change.failed", new Error(result.error.code));
          }
          const unknown = isOutcomeUnknownCode(result.error.code);
          return {
            ok: false,
            error: unknown ? `${result.error.message} ${OUTCOME_UNKNOWN_MESSAGE}`.trim() : result.error.message,
            code: result.error.code,
            reason: result.error.reason,
          };
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
        commit(next);
        return { ok: true, added };
      };
      // One command at a time: this one starts when the previous one has answered.
      setInFlight((n) => n + 1);
      const queued = chain.current.then(run, run);
      const settled = queued.finally(() => setInFlight((n) => Math.max(0, n - 1)));
      chain.current = settled.catch(() => undefined);
      return settled;
    },
    [command, commit, visitId],
  );

  return {
    items,
    busy: inFlight > 0,
    add: (lines, allergyReason) => send({ add: lines, ...(allergyReason ? { allergy_override_reason: allergyReason } : {}) }),
    update: (updates) => send({ update: updates }),
    remove: (ids) => send({ remove: ids }),
    send,
  };
}
