/**
 * Proves the browser network block in tests/e2e/fixtures.ts (V2-02 plan 02-03a acceptance: "a page request to an
 * external host fails the test"). `.example.test` is a reserved name that never resolves, so nothing leaves the
 * machine even if the block regressed.
 *
 * V2-14 14-01: app pages now carry a CSP whose `connect-src` refuses the external host before the request is made, so
 * these tests fetch from `/api/health` (a JSON document with no page policy) to reach the network block itself.
 */
import { expect, test } from "../fixtures";

const EXTERNAL = "https://blocked-host.example.test/probe";

test("a page request to a non-loopback host is aborted and its host recorded", async ({ page, blockedHosts }) => {
  await page.goto("/api/health");
  const outcome = await page.evaluate(async (url) => {
    try {
      await fetch(url, { mode: "no-cors" });
      return "loaded";
    } catch {
      return "failed";
    }
  }, EXTERNAL);

  expect(outcome).toBe("failed");
  expect(blockedHosts).toEqual(["blocked-host.example.test"]);
  // Asserted above; cleared so this test checks the block itself, and the next test checks the failure.
  blockedHosts.length = 0;
});

test("a test whose page reached for a non-loopback host fails", async ({ page }) => {
  // Expected failure: the fixture fails the test after the body because a request was blocked. If the fixture
  // stopped failing such tests, this one would "unexpectedly pass" and turn the run red.
  test.fail();
  await page.goto("/api/health");
  await page.evaluate((url) => fetch(url, { mode: "no-cors" }).catch(() => null), EXTERNAL);
});
