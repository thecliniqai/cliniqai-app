/**
 * V2-04 04-03b (P0-12; R-6 revised, R-19, R-26, R-44; T-04-04, T-04-06, T-04-25): the webhook enqueue RPCs of
 * migration 000036 and the `webhook_delivery_queue` contract, on the live local stack.
 *
 * - R-19 (research latent defect): a **receptionist** and a **doctor** raise `prescription.issued` → one delivery row and
 *   one `webhook.deliver` job each. Before 04-03b the app-side enqueue read subscriptions through the caller's RLS
 *   (owner/admin only) and silently queued nothing for 3 of 5 roles; that RLS still hides the subscriptions from them
 *   (asserted), the RPC reads them as definer.
 * - R-26: the data is built in SQL from the subject row with exactly the fields the call site sent; no caller payload.
 * - R-6: another clinic's subject → `P0002 SUBJECT_MISMATCH`, 0 rows; a member of A and B acting in A for B's subject
 *   → `P0002`, acting in B → one B row.
 * - Idempotency: the same event twice (and five times in parallel) → one row per subscription (event key).
 * - Ping: owner/admin only (receptionist → 42501), one row for that subscription only, a sixth inside 60 s →
 *   `RATE_LIMITED`.
 * - System RPC: service role only, closed actor set, tenant from the subject; no ping.
 * - Contract: members cannot insert/update/delete delivery rows or call claim/finish (42501); owner/admin keep SELECT;
 *   the writers are not executable by API roles.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueWebhookEvent, enqueueWebhookEventAsSystem, EnqueueError } from "@/lib/jobs/enqueue";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import {
  addMemberToTenant,
  createDualMembershipUser,
  seedTenantWithOwner,
  type DualMemberUser,
  type SeededTenant,
} from "../helpers/tenants";
import { plantLegacyRow, psql } from "../helpers/sql";
import { consultationDraftInput } from "../helpers/fixtures";
import { getOrCreateDraftPrescription } from "@/features/prescriptions/service";
import { completeAndSignConsultation, saveConsultationDraft } from "@/features/consultation/service";
import { anonClient, letters } from "./helpers";
import { seedPatient, type SeededPatient } from "./message-helpers";
import { deliveriesFor, deliveryPayload, subscribe, webhookJobsFor, type Subscription } from "./webhook-helpers";
import { signInActingIn } from "../helpers/active-tenant";

let ownerA: SeededTenant;
let adminA: SeededTenant;
let doctorA: SeededTenant;
let receptionistA: SeededTenant;
let ownerB: SeededTenant;
let dual: DualMemberUser;
let patientA: SeededPatient;
let subRx: Subscription;
let subInactive: Subscription;
let subVisits: Subscription;
let subB: Subscription;

/**
 * A prescription row on a fresh visit of `owner`'s clinic (as `getOrCreateDraftPrescription` writes it), signed as
 * `completeAndSignConsultation` leaves it unless `signed: false` (04-07a M-RXEVENT: a request raises
 * `prescription.issued` only for a signed prescription; its event key is `prescription.issued:<id>:signed`).
 */
