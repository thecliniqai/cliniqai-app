/**
 * V2-09b 09B-01: the consult's save model (R-2 to R-5, PWA §3.8 D3).
 *
 * The tracer (the first two tests) is the narrowest slice: the free-text note travels through the versioned save command. A draft is
 * held in memory and reaches the server at most 5 s after the first unsaved change, and typing does not push that wait back. The page
 * is closed without unload handlers ("the tab was killed"), and the note read after reopening is what the server had.
 *
 * Real time is used, not `page.clock`: the consult formats clinic dates with `TZDate`, which Playwright's fake `Date` breaks
 * (tests/e2e/support/clock.ts).
 */
import type { Page } from "@playwright/test";
import { E2E_BASE_URL } from "../support/app-env";
import { expect, routeLoopbackOnly, test } from "../fixtures";
import { seedPatient, seedVisit, testTag, run, visitById } from "../support/m0-data";
import { auditRows } from "../../helpers/billing-commands";
import { getAdminClient } from "../../helpers/supabase-admin";
import { commitThenAbort } from "../support/commit-then-abort";
import { storageStatePath } from "../support/run-data";
import { seedWaitingToday, todayName, visitStatusOf, vitalsOfVisit } from "../support/today-data";
import { filterToday, openToday, rowOf, showLane } from "../support/today-page";

test.use({ storageState: storageStatePath("doctor") });

const NOTES_LABEL = "History of Present Illness & Clinical Notes";
const CONFLICT_TITLE = "This consultation was changed in another tab or device";
const ADVICE_CHIP = "Steam inhalation twice daily";

