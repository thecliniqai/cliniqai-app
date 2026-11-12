import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seedTenantWithOwner, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { consultationDraftInput } from "../helpers/fixtures";
import { enqueueMessage, dispatchQueuedMessage, dispatchPendingQueue } from "@/lib/messaging/dispatcher";
import { sharePrescriptionViaWhatsApp } from "@/features/prescriptions/service";
import { shareLabReportViaWhatsApp } from "@/features/labs/service";
import { saveConsultationDraft, completeAndSignConsultation } from "@/features/consultation/service";
import { completeAndBillConsultation, createVisitInvoice } from "@/features/billing/service";
import { signAndBillReceiptState } from "@/features/billing/sign-and-bill-outcome";

// V2-01 plan 01-10 (review round 3; reviews/review3-adversarial.md = AR3), migration 000024. Local stack, real
// clients; the admin (service-role) client only seeds rows, reads results and stands in for the cron dispatcher.
// Each case fails on the 000023 schema.

const admin = getAdminClient();

type RpcFn = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  return (client.rpc as unknown as RpcFn).call(client, name, args);
}

async function insertRow(table: string, row: Record<string, unknown>): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from(table as never) as any).insert(row).select("id").single();
  if (error || !data) throw new Error(`seed ${table} failed: ${error?.message}`);
  return data.id as string;
}