const rxSubjects = new Map<string, SeededPatient>();
async function prescriptionFor(owner: SeededTenant, doctorId: string, opts: { signed?: boolean } = {}): Promise<string> {
  const p = await seedPatient(owner.tenantId, owner.userId, doctorId);
  const { data, error } = await getAdminClient()
    .from("prescriptions")
    .insert({
      tenant_id: p.tenantId,
      visit_id: p.visitId,
      patient_id: p.patientId,
      doctor_id: doctorId,
      version: 1,
      status: "active",
      letterhead_mode: "blank_paper",
      ...(opts.signed === false ? {} : { signed_at: new Date().toISOString() }),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed prescription failed: ${error?.code}`);
  rxSubjects.set(data.id, p);
  return data.id;
}

type Db = { rpc: (fn: never, args: never) => unknown };
type RpcResult = Promise<{ data: { queued: number; delivery_ids: string[] } | null; error: { code: string; message: string } | null }>;

function enqueue(db: Db, tenantId: string | null, eventType: string, subjectId: string, subscriptionId: string | null = null): RpcResult {
  return db.rpc("enqueue_webhook_event" as never, {
    p_tenant_id: tenantId,
    p_event_type: eventType,
    p_subject_id: subjectId,
    p_subscription_id: subscriptionId,
  } as never) as RpcResult;
}

function system(db: Db, actor: string, eventType: string, subjectId: string): RpcResult {
  return db.rpc("enqueue_webhook_event_system" as never, {
    p_system_actor: actor,
    p_event_type: eventType,
    p_subject_id: subjectId,
  } as never) as RpcResult;
}

beforeAll(async () => {
  ownerA = await seedTenantWithOwner(`Webhook Enqueue A ${letters(6)}`);
  ownerB = await seedTenantWithOwner(`Webhook Enqueue B ${letters(6)}`);
  [adminA, doctorA, receptionistA] = await Promise.all([
    addMemberToTenant(ownerA.tenantId, "admin"),
    addMemberToTenant(ownerA.tenantId, "doctor"),
    addMemberToTenant(ownerA.tenantId, "receptionist"),
  ]);
  dual = await createDualMembershipUser(ownerA.tenantId, "receptionist", ownerB.tenantId, "receptionist");
  patientA = await seedPatient(ownerA.tenantId, ownerA.userId);
  subRx = await subscribe(ownerA.tenantId, ownerA.userId, ["prescription.issued"]);
  subInactive = await subscribe(ownerA.tenantId, ownerA.userId, ["prescription.issued", "visit.completed"], { active: false });
  subVisits = await subscribe(ownerA.tenantId, ownerA.userId, ["visit.completed", "appointment.cancelled", "appointment.rescheduled", "lab_result.ready"]);
  subB = await subscribe(ownerB.tenantId, ownerB.userId, ["prescription.issued"]);
});

afterAll(() => {
  // Tenants (and with them rows and jobs) are removed by the global teardown.
});

describe("public.enqueue_webhook_event: every role's events are queued (R-19)", () => {
  it("the caller's RLS still hides subscriptions from a receptionist and a doctor (the cause of the old silent drop)", async () => {
    for (const member of [receptionistA, doctorA]) {
      const { data, error } = await member.client.from("webhook_subscriptions").select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });

  it.each([
    ["receptionist", () => receptionistA],
    ["doctor", () => doctorA],
  ])("a %s raises prescription.issued → one delivery row for the subscribed endpoint and one webhook.deliver job", async (_role, who) => {
    const member = who();
    const rx = await prescriptionFor(ownerA, doctorA.userId);
    const { data, error } = await enqueue(member.client, member.tenantId, "prescription.issued", rx);
    expect(error).toBeNull();
    expect(data).toEqual({ queued: 1, delivery_ids: [expect.any(String)] });

    const rows = deliveriesFor(subRx.id).filter((r) => r.eventKey === `prescription.issued:${rx}:signed`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: data!.delivery_ids[0], status: "pending", retryCount: 0 });
    expect(deliveriesFor(subInactive.id).filter((r) => r.eventKey === `prescription.issued:${rx}:signed`)).toEqual([]);
    expect(deliveriesFor(subVisits.id).filter((r) => r.eventKey === `prescription.issued:${rx}:signed`)).toEqual([]);

    const jobs = webhookJobsFor(rows[0].id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "pending", tenantId: ownerA.tenantId, dedupeKey: `wh:${rows[0].id}`, maxAttempts: 7 });

    // R-26: the envelope's data is built from the prescription row, exactly the fields the call site sent before.
    const envelope = JSON.parse(deliveryPayload(rows[0].id)) as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual(["created_at", "data", "event", "id"]);
    expect(envelope.event).toBe("prescription.issued");
    const subject = rxSubjects.get(rx)!;
    expect(envelope.data).toEqual({ prescription_id: rx, patient_id: subject.patientId, visit_id: subject.visitId });
  });

  it("lib/jobs/enqueue: enqueueWebhookEvent(ctx, …) queues for ctx.tenantId and returns the delivery ids", async () => {
    const rx = await prescriptionFor(ownerA, doctorA.userId);
    const result = await enqueueWebhookEvent(ctxFor(receptionistA), "prescription.issued", rx);
    expect(result).toEqual({ queued: 1, deliveryIds: [expect.any(String)] });
    expect(webhookJobsFor(result.deliveryIds[0])).toHaveLength(1);
  });
});

describe("tenant binding (R-6 revised; 03-07 D1 finding 2)", () => {
  it("a subject of another clinic → P0002 SUBJECT_MISMATCH, no row", async () => {
    const rxB = await prescriptionFor(ownerB, ownerB.userId);
    for (const tenant of [receptionistA.tenantId, ownerB.tenantId]) {
      const { error } = await enqueue(receptionistA.client, tenant, "prescription.issued", rxB);
      expect(error).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
    }
    const missing = await enqueue(receptionistA.client, receptionistA.tenantId, "prescription.issued", "00000000-0000-4000-8000-00000000dead");
    expect(missing.error).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
    expect(deliveriesFor(subB.id).filter((r) => r.eventKey === `prescription.issued:${rxB}:signed`)).toEqual([]);

    await expect(enqueueWebhookEvent(ctxFor(receptionistA), "prescription.issued", rxB)).rejects.toSatisfy(
      (e: unknown) => e instanceof EnqueueError && e.appError.code === "NOT_FOUND" && !e.message.includes(rxB)
    );
  });

  it("a member of A and B acting in A cannot raise an event about B's prescription; acting in B queues one B row", async () => {
    const rxB = await prescriptionFor(ownerB, ownerB.userId);
    // The app's client names the active clinic (x-clinicos-tenant, R-42); since 05-02c the RPC binds p_tenant_id to it.
    const inA = await signInActingIn(dual.userEmail, ownerA.tenantId);
    const inB = await signInActingIn(dual.userEmail, ownerB.tenantId);
    const refused = await enqueue(inA, ownerA.tenantId, "prescription.issued", rxB);
    expect(refused.error).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
    // 05-02c: acting in A, naming B as the tenant is refused too (before: any membership of B passed this check).
    const namedB = await enqueue(inA, ownerB.tenantId, "prescription.issued", rxB);
    expect(namedB.error).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
    expect(deliveriesFor(subB.id).filter((r) => r.eventKey === `prescription.issued:${rxB}:signed`)).toEqual([]);

    const allowed = await enqueue(inB, ownerB.tenantId, "prescription.issued", rxB);
    expect(allowed.error).toBeNull();
    expect(allowed.data?.queued).toBe(1);
    const rows = deliveriesFor(subB.id).filter((r) => r.eventKey === `prescription.issued:${rxB}:signed`);
    expect(rows).toHaveLength(1);
    expect(psql(`select tenant_id from public.webhook_delivery_queue where id = '${rows[0].id}'`)).toEqual([ownerB.tenantId]);
  });

  it("a non-member tenant, a null tenant and anon are refused", async () => {
    const rx = await prescriptionFor(ownerA, doctorA.userId);
    expect((await enqueue(receptionistA.client, ownerB.tenantId, "prescription.issued", rx)).error).toMatchObject({ code: "P0002" });
    expect((await enqueue(receptionistA.client, null, "prescription.issued", rx)).error).toMatchObject({ code: "P0002" });
    expect((await enqueue(anonClient(), ownerA.tenantId, "prescription.issued", rx)).error?.code).toBe("42501");
    expect(deliveriesFor(subRx.id).filter((r) => r.eventKey === `prescription.issued:${rx}:signed`)).toEqual([]);
  });
});

describe("closed event set, subject state and idempotency", () => {
  it("an event outside the closed set → EVENT_NOT_ALLOWED; a subscription id on a lifecycle event → INPUT_INVALID", async () => {
    const rx = await prescriptionFor(ownerA, doctorA.userId);
    for (const event of ["payment.recorded", "appointment.booked", "visit.created", "ping.x"]) {
      const { error } = await enqueue(ownerA.client, ownerA.tenantId, event, rx);
      expect(error, event).toMatchObject({ code: "P0001", message: "EVENT_NOT_ALLOWED" });
    }
    const targeted = await enqueue(ownerA.client, ownerA.tenantId, "prescription.issued", rx, subRx.id);
    expect(targeted.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
  });

  it("visit.completed and appointment.cancelled need the visit in that state; the data comes from the visit row", async () => {
    const p = await seedPatient(ownerA.tenantId, ownerA.userId, doctorA.userId);
    expect((await enqueue(doctorA.client, doctorA.tenantId, "visit.completed", p.visitId)).error).toMatchObject({
      code: "P0001",
      message: "EVENT_NOT_ALLOWED",
    });
    expect((await enqueue(doctorA.client, doctorA.tenantId, "appointment.cancelled", p.visitId)).error).toMatchObject({
      message: "EVENT_NOT_ALLOWED",
    });

    psql(`update public.visits set status = 'completed', signed_at = '2026-11-13T05:06:07.089Z' where id = '${p.visitId}'`);
    const done = await enqueue(doctorA.client, doctorA.tenantId, "visit.completed", p.visitId);
    expect(done.error).toBeNull();
    const [row] = deliveriesFor(subVisits.id).filter((r) => r.eventKey === `visit.completed:${p.visitId}`);
    expect(JSON.parse(deliveryPayload(row.id)).data).toEqual({
      visit_id: p.visitId,
      patient_id: p.patientId,
      doctor_id: doctorA.userId,
      completed_at: "2026-11-13T05:06:07.089Z",
    });

    psql(
      `update public.visits set status = 'cancelled', metadata = metadata || '{"cancellation_reason":"patient_cancelled"}', ` +
        `scheduled_at = '2026-11-20T05:00:00Z' where id = '${p.visitId}'`
    );
    const cancelled = await system(getAdminClient(), "system:messaging_webhook", "appointment.cancelled", p.visitId);
    expect(cancelled.error).toBeNull();
    const [cRow] = deliveriesFor(subVisits.id).filter((r) => r.eventKey === `appointment.cancelled:${p.visitId}`);
    expect(JSON.parse(deliveryPayload(cRow.id)).data).toEqual({ appointment_id: p.visitId, reason: "patient_cancelled" });

    // appointment.rescheduled: one event per visit AND time (the key carries scheduled_at, as PostgREST writes it).
    const moved = await enqueueWebhookEventAsSystem(getAdminClient(), "appointment.rescheduled", p.visitId, "system:patient_self_service_reschedule");
    expect(moved.queued).toBe(1);
    const key = `appointment.rescheduled:${p.visitId}:2026-11-20T05:00:00+00:00`;
    const [rRow] = deliveriesFor(subVisits.id).filter((r) => r.eventKey === key);
    expect(JSON.parse(deliveryPayload(rRow.id)).data).toEqual({ appointment_id: p.visitId, scheduled_at: "2026-11-20T05:00:00+00:00" });
    expect((await enqueueWebhookEventAsSystem(getAdminClient(), "appointment.rescheduled", p.visitId, "system:patient_self_service_reschedule")).queued).toBe(0);
    psql(`update public.visits set scheduled_at = '2026-11-21T05:00:00Z' where id = '${p.visitId}'`);
    expect((await enqueueWebhookEventAsSystem(getAdminClient(), "appointment.rescheduled", p.visitId, "system:patient_self_service_reschedule")).queued).toBe(1);
  });

  it("lab_result.ready carries the document id, patient id and title from the document row", async () => {
    const [doc] = psql(
      `insert into public.patient_documents (tenant_id, patient_id, title, storage_path, original_filename, mime_type, ` +
        `file_size_bytes, uploaded_by) values ('${ownerA.tenantId}', '${patientA.patientId}', 'Synthetic CBC', ` +
        `'tenants/${ownerA.tenantId}/patients/${patientA.patientId}/labs/synthetic.pdf', 'synthetic.pdf', 'application/pdf', 10, '${ownerA.userId}') returning id`
    );
    const { error } = await enqueue(receptionistA.client, receptionistA.tenantId, "lab_result.ready", doc);
    expect(error).toBeNull();
    const [row] = deliveriesFor(subVisits.id).filter((r) => r.eventKey === `lab_result.ready:${doc}`);
    expect(JSON.parse(deliveryPayload(row.id)).data).toEqual({ document_id: doc, patient_id: patientA.patientId, title: "Synthetic CBC" });
  });

  it("the same event twice queues once; five parallel calls queue one row and one job", async () => {
    const rx = await prescriptionFor(ownerA, doctorA.userId);
    expect((await enqueue(doctorA.client, doctorA.tenantId, "prescription.issued", rx)).data?.queued).toBe(1);
    expect((await enqueue(doctorA.client, doctorA.tenantId, "prescription.issued", rx)).data).toEqual({ queued: 0, delivery_ids: [] });

    const rx2 = await prescriptionFor(ownerA, doctorA.userId);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => enqueue(receptionistA.client, receptionistA.tenantId, "prescription.issued", rx2))
    );
    expect(results.map((r) => r.error)).toEqual([null, null, null, null, null]);
    expect(results.reduce((n, r) => n + (r.data?.queued ?? 0), 0)).toBe(1);
    const rows = deliveriesFor(subRx.id).filter((r) => r.eventKey === `prescription.issued:${rx2}:signed`);
    expect(rows).toHaveLength(1);
    expect(webhookJobsFor(rows[0].id)).toHaveLength(1);
  });
});

describe("test ping (R-26; 03-13d limit)", () => {
  let owner: SeededTenant;
  let admin: SeededTenant;
  let receptionist: SeededTenant;
  let target: Subscription;
  let other: Subscription;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Webhook Ping ${letters(6)}`);
    [admin, receptionist] = await Promise.all([
      addMemberToTenant(owner.tenantId, "admin"),
      addMemberToTenant(owner.tenantId, "receptionist"),
    ]);
    target = await subscribe(owner.tenantId, owner.userId, ["visit.completed"]);
    other = await subscribe(owner.tenantId, owner.userId, ["visit.completed", "ping"]);
  });

  it("a receptionist → 42501; another clinic's subscription → P0002; no rows", async () => {
    const byReceptionist = await enqueue(receptionist.client, owner.tenantId, "ping", target.id, target.id);
    expect(byReceptionist.error?.code).toBe("42501");
    const foreign = await enqueue(adminA.client, adminA.tenantId, "ping", target.id, target.id);
    expect(foreign.error).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
    expect(deliveriesFor(target.id)).toEqual([]);
  });

  it("an admin's ping queues one row for that subscription only; the sixth inside 60 s → RATE_LIMITED", async () => {
    const first = await enqueue(admin.client, owner.tenantId, "ping", target.id, target.id);
    expect(first.error).toBeNull();
    expect(first.data?.queued).toBe(1);
    const [row] = deliveriesFor(target.id);
    expect(row.eventKey).toMatch(/^ping:[0-9a-f-]{36}$/);
    expect(webhookJobsFor(row.id)).toHaveLength(1);
    const envelope = JSON.parse(deliveryPayload(row.id));
    expect(envelope).toMatchObject({ event: "ping", data: { type: "test_ping", message: "Webhook verification ping from ClinicQ Developer Settings" } });
    expect(deliveriesFor(other.id)).toEqual([]);

    for (let i = 0; i < 4; i++) expect((await enqueue(owner.client, owner.tenantId, "ping", target.id, target.id)).error).toBeNull();
    const sixth = await enqueue(owner.client, owner.tenantId, "ping", target.id, target.id);
    expect(sixth.error).toMatchObject({ code: "P0001", message: "RATE_LIMITED" });
    expect(deliveriesFor(target.id)).toHaveLength(5);
  });
});

