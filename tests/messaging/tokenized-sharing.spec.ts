import { describe, it, expect, afterEach, vi } from "vitest";
import { sharePrescriptionViaWhatsApp } from "@/features/prescriptions/service";
import { shareLabReportViaWhatsApp } from "@/features/labs/service";
import { mockCtx } from "../helpers/context";
import { shareReferralLetterViaWhatsApp } from "@/features/referrals/service";
import { shareReceiptViaWhatsApp, sendConsolidatedConsultationWhatsApp } from "@/features/billing/service";
import * as enqueueModule from "@/lib/jobs/enqueue";

// The public routes (/api/r, /r, /api/reschedule, /api/reports/view) are covered against the local database in
// tests/security/share-tokens.spec.ts (P0-04): they resolve tokens through token-scoped RPCs, so the per-table admin
// fakes this file used to carry no longer describe them. This file keeps the share-trigger unit tests: each trigger
// mints its token through create_share_token (never a direct insert) and only then enqueues the message.

const MINTED_TOKEN = "f".repeat(64);

type RpcCall = { name: string; args: Record<string, unknown> };

function shareRpc(calls: RpcCall[], refuse = false) {
  return vi.fn().mockImplementation((name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (refuse) {
      return Promise.resolve({ data: null, error: { code: "P0002", message: "not_found" } });
    }
    return Promise.resolve({
      data: [{ token: MINTED_TOKEN, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() }],
      error: null,
    });
  });
}

function rowQuery(data: Record<string, unknown>) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data, error: null }),
        }),
      }),
    }),
  };
}

