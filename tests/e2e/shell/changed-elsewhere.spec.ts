/**
 * V2-09e 09E-06 (R-9, R-18): "Changed on another device · Refresh" on a screen that never re-renders by itself, and the patient view audit that rule protects.
 *
 * - a booking for the OPEN patient made in another browser shows the notice in the first within seconds; the first screen does not re-render, makes no
 *   render request and writes no new `patient.view` row; Refresh renders it again (one more row) and the notice is answered;
 * - a change in a domain the screen does not show (a payment, for a patient: it shows schedule and billing, so use Staff, which shows settings) raises none;
 * - a patient's opening writes ONE `patient.view` row; rendering the Patients list, hovering and focusing a row's link write none (no prefetch of
 *   `/patients/[id]`, R-9).
 * desktop-chrome (the rule and the rows do not depend on the device). Synthetic data only; the patient is this spec's own.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { getAdminClient } from "../../helpers/supabase-admin";
import { storageStatePath } from "../support/run-data";
import { appToday, istInstant, run, seedPatient, testTag } from "../support/m0-data";

test.use({ storageState: storageStatePath("owner") });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "the rule and the audit rows do not depend on the device");
});

async function viewRows(patientId: string): Promise<number> {
  const { count, error } = await getAdminClient()
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", "patient.view")
    .eq("entity_id", patientId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Resolves when the shell's private channel of the clinic has been joined (the browser's own socket), so a change made afterwards is signalled to this page. */
function channelJoined(page: Page): Promise<void> {
  return new Promise((resolve) => {
    page.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => {
        const text = typeof frame.payload === "string" ? frame.payload : "";
        if (text.includes("phx_reply") && text.includes("today:") && text.includes('"status":"ok"')) resolve();
      });
    });
  });
}

const notice = (page: Page) => page.getByRole("status").filter({ hasText: "Changed on another device" });

test("a booking for the open patient made elsewhere shows the notice; nothing re-renders and no new view is written until Refresh", async ({ page }) => {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Elsewhere ${testTag()}`);
  const joined = channelJoined(page);
  const renders: string[] = [];
  await page.goto(`/patients/${patient.id}`);
  await expect(page.getByRole("heading", { name: /E2E Synthetic Elsewhere/ }).first()).toBeVisible();
  await joined;
  // Fail-closed (09E-14a): the row is written before the record is shown, so it is there as soon as the page is, with no waiting.
  expect(await viewRows(patient.id), "the opening wrote one patient.view row").toBe(1);
  await expect(notice(page)).toHaveCount(0);
  // PR 2 review N1: the channel now joins about 1 s after the page (it was refused and rejoined after ~6 s), before Next's idle-time prefetch of the
  // navigation links; the count starts once the page's own load traffic has settled, so it measures what the change causes, every RSC request included.
  await page.waitForLoadState("networkidle");
  page.on("request", (request) => {
    if (request.headers()["rsc"] === "1") renders.push(request.url());
  });

  // The other device: a booking for this patient (a schedule and queue change, committed by someone else).
  const { error } = await getAdminClient().from("visits").insert({
    tenant_id: tenantA.id,
    patient_id: patient.id,
    doctor_id: tenantA.users.doctor.id,
    origin_type: "scheduled",
    status: "booked",
    scheduled_at: istInstant(appToday(), "11:30"),
    is_overbooked: true,
    created_by: tenantA.users.receptionist.id,
  });
  expect(error).toBeNull();

  await expect(notice(page)).toBeVisible({ timeout: 10_000 });
  await expect(notice(page).getByRole("button", { name: "Refresh" })).toBeVisible();
  // Nothing re-rendered by itself: no render request, still one view row.
  await page.waitForTimeout(1_500);
  expect(renders, "no render request until Refresh").toEqual([]);
  expect(await viewRows(patient.id), "no new patient.view row until Refresh").toBe(1);

  await notice(page).getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => viewRows(patient.id), { message: "Refresh renders the record again: one more view" }).toBe(2);
  await expect(notice(page)).toHaveCount(0);
  // Answered: it stays answered.
  await page.waitForTimeout(1_500);
  await expect(notice(page)).toHaveCount(0);
});

test("Staff and clinic settings show the notice when the clinic's settings change elsewhere (a letterhead margin, restored after)", async ({ page }) => {
  const { tenantA } = run();
  const admin = getAdminClient();
  const { data: before, error: readError } = await admin.from("tenants").select("letterhead_top_margin").eq("id", tenantA.id).single();
  expect(readError).toBeNull();
  const original = Number(before!.letterhead_top_margin);
  try {
    for (const path of ["/staff", "/settings/clinic"]) {
      const joined = channelJoined(page);
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await joined;
      await expect(notice(page)).toHaveCount(0);
      const { error } = await admin.from("tenants").update({ letterhead_top_margin: original + 1 }).eq("id", tenantA.id);
      expect(error).toBeNull();
      await expect(notice(page)).toBeVisible({ timeout: 10_000 });
      await notice(page).getByRole("button", { name: "Refresh" }).click();
      await expect(notice(page)).toHaveCount(0);
      await admin.from("tenants").update({ letterhead_top_margin: original }).eq("id", tenantA.id);
    }
  } finally {
    await admin.from("tenants").update({ letterhead_top_margin: original }).eq("id", tenantA.id);
  }
});

test("a domain the screen does not show raises no notice (Staff shows settings only; a booking is not one)", async ({ page }) => {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Elsewhere Staff ${testTag()}`);
  const joined = channelJoined(page);
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: /Staff & Team/ }).first()).toBeVisible();
  await joined;
  const { error } = await getAdminClient().from("visits").insert({
    tenant_id: tenantA.id,
    patient_id: patient.id,
    doctor_id: tenantA.users.doctor.id,
    origin_type: "scheduled",
    status: "booked",
    scheduled_at: istInstant(appToday(), "11:45"),
    is_overbooked: true,
    created_by: tenantA.users.receptionist.id,
  });
  expect(error).toBeNull();
  await page.waitForTimeout(3_000);
  await expect(notice(page)).toHaveCount(0);
});

test("a patient's opening writes one patient.view row; rendering the list, hovering and focusing its link write none", async ({ page }) => {
  const { tenantA } = run();
  const name = `E2E Synthetic ViewAudit ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
  await page.goto("/patients");
  await page.getByPlaceholder("Search by name, phone, or ABHA...").fill(name);
  const link = page.getByRole("link", { name: new RegExp(name) }).first();
  await expect(link).toBeVisible();
  await link.hover();
  await link.focus();
  await page.waitForTimeout(2_000);
  expect(await viewRows(patient.id), "list, hover and focus wrote no view").toBe(0);
  await link.click();
  await page.waitForURL(`**/patients/${patient.id}`);
  await expect.poll(() => viewRows(patient.id)).toBe(1);
  await page.waitForTimeout(1_500);
  expect(await viewRows(patient.id), "one opening, one row").toBe(1);
});
