/**
 * V2-09b 09B-06a: the consult rows of the review fix round (09B-REVIEW-TRIAGE.md), each on real rows:
 *   - A-1  taps that have not been sent yet are saved when the doctor leaves the consult inside the app (a link, a history step), before the 5 s timer.
 *          The taps are advice tiles dispatched as click events that move no focus, as a tap on an iPad does (Safari does not focus a button), so no
 *          `focusout` save can hide the defect (a complaint tile is not used here: adding a complaint moves focus to its duration on purpose, and in
 *          Chromium removing a focused element fires `focusout`, which saves on its own);
 *   - A-2  a template never silently replaces free-text findings an older record holds: it asks, and "Keep what I entered" keeps them;
 *   - A-3  no follow-up is preselected: an unrelated edit stores none; a tap on a tile stores it;
 *   - A-6  after Amend, Finalize and Amend again, the first save carries only what the doctor changed then (the saver starts from the server's copy);
 *   - A-7  an out-of-range vital is marked in place and held back while the other edits save; corrected, it is saved.
 * Real time (the consult formats clinic dates with TZDate, which Playwright's fake Date breaks: tests/e2e/support/clock.ts). Synthetic data only.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { istDate, run, seedPatient, seedSignedConsultation, seedVisit, testTag } from "../support/m0-data";
import { getAdminClient } from "../../helpers/supabase-admin";
import { storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("doctor") });

const NOTES_LABEL = "History of Present Illness & Clinical Notes";
const saved = (page: Page) => page.locator("[data-save-status='saved']");

async function seedOpenConsult(label: string) {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Review ${label} ${testTag()}`);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.receptionist.id,
    status: "in_consultation",
  });
  return { tenantId: tenantA.id, visitId };
}

async function openConsult(page: Page, visitId: string) {
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel(NOTES_LABEL)).toBeVisible();
  await awaitHydrated(page);
}

async function notesRow(visitId: string) {
  const { data, error } = await getAdminClient()
    .from("clinical_notes")
    .select("chief_complaints, clinical_notes, specialty_data, vitals, draft_version")
    .eq("visit_id", visitId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

const complaintNames = async (visitId: string) => ((await notesRow(visitId)).chief_complaints as Array<{ symptom: string }>).map((c) => c.symptom);

async function followUpOf(visitId: string): Promise<string | null> {
  const { data, error } = await getAdminClient().from("follow_ups").select("follow_up_date").eq("visit_id", visitId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.follow_up_date ?? null;
}

async function draftSaveAudits(tenantId: string, visitId: string): Promise<Array<{ fields_changed: string[] }>> {
  const { data, error } = await getAdminClient()
    .from("audit_logs")
    .select("metadata, id")
    .eq("tenant_id", tenantId)
    .eq("action", "consultation.draft_save")
    .eq("entity_id", visitId)
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.metadata as { fields_changed: string[] });
}

/** A tap that moves no focus (an iPad tap on a button): the click event only. */
async function tap(target: Locator) {
  await expect(target).toBeVisible();
  await target.dispatchEvent("click");
}

const adviceTile = (page: Page, name: string) => page.getByRole("group", { name: "Diet and general advice" }).getByRole("button", { name, exact: true });
const adviceOf = async (visitId: string) => {
  const { data, error } = await getAdminClient().from("clinical_notes").select("advice").eq("visit_id", visitId).single();
  if (error) throw new Error(error.message);
  return data.advice as string[];
};
const noFocus = (page: Page) => page.evaluate(() => document.activeElement === document.body || document.activeElement === null);

const complaintTile = (page: Page, name: string) => page.getByRole("group", { name: "Complaints", exact: true }).getByRole("button", { name, exact: true });

