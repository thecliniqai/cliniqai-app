/**
 * The Schedule's data layer (V2-09e 09E-12, R-10, R-18; B-9, B-10, B-11).
 *
 * - B-11: a booking made elsewhere (a committed write: the statement trigger moves the clinic's `schedule` version and sends the signal) appears in an open
 *   day view within 2 s and its free slot disappears, with no render request;
 * - the signal dropped (the Realtime socket refused): the booking appears once the page's clock passes the 12 s heartbeat;
 * - B-9: the next day and the next week show with no read of their range (the adjacent weeks were prefetched once the visible one settled);
 * - B-10: a date three weeks away is one range read (one `rpc/schedule_range` call);
 * - the range route serves 42 days in one call, and `slots=0` leaves the slots out (the month grid of the calendar views reads counts);
 * - a slot the screen still shows that someone else has just booked is refused by the booking command (the existing conflict question), never booked twice;
 * - (PR 2 review I-2) a week whose read fails shows "could not be loaded" with Try again (which reads it and shows it), never an endless skeleton; a week
 *   asked for offline says so and loads by itself on reconnect;
 * - (PR 2 review I-3) the booking picker never takes slots from a range no screen shows: with B's frames dropped, B leaves the Schedule, a slot is booked
 *   elsewhere, and the booking sheet opened from Patients does not offer it (it asked the server); and the picker of a sheet open on the Schedule follows a
 *   booking made elsewhere while it is open.
 * Each test has its own clinic (the owner practises with the default hours). Synthetic data only.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { getAdminClient } from "../../helpers/supabase-admin";
import { seedTenantWithOwner, seededUserPassword, type SeededTenant } from "../../helpers/tenants";
import { countKongCalls } from "../support/kong-calls";
import { istDate, istInstant, seedPatient, testTag } from "../support/m0-data";
import { uiSignIn } from "../support/password-journeys";
import { bookingSheet, chooseExistingPatient, conflictDialog, scheduleHydrated, slotsLoaded } from "../support/schedule-page";
import { countRscRequests, dropBroadcastFrames } from "../support/today-page";

test.use({ storageState: { cookies: [], origins: [] } });

const HEARTBEAT_MS = 12_000;
const SCHEDULE = "#main [data-schedule]";

/** A clinic date `offset` days or more ahead that is a Monday to Friday (the default hours; Saturday is open too, Sunday is not). */
function weekday(offset: number): string {
  for (let i = offset; i < offset + 7; i++) {
    const date = istDate(i);
    const day = new Date(`${date}T12:00:00+05:30`).getUTCDay();
    if (day >= 1 && day <= 5) return date;
  }
  throw new Error("no weekday");
}

/** The Monday of the week that holds `date` (the range the Schedule reads). */
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function ownClinic(): Promise<SeededTenant> {
  return seedTenantWithOwner(`E2E Synthetic Schedule Live ${testTag()}`);
}

async function signIn(page: Page, clinic: SeededTenant): Promise<void> {
  await uiSignIn(page, { email: clinic.userEmail, password: seededUserPassword() });
}

async function openDay(page: Page, date: string): Promise<void> {
  await page.goto(`/schedule?date=${date}&view=day`);
  await page.locator(SCHEDULE).waitFor();
  await scheduleHydrated(page);
}

/** A committed booking of the clinic's owner at clinic `time` on `date` (another device's write, as the database sees it). */
async function bookElsewhere(clinic: SeededTenant, date: string, time: string, label: string): Promise<{ visitId: string; name: string }> {
  const name = `E2E Synthetic ${label} ${testTag()}`;
  const patient = await seedPatient(clinic.tenantId, clinic.userId, name);
  const { data, error } = await getAdminClient()
    .from("visits")
    .insert({
      tenant_id: clinic.tenantId,
      patient_id: patient.id,
      doctor_id: clinic.userId,
      origin_type: "scheduled",
      status: "booked",
      scheduled_at: istInstant(date, time),
      estimated_duration_minutes: 15,
      created_by: clinic.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`schedule-live seed: ${error?.message}`);
  return { visitId: data.id, name };
}

/** Records every range read of the page: `from..to` of each `GET /api/schedule/range`. */
function rangeReads(page: Page): string[] {
  const reads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/schedule/range") reads.push(`${url.searchParams.get("from")}..${url.searchParams.get("to")}`);
  });
  return reads;
}

const column = (page: Page, doctorId: string) => page.locator(`[data-doctor-column="${doctorId}"]`);
const liveStatus = (page: Page) => page.locator("[data-live-status]");

