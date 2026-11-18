/**
 * A frozen browser clock for e2e specs (V2-06 06-02c; moved here by 06-08 when the G3 screenshot set became its second
 * user). Never use Playwright's `page.clock` with anything that uses `TZDate` (06-02c wave note): see below.
 *
 * A page whose markup depends on "today" must not render it during hydration while the browser clock is frozen (server
 * and browser would disagree); the gallery's date section renders after hydration for that reason.
 */
import type { Page } from "@playwright/test";

/**
 * Freezes the page's clock at `at` without breaking `Date` subclasses. `TZDate` (@date-fns/tz, used by lib/datetime and
 * react-day-picker for the clinic zone) extends `Date` and proxies the methods it finds on `Date.prototype`. Playwright's
 * `page.clock` swaps in a `Date` whose constructor returns a plain native Date (the subclass prototype is lost), and a
 * `class extends Date` stand-in has a prototype with no own methods to proxy: both made
 * `new TZDate(18:00Z, "Asia/Kolkata").getDate()` read 13 (the browser's UTC+14 day) instead of 12
 * (evidence/06-02c/clock-probe.txt). This stand-in builds every date with `Reflect.construct(NativeDate, args,
 * new.target)` and shares the native prototype, so only `Date.now()` and `new Date()` change.
 */
export async function freezeClock(page: Page, at: Date) {
  await page.addInitScript((ms: number) => {
    const Native = Date;
    function FrozenDate(this: unknown, ...args: unknown[]) {
      if (!new.target) return Native();
      return Reflect.construct(Native, args.length === 0 ? [ms] : args, new.target);
    }
    FrozenDate.prototype = Native.prototype;
    FrozenDate.now = () => ms;
    FrozenDate.parse = Native.parse;
    FrozenDate.UTC = Native.UTC;
    globalThis.Date = FrozenDate as unknown as DateConstructor;
  }, at.getTime());
}
