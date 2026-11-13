/**
 * Shared helpers for the 04-03a message specs (V2-04; P0-12). Synthetic data only: every patient number is in the
 * synthetic range (`+91 90000 000xx`, `lib/messaging/synthetic-numbers.ts`), so even a real provider class would refuse
 * it; the recording provider below never touches the network or a file.
 *
 * `message.send` is one kind shared by every spec, so a runner pass may also claim a job another spec left pending.
 * Specs therefore assert on their own queue ids (`callsFor`), never on a global count.
 */
import { randomInt } from "node:crypto";
import { runJobs, type RunJobsOptions } from "@/lib/jobs/internal/runner";
import { createMessageSendHandler, MESSAGE_SEND_KIND } from "@/lib/jobs/internal/handlers/message-send";
import type { MessagingProvider, MessagingSendResult } from "@/lib/messaging/types";
import type { RunJobsResult } from "@/lib/jobs/internal/types";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
import { letters } from "./helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error("message-helpers: not a uuid");
  return value;
}

/** A number in the synthetic range (+91 90000 000xx): never a real subscriber, refused by every real provider. */
export function syntheticMobile(): string {
  return `+9190000000${String(randomInt(0, 100)).padStart(2, "0")}`;
}

export interface SeededPatient {
  tenantId: string;
  patientId: string;
  visitId: string;
  phone: string;
}

/** A patient (synthetic number) and one visit in `tenantId`, inserted with the admin client. */
export async function seedPatient(tenantId: string, createdBy: string, doctorId: string = createdBy): Promise<SeededPatient> {
  const admin = getAdminClient();
  const phone = syntheticMobile();
  const { data: patient, error: pErr } = await admin
    .from("patients")
    .insert({ tenant_id: tenantId, full_name: `Synthetic Patient ${letters(6)}`, phone, sex: "other", created_by: createdBy })
    .select("id")
    .single();
  if (pErr || !patient) throw new Error(`seed patient failed: ${pErr?.code}`);
  const { data: visit, error: vErr } = await admin
    .from("visits")
    .insert({
      tenant_id: tenantId,
      patient_id: patient.id,
      doctor_id: doctorId,
      origin_type: "walk_in",
      status: "in_consultation",
      estimated_duration_minutes: 15,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (vErr || !visit) throw new Error(`seed visit failed: ${vErr?.code}`);
  return { tenantId, patientId: patient.id, visitId: visit.id, phone };
}

export interface ProviderCall {
  channel: "sms" | "whatsapp";
  to: string;
  templateId: string;
  params: Record<string, string>;
  /** The runner's abort signal as the handler passed it. */
  signal: AbortSignal | undefined;
}

/**
 * A provider that records every call and answers with `answer(call, n)` (default: success). Calls are matched to queue
 * rows by template id + recipient, so specs give each row its own template/recipient pair where it matters.
 */
export function recordingProvider(
  answer: (call: ProviderCall, n: number) => MessagingSendResult | Promise<MessagingSendResult> = (c) => ({
    success: true,
    channelUsed: c.channel,
    externalMessageId: `rec-${letters(8)}`,
  })
): MessagingProvider & { calls: ProviderCall[] } {
  const calls: ProviderCall[] = [];
  const record = async (call: ProviderCall) => {
    calls.push(call);
    // Yield so parallel runners interleave their RPCs.
    await new Promise((r) => setImmediate(r));
    return answer(call, calls.length);
  };
  return {
    name: "dev",
    calls,
    sendSms: (to, templateId, params, options) => record({ channel: "sms", to, templateId, params, signal: options?.signal }),
    sendWhatsApp: (to, templateId, params, _buttons, options) =>
      record({ channel: "whatsapp", to, templateId, params, signal: options?.signal }),
  };
}

/**
 * Sends to `phone` through `provider` and every other recipient through a silent recording provider, so a runner pass
 * that also claims another spec's leftover job never hands it to the provider under test.
 */
export function onlyFor(phone: string, provider: MessagingProvider): MessagingProvider {
  const others = recordingProvider();
  return {
    name: provider.name,
    sendSms: (to, templateId, params, options) =>
      (to === phone ? provider : others).sendSms(to, templateId, params, options),
    sendWhatsApp: (to, templateId, params, buttons, options) =>
      (to === phone ? provider : others).sendWhatsApp(to, templateId, params, buttons, options),
  };
}

/** One runner pass over `message.send` with the real handler and the given provider. */
export function runMessages(
  provider: MessagingProvider,
  worker: string,
  overrides: Partial<RunJobsOptions> = {}
): Promise<RunJobsResult> {
  return runJobs({
    db: getAdminClient(),
    budgetMs: 20_000,
    batch: 25,
    leaseSeconds: 120,
    perTenant: 100,
    worker,
    source: "test",
    kinds: [MESSAGE_SEND_KIND],
    handlers: { [MESSAGE_SEND_KIND]: createMessageSendHandler({ provider: () => provider }) as never },
    ...overrides,
  });
}

export interface QueueState {
  status: string;
  retryCount: number;
  error: string | null;
  dueInSeconds: number;
}

export function queueState(queueId: string): QueueState {
  const [line] = psql(
    `select status || '|' || retry_count || '|' || coalesce(error_message, '') || '|' || ` +
      `round(extract(epoch from next_retry_at - now()))::int from public.communication_queue where id = '${uuid(queueId)}'`
  );
  const [status, retryCount, error, due] = line.split("|");
  return { status, retryCount: Number(retryCount), error: error || null, dueInSeconds: Number(due) };
}

export interface MessageJob {
  id: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runInSeconds: number;
}

/** The `message.send` job(s) of a queue row (exactly one by the dedupe key `msg:<id>`). */
export function jobsFor(queueId: string): MessageJob[] {
  return psql(
    `select id || '|' || status || '|' || attempts || '|' || max_attempts || '|' || coalesce(last_error, '') || '|' || ` +
      `round(extract(epoch from run_at - now()))::int from ops.jobs ` +
      `where kind = 'message.send' and payload ->> 'queue_id' = '${uuid(queueId)}' order by created_at`
  ).map((line) => {
    const [id, status, attempts, maxAttempts, lastError, run] = line.split("|");
    return { id, status, attempts: Number(attempts), maxAttempts: Number(maxAttempts), lastError: lastError || null, runInSeconds: Number(run) };
  });
}

/** Makes a queue row and its job due now (time moves by SQL, never by sleeping). */
export function makeDue(queueId: string): void {
  const id = uuid(queueId);
  psql(
    `update public.communication_queue set next_retry_at = now() - interval '1 second' where id = '${id}'; ` +
      `update ops.jobs set run_at = now() - interval '1 second' where kind = 'message.send' and payload ->> 'queue_id' = '${id}' and status = 'pending'`
  );
}

export function deleteRunnerRuns(workerPrefix: string): void {
  if (!/^[a-z0-9-]+$/.test(workerPrefix)) throw new Error("message-helpers: bad worker prefix");
  psql(`delete from ops.job_runner_runs where worker like '${workerPrefix}%'`);
}
