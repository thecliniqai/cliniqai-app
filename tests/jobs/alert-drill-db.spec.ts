/**
 * V2-04 04-04 tracer: the local version of the staging alert drill (roadmap V2-04 "an alert fires in the staging
 * drill"; docs/runbooks/jobs.md "Alert drill").
 *
 * `ops.drill_enqueue('drill.always_fail', 1, '0', 2)` → two runner passes with the real registry (run_at advanced by
 * SQL between them) → the job is `dead` (`drill_failure`) → `ops.evaluate_alerts()` opens one `dead_letter` alert and
 * enqueues one `alert.notify` job → a runner pass with the real handler → exactly one Mailpit message to the synthetic
 * ops inbox, and the alert records the notification. A second evaluation inside the cooldown refreshes the alert
 * (count 2) and neither enqueues nor sends anything more.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getJobHandlers } from "@/lib/jobs/internal/registry";
import { psql } from "../helpers/sql";
import { LOCAL_OPS_ALERT_EMAIL } from "../setup/test-env";
import {
  ALERT_FROM,
  alertFor,
  deleteMail,
  mailForAlert,
  mailMessage,
  notifyJobsFor,
  resetAlertState,
  runKinds,
  useMailpitAlerts,
} from "./alert-helpers";
import { deleteRunnerRuns } from "./helpers";

const WORKER = "test:alert-drill";
const mailIds: string[] = [];

beforeAll(() => {
  resetAlertState();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  resetAlertState();
  deleteRunnerRuns(WORKER);
  await deleteMail(mailIds);
});

function drillJob(id: string): { status: string; attempts: number; lastError: string | null } {
  const [line] = psql(`select status || '|' || attempts || '|' || coalesce(last_error, '') from ops.jobs where id = '${id}'`);
  const [status, attempts, lastError] = line.split("|");
  return { status, attempts: Number(attempts), lastError: lastError || null };
}

describe("alert drill (local): dead drill job → dead_letter alert → alert.notify → one email", () => {
  it("drill.always_fail dies after two passes, raises dead_letter and mails the ops inbox exactly once", async () => {
    vi.stubEnv("JOBS_DRILL_ENABLED", "true");
    useMailpitAlerts();
    const handlers = getJobHandlers();
    expect(Object.keys(handlers)).toEqual(expect.arrayContaining(["alert.notify", "drill.always_fail"]));

    expect(psql("select ops.drill_enqueue('drill.always_fail', 1, '0', 2)")).toEqual(["1"]);
    const [jobId] = psql("select id from ops.jobs where kind = 'drill.always_fail'");

    const first = await runKinds(["drill.always_fail"], handlers, `${WORKER}:1`);
    expect(first).toMatchObject({ ok: true, claimed: 1, retried: 1, dead: 0 });
    expect(drillJob(jobId)).toEqual({ status: "pending", attempts: 1, lastError: "drill_failure" });

    psql(`update ops.jobs set run_at = now() where id = '${jobId}'`);
    const second = await runKinds(["drill.always_fail"], handlers, `${WORKER}:2`);
    expect(second).toMatchObject({ ok: true, claimed: 1, retried: 0, dead: 1 });
    expect(drillJob(jobId)).toEqual({ status: "dead", attempts: 2, lastError: "drill_failure" });

    // Evaluate (pg_cron does this every 5 minutes; the lane paused it).
    psql("select ops.evaluate_alerts()");
    const alert = alertFor("dead_letter");
    expect(alert).toMatchObject({ severity: "warn", status: "open", count: 1, notifyCount: 0, notified: false });
    const [jobIds] = psql(`select details -> 'job_ids' from ops.alerts where id = '${alert!.id}'`);
    expect(JSON.parse(jobIds)).toContain(jobId);
    const jobs = notifyJobsFor(alert!.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "pending", dedupeKey: `alert:${alert!.id}:1` });

    const notify = await runKinds(["alert.notify"], handlers, `${WORKER}:notify`);
    expect(notify.ok).toBe(true);
    expect(notifyJobsFor(alert!.id)).toEqual([expect.objectContaining({ status: "done", attempts: 1, lastError: null })]);

    const mail = await mailForAlert(alert!.id);
    mailIds.push(...mail.map((m) => m.ID));
    expect(mail).toHaveLength(1);
    const msg = await mailMessage(mail[0].ID);
    expect(msg.Subject).toBe("[clinicos test] WARN dead_letter");
    expect(msg.To.map((t) => t.Address)).toEqual([LOCAL_OPS_ALERT_EMAIL]);
    expect(msg.From.Address).toBe(ALERT_FROM);
    expect(msg.Tags).toContain("ops-alert");
    expect(msg.Text).toContain(`Alert id: ${alert!.id}`);
    expect(msg.Text).toContain(jobId);
    expect(msg.Text).toContain("Runbook: docs/runbooks/jobs.md#dead_letter");

    const recorded = alertFor("dead_letter");
    expect(recorded).toMatchObject({ id: alert!.id, notifyCount: 1, notified: true, providerMessageId: mail[0].ID });

    // A persistent condition inside the cooldown: refreshed, never re-sent.
    psql("select ops.evaluate_alerts()");
    expect(alertFor("dead_letter")).toMatchObject({ id: alert!.id, count: 2, notifyCount: 1 });
    expect(notifyJobsFor(alert!.id)).toHaveLength(1);
    const again = await runKinds(["alert.notify"], handlers, `${WORKER}:notify2`);
    expect(again.ok).toBe(true);
    expect(notifyJobsFor(alert!.id)).toHaveLength(1);
    expect(await mailForAlert(alert!.id)).toHaveLength(1);
  });
});