async function seedOpenConsult(label: string) {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Draft ${label} ${testTag()}`);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.receptionist.id,
    status: "in_consultation",
  });
  return { tenantId: tenantA.id, visitId };
}

async function draftSaves(tenantId: string, visitId: string): Promise<number> {
  return (await auditRows(tenantId, "consultation.draft_save", visitId)).length;
}

test("a killed tab keeps everything saved up to 5 s before", async ({ page, context }) => {
  const { tenantId, visitId } = await seedOpenConsult("kill");
  await page.goto(`/consultation/${visitId}`);
  const notes = page.getByLabel(NOTES_LABEL);
  await expect(notes).toBeVisible();

  await notes.click();
  await page.keyboard.type("first line");
  // At most 5 s after the first unsaved change (the plan's bound), plus the round trip.
  await expect(page.locator("[data-save-status='saved']")).toBeVisible({ timeout: 9_000 });
  expect((await visitById(visitId))?.clinical_notes).toBe("first line");
  await page.keyboard.type(" second");

  // The tab dies: no beforeunload, no pagehide flush we could rely on, nothing from the second typing reached the server.
  await page.close({ runBeforeUnload: false });

  const reopened = await context.newPage();
  await reopened.goto(`/consultation/${visitId}`);
  await expect(reopened.getByLabel(NOTES_LABEL)).toHaveValue("first line");
  expect((await visitById(visitId))?.clinical_notes).toBe("first line");
  expect(await draftSaves(tenantId, visitId)).toBe(1);
});

test("typing continuously does not push the save back: a key every 500 ms for 12 s saves at least twice", async ({ page }) => {
  const { tenantId, visitId } = await seedOpenConsult("cadence");
  await page.goto(`/consultation/${visitId}`);
  const notes = page.getByLabel(NOTES_LABEL);
  await expect(notes).toBeVisible();

  await notes.click();
  const text = "abcdefghijklmnopqrstuvwx"; // 24 keys, 500 ms apart
  await notes.pressSequentially(text, { delay: 500 });
  // Still typing a moment ago: at least two saves already reached the server before the last key.
  expect(await draftSaves(tenantId, visitId)).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await visitById(visitId))?.clinical_notes, { timeout: 9_000 }).toBe(text);
});

async function draftRow(visitId: string) {
  const { data, error } = await getAdminClient()
    .from("clinical_notes")
    .select("clinical_notes, advice, vitals, draft_version")
    .eq("visit_id", visitId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

const savedStatus = (page: Page) => page.locator("[data-save-status='saved']");
const conflictDialog = (page: Page) => page.getByRole("alertdialog", { name: CONFLICT_TITLE });

async function twoTabs(context: import("@playwright/test").BrowserContext, visitId: string) {
  const a = await context.newPage();
  const b = await context.newPage();
  for (const page of [a, b]) {
    await page.goto(`/consultation/${visitId}`);
    await expect(page.getByLabel(NOTES_LABEL)).toBeVisible();
  }
  return { a, b };
}

test.describe("two tabs of one doctor on one consult (R-5)", () => {
  test("overlapping note edits show the prompt; 'Use the other version' takes the other tab's note and leaves the database as it was", async ({ context }) => {
    const { tenantId, visitId } = await seedOpenConsult("overlap-theirs");
    const { a, b } = await twoTabs(context, visitId);

    await a.getByLabel(NOTES_LABEL).fill("Note typed in tab A");
    await expect(savedStatus(a)).toBeVisible({ timeout: 9_000 });
    await b.getByLabel(NOTES_LABEL).fill("Note typed in tab B");
    await expect(conflictDialog(b)).toBeVisible({ timeout: 12_000 });
    await expect(conflictDialog(b)).toContainText("Notes");

    await conflictDialog(b).getByRole("button", { name: "Use the other version" }).click();
    await expect(conflictDialog(b)).toHaveCount(0);
    await expect(b.getByLabel(NOTES_LABEL)).toHaveValue("Note typed in tab A");
    expect(await draftRow(visitId)).toMatchObject({ clinical_notes: "Note typed in tab A", draft_version: 1 });
    expect(await draftSaves(tenantId, visitId)).toBe(1);
  });

  test("'Keep mine' saves this tab's note over the other, audited once with conflict_overwrite", async ({ context }) => {
    const { tenantId, visitId } = await seedOpenConsult("overlap-mine");
    const { a, b } = await twoTabs(context, visitId);

    await a.getByLabel(NOTES_LABEL).fill("Note typed in tab A");
    await expect(savedStatus(a)).toBeVisible({ timeout: 9_000 });
    await b.getByLabel(NOTES_LABEL).fill("Note typed in tab B");
    await expect(conflictDialog(b)).toBeVisible({ timeout: 12_000 });
    await conflictDialog(b).getByRole("button", { name: "Keep mine" }).click();
    await expect(conflictDialog(b)).toHaveCount(0);
    await expect(savedStatus(b)).toBeVisible({ timeout: 9_000 });

    expect(await draftRow(visitId)).toMatchObject({ clinical_notes: "Note typed in tab B", draft_version: 2 });
    const rows = await auditRows(tenantId, "consultation.draft_save", visitId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => (r.metadata as { conflict_overwrite?: boolean }).conflict_overwrite === true)).toHaveLength(1);
  });

  test("changes to different fields merge with no prompt: advice in one tab, the note in the other", async ({ context }) => {
    const { visitId } = await seedOpenConsult("disjoint");
    const { a, b } = await twoTabs(context, visitId);

    await a.getByRole("button", { name: new RegExp(ADVICE_CHIP) }).click();
    await expect(savedStatus(a)).toBeVisible({ timeout: 9_000 });
    await b.getByLabel(NOTES_LABEL).fill("Doctor note from the other tab");
    await expect
      .poll(async () => draftRow(visitId), { timeout: 20_000 })
      .toMatchObject({ clinical_notes: "Doctor note from the other tab", advice: [ADVICE_CHIP], draft_version: 2 });
    await expect(conflictDialog(b)).toHaveCount(0);
    // The advice that arrived from the other tab is on this screen too.
    await expect(b.getByText(ADVICE_CHIP).first()).toBeVisible();
  });

  test("a nurse records vitals on Today while the doctor types a note: both survive, the nurse is the vitals recorder", async ({ page, browser }) => {
    const { visitId, name } = await seedWaitingToday(todayName("DraftVitals"));
    await page.goto(`/consultation/${visitId}`);
    await expect(page.getByLabel(NOTES_LABEL)).toBeVisible();

    const blocked: string[] = [];
    const nurseContext = await browser.newContext({ baseURL: E2E_BASE_URL, serviceWorkers: "block", storageState: storageStatePath("nurse") });
    await routeLoopbackOnly(nurseContext, blocked);
    try {
      const nurse = await nurseContext.newPage();
      await openToday(nurse);
      await filterToday(nurse, name);
      await showLane(nurse, "Waiting");
      await rowOf(nurse, name).getByRole("button", { name: `Record vitals for ${name}` }).click();
      const sheet = nurse.getByRole("dialog", { name: "Record vitals" });
      await sheet.locator('[data-vital="systolic"]').fill("128");
      await sheet.locator('[data-vital="diastolic"]').fill("84");
      await sheet.getByRole("button", { name: "Save vitals" }).click();
      await expect.poll(() => vitalsOfVisit(visitId), { timeout: 20_000 }).toMatchObject({ systolic: 128, diastolic: 84 });
    } finally {
      await nurseContext.close();
    }
    expect(blocked).toEqual([]);

    // The doctor's tab still holds the version it read before the nurse wrote: its save conflicts at the database and is merged, not refused.
    await page.getByLabel(NOTES_LABEL).fill("Doctor's note after triage");
    await expect.poll(async () => (await draftRow(visitId)).clinical_notes, { timeout: 20_000 }).toBe("Doctor's note after triage");
    const row = await draftRow(visitId);
    expect(row.vitals).toMatchObject({ systolic: 128, diastolic: 84, recorded_by: run().tenantA.users.nurse.id });
    await expect(conflictDialog(page)).toHaveCount(0);
    // The doctor's first save also started the consultation (the visit was waiting).
    await expect.poll(() => visitStatusOf(visitId)).toBe("in_consultation");
  });
});

test.describe("offline, lost responses and leaving", () => {
  test("offline: the state says so, the text stays, nothing is sent; back online it is saved", async ({ page, context }) => {
    const { tenantId, visitId } = await seedOpenConsult("offline");
    await page.goto(`/consultation/${visitId}`);
    await expect(page.getByLabel(NOTES_LABEL)).toBeVisible();

    await context.setOffline(true);
    await page.getByLabel(NOTES_LABEL).fill("Typed with no network");
    await expect(page.locator("[data-save-status='offline']")).toBeVisible({ timeout: 9_000 });
    await expect(page.locator("[data-save-status='offline']")).toContainText("Offline · not saved. Reconnect to save");
    await expect(page.getByLabel(NOTES_LABEL)).toHaveValue("Typed with no network");
    expect((await visitById(visitId))?.clinical_notes).toBeNull();

    await context.setOffline(false);
    await expect(savedStatus(page)).toBeVisible({ timeout: 15_000 });
    expect((await visitById(visitId))?.clinical_notes).toBe("Typed with no network");
    expect(await draftSaves(tenantId, visitId)).toBe(1);
  });

  test("spec 7 leg, lost once: the automatic retry replays the same request id, so the version rises once", async ({ page }) => {
    const { tenantId, visitId } = await seedOpenConsult("lost-once");
    const marker = `lost-once-${testTag()}`;
    await page.goto(`/consultation/${visitId}`);
    await expect(page.getByLabel(NOTES_LABEL)).toBeVisible();
    const cut = await commitThenAbort(page, { first: 1, matches: (r) => (r.postData() ?? "").includes(marker) });

    await page.getByLabel(NOTES_LABEL).fill(marker);
    await expect(savedStatus(page)).toBeVisible({ timeout: 20_000 });
    expect(cut.aborted).toBe(1);
    await cut.clear();
    expect(await draftRow(visitId)).toMatchObject({ clinical_notes: marker, draft_version: 1 });
    expect(await draftSaves(tenantId, visitId)).toBe(1);
  });

  test("spec 7 leg, lost on every attempt: 'Couldn't save' with Retry; Retry after the route is cleared leaves the version raised once", async ({ page }) => {
    const { tenantId, visitId } = await seedOpenConsult("lost-all");
    const marker = `lost-all-${testTag()}`;
    await page.goto(`/consultation/${visitId}`);
    await expect(page.getByLabel(NOTES_LABEL)).toBeVisible();
    const cut = await commitThenAbort(page, { first: "all", matches: (r) => (r.postData() ?? "").includes(marker) });

    await page.getByLabel(NOTES_LABEL).fill(marker);
    const failed = page.locator("[data-save-status='error']");
    await expect(failed).toBeVisible({ timeout: 40_000 });
    await expect(failed).toContainText("Couldn't save");
    await expect(page.getByLabel(NOTES_LABEL)).toHaveValue(marker);
    expect(cut.aborted).toBeGreaterThanOrEqual(2);
    await cut.clear();

    await failed.getByRole("button", { name: "Retry" }).click();
    await expect(savedStatus(page)).toBeVisible({ timeout: 20_000 });
    // The first attempt committed, the others replayed it: one version, one audit row.
    expect(await draftRow(visitId)).toMatchObject({ clinical_notes: marker, draft_version: 1 });
    expect(await draftSaves(tenantId, visitId)).toBe(1);
  });

  test("the unload guard exists only while the draft is dirty", async ({ page, context }) => {
    const { visitId } = await seedOpenConsult("unload");
    await page.goto(`/consultation/${visitId}`);
    await expect(page.getByLabel(NOTES_LABEL)).toBeVisible();

    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });

    // Dirty: the browser asks before the page goes away.
    await page.getByLabel(NOTES_LABEL).fill("Unsaved words");
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => dialogs).toEqual(["beforeunload"]);
    expect(page.isClosed()).toBe(false);

    // Saved: no question, the page closes.
    await expect(savedStatus(page)).toBeVisible({ timeout: 12_000 });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(dialogs).toEqual(["beforeunload"]);
    expect(context.pages().includes(page)).toBe(false);
  });
});
