/**
 * V2-05 05-10a (SUB-02, SUB §6.2/§7.2; acceptance 8 app half; R-27, R-28, R-29; SUB-D6). The app's stops for a clinic
 * whose access level is not `full`, on the local stack with real sessions:
 *   - a server action of a locked clinic answers the fixed SUBSCRIPTION_LOCKED text (requirePermission and
 *     resolveServiceContext paths), while the owner's billing overview still answers (access "billing");
 *   - `requireEntitlement("ai.scribe")` is true for a trialing clinic and false for an active Standard one (PO-21, PO-25);
 *   - `/api/v1` answers 402 SUBSCRIPTION_LOCKED for a key of a locked clinic (after the key is authenticated);
 *   - every signed URL lives at most 300 s (an export 900 s), clamped in lib/storage whatever the caller asks; a share
 *     view's signed URL carries a 300 s token;
 *   - an `expired` clinic's prescription share link resolves to metadata only and signs nothing; its receipt link and
 *     every link of a locked trial clinic read `clinic_unavailable`; a reschedule link answers the neutral text;
 *   - the job claim cancels a due `message.send` job of a locked clinic (`tenant_not_full`) and never hands it to a
 *     handler, while a full clinic's job in the same pass runs.
 * Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { authenticateApiKey, createApiKeySecret } from "@/lib/api/auth";
import { DEFAULT_APP_ERROR_MESSAGES } from "@/lib/errors/app-error";
import { clampSignedUrlTtl, SIGNED_URL_MAX_TTL_SECONDS } from "@/lib/storage/types";
import { getSignedUrl } from "@/lib/storage";
import type { StorageProvider, StorageSignedUrlOptions } from "@/lib/storage/types";
import { SupabaseStorageProvider } from "@/lib/storage/supabase-provider";
import { CLINIC_UNAVAILABLE_MESSAGE, DOCUMENT_LINK_KINDS, resolveShareToken } from "@/features/sharing/public-links";
import { signSharedObject } from "@/features/sharing/system";
import { runJobs } from "@/lib/jobs/internal/runner";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
import { seedTenantSubscription, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { enableApiV1ForFile } from "../helpers/api-v1";
import { deleteRunnerRuns, deleteTenants, insertTenant, letters } from "../jobs/helpers";
// vi.mock below is hoisted above these imports: the actions resolve the session through the mocked user client.
import { inviteStaff } from "@/features/staff/actions";
import { listApiKeys } from "@/features/api-keys/actions";
import { getSubscriptionOverview } from "@/features/billing/subscription";
import { requireEntitlement } from "@/lib/entitlements/require-entitlement";
import { GET as rescheduleGet } from "@/app/api/reschedule/[token]/route";

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => state.client };
});

enableApiV1ForFile();

const admin = getAdminClient();
const LOCKED = DEFAULT_APP_ERROR_MESSAGES.SUBSCRIPTION_LOCKED;
const WORKER = `test:lock-${letters(6)}`;
const jobTenants: string[] = [];
let trialing: SeededTenant;
let active: SeededTenant;
let expired: SeededTenant;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function uuid(v: string): string {
  if (!UUID.test(v)) throw new Error("not a uuid");
  return v;
}

/** A booked visit of the clinic's owner (tomorrow) with a patient; returns ids. */
async function seedVisit(t: SeededTenant): Promise<{ patientId: string; visitId: string }> {
  const { data: patient, error: pErr } = await admin
    .from("patients")
    .insert({ tenant_id: t.tenantId, full_name: `Synthetic Lock Patient ${letters(5)}`, phone: `+9190000${randomBytes(2).readUInt16BE() % 90000 + 10000}`, created_by: t.userId })
    .select("id")
    .single();
  if (pErr || !patient) throw new Error(`patient seed failed: ${pErr?.code}`);
  const { data: visit, error: vErr } = await admin
    .from("visits")
    .insert({
      tenant_id: t.tenantId,
      patient_id: patient.id,
      doctor_id: t.userId,
      origin_type: "scheduled",
      created_by: t.userId,
      status: "booked",
      scheduled_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  if (vErr || !visit) throw new Error(`visit seed failed: ${vErr?.code}`);
  return { patientId: patient.id, visitId: visit.id };
}

beforeAll(async () => {
  trialing = await seedTenantWithOwner(`Lock Trialing Clinic ${letters(5)}`);
  active = await seedTenantWithOwner(`Lock Active Clinic ${letters(5)}`);
  await seedTenantSubscription(active.tenantId, { status: "active" });
  expired = await seedTenantWithOwner(`Lock Expired Clinic ${letters(5)}`);
});

afterAll(() => {
  deleteRunnerRuns(WORKER);
  deleteTenants(jobTenants);
});

describe("server actions of a locked clinic (assertTenantAccess)", () => {
  it("full: the actions answer; locked: SUBSCRIPTION_LOCKED on both guard paths; the billing overview still answers", async () => {
    state.client = expired.client;
    expect((await listApiKeys()).success).toBe(true);
    const email = `lock-${letters(8)}@example.test`;
    expect(await inviteStaff({ email, role: "nurse" })).toMatchObject({ success: true });

    await seedTenantSubscription(expired.tenantId, { status: "expired" });
    // resolveServiceContext path
    expect(await listApiKeys()).toEqual({ success: false, keys: [], error: LOCKED });
    // requirePermission path
    expect(await inviteStaff({ email: `lock-${letters(8)}@example.test`, role: "nurse" })).toEqual({ success: false, error: LOCKED });
    // The owner of the locked clinic still sees the subscription (billing access, SUB §6.2).
    const overview = await getSubscriptionOverview();
    expect(overview).toMatchObject({ subscription: { status: "expired" }, accessLevel: "locked" });
  });
});

describe("requireEntitlement (PO-21, PO-25)", () => {
  it("trialing has ai.scribe; active Standard does not", async () => {
    state.client = trialing.client;
    expect(await requireEntitlement("ai.scribe")).toBe(true);
    state.client = active.client;
    expect(await requireEntitlement("ai.scribe")).toBe(false);
    expect(await requireEntitlement("no.such_key")).toBe(false);
  });
});

describe("/api/v1 (R-28)", () => {
  async function seedKey(tenantId: string, createdBy: string): Promise<string> {
    const secret = createApiKeySecret();
    const { error } = await admin.from("api_keys").insert({
      tenant_id: tenantId,
      name: `Synthetic lock key ${letters(5)}`,
      key_prefix: secret.keyPrefix,
      key_hash: secret.keyHash,
      created_by: createdBy,
    });
    if (error) throw new Error(`seed api key failed: ${error.code}`);
    return secret.rawToken;
  }
  const auth = (raw: string) =>
    authenticateApiKey(new NextRequest("http://localhost/api/v1/patients", { headers: { authorization: `Bearer ${raw}` } }), () => admin);

  it("a key of a locked clinic answers 402 SUBSCRIPTION_LOCKED; a full clinic's key authenticates", async () => {
    const okKey = await seedKey(trialing.tenantId, trialing.userId);
    expect((await auth(okKey)).success).toBe(true);

    const lockedClinic = await seedTenantWithOwner(`Lock Api Clinic ${letters(5)}`);
    const lockedKey = await seedKey(lockedClinic.tenantId, lockedClinic.userId);
    await seedTenantSubscription(lockedClinic.tenantId, { status: "expired" });
    const before = psql(`select coalesce(sum(request_count), 0) from public.api_key_usage_daily where tenant_id = '${uuid(lockedClinic.tenantId)}'`)[0];
    const result = await auth(lockedKey);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.response.status).toBe(402);
    expect(((await result.response.json()) as { error: { code: string } }).error.code).toBe("SUBSCRIPTION_LOCKED");
    // Refused before anything was counted.
    expect(psql(`select coalesce(sum(request_count), 0) from public.api_key_usage_daily where tenant_id = '${uuid(lockedClinic.tenantId)}'`)[0]).toBe(before);
  });
});

describe("signed-URL lifetimes (R-29)", () => {
  it("clampSignedUrlTtl: views at most 300 s, exports at most 900 s, unset = the cap", () => {
    expect(SIGNED_URL_MAX_TTL_SECONDS).toEqual({ view: 300, export: 900 });
    expect(clampSignedUrlTtl(3600)).toBe(300);
    expect(clampSignedUrlTtl(60)).toBe(60);
    expect(clampSignedUrlTtl(undefined)).toBe(300);
    expect(clampSignedUrlTtl(3600, "export")).toBe(900);
    expect(clampSignedUrlTtl(0)).toBe(1);
    expect(clampSignedUrlTtl(Number.NaN)).toBe(300);
  });

  it("getSignedUrl and the Supabase provider never sign for longer than the cap", async () => {
    const seen: StorageSignedUrlOptions[] = [];
    const recorder: StorageProvider = {
      name: "recorder",
      upload: async () => ({ path: "", bucket: "" }),
      createSignedUrl: async (o) => {
        seen.push(o);
        return { signedUrl: "http://127.0.0.1/signed" };
      },
      delete: async () => ({ success: true }),
      download: async () => Buffer.from(""),
    };
    const key = `tenants/${trialing.tenantId}/patients/${trialing.tenantId}/labs/${trialing.tenantId}.pdf`;
    await getSignedUrl({ path: key, bucket: "clinic-records", expiresInSeconds: 3600 }, recorder);
    await getSignedUrl({ path: key, bucket: "clinic-records", expiresInSeconds: 3600, purpose: "export" }, recorder);
    expect(seen.map((o) => o.expiresInSeconds)).toEqual([300, 900]);

    const asked: number[] = [];
    const fakeClient = {
      storage: {
        from: () => ({
          createSignedUrl: async (_path: string, expiresIn: number) => {
            asked.push(expiresIn);
            return { data: { signedUrl: "http://127.0.0.1/s" }, error: null };
          },
        }),
      },
    };
    const provider = new SupabaseStorageProvider({ defaultBucket: "clinic-records", client: fakeClient as never });
    await provider.createSignedUrl({ path: key, expiresInSeconds: 86_400 });
    await provider.createSignedUrl({ path: key });
    expect(asked).toEqual([300, 300]);
  });
});

describe("public links of a clinic that is not full (SUB-D6)", () => {
  let token: string;
  let receiptToken: string;
  let shareClinic: SeededTenant;

  beforeAll(async () => {
    shareClinic = await seedTenantWithOwner(`Lock Share Clinic ${letters(5)}`);
    const { patientId, visitId } = await seedVisit(shareClinic);
    const { data: rx, error: rxErr } = await admin
      .from("prescriptions")
      .insert({ tenant_id: shareClinic.tenantId, visit_id: visitId, patient_id: patientId, doctor_id: shareClinic.userId })
      .select("id")
      .single();
    if (rxErr || !rx) throw new Error(`prescription seed failed: ${rxErr?.code}`);
    const { data: inv, error: invErr } = await admin
      .from("invoices")
      .insert({ tenant_id: shareClinic.tenantId, visit_id: visitId, patient_id: patientId, invoice_number: `LCK-${letters(4)}`, total_amount: 100, status: "issued" })
      .select("id")
      .single();
    if (invErr || !inv) throw new Error(`invoice seed failed: ${invErr?.code}`);
    // The Rx PDF object exists, so a full clinic's link signs it.
    const path = `${shareClinic.tenantId}/${visitId}/rx_v1.pdf`;
    expect((await admin.storage.from("prescriptions").upload(path, Buffer.from("%PDF-1.4 synthetic"), { contentType: "application/pdf" })).error).toBeNull();
    expect((await admin.from("prescriptions").update({ pdf_storage_path: path }).eq("id", rx.id)).error).toBeNull();

    const rxShare = await shareClinic.client.rpc("create_share_token", { p_resource_type: "prescription", p_resource_id: rx.id });
    if (rxShare.error) throw new Error(`share token failed: ${rxShare.error.code}`);
    token = (rxShare.data as Array<{ token: string }>)[0].token;
    const invShare = await shareClinic.client.rpc("create_share_token", { p_resource_type: "invoice", p_resource_id: inv.id });
    if (invShare.error) throw new Error(`receipt token failed: ${invShare.error.code}`);
    receiptToken = (invShare.data as Array<{ token: string }>)[0].token;
  });

  it("full: the prescription resolves with access full and signs a URL whose token lives 300 s", async () => {
    const resolved = await resolveShareToken(token, DOCUMENT_LINK_KINDS);
    expect(resolved).toMatchObject({ status: "ok", document: { resource_type: "prescription", access: "full" } });
    const signed = await signSharedObject(token, DOCUMENT_LINK_KINDS);
    expect(signed).not.toBeNull();
    const jwt = new URL(signed!.signedUrl).searchParams.get("token") ?? "";
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")) as { iat: number; exp: number };
    expect(payload.exp - payload.iat).toBe(300);
  });

  it("expired: the prescription resolves to metadata only (restricted, no file); the receipt is unavailable", async () => {
    await seedTenantSubscription(shareClinic.tenantId, { status: "expired" });
    const before = psql(`select access_count from public.document_share_tokens where tenant_id = '${uuid(shareClinic.tenantId)}' and resource_type = 'prescription'`)[0];
    const resolved = await resolveShareToken(token, DOCUMENT_LINK_KINDS);
    expect(resolved).toMatchObject({ status: "ok", document: { resource_type: "prescription", restricted: true, access: "locked" } });
    expect(await signSharedObject(token, DOCUMENT_LINK_KINDS)).toBeNull();
    expect(psql(`select access_count from public.document_share_tokens where tenant_id = '${uuid(shareClinic.tenantId)}' and resource_type = 'prescription'`)[0]).toBe(before);
    expect(await resolveShareToken(receiptToken, DOCUMENT_LINK_KINDS)).toEqual({ status: "clinic_unavailable" });
    expect(await signSharedObject(receiptToken, DOCUMENT_LINK_KINDS)).toBeNull();
  });

  it("a locked trial clinic (not expired): even the prescription is unavailable", async () => {
    await seedTenantSubscription(shareClinic.tenantId, { status: "trialing", accessEndsAt: new Date(Date.now() - 3_600_000) });
    expect(await resolveShareToken(token, DOCUMENT_LINK_KINDS)).toEqual({ status: "clinic_unavailable" });
  });

  it("a reschedule link of a locked clinic answers the neutral text and moves nothing", async () => {
    const clinic = await seedTenantWithOwner(`Lock Reschedule Clinic ${letters(5)}`);
    const { visitId } = await seedVisit(clinic);
    const { data: raw, error } = await admin.rpc("create_reschedule_token", { p_visit_id: visitId });
    if (error || typeof raw !== "string") throw new Error(`reschedule token failed: ${error?.code}`);
    const call = () =>
      rescheduleGet(new NextRequest(`http://localhost/api/reschedule/${raw}?date=${new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)}`), {
        params: Promise.resolve({ token: raw }),
      });
    expect((await call()).status).toBe(200);
    await seedTenantSubscription(clinic.tenantId, { status: "expired" });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: CLINIC_UNAVAILABLE_MESSAGE });
  });
});

