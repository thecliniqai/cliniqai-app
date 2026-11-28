/**
 * V2-08 08-03a (R-10, T-08-01; migration 000102), revised by 09E-04 (R-18; migration 000123): the live signals are private
 * broadcasts on `today:<tenant_id>`, one `{domain, version}` per clinic, domain and transaction.
 *
 * Proves over a real Realtime socket on the local stack: a visit, queue, invoice, payment or vitals change in clinic A reaches an
 * A member within 2 s with exactly the keys `domain` and `version` (no name, number, id or clinical value); it never reaches
 * clinic B's subscriber; B's member, an unauthenticated socket, a removed member and a member of a locked clinic cannot
 * join `today:<A>`; and a browser cannot send on the channel. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicEnv } from "@/lib/env";
import { addMemberToTenant, seedTenantSubscription, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { insertReturningId } from "../helpers/db";
import { seedVisit } from "../helpers/billing-commands";
import { seedClinicalNotes } from "../helpers/clinical-notes";
import { psql } from "../helpers/sql";

interface Signal {
  domain: string;
  version: number;
}

interface Listener {
  status: Promise<string>;
  signals: Signal[];
  raw: unknown[];
  channel: RealtimeChannel;
  client: SupabaseClient;
}

const SETTLE_MS = 3_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const live: Listener[] = [];

/** Joins `today:<tenant>` as a private channel with `client`; `status` settles with the first join outcome. */
async function listen(client: SupabaseClient, tenantId: string): Promise<Listener> {
  // supabase-js hands back the channel already open on a topic: close it so every case joins afresh.
  for (const open of client.getChannels().filter((c) => c.topic === `realtime:today:${tenantId}`)) await client.removeChannel(open);
  const channel = client.channel(`today:${tenantId}`, { config: { private: true } });
  const signals: Signal[] = [];
  const raw: unknown[] = [];
  channel.on("broadcast", { event: "today" }, (message) => {
    raw.push(message.payload);
    signals.push(message.payload as Signal);
  });
  const status = new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve("NO_ANSWER"), SETTLE_MS);
    channel.subscribe((s) => {
      if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
        clearTimeout(timer);
        resolve(s);
      }
    });
  });
  const listener = { status, signals, raw, channel, client };
  live.push(listener);
  return listener;
}

async function until(predicate: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await sleep(50);
  }
  return predicate();
}

/**
 * Realtime meters every broadcast of the project (every clinic, every topic) against one quota: its tenant's
 * `max_events_per_second` (100 on the local stack, the hosted Free plan's figure) averaged over the last 60 s (realtime
 * v2.140: twelve 5 s buckets). A `realtime.send` counts once and each delivery to a subscribed channel once more. Over
 * the quota, Realtime refuses every database broadcast ("UnableToBroadcastChanges: :too_many_requests" in its log) until
 * the average falls, and a subscribed channel is told nothing. The Vitest run is one file at a time, and a file that
 * writes thousands of visits just before this one (tests/security/guard-actions.spec.ts: about 6000 Today signals in
 * 35 s in the 09C gate run) leaves the window over the quota for up to a minute: there, every probe of `joined` was
 * refused, 1.5 s apart.
 */
const QUOTA_WINDOW = "65 seconds"; // the 60 s window plus the one 5 s bucket the counter may not have rolled yet

/**
 * 09E-14a (flake F6): messages stored for ONE clinic's topic since a database timestamp. The sliding-window count above is a level, not a counter: rows of the earlier
 * cases of this file age out of it while a later case runs, so a difference of two window counts can go negative (seen once in a 225-file run). A count since a fixed
 * instant only grows.
 */
function broadcastsSince(since: string, tenantId: string): number {
  return Number(psql(`select count(*) from realtime.messages where topic = 'today:${tenantId}' and inserted_at >= '${since}'`)[0]);
}

function broadcastsInWindow(): number {
  return Number(psql(`select count(*) from realtime.messages where inserted_at > now() - interval '${QUOTA_WINDOW}'`)[0]);
}

/**
 * Waits until the quota's window holds at most half of it, so this file's own signals (well under 300 events) are never
 * refused. Counted as the broadcasts stored in realtime.messages: nothing subscribes outside this file, so before it
 * every broadcast is one event. The wait is 0 after a quiet file and at most the window after a burst.
 */
