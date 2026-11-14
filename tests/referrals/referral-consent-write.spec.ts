/**
 * The DPDP consent record of a referral that shares the patient's history is checked (V2-05 05a review IND L7; plan
 * 05-11c). 05-06 writes the consent only once the referral exists (a refused referral must not leave a consent row);
 * the write itself was unchecked, so a referral carrying the consented history could exist with no consent record (a gap
 * in the DPDP trail) while the action reported success.
 *
 * Now a failed consent write fails the action with a fixed message, and the referral is withdrawn: the history snapshot
 * is cleared and the referral is cancelled, so the target clinic is not sent the history without a consent record (the
 * referring clinic cannot delete a referral: DELETE is rpc_only). No consent audit row is written.
 *
 * The failure is real: a temporary trigger on `consent_records` raises for this spec's patient only (superuser, dropped
 * in `finally`; the pattern of tests/billing/record-payment-rpc.spec.ts). Local stack, the owner's own JWT client (RLS
 * applies). Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createReferral, REFERRAL_CONSENT_WRITE_FAILED } from "@/features/referrals/service";
import { ctxFor } from "../helpers/context";
import { listInReferralDirectory } from "../helpers/referral-directory";
import { psql } from "../helpers/sql";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

describe("referral consent write is checked (05-11c, IND L7)", () => {
  const admin = getAdminClient();
  let A: SeededTenant;
  let B: SeededTenant;

  beforeAll(async () => {
    A = await seedTenantWithOwner(`Synthetic Referral Consent A ${randomUUID().slice(0, 6)}`);
    B = await seedTenantWithOwner(`Synthetic Referral Consent B ${randomUUID().slice(0, 6)}`);
    await listInReferralDirectory(B.tenantId);
  });

  async function seedPatient(): Promise<string> {
    const { data, error } = await admin
      .from("patients")
      .insert({
        tenant_id: A.tenantId,
        full_name: "Synthetic Referral Consent Patient",
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        created_by: A.userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed patient failed: ${error?.code}`);
    return data.id;
  }

  function referralInput(patientId: string) {
    return {
      patient_id: patientId,
      referral_type: "in_network" as const,
      target_tenant_id: B.tenantId,
      referred_to_name: "Synthetic Partner Doctor",
      reason_for_referral: "Synthetic second opinion",
      urgency: "routine" as const,
      patient_consents_history_sharing: true,
      letterhead_mode: "blank_paper" as const,
    };
  }

  async function referralsOf(patientId: string) {
    const { data, error } = await admin
      .from("referrals")
      .select("status, consented_history_snapshot")
      .eq("tenant_id", A.tenantId)
      .eq("patient_id", patientId);
    if (error) throw new Error(error.code);
    return data ?? [];
  }

  async function consentsOf(patientId: string): Promise<number> {
    const { count, error } = await admin
      .from("consent_records")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", A.tenantId)
      .eq("patient_id", patientId)
      .eq("consent_type", "referral_history_sharing");
    if (error) throw new Error(error.code);
    return count ?? 0;
  }

  async function consentAudits(): Promise<number> {
    const { count, error } = await admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", A.tenantId)
      .eq("action", "patient.consent.granted");
    if (error) throw new Error(error.code);
    return count ?? 0;
  }

  it("a failed consent write fails the referral; the history is withdrawn and the referral cancelled (before: success, no consent)", async () => {
    const patientId = await seedPatient();
    const tag = randomUUID().replace(/-/g, "").slice(0, 12);
    const fn = `public.c11c_consent_fault_${tag}`;
    const trigger = `c11c_consent_fault_${tag}`;
    psql(
      `create function ${fn}() returns trigger language plpgsql as $$ begin ` +
        `if new.patient_id = '${patientId}'::uuid then raise exception 'SENTINEL_CONSENT_FAULT' using errcode = 'XX000'; end if; ` +
        `return new; end $$; ` +
        `create trigger ${trigger} before insert on public.consent_records for each row execute function ${fn}();`
    );
    const auditsBefore = await consentAudits();
    try {
      const res = await createReferral(ctxFor(A), referralInput(patientId));
      expect(res).toEqual({ success: false, error: REFERRAL_CONSENT_WRITE_FAILED });
      expect(JSON.stringify(res)).not.toContain("SENTINEL");

      expect(await consentsOf(patientId)).toBe(0);
      const rows = await referralsOf(patientId);
      // Nothing is left "sent" with the history: the only referral is cancelled and carries no snapshot.
      expect(rows).toEqual([{ status: "cancelled", consented_history_snapshot: null }]);
      expect(await consentAudits()).toBe(auditsBefore);
    } finally {
      psql(`drop trigger if exists ${trigger} on public.consent_records; drop function if exists ${fn}();`);
    }
  }, 60_000);

  it("control: without the fault the referral is sent with the history, one consent record and one consent audit row", async () => {
    const patientId = await seedPatient();
    const auditsBefore = await consentAudits();
    const res = await createReferral(ctxFor(A), referralInput(patientId));
    expect(res.success).toBe(true);
    const rows = await referralsOf(patientId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].consented_history_snapshot).not.toBeNull();
    expect(await consentsOf(patientId)).toBe(1);
    expect(await consentAudits()).toBe(auditsBefore + 1);
  }, 60_000);
  // 05-11b (000074) raises REFERRAL_TARGET_DOCTOR_INVALID; 05-11c gives it a fixed user text (before: generic failure).
  it("a target doctor who is not an owner/doctor of the target clinic → the fixed message, nothing stored", async () => {
    const patientId = await seedPatient();
    const res = await createReferral(ctxFor(A), { ...referralInput(patientId), target_doctor_id: A.userId });
    expect(res).toEqual({
      success: false,
      error: "That doctor does not practise at the selected clinic. Choose a doctor of that clinic.",
    });
    expect(await referralsOf(patientId)).toEqual([]);
    expect(await consentsOf(patientId)).toBe(0);
  }, 60_000);
});
