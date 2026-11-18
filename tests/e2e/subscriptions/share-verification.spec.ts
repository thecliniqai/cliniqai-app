/**
 * V2-05 05-12 (SUB-D6, SUB §7.2; IND L-4): an EXPIRED clinic's prescription link in the browser, on the PR lane's
 * device projects, signed out (a pharmacy opening the link).
 *
 * The page shows exactly the verification set: the clinic's name, "Valid prescription", the doctor's name and
 * registration number and the issue date, plus the clinic-unavailable note. It never shows the patient's name, the
 * document title or a download, and the download route answers 404 for the same token. axe 0 serious/critical
 * (WCAG 2.0/2.1/2.2 A+AA) at 360, 820 and 1280 px, no horizontal scroll at 360 px, screenshots attached.
 *
 * The clinic, its doctor, patient, visit, prescription and link are created by this spec with the service role; the
 * run's teardown removes them. Synthetic data only; the link token is never attached or logged.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "../fixtures";
import { getAdminClient } from "../../helpers/supabase-admin";
import { seedTenantSubscription } from "../../helpers/tenants";

test.use({ storageState: { cookies: [], origins: [] } });

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];

type Seeded = { token: string; clinic: string; doctor: string; registration: string; patient: string };

async function seedExpiredClinicPrescription(): Promise<Seeded> {
  const admin = getAdminClient();
  const tag = randomBytes(3).toString("hex");
  const clinic = `Synthetic Verify Clinic ${tag}`;
  const doctor = `Dr Synthetic Verifier ${tag}`;
  const registration = `SYN-REG-${tag.toUpperCase()}`;
  const patient = `Synthetic Patient Hidden ${tag}`;

  const { data: tenant, error: tErr } = await admin.from("tenants").insert({ name: clinic }).select("id").single();
  if (tErr || !tenant) throw new Error(`seed clinic failed: ${tErr?.code}`);
  const { data: user, error: uErr } = await admin.auth.admin.createUser({
    email: `verify-doctor-${tag}@example.test`,
    password: `V-${randomBytes(18).toString("base64url")}!9a`,
    email_confirm: true,
  });
  if (uErr || !user.user) throw new Error(`seed doctor failed: ${uErr?.status}`);
  const doctorId = user.user.id;
  const ins = async (table: string, row: Record<string, unknown>): Promise<string> => {
    const { data, error } = await admin.from(table as never).insert(row as never).select("id").single();
    if (error || !data) throw new Error(`seed ${table} failed: ${error?.code}`);
    return (data as { id: string }).id;
  };
  await ins("memberships", { tenant_id: tenant.id, user_id: doctorId, role: "owner", full_name: doctor, medical_council_reg_no: registration });
  const patientId = await ins("patients", { tenant_id: tenant.id, full_name: patient, phone: "+919000005129", created_by: doctorId });
  const visitId = await ins("visits", {
    tenant_id: tenant.id,
    patient_id: patientId,
    doctor_id: doctorId,
    origin_type: "walk_in",
    created_by: doctorId,
  });
  const rxId = await ins("prescriptions", { tenant_id: tenant.id, visit_id: visitId, patient_id: patientId, doctor_id: doctorId });
  const token = randomBytes(32).toString("hex");
  await ins("document_share_tokens", {
    tenant_id: tenant.id,
    resource_type: "prescription",
    resource_id: rxId,
    token_hash: createHash("sha256").update(token).digest("hex"),
    created_by: doctorId,
  });
  // The clinic's subscription ended 30 days ago: SUB-D6's "expired" (locked).
  await seedTenantSubscription(tenant.id, { status: "expired" });
  return { token, clinic, doctor, registration, patient };
}

async function check(page: Page, testInfo: TestInfo, name: string, width: number): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify({ url: "/r/<redacted>", violations: results.violations }, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach(`screenshot-${name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const blocking = results.violations
    .filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""))
    .map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")) }));
  expect(blocking, "serious/critical axe violations on the verification page").toEqual([]);
  if (width === 360) {
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(scrolls, "horizontal scroll at 360px").toBe(false);
  }
}

test.describe("SUB-D6: an expired clinic's prescription link", () => {
  test("shows only the verification metadata (no patient, no document, no download); axe and layout at 360/820/1280", async ({
    page,
    request,
  }, testInfo) => {
    const seeded = await seedExpiredClinicPrescription();
    for (const size of WIDTHS) {
      await page.setViewportSize(size);
      await page.goto(`/r/${seeded.token}`);
      const card = page.getByTestId("share-restricted");
      await expect(card).toBeVisible();
      await expect(card.getByRole("heading", { level: 1 })).toHaveText(seeded.clinic);
      await expect(page.getByTestId("share-verification-status")).toHaveText("Valid prescription");
      await expect(card).toContainText(seeded.doctor);
      await expect(card).toContainText(seeded.registration);
      await expect(card).toContainText("Issued on");
      await expect(page.locator("body")).not.toContainText(seeded.patient);
      await expect(page.getByText("Download Official PDF")).toHaveCount(0);
      await expect(page.locator("iframe, img[alt]")).toHaveCount(0);
      await check(page, testInfo, `share-verification-${size.width}`, size.width);
    }
    const download = await request.get(`/api/r/${seeded.token}?download=true`, { maxRedirects: 0 });
    expect(download.status()).toBe(404);
  });
});