async function realtimeQuotaHeadroom(): Promise<void> {
  const limits = psql("select max_events_per_second from _realtime.tenants");
  expect(limits, "one local Realtime tenant").toHaveLength(1);
  const budget = (Number(limits[0]) * 60) / 2;
  const end = Date.now() + 75_000;
  let recent = broadcastsInWindow();
  while (recent > budget) {
    if (Date.now() > end) {
      throw new Error(`Realtime's event quota stayed spent: ${recent} broadcasts in the last ${QUOTA_WINDOW}, budget ${budget}`);
    }
    await sleep(1_000);
    recent = broadcastsInWindow();
  }
}

/**
 * Waits until the channel is joined AND has delivered a signal. The join is answered (SUBSCRIBED) after its read policy
 * is checked, but the first join after the Realtime tenant was shut down (idle, or the local stack's "rebalancing" ten
 * minutes after each start) restarts the tenant's replication of realtime.messages and is answered before that stream
 * runs: a change committed in those few tens of milliseconds is never broadcast (seen: a visit stored 33 ms before the
 * replication slot was created). The board closes that gap by refreshing on every subscription. The probes are real
 * visits of the clinic, so the check is of the delivery path itself, not a pause.
 */
async function joined(listener: Listener, tenant: SeededTenant): Promise<void> {
  expect(await listener.status).toBe("SUBSCRIBED");
  for (let attempt = 0; attempt < 8; attempt++) {
    const seen = listener.signals.length;
    await seedVisit(tenant);
    if (await until(() => listener.signals.length > seen, 1_500)) return;
  }
  throw new Error(`the channel joined but never delivered a signal (${broadcastsInWindow()} broadcasts in the last ${QUOTA_WINDOW})`);
}

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let receptionistA: SeededTenant;
let nurseA: SeededTenant;
let lockedClinic: SeededTenant;
let lockedMember: SeededTenant;

beforeAll(async () => {
  // First, so a burst of the file before has drained before any case relies on delivery (bounded by its own 75 s).
  await realtimeQuotaHeadroom();
  tenantA = await seedTenantWithOwner("CI Realtime Clinic A");
  tenantB = await seedTenantWithOwner("CI Realtime Clinic B");
  receptionistA = await addMemberToTenant(tenantA.tenantId, "receptionist");
  nurseA = await addMemberToTenant(tenantA.tenantId, "nurse");
  lockedClinic = await seedTenantWithOwner("CI Realtime Locked Clinic");
  lockedMember = await addMemberToTenant(lockedClinic.tenantId, "receptionist");
  await seedTenantSubscription(lockedClinic.tenantId, { status: "expired" });
}, 120_000);

afterAll(async () => {
  for (const l of live) await l.client.removeChannel(l.channel);
});

/** The version the database holds for one domain of a clinic (the signal carries it). */
function versionOf(tenantId: string, domain: string): number {
  return Number(psql(`select version from public.clinic_versions where tenant_id = '${tenantId}' and domain = '${domain}'`)[0]);
}

const SIGNAL_KEYS = ["domain", "version"];
const payloadKeys = (payload: unknown) => Object.keys(payload as object).filter((k) => k !== "id").sort();

