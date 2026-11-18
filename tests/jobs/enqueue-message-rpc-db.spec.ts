/**
 * V2-04 04-03a (P0-12; R-6 revised, R-24, R-44; T-04-04, T-04-05): the message enqueue RPCs of migration 000035 and the
 * `communication_queue` contract, on the live local stack.
 *
 * - `public.enqueue_message` (authenticated): one row (`created_by` = caller) and one `message.send` job (`msg:<id>`);
 *   the tenant comes from the subject, which must be in the caller's ACTIVE tenant (`p_tenant_id` =
 *   `ServiceContext.tenantId`) and a membership: another clinic's patient, and a dual-clinic member acting in A for B's
 *   patient, read as `P0002 SUBJECT_MISMATCH` with 0 rows (03-07 D1 finding 2); acting in B writes one B row.
 * - Dedupe: the same key twice (and five times in parallel, a retried user action) → one row, one job.
 * - R-24: a recipient that is not the patient's or guardian's number, and a template outside the allow-list (or of
 *   another channel), are refused; params over 4 KB are refused.
 * - `public.enqueue_message_system`: `authenticated` → 42501; an actor outside the closed set → `ACTOR_INVALID`; the
 *   service role with a known actor → tenant from the subject, `created_by` null, `metadata.system_actor`.
 * - Contract (pulled forward from 04-03c): members cannot INSERT/UPDATE/DELETE queue rows or call the claim/finish
 *   RPCs; anon holds no privilege; catalogue: writers not executable by API roles, definer + `search_path=""`.
 * - `lib/jobs/enqueue.ts` maps a refusal to `EnqueueError` (NOT_FOUND / VALIDATION_FAILED) with a fixed message.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueMessage, EnqueueError } from "@/lib/jobs/enqueue";
import { hasPerm, type Permission } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import {
  addMemberToTenant,
  createDualMembershipUser,
  seedTenantWithOwner,
  type DualMemberUser,
  type SeededTenant,
} from "../helpers/tenants";
import { psql } from "../helpers/sql";
import { anonClient, letters } from "./helpers";
import { jobsFor, seedPatient, syntheticMobile, type SeededPatient } from "./message-helpers";
import { signInActingIn } from "../helpers/active-tenant";

let ownerA: SeededTenant;
let receptionistA: SeededTenant;
let ownerB: SeededTenant;
let dual: DualMemberUser;
let patientA: SeededPatient;
let patientA2: SeededPatient;
let patientB: SeededPatient;

beforeAll(async () => {
  ownerA = await seedTenantWithOwner(`Enqueue Spec A ${letters(6)}`);
  ownerB = await seedTenantWithOwner(`Enqueue Spec B ${letters(6)}`);
  receptionistA = await addMemberToTenant(ownerA.tenantId, "receptionist");
  dual = await createDualMembershipUser(ownerA.tenantId, "receptionist", ownerB.tenantId, "receptionist");
  patientA = await seedPatient(ownerA.tenantId, ownerA.userId);
  patientA2 = await seedPatient(ownerA.tenantId, ownerA.userId);
  patientB = await seedPatient(ownerB.tenantId, ownerB.userId);
});

afterAll(() => {
  // Tenants (and with them rows and jobs) are removed by the global teardown.
});

/** Any API client (a member's session or anon); the RPC args are built untyped on purpose (nulls, forged values). */
type Db = { rpc: (fn: never, args: never) => unknown };

function args(over: Record<string, unknown> = {}) {
  return {
    p_patient_id: patientA.patientId,
    p_visit_id: null,
    p_channel: "whatsapp",
    // A template the receptionist may queue (billing:view; 05-11b IND L4: lab_report_uploaded now needs labs:view).
    p_message_type: "receipt_issued",
    p_template_id: "receipt_issued",
    p_template_params: { patient_name: "Synthetic" },
    p_recipient_phone: null,
    p_recipient_user_id: null,
    p_metadata: {},
    ...over,
  };
}

async function enqueue(db: Db, tenantId: string | null, over: Record<string, unknown> = {}) {
  return db.rpc("enqueue_message" as never, { p_tenant_id: tenantId, ...args(over) } as never) as Promise<{
    data: { id: string; status: string; deduped: boolean } | null;
    error: { code: string; message: string } | null;
  }>;
}

