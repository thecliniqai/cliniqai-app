/**
 * V2-09e 09E-10 (R-6): `lib/reference/trigram.ts` is a twin of pg_trgm's `similarity()`. One table of pairs runs against both: the twin, and the local
 * database's own `similarity(a, b)` (superuser psql into the local stack's container; the texts travel hex-encoded, so no text is ever SQL). Same score
 * (as a 4-byte float) and the same answer to `>= 0.3` for every pair. Synthetic texts only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { psql } from "../helpers/sql";
import { isSimilar, similarity, trigrams } from "@/lib/reference/trigram";

const PAIRS: Array<[string, string]> = [
  ["abc", "abd"],
  ["abc", "abc"],
  ["hypertension", "hypertensoin"],
  ["hypertension", "hypertension stage 2"],
  ["fever", "feve"],
  ["fever", "viral fever"],
  ["a", "a"],
  ["a", "ab"],
  ["ab", "ba"],
  ["x", "y"],
  ["", ""],
  ["", "abc"],
  ["   ", "abc"],
  ["---", "abc"],
  ["type 2 diabetes mellitus", "t2dm"],
  ["type 2 diabetes mellitus", "diabetes mellitus type 2"],
  ["dolo 650", "dolo650"],
  ["paracetamol 500 mg", "paracetamol"],
  ["Paracetamol", "PARACETAMOL"],
  ["urti", "upper respiratory tract infection"],
  ["acute otitis media", "otitis"],
  ["otitis otitis otitis", "otitis"],
  ["repeated repeated", "repeated"],
  ["a b c d", "abcd"],
  ["a.b,c;d", "a b c d"],
  ["co-amoxiclav", "co amoxiclav"],
  ["gastro-oesophageal reflux disease", "gerd"],
  ["gastro-oesophageal reflux disease", "gastro oesophageal reflux"],
  ["12345", "1234"],
  ["vitamin d3 60000 iu", "vitamin d"],
  ["50% dextrose", "dextrose 50"],
  ["under_score", "under score"],
  ["back\\slash", "back slash"],
  ["Éclair", "eclair"],
  ["éclair", "ÉCLAIR"],
  ["straße", "strasse"],
  ["Ämox", "ämoxil"],
  ["naïve", "naive"],
  ["मधुमेह", "मधुमेह रोग"],
  ["ज्वर", "ज्वर"],
  ["日本語", "日本"],
  ["café au lait", "cafe au lait"],
  ["q", "qq"],
  ["qzx", "qzxqzx"],
  ["one two three four five", "five four three two one"],
  ["amlodipine", "amlodipin"],
  ["metformin", "metfromin"],
  ["azithromycin", "azithral"],
  ["cetirizine", "levocetirizine"],
  ["  padded  ", "padded"],
];

const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
let sql: Array<{ score: number; similar: boolean }> = [];

beforeAll(() => {
  const values = PAIRS.map(([a, b], i) => `(${i}, convert_from(decode('${hex(a)}', 'hex'), 'UTF8'), convert_from(decode('${hex(b)}', 'hex'), 'UTF8'))`).join(", ");
  const lines = psql(`set extra_float_digits = 3; select i || '|' || similarity(a, b)::float8::text || '|' || (similarity(a, b) >= 0.3)::text from (values ${values}) v(i, a, b) order by i`);
  sql = lines.filter((line) => line.includes("|")).map((line) => {
    const [, score, similar] = line.split("|");
    return { score: Number(score), similar: similar === "true" };
  });
}, 60_000);

describe("similarity twin: one table against pg_trgm", () => {
  it("has the plan's breadth (at least 40 pairs) and the database answered each", () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(40);
    expect(sql).toHaveLength(PAIRS.length);
  });

  it.each(PAIRS.map((p, i) => ({ a: p[0], b: p[1], i })))("similarity($a, $b)", ({ a, b, i }) => {
    const local = similarity(a, b);
    expect(Math.fround(local)).toBe(Math.fround(sql[i]!.score));
    expect(isSimilar(local)).toBe(sql[i]!.similar);
  });

  it("the table is not vacuous: scores on both sides of the threshold, an exact 1 and a 0", () => {
    expect(sql.some((r) => r.similar)).toBe(true);
    expect(sql.some((r) => !r.similar && r.score > 0)).toBe(true);
    expect(sql.some((r) => r.score === 1)).toBe(true);
    expect(sql.some((r) => r.score === 0)).toBe(true);
  });

  it("builds the trigrams pg_trgm shows for ASCII words", () => {
    const shown = psql(`select '[' || t || ']' from unnest(show_trgm('Ab-c 12')) t order by t`).map((l) => l.slice(1, -1));
    expect([...trigrams("Ab-c 12")].sort()).toEqual([...shown].sort());
  });
});
