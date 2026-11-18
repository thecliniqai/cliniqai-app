/**
 * V2-05 05-10c (AI-03 database part; roadmap V2-05 test "concurrency tests for … `ai_reserve`"; AI §4.6 quota; threat
 * T-05-37). With a clinic's usage at limit − 1, two `ai_reserve` calls made at the same time through PostgREST (two
 * signed-in sessions, two transactions) give exactly one reservation id and one `AI_OVER_QUOTA`: the usage row is
 * locked (`SELECT … FOR UPDATE`) before live reservations are counted. Repeated for several rounds so an unlocked
 * read-then-insert would let both through at least once (the mutant run in the 05-10c evidence shows it does).
 *
 * The refusal reaches the app as a typed error: `mapDbError` maps the raised reason to PRECONDITION_FAILED with reason
 * AI_OVER_QUOTA (RPC_REASON_CODES), and a locked clinic's AI_LOCKED to SUBSCRIPTION_LOCKED. The owner opts the clinic in
 * through `set_ai_opt_in` (the real path). Local stack only; synthetic data.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mapDbError } from "@/lib/db/errors";
import type { TestDb } from "../helpers/db";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

const ROUNDS = 8;
const TRIAL_LIMIT = 1500;

// Untyped RPC access: the generated types know the functions, but the spec passes them through one helper.
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
const rpc = (client: TestDb): Rpc => client.rpc.bind(client) as unknown as Rpc;

describe("ai_reserve under concurrency (05-10c)", () => {
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let visitId = "";
  let period = "";

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Synthetic AI Concurrency ${randomUUID().slice(0, 6)}`);
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    const admin = getAdminClient();
    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic AI Patient", phone: "+919000000899", created_by: owner.userId })
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

    // The owner opts in through the owner-only RPC (R-33).
    const { error: optErr } = await rpc(owner.client)("set_ai_opt_in", {
      p_tenant: owner.tenantId,
      p_enabled: true,
      p_terms_version: "2026-11",
    });
    expect(optErr).toBeNull();
    // The kill switch is open for ai.scribe in the seed (000084); assert rather than change shared settings.
    expect(psql("select (ai_features -> 'ai.scribe')::text from public.platform_settings where id")).toEqual(["true"]);

    // The trial period key, as the database derives it (trialing: trial:<clinic-local date of trial_start>).
    [period] = psql(
      `select 'trial:' || to_char(public.tenant_local_date(s.tenant_id, s.trial_start), 'YYYY-MM-DD')
         from public.tenant_subscriptions s where s.tenant_id = '${owner.tenantId}' and s.status = 'trialing'`,
    );
    expect(period).toMatch(/^trial:\d{4}-\d{2}-\d{2}$/);
  });

  /** Usage at `units` for the trial period and no reservation (as postgres; no API role can write these tables). */
  function resetUsage(units: number): void {
    psql(
      `delete from public.ai_quota_reservations where tenant_id = '${owner.tenantId}';
       insert into public.ai_usage_monthly (tenant_id, period, feature, units) values ('${owner.tenantId}', '${period}', 'ai.scribe', ${units})
       on conflict (tenant_id, period, feature) do update set units = excluded.units`,
    );
  }

  it("precondition: the trialing clinic's doctor gets ok from ai_preflight (opt-in, entitlement, kill switch)", async () => {
    resetUsage(0);
    const { data, error } = await rpc(doctor.client)("ai_preflight", { p_feature: "ai.scribe", p_visit_id: visitId });
    expect(error).toBeNull();
    expect(data).toBe("ok");
  });

  it(`at limit − 1, two parallel reservations give exactly one id and one AI_OVER_QUOTA (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      resetUsage(TRIAL_LIMIT - 1);
      const args = { p_feature: "ai.scribe", p_visit_id: visitId, p_timeout_s: 60 };
      const results = await Promise.all([rpc(owner.client)("ai_reserve", args), rpc(doctor.client)("ai_reserve", args)]);

      const ids = results.filter((r) => r.error === null).map((r) => r.data);
      const refusals = results.filter((r) => r.error !== null).map((r) => r.error);
      expect(ids, `round ${round}: reservation ids`).toHaveLength(1);
      expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
      expect(refusals, `round ${round}: refusals`).toHaveLength(1);
      expect(refusals[0]).toMatchObject({ code: "P0001", message: "AI_OVER_QUOTA" });
      expect(mapDbError(refusals[0]!)).toMatchObject({ code: "PRECONDITION_FAILED", reason: "AI_OVER_QUOTA" });

      const [live] = psql(
        `select count(*) from public.ai_quota_reservations where tenant_id = '${owner.tenantId}' and expires_at > now()`,
      );
      expect(live, `round ${round}: live reservations`).toBe("1");
    }
  });

  it("the reservation commits to exactly one unit; the quota is then full", async () => {
    resetUsage(TRIAL_LIMIT - 1);
    const reserved = await rpc(doctor.client)("ai_reserve", { p_feature: "ai.scribe", p_visit_id: visitId, p_timeout_s: 60 });
    expect(reserved.error).toBeNull();
    const committed = await rpc(doctor.client)("ai_commit", { p_reservation: reserved.data });
    expect(committed.error).toBeNull();
    expect(committed.data).toBe(TRIAL_LIMIT);
    const { data } = await rpc(doctor.client)("ai_preflight", { p_feature: "ai.scribe", p_visit_id: visitId });
    expect(data).toBe("over_quota");
  });

  it("a locked clinic's reservation is refused with AI_LOCKED, which the app reads as SUBSCRIPTION_LOCKED", async () => {
    resetUsage(0);
    psql(`update public.tenant_subscriptions set access_ends_at = now() - interval '1 day' where tenant_id = '${owner.tenantId}'`);
    try {
      const { error } = await rpc(doctor.client)("ai_reserve", { p_feature: "ai.scribe", p_visit_id: visitId, p_timeout_s: 60 });
      expect(error).toMatchObject({ code: "P0001", message: "AI_LOCKED" });
      expect(mapDbError(error!)).toMatchObject({ code: "SUBSCRIPTION_LOCKED", reason: "AI_LOCKED" });
    } finally {
      psql(`update public.tenant_subscriptions set access_ends_at = now() + interval '14 days' where tenant_id = '${owner.tenantId}'`);
    }
  });
});
