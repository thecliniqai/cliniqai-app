/**
 * Prescription line vocabulary (V2-06 06-03b; DESIGN_SYSTEM §7.6): spoken frequencies, durations and the duration
 * shorthand the dose builder reads, and the medicine ranking of RxEntryRow.
 */
import { describe, expect, it } from "vitest";
import {
  FREQUENCY_PRESETS,
  clampDays,
  doseSummary,
  durationLabel,
  frequencyWords,
  parseDuration,
  searchMedicines,
  type Medicine,
} from "@/lib/clinical/rx";

describe("frequencyWords", () => {
  it("spells out every preset (screen readers would read 1-0-1 as 'one minus zero minus one')", () => {
    expect(FREQUENCY_PRESETS.map(frequencyWords)).toEqual([
      "morning 1, afternoon 0, night 1",
      "morning 1, afternoon 0, night 0",
      "morning 0, afternoon 0, night 1",
      "morning 1, afternoon 1, night 1",
      "when needed",
    ]);
  });
  it("four slots, halves, and anything else unchanged", () => {
    expect(frequencyWords("1-1-1-1")).toBe("morning 1, afternoon 1, evening 1, night 1");
    expect(frequencyWords("½-0-½")).toBe("morning half, afternoon 0, night half");
    expect(frequencyWords("sos")).toBe("when needed");
    expect(frequencyWords("Once a week")).toBe("Once a week");
    expect(frequencyWords("1-0")).toBe("1-0");
  });
});

describe("durations", () => {
  it("reads 5d, 2w, 1m and nothing else", () => {
    expect(parseDuration("5d")).toBe(5);
    expect(parseDuration("2w")).toBe(14);
    expect(parseDuration("1m")).toBe(30);
    expect(parseDuration(" 10 D ")).toBe(10);
    expect(parseDuration("3M")).toBe(90);
    for (const bad of ["5", "d", "0d", "5x", "1y", "5dd", "-5d", "1.5w", "1234d"]) expect(parseDuration(bad)).toBeNull();
  });
  it("labels and clamps", () => {
    expect(durationLabel(1)).toBe("1 day");
    expect(durationLabel(5)).toBe("5 days");
    expect([0, 1, 365, 366, 4.6].map(clampDays)).toEqual([1, 1, 365, 365, 5]);
    expect(doseSummary({ frequency: "1-0-0", timing: "After food", days: 5 })).toBe("1-0-0 · After food · 5 days");
  });
});

describe("searchMedicines", () => {
  const list: Medicine[] = [
    { id: "1", name: "Paracetamol 650 mg", form: "Tablet", generic: "Paracetamol" },
    { id: "2", name: "Cetirizine 10 mg", form: "Tablet", generic: "Cetirizine" },
    { id: "3", name: "Levocetirizine 5 mg", form: "Tablet", generic: "Levocetirizine" },
    { id: "4", name: "Crocin 500", form: "Tablet", generic: "Paracetamol" },
    { id: "5", name: "Vitamin D3 60000 IU", form: "Capsule", generic: "Cholecalciferol" },
  ];
  it("name prefix, then generic prefix, then a word, then a substring; case-insensitive", () => {
    expect(searchMedicines(list, "para").map((m) => m.id)).toEqual(["1", "4"]);
    // "Crocin 500" matches through its generic (Paracetamol), after the names that contain the query.
    expect(searchMedicines(list, "CET").map((m) => m.id)).toEqual(["2", "1", "3", "4"]);
    expect(searchMedicines(list, "d3").map((m) => m.id)).toEqual(["5"]);
    expect(searchMedicines(list, "chole").map((m) => m.id)).toEqual(["5"]);
  });
  it("empty query gives nothing; limit applies", () => {
    expect(searchMedicines(list, "  ")).toEqual([]);
    expect(searchMedicines(list, "i", 2)).toHaveLength(2);
  });
});
