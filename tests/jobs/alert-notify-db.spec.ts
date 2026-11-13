/**
 * V2-04 04-04: the `alert.notify` handler against the local stack's Mailpit (as 03-11b's sender spec does), through
 * the real runner and the real `getEmailSender()` (env stubbed after the lane guard: Mailpit, the synthetic ops inbox).
 *
 * - One message to `ops-alerts@example.test` with the subject `[clinicos test] <SEVERITY> <rule>`; the alert records
 *   `notified_at`, `notify_count` and the Mailpit message id; the job is `done` after one attempt.
 * - PHI (T-04-10, T-04-22): a synthetic patient (name, phone, guardian) whose message is dead-lettered raises
 *   `dead_letter`; the email carries none of the patient's or the clinic owner's identifiers. Every input of the shared
 *   scrub vectors (tests/fixtures/scrub-vectors.json), put into the alert's details as values and as keys, leaves none
 *   of its `absent` strings in the subject, text or HTML.
 * - `OPS_ALERT_EMAIL` unset, or `EMAIL_PROVIDER=disabled` → the job is dead with `alert_channel_unconfigured` and no
 *   message is sent; an unreachable Mailpit → retried with the sender's fixed code; an alert already notified for this
 *   notification → done without a send; an unknown alert → dead `alert_not_found`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DisabledMessagingProvider } from "@/lib/messaging";
import { ALERT_NOTIFY_HANDLERS } from "@/lib/jobs/internal/handlers/alert-notify";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import VECTORS from "../fixtures/scrub-vectors.json";
import { LOCAL_MAILPIT_API_URL, LOCAL_OPS_ALERT_EMAIL } from "../setup/test-env";
import {
  alertFor,
  deleteMail,
  mailForAlert,
  mailMessage,
  notifyJobsFor,
  resetAlertState,
  runKinds,
  useMailpitAlerts,
  UUID_RE,
} from "./alert-helpers";
import { deleteRunnerRuns, letters } from "./helpers";
import { jobsFor, queueState, runMessages, seedPatient, type SeededPatient } from "./message-helpers";

const WORKER = `test:alert-notify-${letters(6)}`;
const mailIds: string[] = [];
let owner: SeededTenant;
let patient: SeededPatient;
const guardianPhone = "+919000000077";
const guardianName = `Synthetic Guardian ${letters(6)}`;

beforeAll(async () => {
  resetAlertState();
  owner = await seedTenantWithOwner(`Alert Notify Spec ${letters(6)}`);
  patient = await seedPatient(owner.tenantId, owner.userId);
  const { error } = await getAdminClient()
    .from("patients")
    .update({ guardian_name: guardianName, guardian_phone: guardianPhone })
    .eq("id", patient.patientId);
  if (error) throw new Error(`guardian update failed: ${error.code}`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetAlertState();
});

afterAll(async () => {
  resetAlertState();
  deleteRunnerRuns(WORKER);
  await deleteMail(mailIds);
});

function uuid(v: string): string {
  if (!UUID_RE.test(v)) throw new Error("not a uuid");
  return v;
}

/** An open alert of `rule` (committed) with one notify job `alert:<id>:1`; returns its id. */
function openAlert(rule: string, details: Record<string, unknown> = { events: 21, threshold: 20 }): string {
  const json = JSON.stringify(details).replace(/'/g, "''");
  const [id] = psql(
    `insert into ops.alerts (rule, severity, details) select r.rule, r.severity, '${json}'::jsonb from ops.alert_rules r ` +
      `where r.rule = '${rule.replace(/[^a-z_]/g, "")}' returning id`,
  );
  psql(`select ops.enqueue_job('alert.notify', null, jsonb_build_object('alert_id', '${uuid(id)}'::uuid, 'seq', 1), 'alert:${id}:1', now(), 5)`);
  return id;
}

function notify(label: string) {
  return runKinds(["alert.notify"], ALERT_NOTIFY_HANDLERS, `${WORKER}:${label}`);
}

async function collect(alertId: string) {
  const found = await mailForAlert(alertId);
  mailIds.push(...found.map((m) => m.ID));
  return found;
}

describe("alert.notify → Mailpit", () => {
  it("sends one message to the ops inbox with the expected subject and records the notification", async () => {
    useMailpitAlerts();
    const id = openAlert("error_burst");
    const result = await notify("one");
    expect(result).toMatchObject({ ok: true, claimed: 1, done: 1, retried: 0, dead: 0 });

    const found = await collect(id);
    expect(found).toHaveLength(1);
    const msg = await mailMessage(found[0].ID);
    expect(msg.Subject).toBe("[clinicos test] WARN error_burst");
    expect(msg.To.map((t) => t.Address)).toEqual([LOCAL_OPS_ALERT_EMAIL]);
    expect(msg.Text).toContain("Rule: error_burst");
    expect(msg.Text).toContain("Severity: WARN");
    expect(msg.Text).toContain("events: 21");
    expect(msg.Text).toMatch(/First seen: \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2} IST \(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\)/);
    expect(msg.Text).toContain("Runbook: docs/runbooks/jobs.md#error_burst");

    expect(alertFor("error_burst")).toMatchObject({ id, notifyCount: 1, notified: true, providerMessageId: found[0].ID });
    expect(notifyJobsFor(id)).toEqual([expect.objectContaining({ status: "done", attempts: 1, lastError: null })]);
  });

  it("a critical rule says CRITICAL in the subject", async () => {
    useMailpitAlerts();
    const id = openAlert("backup_stale", { max_age_hours: 13, latest_run_failed: true, failed_runs: 1, last_ok_at: null });
    await notify("critical");
    const [found] = await collect(id);
    expect((await mailMessage(found.ID)).Subject).toBe("[clinicos test] CRITICAL backup_stale");
  });

  it("a patient's dead-lettered message raises dead_letter; the email carries no patient or owner identifier", async () => {
    useMailpitAlerts();
    const { data, error } = await owner.client.rpc("enqueue_message", {
      p_tenant_id: owner.tenantId,
      p_patient_id: patient.patientId,
      p_visit_id: null as unknown as string,
      p_channel: "whatsapp",
      p_message_type: "prescription_ready",
      p_template_id: "prescription_ready",
      p_template_params: { patient_name: guardianName },
      p_recipient_phone: null as unknown as string,
      p_recipient_user_id: null as unknown as string,
      p_metadata: {},
    });
    expect(error).toBeNull();
    const queueId = (data as { id: string }).id;
    await runMessages(new DisabledMessagingProvider(), `${WORKER}:msg`);
    expect(queueState(queueId).status).toBe("dead_letter");
    const [messageJob] = jobsFor(queueId);
    expect(messageJob.status).toBe("dead");

    psql("select ops.evaluate_alerts()");
    const alert = alertFor("dead_letter");
    expect(alert).toBeDefined();
    await notify("phi");
    const found = await collect(alert!.id);
    expect(found).toHaveLength(1);
    const msg = await mailMessage(found[0].ID);
    expect(msg.Text).toContain(messageJob.id);

    const [fullName] = psql(`select full_name from public.patients where id = '${uuid(patient.patientId)}'`);
    const national = (p: string) => p.replace(/^\+91/, "");
    const markers = [
      patient.phone, national(patient.phone), guardianPhone, national(guardianPhone), fullName, guardianName,
      owner.userEmail, owner.userEmail.split("@")[0], owner.tenantName, owner.tenantId, patient.patientId, patient.visitId, queueId,
    ];
    for (const part of [msg.Subject, msg.Text, msg.HTML]) {
      for (const marker of markers) expect(part, "an identifier reached the alert email").not.toContain(marker);
    }
  });

  it("no input of the shared scrub vectors survives into the email, as a detail value or as a key", async () => {
    useMailpitAlerts();
    // ops.alerts.details is capped at 4 KB, so the vectors go out in batches, one alert (and one email) per batch.
    const batches: Array<{ details: Record<string, unknown>; vectors: typeof VECTORS.messages }> = [];
    let current = { details: { events: 21 } as Record<string, unknown>, vectors: [] as typeof VECTORS.messages };
    VECTORS.messages.forEach((v, i) => {
      const next = { ...current.details, [`v${i}`]: v.input, [v.input]: 1 };
      if (Buffer.byteLength(JSON.stringify(next)) > 3500 && current.vectors.length > 0) {
        batches.push(current);
        current = { details: { events: 21, [`v${i}`]: v.input, [v.input]: 1 }, vectors: [v] };
      } else {
        current = { details: next, vectors: [...current.vectors, v] };
      }
    });
    current.details.nested = { phone: "+919000000088" };
    current.details.list = ["+919000000089", "synthetic.patient@example.com"];
    batches.push(current);
    expect(batches.reduce((n, b) => n + b.vectors.length, 0)).toBe(VECTORS.messages.length);

    for (const [i, batch] of batches.entries()) {
      resetAlertState();
      const id = openAlert("error_burst", batch.details);
      await notify(`vectors-${i}`);
      const found = await collect(id);
      expect(found).toHaveLength(1);
      const msg = await mailMessage(found[0].ID);
      for (const part of [msg.Subject, msg.Text, msg.HTML]) {
        for (const vector of batch.vectors) {
          for (const absent of vector.absent) expect(part, `${vector.id}: ${absent}`).not.toContain(absent);
        }
        for (const raw of ["9000000088", "9000000089", "synthetic.patient"]) expect(part).not.toContain(raw);
      }
      expect(msg.Text).toContain("events: 21");
      expect(msg.Text).toMatch(/omitted: \d+/);
    }
  });
});

