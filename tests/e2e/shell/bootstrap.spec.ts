/**
 * The session bootstrap (V2-09e 09E-13, R-13, decision 1; T-09E-10). Screen B is a receptionist signed in through the login UI; "A" is another device of the
 * clinic whose committed writes reach the database as the owner's would (the statement triggers raise the clinic's `settings` version and send the signal).
 *
 * - signal: A renames the clinic and a doctor; B's shell shows the new clinic name and B's doctor picker the new doctor name within 2 s, with no page render;
 *   opening the walk-in sheet reads no doctor directory (Kong: no `memberships` or `tenants` call);
 * - dropped: with B's broadcast frames dropped (the channel stays joined) B sees the rename once its clock passes the 12 s heartbeat on Today;
 * - resume: on a screen with no heartbeat (Patients) and no socket, a rename made while B's tab was hidden shows when the tab is visible again;
 * - fees are never held (High, fails-without recorded in 09E-NOTES): A changes the clinic's consultation fee; B's next bill starts from the new fee and the
 *   invoice is written with it, with no refresh in between (the fee is read with the bill, not from the bootstrap);
 * - a role changed elsewhere: B's next command is refused at once whatever B's bootstrap still says (frames dropped, state reads held: the shell still says
 *   Receptionist), and nothing is written; without the drop, B's navigation follows on the settings signal (role label, Schedule moves to the secondary group).
 * - (PR 2 review I-1) two devices: the owner turns "practising" off and on in Settings on device A (a second browser context, the real form); B's open
 *   walk-in doctor picker drops the owner, then lists the owner again, with no page render on B (000132 moves `settings` and `schedule` on that column).
 * Each test has its own clinic. Synthetic data only. 0 retries: a case that only passes on retry is a defect.
 */
import type { Page } from "@playwright/test";
import { expect, routeLoopbackOnly, test } from "../fixtures";
import { E2E_BASE_URL } from "../support/app-env";
import { getAdminClient } from "../../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, seededUserPassword } from "../../helpers/tenants";
import { countKongCalls } from "../support/kong-calls";
import { invoicesOf, seedPatient, seedQueueToken, seedVisit, testTag } from "../support/m0-data";
import { uiSignIn } from "../support/password-journeys";
import { countRscRequests, dropBroadcastFrames, openBill, openToday } from "../support/today-page";

test.use({ storageState: { cookies: [], origins: [] } });

const HEARTBEAT_MS = 12_000;

interface Clinic {
  tenantId: string;
  tenantName: string;
  ownerId: string;
  ownerEmail: string;
  doctorId: string;
  doctorName: string;
  receptionist: { userId: string; userEmail: string };
}

/** A clinic of the test's own: the practising owner, one named doctor (two doctors: the pickers show a select) and the receptionist who is screen B. */
async function ownClinic(): Promise<Clinic> {
  const tag = testTag();
  const owner = await seedTenantWithOwner(`E2E Synthetic Bootstrap ${tag}`);
  const doctor = await addMemberToTenant(owner.tenantId, "doctor");
  const receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  const doctorName = `E2E Synthetic BootDoc ${tag}`;
  const { error } = await getAdminClient().from("memberships").update({ full_name: doctorName }).eq("tenant_id", owner.tenantId).eq("user_id", doctor.userId);
  if (error) throw new Error(`bootstrap seed: ${error.message}`);
  return { tenantId: owner.tenantId, tenantName: owner.tenantName, ownerId: owner.userId, ownerEmail: owner.userEmail, doctorId: doctor.userId, doctorName, receptionist };
}

/** A's write (another device): a committed update of the clinic's name. */
async function renameClinic(clinic: Clinic, name: string): Promise<void> {
  const { error } = await getAdminClient().from("tenants").update({ name }).eq("id", clinic.tenantId);
  if (error) throw new Error(`rename clinic: ${error.message}`);
}

async function renameDoctor(clinic: Clinic, name: string): Promise<void> {
  const { error } = await getAdminClient().from("memberships").update({ full_name: name }).eq("tenant_id", clinic.tenantId).eq("user_id", clinic.doctorId);
  if (error) throw new Error(`rename doctor: ${error.message}`);
}

async function signInB(page: Page, clinic: Clinic): Promise<void> {
  await uiSignIn(page, { email: clinic.receptionist.userEmail, password: seededUserPassword() });
}

/** Counts the bootstrap reads of the client data layer (`GET /api/session/bootstrap`). */
function countBootstrapReads(page: Page): () => number {
  let n = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/session/bootstrap") n += 1;
  });
  return () => n;
}

/** The clinic's name in the shell (the sidebar's; in the DOM at every width). */
const shellClinicName = (page: Page) => page.locator("[data-shell-clinic-name]");
const shellRole = (page: Page) => page.locator("[data-shell-role]");
const liveStatus = (page: Page) => page.locator("[data-live-status]").first();

