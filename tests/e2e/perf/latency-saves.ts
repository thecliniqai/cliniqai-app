/**
 * V2-09e 09E-01: the save rows of the latency lane (B-6 to B-8) and the typeahead rows (B-4, B-5): what each step seeds and opens (not
 * measured), and the click or key that is measured, with the DOM states that end it. Selectors and seeds only; `latency-run.ts` measures.
 *
 * Marks: `pending` is the first sign the app has heard the user (optional); `confirmed` is the state the database has answered (the DOM state
 * where there is one; otherwise the server action's response, taken from the runner clock against the in-page zero). A typeahead's mark is
 * `option`: the first option that reflects the last key.
 */
import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures";
import { getAdminClient } from "../../helpers/supabase-admin";
import { freeBookingDate, invoicesOf, istInstant, run, seedPatient, seedPrescription, seedQueueToken, seedVisit, testTag } from "../support/m0-data";
import { seedBookedToday, seedWaitingToday, todayName } from "../support/today-data";
import { filterToday, openBill, openToday, rowInLane } from "../support/today-page";
import { appointmentOf, bookingSheet, moveSheet, openSchedule, slotsLoaded } from "../support/schedule-page";
import { rxField } from "../support/rx-entry";
import { PERF_FAMILY } from "../support/perf-catalogue";
import {
  armTimer,
  readTimer,
  timerEpoch,
  watchActionResponses,
  type MarkSpec,
} from "../support/latency";
import type { E2eRole } from "../support/run-data";

export type Marks = Record<string, number | null>;

/**
 * 09E-08 (R-11, confirm class): what the held-POST spec (`tests/e2e/shell/confirm-saves.spec.ts`) checks for a save. While the save's action POST is held
 * the screen shows a pending state only: no success text and nothing moved (`before` passes); once released the database holds the change (`stored`).
 */
export interface HeldCheck {
  /** The success text that must not be on screen before the answer (a toast, or the success screen's heading). */
  success: RegExp;
  /** The screen as it was before the save: the dialog or sheet still open, the row not moved. */
  before: (page: Page, state: unknown) => Promise<void>;
  /** The database after the answer. */
  stored: (state: unknown) => Promise<void>;
}

export interface SaveRowDef {
  id: string;
  role: E2eRole;
  /** The confirm-class check of `confirm-saves.spec.ts`. */
  held?: HeldCheck;
  /** Not measured: seed this sample's data and put the page where the step starts. */
  prepare: (page: Page) => Promise<unknown>;
  /** Measured: the click or key, and the waits that end it. */
  act: (page: Page, state: unknown) => Promise<Marks>;
}

export interface TypeaheadRowDef {
  id: string;
  role: E2eRole;
  prepare: (page: Page) => Promise<TypeaheadState>;
}

export interface TypeaheadState {
  /** Focuses the field and types the query less its last character; returns once that query's answer is on screen. */
  press: () => Promise<void>;
  key: string;
  /** The states that end the measure; `option` is the one the row is timed to. */
  marks: Record<string, MarkSpec>;
}

const NOTES_LABEL = "History of Present Illness & Clinical Notes";