test.describe("A-1: unsent taps are saved when the doctor leaves inside the app", () => {
  test("a link to Today, tapped within 5 s of two advice taps, saves them", async ({ page }) => {
    const { tenantId, visitId } = await seedOpenConsult("Leave Link");
    await openConsult(page, visitId);
    await tap(adviceTile(page, "Steam inhalation twice daily"));
    await tap(adviceTile(page, "Low salt diet"));
    await expect(adviceTile(page, "Low salt diet")).toHaveAttribute("aria-pressed", "true");
    // Nothing was sent yet: no timer has run and nothing is focused.
    expect(await noFocus(page)).toBe(true);
    expect(await draftSaveAudits(tenantId, visitId)).toHaveLength(0);

    await page.locator('a[href="/today"]').first().dispatchEvent("click");
    await expect(page).toHaveURL(/\/today/);
    await expect.poll(() => adviceOf(visitId), { timeout: 12_000 }).toEqual(["Steam inhalation twice daily", "Low salt diet"]);
  });

  test("a history step (Forward to the page the doctor came from) within 5 s of a tap saves it", async ({ page }) => {
    const { visitId } = await seedOpenConsult("Leave History");
    await openConsult(page, visitId);
    // A marker on the window proves every step below is a client-side navigation (a document load would clear it and fire pagehide, which saves anyway).
    const sameDocument = () => page.evaluate(() => (window as unknown as { __e2eDocMark?: number }).__e2eDocMark === 1);
    await page.evaluate(() => ((window as unknown as { __e2eDocMark?: number }).__e2eDocMark = 1));
    // Make a client-side history entry: to Today by the app's link, then Back to the consult.
    await page.locator('a[href="/today"]').first().dispatchEvent("click");
    await expect(page).toHaveURL(/\/today/);
    await page.goBack();
    await expect(page.getByLabel(NOTES_LABEL)).toBeVisible();
    await awaitHydrated(page);
    expect(await sameDocument()).toBe(true);
    // Nothing focused, as after a tap on an iPad (removing a focused element fires focusout in Chromium, which would save by itself).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await tap(adviceTile(page, "Walk 30 min daily"));
    await expect(adviceTile(page, "Walk 30 min daily")).toHaveAttribute("aria-pressed", "true");
    expect(await noFocus(page)).toBe(true);
    await page.goForward();
    await expect(page).toHaveURL(/\/today/);
    expect(await sameDocument()).toBe(true);
    await expect.poll(() => adviceOf(visitId), { timeout: 12_000 }).toEqual(["Walk 30 min daily"]);
  });
});

test("A-2: a template asks before it replaces typed findings of an older record; Keep keeps them", async ({ page }) => {
  const { visitId } = await seedOpenConsult("Legacy Exam");
  const legacy = "Synthetic systolic murmur at apex";
  const seeded = await getAdminClient()
    .from("clinical_notes")
    .update({ specialty_data: { specialty: "general_physician", systemic: { cvs: legacy } } })
    .eq("visit_id", visitId)
    .select("draft_version")
    .single();
  if (seeded.error) throw new Error(seeded.error.message);
  await openConsult(page, visitId);
  const typed = page.getByLabel("Cardiovascular System (CVS)");
  await expect(typed).toHaveValue(legacy);

  const templates = page.getByRole("radiogroup", { name: "Examination template" });
  await templates.getByRole("radio", { name: /^GP general/ }).click();
  const ask = page.getByRole("alertdialog", { name: "Replace the typed findings with GP general?" });
  await expect(ask).toBeVisible();
  await expect(ask).toContainText("Cardiovascular System (CVS)");
  await ask.getByRole("button", { name: "Keep what I entered" }).click();
  await expect(ask).toBeHidden();
  await expect(typed).toHaveValue(legacy);
  await expect(page.locator("[data-exam]")).toHaveCount(0);
  // Nothing was written: the row is as seeded.
  const row = await notesRow(visitId);
  expect(row.draft_version).toBe(seeded.data.draft_version);
  expect(row.specialty_data).toEqual({ specialty: "general_physician", systemic: { cvs: legacy } });

  // Confirmed, the template applies (the doctor chose it).
  await templates.getByRole("radio", { name: /^GP general/ }).click();
  await ask.getByRole("button", { name: "Switch" }).click();
  await expect(page.locator('[data-exam-system="cvs"]')).toBeVisible();
  await expect(saved(page)).toBeVisible({ timeout: 9_000 });
  await expect
    .poll(async () => ((await notesRow(visitId)).specialty_data as { systemic?: { cvs?: string } }).systemic?.cvs ?? "", { timeout: 12_000 })
    .toMatch(/^Normal: /);
});

