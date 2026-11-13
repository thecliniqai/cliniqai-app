/**
 * V2-04 04-03c (migration 000038; R-38, R-7): `ops.backfill_delivery_jobs()` gives every open delivery row its job, once.
 * On the live local stack (postgres only, called through psql). The function is global, so each case asserts on its
 * own rows; jobs are removed with SQL to recreate the "row without a job" state a pre-V2-04 database had.
 *
 * - An open `communication_queue` row without a job → one `message.send` job (`msg:<id>`); a second call → still one.
 * - A row stuck in `processing` for more than 240 s → `failed` / `outcome_unknown` first, then its job.
 * - `webhook_delivery_queue`: a pending row and a reaper-failed (`outcome_unknown`) row get a job; a terminal failed
 *   row (another error) does not.
 * - The return value counts the jobs it created (≥ this spec's rows; 0 of them on the second call).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { enqueueMessageAsSystem } from "@/lib/jobs/enqueue";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { psql } from "../helpers/sql";
import { letters } from "./helpers";
import { jobsFor, queueState, seedPatient, type SeededPatient } from "./message-helpers";
import { deliveryRow, insertDelivery, subscribe, webhookJobsFor } from "./webhook-helpers";

let owner: SeededTenant;
let patient: SeededPatient;
let subscriptionId: string;

beforeAll(async () => {
  owner = await seedTenantWithOwner(`Backfill Spec ${letters(6)}`);
  patient = await seedPatient(owner.tenantId, owner.userId);
  subscriptionId = (await subscribe(owner.tenantId, owner.userId, ["appointment.booked"])).id;
});

const UUID = /^[0-9a-f-]{36}$/;
function id(value: string): string {
  if (!UUID.test(value)) throw new Error("not a uuid");
  return value;
}
function backfill(): number {
  return Number(psql("select ops.backfill_delivery_jobs()")[0]);
}
async function messageWithoutJob(): Promise<string> {
  const queued = await enqueueMessageAsSystem(
    getAdminClient(),
    { patientId: patient.patientId, channel: "whatsapp", messageType: "prescription_ready", templateId: "prescription_ready", dedupeKey: `backfill:${letters(10)}` },
    "system:jobs"
  );
  psql(`delete from ops.jobs where dedupe_key = 'msg:${id(queued.id)}'`);
  expect(jobsFor(queued.id)).toEqual([]);
  return queued.id;
}
async function deliveryWithoutJob(state: { status: string; lastError?: string }): Promise<string> {
  const deliveryId = await insertDelivery(owner.tenantId, subscriptionId);
  psql(`delete from ops.jobs where dedupe_key = 'wh:${id(deliveryId)}'`);
  const lastError = state.lastError ? `'${state.lastError.replace(/[^a-z_:0-9]/g, "")}'` : "null";
  psql(`update public.webhook_delivery_queue set status = '${state.status.replace(/[^a-z_]/g, "")}', last_error = ${lastError} where id = '${id(deliveryId)}'`);
  return deliveryId;
}

describe("ops.backfill_delivery_jobs (R-38)", () => {
  it("an open message row without a job gets exactly one; a second call creates none for it", async () => {
    const queueId = await messageWithoutJob();
    expect(backfill()).toBeGreaterThanOrEqual(1);
    expect(jobsFor(queueId)).toEqual([expect.objectContaining({ status: "pending", attempts: 0 })]);
    backfill();
    expect(jobsFor(queueId)).toHaveLength(1);
  });

  it("a row stuck in processing for more than 240 s becomes failed/outcome_unknown first, then gets its job", async () => {
    const queueId = await messageWithoutJob();
    psql(`update public.communication_queue set status = 'processing', updated_at = now() - interval '300 seconds' where id = '${id(queueId)}'`);
    backfill();
    expect(queueState(queueId)).toMatchObject({ status: "failed", error: "outcome_unknown" });
    expect(jobsFor(queueId)).toHaveLength(1);

    // A row in processing for less than 240 s (a live sender) is left alone and gets no job.
    const fresh = await messageWithoutJob();
    psql(`update public.communication_queue set status = 'processing', updated_at = now() where id = '${id(fresh)}'`);
    backfill();
    expect(queueState(fresh).status).toBe("processing");
    expect(jobsFor(fresh)).toEqual([]);
  });

  it("webhook rows: pending and reaper-failed rows get a job; a terminal failed row does not", async () => {
    const pending = await deliveryWithoutJob({ status: "pending" });
    const reaped = await deliveryWithoutJob({ status: "failed", lastError: "outcome_unknown" });
    const terminal = await deliveryWithoutJob({ status: "failed", lastError: "http_500" });
    const stuck = await deliveryWithoutJob({ status: "processing" });
    psql(`update public.webhook_delivery_queue set updated_at = now() - interval '300 seconds' where id = '${id(stuck)}'`);

    const created = backfill();
    expect(created).toBeGreaterThanOrEqual(3);
    expect(webhookJobsFor(pending)).toHaveLength(1);
    expect(webhookJobsFor(reaped)).toHaveLength(1);
    expect(webhookJobsFor(terminal)).toEqual([]);
    expect(deliveryRow(stuck)).toMatchObject({ status: "failed", lastError: "outcome_unknown" });
    expect(webhookJobsFor(stuck)).toHaveLength(1);

    backfill();
    for (const d of [pending, reaped, stuck]) expect(webhookJobsFor(d)).toHaveLength(1);
  });

  it("is postgres only", () => {
    for (const role of ["service_role", "authenticated", "anon"]) {
      expect(psql(`select has_function_privilege('${role}', 'ops.backfill_delivery_jobs()', 'execute')`)).toEqual(["f"]);
    }
  });
});