const label12 = (time: string): string => {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

const doctorId = () => run().tenantA.users.doctor.id;

/**
 * A click whose result is a DOM state. `marks.confirmed` is that state; it is recorded as `shown`: where the screen answers at once (an optimistic
 * state, a sheet that closes) it is not the database's answer. `response` is the server action's response (runner clock against the in-page zero),
 * read once the page is idle, and `confirmed` is the later of the two: the state is on screen AND the command answered (an optimistic state alone
 * is `shown`; a click whose command has no answer the page can see keeps the DOM state).
 */
async function clickSave(page: Page, click: Locator, marks: Record<string, MarkSpec>): Promise<Marks> {
  const { confirmed: dom, ...rest } = marks;
  const armed: Record<string, MarkSpec> = { ...rest, shown: dom };
  const actions = watchActionResponses(page);
  try {
    await armTimer(page, armed, { event: "click" });
    await click.click();
    const result = await readTimer(page, ["shown"], 45_000);
    await page.waitForLoadState("networkidle");
    const zero = await timerEpoch(page);
    const at = actions.firstSince(zero);
    for (const name of Object.keys(armed)) result[name] ??= null;
    result.response = at === null ? null : Math.round((at - zero) * 10) / 10;
    result.confirmed = Math.max(result.shown ?? 0, result.response ?? 0);
    return result;
  } finally {
    actions.stop();
  }
}

/** A click or key whose confirmed state is the server action's response (no DOM state of its own). */
async function actionSave(page: Page, trigger: () => Promise<void>, marks: Record<string, MarkSpec>, start: { event: "click" } | { event: "keydown"; key: string }): Promise<Marks> {
  const actions = watchActionResponses(page);
  try {
    await armTimer(page, marks, start);
    await trigger();
    await page.waitForFunction(() => (window as unknown as { __latency?: { t0: number | null } }).__latency?.t0 !== null);
    const zero = await timerEpoch(page);
    let at: number | null = null;
    await expect.poll(() => (at = actions.firstSince(zero)), { timeout: 45_000, intervals: [25, 50, 100] }).not.toBeNull();
    const result = await readTimer(page, [], 1_000);
    for (const name of Object.keys(marks)) result[name] ??= null;
    result.confirmed = Math.round((at! - zero) * 10) / 10;
    return result;
  } finally {
    actions.stop();
  }
}

// --- seeds ------------------------------------------------------------------------------------------------------------------------

/** An open consultation of the run's doctor on a new patient; `allergies` null is "not recorded". */
async function seedConsult(label: string, allergies: string[] | null = []): Promise<{ visitId: string; patientName: string; patientId: string }> {
  const { tenantA } = run();
  const patientName = `E2E Synthetic ${label} ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, patientName);
  if (allergies === null) await getAdminClient().from("patients").update({ allergies: null }).eq("id", patient.id).throwOnError();
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: doctorId(),
    createdBy: tenantA.users.receptionist.id,
    status: "in_consultation",
  });
  return { visitId, patientName, patientId: patient.id };
}

async function openConsult(page: Page, visitId: string): Promise<void> {
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel(NOTES_LABEL)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** The booking sheet of `/schedule` on `date`, with its doctors loaded. */
async function openBooking(page: Page, date: string): Promise<Locator> {
  await openSchedule(page, date);
  await page.getByRole("link", { name: "Book appointment" }).click();
  const sheet = bookingSheet(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Loading doctors…")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  return sheet;
}

async function chooseSlot(sheet: Locator, time: string): Promise<void> {
  const doctor = sheet.getByRole("combobox", { name: "Doctor" });
  if (await doctor.isVisible()) await doctor.selectOption(doctorId());
  await slotsLoaded(sheet);
  await sheet.getByRole("radio", { name: label12(time), exact: true }).click();
}

async function seedBookedOn(date: string, time: string, label: string): Promise<{ visitId: string; name: string }> {
  const { tenantA } = run();
  const name = `E2E Synthetic ${label} ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: doctorId(),
    createdBy: tenantA.users.owner.id,
    status: "booked",
    originType: "scheduled",
    scheduledAt: istInstant(date, time),
  });
  return { visitId, name };
}

// --- what the held-POST spec reads from the database -------------------------------------------------------------------------------

async function visitOfPatient(name: string): Promise<{ id: string; status: string; scheduled_at: string | null; signed_at: string | null } | null> {
  const admin = getAdminClient();
  const patient = await admin.from("patients").select("id").eq("full_name", name).maybeSingle();
  if (!patient.data) return null;
  const { data } = await admin.from("visits").select("id, status, scheduled_at, signed_at").eq("patient_id", patient.data.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

const istHour = (iso: string | null): number | null => (iso ? Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date(iso))) : null);

