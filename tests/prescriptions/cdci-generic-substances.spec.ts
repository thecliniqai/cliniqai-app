/**
 * V2-09c 09C-02 (R-6, R-7): `parseGenericSubstanceIds`, the CDCI seed's reading of `GenericMaster.txt` column 3 (the generic's substance ids joined by `+`).
 * The spec imports only `scripts/seed/cdci-parse.ts` (never `scripts/seed-cdci.ts`, which loads `.env` and creates an admin client at import) and runs it on
 * a synthetic TSV string. Pure; no database.
 */
import { describe, expect, it } from "vitest";
import { parseGenericSubstanceIds } from "../../scripts/seed/cdci-parse";

const TSV = ["G1\tParacetamol 500 mg\tS10", "G2\tAmoxicillin + Clavulanic acid\tS20+S21", "G3\tOral rehydration salts\t S30 + S31 + S32 ", "G4\tUnmapped generic\t", "G5\tShort row"].join("\n");

describe("parseGenericSubstanceIds", () => {
  const rows = TSV.split("\n").map((line) => line.split("\t"));
  it("a single id", () => expect(parseGenericSubstanceIds(rows[0][2])).toEqual(["S10"]));
  it("ids joined by +", () => expect(parseGenericSubstanceIds(rows[1][2])).toEqual(["S20", "S21"]));
  it("spaces around ids and plus signs are trimmed", () => expect(parseGenericSubstanceIds(rows[2][2])).toEqual(["S30", "S31", "S32"]));
  it("a blank field has none (the medicine is checked by name only)", () => expect(parseGenericSubstanceIds(rows[3][2])).toEqual([]));
  it("a row with no third column has none", () => expect(parseGenericSubstanceIds(rows[4][2])).toEqual([]));
  it("null and undefined have none", () => {
    expect(parseGenericSubstanceIds(null)).toEqual([]);
    expect(parseGenericSubstanceIds(undefined)).toEqual([]);
  });
  it("empty parts and repeats are dropped, the order of first appearance is kept", () => {
    expect(parseGenericSubstanceIds("S1++S2+S1+ +S3")).toEqual(["S1", "S2", "S3"]);
  });
});