describe("public.enqueue_webhook_event_system (service role)", () => {
  it("authenticated and anon → 42501", async () => {
    const rx = await prescriptionFor(ownerA, doctorA.userId);
    expect((await system(ownerA.client, "system:api_v1", "prescription.issued", rx)).error?.code).toBe("42501");
    expect((await system(anonClient(), "system:api_v1", "prescription.issued", rx)).error?.code).toBe("42501");
  });

  it("an actor outside the closed set → ACTOR_INVALID; ping → EVENT_NOT_ALLOWED; a missing subject → P0002", async () => {
    const rx = await prescriptionFor(ownerA, doctorA.userId);
    expect((await system(getAdminClient(), "system:anyone", "prescription.issued", rx)).error).toMatchObject({ message: "ACTOR_INVALID" });
    expect((await system(getAdminClient(), "system:api_v1", "ping", subRx.id)).error).toMatchObject({ message: "EVENT_NOT_ALLOWED" });
    expect((await system(getAdminClient(), "system:api_v1", "prescription.issued", "00000000-0000-4000-8000-00000000dead")).error).toMatchObject({
      code: "P0002",
    });
  });

  it("a known actor → the tenant comes from the subject row", async () => {
    const rxB = await prescriptionFor(ownerB, ownerB.userId);
    const result = await enqueueWebhookEventAsSystem(getAdminClient(), "prescription.issued", rxB, "system:api_v1");
    expect(result.queued).toBe(1);
    expect(psql(`select tenant_id || '|' || subscription_id from public.webhook_delivery_queue where id = '${result.deliveryIds[0]}'`)).toEqual([
      `${ownerB.tenantId}|${subB.id}`,
    ]);
  });
});

