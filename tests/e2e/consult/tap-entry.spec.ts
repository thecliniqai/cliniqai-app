/**
 * V2-09b 09B-03 (R-9, R-12; M4 criterion 2): tap-first entry on the consult. The `ux` counter records the user's taps and typed characters (the counts
 * are written for desktop-chrome, FRONTEND_MIGRATION_PLAN M4):
 *   - three complaints, each with its duration: at most 3 taps, 0 typed characters;
 *   - an exam template with one abnormal finding: at most 3 taps, 0 typed;
 *   - a follow-up: 1 tap;
 * and after a refresh the database holds the complaints, the structured `exam`, the mirrored `systemic` text and the follow-up date. With the doctor's own
 * signed history the tiles are ranked from it and labelled Smart Assist; with `assist.terminology` switched off by a platform override the same tiles show
 * in catalogue order with no label.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { istDate, run, seedPatient, seedVisit, signSeededVisit, testTag } from "../support/m0-data";
import { getAdminClient } from "../../helpers/supabase-admin";
import { storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("doctor") });

const saved = (page: Page) => page.locator("[data-save-status='saved']");

async function seedOpenConsult(label: string, opts: { diagnosis?: string } = {}) {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Tap ${label} ${testTag()}`);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.receptionist.id,
    status: "in_consultation",
  });
  if (opts.diagnosis) {
    const { error } = await getAdminClient()
      .from("consultation_diagnoses")
      .insert({ tenant_id: tenantA.id, visit_id: visitId, patient_id: patient.id, diagnosis_name: opts.diagnosis });
    if (error) throw new Error(error.message);
  }
  return { tenantId: tenantA.id, visitId };
}

async function openConsult(page: Page, visitId: string) {
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
}

async function notesRow(visitId: string) {
  const { data, error } = await getAdminClient()
    .from("clinical_notes")
    .select("chief_complaints, specialty_data, investigations_advised, advice, draft_version")
    .eq("visit_id", visitId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function followUpDate(visitId: string): Promise<string | null> {
  const { data } = await getAdminClient().from("follow_ups").select("follow_up_date").eq("visit_id", visitId).maybeSingle();
  return data?.follow_up_date ?? null;
}

test("@golden three complaints with their durations in 3 taps and no typing, saved and still there after a refresh", async ({ page, ux }) => {
  ux.flow("consult-complaints", "Three complaints from the tiles, each with its default duration");
  const { visitId } = await seedOpenConsult("complaints");
  await openConsult(page, visitId);

  const tiles = page.getByRole("group", { name: "Complaints", exact: true });
  for (const name of ["Fever", "Cough", "Cold"]) {
    await ux.click(tiles.getByRole("button", { name, exact: true }), `Complaint tile: ${name}`);
  }
  const rows = page.getByRole("list", { name: "Complaints added" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  for (const name of ["Fever", "Cough", "Cold"]) {
    await expect(page.getByRole("radiogroup", { name: `Duration of ${name}` }).getByRole("radio", { name: "3d" })).toBeChecked();
  }
  ux.done();

  const counts = ux.counts();
  expect(counts?.actions).toBeLessThanOrEqual(3);
  expect(counts?.keystrokes).toBe(0);

  // A different duration is one more tap, and the tile that was added is gone from the tiles.
  await page.getByRole("radiogroup", { name: "Duration of Cough" }).getByRole("radio", { name: "1w" }).click();
  await expect(tiles.getByRole("button", { name: "Fever", exact: true })).toHaveCount(0);

  await expect(saved(page)).toBeVisible({ timeout: 9_000 });
  await expect
    .poll(async () => ((await notesRow(visitId)).chief_complaints as Array<{ symptom: string; duration_val: number; duration_unit: string }>).map((c) => [c.symptom, c.duration_val, c.duration_unit]), { timeout: 12_000 })
    .toEqual([
      ["Fever", 3, "days"],
      ["Cough", 1, "weeks"],
      ["Cold", 3, "days"],
    ]);

  await page.reload();
  await awaitHydrated(page);
  await expect(page.getByRole("list", { name: "Complaints added" }).getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("radiogroup", { name: "Duration of Cough" }).getByRole("radio", { name: "1w" })).toBeChecked();
});

test("@golden an exam template with one abnormal finding in 3 taps and no typing; the exam, its mirror and the follow-up survive a refresh", async ({ page, ux }) => {
  ux.flow("consult-exam", "A respiratory exam with crepts on the right: template, Abnormal, finding");
  const { visitId } = await seedOpenConsult("exam");
  await openConsult(page, visitId);

  await ux.click(page.getByRole("radiogroup", { name: "Examination template" }).getByRole("radio", { name: /^Respiratory/ }), "Template: Respiratory");
  // Every system starts normal and reads as the template's normal text.
  const rs = page.locator('[data-exam-system="rs"]');
  await expect(rs).toContainText("Bilateral air entry equal, no added sounds");
  await ux.click(rs.getByRole("radio", { name: "Abnormal" }), "RS: Abnormal");
  await ux.click(page.getByRole("group", { name: "RS findings" }).getByRole("button", { name: "Crepts", exact: true }), "RS finding: Crepts");
  await expect(rs).toContainText("Crepts");
  ux.done();

  const counts = ux.counts();
  expect(counts?.actions).toBeLessThanOrEqual(3);
  expect(counts?.keystrokes).toBe(0);

  // The side and the follow-up (the 5-day default is already set; one tap picks a week) are one tap each.
  await rs.getByRole("radiogroup", { name: "RS side" }).getByRole("radio", { name: "Right" }).click();
  const followUp = page.getByRole("radiogroup", { name: "Follow-up" });
  await expect(followUp.getByRole("radio", { name: "5 days" })).toBeChecked();
  await followUp.getByRole("radio", { name: "1 week" }).click();

  await expect(saved(page)).toBeVisible({ timeout: 9_000 });
  await expect.poll(async () => followUpDate(visitId), { timeout: 12_000 }).toBe(istDate(7));
  const row = await notesRow(visitId);
  expect(row.specialty_data).toMatchObject({
    specialty: "general_physician",
    exam: {
      template_id: "resp",
      systems: {
        ent: { abnormal: false, findings: [] },
        rs: { abnormal: true, findings: ["Crepts"], side: "Right" },
        cvs: { abnormal: false, findings: [] },
      },
    },
    systemic: {
      ent: "Normal: Throat not congested, tonsils normal, no post-nasal drip",
      rs: "Abnormal: Crepts (Right)",
      cvs: "Normal: S1 S2 normal, no murmur",
    },
  });

  await page.reload();
  await awaitHydrated(page);
  await expect(page.getByRole("radiogroup", { name: "Examination template" }).getByRole("radio", { name: /^Respiratory/ })).toBeChecked();
  await expect(page.locator('[data-exam-system="rs"]')).toContainText("Crepts (Right)");
  await expect(page.getByRole("group", { name: "RS findings" }).getByRole("button", { name: "Crepts", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-follow-up-hint]")).toContainText("the front desk books it when you finish");
});

test("@golden a follow-up is one tap, and the date follows the clinic's today", async ({ page, ux }) => {
  ux.flow("consult-follow-up", "Follow-up interval from the tiles");
  const { visitId } = await seedOpenConsult("followup");
  await openConsult(page, visitId);
  const followUp = page.getByRole("radiogroup", { name: "Follow-up" });
  await ux.click(followUp.getByRole("radio", { name: "2 weeks" }), "Follow-up: 2 weeks");
  ux.done();
  expect(ux.counts()?.actions).toBe(1);
  expect(ux.counts()?.keystrokes).toBe(0);
  await expect(page.locator("[data-follow-up-hint]")).toBeVisible();
  await expect(saved(page)).toBeVisible({ timeout: 9_000 });
  await expect.poll(async () => followUpDate(visitId), { timeout: 12_000 }).toBe(istDate(14));
});

test("the exam: switching template with an abnormal finding asks first; Dental hands over to the odontogram", async ({ page }) => {
  const { visitId } = await seedOpenConsult("switch");
  await openConsult(page, visitId);
  const templates = page.getByRole("radiogroup", { name: "Examination template" });
  await templates.getByRole("radio", { name: /^Fever workup/ }).click();
  const cvs = page.locator('[data-exam-system="cvs"]');
  await cvs.getByRole("radio", { name: "Abnormal" }).click();
  await page.getByRole("group", { name: "CVS findings" }).getByRole("button", { name: "Murmur", exact: true }).click();

  await templates.getByRole("radio", { name: /^GP general/ }).click();
  const dialog = page.getByRole("alertdialog", { name: "Switch to GP general?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep what I entered" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(cvs).toContainText("Murmur");

  await templates.getByRole("radio", { name: /^Dental/ }).click();
  const dental = page.getByRole("alertdialog", { name: "Switch to Dental?" });
  await expect(dental).toBeVisible();
  await dental.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByRole("radiogroup", { name: "Examination template" }).getByRole("radio", { name: /^Dental/ })).toBeChecked();
  await expect(page.locator("[data-exam]")).toHaveCount(0);
  await expect(saved(page)).toBeVisible({ timeout: 9_000 });
  await expect
    .poll(async () => (await getAdminClient().from("visits").select("specialty").eq("id", visitId).single()).data?.specialty, { timeout: 12_000 })
    .toBe("dental");
});

test.describe.serial("learned order from the doctor's own signed visits (R-12)", () => {
  const KNEE = "Knee pain";
  const DIAGNOSIS = "Knee strain E2E";
  const TEST_ADVISED = "X-ray knee E2E";

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const { tenantA } = run();
    const admin = getAdminClient();
    const doctor = tenantA.users.doctor;
    // Three signed visits of the doctor: the same complaint and diagnosis, one usual test and a follow-up a week out (each signed today).
    for (let i = 0; i < 3; i++) {
      const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic History ${i} ${testTag()}`);
      const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: doctor.id, createdBy: tenantA.users.receptionist.id, status: "waiting" });
      const notes = await admin
        .from("clinical_notes")
        .update({
          clinical_notes: "E2E synthetic history note",
          chief_complaints: [{ symptom: KNEE, duration_val: 2, duration_unit: "weeks" }],
          investigations_advised: [TEST_ADVISED],
        })
        .eq("visit_id", visitId);
      if (notes.error) throw new Error(notes.error.message);
      const dx = await admin.from("consultation_diagnoses").insert({ tenant_id: tenantA.id, visit_id: visitId, patient_id: patient.id, diagnosis_name: DIAGNOSIS });
      if (dx.error) throw new Error(dx.error.message);
      const fu = await admin
        .from("follow_ups")
        .insert({ tenant_id: tenantA.id, visit_id: visitId, patient_id: patient.id, doctor_id: doctor.id, follow_up_date: istDate(7) });
      if (fu.error) throw new Error(fu.error.message);
      await signSeededVisit(tenantA.id, visitId, doctor.email);
    }
  });

  test("the doctor's own complaint leads the tiles with the Smart Assist label; the usual test and follow-up for the diagnosis come first", async ({ page }) => {
    const { visitId } = await seedOpenConsult("learned", { diagnosis: DIAGNOSIS });
    await openConsult(page, visitId);

    const complaintTiles = page.locator("[data-complaint-tiles]");
    await expect(complaintTiles).toHaveAttribute("data-smart-assist", "on");
    await expect(complaintTiles).toContainText("Smart Assist");
    await expect(complaintTiles.getByRole("group", { name: "Complaints", exact: true }).getByRole("button").first()).toHaveText(KNEE);

    const tests = page.getByRole("group", { name: "Investigations advised" });
    await expect(tests.getByRole("button").first()).toHaveText(TEST_ADVISED);
    await expect(page.locator("[data-usual-note]").first()).toContainText(`usual for ${DIAGNOSIS} first`);
    await expect(page.getByRole("radiogroup", { name: "Follow-up" }).getByRole("radio", { name: /1 week/ })).toContainText("your usual");

    // A tap still adds exactly what it names, nothing more.
    await tests.getByRole("button", { name: TEST_ADVISED }).click();
    await expect(saved(page)).toBeVisible({ timeout: 9_000 });
    await expect.poll(async () => (await notesRow(visitId)).investigations_advised, { timeout: 12_000 }).toEqual([TEST_ADVISED]);
  });

  test("with assist.terminology switched off the same tiles are in catalogue order and carry no label", async ({ page }) => {
    const { tenantA } = run();
    const admin = getAdminClient();
    const override = await admin.from("tenant_entitlement_overrides").insert({
      tenant_id: tenantA.id,
      key: "assist.terminology",
      enabled: false,
      reason: "Synthetic test: Smart Assist terminology off",
    });
    expect(override.error).toBeNull();
    try {
      const { visitId } = await seedOpenConsult("not-entitled", { diagnosis: DIAGNOSIS });
      await openConsult(page, visitId);
      const complaintTiles = page.locator("[data-complaint-tiles]");
      await expect(complaintTiles).toHaveAttribute("data-smart-assist", "off");
      await expect(complaintTiles.getByRole("group", { name: "Complaints", exact: true }).getByRole("button").first()).toHaveText("Fever");
      await expect(complaintTiles).not.toContainText("Smart Assist");
      await expect(page.locator("[data-usual-note]")).toHaveCount(0);
      await expect(page.locator("[data-exam-templates]")).toHaveAttribute("data-smart-assist", "off");
      const tests = page.getByRole("group", { name: "Investigations advised" });
      await expect(tests.getByRole("button").first()).toHaveText("Complete Blood Count (CBC)");
    } finally {
      await admin.from("tenant_entitlement_overrides").delete().eq("tenant_id", tenantA.id).eq("key", "assist.terminology");
    }
  });
});
