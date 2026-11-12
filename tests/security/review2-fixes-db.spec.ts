import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { seedTenantWithOwner, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { shareTokenHash } from "../helpers/share-tokens";
import { GET as getDocumentRoute } from "@/app/api/r/[token]/route";
import { POST as postRescheduleRoute } from "@/app/api/reschedule/[token]/route";
import { generateRescheduleToken } from "@/features/appointments/system";
import * as dispatcher from "@/lib/messaging/dispatcher";

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
    anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (A.receptionist.client.from("patient_documents") as any)
          .update({ storage_path })
          .eq("id", A.documentId);
        expect(error?.code, storage_path).toBe("23514");
      }
      const { data } = await admin.from("patient_documents").select("storage_path").eq("id", A.documentId).single();
      expect((data as { storage_path: string }).storage_path).toBe(A.documentPath);

      // Nothing the attacker can mint signs B's object.
      const token = await mint(A.receptionist.client as SupabaseClient, "patient_document", A.documentId);
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

      // Every column of every token row a receptionist can see: the raw token appears nowhere.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows, error } = await (A.receptionist.client.from("document_share_tokens") as any).select("*");
      expect(error).toBeNull();
      const mine = (rows ?? []).filter((r: { token_hash: string }) => r.token_hash === shareTokenHash(token));
      expect(mine).toHaveLength(1);
      expect(mine[0].resource_type).toBe("prescription");
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(Object.keys(mine[0])).not.toContain("token");

      // The raw column is gone, for members and for the service role.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = await (A.receptionist.client.from("document_share_tokens") as any).select("token").limit(1);
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
      vi.spyOn(dispatcher, "enqueueMessage").mockResolvedValue({ id: "msg-syn" } as never);
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
});
