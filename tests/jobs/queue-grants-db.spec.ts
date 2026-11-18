/**
 * V2-04 04-03c contract step (migration 000038; R-38; closes V2-03 M-XTENANT-WH "revoke direct queue writes"; T-04-05,
 * T-04-06, T-04-25). On the live local stack, through real member sessions and the catalogue.
 *
 * - A member cannot INSERT into `communication_queue` or call `communication_queue_claim` / `_finish` (42501).
 * - An owner cannot INSERT a `webhook_delivery_queue` row naming its own subscription, nor UPDATE a row's `status`,
 *   `max_retries` or `retry_count` (the review E-8 knobs), nor DELETE one (42501), while `listDeliveryLogs` still returns
 *   the clinic's rows (SELECT policy).
 * - Catalogue: `anon` holds no privilege on either table (table or column level); `authenticated` holds SELECT only;
 *   every policy on them is FOR SELECT; no API role may execute the queue's claim/finish/dead-letter/delivery-report/
 *   inbound-dedupe functions.
 * - The enqueue RPCs still work for members.
 * - The migration's own contract assertion is live: with an INSERT grant put back (inside a rolled-back session), the
 *   same assertion block raises.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { listDeliveryLogs } from "@/features/webhooks/service";
import { enqueueMessage, enqueueWebhookEvent } from "@/lib/jobs/enqueue";
import { ctxFor } from "../helpers/context";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { psql, psqlSession } from "../helpers/sql";
import { letters } from "./helpers";
import { seedPatient, type SeededPatient } from "./message-helpers";
import { insertDelivery, subscribe } from "./webhook-helpers";

const ROOT = path.resolve(__dirname, "../..");
const TABLES = ["public.communication_queue", "public.webhook_delivery_queue"];
const WRITE_PRIVILEGES = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

let owner: SeededTenant;
let receptionist: SeededTenant;
let patient: SeededPatient;
let subscriptionId: string;
let deliveryId: string;

type Client = SeededTenant["client"];
// The forged writes below are untyped on purpose (they must be refused whatever their shape).
const from = (client: Client, table: string) => (client as unknown as { from: (t: string) => any }).from(table); // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = (client: Client, fn: string, args: Record<string, unknown>) =>
  (client.rpc as unknown as (f: string, a: unknown) => Promise<{ error: { code?: string } | null }>)(fn, args);

beforeAll(async () => {
  owner = await seedTenantWithOwner(`Queue Contract ${letters(6)}`);
  receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  patient = await seedPatient(owner.tenantId, owner.userId);
  const sub = await subscribe(owner.tenantId, owner.userId, ["prescription.issued"]);
  subscriptionId = sub.id;
  deliveryId = await insertDelivery(owner.tenantId, subscriptionId);
});

describe("members cannot write the queues (42501)", () => {
  it("a member inserting into communication_queue is refused", async () => {
    for (const member of [receptionist, owner]) {
      const { error } = await from(member.client, "communication_queue").insert({
        tenant_id: owner.tenantId,
        patient_id: patient.patientId,
        channel: "whatsapp",
        message_type: "appointment_booked",
        template_id: "appointment_booked",
        recipient_phone: "+919000000077",
      });
      expect(error?.code).toBe("42501");
    }
  });

  it("a member calling communication_queue_claim / _finish is refused", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect((await rpc(receptionist.client, "communication_queue_claim", { p_id: id })).error?.code).toBe("42501");
    expect(
      (await rpc(receptionist.client, "communication_queue_finish", { p_id: id, p_success: true, p_external_message_id: null, p_error: null }))
        .error?.code
    ).toBe("42501");
  });

  it("an owner cannot insert a delivery row naming its own subscription, nor edit or delete one", async () => {
    const { error: insertError } = await from(owner.client, "webhook_delivery_queue").insert({
      tenant_id: owner.tenantId,
      subscription_id: subscriptionId,
      event_type: "prescription.issued",
      payload: JSON.stringify({ forged: true }),
      status: "pending",
    });
    expect(insertError?.code).toBe("42501");
    for (const patch of [{ status: "pending" }, { max_retries: 50 }, { retry_count: 0 }]) {
      const { error } = await from(owner.client, "webhook_delivery_queue").update(patch).eq("id", deliveryId);
      expect(error?.code, JSON.stringify(patch)).toBe("42501");
    }
    const { error: deleteError } = await from(owner.client, "webhook_delivery_queue").delete().eq("id", deliveryId);
    expect(deleteError?.code).toBe("42501");
    expect(psql(`select count(*) from public.webhook_delivery_queue where id = '${deliveryId}'`)).toEqual(["1"]);
  });

  it("the delivery log still reads the clinic's rows (SELECT policy)", async () => {
    const result = await listDeliveryLogs(ctxFor(owner), subscriptionId);
    expect(result.success).toBe(true);
    expect(result.logs.map((l) => (l as { id: string }).id)).toContain(deliveryId);
  });

  it("the enqueue RPCs still work for members", async () => {
    // A template the receptionist's permissions allow (billing:view; 05-11b IND L4: lab reports need labs:view).
    const queued = await enqueueMessage(ctxFor(receptionist), {
      patientId: patient.patientId,
      channel: "whatsapp",
      messageType: "receipt_issued",
      templateId: "receipt_issued",
    });
    expect(queued.status).toBe("pending");
    const ping = await enqueueWebhookEvent(ctxFor(owner), "ping", subscriptionId);
    expect(ping.queued).toBe(1);
  });
});

describe("catalogue: the contract holds", () => {
  it("anon holds no privilege on either queue table (table or column level)", () => {
    for (const table of TABLES) {
      for (const priv of ["SELECT", ...WRITE_PRIVILEGES]) {
        expect(psql(`select has_table_privilege('anon', '${table}', '${priv}')`), `${table} ${priv}`).toEqual(["f"]);
      }
      for (const priv of ["SELECT", "INSERT", "UPDATE", "REFERENCES"]) {
        expect(psql(`select has_any_column_privilege('anon', '${table}', '${priv}')`), `${table} column ${priv}`).toEqual(["f"]);
      }
    }
  });

  it("authenticated holds SELECT only (no write privilege at table or column level)", () => {
    for (const table of TABLES) {
      // SELECT on the status columns (communication_queue, AR3-N1) or the table (webhook_delivery_queue, owner/admin RLS).
      expect(psql(`select has_any_column_privilege('authenticated', '${table}', 'SELECT')`)).toEqual(["t"]);
      for (const priv of WRITE_PRIVILEGES) {
        expect(psql(`select has_table_privilege('authenticated', '${table}', '${priv}')`), `${table} ${priv}`).toEqual(["f"]);
      }
      for (const priv of ["INSERT", "UPDATE", "REFERENCES"]) {
        expect(psql(`select has_any_column_privilege('authenticated', '${table}', '${priv}')`), `${table} column ${priv}`).toEqual(["f"]);
      }
    }
  });

  it("every policy on the queue tables is FOR SELECT", () => {
    expect(
      psql(
        "select tablename || ':' || cmd from pg_policies where schemaname = 'public' " +
          "and tablename in ('communication_queue', 'webhook_delivery_queue') order by 1"
      )
    ).toEqual(["communication_queue:SELECT", "webhook_delivery_queue:SELECT"]);
  });

  it("no API role may execute the queue's claim, finish, dead-letter, delivery-report or inbound functions", () => {
    const rows = psql(
      "select p.proname || ':' || r from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public' " +
        "cross join unnest(array['anon', 'authenticated']) as r " +
        "where p.proname in ('communication_queue_claim', 'communication_queue_finish', 'communication_queue_dead_letter', " +
        "'communication_queue_apply_dlr', 'webhook_delivery_claim', 'webhook_delivery_finish', 'inbound_webhook_begin', " +
        "'inbound_webhook_finish', 'enqueue_unmatched_reply_system', 'enqueue_message_system', 'enqueue_webhook_event_system') " +
        "and has_function_privilege(r, p.oid, 'EXECUTE')"
    );
    expect(rows).toEqual([]);
  });

  it("the migration's contract assertion raises when a write privilege is put back (rolled back)", () => {
    const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/000038_queue_contract.sql"), "utf8");
    const start = sql.indexOf("DO $$\nDECLARE\n    v_bad TEXT;");
    const end = sql.indexOf("END;\n$$;", start) + "END;\n$$;".length;
    expect(start).toBeGreaterThan(0);
    const assertion = sql.slice(start, end);
    // The block passes on the migrated database …
    expect(() => psqlSession(["begin", assertion, "rollback"])).not.toThrow();
    // … and fails once a member write is granted again.
    expect(() =>
      psqlSession(["begin", "grant insert on public.communication_queue to authenticated", assertion, "rollback"])
    ).toThrow(/queue contract: privilege left: public\.communication_queue:authenticated:INSERT/);
    expect(() =>
      psqlSession(["begin", "grant execute on function public.webhook_delivery_claim(uuid) to authenticated", assertion, "rollback"])
    ).toThrow(/queue contract: API role may execute/);
    // Nothing leaked out of the rolled-back sessions.
    expect(psql("select has_table_privilege('authenticated', 'public.communication_queue', 'INSERT')")).toEqual(["f"]);
  });
});
