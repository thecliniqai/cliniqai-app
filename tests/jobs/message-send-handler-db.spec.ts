/**
 * V2-04 04-03a (P0-12, R-7, R-20, R-23; T-04-07, T-04-10): the `message.send` handler over the live local queue
 * (migration 000035) with a recording provider (no network, no file) or the real MSG91 class behind MSW.
 *
 * - Tracer: `public.enqueue_message` as a signed-in owner → one `communication_queue` row → its trigger's
 *   `message.send` job → `runJobs` with the real handler → row `sent`, one provider call, one audit row without the
 *   phone, job `done`.
 * - Retryable failure → row `failed`, job `pending` at the row's own `next_retry_at` (R-23).
 * - An eligible WhatsApp `appointment_booked` failing twice → exactly one SMS fallback row; the last failure →
 *   `dead_letter`, job `dead`, exactly one "Message Delivery Failed" notification (no phone in it).
 * - A row already `sent` → job `done`, provider not called.
 * - `provider_disabled` → `dead_letter` after one attempt, no fallback row (before: retried to dead_letter, 03-01).
 * - A synthetic recipient with the real `Msg91Provider` (MSW, no handler) → `dead_letter` after one attempt, zero
 *   HTTP requests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { DisabledMessagingProvider, Msg91Provider } from "@/lib/messaging";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { psql } from "../helpers/sql";
import { mswFetch } from "../setup/worker-guard";
import { letters } from "./helpers";
import {
  deleteRunnerRuns,
  jobsFor,
  makeDue,
  onlyFor,
  queueState,
  recordingProvider,
  runMessages,
  seedPatient,
  type SeededPatient,
} from "./message-helpers";

const WORKER = `spec-msgsend-${letters(8)}`;
let owner: SeededTenant;
let patient: SeededPatient;

beforeAll(async () => {
  owner = await seedTenantWithOwner(`Msg Send Spec ${letters(6)}`);
  patient = await seedPatient(owner.tenantId, owner.userId);
});

afterAll(() => {
  deleteRunnerRuns(WORKER);
});

async function enqueueAsOwner(extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await owner.client.rpc("enqueue_message", {
    p_tenant_id: owner.tenantId,
    p_patient_id: patient.patientId,
    p_visit_id: null as unknown as string,
    p_channel: "whatsapp",
    p_message_type: "prescription_ready",
    p_template_id: "prescription_ready",
    p_template_params: { patient_name: "Synthetic" },
    p_recipient_phone: null as unknown as string,
    p_recipient_user_id: null as unknown as string,
    p_metadata: {},
    ...extra,
  });
  if (error) throw new Error(`enqueue failed: ${error.code} ${error.message}`);
  return (data as { id: string }).id;
}

async function enqueueBooked(subject: SeededPatient = patient): Promise<string> {
  const { data, error } = await getAdminClient().rpc("enqueue_message_system", {
    p_system_actor: "system:jobs",
    p_patient_id: subject.patientId,
    p_visit_id: subject.visitId,
    p_channel: "whatsapp",
    p_message_type: "appointment_booked",
    p_template_id: "appointment_booked",
    p_template_params: { patient_name: "Synthetic" },
    p_recipient_phone: null as unknown as string,
    p_recipient_user_id: null as unknown as string,
    p_metadata: {},
    p_dedupe_key: `appointment_booked:${letters(10)}`,
  });
  if (error) throw new Error(`system enqueue failed: ${error.code}`);
  return (data as { id: string }).id;
}

function fallbackRows(queueId: string): string[] {
  return psql(
    `select id || '|' || channel || '|' || template_id || '|' || coalesce(dedupe_key, '') from public.communication_queue ` +
      `where metadata ->> 'fallback_of' = '${queueId}' or dedupe_key = 'msg-fallback:${queueId}'`
  );
}

function failureNotes(queueId: string): string[] {
  return psql(
    `select title || '|' || message from public.in_app_notifications ` +
      `where event_type = 'delivery_failure_alert' and metadata ->> 'queue_id' = '${queueId}'`
  );
}

describe("message.send handler", () => {
  it("tracer: enqueue_message → row → message.send job → runner → sent once, audit row without the phone", async () => {
    const queueId = await enqueueAsOwner();
    expect(queueState(queueId).status).toBe("pending");
    const [job] = jobsFor(queueId);
    expect(job).toMatchObject({ status: "pending", attempts: 0, maxAttempts: 5 });
    expect(psql(`select dedupe_key from ops.jobs where id = '${job.id}'`)).toEqual([`msg:${queueId}`]);

    const provider = recordingProvider();
    await runMessages(provider, `${WORKER}-tracer`);

    expect(provider.calls.filter((c) => c.templateId === "prescription_ready" && c.to === patient.phone)).toHaveLength(1);
    expect(queueState(queueId).status).toBe("sent");
    expect(jobsFor(queueId)).toEqual([expect.objectContaining({ status: "done", attempts: 1 })]);
    const audit = psql(
      `select metadata::text from public.audit_logs where action = 'communication_sent' and entity_id = '${queueId}'`
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toContain(queueId);
    expect(audit[0]).not.toContain(patient.phone.slice(3));
    // The runner's abort signal reaches the provider (R-20).
    expect(provider.calls.at(-1)?.signal).toBeInstanceOf(AbortSignal);
  });

  it("a retryable failure leaves the row failed and the job pending at the row's next_retry_at", async () => {
    const queueId = await enqueueAsOwner();
    const provider = recordingProvider((c) => ({ success: false, channelUsed: c.channel, code: "provider_down", error: "provider_down", retryable: true }));
    await runMessages(provider, `${WORKER}-retry`);

    const row = queueState(queueId);
    expect(row).toMatchObject({ status: "failed", retryCount: 1, error: "provider_down" });
    const [job] = jobsFor(queueId);
    expect(job).toMatchObject({ status: "pending", attempts: 1, lastError: "provider_down" });
    // The job follows the delivery row's own backoff (1 minute after the first failure), not the queue's.
    expect(Math.abs(job.runInSeconds - row.dueInSeconds)).toBeLessThanOrEqual(1);
    expect(row.dueInSeconds).toBeGreaterThan(50);
  });

  it("an eligible WhatsApp booking failing twice queues exactly one SMS fallback; the last failure dead-letters once", async () => {
    const queueId = await enqueueBooked();
    const provider = recordingProvider((c) =>
      c.channel === "whatsapp"
        ? { success: false, channelUsed: "whatsapp", code: "provider_down", error: "provider_down", retryable: true }
        : { success: true, channelUsed: "sms", externalMessageId: `rec-${letters(6)}` }
    );

    await runMessages(provider, `${WORKER}-fb1`);
    expect(queueState(queueId)).toMatchObject({ status: "failed", retryCount: 1 });
    makeDue(queueId);
    await runMessages(provider, `${WORKER}-fb2`);
    expect(queueState(queueId)).toMatchObject({ status: "failed", retryCount: 2 });

    const fallbacks = fallbackRows(queueId);
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]).toContain("|sms|appointment_booked_sms_fallback|msg-fallback:");

    makeDue(queueId);
    await runMessages(provider, `${WORKER}-fb3`);
    expect(queueState(queueId).status).toBe("dead_letter");
    expect(jobsFor(queueId)).toEqual([expect.objectContaining({ status: "dead", attempts: 3 })]);
    expect(fallbackRows(queueId)).toHaveLength(1);
    const notes = failureNotes(queueId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Message Delivery Failed|A whatsapp message (appointment_booked) failed permanently");
    expect(notes[0]).not.toContain(patient.phone.slice(3));
    expect(provider.calls.filter((c) => c.channel === "whatsapp" && c.to === patient.phone).length).toBeGreaterThanOrEqual(3);
  });

  it("a row that is already sent finishes its job without calling the provider", async () => {
    const queueId = await enqueueAsOwner({ p_template_id: "lab_report_uploaded", p_message_type: "lab_report_uploaded" });
    psql(`update public.communication_queue set status = 'sent', sent_at = now() where id = '${queueId}'`);
    const provider = recordingProvider();
    await runMessages(provider, `${WORKER}-sent`);

    expect(provider.calls.filter((c) => c.templateId === "lab_report_uploaded" && c.to === patient.phone)).toHaveLength(0);
    expect(jobsFor(queueId)).toEqual([expect.objectContaining({ status: "done", attempts: 1 })]);
  });

  it("the disabled provider dead-letters after one attempt and queues no fallback (03-01 handover)", async () => {
    const own = await seedPatient(owner.tenantId, owner.userId);
    const queueId = await enqueueBooked(own);
    await runMessages(onlyFor(own.phone, new DisabledMessagingProvider()), `${WORKER}-disabled`);

    expect(queueState(queueId)).toMatchObject({ status: "dead_letter", retryCount: 0, error: "provider_disabled" });
    expect(jobsFor(queueId)).toEqual([expect.objectContaining({ status: "dead", attempts: 1, lastError: "provider_disabled" })]);
    expect(fallbackRows(queueId)).toHaveLength(0);
    expect(failureNotes(queueId)).toHaveLength(1);
  });

  it("a synthetic recipient with the real MSG91 provider dead-letters after one attempt with zero HTTP requests", async () => {
    // MSW sees any request to MSG91 (counted); a socket to that host would dial 127.0.0.1, never MSG91.
    const net = mswFetch(["control.msg91.com"]);
    const server = setupServer();
    let requests = 0;
    server.events.on("request:start", () => {
      requests += 1;
    });
    server.listen({ onUnhandledFrame: "error" });
    try {
      const own = await seedPatient(owner.tenantId, owner.userId);
      const queueId = await enqueueBooked(own);
      await runMessages(onlyFor(own.phone, new Msg91Provider({ authKey: "x", senderId: "synthetic-sender" })), `${WORKER}-synthetic`);

      expect(queueState(queueId)).toMatchObject({ status: "dead_letter", error: "synthetic_recipient" });
      expect(jobsFor(queueId)).toEqual([expect.objectContaining({ status: "dead", attempts: 1, lastError: "synthetic_recipient" })]);
      expect(fallbackRows(queueId)).toHaveLength(0);
      expect(requests).toBe(0);
    } finally {
      server.close();
      net.restore();
    }
  });
});
