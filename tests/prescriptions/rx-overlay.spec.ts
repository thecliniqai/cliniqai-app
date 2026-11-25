/**
 * V2-09e 09E-08 (R-11): the Rx lines as shown while changes are on their way. The database's list with every unanswered change laid over it, in order;
 * dropping a change (a refusal, a failure) gives back the previous lines.
 */
import { describe, expect, it } from "vitest";
import { overlay, type Op } from "@/features/prescriptions/rx-overlay";
import type { ChangeLine } from "@/features/prescriptions/lines";
import type { PrescriptionItem } from "@/lib/db/types";

const item = (id: string, name: string, sort: number): PrescriptionItem => ({
  id,
  prescription_id: "rx1",
  medicine_name: name,
  generic_name: null,
  dose_form: null,
  dosage: "1-0-1",
  timing: null,
  duration: "5 days",
  special_instructions: null,
  cdci_brand_id: null,
  cdci_generic_id: null,
  sort_order: sort,
  created_at: "2026-11-25T00:00:00.000Z",
});
const line = (name: string): ChangeLine => ({ medicine_name: name, generic_name: null, dose_form: null, dosage: "1-1-1", timing: null, duration: "3 days", special_instructions: null, cdci_brand_id: null });

const confirmed = [item("a", "Alpha", 0), item("b", "Beta", 1)];

describe("overlay", () => {
  it("with no change on its way the lines are the database's", () => {
    const { items, pending } = overlay(confirmed, []);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(pending.size).toBe(0);
  });

  it("an added line is on the list at once, after the others, with a pending id and the values that were sent", () => {
    const ops: Op[] = [{ opId: 1, changes: { add: [line("Gamma")] }, ids: ["pending:1:0"] }];
    const { items, pending } = overlay(confirmed, ops);
    expect(items.map((i) => i.medicine_name)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(items[2]).toMatchObject({ id: "pending:1:0", dosage: "1-1-1", duration: "3 days", sort_order: 2, prescription_id: "rx1" });
    expect([...pending]).toEqual(["pending:1:0"]);
  });

  it("an edit shows its new dose and marks the line; a removal is gone", () => {
    const ops: Op[] = [
      { opId: 1, changes: { update: [{ id: "a", duration: "10 days", timing: " after food " }] }, ids: [] },
      { opId: 2, changes: { remove: ["b"] }, ids: [] },
    ];
    const { items, pending } = overlay(confirmed, ops);
    expect(items.map((i) => i.id)).toEqual(["a"]);
    expect(items[0]).toMatchObject({ duration: "10 days", timing: "after food", dosage: "1-0-1" });
    expect([...pending]).toEqual(["a"]);
  });

  it("changes lay over each other in the order they were made, and dropping one gives back the previous lines", () => {
    const first: Op = { opId: 1, changes: { add: [line("Gamma")] }, ids: ["pending:1:0"] };
    const second: Op = { opId: 2, changes: { add: [line("Delta")] }, ids: ["pending:2:0"] };
    expect(overlay(confirmed, [first, second]).items.map((i) => i.sort_order)).toEqual([0, 1, 2, 3]);
    // The first is refused: only the second is left, after the database's lines.
    expect(overlay(confirmed, [second]).items.map((i) => i.medicine_name)).toEqual(["Alpha", "Beta", "Delta"]);
    // Both dropped: exactly the database's list again.
    expect(overlay(confirmed, []).items).toEqual(confirmed);
  });
});
