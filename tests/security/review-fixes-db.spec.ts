import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import type { UserRole } from "@/lib/db/types";
import {
  seedTenantWithOwner,
  addMemberToTenant,
  createUnlinkedUser,
  type SeededTenant,
} from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { GET as getDocumentRoute } from "@/app/api/r/[token]/route";
import { GET as getRescheduleRoute, POST as postRescheduleRoute } from "@/app/api/reschedule/[token]/route";
import { generateRescheduleToken } from "@/features/appointments/system";
import { canManageShareLink } from "@/features/sharing/tokens";
import { updateStaffMember } from "@/features/settings/service";
import { acknowledgeReferral, getReferralSignedUrl } from "@/features/referrals/service";
import * as enqueueModule from "@/lib/jobs/enqueue";
import { shareTokenHash } from "../helpers/share-tokens";
import { jsonObject } from "../helpers/db";
import { listInReferralDirectory } from "../helpers/referral-directory";
import { hasPerm } from "@/lib/permissions";

// V2-01 plan 01-08 (review fixes, migration 000021). Local stack, real clients; the admin client only seeds rows and
// reads results. Each case fails on the 000020 schema.

type RpcFn = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  return (client.rpc as unknown as RpcFn).call(client, name, args);
}

const admin = getAdminClient();
const ROLES: UserRole[] = ["owner", "admin", "doctor", "receptionist", "nurse"];
const SHARE_TYPES = ["prescription", "invoice", "patient_document", "referral"] as const;

async function insertRow(table: string, row: Record<string, unknown>): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from(table as never) as any).insert(row).select("id").single();
  if (error || !data) throw new Error(`seed ${table} failed: ${error?.message}`);
  return data.id as string;
}

async function upload(bucket: string, path: string) {
  const { error } = await admin.storage
    .from(bucket)
    .upload(path, Buffer.from("%PDF-1.4 syn"), { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`storage seed failed: ${error.message}`);
}

/** Synthetic +9198xxxxxxxx number (same pattern as tests/security/share-tokens.spec.ts). */
function syntheticPhone(): string {
  return `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

interface Clinic {
  owner: SeededTenant;
  members: Record<UserRole, SeededTenant>;
  patientId: string;
  patient2Id: string;
  visitId: string;
  prescriptionId: string;
  invoiceId: string;
  documentId: string;
  referralId: string;
}

async function seedClinic(label: string): Promise<Clinic> {
  const owner = await seedTenantWithOwner(`Review ${label} ${randomUUID().slice(0, 8)}`);
  const t = owner.tenantId;
  const members = { owner } as Record<UserRole, SeededTenant>;
  for (const role of ["admin", "doctor", "receptionist", "nurse"] as const) {
    members[role] = await addMemberToTenant(t, role);
  }
  const patientId = await insertRow("patients", {
    tenant_id: t,
    full_name: `Synthetic Patient ${label}1`,
    phone: syntheticPhone(),
    created_by: owner.userId,
  });
  const patient2Id = await insertRow("patients", {
    tenant_id: t,
    full_name: `Synthetic Patient ${label}2`,
    phone: syntheticPhone(),
    created_by: owner.userId,
  });
  const visitId = await insertRow("visits", {
    tenant_id: t,
    patient_id: patientId,
    doctor_id: owner.userId,
    origin_type: "scheduled",
    status: "booked",
    scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    created_by: owner.userId,
  });
  const prescriptionId = await insertRow("prescriptions", {
    tenant_id: t,
    visit_id: visitId,
    patient_id: patientId,
    doctor_id: owner.userId,
  });
  const invoiceId = await insertRow("invoices", {
    tenant_id: t,
    visit_id: visitId,
    patient_id: patientId,
    invoice_number: `INV-SYN-${randomUUID().slice(0, 6)}`,
  });
  const documentId = await insertRow("patient_documents", {
    tenant_id: t,
    patient_id: patientId,
    title: "Synthetic Report",
    original_filename: "synthetic.pdf",
    storage_path: `tenants/${t}/patients/${patientId}/labs/syn_${randomUUID().slice(0, 8)}.pdf`,
    file_size_bytes: 12,
    mime_type: "application/pdf",
    uploaded_by: owner.userId,
  });
  const referralId = await insertRow("referrals", {
    tenant_id: t,
    patient_id: patientId,
    referral_type: "out_of_network",
    referring_doctor_id: owner.userId,
    referred_to_name: "Synthetic Specialist",
    reason_for_referral: "Synthetic reason",
  });
  return { owner, members, patientId, patient2Id, visitId, prescriptionId, invoiceId, documentId, referralId };
}

function resourceId(c: Clinic, type: (typeof SHARE_TYPES)[number]): string {
  return {
    prescription: c.prescriptionId,
    invoice: c.invoiceId,
    patient_document: c.documentId,
    referral: c.referralId,
  }[type];
}

async function mint(client: SupabaseClient, type: string, id: string): Promise<string> {
  const { data, error } = await rpc(client, "create_share_token", { p_resource_type: type, p_resource_id: id });
  if (error) throw new Error(`mint failed: ${error.code}`);
  return (data as Array<{ token: string }>)[0].token;
}

async function tokenRowByToken(token: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin.from("document_share_tokens") as any)
    .select("id, revoked_at, access_count")
    .eq("token_hash", shareTokenHash(token))
    .single();
  return data as { id: string; revoked_at: string | null; access_count: number };
}

function docGet(token: string, query = "") {
  return getDocumentRoute(new NextRequest(`http://localhost:3000/api/r/${token}${query}`), {
    params: Promise.resolve({ token }),
  });
}
function rescheduleGet(token: string) {
  return getRescheduleRoute(new NextRequest(`http://localhost:3000/api/reschedule/${token}`), {
    params: Promise.resolve({ token }),
  });
}
function reschedulePost(token: string, newScheduledAt: string) {
  return postRescheduleRoute(
    new NextRequest(`http://localhost:3000/api/reschedule/${token}`, {
      method: "POST",
      body: JSON.stringify({ newScheduledAt }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ token }) }
  );
}

