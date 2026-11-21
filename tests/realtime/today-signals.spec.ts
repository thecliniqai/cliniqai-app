/**
 * V2-08 08-03a (R-10, T-08-01; migration 000102): the Today signals are private broadcasts on `today:<tenant_id>`.
 *
 * Proves over a real Realtime socket on the local stack: a visit, queue, payment or vitals change in clinic A reaches an
 * A member within 2 s with exactly the keys `kind` and `visit_id` (no name, number or clinical value); it never reaches
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

interface Signal {
  kind: string;
  visit_id: string;
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
 * Waits until the channel is joined AND has delivered a signal. Realtime acknowledges the join (SUBSCRIBED) before the
 * read authorization of a private channel has necessarily taken effect for broadcasts, so a change committed in the
 * first few milliseconds can be missed (seen once under load; the board closes that gap by refreshing on every
 * subscription). The probes are real visits of the clinic, so the check is of the delivery path itself, not a pause.
 */
async function joined(listener: Listener, tenant: SeededTenant): Promise<void> {
  expect(await listener.status).toBe("SUBSCRIBED");
  for (let attempt = 0; attempt < 8; attempt++) {
    const seen = listener.signals.length;
    await seedVisit(tenant);
    if (await until(() => listener.signals.length > seen, 1_500)) return;
  }
  throw new Error("the channel joined but never delivered a signal");
}

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let receptionistA: SeededTenant;
let nurseA: SeededTenant;
let lockedClinic: SeededTenant;
let lockedMember: SeededTenant;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Realtime Clinic A");
  tenantB = await seedTenantWithOwner("CI Realtime Clinic B");
  receptionistA = await addMemberToTenant(tenantA.tenantId, "receptionist");
  nurseA = await addMemberToTenant(tenantA.tenantId, "nurse");
  lockedClinic = await seedTenantWithOwner("CI Realtime Locked Clinic");
  lockedMember = await addMemberToTenant(lockedClinic.tenantId, "receptionist");
  await seedTenantSubscription(lockedClinic.tenantId, { status: "expired" });
});

afterAll(async () => {
  for (const l of live) await l.client.removeChannel(l.channel);
});

