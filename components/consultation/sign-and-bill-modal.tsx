"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeAndBillConsultation, shareReceiptViaWhatsApp } from "@/features/billing/actions";
import { sharePrescriptionViaWhatsApp } from "@/features/prescriptions/actions";
import { signAndBillReceiptState } from "@/features/billing/sign-and-bill-outcome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import {
  Stethoscope,
  CheckCircle2,
  AlertCircle,
  Banknote,
  QrCode,
  CreditCard,
  X,
  ArrowRight,
  ShieldCheck,
  Printer,
  Receipt,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SignAndBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  visitId: string;
  patientId: string;
  patientName: string;
  diagnosesCount: number;
  medicinesCount: number;
  followUpDate?: string | null;
  defaultFee?: number;
  /**
   * PO-3 (V2-05 05-02b): the signed-in user holds `billing:collect` (the owner of a solo clinic). Without it the
   * "collect at the desk" option is not offered and the bill is routed to reception; the server refuses a collection
   * from anyone else regardless (completeAndBillConsultation), so this only shapes the form.
   */
  canCollect?: boolean;
  onSaveDraftBeforeSign: () => Promise<{ success: boolean; error?: string } | void> | void;
}

export function SignAndBillModal({
  isOpen,
  onClose,
  visitId,
  patientId,
  patientName,
  diagnosesCount,
  medicinesCount,
  followUpDate,
  defaultFee = 500,
  canCollect = false,
  onSaveDraftBeforeSign,
}: SignAndBillModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [consultationFee, setConsultationFee] = useState<number>(defaultFee);
  const [discount, setDiscount] = useState<number>(0);
  const [paymentCollected, setPaymentCollected] = useState<boolean>(canCollect);
  const collecting = canCollect && paymentCollected;
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "upi" | "card">("cash");
  const [referenceNumber, setReferenceNumber] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [completedResult, setCompletedResult] = useState<{
    visitId: string;
    invoiceId: string;
    invoiceNumber?: string | null;
    paymentRecorded: boolean;
    alreadyBilled?: boolean;
    whatsAppSent?: boolean;
    whatsAppError?: string | null;
  } | null>(null);
  const receiptState = completedResult ? signAndBillReceiptState(completedResult) : null;

  const [isSendingRxWa, setIsSendingRxWa] = useState(false);
  const [rxWaStatus, setRxWaStatus] = useState<"idle" | "success" | "error">("idle");
  const [rxWaError, setRxWaError] = useState<string | null>(null);

  const [isSendingInvWa, setIsSendingInvWa] = useState(false);
  const [invWaStatus, setInvWaStatus] = useState<"idle" | "success" | "error">("idle");
  const [invWaError, setInvWaError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPaymentCollected(canCollect);
      setCompletedResult(null);
      setError(null);
      setRxWaStatus("idle");
      setRxWaError(null);
      setInvWaStatus("idle");
      setInvWaError(null);
    }
  }, [isOpen, canCollect]);

  const handleSendPrescriptionWhatsApp = async () => {
    if (!completedResult?.visitId || isSendingRxWa) return;
    setIsSendingRxWa(true);
    setRxWaError(null);
    try {
      const res = await sharePrescriptionViaWhatsApp(completedResult.visitId);
      if (res.success) {
        setRxWaStatus("success");
      } else {
        setRxWaStatus("error");
        setRxWaError(res.error || "Failed to send prescription via WhatsApp.");
      }
    } catch (err: unknown) {
      setRxWaStatus("error");
      setRxWaError(err instanceof Error ? err.message : "Error sending WhatsApp message.");
    } finally {
      setIsSendingRxWa(false);
    }
  };

  const handleSendReceiptWhatsApp = async () => {
    if (!completedResult?.invoiceId || isSendingInvWa) return;
    setIsSendingInvWa(true);
    setInvWaError(null);
    try {
      const res = await shareReceiptViaWhatsApp(completedResult.invoiceId);
      if (res.success) {
        setInvWaStatus("success");
      } else {
        setInvWaStatus("error");
        setInvWaError(res.error || "Failed to send receipt via WhatsApp.");
      }
    } catch (err: unknown) {
      setInvWaStatus("error");
      setInvWaError(err instanceof Error ? err.message : "Error sending WhatsApp message.");
    } finally {
      setIsSendingInvWa(false);
    }
  };

  if (!isOpen) return null;

  const totalPayable = Math.max(0, consultationFee - discount);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        // 1. Ensure latest SOAP notes, vitals, diagnoses are saved
        const saveRes = await onSaveDraftBeforeSign();
        if (saveRes && typeof saveRes === "object" && !saveRes.success) {
          setError(saveRes.error || "Please fix validation issues before finalizing.");
          return;
        }

        // 2. Complete consultation and bill visit
        const res = await completeAndBillConsultation({
          visit_id: visitId,
          patient_id: patientId,
          consultation_fee: consultationFee,
          additional_items: [],
          discount: discount,
          payment_collected: collecting,
          payment_method: paymentMethod,
          reference_number: referenceNumber.trim() || undefined,
        });

        if (!res.success) {
          setError(res.error || "Failed to finalize consultation and billing.");
          return;
        }

        setCompletedResult({
          visitId: res.visitId,
          invoiceId: res.invoiceId,
          invoiceNumber: res.invoiceNumber,
          paymentRecorded: res.paymentRecorded,
          alreadyBilled: res.alreadyBilled,
          whatsAppSent: res.whatsAppSent,
          whatsAppError: res.whatsAppError,
        });

        if (res.whatsAppSent) {
          setRxWaStatus("success");
          setInvWaStatus("success");
        } else if (res.whatsAppError) {
          setRxWaError(res.whatsAppError);
          setInvWaError(res.whatsAppError);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white w-full max-w-2xl rounded-2xl border border-gray-200 shadow-theme-lg overflow-hidden flex flex-col max-h-[92vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-bill-title"
      >
        {completedResult ? (
          /* ============================================================ */
          /* SUCCESS & PRINT SCREEN                                       */
          /* ============================================================ */
          <>
            {/* Success Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/70">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h2 id="sign-bill-title" className="text-base font-bold text-gray-900">
                    Consultation Finalized &amp; Signed
                  </h2>
                  <p className="text-xs text-gray-500">
                    Prescription issued and visit records updated
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  router.push("/cabin");
                  router.refresh();
                }}
                className="p-1.5 rounded-lg text-fg-subtle hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Success Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-100 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">
                    Encounter Completed Successfully
                  </h3>
                  <p className="text-xs text-gray-600 mt-0.5">
                    The consultation for <span className="font-semibold text-gray-900">{patientName}</span> is complete. You can print or download documents below.
                  </p>
                </div>
              </div>

              {receiptState?.kind === "already_billed" ? (
                <div
                  role="status"
                  className="p-3.5 rounded-xl bg-accent-subtle border border-accent-border flex items-center gap-3 text-xs text-gray-900"
                >
                  <Receipt className="w-4 h-4 text-accent shrink-0" />
                  <p>{receiptState.message}</p>
                </div>
              ) : null}

              {completedResult.whatsAppError ? (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-3 text-xs text-amber-900">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <p>
                    <span className="font-semibold">WhatsApp Delivery Notice: </span>
                    {completedResult.whatsAppError}
                  </p>
                </div>
              ) : null}

              {/* Action Cards */}
              <div className="space-y-3 pt-1">
                {/* 1. Prescription Print & WhatsApp */}
                <div className="p-4 rounded-xl border border-gray-200 bg-white hover:border-accent/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-accent-subtle text-accent flex items-center justify-center shrink-0 border border-accent-border">
                      <Printer className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-gray-900">
                          Medical Prescription (℞)
                        </h4>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                          Signed
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Formatted OPD Rx with vitals, diagnoses, and medication instructions.
                      </p>
                      {rxWaError && (
                        <p className="text-[11px] text-red-600 mt-1">{rxWaError}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {rxWaStatus === "success" ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>WhatsApp Sent</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={isSendingRxWa}
                        onClick={handleSendPrescriptionWhatsApp}
                        className="h-9 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer disabled:opacity-50"
                        title="Send digital prescription directly to patient's WhatsApp"
                      >
                        {isSendingRxWa ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                        )}
                        <span>WhatsApp</span>
                      </button>
                    )}

                    <a
                      href={`/api/visits/${completedResult.visitId}/prescription-pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="h-9 px-3.5 rounded-lg bg-accent text-white hover:bg-accent-hover text-xs font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print Rx</span>
                    </a>
                  </div>
                </div>

                {/* 2. Invoice / Payment Receipt Print & WhatsApp */}
                <div className="p-4 rounded-xl border border-gray-200 bg-white hover:border-emerald-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-200">
                      <Receipt className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-gray-900">
                          Payment Receipt
                        </h4>
                        <span
                          className={cn(
                            "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0",
                            receiptState?.kind === "paid"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : receiptState?.kind === "already_billed"
                                ? "bg-accent-subtle text-accent border-accent-border"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                          )}
                        >
                          {receiptState?.badge}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {receiptState?.kind === "already_billed"
                          ? receiptState.message
                          : receiptState?.kind === "paid"
                            ? `Official clinic receipt for ₹${totalPayable} (${paymentMethod.toUpperCase()}).`
                            : "Receipt bill routed to reception for payment collection."}
                      </p>
                      {invWaError && (
                        <p className="text-[11px] text-red-600 mt-1">{invWaError}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {invWaStatus === "success" ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>WhatsApp Sent</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={isSendingInvWa}
                        onClick={handleSendReceiptWhatsApp}
                        className="h-9 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer disabled:opacity-50"
                        title="Send official payment receipt directly to patient's WhatsApp"
                      >
                        {isSendingInvWa ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                        )}
                        <span>WhatsApp</span>
                      </button>
                    )}

                    <a
                      href={`/api/invoices/${completedResult.invoiceId}/receipt-pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="h-9 px-3.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                    >
                      <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Print Receipt</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Success Footer */}
            <div className="p-4 border-t border-gray-100 bg-gray-50/70 flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onClose();
                  router.refresh();
                }}
                className="h-11 px-4 text-xs font-semibold rounded-xl border-gray-200 cursor-pointer"
              >
                Review Encounter
              </Button>

              <Button
                type="button"
                onClick={() => {
                  onClose();
                  router.push("/cabin");
                  router.refresh();
                }}
                className="h-11 px-5 rounded-xl bg-accent text-white hover:bg-accent-hover text-xs font-semibold shadow-theme-xs cursor-pointer flex items-center gap-2"
              >
                <span>Return to Doctor&apos;s Cabin</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </>
        ) : (
          /* ============================================================ */
          /* SIGN & BILLING FORM                                          */
          /* ============================================================ */
          <>
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/70">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-accent-subtle text-accent flex items-center justify-center border border-accent-border">
                  <Stethoscope className="w-5 h-5" />
                </div>
                <div>
                  <h2 id="sign-bill-title" className="text-base font-bold text-gray-900">
                    Complete &amp; Sign Consultation
                  </h2>
                  <p className="text-xs text-gray-500">
                    Finalize clinical prescription and record visit checkout
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="p-1.5 rounded-lg text-fg-subtle hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Body */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
              {error && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Clinical Encounter Summary */}
              <div className="p-3.5 rounded-xl bg-blue-50/50 border border-blue-100">
                <div className="text-xs font-semibold text-gray-900 mb-2">
                  Clinical Summary &middot; <span className="font-bold text-accent">{patientName}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2 bg-white rounded-lg border border-blue-100 shadow-2xs">
                    <span className="text-[10px] text-fg-subtle block uppercase font-medium">Diagnoses</span>
                    <span className="font-bold text-gray-800 text-sm">{diagnosesCount}</span>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-blue-100 shadow-2xs">
                    <span className="text-[10px] text-fg-subtle block uppercase font-medium">Medicines (Rx)</span>
                    <span className="font-bold text-gray-800 text-sm">{medicinesCount}</span>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-blue-100 shadow-2xs">
                    <span className="text-[10px] text-fg-subtle block uppercase font-medium">Follow-Up</span>
                    <span className="font-bold text-gray-800 text-xs truncate">
                      {followUpDate ? new Date(followUpDate).toLocaleDateString([], { month: "short", day: "numeric" }) : "None"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Billing & Fee Collection */}
              <div className="space-y-4 pt-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    Consultation Fee &amp; Checkout
                  </h3>
                  <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    OPD Visit
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Consultation Fee (₹)" htmlFor="consultation_fee" required>
                    <div className="relative">
                      <span className="absolute start-3 top-2.5 text-fg-subtle font-semibold text-sm">
                        ₹
                      </span>
                      <Input
                        id="consultation_fee"
                        type="number"
                        min="0"
                        step="10"
                        required
                        value={consultationFee}
                        onChange={(e) => setConsultationFee(Number(e.target.value))}
                        className="ps-7 font-semibold"
                      />
                    </div>
                  </Field>

                  <Field label="Discount (₹)" htmlFor="discount">
                    <div className="relative">
                      <span className="absolute start-3 top-2.5 text-fg-subtle font-semibold text-sm">
                        ₹
                      </span>
                      <Input
                        id="discount"
                        type="number"
                        min="0"
                        step="10"
                        value={discount}
                        onChange={(e) => setDiscount(Number(e.target.value))}
                        className="ps-7 font-semibold"
                      />
                    </div>
                  </Field>
                </div>

                {/* Total Payable Banner */}
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">Net Amount Payable:</span>
                  <span className="text-lg font-bold text-gray-900">₹{totalPayable}</span>
                </div>

                {/* Payment Collection Toggle (collectors only, PO-3); everyone else routes the bill to reception */}
                {!canCollect ? (
                  <div
                    role="note"
                    className="p-3.5 rounded-xl border border-gray-200 bg-white flex items-start gap-2.5"
                  >
                    <Receipt className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <span className="text-xs font-semibold text-gray-900 block">Payment at reception</span>
                      <span className="text-[11px] text-gray-600">
                        The bill is sent to the front desk; the patient pays at reception.
                      </span>
                    </div>
                  </div>
                ) : (
                <div className="p-3.5 rounded-xl border border-gray-200 bg-white space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-gray-900 block">
                        Collect Fee at Doctor&apos;s Desk
                      </span>
                      <span className="text-[11px] text-gray-500">
                        {paymentCollected
                          ? "Payment received directly in cabin"
                          : "Leave unpaid; patient will pay at reception desk"}
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label="Collect fee at the doctor's desk"
                        checked={paymentCollected}
                        onChange={(e) => setPaymentCollected(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-5.5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-accent" />
                    </label>
                  </div>

                  {/* Payment Method Selector */}
                  {paymentCollected && (
                    <div className="pt-2 border-t border-gray-100 space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setPaymentMethod("cash")}
                          className={cn(
                            "p-2.5 rounded-xl border flex flex-col items-center gap-1 text-xs font-semibold transition-all cursor-pointer",
                            paymentMethod === "cash"
                              ? "bg-accent-subtle border-accent text-accent ring-1 ring-accent"
                              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                          )}
                        >
                          <Banknote className="w-4 h-4" />
                          <span>Cash</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setPaymentMethod("upi")}
                          className={cn(
                            "p-2.5 rounded-xl border flex flex-col items-center gap-1 text-xs font-semibold transition-all cursor-pointer",
                            paymentMethod === "upi"
                              ? "bg-accent-subtle border-accent text-accent ring-1 ring-accent"
                              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                          )}
                        >
                          <QrCode className="w-4 h-4" />
                          <span>UPI QR</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setPaymentMethod("card")}
                          className={cn(
                            "p-2.5 rounded-xl border flex flex-col items-center gap-1 text-xs font-semibold transition-all cursor-pointer",
                            paymentMethod === "card"
                              ? "bg-accent-subtle border-accent text-accent ring-1 ring-accent"
                              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                          )}
                        >
                          <CreditCard className="w-4 h-4" />
                          <span>Card / POS</span>
                        </button>
                      </div>

                      {paymentMethod !== "cash" && (
                        <Field label="Transaction Ref / UTR #" htmlFor="ref_num">
                          <Input
                            id="ref_num"
                            type="text"
                            placeholder="e.g. UPI-123456789 or Approval Code"
                            value={referenceNumber}
                            onChange={(e) => setReferenceNumber(e.target.value)}
                            className="text-xs"
                          />
                        </Field>
                      )}
                    </div>
                  )}
                </div>
                )}
              </div>

              {/* Action Footer */}
              <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={isPending}
                  className="h-11 px-4 text-xs font-semibold rounded-xl border-gray-200 cursor-pointer"
                >
                  Back to Editing
                </Button>

                <Button
                  type="submit"
                  disabled={isPending}
                  className="h-11 px-5 rounded-xl bg-accent text-white hover:bg-accent-hover text-xs font-semibold shadow-theme-xs cursor-pointer flex items-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {isPending
                      ? "Finalizing..."
                      : collecting
                      ? `Sign & Collect ₹${totalPayable}`
                      : "Sign & Route to Reception"}
                  </span>
                  <ArrowRight className="w-4 h-4 opacity-80" />
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
