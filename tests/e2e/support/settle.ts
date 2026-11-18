/**
 * Waits until the page has no finite animation or CSS transition running (V2-06 06-02a; flaky-test root cause).
 *
 * Why: axe reads computed colours. A control that changes state (a submit button enabled at hydration) fades between
 * its two looks, and a frame in the middle can fail contrast where both ends pass. The v2-01 change-password scan
 * failed that way once under PR-lane load: the Button primitive's 120 ms colour fade from the disabled look to
 * CliniQ Blue, scanned at #edeff1 on #3a7ad3 (3.71:1). The old guard polled `opacity` only (v1's fade). A probe with
 * animations slowed 50x reproduced it every time (evidence/06-02a/flake-change-password.md).
 *
 * Infinite animations (loading spinners, skeleton pulses) never finish and are not state changes: they are ignored.
 */
import { expect, type Page } from "@playwright/test";

export async function runningFiniteAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity)
      .map((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        const what = (a as CSSTransition).transitionProperty ?? (a as CSSAnimation).animationName ?? a.constructor.name;
        return `${target?.tagName.toLowerCase() ?? "?"}:${what}`;
      }),
  );
}

/** Resolves once no finite animation or transition is running on the page (polls; fails after `timeout`). */
export async function settleAnimations(page: Page, timeout = 5_000): Promise<void> {
  await expect.poll(() => runningFiniteAnimations(page), { timeout, message: "animations still running" }).toEqual([]);
}
