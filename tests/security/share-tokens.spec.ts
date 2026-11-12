import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { GET as getDocumentRoute } from "@/app/api/r/[token]/route";
import { GET as getReportRoute } from "@/app/api/reports/view/route";
import { GET as getRescheduleRoute, POST as postRescheduleRoute } from "@/app/api/reschedule/[token]/route";
import { generateRescheduleToken } from "@/features/appointments/system";
import * as dispatcher from "@/lib/messaging/dispatcher";
import { shareTokenHash } from "../helpers/share-tokens";

// V2-01 plan 01-04 (P0-04; SEC-05, ARC-05, F7(a)); SECURITY_VERIFICATION_PLAN TC-TOK-01..06. Local stack, real
// clients; the admin client only seeds rows (including deliberately mis-bound tokens) and reads results.

type RpcFn = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  return (client.rpc as unknown as RpcFn).call(client, name, args);
}

interface ClinicResources {
  owner: SeededTenant;
  patientId: string;
  visitId: string;
  documentId: string;
  documentPath: string;
  prescriptionId: string;
  invoiceId: string;
  referralId: string;
}

const admin = getAdminClient();

async function insertRow(table: string, row: Record<string, unknown>): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from(table as never) as any).insert(row).select("id").single();
  if (error || !data) throw new Error(`seed ${table} failed: ${error?.message}`);
  return data.id as string;
}

