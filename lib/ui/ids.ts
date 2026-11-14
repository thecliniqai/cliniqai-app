/**
 * Joins id references for `aria-describedby` / `aria-labelledby` (V2-06 06-02a). Skips empty parts and duplicates;
 * answers `undefined` when nothing is left, so React omits the attribute.
 */
export function joinIds(...ids: Array<string | false | null | undefined>): string | undefined {
  const seen: string[] = [];
  for (const part of ids) {
    if (!part) continue;
    for (const id of part.split(/\s+/)) if (id && !seen.includes(id)) seen.push(id);
  }
  return seen.length > 0 ? seen.join(" ") : undefined;
}
