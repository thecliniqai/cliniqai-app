/**
 * V2-09c 09C-01 (R-2, R-4, R-5): the pure mapping of the Rx lines (`features/prescriptions/lines.ts`): stored item <-> builder line <-> command payload.
 * No database. Every case is a row of the tables below.
 */
import { describe, expect, it } from "vitest";
import {
  changesKey,
  daysToDuration,
  durationToDays,
  itemToAdd,
  itemToLine,
  lineComplete,
  lineToAdd,
  lineToUpdate,
  medicineFromSearch,
  templateItemToAdd,
} from "@/features/prescriptions/lines";
import type { PrescriptionItem } from "@/lib/db/types";
import type { RxLine } from "@/lib/clinical/rx";

const item = (over: Partial<PrescriptionItem> = {}): PrescriptionItem => ({
  id: "00000000-0000-4000-8000-0000000000a1",
  prescription_id: "00000000-0000-4000-8000-0000000000b1",
  medicine_name: "Synthetic Tab 500",
  generic_name: "Synthetol",
  dose_form: "Tablet",
  dosage: "1-0-1",
  timing: "After food",
  duration: "5 days",
  special_instructions: null,
  cdci_brand_id: "test-cdci-1",
  cdci_generic_id: null,
  sort_order: 0,
  created_at: "2031-01-15T10:00:00Z",
  ...over,
});

describe("durationToDays", () => {
  it.each([
    ["5 days", 5],
    ["1 day", 1],
    ["1 week", 7],
    ["2 weeks", 14],
    ["1 month", 30],
    ["3 months", 90],
    ["5d", 5],
    ["2w", 14],
    ["1m", 30],
    ["  10 DAYS ", 10],
    ["Continue", null],
    ["Till review", null],
    ["x 3 weeks then stop", null],
    ["", null],
    ["0 days", null],
    ["400 days", null],
    ["5", null],
  ])("%j -> %j", (text, days) => {
    expect(durationToDays(text)).toBe(days);
  });
  it("null and undefined are none", () => {
    expect(durationToDays(null)).toBeNull();
    expect(durationToDays(undefined)).toBeNull();
  });
});

describe("daysToDuration", () => {
  it.each([
    [1, "1 day"],
    [5, "5 days"],
    [7, "7 days"],
    [30, "30 days"],
  ])("%j -> %j (days stay days: the count printed is the count chosen)", (days, text) => {
    expect(daysToDuration(days)).toBe(text);
  });
});

describe("itemToLine and lineToAdd", () => {
  it("a stored item becomes a builder line and back to the same add line", () => {
    const stored = item();
    const line = itemToLine(stored);
    expect(line).toMatchObject({ frequency: "1-0-1", timing: "After food", days: 5 });
    expect(line.durationText).toBeUndefined();
    expect(line.medicine).toMatchObject({ id: "test-cdci-1", name: "Synthetic Tab 500", form: "Tablet", generic: "Synthetol", kind: "cdci" });
    expect(lineToAdd(line)).toEqual(itemToAdd(stored));
  });
  it("a null timing stays null: no 'After food' is invented", () => {
    const line = itemToLine(item({ timing: null }));
    expect(line.timing).toBe("");
    expect(lineToAdd(line).timing).toBeNull();
  });
  it("a duration the days cannot express keeps its text through a round trip", () => {
    const line = itemToLine(item({ duration: "Continue" }));
    expect(line).toMatchObject({ days: 0, durationText: "Continue" });
    expect(lineToAdd(line).duration).toBe("Continue");
    expect(lineComplete(line)).toBe(true);
  });
  it("a week is read as 7 days and written back as days", () => {
    const line = itemToLine(item({ duration: "1 week" }));
    expect(line.days).toBe(7);
    expect(lineToAdd(line).duration).toBe("7 days");
  });
  it("a custom line has no brand id and no 'Custom' form is stored", () => {
    const line: RxLine = {
      medicine: { id: "custom:augmentin 625", name: "Augmentin 625", form: "Custom", generic: "Augmentin 625" },
      frequency: "1-0-1",
      timing: "",
      days: 3,
      instruction: "  with warm water ",
    };
    expect(lineToAdd(line)).toEqual({
      medicine_name: "Augmentin 625",
      generic_name: null,
      dose_form: null,
      dosage: "1-0-1",
      timing: null,
      duration: "3 days",
      special_instructions: "with warm water",
      cdci_brand_id: null,
    });
  });
});