async function seedClinic(label: string): Promise<ClinicResources> {
  const owner = await seedTenantWithOwner(`Share ${label} ${randomUUID().slice(0, 8)}`);
  const t = owner.tenantId;
  const patientId = await insertRow("patients", {
    tenant_id: t,
    full_name: `Synthetic Patient ${label}`,
    phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
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
  const documentPath = `tenants/${t}/patients/${patientId}/labs/synthetic_${randomUUID().slice(0, 8)}.pdf`;
  const documentId = await insertRow("patient_documents", {
    tenant_id: t,
    patient_id: patientId,
    title: `Synthetic Report ${label}`,
    original_filename: "synthetic.pdf",
    storage_path: documentPath,
    file_size_bytes: 12,
    mime_type: "application/pdf",
    uploaded_by: owner.userId,
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
  const referralId = await insertRow("referrals", {
    tenant_id: t,
    patient_id: patientId,
    referral_type: "out_of_network",
    referring_doctor_id: owner.userId,
    referred_to_name: "Synthetic Specialist",
    reason_for_referral: "Synthetic reason",
  });
  return { owner, patientId, visitId, documentId, documentPath, prescriptionId, invoiceId, referralId };
}

async function seedToken(row: Record<string, unknown>): Promise<string> {
  const token = randomBytes(32).toString("hex");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("document_share_tokens") as any).insert({
    token_hash: shareTokenHash(token),
    ...row,
  });
  if (error) throw new Error(`seed token failed: ${error.message}`);
  return token;
}

async function tokenRow(token: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin.from("document_share_tokens") as any)
    .select("tenant_id, resource_type, resource_id, created_by, access_count, revoked_at")
    .eq("token_hash", shareTokenHash(token))
    .single();
  return data as {
    tenant_id: string;
    resource_type: string;
    resource_id: string;
    created_by: string | null;
    access_count: number;
    revoked_at: string | null;
  };
}

function docGet(token: string, query = "") {
  return getDocumentRoute(new NextRequest(`http://localhost:3000/api/r/${token}${query}`), {
    params: Promise.resolve({ token }),
  });
}
function reportGet(token: string, query = "") {
  return getReportRoute(new NextRequest(`http://localhost:3000/api/reports/view?token=${token}${query}`));
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

/** Body must not carry internal identifiers or storage keys. */
function expectNoInternals(body: string, a: ClinicResources, b?: ClinicResources) {
  for (const c of [a, b].filter(Boolean) as ClinicResources[]) {
    for (const id of [c.owner.tenantId, c.patientId, c.visitId, c.documentId, c.prescriptionId, c.invoiceId, c.referralId]) {
      expect(body).not.toContain(id);
    }
    expect(body).not.toContain(c.documentPath);
  }
  expect(body).not.toMatch(/"(tenant_id|resource_id|storage_path|_storage_path|_bucket|patient_phone)"/);
}

describe("P0-04 share tokens: token-scoped RPCs bound to tenant and resource_type (000020)", () => {
  let A: ClinicResources;
  let B: ClinicResources;
  let anon: SupabaseClient;

  beforeAll(async () => {
    A = await seedClinic("A");
    B = await seedClinic("B");
    anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // A real object for tenant A's lab document so the signing path is exercised.
    const { error } = await admin.storage
      .from("clinic-records")
      .upload(A.documentPath, Buffer.from("%PDF-1.4 syn"), { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(`storage seed failed: ${error.message}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TC-TOK-01: members cannot write tokens directly", () => {
    it("insert, un-revoke, extend and delete are refused; the row is unchanged", async () => {
      const client = A.owner.client;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insErr } = await (client.from("document_share_tokens") as any).insert({
        tenant_id: A.owner.tenantId,
        resource_type: "prescription",
        resource_id: B.prescriptionId,
        token_hash: shareTokenHash(randomBytes(32).toString("hex")),
        created_by: A.owner.userId,
      });
      expect(insErr?.code).toBe("42501");

      const token = await seedToken({
        tenant_id: A.owner.tenantId,
        resource_type: "prescription",
        resource_id: A.prescriptionId,
        created_by: A.owner.userId,
        revoked_at: new Date().toISOString(),
      });
      for (const patch of [{ revoked_at: null }, { expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString() }]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (client.from("document_share_tokens") as any)
          .update(patch)
          .eq("token_hash", shareTokenHash(token));
        expect(error?.code).toBe("42501");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: delErr } = await (client.from("document_share_tokens") as any)
        .delete()
        .eq("token_hash", shareTokenHash(token));
      expect(delErr?.code).toBe("42501");
      expect((await tokenRow(token)).revoked_at).not.toBeNull();

      // Members can still read their own tenant's token rows (hash and state only; AR2-L1).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: visible } = await (client.from("document_share_tokens") as any)
        .select("id, token_hash")
        .eq("token_hash", shareTokenHash(token));
      expect(visible).toHaveLength(1);
    });

    it("create_share_token refuses another tenant's resource and mints one for the caller's own", async () => {
      const cross = await rpc(A.owner.client, "create_share_token", {
        p_resource_type: "prescription",
        p_resource_id: B.prescriptionId,
      });
      expect(cross.error?.message).toContain("not_found");

      const own = await rpc(A.owner.client, "create_share_token", {
        p_resource_type: "prescription",
        p_resource_id: A.prescriptionId,
      });
      expect(own.error).toBeNull();
      const minted = (own.data as Array<{ token: string }>)[0].token;
      expect(minted).toMatch(/^[0-9a-f]{64}$/);
      const row = await tokenRow(minted);
      expect(row).toMatchObject({
        tenant_id: A.owner.tenantId,
        resource_type: "prescription",
        resource_id: A.prescriptionId,
        created_by: A.owner.userId,
      });

      const appt = await rpc(A.owner.client, "create_share_token", {
        p_resource_type: "appointment",
        p_resource_id: A.visitId,
      });
      expect(appt.error?.message).toContain("invalid_resource_type");
    });

    it("an anon client cannot mint tokens, call the service-only RPCs, or read tokens", async () => {
      for (const [name, args] of [
        ["create_share_token", { p_resource_type: "prescription", p_resource_id: A.prescriptionId }],
        ["create_reschedule_token", { p_visit_id: A.visitId }],
        ["share_token_object", { p_token: "a".repeat(64), p_kinds: ["prescription"] }],
        ["reschedule_token_visit", { p_token: "a".repeat(64) }],
        ["share_resource_tenant", { p_type: "prescription", p_id: A.prescriptionId }],
      ] as const) {
        const { error } = await rpc(anon, name, args);
        expect(error?.code, name).toBe("42501");
      }
      const { data } = await anon.from("document_share_tokens").select("id, token_hash");
      expect(data ?? []).toHaveLength(0);
    });
  });

  describe("TC-TOK-02/03: tenant and resource_type binding (cross-tenant token returns 404)", () => {
    it("a tenant-A token pointing at tenant B's prescription is a 404 with no signed URL", async () => {
      const token = await seedToken({
        tenant_id: A.owner.tenantId,
        resource_type: "prescription",
        resource_id: B.prescriptionId,
        created_by: A.owner.userId,
      });
      for (const res of [await docGet(token), await docGet(token, "?download=true")]) {
        expect(res.status).toBe(404);
        const body = await res.text();
        expect(body).not.toContain("signed");
        expectNoInternals(body, A, B);
      }
      expect((await tokenRow(token)).access_count).toBe(0);
    });

    it("a tenant-A token pointing at tenant B's lab document is a 404 on the report view", async () => {
      const token = await seedToken({
        tenant_id: A.owner.tenantId,
        resource_type: "patient_document",
        document_id: B.documentId,
        resource_id: B.documentId,
        created_by: A.owner.userId,
      });
      const res = await reportGet(token);
      expect(res.status).toBe(404);
      expectNoInternals(await res.text(), A, B);
      expect((await docGet(token)).status).toBe(404);
    });

    it("the cross-tenant 404 is identical to the missing-token 404 (no oracle)", async () => {
      const cross = await seedToken({
        tenant_id: A.owner.tenantId,
        resource_type: "invoice",
        resource_id: B.invoiceId,
        created_by: A.owner.userId,
      });
      const missing = randomBytes(32).toString("hex");
      const [r1, r2] = [await docGet(cross), await docGet(missing)];
      expect(r1.status).toBe(404);
      expect(r2.status).toBe(404);
      expect(await r1.text()).toBe(await r2.text());
    });

    it("type confusion: a prescription token on /api/reschedule and an appointment token on /api/r are 404", async () => {
      const rxToken = await seedToken({
        tenant_id: A.owner.tenantId,
        resource_type: "prescription",
        resource_id: A.prescriptionId,
        created_by: A.owner.userId,
      });
      expect((await rescheduleGet(rxToken)).status).toBe(404);
      expect((await reschedulePost(rxToken, new Date(Date.now() + 5 * 86_400_000).toISOString())).status).toBe(404);
      // A prescription token's resource id that happens to be a visit id is not resolved as a visit either.
      const visitAsRx = await seedToken({
        tenant_id: A.owner.tenantId,
        resource_type: "prescription",
        resource_id: A.visitId,
        created_by: A.owner.userId,
      });
      expect((await rescheduleGet(visitAsRx)).status).toBe(404);

      const { data: apptToken } = await rpc(admin as unknown as SupabaseClient, "create_reschedule_token", {
        p_visit_id: A.visitId,
      });
      expect((await docGet(apptToken as string)).status).toBe(404);
      expect((await reportGet(apptToken as string)).status).toBe(404);
    });

    it("a prescription token with document_id set resolves only the prescription; the report view refuses it", async () => {
      const token = await seedToken({
        tenant_id: A.owner.tenantId,
        resource_type: "prescription",
        resource_id: A.prescriptionId,
        document_id: A.documentId,
        created_by: A.owner.userId,
      });
      const res = await docGet(token);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.resource_type).toBe("prescription");
      expect(json.document.title).toBe("Official Prescription");
      expect((await reportGet(token)).status).toBe(404);
    });
  });

  describe("TC-TOK-04: expiry, revocation and access counting", () => {
    it("expired and revoked tokens get 410", async () => {
      const expired = await seedToken({
        tenant_id: A.owner.tenantId,
        resource_type: "patient_document",
        document_id: A.documentId,
        resource_id: A.documentId,
        created_by: A.owner.userId,
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      const revoked = await seedToken({
        tenant_id: A.owner.tenantId,
        resource_type: "patient_document",
        document_id: A.documentId,
        resource_id: A.documentId,
        created_by: A.owner.userId,
        revoked_at: new Date().toISOString(),
      });
      for (const t of [expired, revoked]) {
        expect((await docGet(t)).status).toBe(410);
        expect((await reportGet(t)).status).toBe(410);
        expect((await tokenRow(t)).access_count).toBe(0);
      }
    });

    it("each successful resolution increments access_count by exactly 1", async () => {
      const { data } = await rpc(A.owner.client, "create_share_token", {
        p_resource_type: "referral",
        p_resource_id: A.referralId,
      });
      const token = (data as Array<{ token: string }>)[0].token;
      expect((await tokenRow(token)).access_count).toBe(0);
      expect((await docGet(token)).status).toBe(200);
      expect((await tokenRow(token)).access_count).toBe(1);
      expect((await docGet(token)).status).toBe(200);
      expect((await tokenRow(token)).access_count).toBe(2);
    });
  });

  describe("happy paths still work and leak nothing beyond the page's needs", () => {
    it("lab report link: /api/reports/view returns metadata and a signed URL for the tenant's object", async () => {
      const { data } = await rpc(A.owner.client, "create_share_token", {
        p_resource_type: "patient_document",
        p_resource_id: A.documentId,
      });
      const token = (data as Array<{ token: string }>)[0].token;

      const res = await reportGet(token);
      expect(res.status).toBe(200);
      const text = await res.text();
      const json = JSON.parse(text);
      expect(json.document.title).toBe("Synthetic Report A");
      expect(json.patient_name).toBe("Synthetic Patient A");
      expect(json.signed_url).toMatch(/^https?:\/\/.+token=/);
      expect(json.clinic.name).toContain("Share A");
      expect(json.document.id).toBeUndefined();
      expectNoInternals(text.replace(json.signed_url, ""), A, B);

      const dl = await reportGet(token, "&download=true");
      expect(dl.status).toBe(302);
      expect(dl.headers.get("location")).toMatch(/^https?:\/\/.+token=/);
    });

    it.each(["prescription", "invoice", "referral", "patient_document"] as const)(
      "/api/r resolves a %s token of the caller's tenant",
      async (type) => {
        const id = {
          prescription: A.prescriptionId,
          invoice: A.invoiceId,
          referral: A.referralId,
          patient_document: A.documentId,
        }[type];
        const { data, error } = await rpc(A.owner.client, "create_share_token", {
          p_resource_type: type,
          p_resource_id: id,
        });
        expect(error).toBeNull();
        const token = (data as Array<{ token: string }>)[0].token;
        const res = await docGet(token);
        expect(res.status).toBe(200);
        const text = await res.text();
        const json = JSON.parse(text);
        expect(json.resource_type).toBe(type);
        expect(json.patient_name).toBe("Synthetic Patient A");
        expect(json.document.id).toBeUndefined();
        expect(json.clinic.id).toBeUndefined();
        expectNoInternals(text.replace(json.signed_url, ""), A, B);
      }
    );

    it("resolve_share_token called directly by anon returns display fields only", async () => {
      const { data } = await rpc(A.owner.client, "create_share_token", {
        p_resource_type: "patient_document",
        p_resource_id: A.documentId,
      });
      const token = (data as Array<{ token: string }>)[0].token;
      const res = await rpc(anon, "resolve_share_token", { p_token: token, p_kinds: ["patient_document"] });
      expect(res.error).toBeNull();
      const body = JSON.stringify(res.data);
      expect((res.data as { status: string }).status).toBe("ok");
      expectNoInternals(body, A, B);
    });
  });

  describe("TC-TOK-05/06: reschedule links", () => {
    it("create_reschedule_token: refused for user clients; service role mints an appointment token with no creator", async () => {
      const user = await rpc(A.owner.client, "create_reschedule_token", { p_visit_id: A.visitId });
      expect(user.error?.code).toBe("42501");

      const url = await generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, A.visitId);
      const token = url.split("/reschedule/")[1];
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(await tokenRow(token)).toMatchObject({
        tenant_id: A.owner.tenantId,
        resource_type: "appointment",
        resource_id: A.visitId,
        created_by: null,
      });

      await expect(
        generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, randomUUID())
      ).rejects.toThrow();
    });

    it("GET returns the reschedule context without ids or patient contact data", async () => {
      const url = await generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, B.visitId);
      const token = url.split("/reschedule/")[1];
      const res = await rescheduleGet(token);
      expect(res.status).toBe(200);
      const text = await res.text();
      const json = JSON.parse(text);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.available_slots)).toBe(true);
      expect(json.appointment.id).toBeUndefined();
      expect(json.appointment.patient_phone).toBeUndefined();
      expect(json.appointment.clinic.name).toContain("Share B");
      expectNoInternals(text, A, B);
    });

    it("single use: two concurrent POSTs give exactly one 200 and one 410; the visit moves once", async () => {
      const enqueueSpy = vi.spyOn(dispatcher, "enqueueMessage").mockResolvedValue({ id: "msg-syn" } as never);
      const url = await generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, A.visitId);
      const token = url.split("/reschedule/")[1];
      const t1 = new Date(Date.now() + 6 * 86_400_000);
      t1.setUTCHours(10, 0, 0, 0);
      const t2 = new Date(t1.getTime() + 30 * 60_000);

      const [r1, r2] = await Promise.all([reschedulePost(token, t1.toISOString()), reschedulePost(token, t2.toISOString())]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 410]);
      const winner = r1.status === 200 ? t1 : t2;

      const { data: visit } = await admin.from("visits").select("scheduled_at").eq("id", A.visitId).single();
      expect(new Date((visit as { scheduled_at: string }).scheduled_at).getTime()).toBe(winner.getTime());
      expect((await tokenRow(token)).revoked_at).not.toBeNull();

      const { data: notes } = await admin
        .from("in_app_notifications")
        .select("id, metadata")
        .eq("tenant_id", A.owner.tenantId)
        .eq("event_type", "appointment_rescheduled");
      const forToken = (notes ?? []).filter(
        (n: { metadata: { new_scheduled_at?: string } | null }) =>
          n.metadata?.new_scheduled_at && new Date(n.metadata.new_scheduled_at).getTime() === winner.getTime()
      );
      expect(forToken).toHaveLength(1);

      // A third attempt after the race is also refused.
      expect((await reschedulePost(token, t2.toISOString())).status).toBe(410);
      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      expect(enqueueSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ messageType: "appointment_rescheduled", tenantId: A.owner.tenantId })
      );
    });

    it("a past time is refused without consuming the token; an expired token is 410", async () => {
      const url = await generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, B.visitId);
      const token = url.split("/reschedule/")[1];
      expect((await reschedulePost(token, new Date(Date.now() - 3_600_000).toISOString())).status).toBe(400);
      expect((await tokenRow(token)).revoked_at).toBeNull();

      const expired = await seedToken({
        tenant_id: B.owner.tenantId,
        resource_type: "appointment",
        resource_id: B.visitId,
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      expect((await rescheduleGet(expired)).status).toBe(410);
      expect((await reschedulePost(expired, new Date(Date.now() + 86_400_000).toISOString())).status).toBe(410);
    });

    it("a token whose appointment lives in another tenant is a 404 and the visit is untouched", async () => {
      const { data: before } = await admin.from("visits").select("scheduled_at").eq("id", B.visitId).single();
      const cross = await seedToken({
        tenant_id: A.owner.tenantId,
        resource_type: "appointment",
        resource_id: B.visitId,
      });
      expect((await rescheduleGet(cross)).status).toBe(404);
      expect((await reschedulePost(cross, new Date(Date.now() + 9 * 86_400_000).toISOString())).status).toBe(404);
      const { data: after } = await admin.from("visits").select("scheduled_at").eq("id", B.visitId).single();
      expect(after).toEqual(before);
      expect((await tokenRow(cross)).revoked_at).toBeNull();
    });

    it("a completed appointment cannot be rescheduled", async () => {
      const visitId = await insertRow("visits", {
        tenant_id: B.owner.tenantId,
        patient_id: B.patientId,
        doctor_id: B.owner.userId,
        origin_type: "scheduled",
        status: "booked",
        scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
        created_by: B.owner.userId,
      });
      const url = await generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, visitId);
      const token = url.split("/reschedule/")[1];
      await admin.from("visits").update({ status: "completed" }).eq("id", visitId);

      expect((await rescheduleGet(token)).status).toBe(400);
      expect((await reschedulePost(token, new Date(Date.now() + 2 * 86_400_000).toISOString())).status).toBe(400);
      expect((await tokenRow(token)).revoked_at).toBeNull();
      await expect(generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, visitId)).rejects.toThrow();
    });
  });
});
