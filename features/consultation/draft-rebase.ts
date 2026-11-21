import { DRAFT_FIELD_KEYS, draftFieldEqual, type DraftFieldKey, type DraftFields } from "./draft";

/**
 * Field-by-field three-way merge of a consult draft (V2-09b R-5). `base` is the server copy this tab last saved or read, `mine` is what is on
 * this screen, `theirs` is the server copy now (another tab, device or the nurse's vitals wrote since). Pure.
 *
 *  - a field only I changed keeps mine;
 *  - a field only they changed takes theirs;
 *  - a field both changed to the same value is that value;
 *  - a field both changed to different values is an overlap: `merged` keeps mine until the doctor chooses, and the key is listed in
 *    `overlapping` (the prompt "This consultation was changed in another tab or device").
 *
 * `fromTheirs` lists the fields whose merged value is theirs and differs from mine, so the screen can show what arrived.
 * Comparison is `draftFieldEqual` (key-order independent; an empty note, empty vitals and the follow-up interval word do not count as changes).
 */
export interface RebaseResult {
  merged: DraftFields;
  overlapping: DraftFieldKey[];
  fromTheirs: DraftFieldKey[];
}

export function rebaseDraft(base: DraftFields, mine: DraftFields, theirs: DraftFields): RebaseResult {
  const merged = { ...mine } as DraftFields;
  const overlapping: DraftFieldKey[] = [];
  const fromTheirs: DraftFieldKey[] = [];
  for (const key of DRAFT_FIELD_KEYS) {
    const mineChanged = !draftFieldEqual(key, base[key], mine[key]);
    const theirsChanged = !draftFieldEqual(key, base[key], theirs[key]);
    if (!theirsChanged) continue; // keep mine (changed or not)
    if (!mineChanged) {
      (merged as unknown as Record<string, unknown>)[key] = theirs[key];
      if (!draftFieldEqual(key, mine[key], theirs[key])) fromTheirs.push(key);
      continue;
    }
    if (draftFieldEqual(key, mine[key], theirs[key])) {
      (merged as unknown as Record<string, unknown>)[key] = theirs[key];
      continue;
    }
    overlapping.push(key);
  }
  return { merged, overlapping, fromTheirs };
}