describe("lineComplete", () => {
  it.each([
    [{ frequency: "1-0-1", days: 5 }, true],
    [{ frequency: "SOS", days: 1 }, true],
    [{ frequency: "", days: 5 }, false],
    [{ frequency: "1-0-1", days: 0 }, false],
    [{ frequency: "1-0-1", days: 366 }, false],
    [{ frequency: "  ", days: 5 }, false],
    [{ frequency: "1-0-1", days: 0, durationText: "Continue" }, true],
  ])("%j -> %j", (line, ok) => {
    expect(lineComplete(line)).toBe(ok);
  });
});

describe("medicineFromSearch", () => {
  const base = { id: "x1", medicine_name: "Qzx", generic_name: "Qzxol", dose_form: "Tablet", substance_ids: ["S1"], dosage: null, timing: null, duration: null };
  it("a catalogue row has no usual dose (nothing is invented)", () => {
    expect(medicineFromSearch({ ...base, kind: "cdci" })).toMatchObject({ id: "x1", kind: "cdci", substanceIds: ["S1"], usual: undefined });
  });
  it("a custom row carries the doctor's stored dose, part by part", () => {
    expect(medicineFromSearch({ ...base, kind: "custom", dosage: "1-1-1", timing: "With food", duration: "7 days" }).usual).toEqual({ frequency: "1-1-1", timing: "With food", days: 7 });
    expect(medicineFromSearch({ ...base, kind: "custom", dosage: "1-0-0", timing: null, duration: "Continue" }).usual).toEqual({ frequency: "1-0-0" });
    expect(medicineFromSearch({ ...base, kind: "custom" }).usual).toBeUndefined();
  });
  it("a missing generic falls back to the name", () => {
    expect(medicineFromSearch({ ...base, kind: "cdci", generic_name: null }).generic).toBe("Qzx");
  });
});

describe("lineToUpdate", () => {
  const stored = item();
  const same = itemToLine(stored);
  it("an unchanged line is no update", () => {
    expect(lineToUpdate(stored, same)).toBeNull();
  });
  it("only the changed dose fields are sent", () => {
    expect(lineToUpdate(stored, { ...same, days: 10 })).toEqual({ id: stored.id, duration: "10 days" });
    expect(lineToUpdate(stored, { ...same, frequency: "1-0-0", timing: "" })).toEqual({ id: stored.id, dosage: "1-0-0", timing: null });
    expect(lineToUpdate(stored, { ...same, instruction: "Shake well" })).toEqual({ id: stored.id, special_instructions: "Shake well" });
  });
});

describe("templateItemToAdd", () => {
  it("keeps what the template holds and nothing else", () => {
    expect(templateItemToAdd({ medicine_name: " Tab A ", dosage: "1-0-1", duration: "5 days", timing: "", cdci_brand_id: "" })).toEqual({
      medicine_name: "Tab A",
      generic_name: null,
      dose_form: null,
      dosage: "1-0-1",
      timing: null,
      duration: "5 days",
      special_instructions: null,
      cdci_brand_id: null,
    });
  });
  it("a template line with no dose or no duration is left out, never completed", () => {
    expect(templateItemToAdd({ medicine_name: "Tab A", dosage: "1-0-1" })).toBeNull();
    expect(templateItemToAdd({ medicine_name: "Tab A", duration: "5 days" })).toBeNull();
    expect(templateItemToAdd({ dosage: "1-0-1", duration: "5 days" })).toBeNull();
  });
});

describe("changesKey", () => {
  it("the same changes keep their key (an idempotent retry); other changes have another", () => {
    const a = { add: [itemToAdd(item())] };
    expect(changesKey("v1", a)).toBe(changesKey("v1", { add: [itemToAdd(item())] }));
    expect(changesKey("v1", a)).not.toBe(changesKey("v2", a));
    expect(changesKey("v1", a)).not.toBe(changesKey("v1", { add: [itemToAdd(item({ duration: "7 days" }))] }));
  });
});