// --- the save rows -------------------------------------------------------------------------------------------------------------------

export const SAVE_ROWS: readonly SaveRowDef[] = [
  {
    id: "save.R.check-in",
    role: "receptionist",
    prepare: async (page) => {
      const name = todayName("PerfCheckIn");
      await seedBookedToday(name);
      await openToday(page);
      await page.waitForLoadState("networkidle");
      await filterToday(page, name);
      return { name };
    },
    act: async (page, state) => {
      const { name } = state as { name: string };
      const button = rowInLane(page, "booked", name).getByRole("button", { name: `Check in ${name}` });
      await expect(button).toBeVisible();
      return clickSave(page, button, { confirmed: { selector: '[data-lane="waiting"] [data-queue-row]', text: name } });
    },
  },
  {
    id: "save.R.register-book",
    role: "receptionist",
    held: {
      success: /booked ·/,
      before: async (page, state) => {
        const { name, sheet } = state as { name: string; sheet: Locator };
        await expect(sheet).toBeVisible();
        await expect(page.locator("[data-appointment]").filter({ hasText: name })).toHaveCount(0);
      },
      stored: async (state) => {
        const { name } = state as { name: string };
        await expect.poll(async () => (await visitOfPatient(name))?.status ?? null).toBe("booked");
      },
    },
    prepare: async (page) => {
      const { tenantA } = run();
      const date = await freeBookingDate(tenantA.id, doctorId());
      const name = `E2E Synthetic PerfReg ${testTag()}`;
      const sheet = await openBooking(page, date);
      await sheet.getByRole("combobox", { name: "Patient" }).fill(name);
      await sheet.getByRole("option", { name: /Register as new patient/ }).click();
      await chooseSlot(sheet, "10:00");
      await sheet.getByRole("textbox", { name: "Mobile number" }).fill(`90000${String(Math.floor(Math.random() * 100000)).padStart(5, "0")}`);
      await sheet.getByRole("textbox", { name: "Age" }).fill("41");
      await sheet.getByRole("radio", { name: "Male", exact: true }).click();
      return { name, sheet };
    },
    act: async (page, state) => {
      const { name, sheet } = state as { name: string; sheet: Locator };
      return clickSave(page, sheet.getByRole("button", { name: "Register and book" }), { confirmed: { selector: "[data-appointment]", text: name } });
    },
  },
  {
    id: "save.R.book",
    role: "receptionist",
    held: {
      success: /booked ·/,
      before: async (page, state) => {
        const { name, sheet } = state as { name: string; sheet: Locator };
        await expect(sheet).toBeVisible();
        await expect(page.locator("[data-appointment]").filter({ hasText: name })).toHaveCount(0);
      },
      stored: async (state) => {
        const { name } = state as { name: string };
        await expect.poll(async () => (await visitOfPatient(name))?.status ?? null).toBe("booked");
      },
    },
    prepare: async (page) => {
      const { tenantA } = run();
      const date = await freeBookingDate(tenantA.id, doctorId());
      const name = `E2E Synthetic PerfBook ${testTag()}`;
      await seedPatient(tenantA.id, tenantA.users.owner.id, name);
      const sheet = await openBooking(page, date);
      const search = sheet.getByRole("combobox", { name: "Patient" });
      await search.fill(name);
      await expect(sheet.getByRole("option", { name: new RegExp(name) })).toBeVisible();
      await search.press("Enter");
      await expect(sheet.locator("[data-booking-patient]")).toContainText(name);
      await chooseSlot(sheet, "10:00");
      return { name, sheet };
    },
    act: async (page, state) => {
      const { name, sheet } = state as { name: string; sheet: Locator };
      return clickSave(page, sheet.getByRole("button", { name: "Book", exact: true }), { confirmed: { selector: "[data-appointment]", text: name } });
    },
  },
  {
    id: "save.R.reschedule",
    role: "receptionist",
    held: {
      success: /moved to/,
      before: async (page, state) => {
        const { sheet, name } = state as { name: string; sheet: Locator };
        await expect(sheet).toBeVisible();
        // The card has not moved: the visit is still at 10:00 in the database and on the day.
        await expect(page.locator("[data-appointment]").filter({ hasText: name })).toContainText(/10:00/);
        expect(istHour((await visitOfPatient(name))?.scheduled_at ?? null)).toBe(10);
      },
      stored: async (state) => {
        const { name } = state as { name: string };
        await expect.poll(async () => istHour((await visitOfPatient(name))?.scheduled_at ?? null)).toBe(11);
      },
    },
    prepare: async (page) => {
      const { tenantA } = run();
      const date = await freeBookingDate(tenantA.id, doctorId());
      const { name } = await seedBookedOn(date, "10:00", "PerfMove");
      await openSchedule(page, date);
      await page.waitForLoadState("networkidle");
      const card = appointmentOf(page, name);
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: `More actions for ${name}` }).click();
      await page.getByRole("menuitem", { name: "Move appointment" }).click();
      const sheet = moveSheet(page);
      await expect(sheet).toBeVisible();
      await chooseSlot(sheet, "11:00");
      return { name, sheet };
    },
    act: async (page, state) => {
      const { sheet } = state as { sheet: Locator };
      return clickSave(page, sheet.getByRole("button", { name: "Move appointment" }), { confirmed: { selector: '[role="dialog"]', absent: true } });
    },
  },
  {
    id: "save.R.cancel",
    role: "receptionist",
    held: {
      success: /was cancelled/,
      before: async (page, state) => {
        const { name, dialog } = state as { name: string; dialog: Locator };
        await expect(dialog).toBeVisible();
        await expect(page.locator("[data-appointment]").filter({ hasText: name })).toHaveCount(1);
        expect((await visitOfPatient(name))?.status).toBe("booked");
      },
      stored: async (state) => {
        const { name } = state as { name: string };
        await expect.poll(async () => (await visitOfPatient(name))?.status ?? null).toBe("cancelled");
      },
    },
    prepare: async (page) => {
      const { tenantA } = run();
      const date = await freeBookingDate(tenantA.id, doctorId());
      const { name } = await seedBookedOn(date, "10:00", "PerfCancel");
      await openSchedule(page, date);
      await page.waitForLoadState("networkidle");
      const card = appointmentOf(page, name);
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: `More actions for ${name}` }).click();
      await page.getByRole("menuitem", { name: "Cancel appointment" }).click();
      const dialog = page.getByRole("alertdialog", { name: "Cancel this appointment?" });
      await expect(dialog).toBeVisible();
      return { name, dialog };
    },
    act: async (page, state) => {
      const { name, dialog } = state as { name: string; dialog: Locator };
      return clickSave(page, dialog.getByRole("button", { name: "Cancel appointment" }), { confirmed: { selector: "[data-appointment]", text: name, absent: true } });
    },
  },
  {
    id: "save.R.collect",
    role: "receptionist",
    held: {
      success: /Patient Checkout Complete/,
      before: async (_page, state) => {
        const { drawer } = state as { drawer: Locator; name: string };
        await expect(drawer).toBeVisible();
        await expect(drawer.getByText(/recorded successfully/)).toHaveCount(0);
      },
      stored: async (state) => {
        const { name } = state as { drawer: Locator; name: string };
        await expect.poll(async () => {
          const visit = await visitOfPatient(name);
          if (!visit) return 0;
          return (await invoicesOf(visit.id)).flatMap((i) => i.payments).length;
        }).toBe(1);
      },
    },
    prepare: async (page) => {
      const { tenantA } = run();
      const name = `E2E Synthetic PerfCollect ${testTag()}`;
      const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
      const visitId = await seedVisit({
        tenantId: tenantA.id,
        patientId: patient.id,
        doctorId: doctorId(),
        createdBy: tenantA.users.receptionist.id,
        status: "completed",
        signedAt: new Date().toISOString(),
      });
      await seedQueueToken(tenantA.id, visitId);
      await openToday(page);
      await page.waitForLoadState("networkidle");
      await openBill(page, name);
      const drawer = page.getByRole("heading", { name: "Patient Checkout & Billing" }).locator("xpath=ancestor::div[contains(@class,'fixed')][1]");
      await expect(drawer).toBeVisible();
      await drawer.getByLabel(/^OPD Consultation Fee/).fill("600");
      await drawer.getByLabel(/^Amount to Collect/).fill("200");
      return { drawer, name };
    },
    act: async (page, state) => {
      const { drawer } = state as { drawer: Locator };
      return clickSave(page, drawer.getByRole("button", { name: "Collect ₹200 & Checkout" }), {
        confirmed: { selector: 'h1, h2, h3, h4, [role="heading"]', text: "Patient Checkout Complete" },
      });
    },
  },
  {
    id: "save.D.start-consult",
    role: "doctor",
    prepare: async (page) => {
      const name = todayName("PerfStart");
      await seedWaitingToday(name);
      await openToday(page, "/today?mode=doctor");
      await page.waitForLoadState("networkidle");
      await filterToday(page, name);
      return { name };
    },
    act: async (page, state) => {
      const { name } = state as { name: string };
      const button = page.getByRole("button", { name: `Call in ${name}` });
      await expect(button).toBeVisible();
      return clickSave(page, button, { confirmed: { selector: "[data-rx-search]" } });
    },
  },
  {
    id: "save.D.draft-autosave",
    role: "doctor",
    prepare: async (page) => {
      const { visitId } = await seedConsult("PerfDraft");
      await openConsult(page, visitId);
      await page.getByLabel(NOTES_LABEL).click();
      return null;
    },
    act: async (page) => {
      const notes = page.getByLabel(NOTES_LABEL);
      await armTimer(page, { pending: { selector: '[data-save-status="saving"]' }, confirmed: { selector: '[data-save-status="saved"]', after: "pending" } }, { event: "keydown", key: "x" });
      await notes.press("x");
      const result = await readTimer(page, ["confirmed"], 45_000);
      result.pending ??= null;
      return result;
    },
  },
  {
    id: "save.D.add-diagnosis",
    role: "doctor",
    prepare: async (page) => {
      const { visitId } = await seedConsult("PerfDx");
      await openConsult(page, visitId);
      const dx = `Perfdx${testTag()}`;
      await page.getByPlaceholder(/Search diagnosis name/).fill(dx);
      const add = page.getByRole("option", { name: new RegExp(`Add .${dx}. as my own diagnosis`) });
      await expect(add).toBeVisible({ timeout: 20_000 });
      return { add };
    },
    act: async (page, state) => {
      const { add } = state as { add: Locator };
      return actionSave(page, () => add.click(), {}, { event: "click" });
    },
  },
  {
    id: "save.D.add-rx-line",
    role: "doctor",
    prepare: async (page) => {
      const { visitId } = await seedConsult("PerfRx");
      await openConsult(page, visitId);
      const rx = page.locator("#prescription");
      const name = `Perfrx${testTag()}`;
      const field = rxField(rx);
      await field.fill(name);
      const add = rx.getByRole("option", { name: new RegExp(`^Add .${name}.$`) });
      await expect(add).toBeVisible({ timeout: 20_000 });
      const options = await rx.getByRole("option").count();
      for (let i = 0; i < Math.max(1, options - 1); i++) await field.press("ArrowDown");
      await expect(add).toHaveAttribute("aria-selected", "true");
      await field.press("Enter");
      await expect(rx.locator("[data-dose-builder]")).toBeVisible();
      await field.press("1");
      for (const ch of "5d") await field.press(ch);
      return { field, name };
    },
    act: async (page, state) => {
      const { field, name } = state as { field: Locator; name: string };
      return actionSave(page, () => field.press("Enter"), { pending: { selector: '[aria-label="Prescribed medicines"] li', text: name } }, { event: "keydown", key: "Enter" });
    },
  },
  {
    id: "save.D.edit-rx-line",
    role: "doctor",
    prepare: async (page) => {
      const { visitId } = await seedConsult("PerfEdit");
      await openConsult(page, visitId);
      const rx = page.locator("#prescription");
      const name = `Perfedit${testTag()}`;
      const field = rxField(rx);
      await field.fill(name);
      const add = rx.getByRole("option", { name: new RegExp(`^Add .${name}.$`) });
      await expect(add).toBeVisible({ timeout: 20_000 });
      const options = await rx.getByRole("option").count();
      for (let i = 0; i < Math.max(1, options - 1); i++) await field.press("ArrowDown");
      await field.press("Enter");
      await expect(rx.locator("[data-dose-builder]")).toBeVisible();
      await field.press("1");
      for (const ch of "5d") await field.press(ch);
      await field.press("Enter");
      const pill = page.getByRole("button", { name: new RegExp(`5 days\\. Edit dose of ${name}`) });
      await expect(pill).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState("networkidle");
      await pill.click();
      await page.getByRole("radiogroup", { name: "Duration" }).getByRole("radio", { name: "10 days" }).click();
      return { update: page.getByRole("button", { name: "Update line" }), name };
    },
    act: async (page, state) => {
      const { update, name } = state as { update: Locator; name: string };
      return actionSave(page, () => update.click(), { pending: { selector: `button[aria-label*="10 days. Edit dose of ${name}"]` } }, { event: "click" });
    },
  },
  {
    id: "save.D.allergies",
    role: "doctor",
    held: {
      // The editor says nothing of its own: its success is the sheet closing and the strip taking the list. Until the answer the strip still says "not recorded".
      success: /Allergies (saved|recorded)/i,
      before: async (page, state) => {
        const { sheet } = state as { sheet: Locator; patientId: string };
        await expect(sheet).toBeVisible();
        await expect(page.locator("[data-allergy-strip]").getByText("Record now")).toBeVisible();
      },
      stored: async (state) => {
        const { patientId } = state as { sheet: Locator; patientId: string };
        await expect.poll(async () => ((await getAdminClient().from("patients").select("allergies").eq("id", patientId).single()).data?.allergies ?? null)).toEqual([]);
      },
    },
    prepare: async (page) => {
      const { visitId, patientId } = await seedConsult("PerfAllergy", null);
      await openConsult(page, visitId);
      await page.locator("[data-allergy-strip]").getByRole("button", { name: "Record now" }).click();
      const sheet = page.getByRole("dialog", { name: "Allergies" });
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: "No known allergies" }).click();
      return { sheet, patientId };
    },
    act: async (page, state) => {
      const { sheet } = state as { sheet: Locator };
      return clickSave(page, sheet.getByRole("button", { name: "Save allergies" }), { confirmed: { selector: '[role="dialog"]', absent: true } });
    },
  },
  {
    id: "save.D.sign-finish",
    role: "doctor",
    held: {
      success: /Consultation Finalized & Signed/,
      before: async (_page, state) => {
        const { dialog, visitId } = state as { dialog: Locator; visitId: string };
        await expect(dialog).toBeVisible();
        const { data } = await getAdminClient().from("visits").select("status, signed_at").eq("id", visitId).single();
        expect(data?.status).not.toBe("completed");
      },
      stored: async (state) => {
        const { visitId } = state as { dialog: Locator; visitId: string };
        await expect.poll(async () => (await getAdminClient().from("visits").select("status").eq("id", visitId).single()).data?.status ?? null).toBe("completed");
      },
    },
    prepare: async (page) => {
      const { tenantA } = run();
      const name = `E2E Synthetic PerfSign ${testTag()}`;
      const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
      const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: doctorId(), createdBy: tenantA.users.receptionist.id, status: "waiting" });
      await getAdminClient().from("clinical_notes").update({ clinical_notes: "E2E synthetic note" }).eq("visit_id", visitId).throwOnError();
      await seedPrescription({ tenantId: tenantA.id, visitId, patientId: patient.id, doctorId: doctorId(), medicineName: `Perfsign${testTag()}` });
      await openConsult(page, visitId);
      await page.getByRole("button", { name: /Finish visit/ }).first().click();
      const dialog = page.getByRole("dialog", { name: "Complete & Sign Consultation" });
      await expect(dialog).toBeVisible();
      return { dialog, visitId };
    },
    act: async (page, state) => {
      const { dialog } = state as { dialog: Locator };
      return clickSave(page, dialog.getByRole("button", { name: /Sign & Route to Reception/ }), {
        confirmed: { selector: 'h1, h2, h3, h4, [role="heading"]', text: "Consultation Finalized & Signed" },
      });
    },
  },
];

