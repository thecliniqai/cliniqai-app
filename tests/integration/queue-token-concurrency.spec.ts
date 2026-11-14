/**
 * 50 parallel check-ins (V2-05 05-08; roadmap V2-05 acceptance 7 "50 parallel check-ins produce 50 distinct tokens with
 * the IST date"; P1-40, DB-09; R-18; threat T-05-21).
 *
 * Before 05-08 a token was `MAX(token_number) + 1` read without a lock (`generate_daily_queue_token`), so check-ins at
 * the same moment got the same number and all but one failed on `uq_tenant_date_token`. Since 05-08 one counter row
 * per clinic and clinic day is advanced atomically and the clinic-local date is computed in SQL; since 05-11a
 * (M-TOKEN) `issue_queue_token` also writes the `queue_tokens` row itself (members hold no INSERT privilege) and a
 * repeat check-in of the same visit returns the visit's existing token.
 *
 * The interleaving is forced, not hoped for (tests/helpers/write-barrier.ts): every check-in's client holds its token
 * RPC until all 50 check-ins have reached it (and, for the pre-05-11a code that still inserted the row itself, its
 * `queue_tokens` insert until all 50 have their number). That is the worst case for the old read-then-write (all 50
 * read the same maximum), and the counter must still hand out 1…50. Check-ins go through the real service as two receptionists with their own JWT clients (RLS applies); rows are
 * read back with the service-role client, the expected date with SQL in the same test. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { checkInVisit } from "@/features/queue/service";
import type { ServiceContext } from "@/lib/auth/context";
import { DEFAULT_CLINIC_TZ, ymdOf } from "@/lib/datetime";
import { ctxFor } from "../helpers/context";
import { psql } from "../helpers/sql";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { createBarrier, gateClient } from "../helpers/write-barrier";

const CHECK_INS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The clinic-local date SQL computes for the tenant right now, and the database clock (ISO). */
function sqlToday(tenantId: string): { date: string; now: string } {
  if (!UUID.test(tenantId)) throw new Error("tenant id is not a uuid");
  const [row] = psql(
    `select public.tenant_local_date('${tenantId}', now())::text || '|' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  );
  const [date, now] = row.split("|");
  return { date, now };
}

describe("50 parallel check-ins (05-08, acceptance 7)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let desks: SeededTenant[];
  let visitIds: string[];
  let patientId: string;

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic Token Rush Clinic");
    desks = [await addMemberToTenant(owner.tenantId, "receptionist"), await addMemberToTenant(owner.tenantId, "receptionist")];

    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic Rush Patient", phone: "+919000008802", created_by: owner.userId })
      .select("id")
      .single();
    if (pErr || !patient) throw new Error(`Failed to seed the patient: ${pErr?.message}`);
    patientId = patient.id as string;

    const rows = Array.from({ length: CHECK_INS }, () => ({
      tenant_id: owner.tenantId,
      patient_id: patient.id,
      doctor_id: owner.userId,
      origin_type: "walk_in",
      status: "booked",
      created_by: owner.userId,
    }));
    const { data: visits, error: vErr } = await admin.from("visits").insert(rows).select("id");
    if (vErr || !visits || visits.length !== CHECK_INS) throw new Error(`Failed to seed the visits: ${vErr?.message}`);
    visitIds = visits.map((v) => v.id as string);
  }, 60_000);

  it("produces tokens 1…50, all distinct, every one dated the clinic-local (IST) date computed in SQL", async () => {
    const tokenRpc = createBarrier(CHECK_INS);
    const tokenInsert = createBarrier(CHECK_INS);
    // Every RPC name the check-in has used is gated, so older code (generate_daily_queue_token before 05-08,
    // next_queue_token + a member insert before 05-11a) runs under the same interleaving.
    const gates = {
      rpc: { issue_queue_token: tokenRpc, next_queue_token: tokenRpc, generate_daily_queue_token: tokenRpc },
      insert: { queue_tokens: tokenInsert },
    };
    const contexts: ServiceContext[] = desks.map((desk) => {
      const ctx = ctxFor(desk);
      return { ...ctx, db: gateClient(ctx.db, gates) };
    });

    const before = sqlToday(owner.tenantId);
    const results = await Promise.all(visitIds.map((id, i) => checkInVisit(contexts[i % contexts.length], id, "normal")));
    const after = sqlToday(owner.tenantId);

    // Every check-in reached the RPC barrier (no caller dropped out before its RPC); since 05-11a no member writes the
    // token row, so the insert barrier is never reached.
    expect(tokenRpc.arrived).toBe(CHECK_INS);
    expect(tokenInsert.arrived).toBe(0);

    const failures = results.filter((r) => !r.success);
    expect(failures).toEqual([]);
    const numbers = results.map((r) => (r.success ? r.tokenNumber : NaN)).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: CHECK_INS }, (_, i) => i + 1));

    const { data: tokens, error } = await admin
      .from("queue_tokens")
      .select("visit_id, token_number, date")
      .eq("tenant_id", owner.tenantId);
    if (error) throw new Error(error.message);
    expect(tokens).toHaveLength(CHECK_INS);
    expect(new Set(tokens!.map((t) => t.token_number)).size).toBe(CHECK_INS);
    expect(new Set(tokens!.map((t) => t.visit_id))).toEqual(new Set(visitIds));

    // One date for all 50: the clinic-local today from SQL (bracketed, in case the run straddles midnight IST)…
    const dates = new Set(tokens!.map((t) => t.date));
    expect(dates.size).toBe(1);
    const [date] = [...dates];
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([before.date, after.date]).toContain(date);
    // …which is the IST calendar date of the database clock (not its UTC date between 18:30 and 24:00 UTC).
    expect([ymdOf(before.now, DEFAULT_CLINIC_TZ), ymdOf(after.now, DEFAULT_CLINIC_TZ)]).toContain(date);

    // The counter row holds the last number, so the next check-in continues at 51.
    const [counter] = psql(
      `select last_token from public.queue_token_counters where tenant_id = '${owner.tenantId}' and date = '${date}'`
    );
    expect(Number(counter)).toBe(CHECK_INS);
  }, 60_000);

  // 05-11a (M-TOKEN, INT Info I-4): two desks check in the SAME visit at the same moment. Before, both took a number
  // and the second insert failed on queue_tokens_visit_id_key ("Failed to register queue entry", a burned number).
  // Now the RPC serialises on the visit: one issues the token, the other gets the same token back, and the counter
  // moves by exactly one.
  it("a repeat check-in of the same visit (two desks at once) reuses the visit's token", async () => {
    const { data: visit, error: vErr } = await admin
      .from("visits")
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patientId,
        doctor_id: owner.userId,
        origin_type: "walk_in",
        status: "booked",
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (vErr || !visit) throw new Error(`Failed to seed the visit: ${vErr?.message}`);

    const today = sqlToday(owner.tenantId).date;
    const counterOf = () =>
      Number(
        psql(`select coalesce(max(last_token), 0) from public.queue_token_counters where tenant_id = '${owner.tenantId}' and date = '${today}'`)[0]
      );
    const before = counterOf();

    const tokenRpc = createBarrier(2);
    const gates = { rpc: { issue_queue_token: tokenRpc, next_queue_token: tokenRpc }, insert: {} };
    const contexts: ServiceContext[] = desks.map((desk) => {
      const ctx = ctxFor(desk);
      return { ...ctx, db: gateClient(ctx.db, gates) };
    });
    const [a, b] = await Promise.all(contexts.map((ctx) => checkInVisit(ctx, visit.id as string, "normal")));

    expect(a).toMatchObject({ success: true });
    expect(b).toMatchObject({ success: true });
    if (!a.success || !b.success) return;
    expect(a.tokenNumber).toBe(b.tokenNumber);
    expect(a.queueTokenId).toBe(b.queueTokenId);
    expect(a.tokenNumber).toBe(before + 1);

    const { data: rows, error } = await admin.from("queue_tokens").select("id, token_number").eq("visit_id", visit.id as string);
    if (error) throw new Error(error.message);
    expect(rows).toEqual([{ id: a.queueTokenId, token_number: a.tokenNumber }]);
    expect(counterOf()).toBe(before + 1);

    // A third, later check-in of the same visit returns the same token too.
    const again = await checkInVisit(ctxFor(desks[0]), visit.id as string, "urgent");
    expect(again).toEqual({ success: true, tokenNumber: a.tokenNumber, queueTokenId: a.queueTokenId });
    expect(counterOf()).toBe(before + 1);
  }, 60_000);
});
