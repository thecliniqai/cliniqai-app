/**
 * V2-03 03-02 (ADR-0005 register R15, T-03-18): `public.referral_source_clinics(p_ids uuid[])` (migration 000026)
 * replaces the service-role read of originating clinic names in the inbound-referral list.
 *
 * - The receiving clinic (B) sees the sending clinic's (A) id, name and phone only once A has referred a patient to B.
 * - Ids of an unrelated clinic (C), or of a clinic that only received referrals, return no row (no enumeration).
 * - anon is denied; the function is SECURITY DEFINER with an empty `search_path`; only `authenticated` may execute it.
 * - `getInboundReferrals` (features/referrals/service.ts) still shows the originating clinic, through the caller's own
 *   client.
 * Synthetic data only.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { getInboundReferrals } from "@/features/referrals/service";
import { publicEnv } from "@/lib/env";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { listInReferralDirectory } from "../helpers/referral-directory";

const ROOT = path.resolve(__dirname, "../..");
const PHONE_A = "+910000000026";

function psql(sql: string): string[] {
  const toml = fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!projectId) throw new Error("project_id not found in supabase/config.toml");
  const out = execFileSync("docker", ["exec", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-Atc", sql], {
    encoding: "utf8",
  });
  return out.trim().split("\n").filter(Boolean);
}

async function sourceClinics(t: SeededTenant, ids: string[]) {
  const { data, error } = await t.client.rpc("referral_source_clinics", { p_ids: ids });
  expect(error).toBeNull();
  return (data ?? []).map((r) => ({ ...r })).sort((x, y) => x.id.localeCompare(y.id));
}

describe("referral_source_clinics(p_ids) (migration 000026)", () => {
  let A: SeededTenant;
  let B: SeededTenant;
  let C: SeededTenant;
  let referralId: string;

  beforeAll(async () => {
    [A, B, C] = await Promise.all([
      seedTenantWithOwner("RSC Sender Clinic"),
      seedTenantWithOwner("RSC Receiver Clinic"),
      seedTenantWithOwner("RSC Unrelated Clinic"),
    ]);
    const { error: phoneErr } = await getAdminClient().from("tenants").update({ phone: PHONE_A }).eq("id", A.tenantId);
    if (phoneErr) throw new Error(`seed phone: ${phoneErr.message}`);
    await listInReferralDirectory(B.tenantId); // 05-06: the in-network target must be listed in the referral directory

    const { data: patient, error: patientErr } = await A.client
      .from("patients")
      .insert({ tenant_id: A.tenantId, full_name: "Synthetic Patient RSC", phone: "+919000000026", created_by: A.userId })
      .select("id")
      .single();
    if (patientErr || !patient) throw new Error(`seed patient: ${patientErr?.message}`);

    // Before any referral, B cannot learn A's name.
    expect(await sourceClinics(B, [A.tenantId])).toEqual([]);

    const { data: referral, error: refErr } = await A.client
      .from("referrals")
      .insert({
        tenant_id: A.tenantId,
        patient_id: patient.id,
        referral_type: "in_network",
        referring_doctor_id: A.userId,
        referred_to_name: "Synthetic Specialist",
        target_tenant_id: B.tenantId,
        reason_for_referral: "Synthetic second opinion",
      })
      .select("id")
      .single();
    if (refErr || !referral) throw new Error(`seed referral: ${refErr?.message}`);
    referralId = referral.id;
  });

  it("the receiving clinic sees the sender's id, name and phone after the referral", async () => {
    expect(await sourceClinics(B, [A.tenantId])).toEqual([{ id: A.tenantId, name: "RSC Sender Clinic", phone: PHONE_A }]);
  });

  it("ids of an unrelated clinic return no row, alone or mixed with a real sender", async () => {
    expect(await sourceClinics(B, [C.tenantId])).toEqual([]);
    expect((await sourceClinics(B, [A.tenantId, C.tenantId])).map((r) => r.id)).toEqual([A.tenantId]);
  });

  it("a clinic that is not a referral target learns nothing, nor does the sender about the receiver", async () => {
    expect(await sourceClinics(C, [A.tenantId, B.tenantId])).toEqual([]);
    expect(await sourceClinics(A, [A.tenantId, B.tenantId])).toEqual([]);
  });

  it("an empty id list returns no row", async () => {
    expect(await sourceClinics(B, [])).toEqual([]);
  });

  it("anon is denied", async () => {
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anon.rpc("referral_source_clinics", { p_ids: [A.tenantId] });
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("is SECURITY DEFINER with search_path pinned to the empty string; only authenticated may execute it", () => {
    const fn = "public.referral_source_clinics(uuid[])";
    expect(
      psql(
        "select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') from pg_proc p " +
          "where p.oid = 'public.referral_source_clinics(uuid[])'::regprocedure"
      )
    ).toEqual(['true|search_path=""']);
    expect(
      psql(
        ["anon", "authenticated", "service_role", "public"]
          .map((role) => `select '${role}=' || has_function_privilege('${role}', '${fn}', 'EXECUTE')`)
          .join(" union all ")
      )
    ).toEqual(["anon=false", "authenticated=true", "service_role=false", "public=false"]);
  });

  it("getInboundReferrals still shows the originating clinic, read through the caller's client", async () => {
    const res = await getInboundReferrals(ctxFor(B));
    expect(res.success).toBe(true);
    const found = res.referrals.find((r) => r.id === referralId);
    expect(found?.originating_clinic).toEqual({ id: A.tenantId, name: "RSC Sender Clinic", phone: PHONE_A });
  });
});