// --- the typeahead rows -------------------------------------------------------------------------------------------------------------

/** A query with a unique tag: its last character is the key that is timed; `lead` is what is typed before it. */
function query(prefix: string): { full: string; lead: string; key: string } {
  const full = `${prefix}${testTag()}`;
  return { full, lead: full.slice(0, -1), key: full.slice(-1) };
}

/** Two patients whose names share a prefix and part again: the last key keeps only one of them. */
async function seedSearchPair(): Promise<{ stem: string; keep: string; drop: string; lead: string; key: string }> {
  const { tenantA } = run();
  const tag = testTag();
  const stem = `Zorbax${tag}`;
  const keep = `${stem} Alpha`;
  const drop = `${stem} Alpine`;
  await seedPatient(tenantA.id, tenantA.users.owner.id, keep);
  await seedPatient(tenantA.id, tenantA.users.owner.id, drop);
  return { stem, keep, drop, lead: `${stem} Alp`, key: "h" };
}

export const TYPEAHEAD_ROWS: readonly TypeaheadRowDef[] = [
  {
    id: "type.D.medicine",
    role: "doctor",
    prepare: async (page) => {
      // 09E-11 (B-4, R-7): the full-size synthetic catalogue is loaded (page-latency.spec.ts); the Rx field answers from the device before the measured key.
      const { visitId } = await seedConsult("PerfTypeMed");
      await openConsult(page, visitId);
      const field = rxField(page.locator("#prescription"));
      await expect(page.locator('#prescription [data-rx-search][data-search-source="device"]')).toBeAttached({ timeout: 60_000 });
      // Two families of 20 brands: "perfrow alp" matches both (40 rows: the device fills the limit of 15, no tail) and shows Alpha (name order); the
      // last key, "i", keeps only Alpine (20 rows, the limit filled again, no tail), so the measured key replaces the list on screen.
      const lead = PERF_FAMILY.keep.toLowerCase().slice(0, -3);
      const key = PERF_FAMILY.keep.toLowerCase().slice(-3, -2);
      await field.click();
      await field.pressSequentially(lead);
      await expect(page.getByRole("option", { name: new RegExp(PERF_FAMILY.drop) }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("option", { name: new RegExp(PERF_FAMILY.keep) })).toHaveCount(0);
      return {
        press: () => field.press(key),
        key,
        marks: { gone: { selector: '[role="option"]', text: PERF_FAMILY.drop, absent: true }, option: { selector: '[role="option"]', text: PERF_FAMILY.keep, after: "gone" } },
      };
    },
  },
  {
    id: "type.D.diagnosis",
    role: "doctor",
    prepare: async (page) => {
      const { visitId } = await seedConsult("PerfTypeDx");
      await openConsult(page, visitId);
      // 09E-10 (B-4): the diagnosis catalogue is on the device before the measured key (the shell's sync after first paint; the row measures the device path).
      await expect(page.locator('[data-diagnosis-input][data-search-source="device"]')).toBeAttached({ timeout: 30_000 });
      const field = page.getByPlaceholder(/Search diagnosis name/);
      const q = query("Perfdx");
      await field.click();
      await field.pressSequentially(q.lead);
      await expect(page.getByRole("option", { name: new RegExp(`Add .${q.lead}. as my own diagnosis`) })).toBeVisible({ timeout: 20_000 });
      return { press: () => field.press(q.key), key: q.key, marks: { option: { selector: '[role="option"]', text: q.full } } };
    },
  },
  {
    id: "type.D.substance",
    role: "doctor",
    prepare: async (page) => {
      const { visitId } = await seedConsult("PerfTypeSub", null);
      await openConsult(page, visitId);
      await page.locator("[data-allergy-strip]").getByRole("button", { name: "Record now" }).click();
      const sheet = page.getByRole("dialog", { name: "Allergies" });
      await expect(sheet).toBeVisible();
      // 09E-09 (B-4): the substance catalogue is on the device before the measured key (the shell's sync after first paint; the row measures the device path).
      await expect(sheet.locator('[data-allergy-search][data-search-source="device"]')).toBeAttached({ timeout: 30_000 });
      const field = sheet.getByRole("combobox");
      const q = query("Perfsub");
      await field.click();
      await field.pressSequentially(q.lead);
      await expect(sheet.getByRole("option", { name: new RegExp(`Add .${q.lead}.`) })).toBeVisible({ timeout: 20_000 });
      return { press: () => field.press(q.key), key: q.key, marks: { option: { selector: '[role="option"]', text: q.full } } };
    },
  },
  {
    id: "type.R.patient-today",
    role: "receptionist",
    prepare: async (page) => {
      const pair = await seedSearchPair();
      await openToday(page, "/today?walkin=1");
      await page.waitForLoadState("networkidle");
      const sheet = page.getByRole("dialog", { name: "Add walk-in" });
      await expect(sheet).toBeVisible();
      const field = sheet.getByRole("combobox", { name: "Patient" });
      await field.click();
      await field.pressSequentially(pair.lead);
      await expect(sheet.getByRole("option", { name: new RegExp(pair.drop) })).toBeVisible({ timeout: 20_000 });
      await expect(sheet.getByRole("option", { name: new RegExp(pair.keep) })).toBeVisible();
      return { press: () => field.press(pair.key), key: pair.key, marks: { gone: { selector: '[role="option"]', text: pair.drop, absent: true }, option: { selector: '[role="option"]', text: pair.keep, after: "gone" } } };
    },
  },
  {
    id: "type.R.patient-register",
    role: "receptionist",
    prepare: async (page) => {
      const pair = await seedSearchPair();
      const { tenantA } = run();
      const sheet = await openBooking(page, await freeBookingDate(tenantA.id, doctorId()));
      const field = sheet.getByRole("combobox", { name: "Patient" });
      await field.click();
      await field.pressSequentially(pair.lead);
      await expect(sheet.getByRole("option", { name: new RegExp(pair.drop) })).toBeVisible({ timeout: 20_000 });
      await expect(sheet.getByRole("option", { name: new RegExp(pair.keep) })).toBeVisible();
      return { press: () => field.press(pair.key), key: pair.key, marks: { gone: { selector: '[role="option"]', text: pair.drop, absent: true }, option: { selector: '[role="option"]', text: pair.keep, after: "gone" } } };
    },
  },
];

/** The measured step of a typeahead row: the last key → the first option that reflects it. */
export async function typeaheadAct(page: Page, state: TypeaheadState): Promise<Marks> {
  await armTimer(page, state.marks, { event: "keydown", key: state.key });
  await state.press();
  const marks = await readTimer(page, ["option"], 45_000);
  for (const name of Object.keys(state.marks)) marks[name] ??= null;
  return marks;
}
