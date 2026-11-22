/**
 * V2-09c 09C-02 (R-7, T-09C-05): the allergy rule, ONE case table run against the TypeScript twin (`features/prescriptions/allergy.ts`, the screen's) and
 * against `private.rx_allergy_matches` (the commands'), with identical results. Substances are synthetic rows ("Qzxamoxil"); an allergy is coded when its
 * string equals a substance name (case-insensitive, trimmed). The SQL side runs through the local superuser; the TS side takes the same ids from the
 * same table. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { allergyMatches, allergyStateOf, allergyWords, type AllergyEntry } from "@/features/prescriptions/allergy";
import { psql } from "../helpers/sql";
import { AL_SUBSTANCES, seedAllergyCatalogue } from "../helpers/cdci-allergy";

interface Case {
  name: string;
  allergies: string[];
  /** The line's substance ids (by key of AL_SUBSTANCES; empty = a custom medicine or an unloaded one). */
  ids: Array<keyof typeof AL_SUBSTANCES>;
  names: string[];
  expected: string[];
}

const CASES: Case[] = [
  { name: "a coded allergy and a line with that substance", allergies: ["Qzxamoxil"], ids: ["amox"], names: ["Qzxmoxy 500", "Qzxamoxil 500 mg"], expected: ["Qzxamoxil"] },
  { name: "a coded allergy and a combination line holding it", allergies: ["Qzxclavulan"], ids: ["amox", "clav"], names: ["Qzxaugment 625", "Qzxamoxil + Qzxclavulan"], expected: ["Qzxclavulan"] },
  { name: "a coded allergy and a line with another substance", allergies: ["Qzxamoxil"], ids: ["para"], names: ["Qzxdolo 650", "Qzxparacet 650 mg"], expected: [] },
  // 09C-06a (S-1): substance OR name. A line whose catalogue id claims another substance is still checked by its printed name.
  { name: "a coded allergy and a line named for it whose ids say another substance (a forged catalogue id)", allergies: ["Qzxamoxil"], ids: ["para"], names: ["Qzxamoxil 500", "Qzxamoxil"], expected: ["Qzxamoxil"] },
  { name: "a coded allergy named only in the generic of a line whose ids say another substance", allergies: ["Qzxamoxil"], ids: ["para"], names: ["Qzxsafe 500", "Qzxamoxil 500 mg"], expected: ["Qzxamoxil"] },
  { name: "case and spaces in a coded allergy", allergies: ["  qzxAMOXIL  "], ids: ["amox"], names: ["Qzxmoxy 500", null as never], expected: ["  qzxAMOXIL  "] },
  { name: "two allergies, one matches", allergies: ["Qzxparacet", "Qzxamoxil"], ids: ["amox"], names: ["Qzxmoxy 500", "Qzxamoxil 500 mg"], expected: ["Qzxamoxil"] },
  { name: "two allergies, both match a combination", allergies: ["Qzxamoxil", "Qzxclavulan"], ids: ["amox", "clav"], names: ["Qzxaugment 625", "x"], expected: ["Qzxamoxil", "Qzxclavulan"] },
  { name: "a coded allergy and a line with no substance ids is checked by name (generic name)", allergies: ["Qzxamoxil"], ids: [], names: ["Qzxmoxy 500", "Qzxamoxil 500 mg"], expected: ["Qzxamoxil"] },
  { name: "a coded allergy and a custom line with no ids and another name", allergies: ["Qzxamoxil"], ids: [], names: ["Qzxdolo 650", null as never], expected: [] },
  { name: "a free-text allergy (not a substance) flags a custom line by name", allergies: ["Augmentin"], ids: [], names: ["Augmentin 625", null as never], expected: ["Augmentin"] },
  { name: "a brand recorded as the allergy flags the same brand even when the line has substances (not coded: by name)", allergies: ["Qzxmoxy"], ids: ["amox"], names: ["Qzxmoxy 500", "Qzxamoxil 500 mg"], expected: ["Qzxmoxy"] },
  { name: "a word inside a longer word does not match", allergies: ["cef"], ids: [], names: ["Cefixime 200", null as never], expected: [] },
  { name: "a word inside a longer word does not match (suffix)", allergies: ["pen"], ids: [], names: ["Ampen forte", "Ampen"], expected: [] },
  { name: "a multi-word allergy needs its words in order", allergies: ["penicillin g"], ids: [], names: ["Benzathine penicillin G 12 lakh", null as never], expected: ["penicillin g"] },
  { name: "a multi-word allergy in the wrong order does not match", allergies: ["g penicillin"], ids: [], names: ["Benzathine penicillin G 12 lakh", null as never], expected: [] },
  { name: "punctuation and digits split words", allergies: ["sulfa"], ids: [], names: ["Co-sulfa-methoxazole 960", null as never], expected: ["sulfa"] },
  { name: "the name match is case-insensitive", allergies: ["PARACETAMOL"], ids: [], names: ["paracetamol 500 mg", null as never], expected: ["PARACETAMOL"] },
  { name: "the generic name counts too", allergies: ["Ibuprofen"], ids: [], names: ["Brufen 400", "ibuprofen 400 mg"], expected: ["Ibuprofen"] },
  { name: "no allergies recorded as a list: nothing matches", allergies: [], ids: ["amox"], names: ["Qzxmoxy 500", "Qzxamoxil 500 mg"], expected: [] },
  { name: "blank allergy strings are ignored", allergies: ["", "   "], ids: [], names: ["Anything", "x"], expected: [] },
  { name: "an allergy of only punctuation matches nothing", allergies: ["---"], ids: [], names: ["Anything --- here", "x"], expected: [] },
  { name: "no class relations: a penicillin allergy does not flag amoxicillin", allergies: ["Penicillin"], ids: [], names: ["Amoxicillin 500", "Amoxicillin"], expected: [] },
  // 09C-06a (S-1): these two pinned "by id, not by name" for a coded allergy, which is exactly the forged-id bypass; the printed name is now always checked.
  { name: "no salt relations by id, but the allergen's word in the printed name still flags (substance OR name)", allergies: ["Qzxamoxil"], ids: ["para"], names: ["Qzxamoxil trihydrate 500", "x"], expected: ["Qzxamoxil"] },
  { name: "an allergy that equals a substance and a line whose ids are other: still flagged by its printed name", allergies: ["Qzxamoxil"], ids: ["para"], names: ["Qzxamoxil-sounding brand", "Qzxparacet"], expected: ["Qzxamoxil"] },
  { name: "the order of the allergies is kept", allergies: ["Qzxclavulan", "Qzxamoxil"], ids: ["amox", "clav"], names: ["x", "y"], expected: ["Qzxclavulan", "Qzxamoxil"] },
  { name: "a repeated allergy string is reported as given", allergies: ["Qzxamoxil", "Qzxamoxil"], ids: ["amox"], names: ["x", "y"], expected: ["Qzxamoxil", "Qzxamoxil"] },
  { name: "a name with non-Latin letters matches as whole words", allergies: ["पैरासिटामोल"], ids: [], names: ["पैरासिटामोल 500", null as never], expected: ["पैरासिटामोल"] },
  { name: "a number is a word", allergies: ["625"], ids: [], names: ["Augmentin 625 Duo", null as never], expected: ["625"] },
  { name: "a number inside a longer number is not", allergies: ["62"], ids: [], names: ["Augmentin 625 Duo", null as never], expected: [] },
];

