/**
 * The axe scans' precondition (tests/e2e/support/settle.ts; V2-09d, CI run 45193065167, journey 6 on iphone-15): when
 * `runningFiniteAnimations` reports nothing running, the colour axe reads is the end colour.
 *
 * WebKit moves an animation's clock on between rendering updates but restyles the element only at the next one. A check
 * made outside a frame could report a fade finished while `getComputedStyle` still returned its last rendered frame: journey
 * 6's Print Rx label was scanned at white 0.88 on CliniQ Blue (4.4:1) after the guard had passed. This test polls the check
 * back to back right through the end of the Button's colour fade (lib/ui/variants.ts TRANSITION and BUTTON_LOADING: 120 ms
 * ease-out, from transparent to white), the schedule a loaded CI runner produces, and reads the colour after each "nothing
 * running". In the CI browser build (Linux WebKit, Playwright 1.63) with the check made from an ordinary task, this test
 * failed 2 of 5 runs idle (part-way colours 0.992 and 0.996; under CPU load a probe read 0.77 and 0.17); with the check in
 * a frame callback it passed 16 of 16 runs, idle and loaded.
 *
 * It needs WebKit, and the WebKit PR project runs the @golden paths only, so it runs once, on desktop-chrome, and launches
 * WebKit (iPhone 15) and Chromium (Pixel 7) itself. No app and no network: the page is set from a string.
 */
import { devices } from "@playwright/test";
import { expect, routeLoopbackOnly, test } from "../fixtures";
import { runningFiniteAnimations } from "../support/settle";

const ROUNDS = 40;
const END_COLOUR = "rgb(255, 255, 255)";
const PAGE = `<!doctype html><html lang="en"><head><title>settle guard</title><style>
  button { background: #246bce; color: #fff; font: 13px/1.2 sans-serif; padding: 8px 12px; border: 0;
           transition: color 120ms ease-out; }
  button[aria-busy="true"] { color: transparent; }
</style></head><body><main><button type="button" aria-busy="true">Print Rx</button></main></body></html>`;

const ENGINES = [
  ["webkit", devices["iPhone 15"]],
  ["chromium", devices["Pixel 7"]],
] as const;

test("the settle check never reports a colour fade finished while the colour axe reads is part-way (WebKit and Chromium)", async ({ playwright }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "launches both engines itself: once per run");
  test.setTimeout(120_000);
  for (const [engine, descriptor] of ENGINES) {
    const browser = await playwright[engine].launch();
    try {
      const context = await browser.newContext({ ...descriptor });
      const blocked: string[] = [];
      await routeLoopbackOnly(context, blocked);
      const page = await context.newPage();
      const partWay: string[] = [];
      let fadesSeen = 0;
      for (let round = 0; round < ROUNDS; round++) {
        await page.setContent(PAGE);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        // The state change (the label becomes visible): a 120 ms colour fade starts.
        await page.evaluate(() => document.querySelector("button")!.removeAttribute("aria-busy"));
        const deadline = Date.now() + 5_000;
        let polls = 0;
        // Back to back, no pause: the schedule a loaded runner produces (trace snapshots, expects, axe injection).
        while ((await runningFiniteAnimations(page)).length > 0) {
          polls += 1;
          expect(Date.now(), `${engine}: the fade never settled`).toBeLessThan(deadline);
        }
        if (polls > 0) fadesSeen += 1;
        const colour = await page.evaluate(() => getComputedStyle(document.querySelector("button")!).color);
        if (colour !== END_COLOUR) partWay.push(`round ${round}: ${colour}`);
      }
      // After each "nothing running" the colour was the end colour, and the check did see fades running (it is not blind). Under load
      // a round's first frame can come after the whole fade (seen once in 200 rounds on a loaded Linux WebKit): then it sees none.
      expect(partWay, `${engine}: colours read after the check reported nothing running`).toEqual([]);
      expect(fadesSeen, `${engine}: rounds in which the check saw the fade running`).toBeGreaterThan(ROUNDS / 2);
      expect(blocked).toEqual([]);
    } finally {
      await browser.close();
    }
  }
});
