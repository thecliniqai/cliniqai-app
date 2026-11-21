/**
 * A doctor of the run's clinic A made for one test or one serial group (CI 44924479177).
 *
 * The run's doctor is shared by every spec and, in the PR lane, by every device project: desktop-chrome, pixel-7 and iphone-15 run one after the other
 * against one database. Whatever reads "the doctor's own" data therefore also reads what other specs and the earlier projects left behind: the learned
 * order of the consult tiles (`consult_assist_context`, the doctor's last 300 signed visits) and the doctor's queue on Today (its Next card is the first
 * urgent token of the day). A spec whose assertion depends on that data seeds its own doctor, signs its page in as them, and reads only what it wrote.
 *
 * The doctor is an active member while the test runs and is marked removed afterwards ({@link retireOwnDoctor}), so no later spec sees an extra doctor
 * in the clinic's doctor lists; the run's teardown deletes the user with the run. Synthetic data only; the password is the run's and is never printed.
 */
import type { Page } from "@playwright/test";
import { getAdminClient } from "../../helpers/supabase-admin";
import { uiSignIn } from "./password-journeys";
import { run, testTag } from "./m0-data";
import { runPassword, type RunUser } from "./run-data";

/** A new active doctor in clinic A, with the run's password (so `signSeededVisit` can sign their visits). */
export async function seedOwnDoctor(label: string): Promise<RunUser & { name: string }> {
  const { tenantA } = run();
  const admin = getAdminClient();
  const tag = testTag();
  const email = `e2e-own-doctor-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${tag}@example.com`;
  const created = await admin.auth.admin.createUser({ email, password: runPassword(), email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`own doctor: user creation failed: ${created.error?.message}`);
  const name = `E2E Synthetic Doctor ${label} ${tag}`;
  const member = await admin.from("memberships").insert({ user_id: created.data.user.id, tenant_id: tenantA.id, role: "doctor", full_name: name });
  if (member.error) throw new Error(`own doctor: membership failed: ${member.error.message}`);
  return { id: created.data.user.id, email, name };
}

/** Signs `page`'s context out of the run's role and in as `doctor`, through the login UI (lands on Today). */
export async function signInAsOwnDoctor(page: Page, doctor: RunUser): Promise<void> {
  await page.context().clearCookies();
  await uiSignIn(page, { email: doctor.email, password: runPassword() });
}

/** Marks the doctor's membership removed: later specs see the clinic's usual doctor list. Their visits stay as they are. */
export async function retireOwnDoctor(doctor: RunUser): Promise<void> {
  const { error } = await getAdminClient()
    .from("memberships")
    .update({ status: "removed", removed_at: new Date().toISOString() })
    .eq("tenant_id", run().tenantA.id)
    .eq("user_id", doctor.id);
  if (error) throw new Error(`own doctor: retiring failed: ${error.message}`);
}