async function membershipRow(m: SeededTenant) {
  const { data } = await admin
    .from("memberships")
    .select("id, full_name, phone, qualifications, medical_council_reg_no, role")
    .eq("tenant_id", m.tenantId)
    .eq("user_id", m.userId)
    .single();
  return data as {
    id: string;
    full_name: string | null;
    phone: string | null;
    qualifications: string | null;
    medical_council_reg_no: string | null;
    role: string;
  };
}

describe("01-08 review fixes (000021)", () => {
  let A: Clinic;
  let B: Clinic;
  let anon: SupabaseClient;

  beforeAll(async () => {
    A = await seedClinic("A");
    B = await seedClinic("B");
    anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }, 120_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("IR-M2 / AR-M2: create_share_token role per type, audited; revoke_share_token", () => {
    it.each(SHARE_TYPES)("%s: the database allows exactly the roles the app's share permission allows", async (type) => {
      for (const role of ROLES) {
        const { data, error } = await rpc(A.members[role].client, "create_share_token", {
          p_resource_type: type,
          p_resource_id: resourceId(A, type),
        });
        // V2-05 05-02c: without billing:view an invoice link also needs the invoice's visit to be the caller's own
        // (a doctor's Sign & Bill message, R-7); the fixture invoice is the owner's visit.
        const ownVisitOnly = type === "invoice" && !hasPerm(role, "billing:view");
        if (canManageShareLink(role, type) && !ownVisitOnly) {
          expect(error, `${role} ${type}`).toBeNull();
          expect((data as Array<{ token: string }>)[0].token).toMatch(/^[0-9a-f]{64}$/);
        } else {
          expect(error?.code, `${role} ${type}`).toBe("42501");
        }
        if (canManageShareLink(role, type) && ownVisitOnly) {
          const ownVisit = await insertRow("visits", {
            tenant_id: A.owner.tenantId,
            patient_id: A.patient2Id,
            doctor_id: A.members[role].userId,
            origin_type: "walk_in",
            created_by: A.owner.userId,
          });
          const ownInvoice = await insertRow("invoices", {
            tenant_id: A.owner.tenantId,
            visit_id: ownVisit,
            patient_id: A.patient2Id,
            invoice_number: `INV-SYN-${randomUUID().slice(0, 6)}`,
          });
          const own = await rpc(A.members[role].client, "create_share_token", { p_resource_type: type, p_resource_id: ownInvoice });
          expect(own.error, `${role} ${type} own visit`).toBeNull();
        }
      }
    });

    it("a receptionist cannot mint a prescription link (F9) and no token row is written", async () => {
      const before = await admin
        .from("document_share_tokens")
        .select("id", { count: "exact", head: true })
        .eq("resource_id", A.prescriptionId)
        .eq("created_by", A.members.receptionist.userId);
      const res = await rpc(A.members.receptionist.client, "create_share_token", {
        p_resource_type: "prescription",
        p_resource_id: A.prescriptionId,
      });
      expect(res.error?.code).toBe("42501");
      const after = await admin
        .from("document_share_tokens")
        .select("id", { count: "exact", head: true })
        .eq("resource_id", A.prescriptionId)
        .eq("created_by", A.members.receptionist.userId);
      expect(after.count).toBe(before.count);
    });

    it("creation writes an audit row in the database with the token id and without the token", async () => {
      const token = await mint(A.members.nurse.client as SupabaseClient, "patient_document", A.documentId);
      const row = await tokenRowByToken(token);
      const { data: audits } = await admin
        .from("audit_logs")
        .select("actor_id, actor_role, action, entity_type, entity_id, metadata")
        .eq("tenant_id", A.owner.tenantId)
        .eq("action", "share_token.create")
        .eq("entity_id", A.documentId);
      const mine = (audits ?? []).filter((a) => jsonObject(a.metadata).token_id === row.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        actor_id: A.members.nurse.userId,
        actor_role: "nurse",
        entity_type: "patient_document",
      });
      expect(JSON.stringify(mine[0])).not.toContain(token);
    });

    it("revoke: role rule as for creation, tenant from the token row, audited once, link then 410", async () => {
      const token = await mint(A.owner.client as SupabaseClient, "prescription", A.prescriptionId);
      const { id } = await tokenRowByToken(token);
      expect((await docGet(token)).status).toBe(200);

      expect((await rpc(anon, "revoke_share_token", { p_token_id: id })).error?.code).toBe("42501");
      expect((await rpc(B.owner.client, "revoke_share_token", { p_token_id: id })).error?.message).toContain(
        "not_found"
      );
      expect(
        (await rpc(A.members.receptionist.client, "revoke_share_token", { p_token_id: id })).error?.code
      ).toBe("42501");
      // Since V2-05 05-02c a prescription link follows prescriptions:view (owner, doctor): the nurse is refused too.
      expect((await rpc(A.members.nurse.client, "revoke_share_token", { p_token_id: id })).error?.code).toBe("42501");
      expect((await tokenRowByToken(token)).revoked_at).toBeNull();

      const first = await rpc(A.members.doctor.client, "revoke_share_token", { p_token_id: id });
      expect(first.error).toBeNull();
      const second = await rpc(A.members.doctor.client, "revoke_share_token", { p_token_id: id });
      expect(second.error).toBeNull();
      expect(new Date(second.data as string).getTime()).toBe(new Date(first.data as string).getTime());

      expect((await tokenRowByToken(token)).revoked_at).not.toBeNull();
      expect((await docGet(token)).status).toBe(410);

      const { data: audits } = await admin
        .from("audit_logs")
        .select("actor_id, metadata")
        .eq("tenant_id", A.owner.tenantId)
        .eq("action", "share_token.revoke")
        .eq("entity_id", A.prescriptionId);
      const mine = (audits ?? []).filter((a) => jsonObject(a.metadata).token_id === id);
      expect(mine).toHaveLength(1);
      expect(mine[0].actor_id).toBe(A.members.doctor.userId);
    });
  });

  describe("AR-M1: shared object path bound to the resource; receiving clinic may only acknowledge", () => {
    it("the receiving clinic cannot rewrite pdf_storage_path or clinical fields, but can acknowledge", async () => {
      await listInReferralDirectory(B.owner.tenantId); // 05-06: the target must be listed in the referral directory
      const r1 = await insertRow("referrals", {
        tenant_id: A.owner.tenantId,
        patient_id: A.patientId,
        referral_type: "in_network",
        referring_doctor_id: A.owner.userId,
        referred_to_name: "Synthetic Partner",
        reason_for_referral: "Synthetic reason",
        target_tenant_id: B.owner.tenantId,
        clinical_summary: "Synthetic summary",
        pdf_storage_path: `tenants/${A.owner.tenantId}/referrals/placeholder/referral_letter.pdf`,
      });

      for (const patch of [
        { pdf_storage_path: `tenants/${A.owner.tenantId}/referrals/${A.referralId}/referral_letter.pdf` },
        { clinical_summary: "Rewritten by target" },
        { patient_id: A.patient2Id },
        { status: "completed" },
      ]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (B.owner.client.from("referrals") as any).update(patch).eq("id", r1);
        expect(error?.code, JSON.stringify(Object.keys(patch))).toBe("42501");
      }
      const { data: unchanged } = await admin
        .from("referrals")
        .select("pdf_storage_path, clinical_summary, patient_id, status")
        .eq("id", r1)
        .single();
      expect(unchanged).toMatchObject({
        pdf_storage_path: `tenants/${A.owner.tenantId}/referrals/placeholder/referral_letter.pdf`,
        clinical_summary: "Synthetic summary",
        patient_id: A.patientId,
        status: "sent",
      });

      const ack = await acknowledgeReferral(ctxFor(B.owner), r1);
      expect(ack.success).toBe(true);
      const { data: acked } = await admin.from("referrals").select("status, acknowledged_at").eq("id", r1).single();
      expect(acked?.status).toBe("acknowledged");
      expect(acked?.acknowledged_at).not.toBeNull();
    });

    it("a referral link signs the referral's own letter even when the stored path names another referral", async () => {
      const r2 = await insertRow("referrals", {
        tenant_id: A.owner.tenantId,
        patient_id: A.patient2Id,
        referral_type: "out_of_network",
        referring_doctor_id: A.owner.userId,
        referred_to_name: "Synthetic Specialist 2",
        reason_for_referral: "Synthetic reason 2",
      });
      const ownPath = `tenants/${A.owner.tenantId}/referrals/${A.referralId}/referral_letter.pdf`;
      const otherPath = `tenants/${A.owner.tenantId}/referrals/${r2}/referral_letter.pdf`;
      await upload("clinic-records", ownPath);
      await upload("clinic-records", otherPath);
      await admin.from("referrals").update({ pdf_storage_path: otherPath }).eq("id", A.referralId);

      const token = await mint(A.owner.client as SupabaseClient, "referral", A.referralId);
      const res = await docGet(token, "?download=true");
      expect(res.status).toBe(302);
      const location = decodeURIComponent(res.headers.get("location") ?? "");
      expect(location).toContain(`/referrals/${A.referralId}/`);
      expect(location).not.toContain(r2);

      const inApp = await getReferralSignedUrl(ctxFor(A.owner), A.referralId);
      expect(inApp.success).toBe(true);
      expect(decodeURIComponent(inApp.signedUrl ?? "")).toContain(`/referrals/${A.referralId}/`);
      expect(decodeURIComponent(inApp.signedUrl ?? "")).not.toContain(r2);
    });

    it("prescription and lab document links refuse a stored path outside the resource's own prefix", async () => {
      // Rx: <tenant>/<visit>/rx_v<n>.pdf; another visit's file can no longer be stored (CHECK, 000022) and the link
      // does not sign it.
      const otherVisitPath = `${A.owner.tenantId}/${randomUUID()}/rx_v1.pdf`;
      await upload("prescriptions", otherVisitPath);
      const rxWrite = await admin
        .from("prescriptions")
        .update({ pdf_storage_path: otherVisitPath })
        .eq("id", A.prescriptionId);
      expect(rxWrite.error?.code).toBe("23514");
      const rxToken = await mint(A.owner.client as SupabaseClient, "prescription", A.prescriptionId);
      expect((await docGet(rxToken, "?download=true")).status).toBe(404);

      const ownRxPath = `${A.owner.tenantId}/${A.visitId}/rx_v1.pdf`;
      await upload("prescriptions", ownRxPath);
      await admin.from("prescriptions").update({ pdf_storage_path: ownRxPath }).eq("id", A.prescriptionId);
      expect((await docGet(rxToken, "?download=true")).status).toBe(302);

      // Lab document: tenants/<tenant>/patients/<patient>/...; another patient's file cannot be stored either.
      const otherPatientPath = `tenants/${A.owner.tenantId}/patients/${A.patient2Id}/labs/other.pdf`;
      await upload("clinic-records", otherPatientPath);
      const docWrite = await admin
        .from("patient_documents")
        .update({ storage_path: otherPatientPath })
        .eq("id", A.documentId);
      expect(docWrite.error?.code).toBe("23514");
      const docToken = await mint(A.owner.client as SupabaseClient, "patient_document", A.documentId);
      const res = await docGet(docToken, "?download=true");
      expect(decodeURIComponent(res.headers.get("location") ?? "")).not.toContain(A.patient2Id);
    });
  });

  describe("AR-L2: reschedule horizon, double booking, one live link per visit, bounded lookup", () => {
    async function freshVisit(at: Date): Promise<string> {
      return insertRow("visits", {
        tenant_id: A.owner.tenantId,
        patient_id: A.patientId,
        doctor_id: A.members.doctor.userId,
        origin_type: "scheduled",
        status: "booked",
        scheduled_at: at.toISOString(),
        created_by: A.owner.userId,
      });
    }
    function dayAt(days: number, hourUtc: number, minute = 0): Date {
      const d = new Date(Date.now() + days * 86_400_000);
      d.setUTCHours(hourUtc, minute, 0, 0);
      return d;
    }
    async function linkFor(visitId: string): Promise<string> {
      const url = await generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, visitId);
      return url.split("/reschedule/")[1];
    }

    it("a time more than 90 days ahead is refused and the link stays usable", async () => {
      const visitId = await freshVisit(dayAt(10, 4));
      const token = await linkFor(visitId);
      const res = await reschedulePost(token, dayAt(91, 5).toISOString());
      expect(res.status).toBe(400);
      expect((await tokenRowByToken(token)).revoked_at).toBeNull();
      const { data: v } = await admin.from("visits").select("scheduled_at").eq("id", visitId).single();
      expect(new Date((v as { scheduled_at: string }).scheduled_at).getTime()).toBe(dayAt(10, 4).getTime());
    });

    it("a slot overlapping another active visit of the doctor is 409 and nothing moves", async () => {
      vi.spyOn(enqueueModule, "enqueueMessageAsSystem").mockResolvedValue({ id: "msg-syn" } as never);
      const taken = dayAt(12, 6);
      await freshVisit(taken);
      const visitId = await freshVisit(dayAt(12, 9));
      const token = await linkFor(visitId);

      const clash = await reschedulePost(token, new Date(taken.getTime() + 5 * 60_000).toISOString());
      expect(clash.status).toBe(409);
      expect((await tokenRowByToken(token)).revoked_at).toBeNull();

      const free = await reschedulePost(token, dayAt(12, 7).toISOString());
      expect(free.status).toBe(200);
    });

    it("issuing a new link revokes the visit's earlier unused link", async () => {
      const visitId = await freshVisit(dayAt(14, 4));
      const first = await linkFor(visitId);
      expect((await rescheduleGet(first)).status).toBe(200);
      const second = await linkFor(visitId);
      expect((await rescheduleGet(first)).status).toBe(410);
      expect((await reschedulePost(first, dayAt(15, 4).toISOString())).status).toBe(410);
      expect((await rescheduleGet(second)).status).toBe(200);
    });

    it("get_reschedule_context returns booked times for at most one day", async () => {
      const day1 = dayAt(20, 5);
      const day5 = dayAt(24, 5);
      await freshVisit(day1);
      await freshVisit(day5);
      const visitId = await freshVisit(dayAt(20, 8));
      const token = await linkFor(visitId);
      const from = dayAt(20, 0);
      const { data } = await rpc(anon, "get_reschedule_context", {
        p_token: token,
        p_from: from.toISOString(),
        p_to: new Date(from.getTime() + 30 * 86_400_000).toISOString(),
      });
      const booked = ((data as { booked: string[] }).booked ?? []).map((b) => new Date(b).getTime());
      expect(booked).toContain(day1.getTime());
      expect(booked).not.toContain(day5.getTime());
      for (const b of booked) expect(b - from.getTime()).toBeLessThanOrEqual(86_400_000);
    });
  });

  describe("AR-L3: slot length and schedule bounds in the database", () => {
    it("a member cannot store a non-positive or huge slot length or a malformed schedule on their own row", async () => {
      const doctor = A.members.doctor;
      const update = (patch: Record<string, unknown>) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (doctor.client.from("memberships") as any).update(patch).eq("tenant_id", doctor.tenantId).eq("user_id", doctor.userId);

      for (const patch of [
        { default_slot_duration_minutes: -5 },
        { default_slot_duration_minutes: 0 },
        { default_slot_duration_minutes: 121 },
        { availability_schedule: { monday: { enabled: true, shifts: [{ start: "10:00", end: "99999:00" }] } } },
        { availability_schedule: { monday: { enabled: true, shifts: [{ start: "13:00", end: "10:00" }] } } },
        { availability_schedule: { funday: { enabled: true, shifts: [] } } },
        { availability_schedule: [] },
      ]) {
        const { error } = await update(patch);
        expect(error?.code, JSON.stringify(patch)).toBe("23514");
      }

      const ok = await update({
        default_slot_duration_minutes: 20,
        availability_schedule: { monday: { enabled: true, shifts: [{ start: "10:00", end: "13:00" }] } },
      });
      expect(ok.error).toBeNull();
    });
  });

  describe("AR-L4: credentials by self or owner; owner/admin identity by self or owner", () => {
    it("an admin cannot change another member's credentials or an owner's name, directly or via the service", async () => {
      const adminClient = A.members.admin.client;
      const doctorRow = await membershipRow(A.members.doctor);
      const ownerRow = await membershipRow(A.owner);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const credErr = await (adminClient.from("memberships") as any)
        .update({ medical_council_reg_no: "SYN-FORGED-1" })
        .eq("id", doctorRow.id);
      expect(credErr.error?.code).toBe("42501");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nameErr = await (adminClient.from("memberships") as any)
        .update({ full_name: "Forged Owner Name" })
        .eq("id", ownerRow.id);
      expect(nameErr.error?.code).toBe("42501");

      const viaService = await updateStaffMember(ctxFor(A.members.admin), {
        membership_id: doctorRow.id,
        full_name: doctorRow.full_name ?? "Synthetic Doctor",
        role: "doctor",
        medical_council_reg_no: "SYN-FORGED-2",
      } as never);
      expect(viaService.success).toBe(false);

      expect((await membershipRow(A.members.doctor)).medical_council_reg_no).toBe(doctorRow.medical_council_reg_no);
      expect((await membershipRow(A.owner)).full_name).toBe(ownerRow.full_name);
    });

    it("the member themself and an owner can change credentials; an admin can still edit a receptionist's name", async () => {
      const doctor = A.members.doctor;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const self = await (doctor.client.from("memberships") as any)
        .update({ medical_council_reg_no: "SYN-SELF-1" })
        .eq("tenant_id", doctor.tenantId)
        .eq("user_id", doctor.userId);
      expect(self.error).toBeNull();
      expect((await membershipRow(doctor)).medical_council_reg_no).toBe("SYN-SELF-1");

      const doctorRow = await membershipRow(doctor);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byOwner = await (A.owner.client.from("memberships") as any)
        .update({ qualifications: "MBBS (synthetic)" })
        .eq("id", doctorRow.id);
      expect(byOwner.error).toBeNull();
      expect((await membershipRow(doctor)).qualifications).toBe("MBBS (synthetic)");

      const recRow = await membershipRow(A.members.receptionist);
      const res = await updateStaffMember(ctxFor(A.members.admin), {
        membership_id: recRow.id,
        full_name: "Synthetic Front Desk",
        role: "receptionist",
      } as never);
      expect(res.success).toBe(true);
      expect((await membershipRow(A.members.receptionist)).full_name).toBe("Synthetic Front Desk");
    });
  });

  describe("IR-L4: search_medicines", () => {
    it("a doctor's own search runs (pg_trgm resolved at migration time, search_path '')", async () => {
      const doctor = A.members.doctor;
      const { error } = await rpc(doctor.client, "search_medicines", {
        p_query: "paracetamol",
        p_doctor_id: doctor.userId,
        p_tenant_id: doctor.tenantId,
        p_limit: 5,
      });
      expect(error).toBeNull();
    });
  });

  describe("AR-L6: server-side password minimum (config.toml minimum_password_length = 10)", () => {
    it("updateUser with a 9-character password is rejected by the auth server; 10 characters is accepted", async () => {
      const user = await createUnlinkedUser();
      const short = await user.client.auth.updateUser({ password: "Syn9char!" });
      expect(short.error).not.toBeNull();
      expect(short.error?.code).toBe("weak_password");

      const ok = await user.client.auth.updateUser({ password: `Syn-${randomUUID().slice(0, 8)}` });
      expect(ok.error).toBeNull();
    });
  });
});
