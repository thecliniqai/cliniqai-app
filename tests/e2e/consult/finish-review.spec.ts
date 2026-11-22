/**
 * V2-09c 09C-05 (R-13, M4 criteria 2 and 5; CTO ruling Q-8; V2-DX step E): the finish review.
 *   - "Finish visit" then "Sign & Route to Reception" are two taps (the `ux` count): the review shows the lines and the follow-up date in the clinic's zone,
 *     the WhatsApp box is NOT ticked, the lock note is there, and signing queues NO message; the success screen offers Print Rx (the print view), Share PDF
 *     (or Download PDF) and the manual WhatsApp send;
 *   - the doctor ticks "Send ... on WhatsApp": exactly one consolidated message is queued, and a sign whose response is lost (retried with the same id) still
 *     leaves one row;
 *   - a patient who opted out has the box disabled with the reason and no message is queued; a patient with no phone number the same;
 *   - a medicine that matches a recorded allergy and has no reason disables Sign; "Go to ..." returns to the line, "Prescribe anyway" with a reason clears it, and
 *     Sign is enabled again;
 *   - on a phone the review fits 360 px.
 * Each test owns its doctor, clinic data and patient (three projects share one database). Synthetic data only.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { invoicesOf, istDate, prescriptionsOf, run, seedPatient, seedVisit, testTag, visitById } from "../support/m0-data";
import { storageStatePath, type RunUser } from "../support/run-data";
import { retireOwnDoctor, seedOwnDoctor, signInAsOwnDoctor } from "../support/own-doctor";
import { commitThenAbort } from "../support/commit-then-abort";
import { settleAnimations } from "../support/settle";
import { getAdminClient } from "../../helpers/supabase-admin";
import { messagesOfVisit } from "../../helpers/front-desk-commands";
import { formatClinicDateWithWeekday } from "../../../lib/datetime/format";

test.use({ storageState: storageStatePath("doctor") });

const admin = getAdminClient();
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
/** A number the message layer accepts (the seed's own numbers are not deliverable). */
const MESSAGEABLE = "+919876543210";
let doctor: RunUser | null = null;
test.afterEach(async () => {
  if (doctor) await retireOwnDoctor(doctor);
  doctor = null;
});

interface Setup {
  visitId: string;
  patientId: string;
  names: string[];
}

