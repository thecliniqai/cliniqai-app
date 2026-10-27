"use client";

import React, { useState, useEffect, useTransition } from "react";
import { QueueItem } from "./queue-card";
import {
  createVisitInvoice,
  recordPayment,
  getVisitBillingDetails,
  addInvoiceItem,
  deleteInvoiceItem,
  shareReceiptViaWhatsApp,
  GetVisitBillingResult,
} from "@/features/billing/actions";
import { transitionQueueState } from "@/features/queue/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import {
  X,
  CreditCard,
  Banknote,
  QrCode,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Printer,
  IndianRupee,
  Receipt,
  Share2,
  Loader2,
  User,
  Stethoscope,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckoutDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  queueItem: QueueItem | null;
  defaultFee?: number;
}

const QUICK_SERVICES = [
  { description: "ECG Test", fee: 300 },
  { description: "Wound Dressing", fee: 150 },
  { description: "Nebulization", fee: 200 },
  { description: "Injection Administration", fee: 100 },
  { description: "Blood Sugar (GRBS)", fee: 80 },
];

export function CheckoutDrawer({
  isOpen,
  onClose,
  onSuccess,
  queueItem,
  defaultFee = 500,
}: CheckoutDrawerProps) {
  const [isPending, startTransition] = useTransition();
  const [billingData, setBillingData] = useState<GetVisitBillingResult | null>(null);
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);

  // New Invoice Form state (if no invoice exists in DB yet)
  const [consultationFee, setConsultationFee] = useState<number>(defaultFee);
  const [additionalItems, setAdditionalItems] = useState<
    { description: string; unit_price: number; quantity: number }[]
  >([]);
  const [discount, setDiscount] = useState<number>(0);

  // Add Procedure / Service state (for both new and existing invoices)
  const [procedureDescription, setProcedureDescription] = useState("");
  const [procedureFee, setProcedureFee] = useState<number | "">("");
  const [isAddingItem, setIsAddingItem] = useState(false);

  // Payment Recording state
  const [amountToPay, setAmountToPay] = useState<number>(defaultFee);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "upi" | "card">("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  // WhatsApp receipt dispatch state
  const [whatsAppSending, setWhatsAppSending] = useState(false);
  const [whatsAppStatus, setWhatsAppStatus] = useState<string | null>(null);

  const visit = queueItem?.visit;
  const patient = queueItem?.patient;
  const queueToken = queueItem?.queueToken;
  const doctorName = queueItem?.doctorName;

  // Load existing billing details whenever drawer opens
  useEffect(() => {
    if (isOpen && visit?.id) {
      setError(null);
      setSuccessNotice(null);
      setWhatsAppStatus(null);
      setIsCompleted(false);
      setLoadingBilling(true);

      getVisitBillingDetails(visit.id)
        .then((res) => {
          setBillingData(res);
          if (res.success && res.invoice) {
            setAmountToPay(res.balanceDue);
            if (res.balanceDue === 0 && res.invoice.status === "paid") {
              setIsCompleted(true);
            }
          } else {
            setAmountToPay(defaultFee);
          }
        })
        .catch((err) => {
          console.error("Failed to load visit billing:", err);
          setError("Failed to load visit billing details.");
        })
        .finally(() => {
          setLoadingBilling(false);
        });
    }
  }, [isOpen, visit?.id, defaultFee]);

  const invoice = billingData?.success ? billingData.invoice : null;
  const items = billingData?.success ? billingData.items : [];
  const payments = billingData?.success ? billingData.payments : [];
  const totalPaid = billingData?.success ? billingData.totalPaid : 0;
  const serverBalanceDue = billingData?.success ? billingData.balanceDue : 0;

  // Calculate totals for new invoice draft
  const draftSubtotal =
    consultationFee +
    additionalItems.reduce((acc, curr) => acc + curr.unit_price * curr.quantity, 0);
  const draftNetPayable = Math.max(0, draftSubtotal - discount);

  const currentTotalAmount = invoice ? invoice.total_amount : draftNetPayable;
  const balanceDue = invoice ? serverBalanceDue : draftNetPayable;

  // Synchronize amountToPay whenever new invoice draft items or discount change
  useEffect(() => {
    if (!invoice) {
      setAmountToPay(draftNetPayable);
    }
  }, [invoice, draftNetPayable]);

  if (!isOpen || !visit || !patient) return null;

  // Handler for adding charge item
  const handleAddProcedure = async (desc?: string, fee?: number) => {
    const finalDesc = (desc || procedureDescription).trim();
    const finalFee = fee ?? (typeof procedureFee === "number" ? procedureFee : 0);

    if (!finalDesc || finalFee <= 0) return;

    if (invoice) {
      // Direct server-side addition to existing invoice
      setIsAddingItem(true);
      setError(null);
      try {
        const res = await addInvoiceItem({
          invoice_id: invoice.id,
          item_type: "procedure",
          description: finalDesc,
          unit_price: finalFee,
          quantity: 1,
        });

        if (!res.success) {
          setError(res.error || "Failed to add charge.");
          return;
        }

        setProcedureDescription("");
        setProcedureFee("");

        const updated = await getVisitBillingDetails(visit.id);
        setBillingData(updated);
        if (updated.success && updated.invoice) {
          setAmountToPay(updated.balanceDue);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to add charge.");
      } finally {
        setIsAddingItem(false);
      }
    } else {
      // Local addition to pending draft invoice
      setAdditionalItems((prev) => [
        ...prev,
        {
          description: finalDesc,
          unit_price: finalFee,
          quantity: 1,
        },
      ]);
      setProcedureDescription("");
      setProcedureFee("");
    }
  };

  // Handler for removing charge item
  const handleRemoveItem = async (index: number, existingItemId?: string) => {
    if (existingItemId && invoice) {
      setError(null);
      try {
        const res = await deleteInvoiceItem(existingItemId);
        if (!res.success) {
          setError(res.error || "Failed to remove item.");
          return;
        }
        const updated = await getVisitBillingDetails(visit.id);
        setBillingData(updated);
        if (updated.success && updated.invoice) {
          setAmountToPay(updated.balanceDue);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to remove charge.");
      }
    } else {
      setAdditionalItems((prev) => prev.filter((_, i) => i !== index));
    }
  };

  // Handler for checkout and collecting payment
  const handleCheckoutAndPay = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);

    startTransition(async () => {
      try {
        let activeInvoiceId = invoice ? invoice.id : null;

        // 1. If invoice does not exist, create it
        if (!activeInvoiceId) {
          const itemsPayload = [
            {
              item_type: "consultation" as const,
              description: "OPD Consultation Fee",
              unit_price: consultationFee,
              quantity: 1,
            },
            ...additionalItems.map((item) => ({
              item_type: "procedure" as const,
              description: item.description,
              unit_price: item.unit_price,
              quantity: item.quantity,
            })),
          ];

          const invRes = await createVisitInvoice({
            visit_id: visit.id,
            patient_id: patient.id,
            items: itemsPayload,
            discount,
            tax: 0,
          });

          if (!invRes.success) {
            setError(invRes.error || "Failed to generate invoice.");
            return;
          }
          activeInvoiceId = invRes.invoice.id;
        }

        // 2. Record payment if amount > 0
        if (amountToPay > 0 && activeInvoiceId) {
          const payRes = await recordPayment({
            invoice_id: activeInvoiceId,
            amount: amountToPay,
            payment_method: paymentMethod,
            reference_number: referenceNumber.trim() || undefined,
            notes: paymentNotes.trim() || undefined,
          });

          if (!payRes.success) {
            setError(payRes.error || "Failed to record payment.");
            return;
          }
        }

        // 3. Complete queue encounter
        const queueRes = await transitionQueueState(visit.id, "completed");
        if (!queueRes.success) {
          console.warn("[CheckoutDrawer] Queue transition warning:", queueRes.error);
        }

        // 4. Reload updated billing details
        const updated = await getVisitBillingDetails(visit.id);
        setBillingData(updated);
        setIsCompleted(true);
        setSuccessNotice(
          `Payment of ₹${amountToPay} recorded successfully (${paymentMethod.toUpperCase()}) & Patient visit completed.`
        );
        onSuccess();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to complete checkout.");
      }
    });
  };

  // WhatsApp receipt sender
  const handleShareWhatsApp = async () => {
    const invId = invoice?.id;
    if (!invId) return;

    setWhatsAppSending(true);
    setWhatsAppStatus(null);
    try {
      const res = await shareReceiptViaWhatsApp(invId);
      if (res.success) {
        setWhatsAppStatus(`✓ Digital receipt link dispatched to ${patient.phone || "patient"} via WhatsApp!`);
      } else {
        setWhatsAppStatus(`WhatsApp dispatch failed: ${res.error || "Please verify patient phone number."}`);
      }
    } catch (err: unknown) {
      setWhatsAppStatus(err instanceof Error ? err.message : "Failed to dispatch WhatsApp receipt.");
    } finally {
      setWhatsAppSending(false);
    }
  };

  // Print PDF receipt in new tab
  const handlePrintReceipt = () => {
    const invId = invoice?.id || visit.id;
    window.open(`/api/invoices/${invId}/receipt-pdf`, "_blank");
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-gray-900/20 backdrop-blur-xs z-40 transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Slide-over Drawer Container */}
      <div className="fixed inset-y-0 end-0 w-full max-w-xl bg-white border-s border-gray-200 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-200 font-sans">
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EAF2FF] text-[#1769E0] flex items-center justify-center border border-[#1769E0]/20 shadow-2xs">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-gray-900">Patient Checkout & Billing</h2>
                {queueToken && (
                  <span className="px-2 py-0.5 text-xs font-bold rounded-md bg-[#EAF2FF] text-[#1769E0] border border-[#1769E0]/20">
                    Token #{queueToken.token_number}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">Collect encounter fees, record payment, and issue receipt</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Error Banner */}
          {error && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3 text-xs text-rose-800 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{error}</div>
            </div>
          )}

          {/* Success Banner */}
          {successNotice && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3 text-xs text-emerald-800 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{successNotice}</div>
            </div>
          )}

          {/* Patient Card Banner */}
          <div className="p-4 rounded-2xl bg-gray-50/70 border border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-600 font-bold text-sm shadow-2xs">
                <User className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-gray-900">{patient.full_name}</span>
                  {patient.sex && (
                    <span className="text-xs text-gray-400 capitalize">({patient.sex})</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                  {patient.age != null && <span>{patient.age} yrs</span>}
                  {patient.phone && <span>· {patient.phone}</span>}
                  {doctorName && (
                    <span className="flex items-center gap-1 text-[#1769E0] font-medium">
                      · <Stethoscope className="w-3 h-3" /> {doctorName}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="text-end">
              <span className="text-[11px] font-semibold uppercase text-gray-400 block tracking-wider">
                Visit Status
              </span>
              <span
                className={cn(
                  "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize mt-0.5",
                  visit.status === "completed"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : visit.status === "in_consultation"
                      ? "bg-purple-50 text-purple-700 border-purple-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                )}
              >
                {visit.status.replace("_", " ")}
              </span>
            </div>
          </div>

          {loadingBilling ? (
            <div className="p-8 text-center space-y-3">
              <Loader2 className="w-6 h-6 animate-spin text-[#1769E0] mx-auto" />
              <p className="text-xs text-gray-500">Loading billing encounter details...</p>
            </div>
          ) : isCompleted || (invoice && balanceDue === 0 && invoice.status === "paid") ? (
            /* Post-Checkout / Fully Paid Receipt View */
            <div className="space-y-6 animate-in fade-in">
              <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-2xs">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-base text-emerald-950">Patient Checkout Complete</h3>
                <p className="text-xs text-emerald-800">
                  All encounter charges have been collected. The patient visit is marked as completed.
                </p>
              </div>

              {/* Receipt Summary Card */}
              <div className="p-5 rounded-2xl border border-gray-200 bg-white space-y-4 shadow-2xs">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div>
                    <span className="text-xs font-semibold text-gray-400 block uppercase tracking-wider">
                      Tax Invoice & Receipt
                    </span>
                    <span className="text-sm font-bold text-gray-900">
                      #{invoice?.invoice_number || `INV-${visit.id.slice(0, 8)}`}
                    </span>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    PAID IN FULL
                  </span>
                </div>

                {/* Line Items List */}
                <div className="divide-y divide-gray-100 text-xs">
                  {items.map((item) => (
                    <div key={item.id} className="py-2.5 flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-gray-800 block">{item.description}</span>
                        <span className="text-[11px] text-gray-400 capitalize">
                          {item.item_type} · Qty {item.quantity} × ₹{item.unit_price}
                        </span>
                      </div>
                      <span className="font-bold text-gray-900">₹{item.total_price}</span>
                    </div>
                  ))}
                </div>

                {/* Totals Breakdown */}
                <div className="pt-3 border-t border-gray-100 space-y-1.5 text-xs">
                  <div className="flex justify-between text-gray-500">
                    <span>Total Billed:</span>
                    <span className="font-semibold text-gray-900">₹{currentTotalAmount}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>Amount Collected:</span>
                    <span className="font-semibold text-emerald-700">₹{totalPaid}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-gray-900 pt-2 border-t border-gray-100">
                    <span>Balance Due:</span>
                    <span className="text-emerald-700">₹0</span>
                  </div>
                </div>

                {/* Past Payments List */}
                {payments.length > 0 && (
                  <div className="pt-3 border-t border-gray-100">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-2">
                      Payment Transactions
                    </span>
                    <div className="space-y-1.5">
                      {payments.map((p) => (
                        <div
                          key={p.id}
                          className="p-2.5 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2">
                            {p.payment_method === "cash" ? (
                              <Banknote className="w-4 h-4 text-emerald-600" />
                            ) : p.payment_method === "upi" ? (
                              <QrCode className="w-4 h-4 text-[#1769E0]" />
                            ) : (
                              <CreditCard className="w-4 h-4 text-purple-600" />
                            )}
                            <div>
                              <span className="font-semibold text-gray-800 capitalize">
                                {p.payment_method} Payment
                              </span>
                              {p.reference_number && (
                                <span className="text-[10px] text-gray-400 block font-mono">
                                  Ref: {p.reference_number}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="font-bold text-emerald-700">₹{p.amount}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* WhatsApp status notice */}
              {whatsAppStatus && (
                <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800 font-medium animate-in fade-in">
                  {whatsAppStatus}
                </div>
              )}

              {/* Action Buttons for Receipt & Closing */}
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePrintReceipt}
                    className="h-11 rounded-xl text-xs font-semibold border-gray-200 text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
                  >
                    <Printer className="w-4 h-4 text-gray-500" />
                    <span>Print Receipt (PDF)</span>
                  </Button>

                  <Button
                    type="button"
                    onClick={handleShareWhatsApp}
                    disabled={whatsAppSending || !patient.phone}
                    className="h-11 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
                  >
                    {whatsAppSending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Share2 className="w-4 h-4" />
                    )}
                    <span>WhatsApp Receipt</span>
                  </Button>
                </div>

                <Button
                  type="button"
                  onClick={onClose}
                  className="w-full h-11 rounded-xl bg-gray-900 text-white hover:bg-gray-800 font-semibold text-xs cursor-pointer shadow-theme-xs"
                >
                  Done & Close
                </Button>
              </div>
            </div>
          ) : (
            /* Active Billing & Payment Collection Flow */
            <div className="space-y-6">
              {/* Encounter Charges Card */}
              <div className="p-5 rounded-2xl border border-gray-200 bg-white space-y-4 shadow-2xs">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                      Encounter Itemization
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {invoice ? `Invoice #${invoice.invoice_number}` : "Configure consultation and procedure charges"}
                    </p>
                  </div>
                  {invoice && (
                    <span
                      className={cn(
                        "px-2.5 py-0.5 text-xs font-bold rounded-full capitalize",
                        invoice.status === "paid"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200"
                      )}
                    >
                      {invoice.status}
                    </span>
                  )}
                </div>

                {/* Consultation Fee (Only editable when creating new invoice) */}
                {!invoice && (
                  <div className="space-y-2">
                    <Field label="OPD Consultation Fee (₹)" htmlFor="consultationFee" required>
                      <div className="relative">
                        <span className="absolute start-3 top-2.5 text-gray-400 font-semibold text-sm">₹</span>
                        <Input
                          id="consultationFee"
                          type="number"
                          min="0"
                          step="50"
                          value={consultationFee}
                          onChange={(e) => setConsultationFee(Math.max(0, Number(e.target.value)))}
                          className="ps-7 font-bold text-gray-900 rounded-xl"
                        />
                      </div>
                    </Field>

                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-[11px] text-gray-400 font-medium">Quick fee:</span>
                      {[300, 500, 800, 1000].map((fee) => (
                        <button
                          key={fee}
                          type="button"
                          onClick={() => setConsultationFee(fee)}
                          className={cn(
                            "px-2 py-0.5 text-[11px] font-semibold rounded-md border transition-colors cursor-pointer",
                            consultationFee === fee
                              ? "bg-[#EAF2FF] text-[#1769E0] border-[#1769E0]"
                              : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                          )}
                        >
                          ₹{fee}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Items List (Already on Invoice or in Draft) */}
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-gray-700 block">Billed Services & Charges</span>

                  {invoice ? (
                    /* Existing Invoice Items */
                    items.length > 0 ? (
                      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden text-xs">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="p-3 flex items-center justify-between bg-white hover:bg-gray-50/50 transition-colors"
                          >
                            <div>
                              <span className="font-semibold text-gray-900 block">{item.description}</span>
                              <span className="text-[11px] text-gray-400 capitalize">
                                {item.item_type} · Qty {item.quantity} × ₹{item.unit_price}
                              </span>
                            </div>
                            <div className="flex items-center gap-2.5">
                              <span className="font-bold text-gray-900">₹{item.total_price}</span>
                              {invoice.status !== "paid" && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(-1, item.id)}
                                  className="p-1 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Remove charge"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-3 text-center text-xs text-gray-400 border border-dashed rounded-xl">
                        No items found on this invoice.
                      </div>
                    )
                  ) : (
                    /* New Invoice Draft Additional Items */
                    additionalItems.length > 0 && (
                      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden text-xs">
                        {additionalItems.map((item, idx) => (
                          <div
                            key={idx}
                            className="p-3 flex items-center justify-between bg-white hover:bg-gray-50/50 transition-colors"
                          >
                            <span className="font-medium text-gray-800">{item.description}</span>
                            <div className="flex items-center gap-2.5">
                              <span className="font-bold text-gray-900">₹{item.unit_price}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(idx)}
                                className="p-1 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                title="Remove charge"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>

                {/* Add Additional Service / Procedure Section */}
                <div className="p-4 rounded-xl bg-gray-50/80 border border-gray-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#1769E0]" />
                      Add Additional Service / Procedure
                    </span>
                    {isAddingItem && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1769E0]" />}
                  </div>

                  {/* Quick suggestion chips */}
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_SERVICES.map((qs) => (
                      <button
                        key={qs.description}
                        type="button"
                        onClick={() => handleAddProcedure(qs.description, qs.fee)}
                        disabled={isAddingItem}
                        className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 hover:border-[#1769E0] text-gray-700 hover:text-[#1769E0] text-[11px] font-medium transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3 text-[#1769E0]" />
                        <span>{qs.description}</span>
                        <span className="text-gray-400 font-semibold">(₹{qs.fee})</span>
                      </button>
                    ))}
                  </div>

                  {/* Custom Charge Input Row */}
                  <div className="grid grid-cols-12 gap-2 pt-1">
                    <div className="col-span-7">
                      <Input
                        placeholder="Custom procedure or service"
                        value={procedureDescription}
                        onChange={(e) => setProcedureDescription(e.target.value)}
                        className="text-xs rounded-xl"
                      />
                    </div>
                    <div className="col-span-3">
                      <div className="relative">
                        <span className="absolute start-2.5 top-2.5 text-gray-400 text-xs font-semibold">₹</span>
                        <Input
                          type="number"
                          placeholder="Fee"
                          min="0"
                          value={procedureFee}
                          onChange={(e) =>
                            setProcedureFee(e.target.value === "" ? "" : Number(e.target.value))
                          }
                          className="ps-6 text-xs rounded-xl"
                        />
                      </div>
                    </div>
                    <div className="col-span-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleAddProcedure()}
                        disabled={
                          isAddingItem ||
                          !procedureDescription.trim() ||
                          typeof procedureFee !== "number" ||
                          procedureFee <= 0
                        }
                        className="w-full text-xs font-semibold h-10 rounded-xl border-gray-300 hover:bg-gray-100 cursor-pointer"
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Discount (if draft invoice) */}
                {!invoice && (
                  <Field label="Special Discount (₹)" htmlFor="checkoutDiscount">
                    <div className="relative">
                      <span className="absolute start-3 top-2.5 text-gray-400 font-semibold text-sm">₹</span>
                      <Input
                        id="checkoutDiscount"
                        type="number"
                        min="0"
                        step="10"
                        value={discount}
                        onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
                        className="ps-7 font-medium text-gray-900 rounded-xl"
                      />
                    </div>
                  </Field>
                )}

                {/* Financial Summary Hierarchy (Matches DESIGN.md) */}
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-2 text-xs">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal:</span>
                    <span className="font-semibold text-gray-900">
                      ₹{invoice ? invoice.subtotal : draftSubtotal}
                    </span>
                  </div>

                  {(invoice ? invoice.discount > 0 : discount > 0) && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount:</span>
                      <span className="font-semibold">
                        -₹{invoice ? invoice.discount : discount}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between text-gray-900 font-semibold pt-1 border-t border-gray-200">
                    <span>Total Billed:</span>
                    <span>₹{currentTotalAmount}</span>
                  </div>

                  {totalPaid > 0 && (
                    <div className="flex justify-between text-emerald-700 font-medium">
                      <span>Amount Already Paid:</span>
                      <span>₹{totalPaid}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-sm font-bold pt-2 border-t border-gray-200">
                    <span className="text-gray-900">Balance Due:</span>
                    <span className={balanceDue > 0 ? "text-rose-600" : "text-emerald-700"}>
                      ₹{balanceDue}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment Collection Form (When Balance Remains) */}
              {balanceDue > 0 ? (
                <form onSubmit={handleCheckoutAndPay} className="space-y-4 pt-1">
                  <div className="p-5 rounded-2xl border border-gray-200 bg-white space-y-4 shadow-2xs">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                          Collect Payment
                        </h3>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Specify payment mode and record transaction receipt
                        </p>
                      </div>
                      <span className="px-2.5 py-0.5 text-xs font-bold rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                        ₹{balanceDue} Pending
                      </span>
                    </div>

                    {/* Amount to Collect Input */}
                    <Field label="Amount to Collect (₹)" htmlFor="collectAmount" required>
                      <div className="relative">
                        <span className="absolute start-3.5 top-3 text-gray-500 font-bold text-base">₹</span>
                        <Input
                          id="collectAmount"
                          type="number"
                          min="1"
                          max={balanceDue}
                          value={amountToPay}
                          onChange={(e) => setAmountToPay(Math.max(0, Number(e.target.value)))}
                          className="ps-8 font-bold text-lg text-gray-900 h-12 rounded-xl"
                          required
                        />
                      </div>
                    </Field>

                    {amountToPay !== balanceDue && (
                      <div className="flex items-center justify-between text-xs text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                        <span>Partial payment selected. Remaining balance will stay due.</span>
                        <button
                          type="button"
                          onClick={() => setAmountToPay(balanceDue)}
                          className="font-bold underline cursor-pointer hover:text-amber-900"
                        >
                          Reset to Full (₹{balanceDue})
                        </button>
                      </div>
                    )}

                    {/* Payment Method Selector Tiles */}
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-gray-700 block">Payment Mode</span>
                      <div className="grid grid-cols-3 gap-3">
                        <button
                          type="button"
                          onClick={() => setPaymentMethod("cash")}
                          className={cn(
                            "p-3 rounded-xl border flex flex-col items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer shadow-2xs",
                            paymentMethod === "cash"
                              ? "bg-[#EAF2FF] border-[#1769E0] text-[#1769E0] ring-1 ring-[#1769E0]"
                              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                          )}
                        >
                          <Banknote className="w-5 h-5 text-emerald-600" />
                          <span>Cash</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setPaymentMethod("upi")}
                          className={cn(
                            "p-3 rounded-xl border flex flex-col items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer shadow-2xs",
                            paymentMethod === "upi"
                              ? "bg-[#EAF2FF] border-[#1769E0] text-[#1769E0] ring-1 ring-[#1769E0]"
                              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                          )}
                        >
                          <QrCode className="w-5 h-5 text-[#1769E0]" />
                          <span>UPI / QR</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setPaymentMethod("card")}
                          className={cn(
                            "p-3 rounded-xl border flex flex-col items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer shadow-2xs",
                            paymentMethod === "card"
                              ? "bg-[#EAF2FF] border-[#1769E0] text-[#1769E0] ring-1 ring-[#1769E0]"
                              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                          )}
                        >
                          <CreditCard className="w-5 h-5 text-purple-600" />
                          <span>Debit / Card</span>
                        </button>
                      </div>
                    </div>

                    {/* Reference / UTR field for non-cash */}
                    {paymentMethod !== "cash" && (
                      <Field
                        label={paymentMethod === "upi" ? "UPI UTR / Reference ID" : "Card Auth / Slip Number"}
                        htmlFor="drawerRefNum"
                      >
                        <Input
                          id="drawerRefNum"
                          type="text"
                          placeholder={
                            paymentMethod === "upi" ? "e.g. 423987123456" : "e.g. AUTH-98712"
                          }
                          value={referenceNumber}
                          onChange={(e) => setReferenceNumber(e.target.value)}
                          className="text-xs rounded-xl"
                        />
                      </Field>
                    )}

                    {/* Optional staff notes */}
                    <Field label="Staff Notes (Optional)" htmlFor="drawerNotes">
                      <Input
                        id="drawerNotes"
                        type="text"
                        placeholder="Internal receipt notes if any"
                        value={paymentNotes}
                        onChange={(e) => setPaymentNotes(e.target.value)}
                        className="text-xs rounded-xl"
                      />
                    </Field>
                  </div>

                  {/* Primary Action Buttons */}
                  <div className="pt-2 flex items-center justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onClose}
                      disabled={isPending}
                      className="h-11 px-5 text-xs font-semibold rounded-xl border-gray-200 cursor-pointer"
                    >
                      Cancel
                    </Button>

                    <Button
                      type="submit"
                      disabled={isPending || amountToPay <= 0}
                      className="h-11 px-6 rounded-xl bg-[#1769E0] text-white hover:bg-[#155cc0] font-semibold text-xs shadow-theme-xs cursor-pointer flex items-center gap-2"
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Recording Checkout...</span>
                        </>
                      ) : (
                        <>
                          <IndianRupee className="w-4 h-4" />
                          <span>Collect ₹{amountToPay} & Checkout</span>
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              ) : (
                /* No balance due but invoice exists */
                <div className="p-5 rounded-2xl bg-gray-50 border border-gray-200 text-center space-y-3">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                  <div className="font-bold text-sm text-gray-900">Encounter Balance is Zero</div>
                  <p className="text-xs text-gray-500">
                    No further payment is due for this visit. You can complete the checkout.
                  </p>
                  <Button
                    type="button"
                    onClick={async () => {
                      await transitionQueueState(visit.id, "completed");
                      setIsCompleted(true);
                      onSuccess();
                    }}
                    className="h-11 px-6 rounded-xl bg-[#1769E0] text-white hover:bg-[#155cc0] font-semibold text-xs cursor-pointer"
                  >
                    Mark Visit Completed
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