test("@golden B-11: a booking made elsewhere appears in the open day view within 2 s and its free slot disappears, with no render request", async ({ page }) => {
  const clinic = await ownClinic();
  const date = weekday(3);
  await signIn(page, clinic);
  await openDay(page, date);
  await expect(liveStatus(page)).toHaveText("Live", { timeout: 20_000 });
  await expect(column(page, clinic.userId).locator('[data-free-slot="10:00"]')).toBeVisible();
  const rsc = countRscRequests(page);

  const { name } = await bookElsewhere(clinic, date, "10:00", "Elsewhere");
  await expect(column(page, clinic.userId).locator("[data-appointment]").filter({ hasText: name })).toBeVisible({ timeout: 2_000 });
  await expect(column(page, clinic.userId).locator('[data-free-slot="10:00"]')).toHaveCount(0);
  await expect(column(page, clinic.userId).locator('[data-free-slot="10:15"]')).toBeVisible();
  expect(rsc(), "the re-read is the range query, not a page render").toBe(0);
});

test("the signal dropped (Realtime refused): the booking appears once the page's clock passes the 12 s heartbeat", async ({ page }) => {
  const clinic = await ownClinic();
  const date = weekday(3);
  await signIn(page, clinic);
  await page.clock.install();
  let asked!: () => void;
  const started = new Promise<void>((resolve) => (asked = resolve));
  await page.routeWebSocket(/\/realtime\//, (ws) => {
    asked();
    void ws.close({ code: 1008, reason: "refused by the spec" });
  });
  await openDay(page, date);
  await started;
  await expect(liveStatus(page)).toHaveAttribute("data-live-status", "reconnecting");

  const { name } = await bookElsewhere(clinic, date, "10:30", "Dropped");
  await expect(page.locator("[data-appointment]").filter({ hasText: name })).toHaveCount(0);
  await page.clock.runFor(HEARTBEAT_MS + 1_000);
  await expect(column(page, clinic.userId).locator("[data-appointment]").filter({ hasText: name })).toBeVisible({ timeout: 15_000 });
  await expect(column(page, clinic.userId).locator('[data-free-slot="10:30"]')).toHaveCount(0);
});

test("B-9: the next day and the next week show with no read of their range; B-10: a date three weeks away is one read", async ({ page }) => {
  const clinic = await ownClinic();
  // A Friday: the next day is in the same week, the day after it (Sunday → Monday) crosses into the prefetched next week.
  let date = weekday(3);
  while (new Date(`${date}T12:00:00+05:30`).getUTCDay() !== 5) date = addDays(date, 1);
  const week = mondayOf(date);
  const nextWeek = addDays(week, 7);
  const later = await bookElsewhere(clinic, addDays(date, 3), "11:00", "NextWeek"); // the Monday after
  await signIn(page, clinic);
  const reads = rangeReads(page);
  const settled = page.waitForResponse((r) => r.url().includes(`/api/schedule/range?from=${nextWeek}`));
  await openDay(page, date);
  await settled; // the adjacent weeks were prefetched once the visible one settled
  expect(reads, "the page's own week came with the page; only the two adjacent weeks were read").toEqual(
    expect.arrayContaining([`${addDays(week, -7)}..${addDays(week, -1)}`, `${nextWeek}..${addDays(nextWeek, 6)}`]),
  );
  // Exact ranges: since V2-09f a settled week also reads ahead its month (42 days, `slots=0`), which can start on the same Monday.
  expect(reads.filter((r) => r === `${week}..${addDays(week, 6)}`), "the visible week is not read again").toEqual([]);

  // Next day (Saturday, same week), then the week view and Next week: all held.
  const before = reads.length;
  await page.getByRole("link", { name: "Next day" }).click();
  await expect(page.locator("[data-schedule-date]")).toContainText(/Sat/);
  await page.getByRole("link", { name: "Next day" }).click(); // Sunday
  await page.getByRole("link", { name: "Next day" }).click(); // Monday: the next week
  await expect(page.locator(SCHEDULE)).toHaveAttribute("data-schedule-range", `${nextWeek}..${addDays(nextWeek, 6)}`);
  await expect(page.locator("[data-appointment]").filter({ hasText: later.name })).toBeVisible();
  expect(reads.slice(before).filter((r) => r === `${nextWeek}..${addDays(nextWeek, 6)}`), "B-9: the next week was not read when shown").toEqual([]);

  // B-10: three weeks away is one read of its range and one schedule_range call.
  const far = addDays(date, 21);
  const farWeek = mondayOf(far);
  const window = await countKongCalls(async () => {
    await page.getByLabel("Go to date").fill(far);
    await expect(page.locator(SCHEDULE)).toHaveAttribute("data-schedule-range", `${farWeek}..${addDays(farWeek, 6)}`, { timeout: 15_000 });
  }, 0);
  expect(reads.filter((r) => r === `${farWeek}..${addDays(farWeek, 6)}`), "B-10: one read of the far week").toHaveLength(1);
  const rangeCalls = Object.entries(window.serverByPath).filter(([k]) => k.includes("rpc/schedule_range")).reduce((n, [, c]) => n + c, 0);
  expect(rangeCalls, `B-10: the far week is one call (prefetches of its neighbours may follow it): ${JSON.stringify(window.serverByPath)}`).toBeGreaterThanOrEqual(1);
  expect(Object.keys(window.serverByPath).filter((k) => !k.includes("rpc/schedule_range")), "no other read").toEqual([]);
});