function syntheticPhone(): string {
  return `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

const LINK = "https://clinic.example.test/r/" + "a1".repeat(32);

interface Clinic {
  owner: SeededTenant;
  members: Record<"admin" | "doctor" | "receptionist" | "nurse", SeededTenant>;
  patientId: string;
}

async function seedClinic(label: string): Promise<Clinic> {
  const owner = await seedTenantWithOwner(`Review3 ${label} ${randomUUID().slice(0, 8)}`);
  const t = owner.tenantId;
  const members = {
    admin: await addMemberToTenant(t, "admin"),
    doctor: await addMemberToTenant(t, "doctor"),
    receptionist: await addMemberToTenant(t, "receptionist"),
    nurse: await addMemberToTenant(t, "nurse"),
  };
  const patientId = await insertRow("patients", {
    tenant_id: t,
    full_name: `Synthetic Patient ${label}`,
    phone: syntheticPhone(),
    created_by: owner.userId,
  });
  return { owner, members, patientId };
}

async function queueRow(id: string) {
  const { data, error } = await admin
    .from("communication_queue")
    .select("id, status, template_params, metadata, retry_count")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(`queue read failed: ${error?.message}`);
  return data as {
    id: string;
    status: string;
    template_params: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
    retry_count: number;
  };
}

describe("01-10 review round 3 fixes (000024)", () => {
  let A: Clinic;
  let everyone: SeededTenant[];

  beforeAll(async () => {
    A = await seedClinic("A");
    everyone = [A.owner, A.members.admin, A.members.doctor, A.members.receptionist, A.members.nurse];
  }, 120_000);

  describe("AR3-N1: message payloads and share links in communication_queue", () => {
    let seededId: string;

    beforeAll(async () => {
      // A due message that carries a link, enqueued on the system path (created_by NULL).
      seededId = await insertRow("communication_queue", {
        tenant_id: A.owner.tenantId,
        patient_id: A.patientId,
        channel: "whatsapp",
        message_type: "prescription_ready",
        template_id: "prescription_ready",
        template_params: { patient_name: "Synthetic", document_url: LINK },
        recipient_phone: syntheticPhone(),
        status: "pending",
        next_retry_at: new Date(Date.now() + 3_600_000).toISOString(),
        metadata: { buttons: [{ id: "btn_view_rx", text: "View", url: LINK }] },
      });
    });

    it("no member role can read payload columns, and every role still sees the row's status", async () => {
      for (const m of everyone) {
        for (const column of ["template_params", "metadata", "recipient_phone", "error_message", "external_message_id", "*"]) {
          const { data, error } = await m.client.from("communication_queue").select(column).eq("id", seededId);
          expect(error?.code, `${m.role} ${column}`).toBe("42501");
          expect(data).toBeNull();
        }
        const { data, error } = await m.client
          .from("communication_queue")
          .select("id, status, message_type")
          .eq("id", seededId);
        expect(error, m.role).toBeNull();
        expect(data).toEqual([{ id: seededId, status: "pending", message_type: "prescription_ready" }]);
      }
    });

    it("no member role can update (e.g. redirect recipient_phone) or delete a queue row", async () => {
      for (const m of everyone) {
        const upd = await m.client
          .from("communication_queue")
          .update({ recipient_phone: syntheticPhone() })
          .eq("id", seededId);
        expect(upd.error?.code, `${m.role} update`).toBe("42501");
        const upd2 = await m.client.from("communication_queue").update({ status: "cancelled" }).eq("id", seededId);
        expect(upd2.error?.code, `${m.role} status update`).toBe("42501");
        const del = await m.client.from("communication_queue").delete().eq("id", seededId);
        expect(del.error?.code, `${m.role} delete`).toBe("42501");
      }
      const row = await queueRow(seededId);
      expect(row.status).toBe("pending");
      expect(row.template_params.document_url).toBe(LINK);
    });

    it("a member cannot claim (and so read) a row it did not enqueue; the service role can", async () => {
      await admin
        .from("communication_queue")
        .update({ next_retry_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", seededId);
      for (const m of everyone) {
        const { data, error } = await rpc(m.client, "communication_queue_claim", { p_id: seededId });
        expect(error, m.role).toBeNull();
        expect(data, m.role).toEqual([]);
        const fin = await rpc(m.client, "communication_queue_finish", {
          p_id: seededId,
          p_success: true,
          p_external_message_id: "x",
          p_error: null,
        });
        expect(fin.data, m.role).toEqual([]);
      }
      expect((await queueRow(seededId)).status).toBe("pending");

      // The cron path (service role) dispatches it, and the sent row keeps no link.
      expect(await dispatchQueuedMessage(admin, seededId, { providerName: "dev" })).toBe("sent");
      const sent = await queueRow(seededId);
      expect(sent.status).toBe("sent");
      expect(JSON.stringify(sent.template_params)).not.toContain("https://");
      expect(JSON.stringify(sent.metadata)).not.toContain("https://");
      expect(sent.template_params.patient_name).toBe("Synthetic");
      expect(sent.template_params.document_url).toBe("[redacted]");
    });

    it("anon has no access at all", async () => {
      const { createClient } = await import("@supabase/supabase-js");
      const { env } = await import("@/lib/env");
      const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await anon.from("communication_queue").select("id").limit(1);
      expect(error?.code).toBe("42501");
      const claim = await rpc(anon, "communication_queue_claim", { p_id: seededId });
      expect(claim.error).not.toBeNull();
    });

    it("a doctor's prescription share enqueues, sends at once, and leaves no token or link behind", async () => {
      const visitId = await insertRow("visits", {
        tenant_id: A.owner.tenantId,
        patient_id: A.patientId,
        doctor_id: A.members.doctor.userId,
        origin_type: "walk_in",
        status: "in_consultation",
        scheduled_at: new Date().toISOString(),
        created_by: A.owner.userId,
      });
      const prescriptionId = await insertRow("prescriptions", {
        tenant_id: A.owner.tenantId,
        visit_id: visitId,
        patient_id: A.patientId,
        doctor_id: A.members.doctor.userId,
      });
      const res = await sharePrescriptionViaWhatsApp(ctxFor(A.members.doctor), prescriptionId);
      expect(res.success).toBe(true);

      const { data: rows } = await admin
        .from("communication_queue")
        .select("id, status, template_params, metadata")
        .eq("tenant_id", A.owner.tenantId)
        .eq("message_type", "prescription_ready")
        .contains("metadata", { prescription_id: prescriptionId });
      expect(rows).toHaveLength(1);
      const row = rows![0] as { status: string; template_params: Record<string, unknown>; metadata: Record<string, unknown> };
      expect(row.status).toBe("sent");
      expect(row.metadata).not.toHaveProperty("share_token");
      expect(row.metadata).not.toHaveProperty("share_url");
      const stored = JSON.stringify([row.template_params, row.metadata]);
      expect(stored).not.toContain("/r/");
      expect(stored).not.toMatch(/[0-9a-f]{64}/);
    });

    it("a receptionist's lab-report share still enqueues and sends", async () => {
      const documentId = await insertRow("patient_documents", {
        tenant_id: A.owner.tenantId,
        patient_id: A.patientId,
        title: "Synthetic Report",
        original_filename: "synthetic.pdf",
        storage_path: `tenants/${A.owner.tenantId}/patients/${A.patientId}/labs/syn_${randomUUID().slice(0, 8)}.pdf`,
        file_size_bytes: 12,
        mime_type: "application/pdf",
        uploaded_by: A.owner.userId,
      });
      const res = await shareLabReportViaWhatsApp(ctxFor(A.members.receptionist), documentId);
      expect(res.success).toBe(true);
      const { data: rows } = await admin
        .from("communication_queue")
        .select("status, template_params, metadata")
        .eq("tenant_id", A.owner.tenantId)
        .contains("metadata", { document_id: documentId });
      expect(rows).toHaveLength(1);
      expect(rows![0].status).toBe("sent");
      expect(JSON.stringify(rows![0])).not.toContain("/r/");
    });

    it("tokens never stay in metadata, even when a caller writes them", async () => {
      const queued = await enqueueMessage(A.members.receptionist.client, {
        tenantId: A.owner.tenantId,
        patientId: A.patientId,
        channel: "whatsapp",
        messageType: "lab_report_uploaded",
        templateId: "lab_report_uploaded",
        templateParams: { document_url: LINK },
        recipientPhone: syntheticPhone(),
        delayUntil: new Date(Date.now() + 3_600_000),
        metadata: { document_id: "doc-1", share_token: "t".repeat(64), invoice_token: "x", share_url: LINK },
      });
      expect(queued.status).toBe("pending");
      const row = await queueRow(queued.id);
      expect(row.metadata).toEqual({ document_id: "doc-1", share_url: LINK });
      // Not final yet: the link the provider needs is still there for the dispatcher.
      expect(row.template_params.document_url).toBe(LINK);
    });

    it("a member can dispatch only its own row; a final failure scrubs the payload", async () => {
      const queued = await enqueueMessage(A.members.receptionist.client, {
        tenantId: A.owner.tenantId,
        patientId: A.patientId,
        channel: "whatsapp",
        messageType: "lab_report_uploaded",
        templateId: "lab_report_uploaded",
        templateParams: { document_url: LINK },
        recipientPhone: null, // the send fails: no recipient
        maxRetries: 1,
        delayUntil: new Date(Date.now() - 1000).toISOString(), // due, but not dispatched at enqueue
        metadata: { buttons: [{ id: "b", text: "View", url: LINK }] },
      });
      expect((await queueRow(queued.id)).status).toBe("pending");

      expect(await dispatchQueuedMessage(A.members.doctor.client, queued.id, { providerName: "dev" })).toBe("skipped");
      expect((await queueRow(queued.id)).status).toBe("pending");

      expect(await dispatchQueuedMessage(A.members.receptionist.client, queued.id, { providerName: "dev" })).toBe(
        "dead_letter"
      );
      const row = await queueRow(queued.id);
      expect(row.status).toBe("dead_letter");
      expect(row.retry_count).toBe(1);
      expect(JSON.stringify([row.template_params, row.metadata])).not.toContain("https://");
    });

    it("a permanent failure alerts admins without the recipient's phone number", async () => {
      const phone = syntheticPhone();
      const queued = await enqueueMessage(A.members.receptionist.client, {
        tenantId: A.owner.tenantId,
        patientId: A.patientId,
        channel: "whatsapp",
        messageType: "lab_report_uploaded",
        templateId: "lab_report_uploaded",
        templateParams: { document_url: LINK },
        recipientPhone: phone,
        maxRetries: 1,
        delayUntil: new Date(Date.now() - 1000).toISOString(),
      });
      const refusing = {
        sendSms: async () => ({ success: false, error: "Synthetic provider refusal" }),
        sendWhatsApp: async () => ({ success: false, error: "Synthetic provider refusal" }),
      } as never;
      expect(await dispatchQueuedMessage(A.members.receptionist.client, queued.id, { provider: refusing })).toBe(
        "dead_letter"
      );
      const { data: alerts } = await admin
        .from("in_app_notifications")
        .select("message, metadata")
        .eq("tenant_id", A.owner.tenantId)
        .contains("metadata", { queue_id: queued.id });
      expect(alerts).toHaveLength(1);
      const alert = alerts![0] as { message: string; metadata: Record<string, unknown> };
      expect(alert.metadata).toMatchObject({ queue_id: queued.id, message_type: "lab_report_uploaded" });
      const digits = phone.replace("+91", "");
      expect(JSON.stringify(alert)).not.toContain(digits);
    });

    it("the cron dispatcher (service role) still sends due rows, and the audit row carries no phone number", async () => {
      const phone = syntheticPhone();
      const queued = await enqueueMessage(A.members.receptionist.client, {
        tenantId: A.owner.tenantId,
        patientId: A.patientId,
        channel: "whatsapp",
        messageType: "lab_report_uploaded",
        templateId: "lab_report_uploaded",
        templateParams: { document_url: LINK },
        recipientPhone: phone,
        delayUntil: new Date(Date.now() - 1000).toISOString(),
      });
      // Make it the oldest due row so the batch picks it up whatever else is queued locally.
      await admin
        .from("communication_queue")
        .update({ created_at: "2000-01-01T00:00:00Z" })
        .eq("id", queued.id);
      const summary = await dispatchPendingQueue(admin, { providerName: "dev", limit: 1 });
      expect(summary.processed).toBe(1);
      const row = await queueRow(queued.id);
      expect(row.status).toBe("sent");
      expect(row.template_params.document_url).toBe("[redacted]");

      const { data: audits } = await admin
        .from("audit_logs")
        .select("metadata")
        .eq("action", "communication_sent")
        .eq("entity_id", queued.id);
      expect(audits).toHaveLength(1);
      const metadata = (audits![0] as { metadata: Record<string, unknown> }).metadata;
      expect(metadata).toMatchObject({ queue_id: queued.id, message_type: "lab_report_uploaded" });
      expect(metadata).not.toHaveProperty("recipient_phone");
      expect(JSON.stringify(metadata)).not.toContain(phone.replace("+91", ""));
    });
  });

  describe("AR3-N2: one live invoice per visit", () => {
    async function draftedVisit(): Promise<string> {
      const visitId = await insertRow("visits", {
        tenant_id: A.owner.tenantId,
        patient_id: A.patientId,
        doctor_id: A.members.doctor.userId,
        origin_type: "scheduled",
        status: "in_consultation",
        scheduled_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        created_by: A.owner.userId,
      });
      const saved = await saveConsultationDraft(
        ctxFor(A.members.doctor),
        consultationDraftInput({ visit_id: visitId, clinical_notes: "Synthetic note." })
      );
      if (!saved.success) throw new Error("draft seed failed");
      return visitId;
    }

    const bill = (visitId: string) =>
      completeAndBillConsultation(ctxFor(A.members.doctor), {
        visit_id: visitId,
        patient_id: A.patientId,
        consultation_fee: 500,
        discount: 0,
        additional_items: [],
        payment_collected: true,
        payment_method: "cash",
      });

    async function invoices(visitId: string) {
      const { data } = await admin.from("invoices").select("id, status").eq("visit_id", visitId);
      return (data ?? []) as Array<{ id: string; status: string }>;
    }

    async function paymentCount(invoiceIds: string[]): Promise<number> {
      if (invoiceIds.length === 0) return 0;
      const { data } = await admin.from("payments").select("id").in("invoice_id", invoiceIds);
      return (data ?? []).length;
    }

    const invoiceInput = (visitId: string) => ({
      visit_id: visitId,
      patient_id: A.patientId,
      items: [{ item_type: "consultation" as const, description: "OPD Consultation Fee", unit_price: 300, quantity: 1 }],
      discount: 0,
      tax: 0,
    });

    it("the database refuses a second live invoice for the same visit", async () => {
      const visitId = await draftedVisit();
      const row = (n: string) => ({
        tenant_id: A.owner.tenantId,
        visit_id: visitId,
        patient_id: A.patientId,
        invoice_number: `SYN-${n}-${randomUUID().slice(0, 8)}`,
        status: "issued",
      });
      const first = await A.owner.client.from("invoices").insert(row("1"));
      expect(first.error).toBeNull();
      const second = await A.owner.client.from("invoices").insert(row("2"));
      expect(second.error?.code).toBe("23505");
      expect(await invoices(visitId)).toHaveLength(1);
    });

    it("createVisitInvoice on a visit that already has one returns the existing invoice", async () => {
      const visitId = await draftedVisit();
      const first = await createVisitInvoice(ctxFor(A.members.doctor), invoiceInput(visitId));
      expect(first.success).toBe(true);
      const second = await createVisitInvoice(ctxFor(A.members.receptionist), invoiceInput(visitId));
      expect(second.success).toBe(true);
      if (first.success && second.success) {
        expect(second.existing).toBe(true);
        expect(second.invoice.id).toBe(first.invoice.id);
        expect(second.items).toHaveLength(1);
      }
      expect(await invoices(visitId)).toHaveLength(1);
    });

    it("two concurrent Sign & Bill requests by the same doctor create one invoice and at most one payment", async () => {
      const visitId = await draftedVisit();
      const results = await Promise.all([bill(visitId), bill(visitId)]);
      expect(results.some((r) => r.success)).toBe(true);
      const live = (await invoices(visitId)).filter((i) => i.status !== "cancelled");
      expect(live).toHaveLength(1);
      expect(await paymentCount(live.map((i) => i.id))).toBeLessThanOrEqual(1);
    });

    it("two concurrent resumes after the sign-off create one invoice and exactly one payment", async () => {
      const visitId = await draftedVisit();
      expect((await completeAndSignConsultation(ctxFor(A.members.doctor), visitId)).success).toBe(true);

      const results = await Promise.all([bill(visitId), bill(visitId)]);
      expect(results.some((r) => r.success && !r.alreadyBilled)).toBe(true);
      const all = await invoices(visitId);
      expect(all).toHaveLength(1);
      expect(await paymentCount(all.map((i) => i.id))).toBe(1);
      for (const r of results) {
        if (r.success) expect(r.invoiceId).toBe(all[0].id);
      }
    });

    it("the losing request gets the existing invoice as 'already billed' (the shape the modal shows), and no payment", async () => {
      const visitId = await draftedVisit();
      expect((await completeAndSignConsultation(ctxFor(A.members.doctor), visitId)).success).toBe(true);
      const first = await bill(visitId);
      expect(first.success).toBe(true);
      const [invoice] = await invoices(visitId);
      const { data: inv } = await admin.from("invoices").select("invoice_number").eq("id", invoice.id).single();
      const invoiceNumber = (inv as unknown as { invoice_number: string }).invoice_number;
      expect(invoiceNumber).toBeTruthy();

      // The race window: this request read "no invoice yet" just before the other request's insert committed.
      // Its first invoices read is answered as of that moment; everything after runs on the real database.
      let stale = true;
      const real = A.members.doctor.client;
      const raced = new Proxy(real, {
        get(target, prop) {
          if (prop === "from") {
            return (table: string) => {
              if (table === "invoices" && stale) {
                stale = false;
                const chain: Record<string, unknown> = {};
                for (const m of ["select", "eq", "neq", "limit"]) chain[m] = () => chain;
                chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
                return chain;
              }
              return target.from(table as never);
            };
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      const res = await completeAndBillConsultation({ ...ctxFor(A.members.doctor), db: raced as never }, {
        visit_id: visitId,
        patient_id: A.patientId,
        consultation_fee: 500,
        discount: 0,
        additional_items: [],
        payment_collected: true,
        payment_method: "cash",
      });
      expect(stale).toBe(false);
      expect(res).toMatchObject({
        success: true,
        alreadyBilled: true,
        invoiceId: invoice.id,
        invoiceNumber,
        paymentRecorded: false,
      });
      if (res.success) {
        const state = signAndBillReceiptState(res);
        expect(state.kind).toBe("already_billed");
        expect(state.badge).not.toBe("Pending at Desk");
        if (state.kind === "already_billed") {
          expect(state.message).toContain(invoiceNumber);
        }
      }
      expect(await invoices(visitId)).toHaveLength(1);
      expect(await paymentCount([invoice.id])).toBe(1);
    });

    it("a voided (cancelled) invoice can be re-issued, by createVisitInvoice and by a Sign & Bill retry", async () => {
      const visitId = await draftedVisit();
      expect((await completeAndSignConsultation(ctxFor(A.members.doctor), visitId)).success).toBe(true);
      const first = await bill(visitId);
      expect(first.success).toBe(true);
      const [original] = await invoices(visitId);

      const voided = await A.owner.client.from("invoices").update({ status: "cancelled" }).eq("id", original.id);
      expect(voided.error).toBeNull();

      // Sign & Bill retry by the signing doctor re-bills the visit once the only invoice is void.
      const again = await bill(visitId);
      expect(again.success).toBe(true);
      if (again.success) {
        expect(again.alreadyBilled).toBeFalsy();
        expect(again.invoiceId).not.toBe(original.id);
      }
      let all = await invoices(visitId);
      expect(all.filter((i) => i.status !== "cancelled")).toHaveLength(1);

      // Void that one too; checkout's createVisitInvoice issues a fresh one.
      const live = all.find((i) => i.status !== "cancelled")!;
      await A.owner.client.from("invoices").update({ status: "cancelled" }).eq("id", live.id);
      const reissued = await createVisitInvoice(ctxFor(A.members.receptionist), invoiceInput(visitId));
      expect(reissued.success).toBe(true);
      if (reissued.success) expect(reissued.existing).toBeFalsy();
      all = await invoices(visitId);
      expect(all).toHaveLength(3);
      expect(all.filter((i) => i.status !== "cancelled")).toHaveLength(1);
    });
  });
});
