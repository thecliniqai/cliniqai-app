/**
 * Known-bug failure matching (V2-02 02-06, IR-F4). Pure, no Playwright import, so Vitest can test it
 * (tests/ci/known-bug-match.spec.ts).
 *
 * A known-bug test asserts the CORRECT outcome and is expected to fail (RL-19). Only the marked correct-outcome
 * assertion may produce that failure: its `expect(…, knownBugMessage(id, …))` message starts with `KNOWN-BUG <id>:`.
 * Any other failure (a renamed label, a timeout in setup, a broken helper) is not the bug and must turn the test red.
 */

/** The custom `expect` message of a known bug's correct-outcome assertion. */
export function knownBugMessage(id: string, what: string): string {
  return `KNOWN-BUG ${id}: ${what}`;
}

/** True only when `error` is the failure of one of `id`'s marked correct-outcome assertions. */
export function isKnownBugFailure(id: string, error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`KNOWN-BUG ${id}:`);
}

/** The first line of an error, for annotations and the CI summary. */
export function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Strip ANSI colour codes Playwright adds to assertion messages.
  return (message.replace(/\u001b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim() !== "") ?? "").trim();
}