describe("contract: members cannot write the delivery table (M-XTENANT-WH, T-04-25)", () => {
  it("owner/admin read their clinic's rows; a receptionist reads none", async () => {
    const { data: ownRows } = await ownerA.client.from("webhook_delivery_queue").select("id").eq("subscription_id", subRx.id);
    expect((ownRows ?? []).length).toBeGreaterThan(0);
    const { data: seen } = await receptionistA.client.from("webhook_delivery_queue").select("id");
    expect(seen).toEqual([]);
  });

  it("owner and admin: INSERT, UPDATE and DELETE are refused (42501), including the review E-1 cross-tenant PoC", async () => {
    const [row] = deliveriesFor(subRx.id);
    for (const member of [ownerA, adminA]) {
      const insert = await member.client.from("webhook_delivery_queue").insert({
        tenant_id: member.tenantId,
        subscription_id: subB.id,
        event_type: "payment.recorded",
        payload: JSON.stringify({ forged: true }),
      });
      expect(insert.error?.code).toBe("42501");
      const update = await member.client.from("webhook_delivery_queue").update({ max_retries: 1000, status: "pending" }).eq("id", row.id);
      expect(update.error?.code).toBe("42501");
      const del = await member.client.from("webhook_delivery_queue").delete().eq("id", row.id);
      expect(del.error?.code).toBe("42501");
    }
    expect(deliveriesFor(subB.id).filter((r) => r.eventKey === null)).toEqual([]);
    expect(psql(`select max_retries from public.webhook_delivery_queue where id = '${row.id}'`)).toEqual(["5"]);
  });

  it("members cannot claim or finish a delivery (42501)", async () => {
    const [row] = deliveriesFor(subRx.id);
    const claim = await ownerA.client.rpc("webhook_delivery_claim" as never, { p_id: row.id } as never);
    expect((claim as { error: { code: string } | null }).error?.code).toBe("42501");
    const finish = await ownerA.client.rpc("webhook_delivery_finish" as never, {
      p_id: row.id,
      p_success: true,
      p_status_code: 200,
      p_error_code: null,
      p_duration_ms: 1,
      p_retryable: false,
    } as never);
    expect((finish as { error: { code: string } | null }).error?.code).toBe("42501");
  });

  it("catalogue: writers not executable by API roles; RPC grants as designed; definer + empty search_path", () => {
    const can = (role: string, fn: string) => psql(`select has_function_privilege('${role}', '${fn}', 'EXECUTE')`)[0];
    for (const fn of [
      "private.enqueue_webhook_internal(uuid,text,jsonb,text,uuid)",
      "private.webhook_event_subject(text,uuid)",
      "ops.webhook_delivery_enqueue_job()",
      "ops.webhook_job_dead()",
    ]) {
      for (const role of ["anon", "authenticated", "service_role"]) expect(`${role} ${fn} ${can(role, fn)}`).toBe(`${role} ${fn} f`);
    }
    const grants: Array<[string, string, string]> = [
      ["public.enqueue_webhook_event(uuid,text,uuid,uuid)", "authenticated", "t"],
      ["public.enqueue_webhook_event(uuid,text,uuid,uuid)", "anon", "f"],
      ["public.enqueue_webhook_event(uuid,text,uuid,uuid)", "service_role", "f"],
      ["public.enqueue_webhook_event_system(text,text,uuid)", "service_role", "t"],
      ["public.enqueue_webhook_event_system(text,text,uuid)", "authenticated", "f"],
      ["public.webhook_delivery_claim(uuid)", "service_role", "t"],
      ["public.webhook_delivery_claim(uuid)", "authenticated", "f"],
      ["public.webhook_delivery_finish(uuid,boolean,integer,text,integer,boolean)", "service_role", "t"],
      ["public.webhook_delivery_finish(uuid,boolean,integer,text,integer,boolean)", "anon", "f"],
    ];
    for (const [fn, role, expected] of grants) expect(`${fn} ${role} ${can(role, fn)}`).toBe(`${fn} ${role} ${expected}`);
    const definers = psql(
      `select p.proname || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p ` +
        `join pg_namespace n on n.oid = p.pronamespace where (n.nspname, p.proname) in (('public','enqueue_webhook_event'), ` +
        `('public','enqueue_webhook_event_system'), ('public','webhook_delivery_claim'), ('public','webhook_delivery_finish'), ` +
        `('private','enqueue_webhook_internal'), ('private','webhook_event_subject')) order by 1`
    );
    expect(definers).toHaveLength(6);
    for (const line of definers) expect(line).toMatch(/^[a-z_]+\|true\|.*search_path=""/);
    const tableGrants = psql(
      `select grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema = 'public' ` +
        `and table_name = 'webhook_delivery_queue' and grantee in ('anon', 'authenticated') order by 1`
    );
    expect(tableGrants).toEqual(["authenticated:SELECT"]);
  });
});

