/**
 * V2-04 04-03a (roadmap "reaper test" at the delivery level, "a stuck `processing` row is reclaimed"; R-7, R-23):
 * `ops.reap_delivery_rows()` and the dead-job trigger of migration 000035, on the live local stack.
 *
 * - Crash after the claim: the delivery row was claimed (`processing`, `updated_at` aged 5 min) and the runner died
 *   holding the job (lease moved into the past by SQL). The reaper moves the row to `failed` / `outcome_unknown`; the
 *   next runner pass re-claims the job and sends once; the row ends `sent`.
 * - A row in `processing` for less than 240 s is left alone (a live sender is never reaped).
 * - A row stuck in `processing` from before 000035 (no job) gets its job from the reaper and is sent.
 * - A job dead-lettered by `ops.reap_jobs()` (lease expired with no attempts left) dead-letters its open delivery row
 *   and adds exactly one "Message Delivery Failed" notification.
 * Time moves by SQL, never by sleeping.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { psql } from "../helpers/sql";
import { letters } from "./helpers";
import { jobsFor, queueState, recordingProvider, runMessages, seedPatient, type SeededPatient } from "./message-helpers";

const WORKER = `spec-dreap-${letters(8)}`;
let owner: SeededTenant;
let patient: SeededPatient;

beforeAll(async () => {
  owner = await seedTenantWithOwner(`Delivery Reap Spec ${letters(6)}`);
  patient = await seedPatient(owner.tenantId, owner.userId);
});

async function enqueue(template = "prescription_ready"): Promise<string> {
  const { data, error } = await getAdminClient().rpc("enqueue_message_system", {
    p_system_actor: "system:jobs",
    p_patient_id: patient.patientId,
    p_visit_id: null as unknown as string,
    p_channel: "whatsapp",
    p_message_type: template,
    p_template_id: template,
    p_template_params: { marker: letters(8) },
    p_recipient_phone: null as unknown as string,
    p_recipient_user_id: null as unknown as string,
    p_metadata: {},
  });
  if (error) throw new Error(`enqueue failed: ${error.code}`);
  return (data as { id: string }).id;
}

/** The runner "crashed": job running with an expired lease, delivery row claimed and untouched for `ageSeconds`. */
function simulateCrash(queueId: string, ageSeconds: number, attempts = 1): void {
  psql(
    `update ops.jobs set status = 'running', attempts = ${attempts}, lease_token = gen_random_uuid(), ` +
      `locked_until = now() - interval '1 second', locked_by = '${WORKER}-dead', first_claimed_at = now() - interval '5 minutes' ` +
      `where kind = 'message.send' and payload ->> 'queue_id' = '${queueId}'; ` +
      `update public.communication_queue set status = 'processing', updated_at = now() - make_interval(secs => ${ageSeconds}) ` +
      `where id = '${queueId}'`
  );
}

function marker(queueId: string): string {
  return psql(`select template_params ->> 'marker' from public.communication_queue where id = '${queueId}'`)[0];
}

describe("delivery-row reaper", () => {
  it("a row stuck in processing after a crash is reclaimed and then sent exactly once", async () => {
    const queueId = await enqueue();
    const mark = marker(queueId);
    simulateCrash(queueId, 300);

    const reaped = Number(psql("select ops.reap_delivery_rows()")[0]);
    expect(reaped).toBeGreaterThanOrEqual(1);
    expect(queueState(queueId)).toMatchObject({ status: "failed", error: "outcome_unknown", retryCount: 0 });
    expect(queueState(queueId).dueInSeconds).toBeLessThanOrEqual(0);

    const provider = recordingProvider();
    await runMessages(provider, `${WORKER}-after`);
    expect(provider.calls.filter((c) => c.params.marker === mark)).toHaveLength(1);
    expect(queueState(queueId).status).toBe("sent");
    expect(jobsFor(queueId)).toEqual([expect.objectContaining({ status: "done", attempts: 2 })]);

    // Nothing left to reap or send for this row.
    await runMessages(provider, `${WORKER}-again`);
    expect(provider.calls.filter((c) => c.params.marker === mark)).toHaveLength(1);
  });

  it("a row in processing for less than 240 s is not reaped", async () => {
    const queueId = await enqueue();
    simulateCrash(queueId, 60);
    psql("select ops.reap_delivery_rows()");
    expect(queueState(queueId).status).toBe("processing");
    // While it is held, a runner that re-claims the job does not send; it retries later (delivery_in_progress).
    const provider = recordingProvider();
    await runMessages(provider, `${WORKER}-held`);
    expect(provider.calls.filter((c) => c.params.marker === marker(queueId))).toHaveLength(0);
    expect(jobsFor(queueId)).toEqual([expect.objectContaining({ status: "pending", lastError: "delivery_in_progress" })]);
    expect(jobsFor(queueId)[0].runInSeconds).toBeGreaterThan(50);
  });

  it("a stuck row from before 000035 (no job) gets its job from the reaper and is sent", async () => {
    const [queueId] = psql(
      "insert into public.communication_queue (tenant_id, patient_id, channel, message_type, template_id, template_params, " +
        `recipient_phone, status, updated_at) values ('${owner.tenantId}', '${patient.patientId}', 'whatsapp', 'prescription_ready', ` +
        `'prescription_ready', jsonb_build_object('marker', '${letters(8)}'), '${patient.phone}', 'processing', ` +
        "now() - interval '10 minutes') returning id"
    );
    expect(jobsFor(queueId)).toHaveLength(0);
    psql("select ops.reap_delivery_rows()");
    expect(jobsFor(queueId)).toEqual([expect.objectContaining({ status: "pending", attempts: 0 })]);

    const provider = recordingProvider();
    await runMessages(provider, `${WORKER}-legacy`);
    expect(provider.calls.filter((c) => c.params.marker === marker(queueId))).toHaveLength(1);
    expect(queueState(queueId).status).toBe("sent");
  });

  it("a job dead-lettered by the job reaper dead-letters its open row and notifies the clinic once", async () => {
    const queueId = await enqueue();
    const [{ maxAttempts }] = jobsFor(queueId);
    simulateCrash(queueId, 10, maxAttempts);
    psql("select ops.reap_jobs()");

    expect(jobsFor(queueId)).toEqual([expect.objectContaining({ status: "dead", lastError: "lease_expired" })]);
    expect(queueState(queueId)).toMatchObject({ status: "dead_letter", error: "job_dead:lease_expired" });
    const notes = psql(
      "select count(*) from public.in_app_notifications where event_type = 'delivery_failure_alert' " +
        `and metadata ->> 'queue_id' = '${queueId}'`
    );
    expect(notes).toEqual(["1"]);
    // A second dead transition (a replay later dying again) adds no second notification.
    psql(
      `update ops.jobs set status = 'pending' where kind = 'message.send' and payload ->> 'queue_id' = '${queueId}'; ` +
        `update ops.jobs set status = 'dead' where kind = 'message.send' and payload ->> 'queue_id' = '${queueId}'`
    );
    expect(
      psql(
        "select count(*) from public.in_app_notifications where event_type = 'delivery_failure_alert' " +
          `and metadata ->> 'queue_id' = '${queueId}'`
      )
    ).toEqual(["1"]);
  });
});
