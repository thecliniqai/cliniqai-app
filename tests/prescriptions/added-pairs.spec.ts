/**
 * V2-09e 09E-14a (C, review M2): a template or add-all with `unique: true` where an earlier line is already on the visit. The line the command adds holds its OWN
 * substance ids in its allergy note; they were taken by position in the original list, so after the existing line was dropped each saved line held its neighbour's.
 */
import { describe, expect, it } from "vitest";
import { pairAdded, substancesOfAdded, withoutPresent, type ChangeLine } from "@/features/prescriptions/lines";

const line = (name: string): ChangeLine => ({ medicine_name: name, dosage: "1", timing: null, duration: "3 days", special_instructions: null }) as ChangeLine;
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

describe("added lines and their substance ids travel as pairs", () => {
  it("unique add-all with an earlier line present: the saved lines hold their own ids", () => {
    const asked = [line("Amoxicillin"), line("Paracetamol"), line("Cetirizine")];
    const substances = [["sub-amox"], ["sub-para"], ["sub-cetir"]];
    // Amoxicillin is already on the visit (an earlier tap): the command adds Paracetamol and Cetirizine only.
    const kept = withoutPresent(pairAdded(asked, substances), new Set(["amoxicillin"]), norm);
    expect(kept.map((p) => p.line.medicine_name)).toEqual(["Paracetamol", "Cetirizine"]);
    const notes = substancesOfAdded(kept, ["id-para", "id-cetir"]);
    expect(notes).toEqual([
      { id: "id-para", substances: ["sub-para"] },
      { id: "id-cetir", substances: ["sub-cetir"] },
    ]);
  });

  it("the second filter at command start (a queued tap saw one more line) keeps the pairing", () => {
    const first = withoutPresent(pairAdded([line("A"), line("B"), line("C")], [["a"], ["b"], ["c"]]), new Set(["a"]), norm);
    const second = withoutPresent(first, new Set(["b"]), norm);
    expect(substancesOfAdded(second, ["id-c"])).toEqual([{ id: "id-c", substances: ["c"] }]);
  });

  it("an index the command gave no id holds no note; a missing substance list is none", () => {
    const pairs = pairAdded([line("A"), line("B")], undefined);
    expect(substancesOfAdded(pairs, ["id-a"])).toEqual([{ id: "id-a", substances: [] }]);
    expect(substancesOfAdded(pairs, undefined)).toEqual([]);
  });
});
