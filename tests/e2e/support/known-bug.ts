/**
 * Known v1 bugs asserted as their correct outcome (RL-19, OA-6; V2-02 02-06 IR-F4).
 *
 * `knownBug(id, reason, body)` marks the test `test.fail()` and runs `body`, whose correct-outcome assertions carry
 * `knownBugMessage(id, …)`. A failure of one of those is the expected failure and is rethrown. Any other failure is
 * NOT the bug: it is recorded as an annotation and swallowed, so the test completes, and Playwright reports an
 * expected-to-fail test that completes as a failure. The run therefore turns red both when the bug is fixed (the body
 * passes: remove the annotation) and when something unrelated breaks the test.
 */
import { test } from "../fixtures";
import { firstLine, isKnownBugFailure } from "./known-bug-match";

export { knownBugMessage } from "./known-bug-match";

export async function knownBug(id: string, reason: string, body: () => Promise<void>): Promise<void> {
  test.fail(true, `${id}: ${reason}`);
  try {
    await body();
  } catch (error) {
    if (isKnownBugFailure(id, error)) throw error;
    test.info().annotations.push({
      type: "known bug: failed for another reason",
      description: `${id}: ${firstLine(error)}`,
    });
    return;
  }
  test.info().annotations.push({ type: "known bug: correct outcome reached", description: `${id}: remove test.fail` });
}