async function hideAndShow(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const value of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
}

/**
 * Opens the walk-in sheet from Today's head (an in-app link: the page reads its board again, the shell and its bootstrap stay) and picks the seeded patient:
 * the visit fields, with the doctor picker, show once a patient is chosen.
 */
async function openWalkIn(page: Page, phone: string) {
  await page.locator("#main").getByRole("link", { name: "Add walk-in" }).filter({ visible: true }).first().click();
  const sheet = page.getByRole("dialog", { name: "Add walk-in" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("combobox", { name: "Patient" }).fill(phone.slice(-10));
  await sheet.getByRole("option").first().click();
  await expect(sheet.locator("[data-walkin-visit-fields]")).toBeVisible();
  return sheet;
}

test("@golden signal: a clinic and a doctor renamed elsewhere show in B's shell and doctor picker within 2 s; the sheet reads no directory", async ({ page }) => {
  const clinic = await ownClinic();
  const patient = await seedPatient(clinic.tenantId, clinic.ownerId, `E2E Synthetic BootWalk ${testTag()}`);
  await signInB(page, clinic);
  await openToday(page);
  await expect(shellClinicName(page)).toHaveText(clinic.tenantName);
  await expect(liveStatus(page)).toHaveAttribute("data-live-status", "live", { timeout: 20_000 });
  const reads = countBootstrapReads(page);
  const rsc = countRscRequests(page);

  const newClinic = `${clinic.tenantName} Renamed`;
  const newDoctor = `${clinic.doctorName} Renamed`;
  await renameClinic(clinic, newClinic);
  await renameDoctor(clinic, newDoctor);
  await expect(shellClinicName(page)).toHaveText(newClinic, { timeout: 2_000 });
  expect(rsc(), "no page render: the shell re-read the bootstrap query").toBe(0);

  // The doctor picker draws from the bootstrap: the new name, and no directory read when the sheet opens.
  let sheet!: Awaited<ReturnType<typeof openWalkIn>>;
  const window = await countKongCalls(async () => {
    sheet = await openWalkIn(page, patient.phone);
    await expect(sheet.getByRole("combobox", { name: "Doctor" }).locator("option", { hasText: newDoctor })).toHaveCount(1, { timeout: 2_000 });
  }, 250);
  const directoryReads = Object.entries(window.serverByPath).filter(([path]) => /\/rest\/v1\/(memberships|tenants)\b/.test(path));
  expect(directoryReads, `opening the sheet reads no doctor directory: ${JSON.stringify(window.serverByPath)}`).toEqual([]);
  await expect(sheet.getByRole("combobox", { name: "Doctor" }).locator("option", { hasText: clinic.doctorName }).filter({ hasNotText: "Renamed" })).toHaveCount(0);
  expect(reads(), "one or two bootstrap reads (one per transaction's signal, coalesced)").toBeGreaterThanOrEqual(1);
  expect(reads()).toBeLessThanOrEqual(2);
});

test("dropped: with B's frames dropped, a rename shows on Today once B's clock passes the 12 s heartbeat", async ({ page }) => {
  const clinic = await ownClinic();
  await page.clock.install();
  const drops = await dropBroadcastFrames(page);
  await signInB(page, clinic);
  await openToday(page);
  await expect(liveStatus(page)).toHaveAttribute("data-live-status", "live", { timeout: 20_000 });
  const reads = countBootstrapReads(page);

  const newClinic = `${clinic.tenantName} Dropped`;
  await renameClinic(clinic, newClinic);
  await expect.poll(() => drops.dropped(), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await expect(shellClinicName(page)).toHaveText(clinic.tenantName);
  expect(reads(), "nothing was read: the signal never arrived").toBe(0);

  await page.clock.runFor(HEARTBEAT_MS + 1_000);
  await expect(shellClinicName(page)).toHaveText(newClinic, { timeout: 10_000 });
  expect(reads(), "one bootstrap read after the heartbeat saw the settings version move").toBe(1);
});

test("resume: on a screen with no heartbeat, a rename made while B's tab was hidden shows when it is visible again", async ({ page }) => {
  const clinic = await ownClinic();
  // No signal can reach B (its Realtime socket is refused) and Patients has no heartbeat: only the check on resume can tell it.
  await page.routeWebSocket(/\/realtime\//, (ws) => void ws.close({ code: 1008, reason: "refused by the spec" }));
  await signInB(page, clinic);
  await page.goto("/patients");
  await expect(shellClinicName(page)).toHaveText(clinic.tenantName);
  await page.waitForLoadState("networkidle");
  const reads = countBootstrapReads(page);

  const newClinic = `${clinic.tenantName} Resumed`;
  await renameClinic(clinic, newClinic);
  await page.waitForTimeout(1_000);
  await expect(shellClinicName(page)).toHaveText(clinic.tenantName);
  expect(reads()).toBe(0);

  await hideAndShow(page);
  await expect(shellClinicName(page)).toHaveText(newClinic, { timeout: 5_000 });
  expect(reads(), "one bootstrap read after the resume check saw the settings version move").toBe(1);
});

/** A completed, signed visit of the owner with its token: on Today's Bill lane with no invoice yet. */
async function seedBillable(clinic: Clinic, label: string): Promise<{ name: string; visitId: string }> {
  const name = `E2E Synthetic ${label} ${testTag()}`;
  const patient = await seedPatient(clinic.tenantId, clinic.ownerId, name);
  const visitId = await seedVisit({
    tenantId: clinic.tenantId,
    patientId: patient.id,
    doctorId: clinic.ownerId,
    createdBy: clinic.receptionist.userId,
    status: "completed",
    signedAt: new Date().toISOString(),
  });
  await seedQueueToken(clinic.tenantId, visitId);
  return { name, visitId };
}

const drawerOf = (page: Page) =>
  page.getByRole("heading", { name: "Patient Checkout & Billing" }).locator("xpath=ancestor::div[contains(@class,'fixed')][1]");

test("@golden fees are never held: a fee changed elsewhere is B's next bill's fee, with no refresh in between", async ({ page }) => {
  const clinic = await ownClinic();
  const { name, visitId } = await seedBillable(clinic, "BootFee");
  await signInB(page, clinic);
  await openToday(page);
  await expect(liveStatus(page)).toHaveAttribute("data-live-status", "live", { timeout: 20_000 });
  const rsc = countRscRequests(page);

  // A (the owner's device) changes the clinic's consultation fee after B's session (and its bootstrap) began.
  const { error } = await getAdminClient().from("tenants").update({ default_consultation_fee: 735 }).eq("id", clinic.tenantId);
  expect(error).toBeNull();

  await openBill(page, name);
  const drawer = drawerOf(page);
  await expect(drawer.getByLabel(/^OPD Consultation Fee/)).toHaveValue("735");
  await expect(drawer.getByLabel(/^Amount to Collect/)).toHaveValue("735");
  expect(rsc(), "no refresh between the fee change and the bill").toBe(0);
  await drawer.getByRole("button", { name: "Collect ₹735 & Checkout" }).click();
  await expect(drawer.getByRole("heading", { name: "Patient Checkout Complete" })).toBeVisible();

  const invoices = await invoicesOf(visitId);
  expect(invoices).toHaveLength(1);
  const { data: items } = await getAdminClient().from("invoice_items").select("item_type, unit_price").eq("invoice_id", invoices[0]!.id);
  expect(items, "the bill was written with the fee the database had").toEqual([{ item_type: "consultation", unit_price: 735 }]);
  expect(invoices[0]!.payments).toEqual([{ amount: 735, payment_method: "cash", reference_number: null }]);
});

test("a role changed elsewhere: B's next command is refused at once whatever B's bootstrap says, and nothing is written", async ({ page }) => {
  const clinic = await ownClinic();
  const { name, visitId } = await seedBillable(clinic, "BootRole");
  await dropBroadcastFrames(page);
  // B hears nothing: no signal reaches it and its state checks are held, so its bootstrap keeps the old role.
  await page.route("**/api/live/state", (route) => route.abort());
  await signInB(page, clinic);
  await openToday(page);
  await openBill(page, name);
  const drawer = drawerOf(page);
  await expect(drawer.getByLabel(/^Amount to Collect/)).toHaveValue("500");

  const { error } = await getAdminClient()
    .from("memberships")
    .update({ role: "nurse" })
    .eq("tenant_id", clinic.tenantId)
    .eq("user_id", clinic.receptionist.userId);
  expect(error).toBeNull();
  await page.waitForTimeout(500);
  await expect(shellRole(page), "B's bootstrap still says receptionist").toHaveText("Receptionist");

  await drawer.getByRole("button", { name: "Collect ₹500 & Checkout" }).click();
  await expect(drawer.getByText(/do not have permission/i).first(), "refused at once: the role is read from the database, not the bootstrap").toBeVisible({ timeout: 15_000 });
  await expect(drawer.getByRole("heading", { name: "Patient Checkout Complete" })).toHaveCount(0);
  expect(await invoicesOf(visitId), "nothing was billed or paid").toEqual([]);
});

/** Whether the sidebar lists Schedule before its divider (the primary group). */
async function scheduleIsPrimary(page: Page): Promise<boolean> {
  return page.locator('[data-shell-nav="sidebar"]').evaluate((nav) => {
    const kids = Array.from(nav.children);
    const hr = kids.findIndex((k) => k.tagName === "HR");
    const schedule = kids.findIndex((k) => k.matches('a[href="/schedule"]') || k.querySelector('a[href="/schedule"]') !== null);
    return schedule >= 0 && (hr < 0 || schedule < hr);
  });
}

test("a role changed elsewhere: B's navigation follows on the settings signal within 2 s, with no page render", async ({ page }) => {
  const clinic = await ownClinic();
  await signInB(page, clinic);
  await openToday(page);
  await expect(liveStatus(page)).toHaveAttribute("data-live-status", "live", { timeout: 20_000 });
  await expect(shellRole(page)).toHaveText("Receptionist");
  expect(await scheduleIsPrimary(page), "the receptionist's Schedule is a primary destination").toBe(true);
  const rsc = countRscRequests(page);

  const { error } = await getAdminClient()
    .from("memberships")
    .update({ role: "nurse" })
    .eq("tenant_id", clinic.tenantId)
    .eq("user_id", clinic.receptionist.userId);
  expect(error).toBeNull();
  await expect(shellRole(page)).toHaveText("Nurse", { timeout: 2_000 });
  await expect.poll(() => scheduleIsPrimary(page), { message: "a nurse's Schedule is secondary (IA §3.2)" }).toBe(false);
  expect(rsc()).toBe(0);
});

test("two devices: the owner stops practising in Settings on A; B's open doctor picker drops the owner, then lists them again, with no page render", async ({ page, browser }) => {
  // Two UI sign-ins and two Realtime joins before the case measures anything (as live/convergence.spec.ts).
  test.setTimeout(120_000);
  const clinic = await ownClinic();
  const tag = testTag();
  const ownerName = `E2E Synthetic BootOwner ${tag}`;
  const admin = getAdminClient();
  // A second doctor: with the owner gone B still has two doctors, so the picker stays a select whose options can be read.
  const second = await addMemberToTenant(clinic.tenantId, "doctor");
  for (const [userId, name] of [
    [clinic.ownerId, ownerName],
    [second.userId, `E2E Synthetic BootDocTwo ${tag}`],
  ] as const) {
    const { error } = await admin.from("memberships").update({ full_name: name }).eq("tenant_id", clinic.tenantId).eq("user_id", userId);
    expect(error).toBeNull();
  }
  const patient = await seedPatient(clinic.tenantId, clinic.ownerId, `E2E Synthetic BootPick ${tag}`);

  // Device A: the owner, on the clinic settings form.
  const blocked: string[] = [];
  const other = await browser.newContext({ baseURL: E2E_BASE_URL, serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  await routeLoopbackOnly(other, blocked);
  try {
    const a = await other.newPage();
    await uiSignIn(a, { email: clinic.ownerEmail, password: seededUserPassword() });
    await a.goto("/settings/clinic");
    const practising = a
      .getByText("Is Clinic Owner a practicing doctor?")
      .locator("xpath=ancestor::div[contains(@class,'justify-between')][1]")
      .locator('input[type="checkbox"]');
    const save = async (on: boolean) => {
      await practising.setChecked(on, { force: true });
      await a.getByRole("button", { name: "Save Clinic Settings" }).click();
      await expect(a.getByText(/saved successfully/i)).toBeVisible({ timeout: 15_000 });
    };

    // Device B: the receptionist on Today with the walk-in sheet open on the doctor picker.
    await signInB(page, clinic);
    await openToday(page);
    await expect(liveStatus(page)).toHaveAttribute("data-live-status", "live", { timeout: 20_000 });
    const sheet = await openWalkIn(page, patient.phone);
    const picker = sheet.getByRole("combobox", { name: "Doctor" });
    await expect(picker.locator("option", { hasText: ownerName })).toHaveCount(1);
    const rsc = countRscRequests(page);

    await save(false);
    await expect.poll(async () => (await admin.from("tenants").select("owner_is_practicing_doctor").eq("id", clinic.tenantId).single()).data?.owner_is_practicing_doctor).toBe(false);
    // The signal moves B within about 2 s; the 12 s heartbeat of Today is the bound when a frame is lost (the first join after a recycle, 09E-14a F6).
    await expect(picker.locator("option", { hasText: ownerName }), "B's open picker no longer offers the owner").toHaveCount(0, { timeout: 15_000 });
    await expect(picker.locator("option", { hasText: clinic.doctorName })).toHaveCount(1);

    await save(true);
    await expect(picker.locator("option", { hasText: ownerName }), "the owner practises again: B's picker lists them again").toHaveCount(1, { timeout: 15_000 });
    expect(rsc(), "no page render on B: the bootstrap query was read again").toBe(0);
    expect(blocked).toEqual([]);
  } finally {
    await other.close();
  }
});