/**
 * V2-04 04-07a (review IND M5, triage M-RXEVENT; review B L-3): `prescription.issued` is the sign-time event, not the
 * empty draft's; `lab_result.ready` needs a document whose patient and visit belong to its clinic and to each other.
 * Each case fails on 000040 (the draft queued the event and suppressed the sign-time one; any document qualified).
 */
describe("04-07a: prescription.issued at signing; lab_result.ready for a consistent document", () => {
  const rxRows = (rx: string) => deliveriesFor(subRx.id).filter((r) => (r.eventKey ?? "").startsWith(`prescription.issued:${rx}`));

  it("the app flow: the empty draft queues nothing; signing the consultation queues the one event", async () => {
    const p = await seedPatient(ownerA.tenantId, ownerA.userId, doctorA.userId);
    const doctorCtx = ctxFor(doctorA);
    const saved = await saveConsultationDraft(doctorCtx, consultationDraftInput({ visit_id: p.visitId, clinical_notes: "Synthetic note." }));
    expect(saved.success).toBe(true);
    const draft = await getOrCreateDraftPrescription(doctorCtx, p.visitId);
    if (!draft.success) throw new Error("draft prescription failed");
    const rx = draft.prescriptionId;
    expect(rxRows(rx)).toEqual([]);

    expect((await completeAndSignConsultation(doctorCtx, p.visitId)).success).toBe(true);
    const rows = rxRows(rx);
    expect(rows.map((r) => r.eventKey)).toEqual([`prescription.issued:${rx}:signed`]);
    expect(JSON.parse(deliveryPayload(rows[0].id)).data).toEqual({ prescription_id: rx, patient_id: p.patientId, visit_id: p.visitId });
  });

  it("from a request an unsigned prescription is refused (empty draft or with items); the API path queues one with items", async () => {
    const draft = await prescriptionFor(ownerA, doctorA.userId, { signed: false });
    for (const who of [doctorA, receptionistA]) {
      expect((await enqueue(who.client, who.tenantId, "prescription.issued", draft)).error).toMatchObject({
        code: "P0001",
        message: "EVENT_NOT_ALLOWED",
      });
    }
    expect((await system(getAdminClient(), "system:api_v1", "prescription.issued", draft)).error).toMatchObject({
      message: "EVENT_NOT_ALLOWED",
    });
    expect(rxRows(draft)).toEqual([]);

    // With items (what POST /api/v1/prescriptions creates): still refused from a request, queued on the API path.
    psql(
      `insert into public.prescription_items (prescription_id, medicine_name, dosage, duration) ` +
        `values ('${draft}', 'Synthetic tablet', '1-0-1', '5 days')`
    );
    expect((await enqueue(doctorA.client, doctorA.tenantId, "prescription.issued", draft)).error).toMatchObject({
      message: "EVENT_NOT_ALLOWED",
    });
    expect((await system(getAdminClient(), "system:api_v1", "prescription.issued", draft)).data?.queued).toBe(1);
    expect(rxRows(draft).map((r) => r.eventKey)).toEqual([`prescription.issued:${draft}:created`]);

    // Signing later is a new state: the sign-time event is not suppressed by the earlier one.
    psql(`update public.prescriptions set signed_at = now() where id = '${draft}'`);
    expect((await enqueue(doctorA.client, doctorA.tenantId, "prescription.issued", draft)).data?.queued).toBe(1);
    expect(rxRows(draft).map((r) => r.eventKey).sort()).toEqual([
      `prescription.issued:${draft}:created`,
      `prescription.issued:${draft}:signed`,
    ]);
    // An amended (no longer active) prescription is not issued.
    const amended = await prescriptionFor(ownerA, doctorA.userId);
    psql(`update public.prescriptions set status = 'amended' where id = '${amended}'`);
    expect((await enqueue(doctorA.client, doctorA.tenantId, "prescription.issued", amended)).error).toMatchObject({
      message: "EVENT_NOT_ALLOWED",
    });
  });

  it("lab_result.ready: a document whose visit is another patient's, or whose patient is another clinic's, is refused", async () => {
    const other = await seedPatient(ownerA.tenantId, ownerA.userId);
    const foreign = await seedPatient(ownerB.tenantId, ownerB.userId);
    const doc = (tenant: string, patient: string, visit: string | null, run: (sql: string) => string[] = psql) =>
      run(
        `insert into public.patient_documents (tenant_id, patient_id, visit_id, title, storage_path, original_filename, mime_type, ` +
          `file_size_bytes, uploaded_by, report_date) values ('${tenant}', '${patient}', ${visit ? `'${visit}'` : "null"}, 'Synthetic CBC', ` +
          `'tenants/${tenant}/patients/${patient}/labs/synthetic-${letters(6)}.pdf', 'synthetic.pdf', 'application/pdf', 10, '${ownerA.userId}', ` +
          // Explicit: plantLegacyRow (session_replication_role = replica) skips every trigger, including the 05-08
          // report_date fill trigger, and the column has no default since 05-08.
          `current_date) returning id`
      )[0];
    const mismatchedVisit = doc(ownerA.tenantId, patientA.patientId, other.visitId);
    // Since 05-03 the composite FK refuses another clinic's patient outright; the row is planted as one from before
    // 05-03 (FK triggers off) to prove the RPC's own consistency check still holds.
    expect(() => doc(ownerA.tenantId, foreign.patientId, null)).toThrow(/patient_documents_tenant_patient_fkey/);
    const foreignPatient = doc(ownerA.tenantId, foreign.patientId, null, plantLegacyRow);
    for (const id of [mismatchedVisit, foreignPatient]) {
      expect((await enqueue(receptionistA.client, receptionistA.tenantId, "lab_result.ready", id)).error).toMatchObject({
        code: "P0001",
        message: "EVENT_NOT_ALLOWED",
      });
      expect((await system(getAdminClient(), "system:api_v1", "lab_result.ready", id)).error).toMatchObject({
        message: "EVENT_NOT_ALLOWED",
      });
      expect(deliveriesFor(subVisits.id).filter((r) => r.eventKey === `lab_result.ready:${id}`)).toEqual([]);
    }
    // The patient's own visit qualifies.
    const own = doc(ownerA.tenantId, patientA.patientId, patientA.visitId);
    expect((await enqueue(receptionistA.client, receptionistA.tenantId, "lab_result.ready", own)).data?.queued).toBe(1);
  });
});
