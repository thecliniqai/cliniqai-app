import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { seedTenantWithOwner, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor, mockCtx } from "../helpers/context";
import * as enqueueModule from "@/lib/jobs/enqueue";
import * as tenantModule from "@/lib/auth/tenant";
import * as contextModule from "@/lib/auth/context";
import * as serverClientModule from "@/lib/supabase/server";
import { shareLabReportViaWhatsApp } from "@/features/labs/service";
import { shareReferralLetterViaWhatsApp, getOutboundReferrals, getPatientReferrals } from "@/features/referrals/service";
import { saveConsultationDraft } from "@/features/consultation/service";
import { getInAppNotifications, markAllNotificationsRead } from "@/features/notifications/service";
import { updateClinicSettings } from "@/features/settings/service";
import { GET as receiptPdfRoute } from "@/app/api/invoices/[id]/receipt-pdf/route";
import { clinicalNotesOf, seedClinicalNotes } from "../helpers/clinical-notes";

// V2-01 plan 01-08, checkpoint 2 (app-only review fixes). DB-backed cases use the local stack; the error-text cases
// stub the client so a database error whose text carries row data can be produced deterministically.

const admin = getAdminClient();

/** Text a Postgres/PostgREST error can carry: it must never reach a client. */
const LEAKY = "Failing row contains (Synthetic Leaky Patient, +919000011111)";
const LEAKY_ERROR = { message: LEAKY, code: "23502", details: LEAKY, hint: null };

/** A query-builder stub: every method chains, awaiting it (or .single()) yields { data: null, error }. */
function failingClient(error: unknown = LEAKY_ERROR) {
  const result = { data: null, error, count: null };
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result);
        return () => chain;
      },
    }
  );
  return { from: () => chain, rpc: () => chain };
}

function throwingClient(message = LEAKY) {
  return {
    from: () => {
      throw new Error(message);
    },
  };
}

async function insertRow(table: string, row: Record<string, unknown>): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from(table as never) as any).insert(row).select("id").single();
  if (error || !data) throw new Error(`seed ${table} failed: ${error?.message}`);
  return data.id as string;
}