describe("today signals: delivery to the clinic's own members", () => {
  it("a new visit reaches a receptionist and a nurse of the clinic within 2 s as {domain, version} for queue and schedule", async () => {
    const reception = await listen(receptionistA.client, tenantA.tenantId);
    const nurse = await listen(nurseA.client, tenantA.tenantId);
    await joined(reception, tenantA);
    await joined(nurse, tenantA);
    const queueBefore = versionOf(tenantA.tenantId, "queue");
    const scheduleBefore = versionOf(tenantA.tenantId, "schedule");

    const started = Date.now();
    await seedVisit(tenantA);
    for (const l of [reception, nurse]) {
      expect(await until(() => l.signals.some((s) => s.domain === "queue" && s.version === queueBefore + 1), 2_000)).toBe(true);
      expect(await until(() => l.signals.some((s) => s.domain === "schedule" && s.version === scheduleBefore + 1), 2_000)).toBe(true);
    }
    expect(Date.now() - started).toBeLessThan(4_000);

    // Realtime adds the message's own random id to the payload it delivers; the trigger sends domain and version only
    // (the stored rows are checked key by key in supabase/tests/database/clinic_versions.test.sql).
    for (const payload of reception.raw) expect(payloadKeys(payload)).toEqual(SIGNAL_KEYS);
  });

  it("a queue token, a vitals change, an invoice, a total and a payment each signal their domain, each carrying the database's version", async () => {
    const admin = getAdminClient();
    const { visitId, patientId } = await seedVisit(tenantA);
    const listener = await listen(receptionistA.client, tenantA.tenantId);
    await joined(listener, tenantA);
    // Each call below is its own transaction, so each raises its domain by exactly one and sends exactly one signal.
    const expectNext = async (domain: string, write: () => Promise<unknown>) => {
      const before = versionOf(tenantA.tenantId, domain);
      await write();
      expect(await until(() => listener.signals.some((s) => s.domain === domain && s.version === before + 1), 2_000), `${domain} ${before + 1}`).toBe(true);
      expect(versionOf(tenantA.tenantId, domain)).toBe(before + 1);
    };

    await expectNext("queue", () =>
      insertReturningId(admin, "queue_tokens", {
        tenant_id: tenantA.tenantId,
        visit_id: visitId,
        token_number: 1,
        date: new Date().toISOString().slice(0, 10),
        priority: "normal",
      })
    );
    await expectNext("queue", () => seedClinicalNotes(visitId, { vitals: { pulse: 72 } }));
    let invoice = "";
    await expectNext("billing", async () => {
      invoice = await insertReturningId(admin, "invoices", {
        tenant_id: tenantA.tenantId,
        visit_id: visitId,
        patient_id: patientId,
        invoice_number: `RT-${randomUUID().slice(0, 8)}`,
        total_amount: 500,
      });
    });
    await expectNext("billing", async () => {
      await admin.from("invoices").update({ total_amount: 650 }).eq("id", invoice);
    });
    await expectNext("billing", async () => {
      const paid = await admin.from("payments").insert({
        tenant_id: tenantA.tenantId,
        invoice_id: invoice,
        amount: 500,
        payment_method: "cash",
        recorded_by: tenantA.userId,
      });
      expect(paid.error?.message).toBeUndefined();
    });

    for (const payload of listener.raw) expect(payloadKeys(payload)).toEqual(SIGNAL_KEYS);
  });

  it("a write that changes none of the watched columns sends nothing", async () => {
    const { visitId } = await seedVisit(tenantA);
    const listener = await listen(receptionistA.client, tenantA.tenantId);
    await joined(listener, tenantA);
    const before = listener.signals.length;
    const versions = ["queue", "schedule", "billing", "settings"].map((d) => versionOf(tenantA.tenantId, d));
    await getAdminClient().from("visits").update({ reason_for_visit: "synthetic reason" }).eq("id", visitId);
    await sleep(1_000);
    expect(listener.signals.length).toBe(before);
    expect(["queue", "schedule", "billing", "settings"].map((d) => versionOf(tenantA.tenantId, d))).toEqual(versions);
  });

  it("a 50-row insert in one transaction delivers one signal per domain, not 50 (B-11, the quota)", async () => {
    const { patientId } = await seedVisit(tenantA);
    const listener = await listen(receptionistA.client, tenantA.tenantId);
    await joined(listener, tenantA);
    const queueBefore = versionOf(tenantA.tenantId, "queue");
    const seen = listener.signals.length;
    const since = psql("select clock_timestamp()")[0];
    // One psql -c is one statement in one transaction: 50 visits of the clinic.
    psql(
      `insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, created_by, is_overbooked, scheduled_at)
       select '${tenantA.tenantId}', '${patientId}', '${tenantA.userId}', 'scheduled', '${tenantA.userId}', true, now() + g * interval '1 minute'
         from generate_series(1, 50) g`
    );
    expect(await until(() => listener.signals.length >= seen + 2, 2_000)).toBe(true);
    await sleep(1_000);
    const got = listener.signals.slice(seen);
    expect(got.map((s) => s.domain).sort()).toEqual(["queue", "schedule"]);
    expect(got.find((s) => s.domain === "queue")?.version).toBe(queueBefore + 1);
    expect(broadcastsSince(since, tenantA.tenantId)).toBe(2);
  });

  it("two transactions raise a version by two and deliver two signals", async () => {
    const { visitId } = await seedVisit(tenantA);
    const listener = await listen(receptionistA.client, tenantA.tenantId);
    await joined(listener, tenantA);
    const before = versionOf(tenantA.tenantId, "schedule");
    const admin = getAdminClient();
    await admin.from("visits").update({ estimated_duration_minutes: 35 }).eq("id", visitId);
    await admin.from("visits").update({ estimated_duration_minutes: 40 }).eq("id", visitId);
    expect(await until(() => listener.signals.some((s) => s.domain === "schedule" && s.version === before + 2), 2_000)).toBe(true);
    expect(versionOf(tenantA.tenantId, "schedule")).toBe(before + 2);
    expect(listener.signals.filter((s) => s.domain === "schedule" && s.version > before).map((s) => s.version)).toEqual([before + 1, before + 2]);
  });
});