describe("alert.notify: channel and failure handling", () => {
  it("R-51: provider down → no email, notified_at null; provider back → the next evaluation sends exactly one", async () => {
    useMailpitAlerts();
    psql(
      "insert into ops.jobs (kind, dedupe_key, status, attempts, max_attempts, finished_at, last_error) values " +
        "('test.alert_retry', 'alert-retry:' || gen_random_uuid(), 'dead', 1, 1, now(), 'drill_failure')",
    );
    try {
      psql("select ops.evaluate_alerts()");
      const alert = alertFor("dead_letter")!;
      expect(notifyJobsFor(alert.id)).toHaveLength(1);

      // The email provider is down: every try of the job fails until it is dead (5 attempts, run_at advanced by SQL).
      vi.stubEnv("MAILPIT_API_URL", "http://127.0.0.1:9");
      for (let i = 0; i < 5; i++) {
        psql(`update ops.jobs set run_at = now() where kind = 'alert.notify' and status = 'pending' and payload ->> 'alert_id' = '${uuid(alert.id)}'`);
        await notify(`down-${i}`);
      }
      expect(notifyJobsFor(alert.id)).toEqual([expect.objectContaining({ status: "dead", attempts: 5, lastError: "mailpit_unreachable" })]);
      expect(await collect(alert.id)).toHaveLength(0);
      expect(alertFor("dead_letter")).toMatchObject({ id: alert.id, notified: false, notifyCount: 0 });

      // Inside the 15-minute retry interval nothing new is enqueued.
      psql("select ops.evaluate_alerts()");
      expect(notifyJobsFor(alert.id)).toHaveLength(1);

      // The provider is back; the retry interval has passed (moved by SQL): the next evaluation tries again, once.
      vi.stubEnv("MAILPIT_API_URL", LOCAL_MAILPIT_API_URL);
      psql(`update ops.alerts set notify_enqueued_at = now() - interval '16 minutes' where id = '${uuid(alert.id)}'`);
      psql("select ops.evaluate_alerts()");
      const jobs = notifyJobsFor(alert.id);
      expect(jobs.map((j) => j.dedupeKey)).toEqual([`alert:${alert.id}:1`, `alert:${alert.id}:1:r2`]);
      await notify("back");

      const found = await collect(alert.id);
      expect(found).toHaveLength(1);
      expect((await mailMessage(found[0].ID)).Subject).toBe("[clinicos test] WARN dead_letter");
      expect(alertFor("dead_letter")).toMatchObject({ id: alert.id, notified: true, notifyCount: 1, providerMessageId: found[0].ID });

      // Sent: later evaluations (even past the retry interval) enqueue nothing more, and no second email goes out.
      psql(`update ops.alerts set notify_enqueued_at = now() - interval '16 minutes' where id = '${uuid(alert.id)}'`);
      psql("select ops.evaluate_alerts()");
      expect(notifyJobsFor(alert.id)).toHaveLength(2);
      await notify("after");
      expect(await collect(alert.id)).toHaveLength(1);
    } finally {
      psql("delete from ops.jobs where kind = 'test.alert_retry'");
    }
  });

  it("OPS_ALERT_EMAIL unset → dead alert_channel_unconfigured, no message, the alert stays unnotified", async () => {
    useMailpitAlerts();
    vi.stubEnv("OPS_ALERT_EMAIL", "");
    const id = openAlert("error_burst");
    const result = await notify("unset");
    expect(result).toMatchObject({ claimed: 1, dead: 1 });
    expect(notifyJobsFor(id)).toEqual([expect.objectContaining({ status: "dead", lastError: "alert_channel_unconfigured" })]);
    expect(await collect(id)).toHaveLength(0);
    expect(alertFor("error_burst")).toMatchObject({ notifyCount: 0, notified: false, providerMessageId: null });
  });

  it("EMAIL_PROVIDER=disabled → dead alert_channel_unconfigured, no message", async () => {
    vi.stubEnv("OPS_ALERT_EMAIL", LOCAL_OPS_ALERT_EMAIL);
    vi.stubEnv("EMAIL_PROVIDER", "disabled");
    const id = openAlert("error_burst");
    await notify("disabled");
    expect(notifyJobsFor(id)).toEqual([expect.objectContaining({ status: "dead", lastError: "alert_channel_unconfigured" })]);
    expect(await collect(id)).toHaveLength(0);
  });

  it("an unreachable Mailpit is retried with the sender's fixed code; nothing recorded as notified", async () => {
    useMailpitAlerts();
    vi.stubEnv("MAILPIT_API_URL", "http://127.0.0.1:9");
    const id = openAlert("error_burst");
    const result = await notify("unreachable");
    expect(result).toMatchObject({ claimed: 1, retried: 1 });
    expect(notifyJobsFor(id)).toEqual([expect.objectContaining({ status: "pending", lastError: "mailpit_unreachable" })]);
    expect(alertFor("error_burst")).toMatchObject({ notified: false });
  });

  it("an alert already notified for this notification is done without a second send", async () => {
    useMailpitAlerts();
    const id = openAlert("error_burst");
    psql(`update ops.alerts set notify_count = 1, notified_at = now() where id = '${uuid(id)}'`);
    expect(await notify("already")).toMatchObject({ claimed: 1, done: 1 });
    expect(await collect(id)).toHaveLength(0);
  });

  it("an unknown alert → dead alert_not_found", async () => {
    useMailpitAlerts();
    const [jobId] = psql(
      "select ops.enqueue_job('alert.notify', null, jsonb_build_object('alert_id', gen_random_uuid(), 'seq', 1), " +
        "'alert:spec-unknown:' || gen_random_uuid(), now(), 5)",
    );
    await notify("unknown");
    expect(psql(`select status || '|' || last_error from ops.jobs where id = '${uuid(jobId)}'`)).toEqual(["dead|alert_not_found"]);
  });
});
