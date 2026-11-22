/**
 * The allergy rule for the screen (V2-09c 09C-02, R-7; AI-11, SA-07 at substance level; AIR-5, AIR-7). The database holds the same rule in
 * `private.rx_allergy_matches`, which the commands call; this is its TypeScript twin for the typeahead chip, the dose builder and the line states, and
 * `tests/prescriptions/allergy-match.spec.ts` runs ONE case table against both with identical results. No I/O.
 *
 * - An allergy is coded when its string equals a CDCI substance name (case-insensitive, trimmed); `AllergyEntry.substanceIds` carries those ids
 *   (the database codes them; `rx_allergy_context` returns them). An empty list means "checked by name only".
 * - A coded allergy matches a line that has substance ids when the ids intersect. Every allergy (coded or not) also matches when its words appear, in
 *   order, as whole words of the medicine or generic name (case-insensitive; non-alphanumerics split words): substance OR name (09C-06a, S-1).
 * - No class table, no salt relations (D-9, v2.1): a penicillin allergy does not flag amoxicillin unless the allergy is written as amoxicillin.
 */
export interface AllergyEntry {
  text: string;
  /** The CDCI substance ids the string codes to; empty = not a substance name. */
  substanceIds: readonly string[];
}

export interface AllergyLine {
  /** The medicine's CDCI substance ids (empty for a custom medicine or while the CDCI load has not filled them). */
  substanceIds: readonly string[];
  /** The medicine name and the generic name. */
  names: ReadonlyArray<string | null | undefined>;
}

/** Lower-case alphanumeric words joined by single spaces (`[^[:alnum:]]+` is the separator, as in SQL). */
export function allergyWords(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The allergy strings the line matches, in the order of `allergies`. */
export function allergyMatches(allergies: readonly AllergyEntry[], line: AllergyLine): string[] {
  const lineIds = new Set(line.substanceIds);
  const nameWords = line.names.filter((n): n is string => typeof n === "string" && n.trim() !== "").map((n) => ` ${allergyWords(n)} `);
  const out: string[] = [];
  for (const a of allergies) {
    if (a.text.trim() === "") continue;
    const coded = a.substanceIds.length > 0;
    // By substance when both sides are coded, and ALWAYS by name (09C-06a, S-1): the printed name is checked even when the line's catalogue id says
    // something else, so a line cannot pass a coded allergy on its substances alone.
    const bySubstance = coded && lineIds.size > 0 && a.substanceIds.some((id) => lineIds.has(id));
    const words = allergyWords(a.text);
    const byName = words !== "" && nameWords.some((n) => n.includes(` ${words} `));
    if (bySubstance || byName) out.push(a.text);
  }
  return out;
}

/** The three states of a patient's allergy record (DESIGN_SYSTEM §7.2: "not recorded" and "none" are visibly different). */
export type AllergyState = "not_recorded" | "none" | "known";

export function allergyStateOf(allergies: readonly string[] | null | undefined): AllergyState {
  if (allergies == null) return "not_recorded";
  return allergies.length === 0 ? "none" : "known";
}

/** What `public.rx_allergy_context` answers (parsed by the service). */
export interface RxAllergyContext {
  state: AllergyState;
  entitled: boolean;
  allergies: AllergyEntry[];
  items: Array<{ id: string; matches: string[]; checkedBy: "substance" | "name"; overridden: boolean; overrideReason: string | null }>;
}

/** The shown text of a match list: "Amoxicillin" or "Amoxicillin, Penicillin". */
export function matchText(matches: readonly string[]): string {
  return matches.join(", ");
}

/** The reason's bounds (Q-4): 5 to 300 characters, after trimming. */
export const ALLERGY_REASON_MIN = 5;
export const ALLERGY_REASON_MAX = 300;
export function allergyReasonError(reason: string): string | null {
  const n = reason.trim().length;
  if (n < ALLERGY_REASON_MIN) return `Give a reason of at least ${ALLERGY_REASON_MIN} characters to prescribe despite the allergy`;
  if (n > ALLERGY_REASON_MAX) return `Keep the reason under ${ALLERGY_REASON_MAX} characters`;
  return null;
}

export const ALLERGY_MATCH_MESSAGE = "This medicine matches a recorded allergy. Review it and give a reason to prescribe it.";
