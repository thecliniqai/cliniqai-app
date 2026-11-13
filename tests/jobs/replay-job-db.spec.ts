/**
 * V2-04 04-03c (R-35): dead-letter replay `ops.replay_job(id)` (migration 000037), postgres only (SQL editor; runbook
 * docs/runbooks/jobs.md §11). On the live local stack.
 *
 * - A dead `message.send` job (its row dead-lettered by the dead-job trigger) → job pending, attempts 0, due now; the
 *   row pending with retry_count 0 and no error; a runner pass then sends it exactly once.
 * - A dead `webhook.deliver` job (its row failed `job_dead:<code>`) → job pending and the row pending again.
 * - Not replayable (`JOB_NOT_REPLAYABLE`): a job that is not dead, an unknown id, and a `message.reply_unmatched` job
 *   (its phone is already erased).
 * - No API role may run it: `service_role` (and so `authenticated`/`anon`) get permission denied.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { enqueueMessageAsSystem } from "@/lib/jobs/enqueue";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { psql } from "../helpers/sql";
import { letters } from "./helpers";
import { jobsFor, onlyFor, queueState, recordingProvider, runMessages, seedPatient, type SeededPatient } from "./message-helpers";
import { deliveryRow, insertDelivery, subscribe, webhookJobsFor } from "./webhook-helpers";

let owner: SeededTenant;
let patient: SeededPatient;

beforeAll(async () => {
  owner = await seedTenantWithOwner(`Replay Spec ${letters(6)}`);
  patient = await seedPatient(owner.tenantId, owner.userId);
});

const UUID = /^[0-9a-f-]{36}$/;
function kill(jobId: string, code = "lease_expired"): void {
  if (!UUID.test(jobId)) throw new Error("not a uuid");
  psql(`update ops.jobs set status = 'dead', finished_at = now(), last_error = '${code}', updated_at = now() where id = '${jobId}'`);
}
function replay(jobId: string): string[] {
  return psql(`select ops.replay_job('${jobId}')`);
}
function job(jobId: string): { status: string; attempts: number; dueInSeconds: number } {
  const [line] = psql(`select status || '|' || attempts || '|' || round(extract(epoch from run_at - now()))::int from ops.jobs where id = '${jobId}'`);
  const [status, attempts, due] = line.split("|");
  return { status, attempts: Number(attempts), dueInSeconds: Number(due) };
}

describe("ops.replay_job (R-35)", () => {
  it("a dead message.send job and its dead-lettered row go back to pending; the runner then sends once", async () => {
    const queued = await enqueueMessageAsSystem(
      getAdminClient(),
      { patientId: patient.patientId, channel: "whatsapp", messageType: "prescription_ready", templateId: "prescription_ready", dedupeKey: `replay:${randomUUID()}` },
      "system:jobs"
    );
    const [msgJob] = jobsFor(queued.id);
    kill(msgJob.id);
    expect(queueState(queued.id)).toMatchObject({ status: "dead_letter", error: "job_dead:lease_expired" });

    replay(msgJob.id);
    expect(job(msgJob.id)).toMatchObject({ status: "pending", attempts: 0 });
    expect(job(msgJob.id).dueInSeconds).toBeLessThanOrEqual(0);
    expect(queueState(queued.id)).toMatchObject({ status: "pending", retryCount: 0, error: null });

    const provider = recordingProvider();
    await runMessages(onlyFor(patient.phone, provider), "replay-spec-1");
    expect(provider.calls.filter((c) => c.templateId === "prescription_ready")).toHaveLength(1);
    expect(queueState(queued.id).status).toBe("sent");
    expect(jobsFor(queued.id)).toEqual([expect.objectContaining({ id: msgJob.id, status: "done", attempts: 1 })]);
  });

  it("a dead webhook.deliver job and its failed row go back to pending", async () => {
    const sub = await subscribe(owner.tenantId, owner.userId, ["appointment.booked"]);
    const deliveryId = await insertDelivery(owner.tenantId, sub.id);
    const [whJob] = webhookJobsFor(deliveryId);
    kill(whJob.id, "http_500");
    expect(deliveryRow(deliveryId)).toMatchObject({ status: "failed", lastError: "job_dead:http_500" });

    replay(whJob.id);
    expect(job(whJob.id)).toMatchObject({ status: "pending", attempts: 0 });
    expect(deliveryRow(deliveryId)).toMatchObject({ status: "pending", retryCount: 0, lastError: null });
    expect(deliveryRow(deliveryId).dueInSeconds).toBeLessThanOrEqual(0);
  });

  it("refuses a job that is not dead, an unknown id and an unmatched reply (JOB_NOT_REPLAYABLE)", async () => {
    const queued = await enqueueMessageAsSystem(
      getAdminClient(),
      { patientId: patient.patientId, channel: "whatsapp", messageType: "lab_report_uploaded", templateId: "lab_report_uploaded", dedupeKey: `replay:${randomUUID()}` },
      "system:jobs"
    );
    const [pending] = jobsFor(queued.id);
    expect(() => replay(pending.id)).toThrow(/JOB_NOT_REPLAYABLE/);
    expect(() => replay(randomUUID())).toThrow(/JOB_NOT_REPLAYABLE/);

    const replyKey = `bot:replay-${randomUUID()}:bot_not_found`;
    const { data: replyJobId, error } = await getAdminClient().rpc("enqueue_unmatched_reply_system", {
      p_system_actor: "system:messaging_webhook",
      p_to: "+919000000042",
      p_template_id: "bot_not_found",
      p_dedupe_key: replyKey,
    });
    expect(error).toBeNull();
    kill(String(replyJobId), "provider_disabled");
    // The redaction trigger erased the phone the moment the job left pending.
    expect(psql(`select payload::text from ops.jobs where id = '${String(replyJobId)}'`)).toEqual(['{"redacted": true}']);
    expect(() => replay(String(replyJobId))).toThrow(/JOB_NOT_REPLAYABLE/);
    psql(`delete from ops.jobs where id = '${String(replyJobId)}'`);
  });

  it("no API role may run it (postgres only)", () => {
    for (const role of ["service_role", "authenticated", "anon"]) {
      expect(psql(`select has_function_privilege('${role}', 'ops.replay_job(uuid)', 'execute')`)).toEqual(["f"]);
    }
  });
});