describe("01-08 review fixes, app-only items", () => {
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let patientId: string;
  const patientPhone = `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Review App ${randomUUID().slice(0, 8)}`);
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    patientId = await insertRow("patients", {
      tenant_id: owner.tenantId,
      full_name: "Synthetic Patient App",
      phone: patientPhone,
      created_by: owner.userId,
    });
  }, 60_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("AR-L5: lab and referral share audits carry no token or phone", () => {
    it.each(["lab", "referral"] as const)("%s share", async (kind) => {
      vi.spyOn(enqueueModule, "enqueueMessage").mockResolvedValue({ id: "msg-syn" } as never);
      const tenantDigits = patientPhone.slice(-10);

      let entityId: string;
      let res: { success: boolean; token?: string; error?: string };
      if (kind === "lab") {
        entityId = await insertRow("patient_documents", {
          tenant_id: owner.tenantId,
          patient_id: patientId,
          title: "Synthetic Report",
          original_filename: "synthetic.pdf",
          storage_path: `tenants/${owner.tenantId}/patients/${patientId}/labs/syn_${randomUUID().slice(0, 8)}.pdf`,
          file_size_bytes: 12,
          mime_type: "application/pdf",
          uploaded_by: owner.userId,
        });
        res = await shareLabReportViaWhatsApp(ctxFor(owner), entityId);
      } else {
        entityId = await insertRow("referrals", {
          tenant_id: owner.tenantId,
          patient_id: patientId,
          referral_type: "out_of_network",
          referring_doctor_id: owner.userId,
          referred_to_name: "Synthetic Specialist",
          reason_for_referral: "Synthetic reason",
        });
        res = await shareReferralLetterViaWhatsApp(ctxFor(owner), entityId);
      }
      expect(res.success, res.error).toBe(true);
      expect(res.token).toMatch(/^[0-9a-f]{64}$/);

      const { data: audits } = await admin
        .from("audit_logs")
        .select("action, metadata")
        .eq("tenant_id", owner.tenantId)
        .eq("entity_id", entityId);
      const share = (audits ?? []).filter((a: { action: string }) => a.action.endsWith(".share_whatsapp"));
      expect(share).toHaveLength(1);
      const text = JSON.stringify(audits);
      expect(text).not.toContain(res.token as string);
      expect(text).not.toContain(tenantDigits);
    });
  });

  describe("signed consultation overwrite: saveConsultationDraft refuses a completed or signed visit", () => {
    async function visit(fields: Record<string, unknown>): Promise<string> {
      const id = await insertRow("visits", {
        tenant_id: owner.tenantId,
        patient_id: patientId,
        doctor_id: doctor.userId,
        origin_type: "walk_in",
        scheduled_at: new Date().toISOString(),
        created_by: owner.userId,
        ...fields,
      });
      // The note lives in the visit's clinical_notes row (V2-05 05-02a).
      await seedClinicalNotes(id, { clinical_notes: "Signed synthetic note." });
      return id;
    }
    async function notesOf(id: string) {
      const { data } = await admin.from("visits").select("metadata").eq("id", id).single();
      const notes = await clinicalNotesOf(id);
      return { clinical_notes: notes.clinical_notes, metadata: (data as { metadata: unknown } | null)?.metadata };
    }

    it.each([
      ["completed and signed", { status: "completed", signed: true }],
      ["completed", { status: "completed", signed: false }],
      ["signed but not reopened (waiting)", { status: "waiting", signed: true }],
    ])("%s: refused and nothing changes", async (_label, { status, signed }) => {
      const id = await visit({
        status,
        ...(signed ? { signed_at: new Date().toISOString(), signed_by: doctor.userId } : {}),
      });
      const res = await saveConsultationDraft(ctxFor(doctor), {
        visit_id: id,
        clinical_notes: "Overwritten after sign-off.",
        metadata: { injected: true },
      } as never);
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error).toMatch(/already signed/i);
      const after = await notesOf(id);
      expect(after.clinical_notes).toBe("Signed synthetic note.");
      expect(JSON.stringify(after.metadata ?? {})).not.toContain("injected");
    });

    it("a visit reopened for amendment (signed, in_consultation) still saves drafts", async () => {
      const id = await visit({ status: "in_consultation", signed_at: new Date().toISOString() });
      const res = await saveConsultationDraft(ctxFor(doctor), {
        visit_id: id,
        clinical_notes: "Amended synthetic note.",
      } as never);
      expect(res.success).toBe(true);
      expect((await notesOf(id)).clinical_notes).toBe("Amended synthetic note.");
    });

    it("an unsigned in-progress visit still saves drafts", async () => {
      const id = await visit({ status: "in_consultation" });
      const res = await saveConsultationDraft(ctxFor(doctor), { visit_id: id, clinical_notes: "Draft." } as never);
      expect(res.success).toBe(true);
    });
  });

  describe("IR-L1: context resolution never returns database text", () => {
    it("resolveServiceContext answers a fixed message when membership lookup fails unexpectedly", async () => {
      vi.spyOn(tenantModule, "getActiveMembership").mockRejectedValue(new Error(LEAKY));
      const res = await contextModule.resolveServiceContext("patients:view");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe(contextModule.CONTEXT_FAILURE_MESSAGE);
        expect(res.error).not.toContain("Failing row");
      }
    });

    it("resolveServiceContext keeps the fixed no-clinic message", async () => {
      vi.spyOn(tenantModule, "getActiveMembership").mockRejectedValue(new tenantModule.NoClinicMembershipError());
      const res = await contextModule.resolveServiceContext();
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("Your account is not linked to a clinic yet");
    });

    it("getActiveMembership throws a fixed message when the membership query fails", async () => {
      const fake = {
        auth: { getUser: async () => ({ data: { user: { id: randomUUID() } }, error: null }) },
        ...failingClient(),
      };
      vi.spyOn(serverClientModule, "createClient").mockResolvedValue(fake as never);
      const thrown = await tenantModule.getActiveMembership().then(
        () => null,
        (e: unknown) => e as Error
      );
      expect(thrown?.message).toBe("Failed to resolve clinic membership.");
    });

    it("the receipt PDF route answers a fixed 500 body when context resolution fails unexpectedly", async () => {
      vi.spyOn(tenantModule, "getActiveMembership").mockRejectedValue(new Error(LEAKY));
      const res = await receiptPdfRoute(new NextRequest(`http://localhost:3000/api/invoices/${randomUUID()}/receipt-pdf`), {
        params: Promise.resolve({ id: randomUUID() }),
      } as never);
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("Failing row");
    });
  });

  describe("IR-L2: services return fixed messages for database errors", () => {
    const ctxWith = (db: unknown) => mockCtx(db as Record<string, unknown>, { role: "owner" });

    it("notifications", async () => {
      for (const res of [
        await getInAppNotifications(ctxWith(failingClient())),
        await markAllNotificationsRead(ctxWith(failingClient())),
        await getInAppNotifications(ctxWith(throwingClient())),
      ]) {
        expect(res.success).toBe(false);
        expect(JSON.stringify(res)).not.toContain("Failing row");
      }
    });

    it("referrals", async () => {
      for (const res of [
        await getOutboundReferrals(ctxWith(failingClient())),
        await getPatientReferrals(ctxWith(failingClient()), randomUUID()),
        await getOutboundReferrals(ctxWith(throwingClient())),
      ]) {
        expect(res.success).toBe(false);
        expect(JSON.stringify(res)).not.toContain("Failing row");
      }
    });

    it("settings: an unexpected throw is a fixed message; a permission refusal keeps its text", async () => {
      const thrown = await updateClinicSettings(ctxWith(throwingClient()), { name: "Synthetic Clinic" } as never);
      expect(thrown.success).toBe(false);
      if (!thrown.success) {
        expect(thrown.error).not.toContain("Failing row");
        expect(thrown.error).toBe("Failed to update settings.");
      }

      const denied = await updateClinicSettings(
        mockCtx(throwingClient() as unknown as Record<string, unknown>, { role: "nurse" }),
        { name: "Synthetic Clinic" } as never
      );
      expect(denied.success).toBe(false);
      if (!denied.success) expect(denied.error).toMatch(/permission/i);
    });
  });
});
