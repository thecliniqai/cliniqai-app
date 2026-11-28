/**
 * The TypeScript twin of pg_trgm's `similarity(a, b)` (V2-09e 09E-10, R-6), for the on-device diagnosis and medicine searches. The parity table
 * (tests/reference/trigram-parity.spec.ts) runs one list of pairs against the database's own `similarity()`.
 *
 * pg_trgm, restated (KEEPONLYALNUM and IGNORECASE as built):
 *   - the text is lower-cased and split into words of alphanumeric characters (anything else separates words);
 *   - each word is padded with two spaces in front and one behind, and every three consecutive characters of it are a trigram;
 *   - the trigrams of the whole text are a set (duplicates removed);
 *   - similarity = |A ∩ B| ÷ |A ∪ B| as a 4-byte float, and 0 when either side has no trigram.
 * Differences that are accepted and recorded: the database classifies "alphanumeric" and lower-cases with the server's C library (glibc, en_US.UTF-8);
 * here a word character is a Unicode letter, combining mark (a Devanagari vowel sign or virama, as glibc counts them) or decimal digit and lower-casing is the platform's. They agree on ASCII, Latin letters with accents, ß
 * and the Indic scripts; they differ on rare symbols (a superscript digit, a ligature such as "ﬁ"), which no catalogue name relies on. pg_trgm stores a
 * trigram of more than three bytes as a hash; equal trigrams hash equally, so the set arithmetic is the same (a hash collision is ignored).
 */

const WORD = /[\p{L}\p{M}\p{Nd}]+/gu;

/** The trigram set of `text`, as pg_trgm's `show_trgm` builds it (as strings; the database hashes the multi-byte ones). */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  const words = text.toLowerCase().match(WORD);
  if (!words) return out;
  for (const word of words) {
    const chars = ["  ", ...Array.from(word), " "].join("");
    const cps = Array.from(chars);
    for (let i = 0; i + 3 <= cps.length; i++) out.add(cps[i]! + cps[i + 1]! + cps[i + 2]!);
  }
  return out;
}

/** |A ∩ B| ÷ |A ∪ B| of two trigram sets, rounded to a 4-byte float as pg_trgm returns it; 0 when either is empty. */
export function setSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let common = 0;
  for (const t of small) if (large.has(t)) common++;
  return Math.fround(common / (a.size + b.size - common));
}

/** pg_trgm's `similarity(a, b)`. */
export function similarity(a: string, b: string): number {
  return setSimilarity(trigrams(a), trigrams(b));
}

/** The threshold the SQL searches use (`similarity(...) >= 0.3`). */
export const TRIGRAM_THRESHOLD = 0.3;

/** `similarity >= 0.3`, compared as the database compares a 4-byte similarity with the literal. */
export function isSimilar(score: number): boolean {
  return score >= Math.fround(TRIGRAM_THRESHOLD);
}
