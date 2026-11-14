import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { seedTenantWithOwner, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { shareTokenHash } from "../helpers/share-tokens";
import { GET as getDocumentRoute } from "@/app/api/r/[token]/route";
import { POST as postRescheduleRoute } from "@/app/api/reschedule/[token]/route";
import { generateRescheduleToken } from "@/features/appointments/system";
import * as enqueueModule from "@/lib/jobs/enqueue";
import { ctxFor } from "../helpers/context";
import { consultationDraftInput } from "../helpers/fixtures";
import { transitionQueueState } from "@/features/queue/service";
import { deleteLabDocument } from "@/features/labs/service";
import { saveConsultationDraft, completeAndSignConsultation } from "@/features/consultation/service";
import { completeAndBillConsultation, SIGN_AND_BILL_ALREADY_DONE_MESSAGE } from "@/features/billing/service";
import { updateStaffMember, CREDENTIALS_SELF_OR_OWNER_MESSAGE } from "@/features/settings/service";
import { createApiKeySecret } from "@/lib/api/auth";
import { PATCH as patchV1Visit } from "@/app/api/v1/visits/[id]/route";

// V2-01 plan 01-09 (review round 2; reviews/review2-adversarial.md = AR2), migration 000022. Local stack, real clients;
// the admin client only seeds rows and reads results. Each case fails on the 000021 schema.

type RpcFn = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  return (client.rpc as unknown as RpcFn).call(client, name, args);
}

const admin = getAdminClient();

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

function syntheticPhone(): string {
  return `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

interface Clinic {
  owner: SeededTenant;
  receptionist: SeededTenant;
  doctor: SeededTenant;
  patientId: string;
  visitId: string;
  prescriptionId: string;
  documentId: string;
  documentPath: string;
  referralId: string;
}

async function seedClinic(label: string): Promise<Clinic> {
  const owner = await seedTenantWithOwner(`Review2 ${label} ${randomUUID().slice(0, 8)}`);
  const t = owner.tenantId;
  const receptionist = await addMemberToTenant(t, "receptionist");
  const doctor = await addMemberToTenant(t, "doctor");
  const patientId = await insertRow("patients", {
    tenant_id: t,
    full_name: `Synthetic Patient ${label}`,
    phone: syntheticPhone(),
    created_by: owner.userId,
  });
  const visitId = await insertRow("visits", {
    tenant_id: t,
    patient_id: patientId,
    doctor_id: doctor.userId,
    origin_type: "scheduled",
    status: "booked",
    scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    created_by: owner.userId,
  });
  const prescriptionId = await insertRow("prescriptions", {
    tenant_id: t,
    visit_id: visitId,
    patient_id: patientId,
    doctor_id: doctor.userId,
  });
  const documentPath = `tenants/${t}/patients/${patientId}/labs/syn_${randomUUID().slice(0, 8)}.pdf`;
  const documentId = await insertRow("patient_documents", {
    tenant_id: t,
    patient_id: patientId,
    title: "Synthetic Report",
    original_filename: "synthetic.pdf",
    storage_path: documentPath,
    file_size_bytes: 12,
    mime_type: "application/pdf",
    uploaded_by: owner.userId,
  });
  const referralId = await insertRow("referrals", {
    tenant_id: t,
    patient_id: patientId,
    referral_type: "out_of_network",
    referring_doctor_id: doctor.userId,
    referred_to_name: "Synthetic Specialist",
    reason_for_referral: "Synthetic reason",
  });
  return { owner, receptionist, doctor, patientId, visitId, prescriptionId, documentId, documentPath, referralId };
}

async function mint(client: SupabaseClient, type: string, id: string): Promise<string> {
  const { data, error } = await rpc(client, "create_share_token", { p_resource_type: type, p_resource_id: id });
  if (error) throw new Error(`mint failed: ${error.code}`);
  return (data as Array<{ token: string }>)[0].token;
}

function docGet(token: string, query = "") {
  return getDocumentRoute(new NextRequest(`http://localhost:3000/api/r/${token}${query}`), {
    params: Promise.resolve({ token }),
  });
}

