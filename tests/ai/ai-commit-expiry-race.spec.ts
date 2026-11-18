/**
 * V2-05 05b gate close, re-verification N-1 (Low; `reviews/v205b-review-reverify.md` "M-AIEXP … residual N-1").
 *
 * `ai_commit` must decide whether a reservation expired AFTER it holds the clinic's usage-row lock (the lock
 * `ai_reserve` takes before it counts live reservations) and at the wall clock, not at its transaction start. Here a
 * second session holds that row lock; the doctor's commit arrives while the reservation is still live, waits on the
 * lock, and is let through only after the reservation expired. Before 000094 the commit locked the reservation,
 * compared `expires_at` with `now()` (passed), and only then waited for the usage row: it landed a unit for a
 * reservation that `ai_reserve` had stopped counting meanwhile (the reviewer's 1,501). Now it is refused with
 * AI_RESERVATION_EXPIRED and the period stays at 1,499, so the next reservation ends at exactly 1,500.
 *
 * Real PostgREST session for the doctor; the lock holder is a superuser psql session (no API role can touch the usage
 * table). Local stack only; synthetic data.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mapDbError } from "@/lib/db/errors";
import type { TestDb } from "../helpers/db";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql, psqlAsync } from "../helpers/sql";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

const TRIAL_LIMIT = 1500;

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
const rpc = (client: TestDb): Rpc => client.rpc.bind(client) as unknown as Rpc;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function uuid(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new Error("not a uuid");
  return v;
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("ai_commit after the usage-row lock, at the wall clock (re-verification N-1)", () => {
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let visitId = "";
  let period = "";

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Synthetic AI Expiry Race ${randomUUID().slice(0, 6)}`);
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    const admin = getAdminClient();
    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic AI Race Patient", phone: "+919000000898", created_by: owner.userId })
      .select("id")
      .single();
    if (pErr || !patient) throw new Error(`patient seed failed: ${pErr?.code}`);
    const { data: visit, error: vErr } = await admin
      .from("visits")
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patient.id,
        doctor_id: doctor.userId,
        origin_type: "walk_in",
        status: "in_consultation",
        estimated_duration_minutes: 15,
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (vErr || !visit) throw new Error(`visit seed failed: ${vErr?.code}`);
    visitId = visit.id;

    const { error: optErr } = await rpc(owner.client)("set_ai_opt_in", { p_tenant: owner.tenantId, p_enabled: true, p_terms_version: "2026-11" });
    expect(optErr).toBeNull();
    expect(psql("select (ai_features -> 'ai.scribe')::text from public.platform_settings where id")).toEqual(["true"]);
    // The period the database meters this clinic in (000092: the IST date of the stored trial start).
    [period] = psql(`select private.ai_period('${uuid(owner.tenantId)}', now())`);
    expect(period).toMatch(/^trial:\d{4}-\d{2}-\d{2}$/);
  });

  function setUsage(units: number): void {
    psql(
      `delete from public.ai_quota_reservations where tenant_id = '${uuid(owner.tenantId)}';
       insert into public.ai_usage_monthly (tenant_id, period, feature, units) values ('${uuid(owner.tenantId)}', '${period}', 'ai.scribe', ${units})
       on conflict (tenant_id, period, feature) do update set units = excluded.units`,
    );
  }
  function units(): string {
    const [u] = psql(`select units from public.ai_usage_monthly where tenant_id = '${uuid(owner.tenantId)}' and period = '${period}' and feature = 'ai.scribe'`);
    return u;
  }

  it("a commit that arrives while the reservation is live but gets the usage row only after expiry is refused; the period ends at exactly 1,500", async () => {
    setUsage(TRIAL_LIMIT - 1);
    const reserved = await rpc(doctor.client)("ai_reserve", { p_feature: "ai.scribe", p_visit_id: visitId, p_timeout_s: 60 });
    expect(reserved.error).toBeNull();
    const reservation = uuid(reserved.data);

    // Another session holds the usage row (as ai_reserve does while it counts) for 3 s.
    const app = `n1_race_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const holder = psqlAsync(
      `set application_name = '${app}';
       begin;
       select 1 from public.ai_usage_monthly where tenant_id = '${uuid(owner.tenantId)}' and period = '${period}' and feature = 'ai.scribe' for update;
       select pg_sleep(3);
       commit;`,
    );
    await waitFor(
      () => psql(`select count(*) from pg_stat_activity where application_name = '${app}' and wait_event = 'PgSleep'`)[0] === "1",
      "the lock holder",
    );

    // The reservation now lives one more second; the commit is sent at once.
    psql(`update public.ai_quota_reservations set expires_at = clock_timestamp() + interval '1 second' where id = '${reservation}'`);
    const commit = Promise.resolve(rpc(doctor.client)("ai_commit", { p_reservation: reservation }));

    // Evidence of the race: while the reservation was still live, the commit was already waiting on a lock.
    let waitingWhileLive = false;
    await waitFor(() => {
      const [row] = psql(
        `select (select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%ai_commit%')::text
                || '|' || (clock_timestamp() < (select expires_at from public.ai_quota_reservations where id = '${reservation}'))::text`,
      );
      if (row === "1|true") waitingWhileLive = true;
      return row.startsWith("1|");
    }, "the commit to wait on the lock");
    expect(waitingWhileLive).toBe(true);

    await holder;
    const result = await commit;
    expect(result.error).toMatchObject({ code: "P0001", message: "AI_RESERVATION_EXPIRED" });
    expect(mapDbError(result.error!)).toMatchObject({ code: "CONFLICT", reason: "AI_RESERVATION_EXPIRED" });
    expect(units()).toBe(String(TRIAL_LIMIT - 1));

    // The unit the expired reservation held is free again; the next reservation fills the period to exactly 1,500.
    const next = await rpc(doctor.client)("ai_reserve", { p_feature: "ai.scribe", p_visit_id: visitId, p_timeout_s: 60 });
    expect(next.error).toBeNull();
    const committed = await rpc(doctor.client)("ai_commit", { p_reservation: uuid(next.data) });
    expect(committed).toMatchObject({ data: TRIAL_LIMIT, error: null });
    const over = await rpc(doctor.client)("ai_reserve", { p_feature: "ai.scribe", p_visit_id: visitId, p_timeout_s: 60 });
    expect(over.error).toMatchObject({ code: "P0001", message: "AI_OVER_QUOTA" });
    expect(units()).toBe(String(TRIAL_LIMIT));
  });

  it("control: a commit that waits on the lock and gets it while the reservation is still live lands exactly one unit", async () => {
    setUsage(TRIAL_LIMIT - 1);
    const reserved = await rpc(doctor.client)("ai_reserve", { p_feature: "ai.scribe", p_visit_id: visitId, p_timeout_s: 60 });
    expect(reserved.error).toBeNull();
    const app = `n1_ctrl_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const holder = psqlAsync(
      `set application_name = '${app}';
       begin;
       select 1 from public.ai_usage_monthly where tenant_id = '${uuid(owner.tenantId)}' and period = '${period}' and feature = 'ai.scribe' for update;
       select pg_sleep(1);
       commit;`,
    );
    await waitFor(
      () => psql(`select count(*) from pg_stat_activity where application_name = '${app}' and wait_event = 'PgSleep'`)[0] === "1",
      "the lock holder",
    );
    const commit = Promise.resolve(rpc(doctor.client)("ai_commit", { p_reservation: uuid(reserved.data) }));
    await holder;
    expect(await commit).toMatchObject({ data: TRIAL_LIMIT, error: null });
    expect(units()).toBe(String(TRIAL_LIMIT));
  });
});