function rowsFor(patientId: string): string[] {
  return psql(
    `select id || '|' || tenant_id || '|' || coalesce(created_by::text, '') || '|' || status from public.communication_queue ` +
      `where patient_id = '${patientId}' order by created_at`
  );
}

describe("public.enqueue_message (request path)", () => {
  it("a receptionist enqueues for a patient of their clinic: one row by them and one message.send job", async () => {
    const before = rowsFor(patientA.patientId).length;
    const { data, error } = await enqueue(receptionistA.client, receptionistA.tenantId);
    expect(error).toBeNull();
    expect(data).toEqual({ id: expect.any(String), status: "pending", deduped: false });
    const rows = rowsFor(patientA.patientId);
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toBe(`${data!.id}|${ownerA.tenantId}|${receptionistA.userId}|pending`);
    expect(psql(`select recipient_phone from public.communication_queue where id = '${data!.id}'`)).toEqual([patientA.phone]);
    const jobs = jobsFor(data!.id);
    expect(jobs).toHaveLength(1);
    expect(psql(`select dedupe_key || '|' || tenant_id from ops.jobs where id = '${jobs[0].id}'`)).toEqual([
      `msg:${data!.id}|${ownerA.tenantId}`,
    ]);
  });

  it("a patient of another clinic → P0002 SUBJECT_MISMATCH, no row", async () => {
    const before = rowsFor(patientB.patientId).length;
    for (const tenant of [receptionistA.tenantId, ownerB.tenantId]) {
      const { error } = await enqueue(receptionistA.client, tenant, { p_patient_id: patientB.patientId });
      expect(error).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
    }
    // A visit of another clinic as the subject, and an id that does not exist, read the same.
    const { error: visitErr } = await enqueue(receptionistA.client, receptionistA.tenantId, {
      p_patient_id: null,
      p_visit_id: patientB.visitId,
    });
    expect(visitErr).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
    const { error: missing } = await enqueue(receptionistA.client, receptionistA.tenantId, {
      p_patient_id: "00000000-0000-4000-8000-00000000dead",
    });
    expect(missing).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
    expect(rowsFor(patientB.patientId)).toHaveLength(before);
  });

  it("anon cannot execute it (42501)", async () => {
    const { error } = await enqueue(anonClient(), ownerA.tenantId);
    expect(error?.code).toBe("42501");
  });

  it("dual-clinic member acting in A cannot enqueue for B's patient; acting in B writes one B row (03-07 finding 2)", async () => {
    // The app's client names the active clinic (x-clinicos-tenant, R-42); since 05-02c the RPC binds p_tenant_id to it.
    const inA = await signInActingIn(dual.userEmail, ownerA.tenantId);
    const inB = await signInActingIn(dual.userEmail, ownerB.tenantId);
    const before = rowsFor(patientB.patientId).length;
    const refused = await enqueue(inA, ownerA.tenantId, { p_patient_id: patientB.patientId });
    expect(refused.error).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
    const refusedVisit = await enqueue(inA, ownerA.tenantId, { p_patient_id: null, p_visit_id: patientB.visitId });
    expect(refusedVisit.error).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
    // 05-02c: acting in A, naming B as the tenant is refused too (before: any membership of B passed this check).
    const namedB = await enqueue(inA, ownerB.tenantId, { p_patient_id: patientB.patientId });
    expect(namedB.error).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
    expect(rowsFor(patientB.patientId)).toHaveLength(before);

    const allowed = await enqueue(inB, ownerB.tenantId, { p_patient_id: patientB.patientId });
    expect(allowed.error).toBeNull();
    const rows = rowsFor(patientB.patientId);
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toBe(`${allowed.data!.id}|${ownerB.tenantId}|${dual.userId}|pending`);
  });

  it("a non-member tenant id narrows nothing: a member of A naming B for A's patient is refused", async () => {
    const { error } = await enqueue(receptionistA.client, ownerB.tenantId, { p_patient_id: patientA.patientId });
    expect(error).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
    const { error: noTenant } = await enqueue(receptionistA.client, null);
    expect(noTenant).toMatchObject({ code: "P0002", message: "SUBJECT_MISMATCH" });
  });

  it("patient and visit that do not belong together → SUBJECT_MISMATCH", async () => {
    // Different clinics, both visible to the dual member.
    const cross = await enqueue(dual.client, ownerA.tenantId, { p_patient_id: patientA.patientId, p_visit_id: patientB.visitId });
    expect(cross.error).toMatchObject({ message: "SUBJECT_MISMATCH" });
    // Same clinic, but the visit is another patient's.
    const other = await enqueue(receptionistA.client, ownerA.tenantId, {
      p_patient_id: patientA.patientId,
      p_visit_id: patientA2.visitId,
    });
    expect(other.error).toMatchObject({ code: "P0001", message: "SUBJECT_MISMATCH" });
    // A visit alone takes its patient (and the patient's number).
    const byVisit = await enqueue(receptionistA.client, ownerA.tenantId, { p_patient_id: null, p_visit_id: patientA2.visitId });
    expect(byVisit.error).toBeNull();
    expect(psql(`select patient_id || '|' || appointment_id || '|' || recipient_phone from public.communication_queue where id = '${byVisit.data!.id}'`)).toEqual([
      `${patientA2.patientId}|${patientA2.visitId}|${patientA2.phone}`,
    ]);
  });

  it("the same dedupe key twice → one row; the second answer is deduped", async () => {
    const key = `appointment_booked:${letters(12)}`;
    const first = await enqueue(receptionistA.client, ownerA.tenantId, { p_dedupe_key: key });
    const second = await enqueue(receptionistA.client, ownerA.tenantId, { p_dedupe_key: key });
    expect(first.data).toMatchObject({ deduped: false });
    expect(second.data).toEqual({ id: first.data!.id, status: "pending", deduped: true });
    // 04-07a M-DEDUPE: stored in the caller's namespace.
    expect(psql(`select count(*) from public.communication_queue where dedupe_key = 'member:${receptionistA.userId}:${key}'`)).toEqual(["1"]);
    expect(psql(`select count(*) from public.communication_queue where dedupe_key = '${key}'`)).toEqual(["0"]);
    expect(jobsFor(first.data!.id)).toHaveLength(1);
  });

  it("a user action retried five times at once enqueues exactly one row and one job for its dedupe key", async () => {
    const key = `appointment_cancelled:${letters(12)}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => enqueue(receptionistA.client, ownerA.tenantId, { p_dedupe_key: key }))
    );
    expect(results.every((r) => r.error === null)).toBe(true);
    const ids = new Set(results.map((r) => r.data!.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.data!.deduped === false)).toHaveLength(1);
    expect(psql(`select count(*) from public.communication_queue where dedupe_key = 'member:${receptionistA.userId}:${key}'`)).toEqual(["1"]);
    const [id] = [...ids];
    expect(jobsFor(id)).toHaveLength(1);
    expect(psql(`select count(*) from ops.jobs where dedupe_key = 'msg:${id}'`)).toEqual(["1"]);
  });

  it("R-24: only the patient's or guardian's number; the template must be allow-listed for the channel", async () => {
    const stranger = await enqueue(receptionistA.client, ownerA.tenantId, { p_recipient_phone: "+919812300045" });
    expect(stranger.error).toMatchObject({ code: "P0001", message: "RECIPIENT_NOT_ALLOWED" });
    const garbage = await enqueue(receptionistA.client, ownerA.tenantId, { p_recipient_phone: "not a phone" });
    expect(garbage.error).toMatchObject({ code: "P0001", message: "RECIPIENT_NOT_ALLOWED" });

    // The patient's own number in another spelling is the same number.
    const national = patientA.phone.slice(3);
    const respelled = await enqueue(receptionistA.client, ownerA.tenantId, { p_recipient_phone: `0${national}` });
    expect(respelled.error).toBeNull();

    const guardian = syntheticMobile();
    psql(`update public.patients set guardian_phone = '${guardian}' where id = '${patientA.patientId}'`);
    const toGuardian = await enqueue(receptionistA.client, ownerA.tenantId, { p_recipient_phone: guardian });
    expect(toGuardian.error).toBeNull();

    const template = await enqueue(receptionistA.client, ownerA.tenantId, { p_template_id: "free_text_anything" });
    expect(template.error).toMatchObject({ code: "P0001", message: "TEMPLATE_NOT_ALLOWED" });
    const wrongChannel = await enqueue(receptionistA.client, ownerA.tenantId, {
      p_channel: "sms",
      p_template_id: "receipt_issued",
    });
    expect(wrongChannel.error).toMatchObject({ code: "P0001", message: "TEMPLATE_NOT_ALLOWED" });

    const big = await enqueue(receptionistA.client, ownerA.tenantId, { p_template_params: { blob: "x".repeat(5000) } });
    expect(big.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
  });

  it("the caller cannot claim a system actor through metadata (04-07a: any key outside the allow-list is refused)", async () => {
    const before = rowsFor(patientA.patientId).length;
    const { data, error } = await enqueue(receptionistA.client, ownerA.tenantId, { p_metadata: { system_actor: "system:jobs" } });
    expect(data).toBeNull();
    expect(error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    expect(rowsFor(patientA.patientId)).toHaveLength(before);
  });

  it("lib/jobs/enqueue maps a refusal to EnqueueError with a fixed message", async () => {
    const ctx = ctxFor(receptionistA);
    const err = await enqueueMessage(ctx, {
      patientId: patientB.patientId,
      channel: "whatsapp",
      messageType: "receipt_issued",
      templateId: "receipt_issued",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(EnqueueError);
    expect(err.code).toBe("SUBJECT_MISMATCH");
    expect(err.appError).toMatchObject({ code: "NOT_FOUND", reason: "SUBJECT_MISMATCH" });
    expect(err.message).toBe("The patient or visit for this message was not found.");

    const ok = await enqueueMessage(ctx, {
      patientId: patientA.patientId,
      channel: "whatsapp",
      messageType: "receipt_issued",
      templateId: "receipt_issued",
    });
    expect(ok).toEqual({ id: expect.any(String), status: "pending", deduped: false });

    // 04-07a M-ROLE: a role without the call site's permission → FORBIDDEN with the fixed message.
    const forbidden = await enqueueMessage(ctx, {
      patientId: patientA.patientId,
      channel: "whatsapp",
      messageType: "prescription_ready",
      templateId: "prescription_ready",
    }).catch((e) => e);
    expect(forbidden).toBeInstanceOf(EnqueueError);
    expect(forbidden.appError).toMatchObject({ code: "FORBIDDEN" });
    expect(forbidden.message).toBe("You do not have permission to send this message.");
  });
});

describe("public.enqueue_message_system", () => {
  const sysArgs = (actor: string) => ({ p_system_actor: actor, ...args({ p_patient_id: patientB.patientId }) });

  it("authenticated → 42501; anon → 42501", async () => {
    expect((await receptionistA.client.rpc("enqueue_message_system", sysArgs("system:jobs") as never)).error?.code).toBe("42501");
    expect((await anonClient().rpc("enqueue_message_system", sysArgs("system:jobs") as never)).error?.code).toBe("42501");
  });

  it("the service role with an actor outside the closed set → ACTOR_INVALID", async () => {
    const { error } = await getAdminClient().rpc("enqueue_message_system", sysArgs("system:unknown") as never);
    expect(error).toMatchObject({ code: "P0001", message: "ACTOR_INVALID" });
  });

  it("the service role with a known actor: tenant from the subject, no creator, actor recorded", async () => {
    const { data, error } = await getAdminClient().rpc("enqueue_message_system", sysArgs("system:messaging_webhook") as never);
    expect(error).toBeNull();
    const id = (data as { id: string }).id;
    expect(
      psql(`select tenant_id || '|' || coalesce(created_by::text, 'null') || '|' || (metadata ->> 'system_actor') from public.communication_queue where id = '${id}'`)
    ).toEqual([`${ownerB.tenantId}|null|system:messaging_webhook`]);
    expect(jobsFor(id)).toHaveLength(1);
  });
});

describe("communication_queue contract (members only read status columns)", () => {
  it("a member cannot insert, update or delete queue rows", async () => {
    const insert = await receptionistA.client.from("communication_queue").insert({
      tenant_id: ownerA.tenantId,
      patient_id: patientA.patientId,
      channel: "whatsapp",
      message_type: "prescription_ready",
      template_id: "prescription_ready",
      recipient_phone: "+919812300045",
    });
    expect(insert.error?.code).toBe("42501");

    const { data: queued } = await enqueue(receptionistA.client, ownerA.tenantId);
    const update = await receptionistA.client
      .from("communication_queue")
      .update({ status: "pending" } as never)
      .eq("id", queued!.id);
    expect(update.error?.code).toBe("42501");
    const del = await receptionistA.client.from("communication_queue").delete().eq("id", queued!.id);
    expect(del.error?.code).toBe("42501");
    expect(psql(`select count(*) from public.communication_queue where id = '${queued!.id}'`)).toEqual(["1"]);

    // The status columns stay readable (the communication log).
    const read = await receptionistA.client.from("communication_queue").select("id, status").eq("id", queued!.id);
    expect(read.data).toEqual([{ id: queued!.id, status: "pending" }]);
  });

  it("a member cannot claim, finish or dead-letter a row (42501)", async () => {
    const { data: queued } = await enqueue(receptionistA.client, ownerA.tenantId);
    for (const [fn, a] of [
      ["communication_queue_claim", { p_id: queued!.id }],
      ["communication_queue_finish", { p_id: queued!.id, p_success: true, p_external_message_id: "x", p_error: null }],
      ["communication_queue_dead_letter", { p_id: queued!.id, p_error_code: "x" }],
    ] as const) {
      expect((await receptionistA.client.rpc(fn as never, a as never)).error?.code).toBe("42501");
    }
    expect(psql(`select status from public.communication_queue where id = '${queued!.id}'`)).toEqual(["pending"]);
  });

  it("catalogue: no write privilege for API roles; writers not executable by API roles; definer + empty search_path", () => {
    expect(
      psql(
        "select r || ':' || p from unnest(array['anon','authenticated']) r, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p " +
          "where has_table_privilege(r, 'public.communication_queue', p) " +
          "or (p in ('INSERT','UPDATE') and has_any_column_privilege(r, 'public.communication_queue', p))"
      )
    ).toEqual([]);
    expect(psql("select has_any_column_privilege('anon', 'public.communication_queue', 'SELECT')::text")).toEqual(["false"]);

    const exec = (fn: string) =>
      psql(
        `select string_agg(r || '=' || has_function_privilege(r, '${fn}', 'execute')::text, ',' order by r) ` +
          "from unnest(array['anon','authenticated','service_role']) r"
      )[0];
    expect(exec("private.enqueue_message_internal(uuid,uuid,uuid,text,text,text,jsonb,text,uuid,jsonb,timestamptz,text,uuid)")).toBe(
      "anon=false,authenticated=false,service_role=false"
    );
    expect(exec("public.enqueue_message(uuid,uuid,uuid,text,text,text,jsonb,text,uuid,jsonb,timestamptz,text)")).toBe(
      "anon=false,authenticated=true,service_role=false"
    );
    expect(exec("public.enqueue_message_system(text,uuid,uuid,text,text,text,jsonb,text,uuid,jsonb,timestamptz,text)")).toBe(
      "anon=false,authenticated=false,service_role=true"
    );
    expect(exec("public.communication_queue_dead_letter(uuid,text)")).toBe("anon=false,authenticated=false,service_role=true");
    expect(exec("public.communication_queue_claim(uuid)")).toBe("anon=false,authenticated=false,service_role=true");
    expect(exec("ops.reap_delivery_rows()")).toBe("anon=false,authenticated=false,service_role=false");

    const defs = psql(
      "select n.nspname || '.' || p.proname || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ';'), '') " +
        "from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
        "where (n.nspname, p.proname) in (('private','enqueue_message_internal'), ('private','message_subject'), " +
        "('public','enqueue_message'), ('public','enqueue_message_system'), ('public','communication_queue_dead_letter'), " +
        "('ops','communication_queue_enqueue_job'), ('ops','message_job_dead'), ('ops','reap_delivery_rows')) order by 1"
    );
    expect(defs).toHaveLength(8);
    for (const line of defs) expect(line).toMatch(/\|true\|search_path=""/);
    expect(psql("select count(*) from cron.job where jobname = 'delivery-reap' and command = 'select ops.reap_delivery_rows()'")).toEqual(["1"]);
  });
});

/**
 * V2-04 04-07a (review B M-1 / M-2, IND I3; triage M-ROLE, M-DEDUPE): the request path checks the call site's permission
 * per template, keeps the bot, lifecycle and fallback templates system-only, bounds every caller-chosen field, and puts a
 * caller's dedupe key in its own namespace. Each case fails on 000040 (the RPC accepted all of them).
 */
describe("04-07a: public.enqueue_message permission per template and bounded input (M-ROLE)", () => {
  let nurseA: SeededTenant;
  let doctorA: SeededTenant;
  let adminA: SeededTenant;
  beforeAll(async () => {
    nurseA = await addMemberToTenant(ownerA.tenantId, "nurse");
    doctorA = await addMemberToTenant(ownerA.tenantId, "doctor");
    adminA = await addMemberToTenant(ownerA.tenantId, "admin");
  });

  /**
   * The permission each request-path call site asserts before it enqueues (lib/permissions/matrix.ts names). V2-05
   * 05-11b (IND L4, migration 000074) realigned the SQL role lists with the 05-02b/05-02c call-site keys.
   */
  const REQUEST_TEMPLATE_PERMISSION: Record<string, Permission> = {
    appointment_booked: "appointments:edit", // features/visits/scheduling-service.ts bookAppointment
    prescription_ready: "prescriptions:view", // features/prescriptions/service.ts sharePrescriptionViaWhatsApp
    lab_report_uploaded: "labs:view", // features/labs/service.ts shareLabReportViaWhatsApp
    referral_letter_issued: "consultations:view", // features/referrals/service.ts shareReferralLetterViaWhatsApp
    receipt_issued: "billing:view", // features/billing/service.ts shareReceiptViaWhatsApp
    consultation_documents: "prescriptions:view", // features/billing/service.ts sendConsolidatedConsultationWhatsApp
  };
  const ROLES: UserRole[] = ["owner", "admin", "doctor", "receptionist", "nurse"];

  it("ops.message_templates.request_roles is exactly the roles holding each call site's permission; every other template is system-only", () => {
    const rows = psql(
      "select template_id || '|' || array_to_string(array(select unnest(request_roles) order by 1), ',') from ops.message_templates order by 1"
    );
    const sqlRoles = Object.fromEntries(rows.map((l) => l.split("|") as [string, string]));
    for (const [template, roles] of Object.entries(sqlRoles)) {
      const perm = REQUEST_TEMPLATE_PERMISSION[template];
      const expected = perm ? ROLES.filter((r) => hasPerm(r, perm)).sort().join(",") : "";
      expect(roles, template).toBe(expected);
    }
    expect(Object.keys(REQUEST_TEMPLATE_PERMISSION).every((t) => t in sqlRoles)).toBe(true);
  });

  it("a role without the template's permission → 42501 FORBIDDEN, no row (receptionist: prescription; nurse: receipt)", async () => {
    const before = rowsFor(patientA.patientId).length;
    for (const [who, template] of [
      [receptionistA, "prescription_ready"],
      [receptionistA, "consultation_documents"],
      [nurseA, "receipt_issued"],
      [adminA, "prescription_ready"],
      // 05-11b (IND L4): nurses lost prescriptions:view, admins/receptionists hold no labs:view or consultations:view.
      [nurseA, "prescription_ready"],
      [nurseA, "consultation_documents"],
      [adminA, "lab_report_uploaded"],
      [receptionistA, "referral_letter_issued"],
    ] as const) {
      const { error } = await enqueue(who.client, ownerA.tenantId, { p_message_type: template, p_template_id: template });
      expect(error, `${template}`).toMatchObject({ code: "42501", message: "FORBIDDEN" });
    }
    expect(rowsFor(patientA.patientId)).toHaveLength(before);
    // The roles that hold it may.
    for (const [who, template] of [
      [doctorA, "prescription_ready"],
      [nurseA, "lab_report_uploaded"],
      [doctorA, "consultation_documents"],
      [adminA, "receipt_issued"],
      // PO-3 (V2-05 05-01b): receptionists hold billing:view and share receipts.
      [receptionistA, "receipt_issued"],
      [nurseA, "appointment_booked"],
    ] as const) {
      const { error } = await enqueue(who.client, ownerA.tenantId, { p_message_type: template, p_template_id: template });
      expect(error, `${template}`).toBeNull();
    }
  });

  it("bot replies, lifecycle follow-ups and SMS fallbacks are system-only: TEMPLATE_NOT_ALLOWED even for the owner", async () => {
    const before = rowsFor(patientA.patientId).length;
    for (const [channel, template, params] of [
      ["whatsapp", "conversational_triage", { message: "free text http://phish.invalid" }],
      ["whatsapp", "appointment_confirmed_ack", { message: "x" }],
      ["whatsapp", "appointment_cancelled_ack", { message: "x" }],
      ["whatsapp", "appointment_reschedule_link", { message: "x" }],
      ["whatsapp", "bot_not_found", {}],
      ["whatsapp", "appointment_cancelled", { patient_name: "Synthetic" }],
      ["whatsapp", "appointment_rescheduled", { patient_name: "Synthetic" }],
      ["sms", "appointment_booked_sms_fallback", { patient_name: "Synthetic" }],
      ["sms", "appointment_rescheduled_sms_fallback", { patient_name: "Synthetic" }],
    ] as const) {
      const { error } = await enqueue(ownerA.client, ownerA.tenantId, {
        p_channel: channel,
        p_message_type: template,
        p_template_id: template,
        p_template_params: params,
      });
      expect(error, template).toMatchObject({ code: "P0001", message: "TEMPLATE_NOT_ALLOWED" });
    }
    expect(rowsFor(patientA.patientId)).toHaveLength(before);
  });

  it("params: only the template's declared keys, scalar values of at most 256 characters; message_type is the template", async () => {
    const before = rowsFor(patientA.patientId).length;
    // The nurse's lab-report template (labs:view; the file's default, receipt_issued, is the front desk's since 05-11b).
    const lab = { p_message_type: "lab_report_uploaded", p_template_id: "lab_report_uploaded" };
    for (const over of [
      { p_template_params: { patient_name: "Synthetic", mobiles: "917000000001" } },
      { p_template_params: { template_id: "ATTACKER_FLOW" } },
      { p_template_params: { sender: "EVILID" } },
      { p_template_params: { short_url: "1" } },
      { p_template_params: { message: "free text" } },
      { p_template_params: { patient_name: { nested: true } } },
      { p_template_params: { patient_name: ["a"] } },
      { p_template_params: { patient_name: "x".repeat(257) } },
      { p_message_type: "appointment_reminder" },
    ]) {
      const { error } = await enqueue(nurseA.client, ownerA.tenantId, { ...lab, ...over });
      expect(error, JSON.stringify(over).slice(0, 80)).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    }
    expect(rowsFor(patientA.patientId)).toHaveLength(before);
    const ok = await enqueue(nurseA.client, ownerA.tenantId, {
      ...lab,
      p_template_params: { patient_name: "x".repeat(256), clinic_name: "C", document_url: "https://app.example.test/r/x", test_name: 7 },
    });
    expect(ok.error).toBeNull();
  });

  it("metadata: only subject ids and up to three buttons; visit_id must be the message's visit; run_at at most 90 days ahead", async () => {
    const before = rowsFor(patientA.patientId).length;
    for (const over of [
      { p_metadata: { appointment_id: patientA2.visitId } },
      { p_metadata: { visit_id: patientA2.visitId } },
      { p_visit_id: patientA.visitId, p_metadata: { visit_id: patientA2.visitId } },
      { p_metadata: { is_sms_fallback: true } },
      { p_metadata: { fallback_of: patientA.visitId } },
      { p_metadata: { document_id: "not-a-uuid" } },
      { p_metadata: { buttons: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] } },
      { p_metadata: { buttons: [{ id: "a", onclick: "x" }] } },
      { p_metadata: { buttons: "btn" } },
      { p_run_at: new Date(Date.now() + 91 * 86_400_000).toISOString() },
    ]) {
      const { error } = await enqueue(receptionistA.client, ownerA.tenantId, over);
      expect(error, JSON.stringify(over).slice(0, 80)).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    }
    expect(rowsFor(patientA.patientId)).toHaveLength(before);
    const ok = await enqueue(receptionistA.client, ownerA.tenantId, {
      p_visit_id: patientA.visitId,
      p_run_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      p_metadata: {
        visit_id: patientA.visitId,
        document_id: patientA.patientId,
        invoice_id: null,
        buttons: [{ id: "btn_view", text: "View", url: "https://app.example.test/r/x" }],
      },
    });
    expect(ok.error).toBeNull();
  });
});

describe("04-07a: a caller's dedupe key never pre-empts a system key (M-DEDUPE)", () => {
  let receptionistA2: SeededTenant;
  beforeAll(async () => {
    receptionistA2 = await addMemberToTenant(ownerA.tenantId, "receptionist");
  });

  const systemCancel = (visitId: string, key: string) =>
    getAdminClient().rpc("enqueue_message_system", {
      p_system_actor: "system:messaging_webhook",
      p_patient_id: null,
      p_visit_id: visitId,
      p_channel: "whatsapp",
      p_message_type: "appointment_cancelled",
      p_template_id: "appointment_cancelled",
      p_template_params: { patient_name: "Synthetic", reason: "Schedule conflict" },
      p_recipient_phone: null,
      p_recipient_user_id: null,
      p_metadata: {},
      p_dedupe_key: key,
    } as never) as unknown as Promise<{ data: { id: string; deduped: boolean } | null; error: { code: string; message: string } | null }>;

  it("a member who queues the real cancellation key first does not suppress the system's cancellation message", async () => {
    const realKey = `appointment_cancelled:${patientA.visitId}`;
    const squat = await enqueue(receptionistA.client, ownerA.tenantId, { p_visit_id: patientA.visitId, p_dedupe_key: realKey });
    expect(squat.error).toBeNull();
    expect(psql(`select dedupe_key from public.communication_queue where id = '${squat.data!.id}'`)).toEqual([
      `member:${receptionistA.userId}:${realKey}`,
    ]);

    const real = await systemCancel(patientA.visitId, realKey);
    expect(real.error).toBeNull();
    expect(real.data).toMatchObject({ deduped: false });
    expect(real.data!.id).not.toBe(squat.data!.id);
    expect(psql(`select template_id || '|' || dedupe_key from public.communication_queue where id = '${real.data!.id}'`)).toEqual([
      `appointment_cancelled|${realKey}`,
    ]);
    // The same for the SMS fallback key of a queue row.
    const fallbackKey = `msg-fallback:${real.data!.id}`;
    const squatFallback = await enqueue(receptionistA.client, ownerA.tenantId, { p_dedupe_key: fallbackKey });
    expect(squatFallback.data).toMatchObject({ deduped: false });
    expect(psql(`select count(*) from public.communication_queue where dedupe_key = '${fallbackKey}'`)).toEqual(["0"]);
  });

  it("two members' equal keys are two rows; the system path refuses the member namespace; a key over 150 characters is refused", async () => {
    const key = `share:${letters(10)}`;
    const a = await enqueue(receptionistA.client, ownerA.tenantId, { p_dedupe_key: key });
    const b = await enqueue(receptionistA2.client, ownerA.tenantId, { p_dedupe_key: key });
    expect(a.data).toMatchObject({ deduped: false });
    expect(b.data).toMatchObject({ deduped: false });
    expect(a.data!.id).not.toBe(b.data!.id);

    const forged = await systemCancel(patientA.visitId, `member:${receptionistA.userId}:${key}`);
    expect(forged.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });

    const long = await enqueue(receptionistA.client, ownerA.tenantId, { p_dedupe_key: "k".repeat(151) });
    expect(long.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
  });
});
