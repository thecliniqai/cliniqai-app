/**
 * Saves by risk class on the front desk and the consult (V2-09e 09E-08, R-11; threat T-09E-08 "a save shown as done that failed" is medium, its fails-without
 * is High: an optimistic success added to booking makes this file red).
 *
 * Reversible: Check in moves the row to Waiting before the answer and takes it back, with the fixed error and Retry, on a refusal (a lost command, or a stale
 * version: `ROW_CHANGED`); the answer is written into the board (one command, no RSC request).
 * Confirm class (register and book, book, reschedule, cancel, collect payment, allergies, sign and finish): with the save's action POST held in the browser
 * (so the server cannot have answered and the database holds nothing yet) the screen shows a pending state only: no success text and nothing moved; after the
 * release the success shows and the database holds the change. The rows and their seeds are the latency lane's (`tests/e2e/perf/latency-saves.ts`), so the
 * save a spec presses is exactly the one the budget measures.
 * Synthetic data only. 0 retries: a case that only passes on retry is a defect.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { storageStatePath } from "../support/run-data";
import { SAVE_ROWS } from "../perf/latency-saves";
import { countActionPosts, holdActions } from "../support/hold-actions";
import { seedBookedToday, todayName, visitStatusOf } from "../support/today-data";
import { countRscRequests, filterToday, openToday, rowInLane, showLane } from "../support/today-page";
import { randomUUID } from "node:crypto";
import { addMemberToTenant, seededUserPassword, seedTenantWithOwner } from "../../helpers/tenants";
import { uiSignIn } from "../support/password-journeys";
import { testTag } from "../support/m0-data";
import { ROW_CHANGED_MESSAGE } from "@/lib/errors/row-changed";

const CONFIRM_ROWS = SAVE_ROWS.filter((row) => row.held);

for (const row of CONFIRM_ROWS) {
  test.describe(row.id, () => {
    test.use({ storageState: storageStatePath(row.role) });
    test(`${row.id}: with the save held, a pending state only: no success text, nothing moved; after the answer the success shows and the database holds the change`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-chrome", "the held request is the same on every device; one project proves it");
      test.setTimeout(120_000);
      const held = row.held!;
      const state = await row.prepare(page);
      await page.waitForLoadState("networkidle");
      const hold = await holdActions(page);
      const posts = countActionPosts(page);
      const rsc = countRscRequests(page);

      // The save is pressed (the lane's own step); its one action POST is held in the browser.
      const acted = row.act(page, state).catch((error: unknown) => error);
      await expect.poll(() => hold.waiting(), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
      await page.waitForTimeout(400);
      await held.before(page, state);
      // An immediate count, not a retrying assertion: a success toast that shows for 4 s would satisfy `toHaveCount(0)` once it had gone.
      expect(await page.getByText(held.success).count(), `no success text while the save is held (${String(held.success)})`).toBe(0);

      hold.release();
      const result = await acted;
      expect(result instanceof Error ? result.message : "ok").toBe("ok");
      await held.stored(state);
      await page.waitForLoadState("networkidle");
      // One command is one POST; the confirmed save re-rendered a page at most on the Schedule (a server-rendered screen until 09E-12).
      expect(posts()).toBeGreaterThanOrEqual(1);
      if (!row.id.startsWith("save.R.") || ["save.R.collect"].includes(row.id)) expect(rsc()).toBeLessThanOrEqual(1);
    });
  });
}

test.describe("check in (reversible)", () => {
  test.use({ storageState: storageStatePath("receptionist") });

  test("@golden the row moves to Waiting before the answer, with the command held and the database unchanged; one command, no RSC request", async ({ page }) => {
    const name = todayName("CheckInHeld");
    const { visitId } = await seedBookedToday(name);
    await openToday(page);
    await filterToday(page, name);
    const hold = await holdActions(page);
    const posts = countActionPosts(page);
    const rsc = countRscRequests(page);
    await rowInLane(page, "booked", name).getByRole("button", { name: `Check in ${name}` }).click();
    await expect.poll(() => hold.waiting()).toBe(1);
    await expect(rowInLane(page, "waiting", name)).toHaveCount(1);
    expect(await visitStatusOf(visitId)).toBe("booked");
    hold.release();
    await expect.poll(() => visitStatusOf(visitId)).toBe("waiting");
    await expect(rowInLane(page, "waiting", name)).toHaveCount(1);
    await page.waitForLoadState("networkidle");
    expect(posts()).toBe(1);
    expect(rsc()).toBe(0);
  });

  test("a refused check-in takes the row back to Booked with the fixed error and Retry; Retry moves it and the database has one token", async ({ page }) => {
    const name = todayName("CheckInRefused");
    const { visitId } = await seedBookedToday(name);
    await openToday(page);
    await filterToday(page, name);
    const cut = await holdActions(page, { held: false });
    cut.cutAll();
    await rowInLane(page, "booked", name).getByRole("button", { name: `Check in ${name}` }).click();
    await expect(rowInLane(page, "waiting", name)).toHaveCount(1);
    const toast = page.getByRole("status").filter({ hasText: `Couldn't check in ${name}` }).or(page.getByRole("alert").filter({ hasText: `Couldn't check in ${name}` }));
    await expect(toast.first()).toBeVisible({ timeout: 30_000 });
    await expect(rowInLane(page, "booked", name)).toHaveCount(1);
    expect(await visitStatusOf(visitId)).toBe("booked");
    cut.pass();
    await toast.first().getByRole("button", { name: "Retry" }).click();
    await expect(rowInLane(page, "waiting", name)).toHaveCount(1);
    await expect.poll(() => visitStatusOf(visitId)).toBe("waiting");
  });
});

test.describe("check in refused as stale", () => {
test.use({ storageState: { cookies: [], origins: [] } });
test("a check-in refused as stale (ROW_CHANGED) rolls the row back with the fixed text and no Retry; the re-read then shows the visit where it really is", async ({ page }) => {
  const owner = await seedTenantWithOwner(`E2E Synthetic Clinic RollBack ${testTag()}`);
  const receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  const clinic = { tenantId: owner.tenantId, ownerId: owner.userId, doctorId: owner.userId, createdBy: receptionist.userId };
  // A's board reads and heartbeat are held, so it stays behind the database while B acts.
  let hold = true;
  await page.route("**/api/live/state", (route) => (hold ? route.abort() : route.continue()));
  await page.route("**/api/today/board**", (route) => (hold ? route.abort() : route.continue()));
  await uiSignIn(page, { email: receptionist.userEmail, password: seededUserPassword() });
  const name = todayName("RollBack");
  const { visitId } = await seedBookedToday(name, "10:00", clinic);
  await page.reload();
  await openToday(page);
  await filterToday(page, name);
  await expect(rowInLane(page, "booked", name)).toHaveCount(1);

  // B (another device) checks the visit in; A still shows Booked with the old version.
  const checked = await owner.client.rpc("check_in_visit", { p_tenant_id: owner.tenantId, p_visit_id: visitId, p_priority: "normal", p_client_request_id: randomUUID() });
  expect(checked.error).toBeNull();

  await rowInLane(page, "booked", name).getByRole("button", { name: `Check in ${name}` }).click();
  // The row moved at once, then came back: A's state is still the old one while its re-reads are held; the message is the fixed text, with no Retry.
  const toast = page.getByText(ROW_CHANGED_MESSAGE);
  await expect(toast.first()).toBeVisible({ timeout: 30_000 });
  await expect(rowInLane(page, "booked", name)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  // Let the re-read through: the visit is in Waiting, where it really is.
  hold = false;
  await expect.poll(() => visitStatusOf(visitId)).toBe("waiting");
  await showLane(page, "Waiting");
  await expect(rowInLane(page, "waiting", name)).toHaveCount(1, { timeout: 30_000 });
});

});

/** Keeps `Page` imported for the typed helper signatures above. */
export type { Page };
