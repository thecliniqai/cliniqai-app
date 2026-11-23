/**
 * Waits until the page has no finite animation or CSS transition running (V2-06 06-02a; flaky-test root cause).
 *
 * Why: axe reads computed colours. A control that changes state (a submit button enabled at hydration) fades between
 * its two looks, and a frame in the middle can fail contrast where both ends pass. The v2-01 change-password scan
 * failed that way once under PR-lane load: the Button primitive's 120 ms colour fade from the disabled look to
 * CliniQ Blue, scanned at #edeff1 on #3a7ad3 (3.71:1). The old guard polled `opacity` only (v1's fade). A probe with
 * animations slowed 50x reproduced it every time (evidence/06-02a/flake-change-password.md).
 *
 * The check runs inside a `requestAnimationFrame` callback (V2-09d; CI run 45193065167, journey 6 on iphone-15). WebKit
 * moves an animation's clock on between rendering updates but changes the element's computed style only at the next
 * one. Checked from an ordinary task, a fade could already count as finished while `getComputedStyle` (what axe reads)
 * still returned the last frame's colour. In that run WebKit rendered no frame for about 260 ms while Playwright traced
 * the page and injected axe, so the Print Rx label was scanned at white 0.88 on CliniQ Blue (4.4:1) after this guard
 * had passed. In a frame callback the animations have just been updated for that frame, so the list and the computed
 * style agree. In the CI browser build (Linux WebKit, Playwright 1.63), a check made from a task at a fade's end
 * reported "settled" with the colour still part-way in 81 of 100 trials; the same check in a frame callback, 0 of 100.
 * A page that never renders a frame (hidden) makes the poll time out and fail; it never passes unchecked.
 *
 * Infinite animations (loading spinners, skeleton pulses) never finish and are not state changes: they are ignored.
 */
import { expect, type Page } from "@playwright/test";

export async function runningFiniteAnimations(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) =>
        requestAnimationFrame(() =>
          resolve(
            document
              .getAnimations()
              .filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity)
              .map((a) => {
                const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
                const what = (a as CSSTransition).transitionProperty ?? (a as CSSAnimation).animationName ?? a.constructor.name;
                return `${target?.tagName.toLowerCase() ?? "?"}:${what}`;
              }),
          ),
        ),
      ),
  );
}

/** Resolves once no finite animation or transition is running on the page (polls; fails after `timeout`). */
export async function settleAnimations(page: Page, timeout = 5_000): Promise<void> {
  await expect.poll(() => runningFiniteAnimations(page), { timeout, message: "animations still running" }).toEqual([]);
}