describe("today signals: delivery to the clinic's own members", () => {
  it("a new visit reaches a receptionist and a nurse of the clinic within 2 s with exactly {kind, visit_id}", async () => {
    const reception = await listen(receptionistA.client, tenantA.tenantId);
    const nurse = await listen(nurseA.client, tenantA.tenantId);
    await joined(reception, tenantA);
    await joined(nurse, tenantA);

    const started = Date.now();
    const { visitId } = await seedVisit(tenantA);
    expect(await until(() => reception.signals.some((s) => s.visit_id === visitId), 2_000)).toBe(true);
    expect(await until(() => nurse.signals.some((s) => s.visit_id === visitId), 2_000)).toBe(true);
    expect(Date.now() - started).toBeLessThan(4_000);

    // Realtime adds the message's own random id to the payload it delivers; the trigger sends kind and visit_id only
    // (the stored rows are checked key by key in supabase/tests/database/today_signals.test.sql).
    const signal = reception.raw.find((p) => (p as Signal).visit_id === visitId) as Record<string, unknown>;
    expect(Object.keys(signal).filter((k) => k !== "id").sort()).toEqual(["kind", "visit_id"]);
    expect(signal.kind).toBe("visit");
  });

  it("a status change, a queue token, an invoice, a payment and a vitals change each send a signal for the visit", async () => {
    const admin = getAdminClient();
    const { visitId, patientId } = await seedVisit(tenantA);
    const listener = await listen(receptionistA.client, tenantA.tenantId);
    await joined(listener, tenantA);
    const kinds = () => listener.signals.filter((s) => s.visit_id === visitId).map((s) => s.kind);

    const token = await insertReturningId(admin, "queue_tokens", {
      tenant_id: tenantA.tenantId,
      visit_id: visitId,
      token_number: 1,
      date: new Date().toISOString().slice(0, 10),
      priority: "normal",
    });
    expect(await until(() => kinds().includes("queue"), 2_000)).toBe(true);

    await admin.from("visits").update({ status: "waiting" }).eq("id", visitId).eq("tenant_id", tenantA.tenantId);
    expect(await until(() => kinds().includes("visit"), 2_000)).toBe(true);

    await seedClinicalNotes(visitId, { vitals: { pulse: 72 } });
    expect(await until(() => kinds().includes("vitals"), 2_000)).toBe(true);

    const invoice = await insertReturningId(admin, "invoices", {
      tenant_id: tenantA.tenantId,
      visit_id: visitId,
      patient_id: patientId,
      invoice_number: `RT-${randomUUID().slice(0, 8)}`,
      total_amount: 500,
    });
    // V2-08 08-06a (A-5): a new invoice and a change of its total signal the Today board (another desk's amount and lane).
    expect(await until(() => kinds().includes("invoice"), 2_000)).toBe(true);
    const invoiceSignals = () => kinds().filter((k) => k === "invoice").length;
    const before = invoiceSignals();
    await admin.from("invoices").update({ total_amount: 650 }).eq("id", invoice);
    expect(await until(() => invoiceSignals() > before, 2_000)).toBe(true);
    const paid = await admin.from("payments").insert({
      tenant_id: tenantA.tenantId,
      invoice_id: invoice,
      amount: 500,
      payment_method: "cash",
      recorded_by: tenantA.userId,
    });
    expect(paid.error?.message).toBeUndefined();
    expect(await until(() => kinds().includes("payment"), 2_000)).toBe(true);
    expect(token).toBeTruthy();

    for (const payload of listener.raw.filter((p) => (p as Signal).visit_id === visitId)) {
      expect(Object.keys(payload as object).filter((k) => k !== "id").sort()).toEqual(["kind", "visit_id"]);
    }
  });

  it("a write that changes none of the watched columns sends nothing", async () => {
    const { visitId } = await seedVisit(tenantA);
    const listener = await listen(receptionistA.client, tenantA.tenantId);
    await joined(listener, tenantA);
    const before = listener.signals.filter((s) => s.visit_id === visitId).length;
    await getAdminClient().from("visits").update({ reason_for_visit: "synthetic reason" }).eq("id", visitId);
    await sleep(1_000);
    expect(listener.signals.filter((s) => s.visit_id === visitId).length).toBe(before);
  });
});

describe("today signals: isolation", () => {
  it("clinic A's changes never reach clinic B's own subscriber", async () => {
    const own = await listen(tenantB.client, tenantB.tenantId);
    await joined(own, tenantB);
    const { visitId } = await seedVisit(tenantA);
    await sleep(1_500);
    expect(own.signals.some((s) => s.visit_id === visitId)).toBe(false);
    // The control: B's own change does arrive.
    const mine = await seedVisit(tenantB);
    expect(await until(() => own.signals.some((s) => s.visit_id === mine.visitId), 2_000)).toBe(true);
  });

  it("a member of clinic B cannot join today:<A> and receives nothing from it", async () => {
    const intruder = await listen(tenantB.client, tenantA.tenantId);
    expect(await intruder.status).not.toBe("SUBSCRIBED");
    const { visitId } = await seedVisit(tenantA);
    await sleep(1_500);
    expect(intruder.signals.some((s) => s.visit_id === visitId)).toBe(false);
  });

  it("an unauthenticated socket cannot join a private today channel", async () => {
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const listener = await listen(anon, tenantA.tenantId);
    expect(await listener.status).not.toBe("SUBSCRIBED");
    const { visitId } = await seedVisit(tenantA);
    await sleep(1_000);
    expect(listener.signals.some((s) => s.visit_id === visitId)).toBe(false);
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
    const forged = randomUUID();
    await sender.channel.send({ type: "broadcast", event: "today", payload: { kind: "visit", visit_id: forged } });
    await sleep(1_500);
    expect(watcher.signals.some((s) => s.visit_id === forged)).toBe(false);
  });
});