const lit = (text: string) => `'${text.replaceAll("'", "''")}'`;
const arr = (items: ReadonlyArray<string | null>) => `array[${items.map((i) => (i === null ? "null::text" : lit(i))).join(", ")}]::text[]`;

function sqlMatches(c: Case): string[] {
  const ids = c.ids.map((k) => AL_SUBSTANCES[k].id);
  const out = psql(`select coalesce(string_agg(m, E'\\x1f' order by ord), '') from unnest(private.rx_allergy_matches(${arr(c.allergies)}, ${arr(ids)}, ${arr(c.names)})) with ordinality as t(m, ord)`);
  const line = out[0] ?? "";
  return line === "" ? [] : line.split("\x1f");
}

/** The ids each allergy string codes to, from the same table the database reads. */
function codedEntries(allergies: string[]): AllergyEntry[] {
  const byName = new Map(Object.values(AL_SUBSTANCES).map((s) => [s.name.toLowerCase(), s.id]));
  return allergies.map((text) => {
    const id = byName.get(text.trim().toLowerCase());
    return { text, substanceIds: id ? [id] : [] };
  });
}

beforeAll(async () => {
  await seedAllergyCatalogue();
});

describe("the allergy rule: one table, the TypeScript twin and the SQL function agree", () => {
  it("has at least 25 cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(25);
  });

  it.each(CASES)("$name", (c) => {
    const ids = c.ids.map((k) => AL_SUBSTANCES[k].id);
    const ts = allergyMatches(codedEntries(c.allergies), { substanceIds: ids, names: c.names });
    // The superuser helper trims its output lines, so both sides are compared trimmed (the stored strings are trimmed by the record command anyway).
    const norm = (xs: string[]) => xs.map((x) => x.trim());
    expect(norm(ts), "TypeScript").toEqual(norm(c.expected));
    expect(norm(sqlMatches(c)), "SQL").toEqual(norm(c.expected));
  });
});

describe("allergyWords and the three states", () => {
  it("words are lower-case alphanumerics joined by single spaces", () => {
    expect(allergyWords("  Co-Sulfa/Methoxazole 960!! ")).toBe("co sulfa methoxazole 960");
    expect(allergyWords("---")).toBe("");
  });
  it("not recorded, none and known stay distinct", () => {
    expect(allergyStateOf(null)).toBe("not_recorded");
    expect(allergyStateOf(undefined)).toBe("not_recorded");
    expect(allergyStateOf([])).toBe("none");
    expect(allergyStateOf(["Penicillin"])).toBe("known");
  });
});
