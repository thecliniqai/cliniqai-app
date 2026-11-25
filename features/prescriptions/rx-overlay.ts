/**
 * The Rx lines as shown while changes are on their way (V2-09e 09E-08, R-11): the database's list with every change not yet answered laid over it, in the
 * order the changes were made. Pure: no I/O, no React (`tests/prescriptions/rx-overlay.spec.ts`). An added line takes the id its change gave it
 * (`pending:<change>:<n>`) until the database answers with its own; a removed line is gone; an edited line shows its new dose. A refused or failed change
 * is simply taken out of the list of changes, and the previous lines are what is left.
 */
import type { PrescriptionItem } from "@/lib/db/types";
import { itemFromAdd, type PrescriptionChanges } from "./lines";

/** A change still on its way: what was asked, and the ids its added lines show under until the database gives their own. */
export interface Op {
  opId: number;
  changes: PrescriptionChanges;
  ids: string[];
}

/** The database's lines with the changes on their way laid over them, in the order they were made. */
export function overlay(confirmed: readonly PrescriptionItem[], ops: readonly Op[]): { items: PrescriptionItem[]; pending: Set<string> } {
  let list = [...confirmed];
  const pending = new Set<string>();
  const prescriptionId = confirmed[0]?.prescription_id ?? "pending";
  for (const op of ops) {
    const { changes } = op;
    if (changes.remove?.length) list = list.filter((i) => !changes.remove!.includes(i.id));
    if (changes.update?.length) {
      list = list.map((i) => {
        const u = changes.update!.find((x) => x.id === i.id);
        if (!u) return i;
        pending.add(i.id);
        return {
          ...i,
          dosage: u.dosage ?? i.dosage,
          timing: u.timing === undefined ? i.timing : u.timing?.trim() || null,
          duration: u.duration ?? i.duration,
          special_instructions: u.special_instructions === undefined ? i.special_instructions : u.special_instructions?.trim() || null,
        };
      });
    }
    if (changes.add?.length) {
      let sort = list.reduce((max, i) => Math.max(max, i.sort_order), -1) + 1;
      changes.add.forEach((line, k) => {
        pending.add(op.ids[k]);
        list.push(itemFromAdd(line, op.ids[k], prescriptionId, sort++));
      });
    }
  }
  return { items: list, pending };
}

