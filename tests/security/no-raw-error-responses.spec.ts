/**
 * V2-03 03-13d M-ERRMSG (review C M-3, 03-09c residual): server actions and routes never return a raw error message.
 * Database, driver and storage text can carry row values and patient names; responses carry a fixed text instead
 * (`clientErrorMessage`), and a permission refusal keeps its own fixed text. All values are synthetic.
 *
 * 1. A real database error that echoes caller input carrying a phone (22P02 `invalid input syntax for type uuid`).
 * 2. A real Storage failure on a lab key that carries a patient's name (the provider used to put the key in the
 *    message).
 * 3. Across the swept services: a client whose every call throws an error carrying a phone, an email and a
 *    storage key with a name; no response carries any of them.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "@/lib/auth/context";
import { getPatientConsultationHistory } from "@/features/consultation/service";
import { deleteLabDocument, generateDocumentShareToken, getDocumentSignedUrl, getPatientDocuments } from "@/features/labs/service";
import { getVisitPrescription, searchMedicines } from "@/features/prescriptions/service";
import { cancelVisit, confirmAppointment } from "@/features/visits/service";
import { deleteScheduleBlock } from "@/features/visits/scheduling-service";
import { getVisitDiagnoses, searchDiagnoses } from "@/features/terminology/service";
import { listApiKeys, revokeApiKey } from "@/features/api-keys/service";
import {
  deleteWebhookSubscription,
  listDeliveryLogs,
  listWebhookSubscriptions,
  testPingWebhook,
} from "@/features/webhooks/service";
import { grantConsent, withdrawConsent } from "@/features/patients/consent-service";
import { SupabaseStorageProvider } from "@/lib/storage";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor, mockCtx } from "../helpers/context";

const PHONE = "+919000000071";
const EMAIL = "synthetic.errmsg@example.com";
const NAME = "Synthetic_Errmsgname";
const SECRETS = [PHONE, "9000000071", EMAIL, NAME, "Synthetic Errmsgname"];
const ID = "7d1c0b9a-0000-4000-8000-0000000000e1";

function expectClean(error: string | undefined) {
  expect(typeof error).toBe("string");
  for (const value of SECRETS) expect(error).not.toContain(value);
}

describe("raw error text never reaches a response (03-13d M-ERRMSG)", () => {
  let owner: SeededTenant;
  let patientId: string;

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Errmsg Clinic");
    const { data, error } = await getAdminClient()
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic Errmsgname", phone: "9000000072", sex: "female", created_by: owner.userId })
      .select("id")
      .single();
    expect(error).toBeNull();
    patientId = data!.id;
  });

  it("a database error echoing a phone the caller sent is not returned (22P02)", async () => {
    const result = (await getPatientConsultationHistory(ctxFor(owner), PHONE)) as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expectClean(result.error);
  });

  it("a Storage failure on a key carrying the patient's name is not returned, and the provider never puts the key in its message", async () => {
    const storagePath = `tenants/${owner.tenantId}/patients/${patientId}/labs/${NAME}_cbc_2026-01-01.pdf`;
    const { data: doc, error } = await getAdminClient()
      .from("patient_documents")
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patientId,
        title: "Synthetic CBC",
        document_type: "lab_report",
        original_filename: `${NAME}_cbc.pdf`,
        storage_path: storagePath,
        file_size_bytes: 10,
        mime_type: "application/pdf",
        report_date: "2026-01-01",
        is_abnormal: false,
        uploaded_by: owner.userId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    // The object does not exist: Storage refuses to sign it.
    const result = await getDocumentSignedUrl(ctxFor(owner), doc!.id);
    expect(result.success).toBe(false);
    expectClean(result.error);

    const provider = new SupabaseStorageProvider({ client: owner.client, defaultBucket: "clinic-records" });
    const thrown = await provider.createSignedUrl({ path: storagePath, expiresInSeconds: 60 }).catch((e: Error) => e);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain(NAME);
    expect((thrown as Error).message).not.toContain(owner.tenantId);
  });

  /** A client whose every call throws an error carrying a phone, an email and a named storage key. */
  function throwingDb(): ServiceContext["db"] {
    const fail = () => {
      throw Object.assign(
        new Error(`connection reset for ${PHONE} ${EMAIL} tenants/x/patients/y/labs/${NAME}_cbc.pdf`),
        { details: `Key (phone)=(${PHONE}) already exists.` },
      );
    };
    const handler: ProxyHandler<() => void> = { get: () => proxy, apply: fail };
    const proxy: unknown = new Proxy(() => undefined, handler);
    return proxy as ServiceContext["db"];
  }

  const calls: Array<[string, (ctx: ServiceContext) => Promise<{ error?: string } | unknown>]> = [
    ["consultation.getPatientConsultationHistory", (ctx) => getPatientConsultationHistory(ctx, ID)],
    ["labs.getPatientDocuments", (ctx) => getPatientDocuments(ctx, ID)],
    ["labs.getDocumentSignedUrl", (ctx) => getDocumentSignedUrl(ctx, ID)],
    ["labs.generateDocumentShareToken", (ctx) => generateDocumentShareToken(ctx, ID)],
    ["labs.deleteLabDocument", (ctx) => deleteLabDocument(ctx, ID)],
    ["prescriptions.getVisitPrescription", (ctx) => getVisitPrescription(ctx, ID)],
    ["prescriptions.searchMedicines", (ctx) => searchMedicines(ctx, "paracetamol")],
    ["visits.confirmAppointment", (ctx) => confirmAppointment(ctx, ID)],
    ["visits.cancelVisit", (ctx) => cancelVisit(ctx, ID)],
    ["visits.deleteScheduleBlock", (ctx) => deleteScheduleBlock(ctx, ID)],
    ["terminology.getVisitDiagnoses", (ctx) => getVisitDiagnoses(ctx, ID)],
    ["terminology.searchDiagnoses", (ctx) => searchDiagnoses(ctx, { query: "fever", limit: 10 })],
    ["apikeys.listApiKeys", (ctx) => listApiKeys(ctx)],
    ["apikeys.revokeApiKey", (ctx) => revokeApiKey(ctx, ID)],
    ["webhooks.listWebhookSubscriptions", (ctx) => listWebhookSubscriptions(ctx)],
    ["webhooks.deleteWebhookSubscription", (ctx) => deleteWebhookSubscription(ctx, ID)],
    ["webhooks.testPingWebhook", (ctx) => testPingWebhook(ctx, ID)],
    ["webhooks.listDeliveryLogs", (ctx) => listDeliveryLogs(ctx, ID)],
    ["patients.grantConsent", (ctx) => grantConsent(ctx, ID, "whatsapp_reminders")],
    ["patients.withdrawConsent", (ctx) => withdrawConsent(ctx, ID, "whatsapp_reminders")],
  ];

  it.each(calls)("%s answers a fixed text when the client throws row data", async (_label, call) => {
    const ctx = mockCtx(throwingDb() as unknown as Record<string, unknown>, { role: "owner" });
    const result = (await call(ctx)) as { success?: boolean; error?: string };
    expect(result.success).toBe(false);
    expectClean(result.error);
  });

  it("a permission refusal keeps its fixed text", async () => {
    const ctx = mockCtx(throwingDb() as unknown as Record<string, unknown>, { role: "nurse" });
    const result = await listApiKeys(ctx);
    expect(result).toMatchObject({ success: false, error: "You do not have permission to perform this action." });
  });
});