describe("jobs of a clinic that is not full are cancelled at claim time (R-27)", () => {
  it("a due message.send job of a locked clinic is cancelled and never handled; a full clinic's job runs", async () => {
    const locked = insertTenant(`lock locked ${letters(5).toLowerCase()}`);
    const full = insertTenant(`lock full ${letters(5).toLowerCase()}`);
    jobTenants.push(locked, full);
    psql(`update public.tenant_subscriptions set access_ends_at = now() - interval '1 hour' where tenant_id = '${uuid(locked)}'`);
    const enqueue = (tenant: string) =>
      psql(
        `select ops.enqueue_job('message.send', '${uuid(tenant)}', jsonb_build_object('communication_id', gen_random_uuid()), ` +
          `'lock-spec:${uuid(tenant)}', now() - interval '1 second', 5)`,
      )[0];
    const lockedJob = enqueue(locked);
    const fullJob = enqueue(full);
    // Other files' due message.send jobs wait a day, so this pass handles only this spec's two jobs.
    psql(
      "update ops.jobs set run_at = now() + interval '1 day' where kind = 'message.send' and status = 'pending' " +
        `and run_at <= now() and tenant_id not in ('${uuid(locked)}', '${uuid(full)}')`,
    );

    const handled: string[] = [];
    const result = await runJobs({
      db: admin,
      budgetMs: 20_000,
      batch: 10,
      leaseSeconds: 60,
      perTenant: 10,
      worker: WORKER,
      source: "test",
      kinds: ["message.send"],
      handlers: {
        "message.send": {
          schema: { safeParse: (v: unknown) => ({ success: true, data: v }) } as never,
          maxDurationMs: 1_000,
          run: async (job) => {
            handled.push(job.id);
            return { outcome: "done" };
          },
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(handled).toEqual([fullJob]);
    const rows = psql(
      `select id || '|' || status || '|' || coalesce(last_error, '') || '|' || (finished_at is not null) from ops.jobs where id in ('${uuid(lockedJob)}', '${uuid(fullJob)}') order by status`,
    );
    expect(rows.sort()).toEqual([`${fullJob}|done||true`, `${lockedJob}|cancelled|tenant_not_full|true`].sort());
  });
});