describe("01-09 review round 2 fixes (000022)", () => {
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

  describe("AR2-H1: encoded dot segments in stored paths", () => {
    /** The report's payload: out of A's patient prefix into B's prescription object. */
    function h1Payload(): string {
      return `tenants/${A.owner.tenantId}/patients/${A.patientId}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/prescriptions/${B.owner.tenantId}/${B.visitId}/rx_v1.pdf`;
    }

    it("attack step 1 is refused: a member cannot store the payload on their own lab document (CHECK 23514)", async () => {
      const victimRx = `${B.owner.tenantId}/${B.visitId}/rx_v1.pdf`;
      await upload("prescriptions", victimRx);

      for (const storage_path of [
        h1Payload(),
        `tenants/${A.owner.tenantId}/patients/${A.patientId}/.%2e/.%2e/.%2e/.%2e/tenants/${B.owner.tenantId}/patients/${B.patientId}/labs/x.pdf`,
        `tenants/${A.owner.tenantId}/patients/${A.patientId}/%2E%2E/x.pdf`,
        `tenants/${A.owner.tenantId}/patients/${A.patientId}/a\\..\\x.pdf`,
        `tenants/${A.owner.tenantId}/patients/${A.patientId}/../${B.patientId}/x.pdf`,
        `tenants/${A.owner.tenantId}/patients/${A.patientId}//x.pdf`,
        `tenants/${A.owner.tenantId}/patients/${A.patientId}/`,
      ]) {
        // The attacker holds labs:edit (since V2-05 05-02c the patient_documents rule; the receptionist no longer does).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (A.doctor.client.from("patient_documents") as any)
          .update({ storage_path })
          .eq("id", A.documentId);
        expect(error?.code, storage_path).toBe("23514");
      }
      const { data } = await admin.from("patient_documents").select("storage_path").eq("id", A.documentId).single();
      expect((data as { storage_path: string }).storage_path).toBe(A.documentPath);

      // Nothing the attacker can mint signs B's object.
      const token = await mint(A.doctor.client as SupabaseClient, "patient_document", A.documentId);
      const res = await docGet(token, "?download=true");
      expect(decodeURIComponent(res.headers.get("location") ?? "")).not.toContain(B.owner.tenantId);
    });

    it("the prescription and referral path columns refuse encoded or foreign paths; derived paths are accepted", async () => {
      const rxPayload = `${A.owner.tenantId}/${A.visitId}/%2e%2e/%2e%2e/${B.owner.tenantId}/${B.visitId}/rx_v1.pdf`;
      for (const pdf_storage_path of [rxPayload, `${A.owner.tenantId}/${A.visitId}/other.pdf`, `${A.owner.tenantId}/${B.visitId}/rx_v1.pdf`]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (A.doctor.client.from("prescriptions") as any)
          .update({ pdf_storage_path })
          .eq("id", A.prescriptionId);
        expect(error?.code, pdf_storage_path).toBe("23514");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const okRx = await (A.doctor.client.from("prescriptions") as any)
        .update({ pdf_storage_path: `${A.owner.tenantId}/${A.visitId}/rx_v2.pdf` })
        .eq("id", A.prescriptionId);
      expect(okRx.error).toBeNull();

      for (const pdf_storage_path of [
        `tenants/${A.owner.tenantId}/referrals/%2e%2e/%2e%2e/${B.owner.tenantId}/x.pdf`,
        `tenants/${B.owner.tenantId}/referrals/${A.referralId}/referral_letter.pdf`,
      ]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (A.doctor.client.from("referrals") as any)
          .update({ pdf_storage_path })
          .eq("id", A.referralId);
        expect(error?.code, pdf_storage_path).toBe("23514");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const okRef = await (A.doctor.client.from("referrals") as any)
        .update({ pdf_storage_path: `tenants/${A.owner.tenantId}/referrals/${A.referralId}/referral_letter.pdf` })
        .eq("id", A.referralId);
      expect(okRef.error).toBeNull();
    });

    it("the resolver's path rule (share_object_path, used by share_token_resource) returns NULL for the payload", async () => {
      const call = (type: string, owner: string, path: string) =>
        rpc(admin as unknown as SupabaseClient, "share_object_path", {
          p_type: type,
          p_tenant_id: A.owner.tenantId,
          p_owner_id: owner,
          p_path: path,
        });

      const bad = await call("patient_document", A.patientId, h1Payload());
      expect(bad.error).toBeNull();
      expect(bad.data).toBeNull();
      expect((await call("prescription", A.visitId, `${A.owner.tenantId}/${A.visitId}/%2e%2e/x/rx_v1.pdf`)).data).toBeNull();

      const good = await call("patient_document", A.patientId, A.documentPath);
      expect(good.data).toBe(A.documentPath);
      const rx = `${A.owner.tenantId}/${A.visitId}/rx_v3.pdf`;
      expect((await call("prescription", A.visitId, rx)).data).toBe(rx);
    });

    it("a well-formed own path still signs (no regression)", async () => {
      await upload("clinic-records", A.documentPath);
      const token = await mint(A.owner.client as SupabaseClient, "patient_document", A.documentId);
      const res = await docGet(token, "?download=true");
      expect(res.status).toBe(302);
      expect(decodeURIComponent(res.headers.get("location") ?? "")).toContain(A.documentPath);
    });
  });

  describe("AR2-L1: share tokens are stored only as SHA-256 hashes", () => {
    it("the raw token is returned once; the row holds only its hash and members cannot read a raw token", async () => {
      const token = await mint(A.doctor.client as SupabaseClient, "prescription", A.prescriptionId);
      expect(token).toMatch(/^[0-9a-f]{64}$/);

      // Since V2-05 05-02c a member reads token rows by resource type (a prescription link: prescriptions:view).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const desk = await (A.receptionist.client.from("document_share_tokens") as any).select("token_hash");
      expect(desk.error).toBeNull();
      expect((desk.data ?? []).filter((r: { token_hash: string }) => r.token_hash === shareTokenHash(token))).toEqual([]);

      // Every column of every token row the doctor can see: the raw token appears nowhere.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows, error } = await (A.doctor.client.from("document_share_tokens") as any).select("*");
      expect(error).toBeNull();
      const mine = (rows ?? []).filter((r: { token_hash: string }) => r.token_hash === shareTokenHash(token));
      expect(mine).toHaveLength(1);
      expect(mine[0].resource_type).toBe("prescription");
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(Object.keys(mine[0])).not.toContain("token");

      // The raw column is gone, for members and for the service role.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = await (A.doctor.client.from("document_share_tokens") as any).select("token").limit(1);
      expect(raw.error?.code).toBe("42703");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawAdmin = await (admin.from("document_share_tokens") as any).select("token").limit(1);
      expect(rawAdmin.error?.code).toBe("42703");

      // What a member can read (the hash) does not open the link; the raw token does.
      expect((await docGet(mine[0].token_hash)).status).toBe(404);
      const viaHash = await rpc(anon, "resolve_share_token", { p_token: mine[0].token_hash, p_kinds: ["prescription"] });
      expect((viaHash.data as { status: string }).status).toBe("not_found");
      expect((await docGet(token)).status).toBe(200);
    });

    it("reschedule links: only the hash is stored and the raw link still works once", async () => {
      vi.spyOn(enqueueModule, "enqueueMessageAsSystem").mockResolvedValue({ id: "msg-syn" } as never);
      const url = await generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, A.visitId);
      const token = url.split("/reschedule/")[1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows } = await (admin.from("document_share_tokens") as any)
        .select("*")
        .eq("resource_type", "appointment")
        .eq("resource_id", A.visitId);
      expect(JSON.stringify(rows)).not.toContain(token);
      expect((rows ?? []).some((r: { token_hash: string }) => r.token_hash === shareTokenHash(token))).toBe(true);

      const at = new Date(Date.now() + 4 * 86_400_000);
      at.setUTCHours(5, 0, 0, 0);
      const post = (t: string) =>
        postRescheduleRoute(
          new NextRequest(`http://localhost:3000/api/reschedule/${t}`, {
            method: "POST",
            body: JSON.stringify({ newScheduledAt: at.toISOString() }),
            headers: { "content-type": "application/json" },
          }),
          { params: Promise.resolve({ token: t }) }
        );
      expect((await post(shareTokenHash(token))).status).toBe(404);
      expect((await post(token)).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Checkpoint 2
  // ---------------------------------------------------------------------------------------------------------------

  async function freshVisit(c: Clinic, status: string, extra: Record<string, unknown> = {}): Promise<string> {
    return insertRow("visits", {
      tenant_id: c.owner.tenantId,
      patient_id: c.patientId,
      doctor_id: c.doctor.userId,
      origin_type: "scheduled",
      status,
      scheduled_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      created_by: c.owner.userId,
      ...extra,
    });
  }

  async function visitRow(id: string) {
    const { data } = await admin.from("visits").select("status, signed_at, scheduled_at").eq("id", id).single();
    return data as { status: string; signed_at: string | null; scheduled_at: string };
  }

  describe("AR2-L4: reschedule links act only on booked or confirmed visits (000023)", () => {
    it.each(["waiting", "in_consultation"])("a link issued while booked cannot move the visit once %s", async (status) => {
      const visitId = await freshVisit(A, "booked");
      const url = await generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, visitId);
      const token = url.split("/reschedule/")[1];
      await admin.from("visits").update({ status }).eq("id", visitId);
      const before = await visitRow(visitId);

      const ctxRes = await rpc(anon, "get_reschedule_context", {
        p_token: token,
        p_from: new Date().toISOString(),
        p_to: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect((ctxRes.data as { status: string }).status).toBe("closed");

      const at = new Date(Date.now() + 9 * 86_400_000);
      at.setUTCHours(6, 0, 0, 0);
      const res = await postRescheduleRoute(
        new NextRequest(`http://localhost:3000/api/reschedule/${token}`, {
          method: "POST",
          body: JSON.stringify({ newScheduledAt: at.toISOString() }),
          headers: { "content-type": "application/json" },
        }),
        { params: Promise.resolve({ token }) }
      );
      expect(res.status).toBe(400);
      expect(await visitRow(visitId)).toEqual(before);

      // And no new link is issued for it.
      await expect(generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, visitId)).rejects.toThrow();
    });

    it("a confirmed visit can still be rescheduled", async () => {
      vi.spyOn(enqueueModule, "enqueueMessageAsSystem").mockResolvedValue({ id: "msg-syn" } as never);
      const visitId = await freshVisit(A, "confirmed");
      const url = await generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, visitId);
      const token = url.split("/reschedule/")[1];
      const at = new Date(Date.now() + 11 * 86_400_000);
      at.setUTCHours(7, 0, 0, 0);
      const { data } = await rpc(anon, "consume_reschedule_token", { p_token: token, p_new_at: at.toISOString() });
      expect((data as { status: string }).status).toBe("ok");
    });
  });

  describe("AR2-L2: the queue cannot move a signed or closed visit", () => {
    it("a completed, signed visit is not moved back to in_consultation (any role with appointments:edit)", async () => {
      const signedAt = new Date().toISOString();
      const visitId = await freshVisit(A, "completed", { signed_at: signedAt, signed_by: A.doctor.userId });
      for (const actor of [A.receptionist, A.doctor, A.owner]) {
        const res = await transitionQueueState(ctxFor(actor), visitId, "in_consultation");
        expect(res.success, actor.role).toBe(false);
      }
      const after = await visitRow(visitId);
      expect(after.status).toBe("completed");
    });

    it("a visit reopened for amendment (signed, in_consultation) is not completed by the queue", async () => {
      const visitId = await freshVisit(A, "in_consultation", {
        signed_at: new Date().toISOString(),
        signed_by: A.doctor.userId,
      });
      const res = await transitionQueueState(ctxFor(A.receptionist), visitId, "completed");
      expect(res.success).toBe(false);
      expect((await visitRow(visitId)).status).toBe("in_consultation");
    });

    it("cancelled visits stay cancelled; open visits still move forward; completing a completed visit is a no-op", async () => {
      const cancelled = await freshVisit(A, "cancelled");
      expect((await transitionQueueState(ctxFor(A.receptionist), cancelled, "in_consultation")).success).toBe(false);
      expect((await visitRow(cancelled)).status).toBe("cancelled");

      const open = await freshVisit(A, "waiting");
      expect((await transitionQueueState(ctxFor(A.receptionist), open, "in_consultation")).success).toBe(true);
      expect((await visitRow(open)).status).toBe("in_consultation");
      expect((await transitionQueueState(ctxFor(A.receptionist), open, "completed")).success).toBe(true);
      expect((await visitRow(open)).status).toBe("completed");
      expect((await transitionQueueState(ctxFor(A.receptionist), open, "completed")).success).toBe(true);
      expect((await transitionQueueState(ctxFor(A.receptionist), open, "in_consultation")).success).toBe(false);
      expect((await visitRow(open)).status).toBe("completed");
    });
  });

  describe("AR2-L5: deleteLabDocument", () => {
    it("deletes this patient's object and does not put the storage path in the audit row", async () => {
      const path = `tenants/${A.owner.tenantId}/patients/${A.patientId}/labs/Synthetic_Name_del_${randomUUID().slice(0, 8)}.pdf`;
      await upload("clinic-records", path);
      const docId = await insertRow("patient_documents", {
        tenant_id: A.owner.tenantId,
        patient_id: A.patientId,
        title: "Synthetic Delete",
        original_filename: "synthetic.pdf",
        storage_path: path,
        file_size_bytes: 12,
        mime_type: "application/pdf",
        uploaded_by: A.owner.userId,
      });

      const res = await deleteLabDocument(ctxFor(A.owner), docId);
      expect(res.success).toBe(true);

      const folder = path.slice(0, path.lastIndexOf("/"));
      const { data: listed } = await admin.storage.from("clinic-records").list(folder);
      expect((listed ?? []).map((o) => o.name)).not.toContain(path.slice(path.lastIndexOf("/") + 1));

      const { data: audits } = await admin
        .from("audit_logs")
        .select("metadata")
        .eq("tenant_id", A.owner.tenantId)
        .eq("action", "patient_document.delete")
        .eq("entity_id", docId);
      expect(audits).toHaveLength(1);
      const meta = JSON.stringify(audits?.[0]);
      expect(meta).not.toContain("storage_path");
      expect(meta).not.toContain(path);
      expect(meta).not.toContain("Synthetic_Name");
    });

    it("a stored key outside the patient's prefix is never passed to storage", async () => {
      const storage = await import("@/lib/storage");
      const deleteSpy = vi.spyOn(storage, "deleteFile");
      const docId = randomUUID();
      // Since 000022 the CHECK keeps such a row out of the database (a row predating it could still hold one), so the
      // app-side guard is exercised with a fake client returning a foreign key for the document.
      const fakeDb = {
        from: (table: string) => {
          const chain: Record<string, unknown> = {};
          for (const m of ["select", "eq", "delete"]) chain[m] = () => chain;
          chain.single = async () => ({
            data: {
              id: docId,
              patient_id: A.patientId,
              title: "Synthetic Legacy",
              storage_path: `tenants/${B.owner.tenantId}/patients/${B.patientId}/labs/victim.pdf`,
            },
            error: null,
          });
          // The row delete asks for the deleted rows (V2-05 05-04: 0 rows is a refusal): report the one row deleted.
          chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [{ id: docId }], error: null });
          chain.insert = async () => ({ error: null });
          void table;
          return chain;
        },
        rpc: async () => ({ data: null, error: null }),
        auth: { getUser: async () => ({ data: { user: { id: A.doctor.userId } }, error: null }) },
      };
      const res = await deleteLabDocument({ ...ctxFor(A.doctor), db: fakeDb as never }, docId);
      expect(res.success).toBe(true);
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe("IR2-L1: Sign & Bill resumes at billing after a partial failure", () => {
    async function draftedVisit(): Promise<string> {
      const visitId = await freshVisit(A, "in_consultation");
      const saved = await saveConsultationDraft(
        ctxFor(A.doctor),
        consultationDraftInput({ visit_id: visitId, clinical_notes: "Synthetic note." })
      );
      if (!saved.success) throw new Error("draft seed failed");
      return visitId;
    }
    const bill = (actor: SeededTenant, visitId: string) =>
      completeAndBillConsultation(ctxFor(actor), {
        visit_id: visitId,
        patient_id: A.patientId,
        consultation_fee: 500,
        discount: 0,
        additional_items: [],
        payment_collected: false,
        payment_method: "cash",
      });
    async function invoiceCount(visitId: string): Promise<number> {
      const { data } = await admin.from("invoices").select("id").eq("visit_id", visitId);
      return (data ?? []).length;
    }

    it("signed by this doctor with no invoice yet: the retry creates the invoice without re-signing", async () => {
      const visitId = await draftedVisit();
      // Step 1 committed, billing never ran (the partial failure).
      expect((await completeAndSignConsultation(ctxFor(A.doctor), visitId)).success).toBe(true);
      const signed = await visitRow(visitId);
      expect(await invoiceCount(visitId)).toBe(0);

      const retry = await bill(A.doctor, visitId);
      expect(retry.success).toBe(true);
      expect(await invoiceCount(visitId)).toBe(1);
      expect((await visitRow(visitId)).signed_at).toBe(signed.signed_at);

      // A second retry does not bill twice.
      const again = await bill(A.doctor, visitId);
      expect(again.success).toBe(false);
      if (!again.success) expect(again.error).toBe(SIGN_AND_BILL_ALREADY_DONE_MESSAGE);
      expect(await invoiceCount(visitId)).toBe(1);
    });

    it("a visit signed by someone else is not billed through this flow", async () => {
      const visitId = await draftedVisit();
      expect((await completeAndSignConsultation(ctxFor(A.owner), visitId)).success).toBe(true);
      const res = await bill(A.doctor, visitId);
      expect(res.success).toBe(false);
      expect(await invoiceCount(visitId)).toBe(0);
    });
  });

  describe("IR2-L4 / IR-L3: staff edit by an admin", () => {
    async function memberRow(m: SeededTenant) {
      const { data } = await admin
        .from("memberships")
        .select("id, full_name, phone, role, qualifications, medical_council_reg_no")
        .eq("tenant_id", m.tenantId)
        .eq("user_id", m.userId)
        .single();
      return data as {
        id: string;
        full_name: string | null;
        phone: string | null;
        role: string;
        qualifications: string | null;
        medical_council_reg_no: string | null;
      };
    }

    it("an admin clearing a doctor's credentials gets an explicit refusal and nothing changes", async () => {
      await admin
        .from("memberships")
        .update({ qualifications: "MBBS (synthetic)", medical_council_reg_no: "SYN-REG-1" })
        .eq("tenant_id", A.doctor.tenantId)
        .eq("user_id", A.doctor.userId);
      const adminMember = await addMemberToTenant(A.owner.tenantId, "admin");
      const before = await memberRow(A.doctor);

      for (const patch of [{ qualifications: "" }, { qualifications: null }, { medical_council_reg_no: "" }]) {
        const res = await updateStaffMember(ctxFor(adminMember), {
          membership_id: before.id,
          full_name: before.full_name ?? "Synthetic Doctor",
          role: "doctor",
          qualifications: before.qualifications,
          medical_council_reg_no: before.medical_council_reg_no,
          ...patch,
        } as never);
        expect(res.success, JSON.stringify(patch)).toBe(false);
        if (!res.success) expect(res.error).toBe(CREDENTIALS_SELF_OR_OWNER_MESSAGE);
      }
      expect(await memberRow(A.doctor)).toEqual(before);

      // Unchanged credentials (or none sent) still save the rest of the profile.
      const ok = await updateStaffMember(ctxFor(adminMember), {
        membership_id: before.id,
        full_name: "Synthetic Doctor Renamed",
        role: "doctor",
        qualifications: before.qualifications,
        medical_council_reg_no: before.medical_council_reg_no,
      } as never);
      expect(ok.success).toBe(true);
      const after = await memberRow(A.doctor);
      expect(after.full_name).toBe("Synthetic Doctor Renamed");
      expect(after.qualifications).toBe("MBBS (synthetic)");
    });

    it("IR-L3: an admin's role change to or from owner/admin is refused before any write", async () => {
      const adminMember = await addMemberToTenant(A.owner.tenantId, "admin");
      const otherAdmin = await addMemberToTenant(A.owner.tenantId, "admin");
      const before = await memberRow(otherAdmin);
      const res = await updateStaffMember(ctxFor(adminMember), {
        membership_id: before.id,
        full_name: "Renamed By Admin",
        role: "receptionist",
      } as never);
      expect(res.success).toBe(false);
      expect(await memberRow(otherAdmin)).toEqual(before);
    });

    it("IR-L3: an invalid profile with a role change leaves the role unchanged", async () => {
      const adminMember = await addMemberToTenant(A.owner.tenantId, "admin");
      const nurse = await addMemberToTenant(A.owner.tenantId, "nurse");
      const before = await memberRow(nurse);
      const res = await updateStaffMember(ctxFor(adminMember), {
        membership_id: before.id,
        full_name: before.full_name ?? "Synthetic Nurse",
        phone: "12345",
        role: "receptionist",
      } as never);
      expect(res.success).toBe(false);
      expect((await memberRow(nurse)).role).toBe("nurse");
    });

    it("IR-L3: when the profile write fails, the role RPC is never called", async () => {
      const rpcSpy = vi.fn(async () => ({ data: null, error: null }));
      const existing = {
        id: "0f0f0f0f-0000-4000-8000-0000000000f0",
        tenant_id: A.owner.tenantId,
        user_id: A.receptionist.userId,
        role: "receptionist",
        full_name: "Synthetic",
        phone: null,
        qualifications: null,
        medical_council_reg_no: null,
      };
      let call = 0;
      const fakeDb = {
        from: () => {
          const chain: Record<string, unknown> = {};
          for (const m of ["select", "eq", "update"]) chain[m] = () => chain;
          chain.single = async () =>
            call++ === 0 ? { data: existing, error: null } : { data: null, error: { code: "23514" } };
          return chain;
        },
        rpc: rpcSpy,
      };
      const res = await updateStaffMember(
        { ...ctxFor(A.owner), db: fakeDb as never },
        { membership_id: existing.id, full_name: "Synthetic", role: "nurse" } as never
      );
      expect(res.success).toBe(false);
      expect(rpcSpy).not.toHaveBeenCalled();
    });
  });

  describe("AR2-Info (I2): the v1 visit PATCH never returns or logs database text", () => {
    it("a database error on update answers a fixed message and logs only the error code", async () => {
      vi.stubEnv("API_V1_ENABLED", "true");
      try {
        const secret = createApiKeySecret();
        await insertRow("api_keys", {
          tenant_id: A.owner.tenantId,
          name: "Synthetic Review2 Key",
          key_prefix: secret.keyPrefix,
          key_hash: secret.keyHash,
          created_by: A.owner.userId,
        });
        const visitId = await freshVisit(A, "in_consultation");
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

        // investigations_advised is text[]; a number is not an array literal, so PostgREST returns a 22P02 error.
        const res = await patchV1Visit(
          new NextRequest(`http://localhost/api/v1/visits/${visitId}`, {
            method: "PATCH",
            headers: { authorization: `Bearer ${secret.rawToken}`, "content-type": "application/json" },
            body: JSON.stringify({ investigations_advised: 12345 }),
          }),
          { params: Promise.resolve({ id: visitId }) }
        );
        expect(res.status).toBe(500);
        const body = await res.text();
        expect(body).not.toMatch(/malformed|array literal|12345/i);
        // V2-03 03-09c: the server log is lib/log on stderr; it names the event and the code, never the message.
        const logged = JSON.stringify([...errSpy.mock.calls, ...stderrSpy.mock.calls]);
        expect(logged).not.toMatch(/malformed|array literal/i);
        expect(logged).toContain('\\"event\\":\\"api.visit_update.failed\\"');
        expect(logged).toContain('\\"code\\":\\"22P02\\"');
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