test("A-3: no follow-up is preselected; an unrelated edit stores none, a tap on a tile stores it", async ({ page }) => {
  const { visitId } = await seedOpenConsult("No Default Follow-up");
  await openConsult(page, visitId);
  const followUp = page.getByRole("radiogroup", { name: "Follow-up" });
  for (const radio of await followUp.getByRole("radio").all()) await expect(radio).not.toBeChecked();
  await expect(followUp.getByRole("radio", { name: /5 days/ })).toContainText("suggested");
  await expect(page.locator("[data-follow-up-unset]")).toBeVisible();

  await complaintTile(page, "Fever").click();
  await expect(saved(page)).toBeVisible({ timeout: 9_000 });
  await expect.poll(() => complaintNames(visitId), { timeout: 12_000 }).toEqual(["Fever"]);
  expect(await followUpOf(visitId)).toBeNull();

  await followUp.getByRole("radio", { name: /5 days/ }).click();
  await expect(followUp.getByRole("radio", { name: /5 days/ })).toBeChecked();
  await expect.poll(() => followUpOf(visitId), { timeout: 12_000 }).toBe(istDate(5));
});

test("A-6: after Amend, Finalize and Amend again, the first save sends only the new change", async ({ page }) => {
  const { tenantA } = run();
  const { visitId } = await seedSignedConsultation("Second Amend");
  await page.setViewportSize({ width: 1280, height: 800 });
  await openConsult(page, visitId);

  const amend = async () => {
    await page.getByRole("button", { name: "Amend", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reopen Visit for Clinical Amendment" });
    await dialog.getByLabel(/Reason for Amendment/).fill("Synthetic amendment reason for the review fix round");
    await dialog.getByRole("button", { name: /Confirm & Reopen for Amendment/ }).click();
    await expect(page.getByTestId("amending-banner")).toBeVisible({ timeout: 30_000 });
    await awaitHydrated(page);
  };

  await amend();
  const notes = page.getByLabel(NOTES_LABEL);
  await notes.fill("E2E synthetic note, amended once");
  await expect(saved(page)).toBeVisible({ timeout: 9_000 });
  await expect.poll(async () => (await notesRow(visitId)).clinical_notes, { timeout: 12_000 }).toBe("E2E synthetic note, amended once");
  await page.getByRole("button", { name: "Finalize amendment" }).click();
  const confirm = page.getByRole("dialog", { name: "Finalize amendment" });
  await confirm.getByRole("button", { name: "Finalize amendment" }).click();
  await expect(page.getByTestId("signed-chip")).toContainText("Rx v2", { timeout: 30_000 });

  await amend();
  const before = (await draftSaveAudits(tenantA.id, visitId)).length;
  await complaintTile(page, "Fever").click();
  await expect.poll(async () => (await draftSaveAudits(tenantA.id, visitId)).length, { timeout: 12_000 }).toBe(before + 1);
  const last = (await draftSaveAudits(tenantA.id, visitId)).at(-1);
  expect(last?.fields_changed).toEqual(["chief_complaints"]);
  expect((await notesRow(visitId)).clinical_notes).toBe("E2E synthetic note, amended once");
});

test("A-7: an out-of-range vital is marked and held back while a complaint saves; corrected, it is saved", async ({ page }) => {
  const { visitId } = await seedOpenConsult("Vitals Held");
  await openConsult(page, visitId);
  const vitals = page.locator("#vitals");
  await vitals.getByRole("button", { name: "Edit vitals" }).click();
  const spo2 = vitals.getByPlaceholder("98", { exact: true });
  await spo2.fill("101");
  await expect(spo2).toHaveAttribute("aria-invalid", "true");
  await expect(vitals.locator("[data-vitals-invalid]")).toContainText("SpO2 must be <= 100%");

  await complaintTile(page, "Fever").click();
  await expect(saved(page)).toBeVisible({ timeout: 9_000 });
  await expect.poll(() => complaintNames(visitId), { timeout: 12_000 }).toEqual(["Fever"]);
  // The held-back reading was not sent: the stored vitals are still the empty default.
  expect((await notesRow(visitId)).vitals ?? {}).toEqual({});
  await expect(page.locator("[data-save-status='error']")).toHaveCount(0);

  await spo2.fill("98");
  await expect(vitals.locator("[data-vitals-invalid]")).toHaveCount(0);
  await expect.poll(async () => ((await notesRow(visitId)).vitals as { spo2?: number } | null)?.spo2 ?? null, { timeout: 12_000 }).toBe(98);
});
