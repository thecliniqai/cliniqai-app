/**
 * Sign & Bill from the clinic fee, with the visit version (V2-10 10-02, D-10, D-11; the two items 09E deferred; threat T-10-05 "lost update on bills").
 *
 * Each test has a clinic of its own (the doctor signs in through the login UI; fees are set on that clinic only):
 * - @golden the clinic's fee is ₹650: the sheet opens with ₹650 (one context read), the chips are the clinic's consultation and follow-up fees, and the
 *   bill is written at ₹650 (database checked, also after a reload of the consult);
 * - @golden stale: between open and submit the desk checks the visit out through the command API (another device). Sign says "This changed on another
 *   device. The latest is shown.", nothing is signed and no invoice exists (database checked), and the fee the doctor typed is kept;
 * - a clinic with no fee set: the field starts empty, Sign asks for the fee and writes nothing (never ₹500);
 * - PWA-06b: the first send is lost on the network; the sheet retries once with the same request id (both POSTs carry it) and one bill exists.
 * Synthetic data only. 0 retries: a case that only passes on retry is a defect.
 */
import type { Page, Request } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { uiSignIn } from "../support/password-journeys";
import { invoicesOf, seedPatient, seedVisit, testTag } from "../support/m0-data";
import { addMemberToTenant, seededUserPassword, seedTenantWithOwner } from "../../helpers/tenants";
import { getAdminClient } from "../../helpers/supabase-admin";
import { callCompleteVisit } from "../../helpers/clinical-commands";
import { ROW_CHANGED_MESSAGE } from "@/lib/errors/row-changed";

test.use({ storageState: { cookies: [], origins: [] } });

interface Setup {
  tenantId: string;
  visitId: string;
  receptionist: Awaited<ReturnType<typeof addMemberToTenant>>;
}

/** A clinic of the test's own with its fees, a doctor (signed in on this page) and a receptionist (the other device); one visit in consultation (or waiting). */
async function signedInConsult(
  page: Page,
  fees: { consultation: number | null; followup: number | null },
  status: "in_consultation" | "waiting" = "in_consultation",
): Promise<Setup> {
  const tag = testTag();
  const owner = await seedTenantWithOwner(`E2E Synthetic SignBill ${tag}`);
  const doctor = await addMemberToTenant(owner.tenantId, "doctor");
  const receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  const admin = getAdminClient();
  const { error } = await admin.from("tenants").update({ default_consultation_fee: fees.consultation, default_followup_fee: fees.followup }).eq("id", owner.tenantId);
  if (error) throw new Error(`fees: ${error.message}`);
  const patient = await seedPatient(owner.tenantId, owner.userId, `E2E Synthetic SignBill ${tag}`);
  const visitId = await seedVisit({
    tenantId: owner.tenantId,
    patientId: patient.id,
    doctorId: doctor.userId,
    createdBy: receptionist.userId,
    status,
    scheduledAt: new Date().toISOString(),
  });
  const notes = await admin.from("clinical_notes").update({ clinical_notes: "E2E synthetic note" }).eq("visit_id", visitId);
  if (notes.error) throw new Error(`notes: ${notes.error.message}`);
  await uiSignIn(page, { email: doctor.userEmail, password: seededUserPassword() });
  await page.goto(`/consultation/${visitId}`);
  return { tenantId: owner.tenantId, visitId, receptionist };
}