describe("Clinical 1-Click WhatsApp Sharing Triggers (Events #6, #7, #8, #11; P0-04 token minting)", () => {
  const session = { userId: "user-1", tenantId: "tenant-1" };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fakeDb(table: string, row: Record<string, unknown>, calls: RpcCall[], refuse = false) {
    const from = vi.fn().mockImplementation((t: string) => {
      if (t === table) return rowQuery(row);
      if (t === "audit_logs") return { insert: vi.fn().mockResolvedValue({ error: null }) };
      if (t === "document_share_tokens") throw new Error("direct token insert attempted");
      return {};
    });
    return { from, rpc: shareRpc(calls, refuse) };
  }

  it("sharePrescriptionViaWhatsApp mints a prescription token via create_share_token and enqueues Event #6", async () => {
    const enqueueSpy = vi.spyOn(enqueueModule, "enqueueMessage").mockResolvedValue({ id: "msg-rx-1" } as never);
    const calls: RpcCall[] = [];
    const db = fakeDb(
      "prescriptions",
      {
        id: "rx-100",
        patient_id: "patient-1",
        patient: { id: "patient-1", full_name: "Synthetic Patient", phone: "+919800000001" },
        tenant: { name: "Care Clinic", phone: "+919800000000" },
      },
      calls
    );

    const res = await sharePrescriptionViaWhatsApp(mockCtx(db, session), "rx-100");
    expect(res.success).toBe(true);
    expect(res.shareUrl).toContain(`/r/${MINTED_TOKEN}`);
    expect(calls).toEqual([
      { name: "create_share_token", args: { p_resource_type: "prescription", p_resource_id: "rx-100" } },
    ]);
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "whatsapp",
        messageType: "prescription_ready",
        templateId: "prescription_ready",
        recipientPhone: "+919800000001",
      })
    );
  });

  it("shareLabReportViaWhatsApp mints a patient_document token and enqueues Event #7", async () => {
    const enqueueSpy = vi.spyOn(enqueueModule, "enqueueMessage").mockResolvedValue({ id: "msg-lab-1" } as never);
    const calls: RpcCall[] = [];
    const db = fakeDb(
      "patient_documents",
      {
        id: "doc-200",
        title: "Thyroid Profile",
        patient_id: "patient-2",
        patient: { id: "patient-2", full_name: "Synthetic Patient", phone: "+919800000002" },
        tenant: { name: "Care Clinic", phone: "+919800000000" },
      },
      calls
    );

    const res = await shareLabReportViaWhatsApp(mockCtx(db, session), "doc-200");
    expect(res.success).toBe(true);
    expect(res.shareUrl).toContain(`/r/${MINTED_TOKEN}`);
    expect(calls).toEqual([
      { name: "create_share_token", args: { p_resource_type: "patient_document", p_resource_id: "doc-200" } },
    ]);
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        messageType: "lab_report_uploaded",
        templateId: "lab_report_uploaded",
        recipientPhone: "+919800000002",
      })
    );
  });

  it("shareReferralLetterViaWhatsApp mints a referral token and enqueues Event #8", async () => {
    const enqueueSpy = vi.spyOn(enqueueModule, "enqueueMessage").mockResolvedValue({ id: "msg-ref-1" } as never);
    const calls: RpcCall[] = [];
    const db = fakeDb(
      "referrals",
      {
        id: "ref-300",
        referred_to_name: "Synthetic Specialist",
        patient_id: "patient-3",
        patient: { id: "patient-3", full_name: "Synthetic Patient", phone: "+919800000003" },
        tenant: { name: "Care Clinic", phone: "+919800000000" },
      },
      calls
    );

    const res = await shareReferralLetterViaWhatsApp(mockCtx(db, session), "ref-300");
    expect(res.success).toBe(true);
    expect(res.shareUrl).toContain(`/r/${MINTED_TOKEN}`);
    expect(calls).toEqual([
      { name: "create_share_token", args: { p_resource_type: "referral", p_resource_id: "ref-300" } },
    ]);
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ messageType: "referral_letter_issued", recipientPhone: "+919800000003" })
    );
  });

  it("shareReceiptViaWhatsApp mints an invoice token and enqueues Event #11", async () => {
    const enqueueSpy = vi.spyOn(enqueueModule, "enqueueMessage").mockResolvedValue({ id: "msg-inv-1" } as never);
    const calls: RpcCall[] = [];
    const db = fakeDb(
      "invoices",
      {
        id: "inv-400",
        invoice_number: "INV-2026-0042",
        total_amount: 1500,
        patient_id: "patient-4",
        patient: { id: "patient-4", full_name: "Synthetic Patient", phone: "+919800000004" },
        tenant: { name: "Care Clinic", phone: "+919800000000" },
      },
      calls
    );

    const res = await shareReceiptViaWhatsApp(mockCtx(db, session), "inv-400");
    expect(res.success).toBe(true);
    expect(res.shareUrl).toContain(`/r/${MINTED_TOKEN}`);
    expect(calls).toEqual([
      { name: "create_share_token", args: { p_resource_type: "invoice", p_resource_id: "inv-400" } },
    ]);
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ messageType: "receipt_issued", recipientPhone: "+919800000004" })
    );
  });

  it("a refused create_share_token fails the share and sends nothing", async () => {
    const enqueueSpy = vi.spyOn(enqueueModule, "enqueueMessage").mockResolvedValue({ id: "msg-x" } as never);
    const calls: RpcCall[] = [];
    const db = fakeDb(
      "prescriptions",
      {
        id: "rx-100",
        patient_id: "patient-1",
        patient: { id: "patient-1", full_name: "Synthetic Patient", phone: "+919800000001" },
        tenant: { name: "Care Clinic", phone: "+919800000000" },
      },
      calls,
      true
    );

    const res = await sharePrescriptionViaWhatsApp(mockCtx(db, session), "rx-100");
    expect(res.success).toBe(false);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("sendConsolidatedConsultationWhatsApp mints two tokens (prescription & invoice) and enqueues exactly 1 consultation_documents message with interactive buttons", async () => {
    const enqueueSpy = vi.spyOn(enqueueModule, "enqueueMessage").mockResolvedValue({ id: "msg-cons-1" } as never);
    const calls: RpcCall[] = [];

    const mockSupabase = {
      rpc: shareRpc(calls),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "visits") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: "visit-123", doctor_id: "user-doc-1", patient_id: "patient-1" },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "patients") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "patient-1", full_name: "Synthetic Patient", phone: "+919800000001" },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "tenants") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { name: "Apex Health", phone: "+919800000000" },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "memberships") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { full_name: "Dr. Synthetic" }, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "prescriptions") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "rx-100" }, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "invoices") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "inv-200", invoice_number: "INV-2026-0099", total_amount: 1200 },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "audit_logs") {
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        }
        if (table === "document_share_tokens") throw new Error("direct token insert attempted");
        return {};
      }),
    };

    const res = await sendConsolidatedConsultationWhatsApp(mockCtx(mockSupabase, session), {
      visitId: "visit-123",
      invoiceId: "inv-200",
    });

    expect(res.success).toBe(true);
    expect(res.rxShareUrl).toContain("/r/");
    expect(res.invoiceShareUrl).toContain("/r/");
    expect(calls).toEqual([
      { name: "create_share_token", args: { p_resource_type: "prescription", p_resource_id: "rx-100" } },
      { name: "create_share_token", args: { p_resource_type: "invoice", p_resource_id: "inv-200" } },
    ]);

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "whatsapp",
        messageType: "consultation_documents",
        templateId: "consultation_documents",
        recipientPhone: "+919800000001",
        templateParams: expect.objectContaining({
          patient_name: "Synthetic Patient",
          doctor_name: "Dr. Synthetic",
          clinic_name: "Apex Health",
          amount: "1200",
          invoice_number: "INV-2026-0099",
        }),
        metadata: expect.objectContaining({
          buttons: [
            expect.objectContaining({ id: "btn_view_rx", text: "View Prescription 📄" }),
            expect.objectContaining({ id: "btn_view_receipt", text: "View Receipt 🧾" }),
          ],
        }),
      })
    );
  });
});
