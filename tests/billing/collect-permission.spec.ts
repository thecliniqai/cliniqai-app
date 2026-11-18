/**
 * Who collects (V2-05 05-02b; PO-3, R-6, R-7; threats T-05-08, T-05-09, T-05-39).
 *
 * PO-3: receptionists, admins and owners collect (`billing:collect`); doctors and nurses do not. A doctor bills only
 * the visits they are the doctor of, through Sign & Bill, and routes the payment to reception unless they also hold
 * billing:collect (the owner of a solo clinic). The services refuse first with a fixed text (features/billing); the
 * database refuses on its own (000056 policies; `record_payment` is SECURITY INVOKER, so the payments INSERT policy
 * binds it).
 *
 * Every call goes through the real service with the user's own JWT client (RLS applies, as in a request); rows are
 * seeded and read back with the service-role client. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  BILLING_COLLECT_FORBIDDEN_MESSAGE,
  RECORD_PAYMENT_MESSAGES,
  completeAndBillConsultation,
  createVisitInvoice,
  recordPayment,
} from "@/features/billing/service";
import { saveConsultationDraft } from "@/features/consultation/service";
import type { ServiceContext } from "@/lib/auth/context";
import { ctxFor } from "../helpers/context";
import { consultationDraftInput } from "../helpers/fixtures";
import { signInActingIn } from "../helpers/active-tenant";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

describe("billing:collect (05-02b, PO-3)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let doctor2: SeededTenant;
  let nurse: SeededTenant;
  let receptionist: SeededTenant;
  let otherClinic: SeededTenant;
  let patientId: string;

  async function newVisit(doctorId: string, status: "in_consultation" | "completed" = "in_consultation"): Promise<string> {
    const { data, error } = await admin
      .from("visits")
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patientId,
        doctor_id: doctorId,
        origin_type: "walk_in",
        status,
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`visit: ${error?.message}`);
    return data.id;
  }

  async function newInvoice(visitId: string, total = 300): Promise<string> {
    const { data, error } = await admin
      .from("invoices")
      .insert({
        tenant_id: owner.tenantId,
        visit_id: visitId,
        patient_id: patientId,
        invoice_number: `COLLECT-${randomUUID().slice(0, 8)}`,
        subtotal: total,
        total_amount: total,
        status: "issued",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`invoice: ${error?.message}`);
    return data.id;
  }

  async function paymentsOf(invoiceId: string) {
    const { data, error } = await admin.from("payments").select("amount, recorded_by").eq("invoice_id", invoiceId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function invoicesOfVisit(visitId: string) {
    const { data, error } = await admin.from("invoices").select("id, status, total_amount").eq("visit_id", visitId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function visitState(visitId: string) {
    const { data, error } = await admin.from("visits").select("status, signed_at, signed_by").eq("id", visitId).single();
    if (error) throw new Error(error.message);
    return data;
  }

  const pay = (invoiceId: string, amount = 300) => ({
    invoice_id: invoiceId,
    amount,
    payment_method: "cash" as const,
    commandId: randomUUID(),
  });

  const signAndBill = (visitId: string, collected: boolean) => ({
    visit_id: visitId,
    patient_id: patientId,
    consultation_fee: 500,
    discount: 0,
    additional_items: [],
    payment_collected: collected,
    payment_method: "cash" as const,
  });

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic Collect Clinic");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    doctor2 = await addMemberToTenant(owner.tenantId, "doctor");
    nurse = await addMemberToTenant(owner.tenantId, "nurse");
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
    otherClinic = await seedTenantWithOwner("Synthetic Collect Other Clinic");

    const { data: patient, error } = await admin
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic Collect Patient", phone: "+919000000411", created_by: owner.userId })
      .select("id")
      .single();
    if (error || !patient) throw new Error(`patient: ${error?.message}`);
    patientId = patient.id;
  });

  describe("recordPayment", () => {
    it("a receptionist collects: ok, one payment by the receptionist, the invoice is paid", async () => {
      const invoiceId = await newInvoice(await newVisit(doctor.userId, "completed"));
      const res = await recordPayment(ctxFor(receptionist), pay(invoiceId));
      expect(res).toMatchObject({ success: true, status: "paid", balanceDue: 0 });
      expect(await paymentsOf(invoiceId)).toEqual([{ amount: 300, recorded_by: receptionist.userId }]);
    });

    it.each([
      ["doctor", () => doctor],
      ["nurse", () => nurse],
    ])("a %s is refused (FORBIDDEN text), 0 payments, the invoice unchanged", async (_role, who) => {
      const visitId = await newVisit(doctor.userId, "completed");
      const invoiceId = await newInvoice(visitId);
      const res = await recordPayment(ctxFor(who()), pay(invoiceId));
      expect(res).toEqual({ success: false, error: RECORD_PAYMENT_MESSAGES.FORBIDDEN });
      expect(await paymentsOf(invoiceId)).toEqual([]);
      expect(await invoicesOfVisit(visitId)).toEqual([{ id: invoiceId, status: "issued", total_amount: 300 }]);
    });

    it("the database refuses a doctor's record_payment call made directly (past the service): 0 payments", async () => {
      const visitId = await newVisit(doctor.userId, "completed");
      const invoiceId = await newInvoice(visitId);
      const { error } = await doctor.client.rpc("record_payment", {
        p_tenant_id: owner.tenantId,
        p_invoice_id: invoiceId,
        p_amount: 300,
        p_method: "cash",
        p_reference: "",
        p_command_id: randomUUID(),
      });
      expect(error?.code).toBe("42501");
      expect(await paymentsOf(invoiceId)).toEqual([]);
    });

    it("a nurse's direct payments insert is refused by RLS (42501)", async () => {
      const invoiceId = await newInvoice(await newVisit(doctor.userId, "completed"));
      const { error } = await nurse.client
        .from("payments")
        .insert({ tenant_id: owner.tenantId, invoice_id: invoiceId, amount: 300, payment_method: "cash" });
      expect(error?.code).toBe("42501");
      expect(await paymentsOf(invoiceId)).toEqual([]);
    });
  });

  describe("Sign & Bill (completeAndBillConsultation)", () => {
    async function readyToSign(doctorId: string, as: SeededTenant): Promise<string> {
      const visitId = await newVisit(doctorId);
      const draft = await saveConsultationDraft(ctxFor(as), consultationDraftInput({ visit_id: visitId, clinical_notes: "Synthetic note." }));
      if (!draft.success) throw new Error(`draft: ${draft.error}`);
      return visitId;
    }

    it("a doctor collecting at the desk is refused BEFORE anything happens: visit unsigned, no invoice, 0 payments", async () => {
      const visitId = await readyToSign(doctor.userId, doctor);
      const before = await visitState(visitId);
      const res = await completeAndBillConsultation(ctxFor(doctor), signAndBill(visitId, true));
      expect(res).toEqual({ success: false, error: BILLING_COLLECT_FORBIDDEN_MESSAGE });
      expect(await visitState(visitId)).toEqual(before);
      expect(before.signed_at).toBeNull();
      expect(await invoicesOfVisit(visitId)).toEqual([]);
    });

    it("a doctor routing to reception: signed, the invoice is created unpaid, 0 payments", async () => {
      const visitId = await readyToSign(doctor.userId, doctor);
      const res = await completeAndBillConsultation(ctxFor(doctor), signAndBill(visitId, false));
      expect(res).toMatchObject({ success: true, paymentRecorded: false });
      expect(await visitState(visitId)).toMatchObject({ status: "completed", signed_by: doctor.userId });
      const invoices = await invoicesOfVisit(visitId);
      expect(invoices).toEqual([{ id: expect.any(String), status: "issued", total_amount: 500 }]);
      expect(await paymentsOf(invoices[0].id)).toEqual([]);

      // ...and the front desk then collects it.
      const collected = await recordPayment(ctxFor(receptionist), pay(invoices[0].id, 500));
      expect(collected).toMatchObject({ success: true, status: "paid" });
    });

    it("the owner of a solo clinic signs and collects: payment recorded, invoice paid", async () => {
      const visitId = await readyToSign(owner.userId, owner);
      const res = await completeAndBillConsultation(ctxFor(owner), signAndBill(visitId, true));
      expect(res).toMatchObject({ success: true, paymentRecorded: true });
      const invoices = await invoicesOfVisit(visitId);
      expect(invoices).toEqual([{ id: expect.any(String), status: "paid", total_amount: 500 }]);
      expect(await paymentsOf(invoices[0].id)).toEqual([{ amount: 500, recorded_by: owner.userId }]);
    });
  });

  describe("a doctor sees and bills only their own visits (R-7)", () => {
    it("reads the invoice of their own visit, not a colleague's; a nurse reads none", async () => {
      const own = await newInvoice(await newVisit(doctor.userId, "completed"));
      const colleagues = await newInvoice(await newVisit(doctor2.userId, "completed"));

      const { data: doctorRows } = await doctor.client.from("invoices").select("id").in("id", [own, colleagues]);
      expect((doctorRows ?? []).map((r) => r.id)).toEqual([own]);
      const { data: nurseRows } = await nurse.client.from("invoices").select("id").in("id", [own, colleagues]);
      expect(nurseRows).toEqual([]);
      const { data: deskRows } = await receptionist.client.from("invoices").select("id").in("id", [own, colleagues]);
      expect((deskRows ?? []).map((r) => r.id).sort()).toEqual([own, colleagues].sort());
    });

    it("cannot invoice a colleague's visit (service text; nothing written), the front desk can", async () => {
      const visitId = await newVisit(doctor2.userId, "completed");
      const input = {
        visit_id: visitId,
        patient_id: patientId,
        items: [{ item_type: "consultation" as const, description: "Synthetic fee", unit_price: 200, quantity: 1 }],
        discount: 0,
        tax: 0,
      };
      expect(await createVisitInvoice(ctxFor(doctor), input)).toEqual({ success: false, error: BILLING_COLLECT_FORBIDDEN_MESSAGE });
      expect(await createVisitInvoice(ctxFor(nurse), input)).toEqual({ success: false, error: BILLING_COLLECT_FORBIDDEN_MESSAGE });
      expect(await invoicesOfVisit(visitId)).toEqual([]);

      // The database refuses the doctor's direct insert too (RLS WITH CHECK).
      const { error } = await doctor.client.from("invoices").insert({
        tenant_id: owner.tenantId,
        visit_id: visitId,
        patient_id: patientId,
        invoice_number: `COLLECT-${randomUUID().slice(0, 8)}`,
      });
      expect(error?.code).toBe("42501");

      const desk = await createVisitInvoice(ctxFor(receptionist), input);
      expect(desk.success).toBe(true);
    });
  });

  describe("a member of two clinics (R-42 active tenant)", () => {
    let dualCtx: (actingIn: string) => Promise<ServiceContext>;

    beforeAll(async () => {
      const dual = await createDualMembershipUser(owner.tenantId, "receptionist", otherClinic.tenantId, "receptionist");
      dualCtx = async (actingIn) => ({
        userId: dual.userId,
        tenantId: owner.tenantId,
        role: "receptionist",
        actorType: "user",
        db: await signInActingIn(dual.userEmail, actingIn),
      });
    });

    it("acting in this clinic, collects here", async () => {
      const invoiceId = await newInvoice(await newVisit(doctor.userId, "completed"));
      const res = await recordPayment(await dualCtx(owner.tenantId), pay(invoiceId));
      expect(res).toMatchObject({ success: true, status: "paid" });
    });

    it("acting in the other clinic, cannot read or collect this clinic's invoice: 0 payments", async () => {
      const invoiceId = await newInvoice(await newVisit(doctor.userId, "completed"));
      const ctx = await dualCtx(otherClinic.tenantId);
      const { data } = await ctx.db.from("invoices").select("id").eq("id", invoiceId);
      expect(data).toEqual([]);
      const res = await recordPayment(ctx, pay(invoiceId));
      expect(res).toEqual({ success: false, error: RECORD_PAYMENT_MESSAGES.NOT_FOUND });
      expect(await paymentsOf(invoiceId)).toEqual([]);
    });
  });
});