async function openSignAndBill(page: Page) {
  await page.getByRole("button", { name: /Finish visit/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Complete & Sign Consultation" });
  await expect(dialog).toBeVisible();
  // The context read has answered (the fee field is enabled).
  await expect(dialog.locator("[data-sign-bill-ready]")).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function visitOf(visitId: string) {
  const { data, error } = await getAdminClient().from("visits").select("status, signed_at, row_version").eq("id", visitId).single();
  if (error) throw new Error(error.message);
  return data;
}

async function itemsOf(invoiceId: string) {
  const { data, error } = await getAdminClient().from("invoice_items").select("item_type, unit_price").eq("invoice_id", invoiceId);
  if (error) throw new Error(error.message);
  return data;
}

/** The Sign & Bill server action POSTs (the sign-off's arguments carry `expected_version`; the draft save does not). */
function signPosts(page: Page): Request[] {
  const seen: Request[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"] && (r.postData() ?? "").includes("expected_version")) seen.push(r);
  });
  return seen;
}

test("@golden the clinic's fee: the sheet opens at ₹650 with the clinic's fee chips, and the bill is ₹650", async ({ page }) => {
  const s = await signedInConsult(page, { consultation: 650, followup: 300 });
  const posts = signPosts(page);
  const dialog = await openSignAndBill(page);

  await expect(dialog.getByLabel(/^Consultation Fee/)).toHaveValue("650");
  const chips = dialog.getByRole("radiogroup", { name: "Clinic fees" });
  await expect(chips.getByRole("radio")).toHaveText([/Consultation\s*₹650/, /Follow-up\s*₹300/]);
  await expect(chips.getByRole("radio", { name: /Consultation/ })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.locator("[data-sign-bill-total]")).toHaveText("₹650");

  await dialog.getByRole("button", { name: /Sign & Route to Reception/ }).click();
  await expect(page.getByRole("heading", { name: "Consultation Finalized & Signed" })).toBeVisible({ timeout: 20_000 });
  // The version the sheet read was sent.
  expect(posts).toHaveLength(1);
  expect(posts[0]!.postData()).toContain(`"expected_version":0`);

  await page.reload();
  const invoices = await invoicesOf(s.visitId);
  expect(invoices.map((i) => [i.total_amount, i.status])).toEqual([[650, "issued"]]);
  expect(await itemsOf(invoices[0]!.id)).toEqual([{ item_type: "consultation", unit_price: 650 }]);
  expect((await visitOf(s.visitId)).status).toBe("completed");
});

test("@golden stale: the desk checks the visit out between open and Sign; Sign is refused with the fixed text, nothing is signed or billed, the typed fee stays", async ({ page }) => {
  // A waiting visit: the desk can complete it (an in-consultation visit is completed only by the sign-off).
  const s = await signedInConsult(page, { consultation: 650, followup: 300 }, "waiting");
  const dialog = await openSignAndBill(page);
  const fee = dialog.getByLabel(/^Consultation Fee/);
  await fee.fill("700");
  await fee.blur();
  await expect(fee).toHaveValue("700");

  // Another device: the receptionist completes the visit through the command API (what the desk's click sends).
  const version = (await visitOf(s.visitId)).row_version;
  const moved = await callCompleteVisit(s.receptionist.client, {
    p_tenant_id: s.tenantId,
    p_visit_id: s.visitId,
    p_client_request_id: randomUUID(),
    p_expected_version: version,
  });
  expect(moved.error).toBeNull();
  const after = await visitOf(s.visitId);
  expect(after.status).toBe("completed");

  await dialog.getByRole("button", { name: /Sign & Route to Reception/ }).click();
  await expect(dialog.getByText(ROW_CHANGED_MESSAGE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Consultation Finalized & Signed" })).toHaveCount(0);
  // Nothing was signed or billed.
  expect(await visitOf(s.visitId)).toEqual(after);
  expect(after.signed_at).toBeNull();
  expect(await invoicesOf(s.visitId)).toEqual([]);
  // The doctor's input is kept across the re-read; no Retry of the refused send is offered.
  await expect(fee).toHaveValue("700");
  await expect(dialog.locator('[data-save-status="error"]').getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("a clinic with no fee set: the fee field starts empty and Sign asks for it; nothing is written (never ₹500)", async ({ page }) => {
  const s = await signedInConsult(page, { consultation: null, followup: null });
  const dialog = await openSignAndBill(page);
  await expect(dialog.getByLabel(/^Consultation Fee/)).toHaveValue("");
  await expect(dialog.getByRole("radiogroup", { name: "Clinic fees" })).toHaveCount(0);
  await expect(dialog.getByText("₹500")).toHaveCount(0);

  await dialog.getByRole("button", { name: /Sign & Route to Reception/ }).click();
  await expect(dialog.getByText("Enter the consultation fee.")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await invoicesOf(s.visitId)).toEqual([]);
  expect((await visitOf(s.visitId)).signed_at).toBeNull();
});

test("PWA-06b: a send lost on the network is retried once with the same request id, and one bill exists", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop-chrome", "the retry rule is the same code on every device (lib/commands/use-command.ts)");
  const s = await signedInConsult(page, { consultation: 650, followup: 300 });
  const posts = signPosts(page);
  let dropped = 0;
  await page.route("**/*", (route) => {
    const r = route.request();
    if (dropped === 0 && r.method() === "POST" && r.headers()["next-action"] && (r.postData() ?? "").includes("expected_version")) {
      dropped += 1;
      return route.abort("internetdisconnected");
    }
    return route.fallback();
  });
  const dialog = await openSignAndBill(page);
  await dialog.getByRole("button", { name: /Sign & Route to Reception/ }).click();
  await expect(page.getByRole("heading", { name: "Consultation Finalized & Signed" })).toBeVisible({ timeout: 30_000 });
  expect(dropped).toBe(1);
  expect(posts).toHaveLength(2);
  const idOf = (r: Request) => /"client_request_id":"([0-9a-f-]{36})"/.exec(r.postData() ?? "")?.[1];
  expect(idOf(posts[0]!)).toBeTruthy();
  expect(idOf(posts[1]!)).toBe(idOf(posts[0]!));
  expect((await invoicesOf(s.visitId)).map((i) => i.total_amount)).toEqual([650]);
});