test("the range route serves 42 days in one call, and slots=0 leaves the slots out", async ({ page }) => {
  const clinic = await ownClinic();
  const from = mondayOf(weekday(3));
  const to = addDays(from, 41);
  const booked = await bookElsewhere(clinic, addDays(from, 40), "10:00", "FortyDays");
  await signIn(page, clinic);
  // No page open during the window: only the route's own calls are counted (the shell of an open page reads in the background).
  await page.goto("about:blank");
  let body: Record<string, unknown> = {};
  const window = await countKongCalls(async () => {
    const response = await page.request.get(`/api/schedule/range?from=${from}&to=${to}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    body = (await response.json()) as Record<string, unknown>;
  }, 0);
  // The route's session check reads the membership and the clinic's access (resolveServiceContext); the data is ONE call.
  expect(window.serverByPath["POST /rest/v1/rpc/schedule_range"], `one schedule_range call for 42 days: ${JSON.stringify(window.serverByPath)}`).toBe(1);
  expect(Object.keys(window.serverByPath).filter((k) => /\/rest\/v1\/(visits|schedule_blocks|waitlist_entries|tenants)\b|rpc\/available_slots/.test(k)), "no per-part read").toEqual([]);
  expect((body.visits as { id: string }[]).map((v) => v.id)).toContain(booked.visitId);
  expect((body.slots as { date: string }[]).some((s) => s.date === addDays(from, 41) || s.date === addDays(from, 40))).toBe(true);
  expect((await page.request.get(`/api/schedule/range?from=${from}&to=${addDays(from, 42)}`)).status(), "43 days are refused").toBe(400);
  const counts = (await (await page.request.get(`/api/schedule/range?from=${from}&to=${to}&slots=0`)).json()) as Record<string, unknown>;
  expect(Object.keys(counts)).not.toContain("slots");
  expect((counts.visits as { id: string }[]).map((v) => v.id)).toContain(booked.visitId);
});

test("a slot the screen still shows that someone else has just booked is refused by the booking command, never booked twice", async ({ page, ux }) => {
  const clinic = await ownClinic();
  const date = weekday(3);
  const patientName = `E2E Synthetic Second ${testTag()}`;
  await seedPatient(clinic.tenantId, clinic.userId, patientName);
  await signIn(page, clinic);
  // Realtime held back for this page: the screen keeps showing the slot after the other booking commits.
  await page.routeWebSocket(/\/realtime\//, (ws) => void ws.close({ code: 1008, reason: "held by the spec" }));
  await openDay(page, date);
  await column(page, clinic.userId).locator('[data-free-slot="11:00"]').click();
  const sheet = bookingSheet(page);
  await expect(sheet).toBeVisible();
  const other = await bookElsewhere(clinic, date, "11:00", "First");

  await chooseExistingPatient(sheet, ux, patientName);
  await sheet.getByRole("button", { name: "Book", exact: true }).click();
  // The command refused the taken slot: the existing conflict question; nothing is booked until it is answered.
  await expect(conflictDialog(page, "Slot Already Booked")).toBeVisible({ timeout: 15_000 });
  const { data } = await getAdminClient().from("visits").select("id").eq("tenant_id", clinic.tenantId).eq("scheduled_at", istInstant(date, "11:00")).neq("status", "cancelled");
  expect((data ?? []).map((v) => v.id)).toEqual([other.visitId]);
});

test("I-2: a week whose read fails says so and Try again shows it; a week asked for offline says so and loads on reconnect", async ({ page, context }) => {
  const clinic = await ownClinic();
  const date = weekday(3);
  await signIn(page, clinic);
  await openDay(page, date);

  // A week far from the held ones: its read answers 500 (both tries of the query) until the route is released.
  const far = addDays(date, 35);
  const farWeek = mondayOf(far);
  let failing = true;
  await page.route(`**/api/schedule/range?from=${farWeek}*`, (route) =>
    failing ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "The schedule could not be loaded." }) }) : route.fallback(),
  );
  await page.getByLabel("Go to date").fill(far);
  const failed = page.locator('[data-schedule-unavailable="failed"]');
  await expect(failed, "a failed read is said, not an endless skeleton").toBeVisible({ timeout: 15_000 });
  await expect(failed).toContainText("The schedule could not be loaded");
  failing = false;
  await failed.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(SCHEDULE)).toHaveAttribute("data-schedule-range", `${farWeek}..${addDays(farWeek, 6)}`, { timeout: 15_000 });

  // Offline: a week the device does not hold waits for the network and says so; reconnecting reads it with no click.
  const away = addDays(date, 70);
  const awayWeek = mondayOf(away);
  await context.setOffline(true);
  await page.getByLabel("Go to date").fill(away);
  await expect(page.locator('[data-schedule-unavailable="offline"]')).toContainText("You're offline", { timeout: 15_000 });
  await context.setOffline(false);
  await expect(page.locator(SCHEDULE)).toHaveAttribute("data-schedule-range", `${awayWeek}..${addDays(awayWeek, 6)}`, { timeout: 15_000 });
});

const chip = (sheet: ReturnType<typeof bookingSheet>, label: string) => sheet.getByRole("radio", { name: label, exact: true });

test("I-3: a booking sheet opened away from the Schedule never offers a slot from the range it left behind (frames dropped): it asks the server", async ({ page, ux }) => {
  const clinic = await ownClinic();
  const date = weekday(3);
  const patientName = `E2E Synthetic Picker ${testTag()}`;
  await seedPatient(clinic.tenantId, clinic.userId, patientName);
  await dropBroadcastFrames(page);
  await signIn(page, clinic);
  await openDay(page, date);
  await expect(column(page, clinic.userId).locator('[data-free-slot="10:00"]')).toBeVisible();

  // B leaves the Schedule in the app (the range stays in memory, shown by no screen; Patients has no heartbeat), then the slot is booked elsewhere.
  await page.locator('a[href="/patients"]').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/patients/);
  await bookElsewhere(clinic, date, "10:00", "Behind");

  let slotReads = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"] && new URL(r.url()).pathname.startsWith("/patients")) slotReads += 1;
  });
  // The global booking sheet, opened in the app (no page load: the cache is the one the Schedule filled).
  await page.evaluate(
    ({ date, doctor }) => window.history.pushState(null, "", `/patients?book=1&date=${date}&doctor=${doctor}`),
    { date, doctor: clinic.userId },
  );
  const sheet = bookingSheet(page);
  await expect(sheet).toBeVisible();
  await chooseExistingPatient(sheet, ux, patientName);
  await slotsLoaded(sheet);
  await expect(chip(sheet, "10:15 am"), "the day's slots are listed").toBeVisible();
  await expect(chip(sheet, "10:00 am"), "the slot booked elsewhere is not offered: the range left behind was not used").toHaveCount(0);
  expect(slotReads, "the free slots were read from the server").toBeGreaterThan(0);
});

test("I-3: the picker of a booking sheet open on the Schedule follows a booking made elsewhere while it is open", async ({ page, ux }) => {
  const clinic = await ownClinic();
  const date = weekday(3);
  const patientName = `E2E Synthetic Follow ${testTag()}`;
  await seedPatient(clinic.tenantId, clinic.userId, patientName);
  await signIn(page, clinic);
  await openDay(page, date);
  await expect(liveStatus(page)).toHaveText("Live", { timeout: 20_000 });
  await column(page, clinic.userId).locator('[data-free-slot="11:00"]').click();
  const sheet = bookingSheet(page);
  await expect(sheet).toBeVisible();
  await chooseExistingPatient(sheet, ux, patientName);
  await slotsLoaded(sheet);
  await expect(chip(sheet, "10:30 am")).toBeVisible();

  await bookElsewhere(clinic, date, "10:30", "WhileOpen");
  // The signal moves the range within about 2 s; the 12 s heartbeat of the Schedule bounds a lost frame.
  await expect(chip(sheet, "10:30 am"), "the open picker drops the slot booked elsewhere").toHaveCount(0, { timeout: 15_000 });
  await expect(chip(sheet, "10:45 am")).toBeVisible();
});