describe("today signals: isolation", () => {
  it("clinic A's changes never reach clinic B's own subscriber", async () => {
    const own = await listen(tenantB.client, tenantB.tenantId);
    await joined(own, tenantB);
    const seen = own.signals.length;
    await seedVisit(tenantA);
    await sleep(1_500);
    expect(own.signals.length).toBe(seen);
    // The control: B's own change does arrive.
    const before = versionOf(tenantB.tenantId, "queue");
    await seedVisit(tenantB);
    expect(await until(() => own.signals.some((s) => s.domain === "queue" && s.version === before + 1), 2_000)).toBe(true);
  });

  it("a member of clinic B cannot join today:<A> and receives nothing from it", async () => {
    const intruder = await listen(tenantB.client, tenantA.tenantId);
    expect(await intruder.status).not.toBe("SUBSCRIBED");
    await seedVisit(tenantA);
    await sleep(1_500);
    expect(intruder.signals).toHaveLength(0);
  });

  it("an unauthenticated socket cannot join a private today channel", async () => {
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const listener = await listen(anon, tenantA.tenantId);
    expect(await listener.status).not.toBe("SUBSCRIBED");
    await seedVisit(tenantA);
    await sleep(1_000);
    expect(listener.signals).toHaveLength(0);
  });

  it("a topic that is not today:<uuid> of the member's clinic is refused (other shapes, upper case, a wildcard)", { timeout: 40_000 }, async () => {
    // Its own member: a socket that was refused a join is not reused by the other cases.
    const prober = await addMemberToTenant(tenantA.tenantId, "receptionist");
    for (const topic of [`today:${tenantA.tenantId.toUpperCase()}`, "today:*", "today:", `today:${tenantA.tenantId}:x`, `other:${tenantA.tenantId}`]) {
      const channel = prober.client.channel(topic, { config: { private: true } });
      const outcome = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve("NO_ANSWER"), SETTLE_MS);
        channel.subscribe((s) => {
          if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
            clearTimeout(timer);
            resolve(s);
          }
        });
      });
      expect(outcome, topic).not.toBe("SUBSCRIBED");
      await prober.client.removeChannel(channel);
    }
  });

  it("a member of a locked clinic cannot join its channel", async () => {
    const listener = await listen(lockedMember.client, lockedClinic.tenantId);
    expect(await listener.status).not.toBe("SUBSCRIBED");
  });

  it("a removed member cannot join the channel they could join before", async () => {
    const leaver = await addMemberToTenant(tenantA.tenantId, "receptionist");
    const before = await listen(leaver.client, tenantA.tenantId);
    await joined(before, tenantA);
    await leaver.client.removeChannel(before.channel);

    const { error } = await getAdminClient()
      .from("memberships")
      .update({ status: "removed", removed_at: new Date().toISOString() })
      .eq("tenant_id", tenantA.tenantId)
      .eq("user_id", leaver.userId);
    expect(error).toBeNull();

    const after = await listen(leaver.client, tenantA.tenantId);
    expect(await after.status).not.toBe("SUBSCRIBED");
  });

  it("a member cannot send on the channel: there is no INSERT policy for authenticated", async () => {
    const sender = await listen(receptionistA.client, tenantA.tenantId);
    const watcher = await listen(nurseA.client, tenantA.tenantId);
    expect(await sender.status).toBe("SUBSCRIBED");
    await joined(watcher, tenantA);
    const forged = 987_654_321;
    await sender.channel.send({ type: "broadcast", event: "today", payload: { domain: "queue", version: forged } });
    await sleep(1_500);
    expect(watcher.signals.some((s) => s.version === forged)).toBe(false);
  });
});