/** A consult in draft for the test's own doctor with `lines` already on the prescription (written as the service role on an unsigned visit, as the plan allows). */
async function openConsult(
  page: Page,
  label: string,
  opts: { phone?: string | null; optOut?: boolean; allergies?: string[] | null; lines?: string[] } = {},
): Promise<Setup> {
  const { tenantA } = run();
  const own = await seedOwnDoctor(label);
  doctor = own;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic ${label} ${testTag()}`);
  await admin
    .from("patients")
    .update({ phone: opts.phone === undefined ? MESSAGEABLE : (opts.phone ?? ""), whatsapp_opt_out: opts.optOut ?? false, allergies: opts.allergies ?? null })
    .eq("id", patient.id)
    .throwOnError();
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: own.id, createdBy: tenantA.users.receptionist.id, status: "in_consultation" });
  await admin.from("clinical_notes").update({ clinical_notes: "E2E synthetic note for the finish review" }).eq("visit_id", visitId).throwOnError();
  const tag = testTag().replace(/\W/g, "");
  const names = (opts.lines ?? [`Qzxfin Alpha ${tag}`, `Qzxfin Beta ${tag}`]).filter(Boolean);
  if (names.length > 0) {
    const header = await admin.from("prescriptions").insert({ tenant_id: tenantA.id, visit_id: visitId, patient_id: patient.id, doctor_id: own.id, version: 1, status: "active" }).select("id").single();
    if (header.error || !header.data) throw new Error(header.error?.message);
    await admin
      .from("prescription_items")
      .insert(names.map((medicine_name, i) => ({ tenant_id: tenantA.id, prescription_id: header.data.id, medicine_name, dosage: "1-0-1", timing: null, duration: "5 days", sort_order: i })))
      .throwOnError();
  }
  await signInAsOwnDoctor(page, own);
  // `window.print` is counted, not opened: the browser's own dialog is not drivable.
  await page.addInitScript(() => {
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => {
      (window as unknown as { __prints: number }).__prints += 1;
    };
  });
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
  return { visitId, patientId: patient.id, names };
}

/**
 * After a sign the success screen fetches the PDF for "Share PDF" and the page behind it reads the sealed record and does the same on its record bar. A test
 * that retires its doctor while one of those reads is in flight makes the storage read fail under RLS (the membership is gone), so each case waits for them first.
 */
async function settleAfterSign(page: Page) {
  await expect(page.locator("[data-share-pdf]").first()).toHaveAttribute("data-share-pdf", /^(share|download)$/, { timeout: 15_000 });
  await expect(page.locator('[data-share-pdf="loading"]')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
}

const finishButton = (page: Page) => page.getByRole("button", { name: /Finish visit/ }).first();
const reviewDialog = (page: Page) => page.getByRole("dialog", { name: "Complete & Sign Consultation" });
const consolidated = async (visitId: string) => (await messagesOfVisit(visitId)).filter((m) => m.template_id === "consultation_documents");

test("@golden two taps: Finish visit and Sign sign the visit, route the fee, queue no WhatsApp message, and offer Print, Share PDF and the manual send", async ({ page, ux }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "the tap count is the desktop project's");
  test.setTimeout(120_000);
  ux.flow("consult-finish-two-taps", "Finish visit, then Sign and finish: the review is the first tap's screen");
  const { visitId, names } = await openConsult(page, "FinishTwo");
  // The follow-up date comes from the draft (setup, not counted).
  await page.getByRole("radiogroup", { name: "Follow-up" }).getByRole("radio", { name: /5 days/ }).click();
  await expect.poll(async () => (await admin.from("follow_ups").select("follow_up_date").eq("visit_id", visitId).maybeSingle()).data?.follow_up_date, { timeout: 12_000 }).toBe(istDate(5));

  await ux.click(finishButton(page), "Finish visit");
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  // The review: what the patient receives (the lines and the follow-up date in the clinic's zone), no allergy block, the WhatsApp box off, the lock note.
  const summary = dialog.locator("[data-finish-summary]");
  for (const name of names) await expect(summary).toContainText(name);
  await expect(summary).toContainText(formatClinicDateWithWeekday(istDate(5)));
  await expect(dialog.locator("[data-finish-allergy]")).toHaveCount(0);
  const whatsapp = dialog.locator("[data-finish-whatsapp]");
  await expect(whatsapp).toBeEnabled();
  await expect(whatsapp).not.toBeChecked();
  await expect(dialog.locator("[data-finish-lock-note]")).toHaveText("Signing locks this prescription. Changes after signing are amendments with a reason.");

  await ux.click(dialog.getByRole("button", { name: /Sign & Route to Reception/ }), "Sign & Route to Reception");
  await expect(page.getByRole("heading", { name: "Consultation Finalized & Signed" })).toBeVisible({ timeout: 30_000 });
  ux.done();

  const visit = await visitById(visitId);
  expect(visit?.status).toBe("completed");
  expect(visit?.signed_at).toBeTruthy();
  expect((await prescriptionsOf(visitId))[0]).toMatchObject({ version: 1, items: 2 });
  const invoices = await invoicesOf(visitId);
  expect(invoices).toHaveLength(1);
  expect(invoices[0].payments).toEqual([]);
  // Nothing was sent on the doctor's behalf (Q-8).
  expect(await consolidated(visitId)).toHaveLength(0);

  // The success screen: the print view takes over from the PDF link once the page has read the sealed record; Print opens the browser's dialog once.
  const done = page.getByRole("dialog");
  const print = done.locator("[data-print-rx]");
  await expect(print).toHaveAttribute("data-print-rx", "view", { timeout: 15_000 });
  await print.click();
  expect(await page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1);
  // Share PDF where the device can share files, Download PDF where it cannot (Chromium on desktop: no file share); never an empty control.
  await expect(done.locator("[data-share-pdf]")).toHaveAttribute("data-share-pdf", /^(share|download)$/, { timeout: 15_000 });
  // The manual WhatsApp send is still one tap away.
  await expect(done.getByRole("button", { name: "WhatsApp" }).first()).toBeVisible();
  await settleAfterSign(page);
});

test("a ticked WhatsApp box queues exactly one consolidated message; a sign whose response is lost and retried still leaves one", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "the retry timing is the desktop project's");
  test.setTimeout(120_000);
  const { visitId } = await openConsult(page, "FinishWa");
  await finishButton(page).click();
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.locator("[data-finish-whatsapp]").check();
  // The response of the sign is cut once after the server has committed: the sheet retries with the same request id and the command replays.
  const cut = await commitThenAbort(page, { first: 1, matches: (r) => (r.postData() ?? "").includes("payment_collected") });
  await dialog.getByRole("button", { name: /Sign & Route to Reception/ }).click();
  await expect(page.getByRole("heading", { name: "Consultation Finalized & Signed" })).toBeVisible({ timeout: 40_000 });
  await cut.clear();
  expect(cut.aborted).toBe(1);
  const queued = await consolidated(visitId);
  expect(queued).toHaveLength(1);
  expect(queued[0].dedupe_key).toMatch(new RegExp(`consultation_documents:${visitId}$`));
  expect((await invoicesOf(visitId)).length).toBe(1);
  await settleAfterSign(page);
});

test("a patient who opted out of WhatsApp, or has no phone number, has the box disabled with the reason and no message is queued", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "one project covers the states");
  test.setTimeout(120_000);
  const optedOut = await openConsult(page, "FinishOptOut", { optOut: true });
  await finishButton(page).click();
  let dialog = reviewDialog(page);
  await expect(dialog.locator("[data-finish-whatsapp]")).toBeDisabled();
  await expect(dialog.locator("[data-finish-whatsapp]")).not.toBeChecked();
  await expect(dialog).toContainText("This patient has asked not to be messaged on WhatsApp.");
  await dialog.getByRole("button", { name: /Sign & Route to Reception/ }).click();
  await expect(page.getByRole("heading", { name: "Consultation Finalized & Signed" })).toBeVisible({ timeout: 30_000 });
  expect(await consolidated(optedOut.visitId)).toHaveLength(0);
  await settleAfterSign(page);

  await retireOwnDoctor(doctor!);
  const noPhone = await openConsult(page, "FinishNoPhone", { phone: "" });
  await finishButton(page).click();
  dialog = reviewDialog(page);
  await expect(dialog.locator("[data-finish-whatsapp]")).toBeDisabled();
  await expect(dialog).toContainText("This patient has no phone number on file.");
  await dialog.getByRole("button", { name: /Sign & Route to Reception/ }).click();
  await expect(page.getByRole("heading", { name: "Consultation Finalized & Signed" })).toBeVisible({ timeout: 30_000 });
  expect(await consolidated(noPhone.visitId)).toHaveLength(0);
  await settleAfterSign(page);
});

test("a medicine that matches a recorded allergy disables Sign until it has a reason; Go to returns to the line", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "one project covers the gate");
  test.setTimeout(120_000);
  const tag = testTag().replace(/\W/g, "");
  const medicine = `Qzxallergen ${tag} 625`;
  const { visitId } = await openConsult(page, "FinishAllergy", { allergies: ["Qzxallergen"], lines: [medicine, `Qzxfin Clear ${tag}`] });
  await finishButton(page).click();
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  const block = dialog.locator("[data-finish-allergy]");
  await expect(block).toBeVisible();
  await expect(block).toContainText("A medicine matches a recorded allergy");
  await expect(block).toContainText("matches Qzxallergen");
  const sign = dialog.getByRole("button", { name: /Sign & Route to Reception/ });
  await expect(sign).toBeDisabled();
  // Nothing is signed by a stray Enter in the sheet.
  await dialog.locator("[data-finish-summary]").click();
  expect((await visitById(visitId))?.signed_at).toBeNull();

  // Go to the line: the sheet closes and the line's own action has the focus.
  await block.getByRole("button", { name: `Go to ${medicine}` }).click();
  await expect(dialog).toBeHidden();
  const line = page.locator(`[data-rx-line-id]`).filter({ hasText: medicine });
  await expect(line).toHaveAttribute("data-flagged", "true");
  await expect(line.getByRole("button", { name: "Prescribe anyway…" })).toBeFocused({ timeout: 5_000 });
  await line.getByRole("button", { name: "Prescribe anyway…" }).click();
  await line.getByLabel("Reason to prescribe anyway").fill("Tolerated before, patient informed");
  await line.getByRole("button", { name: "Prescribe anyway", exact: true }).click();
  await expect(line.locator("[data-allergy-match]")).toHaveCount(0, { timeout: 10_000 });

  await finishButton(page).click();
  await expect(reviewDialog(page)).toBeVisible();
  await expect(reviewDialog(page).locator("[data-finish-allergy]")).toHaveCount(0);
  await expect(reviewDialog(page).getByRole("button", { name: /Sign & Route to Reception/ })).toBeEnabled();
});

test("@golden at 360 px the review fits with no horizontal scroll and is axe clean", async ({ page }, testInfo) => {
  test.skip(!["pixel-7", "iphone-15"].includes(testInfo.project.name), "the phone projects");
  test.setTimeout(120_000);
  await openConsult(page, "FinishPhone");
  await page.setViewportSize({ width: 360, height: 780 });
  await finishButton(page).click();
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-finish-summary]")).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(0);
  const box = await dialog.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 360).toBe(true);
  await settleAnimations(page);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});
