"use client";

import React, { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { completeAndBillConsultation, getSignAndBillContext, shareReceiptViaWhatsApp } from "@/features/billing/actions";
import { sharePrescriptionViaWhatsApp } from "@/features/prescriptions/actions";
import { signAndBillReceiptState } from "@/features/billing/sign-and-bill-outcome";
import type { PaymentMethod } from "@/features/billing/schema";
import { useConfirmedCall } from "@/lib/query/mutations";
import { queryKeys } from "@/lib/query/keys";
import { saveStatusProps } from "@/lib/commands/save-state";
import { isRowChanged } from "@/lib/errors/row-changed";
import { formatINR, fromPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { ChipGroup } from "@/components/ui/chip-group";
import { SaveStatus } from "@/components/clinical/save-status";
import { SharePdfButton } from "@/components/clinical/share-pdf-button";
import { FinishReview, type UnresolvedAllergy } from "./workspace/finish-review";
import type { SummaryContent } from "./workspace/summary-pane";
import { Field } from "@/components/ui/field";
import { ResponsiveSheet, ResponsiveSheetContent } from "@/components/ui/responsive-sheet";
import { SheetBody, SheetFooter, SheetHeader } from "@/components/ui/sheet";
import {
  CheckCircle2,
  AlertCircle,
  Banknote,
  QrCode,
  CreditCard,
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
  /** The clinic of the consult (the context query's key, V2-10 10-02). */
  tenantId: string;
  visitId: string;
  patientId: string;
  patientName: string;
  /** The review's content (V2-09c 09C-05, R-13): the draft as the patient will receive it. */
  summary: SummaryContent;
  /** Medicines that match a recorded allergy and have no reason yet: Sign is disabled while there are any. */
  unresolvedAllergies?: readonly UnresolvedAllergy[];
  /** Closes the sheet and takes the doctor to a line of the prescription. */
  onGoToLine?: (itemId: string) => void;
  /** The WhatsApp message is offered when the patient has a phone number and has not opted out (CTO ruling Q-8: never ticked for the doctor). */
  whatsapp?: { available: boolean; unavailableReason?: string };
  /**
   * How "Print Rx" works on the success screen: `view` prints the sealed record's print view (the same settings as the PDF), `preparing` waits for the page
   * to read the signed record, `pdf` opens the PDF (a role or a record with no print view).
   */
  printState?: "view" | "preparing" | "pdf";
  onPrint?: () => void;
  /** The sign-off has committed: the page reads the sealed record (so the print view exists). */
  onSigned?: () => void;
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
  tenantId,
  visitId,
  patientId,
  patientName,
  summary,
  unresolvedAllergies = [],
  onGoToLine,
  whatsapp = { available: false },
  printState: printStateProp = "pdf",
  onPrint,
  onSigned,
  canCollect = false,
  onSaveDraftBeforeSign,
}: SignAndBillModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // One client_request_id per logical submit (V2-07 07-03): a retry after an error re-sends it, so a committed
  // sign-off-and-bill whose response was lost replays instead of running twice.
  // 09E-08 (R-11, confirm class): sign and finish shows a pending state only; the success screen comes after the database answered (`finish_confirmed`).
  const { run: runCommand, command: signCommand } = useConfirmedCall({ metric: "finish_confirmed" });
  const resetCommand = signCommand.reset;
  const formRef = useRef<HTMLFormElement>(null);

  // V2-10 10-02 (D-10): one read when the sheet opens: the clinic's fees now, the accepted methods, the visit's version (sent back with the sign-off) and the
  // live invoice. Never held: it is dropped when the sheet closes, so the next open reads again; no focus or reconnect re-read (the doctor's form stays put).
  const queryClient = useQueryClient();
  const contextKey = queryKeys.signAndBill(tenantId, visitId);
  const contextQuery = useQuery({
    queryKey: contextKey,
    queryFn: () => getSignAndBillContext(visitId),
    enabled: isOpen,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const contextResult = contextQuery.data;
  const context = contextResult?.ok ? contextResult.value : null;
  const contextError = contextResult && !contextResult.ok ? contextResult.error.message : contextQuery.isError ? "The bill details could not be loaded. Nothing was signed. Try again." : null;
  useEffect(() => {
    if (!isOpen) queryClient.removeQueries({ queryKey: contextKey, exact: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, queryClient, tenantId, visitId]);

  // Money in integer paise (D-1). The fee starts from the clinic's fee once per open (a null fee: an empty required field, never a made-up amount); a
  // re-read after a refusal keeps what the doctor typed.
  const [consultationFee, setConsultationFee] = useState<number | null>(null);
  const [feeSeeded, setFeeSeeded] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);
  if (isOpen && context && !feeSeeded) {
    setFeeSeeded(true);
    setConsultationFee(context.fee.consultation);
  }
  const [discount, setDiscount] = useState<number | null>(0);
  const [paymentCollected, setPaymentCollected] = useState<boolean>(canCollect);
  const collecting = canCollect && paymentCollected;
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const methods: readonly PaymentMethod[] = context?.methods.length ? context.methods : ["cash", "upi", "card"];
  const method: PaymentMethod = methods.includes(paymentMethod) ? paymentMethod : methods[0];
  const [referenceNumber, setReferenceNumber] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  // The doctor's choice, never ticked for them (CTO ruling Q-8).
  const [sendWhatsapp, setSendWhatsapp] = useState(false);
  const [printGaveUp, setPrintGaveUp] = useState(false);
  const blocked = unresolvedAllergies.length > 0;
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

  // Reset on open (and when `canCollect` changes while open), during render rather than in an effect: the same
  // triggers as before, without a committed frame of stale state (React Compiler `set-state-in-effect`, V2-06 06-08).
  const [resetFor, setResetFor] = useState<{ isOpen: boolean; canCollect: boolean } | null>(null);
  if (resetFor === null || resetFor.isOpen !== isOpen || resetFor.canCollect !== canCollect) {
    setResetFor({ isOpen, canCollect });
    if (isOpen) {
      setFeeSeeded(false);
      setConsultationFee(null);
      setDiscount(0);
      setFeeError(null);
      setPaymentCollected(canCollect);
      setSendWhatsapp(false);
      setPrintGaveUp(false);
      setCompletedResult(null);
      setError(null);
      setRxWaStatus("idle");
      setRxWaError(null);
      setInvWaStatus("idle");
      setInvWaError(null);
    }
  }

  // "Print Rx" waits for the page to read the sealed record; if that never arrives (the refresh failed) the PDF link takes over after a few seconds.
  const waitingForPrint = Boolean(completedResult) && printStateProp === "preparing";
  useEffect(() => {
    if (!waitingForPrint) return;
    const timer = window.setTimeout(() => setPrintGaveUp(true), 8000);
    return () => window.clearTimeout(timer);
  }, [waitingForPrint]);
  const printState = printStateProp === "preparing" && printGaveUp ? "pdf" : printStateProp;

  // A changed fee or payment after an error is a new request, not a retry of the failed one.
  useEffect(() => {
    resetCommand();
  }, [resetCommand, consultationFee, discount, paymentCollected, paymentMethod, referenceNumber]);

  // PWA-06b: the save's state (Saving…, Couldn't save · Retry, Offline). A stale-visit refusal offers no Retry of the same thing: the doctor reviews the latest first.
  const saveStatus = {
    ...saveStatusProps(signCommand),
    onRetry: signCommand.saveState === "error" && !isRowChanged(signCommand.error) ? () => formRef.current?.requestSubmit() : undefined,
  };

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

  const feePaise = consultationFee ?? 0;
  const discountPaise = discount ?? 0;
  const discountTooLarge = discountPaise > feePaise;
  const totalPayable = Math.max(0, feePaise - discountPaise);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (blocked) return;
    // The version the sheet read when it opened (or re-read after a refusal): without it nothing is sent (the action would refuse it).
    if (!context) return;
    if (consultationFee === null) {
      setFeeError("Enter the consultation fee.");
      return;
    }
    if (discountTooLarge) return;
    const expectedVersion = context.visit.rowVersion;

    startTransition(async () => {
      try {
        // 1. Ensure latest SOAP notes, vitals, diagnoses are saved
        const saveRes = await onSaveDraftBeforeSign();
        if (saveRes && typeof saveRes === "object" && !saveRes.success) {
          setError(saveRes.error || "Please fix validation issues before finalizing.");
          return;
        }

        // 2. Complete consultation and bill visit: one command, all or nothing
        const result = await runCommand((clientRequestId) =>
          completeAndBillConsultation({
            visit_id: visitId,
            patient_id: patientId,
            consultation_fee: fromPaise(consultationFee),
            additional_items: [],
            discount: fromPaise(discountPaise),
            payment_collected: collecting,
            payment_method: method,
            reference_number: referenceNumber.trim() || undefined,
            send_whatsapp: whatsapp.available && sendWhatsapp,
            client_request_id: clientRequestId,
            expected_version: expectedVersion,
          })
        );

        if (!result.ok) {
          setError(result.error.message || "Failed to finalize consultation and billing.");
          // ROW_CHANGED (09E R-19): the visit moved on another device; nothing was signed. The fixed message stays, the context is read again (the new
          // version), and the doctor's fee, discount and choices are kept.
          if (isRowChanged(result.error)) await contextQuery.refetch();
          return;
        }
        const res = result.value;

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
        // The page reads the sealed record now, so the print view and the record bar are ready when the doctor taps Print.
        onSigned?.();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    });
  };

  // Closing the sheet: the success screen returns to the doctor's queue as its old Close button did; the form closes unless the sign-off is running.
  const handleOpenChange = (open: boolean) => {
    if (open) return;
    if (completedResult) {
      onClose();
      router.push("/today?mode=doctor");
      router.refresh();
    } else if (!isPending) {
      onClose();
    }
  };

  return (
    // V2-09b R-8: a ResponsiveSheet (bottom drawer below 768 px, right sheet above): focus trap, Escape, scrim, focus return and the scroll lock come from
    // the overlay layer; the commands, the props and the copy are the v1 flow's.
    <ResponsiveSheet open={isOpen} onOpenChange={handleOpenChange}>
      <ResponsiveSheetContent size="lg" onEscapeKeyDown={(e) => isPending && e.preventDefault()} onInteractOutside={(e) => isPending && e.preventDefault()}>
        {completedResult ? (
          /* ============================================================ */
          /* SUCCESS & PRINT SCREEN                                       */
          /* ============================================================ */
          <>
            <SheetHeader title="Consultation Finalized & Signed" description="Prescription issued and visit records updated" />

            {/* Success Body */}
            <SheetBody>
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

                  <div className="flex flex-wrap items-center justify-end gap-2 shrink-0 self-end sm:self-center">
                    {!whatsapp.available ? (
                      // A-19: an opted-out patient or one with no number is offered no WhatsApp send here either (the review says why).
                      <WhatsAppUnavailable reason={whatsapp.unavailableReason} />
                    ) : rxWaStatus === "success" ? (
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

                    {/* The signed PDF through the device's share sheet, or a download where it cannot (R-14). */}
                    <SharePdfButton visitId={completedResult.visitId} />

                    {printState === "pdf" ? (
                      <a
                        href={`/api/visits/${completedResult.visitId}/prescription-pdf`}
                        target="_blank"
                        rel="noreferrer"
                        data-print-rx="pdf"
                        className="h-9 px-3.5 rounded-lg bg-accent text-white hover:bg-accent-hover text-xs font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Print Rx</span>
                      </a>
                    ) : (
                      // The print view of the sealed record: the browser's print dialog, on the clinic's paper and margins (the same settings as the PDF).
                      <Button type="button" data-print-rx={printState} loading={printState === "preparing"} startIcon={<Printer />} onClick={onPrint}>
                        Print Rx
                      </Button>
                    )}
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
                            ? `Official clinic receipt for ${formatINR(totalPayable)} (${method.toUpperCase()}).`
                            : "Receipt bill routed to reception for payment collection."}
                      </p>
                      {invWaError && (
                        <p className="text-[11px] text-red-600 mt-1">{invWaError}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {!whatsapp.available ? (
                      <WhatsAppUnavailable reason={whatsapp.unavailableReason} />
                    ) : invWaStatus === "success" ? (
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
            </SheetBody>

            {/* Success Footer */}
            <SheetFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  onClose();
                  router.refresh();
                }}
              >
                Review Encounter
              </Button>

              <Button
                type="button"
                onClick={() => {
                  onClose();
                  router.push("/today?mode=doctor");
                  router.refresh();
                }}
              >
                <span>Return to Doctor&apos;s Cabin</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </SheetFooter>
          </>
        ) : (
          /* ============================================================ */
          /* SIGN & BILLING FORM                                          */
          /* ============================================================ */
          <>
            <SheetHeader title="Complete & Sign Consultation" description="Finalize clinical prescription and record visit checkout" />

            {/* Form Body */}
            <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <SheetBody>
              {error && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* The review (V2-09c 09C-05, R-13): what the patient receives, open allergy matches, the WhatsApp choice, the lock note. */}
              <FinishReview
                summary={summary}
                unresolved={unresolvedAllergies}
                onGoToLine={(id) => onGoToLine?.(id)}
                whatsapp={{ available: whatsapp.available, unavailableReason: whatsapp.unavailableReason, checked: sendWhatsapp, onChange: setSendWhatsapp }}
              />

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

                {contextError ? (
                  <div role="alert" data-sign-bill-context="failed" className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="flex-1 space-y-2">
                      <p>{contextError}</p>
                      <Button type="button" size="sm" variant="secondary" loading={contextQuery.isFetching} onClick={() => void contextQuery.refetch()}>
                        Try again
                      </Button>
                    </div>
                  </div>
                ) : null}

                {context?.invoice ? (
                  <div role="note" data-sign-bill-invoice="" className="p-3 rounded-xl bg-accent-subtle border border-accent-border flex items-center gap-2.5 text-xs text-gray-900">
                    <Receipt className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
                    <p>
                      This visit was billed at the desk ({formatINR(context.invoice.totalPaise)}, {formatINR(context.invoice.paidPaise)} collected). Signing will not bill it again.
                    </p>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-sign-bill-ready={context ? "" : undefined}>
                  <Field label="Consultation Fee" htmlFor="consultation_fee" required error={feeError ?? undefined}>
                    <MoneyInput
                      id="consultation_fee"
                      value={consultationFee}
                      disabled={!context}
                      placeholder={context ? "Enter the fee" : "Loading…"}
                      onValueChange={(paise) => {
                        setConsultationFee(paise);
                        if (paise !== null) setFeeError(null);
                      }}
                      className="font-semibold"
                    />
                  </Field>

                  <Field label="Discount" htmlFor="discount" error={discountTooLarge ? "The discount cannot be more than the fee." : undefined}>
                    <MoneyInput
                      id="discount"
                      value={discount}
                      disabled={!context}
                      onValueChange={setDiscount}
                      className="font-semibold"
                    />
                  </Field>
                </div>

                {/* D-11: the chips are the clinic's own fees (no hard-coded amounts). */}
                {feeChips(context?.fee).length > 0 ? (
                  <ChipGroup
                    type="single"
                    aria-label="Clinic fees"
                    items={feeChips(context?.fee)}
                    value={consultationFee === null ? "" : String(consultationFee)}
                    onValueChange={(value) => {
                      if (!value) return;
                      setConsultationFee(Number(value));
                      setFeeError(null);
                    }}
                  />
                ) : null}

                {/* Total Payable Banner */}
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">Net Amount Payable:</span>
                  <span className="text-lg font-bold text-gray-900" data-sign-bill-total="">{formatINR(totalPayable)}</span>
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
                        {methods.includes("cash") && (
                        <button
                          type="button"
                          aria-pressed={method === "cash"}
                          onClick={() => setPaymentMethod("cash")}
                          className={cn(
                            "p-2.5 rounded-xl border flex flex-col items-center gap-1 text-xs font-semibold transition-all cursor-pointer",
                            method === "cash"
                              ? "bg-accent-subtle border-accent text-accent ring-1 ring-accent"
                              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                          )}
                        >
                          <Banknote className="w-4 h-4" />
                          <span>Cash</span>
                        </button>
                        )}

                        {methods.includes("upi") && (
                        <button
                          type="button"
                          aria-pressed={method === "upi"}
                          onClick={() => setPaymentMethod("upi")}
                          className={cn(
                            "p-2.5 rounded-xl border flex flex-col items-center gap-1 text-xs font-semibold transition-all cursor-pointer",
                            method === "upi"
                              ? "bg-accent-subtle border-accent text-accent ring-1 ring-accent"
                              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                          )}
                        >
                          <QrCode className="w-4 h-4" />
                          <span>UPI QR</span>
                        </button>
                        )}

                        {methods.includes("card") && (
                        <button
                          type="button"
                          aria-pressed={method === "card"}
                          onClick={() => setPaymentMethod("card")}
                          className={cn(
                            "p-2.5 rounded-xl border flex flex-col items-center gap-1 text-xs font-semibold transition-all cursor-pointer",
                            method === "card"
                              ? "bg-accent-subtle border-accent text-accent ring-1 ring-accent"
                              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                          )}
                        >
                          <CreditCard className="w-4 h-4" />
                          <span>Card / POS</span>
                        </button>
                        )}
                      </div>

                      {method !== "cash" && (
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

              </SheetBody>

              {/* Action Footer */}
              <SheetFooter>
                <SaveStatus {...saveStatus} className="me-auto" />
                <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>
                  Back to Editing
                </Button>

                <Button type="submit" disabled={isPending || blocked || !context} aria-describedby={blocked ? "finish-sign-blocked" : undefined} startIcon={<ShieldCheck />} endIcon={<ArrowRight />}>
                  {isPending ? "Finalizing..." : collecting ? `Sign & Collect ${formatINR(totalPayable)}` : "Sign & Route to Reception"}
                </Button>
                {blocked && (
                  <span id="finish-sign-blocked" className="sr-only">
                    Signing is blocked until every medicine that matches an allergy has a reason or is removed.
                  </span>
                )}
              </SheetFooter>
            </form>
          </>
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

/** A-19: the WhatsApp send of the success screen when the patient cannot receive it: a disabled control with the reason, never "Sent". */
function WhatsAppUnavailable({ reason }: { reason?: string }) {
  const text = reason ?? "WhatsApp is not available for this patient.";
  return (
    <span data-whatsapp-unavailable="" className="inline-flex max-w-56 items-center gap-1.5 text-xs text-gray-600">
      <button
        type="button"
        disabled
        title={text}
        className="h-9 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border border-gray-300 bg-gray-50 text-gray-500 cursor-not-allowed"
      >
        <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
        <span>WhatsApp</span>
      </button>
      <span>{text}</span>
    </span>
  );
}

/** The fee chips (D-11): the clinic's consultation and follow-up fee as they are now; a fee the clinic did not set is not offered. */
function feeChips(fee: { consultation: number | null; followup: number | null } | undefined): { value: string; label: string; meta: string }[] {
  if (!fee) return [];
  const chips: { value: string; label: string; meta: string }[] = [];
  if (fee.consultation !== null) chips.push({ value: String(fee.consultation), label: "Consultation", meta: formatINR(fee.consultation) });
  if (fee.followup !== null && fee.followup !== fee.consultation) chips.push({ value: String(fee.followup), label: "Follow-up", meta: formatINR(fee.followup) });
  return chips;
}
