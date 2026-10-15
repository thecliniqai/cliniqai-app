"use client";

import React, { useState, useEffect, useTransition } from "react";
import { QueueItem } from "./queue-card";
import {
  createVisitInvoice,
  recordPayment,
  getVisitBillingDetails,
  GetVisitBillingResult,
} from "@/features/billing/actions";
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
  FileText,
  Printer,
  IndianRupee,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckoutDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  queueItem: QueueItem | null;
  defaultFee?: number;
}

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

  // New Invoice Form state (if no invoice exists yet)
  const [consultationFee, setConsultationFee] = useState<number>(defaultFee);
  const [procedureDescription, setProcedureDescription] = useState("");
  const [procedureFee, setProcedureFee] = useState<number>(0);
  const [additionalItems, setAdditionalItems] = useState<
    { description: string; unit_price: number; quantity: number }[]
  >([]);
  const [discount, setDiscount] = useState<number>(0);

  // Payment Recording state
  const [amountToPay, setAmountToPay] = useState<number>(defaultFee);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "upi" | "card">("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  const visit = queueItem?.visit;
  const patient = queueItem?.patient;

  // Load existing billing details when drawer opens
  useEffect(() => {
    if (isOpen && visit?.id) {
      setError(null);
      setSuccessNotice(null);
      setLoadingBilling(true);
      getVisitBillingDetails(visit.id)
        .then((res) => {
          setBillingData(res);
          if (res.success && res.invoice) {
            setAmountToPay(res.balanceDue);
          } else {
            setAmountToPay(defaultFee);
          }
        })
        .catch((err) => {
          console.error("Failed to load visit billing:", err);
        })
        .finally(() => {
          setLoadingBilling(false);
        });
    }
  }, [isOpen, visit?.id, defaultFee]);

  if (!isOpen || !visit || !patient) return null;

  const handleAddProcedure = () => {
    if (!procedureDescription.trim() || procedureFee <= 0) return;
    setAdditionalItems((prev) => [
      ...prev,
      {
        description: procedureDescription.trim(),
        unit_price: procedureFee,
        quantity: 1,
      },
    ]);
    setProcedureDescription("");
    setProcedureFee(0);
  };

  const handleRemoveItem = (index: number) => {
    setAdditionalItems((prev) => prev.filter((_, i) => i !== index));
  };

  const calculateSubtotal = () => {
    const additional = additionalItems.reduce((acc, curr) => acc + curr.unit_price * curr.quantity, 0);
    return consultationFee + additional;
  };

  const subtotal = calculateSubtotal();
  const netPayable = Math.max(0, subtotal - discount);

  const handleCheckoutAndPay = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);

    startTransition(async () => {
      try {
        let invoiceId = billingData?.success && billingData.invoice ? billingData.invoice.id : null;

        // 1. If invoice does not exist, create it
        if (!invoiceId) {
          const items = [
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
            items,
            discount,
            tax: 0,
          });

          if (!invRes.success) {
            setError(invRes.error || "Failed to generate invoice.");
            return;
          }
          invoiceId = invRes.invoice.id;
        }

        // 2. Record payment
        if (amountToPay > 0 && invoiceId) {
          const payRes = await recordPayment({
            invoice_id: invoiceId,
            amount: amountToPay,
            payment_method: paymentMethod,
            reference_number: referenceNumber.trim() || undefined,
            notes: paymentNotes.trim() || undefined,
          });

          if (!payRes.success) {
            setError(payRes.error || "Failed to record payment.");
            return;
          }

          setSuccessNotice(`Payment of ₹${amountToPay} recorded successfully (${paymentMethod.toUpperCase()}).`);
        } else {
          setSuccessNotice("Invoice saved with pending balance.");
        }

        // Reload billing state and notify parent
        const updated = await getVisitBillingDetails(visit.id);
        setBillingData(updated);
        onSuccess();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to complete checkout.");
      }
    });
  };

  const invoice = billingData?.success ? billingData.invoice : null;
  const payments = billingData?.success ? billingData.payments : [];
  const totalPaid = billingData?.success ? billingData.totalPaid : 0;
  const balanceDue = billingData?.success ? billingData.balanceDue : netPayable;

  return (
    <>
      <div
        className="fixed inset-0 bg-gray-900/40 backdrop-blur-2xs z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 end-0 w-full max-w-md bg-white border-s border-gray-200 shadow-theme-xl z-50 flex flex-col animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Visit Billing Checkout</h2>
              <p className="text-xs text-gray-500">Collect fee and record payment receipt</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successNotice && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-2.5 text-xs text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{successNotice}</span>
            </div>
          )}

          {/* Patient Card Banner */}
          <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-gray-900">{patient.full_name}</span>
                {queueItem.queueToken && (
                  <span className="px-2 py-0.5 text-xs font-bold rounded bg-[#EAF2FF] text-[#1769E0]">
                    Token #{queueItem.queueToken.token_number}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {patient.phone ? `${patient.phone} · ` : ""}
                {patient.age != null ? `${patient.age} yrs` : ""}
              </p>
            </div>

            <div className="text-end">
              <span className="text-[11px] font-semibold uppercase text-gray-400 block">Status</span>
              <span className="text-xs font-bold capitalize text-gray-800">
                {visit.status.replace("_", " ")}
              </span>
            </div>
          </div>

          {/* If invoice already exists, display invoice summary & payment history */}
          {invoice ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-gray-200 bg-white space-y-3">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <span className="text-xs font-bold text-gray-700">Invoice #{invoice.invoice_number}</span>
                  <span
                    className={cn(
                      "px-2 py-0.5 text-xs font-bold rounded-full capitalize",
                      invoice.status === "paid"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    )}
                  >
                    {invoice.status}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-gray-600">
                    <span>Total Billed:</span>
                    <span className="font-semibold text-gray-900">₹{invoice.total_amount}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Amount Paid:</span>
                    <span className="font-semibold text-emerald-700">₹{totalPaid}</span>
                  </div>
                  <div className="flex justify-between font-bold text-sm pt-2 border-t border-gray-100 text-gray-900">
                    <span>Balance Due:</span>
                    <span className={balanceDue > 0 ? "text-rose-600" : "text-emerald-700"}>
                      ₹{balanceDue}
                    </span>
                  </div>
                </div>
              </div>

              {/* Past Payments List */}
              {payments.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                    Payment Receipts
                  </h4>
                  <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-gray-50/50">
                    {payments.map((p) => (
                      <div key={p.id} className="p-3 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-semibold text-gray-900 capitalize">
                            {p.payment_method} Payment
                          </span>
                          {p.reference_number && (
                            <span className="text-[11px] text-gray-400 block font-mono">
                              Ref: {p.reference_number}
                            </span>
                          )}
                        </div>
                        <span className="font-bold text-emerald-700">₹{p.amount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* New Invoice Itemization Form */
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Itemize Visit Charges
              </h3>

              <Field label="OPD Consultation Fee (₹)" htmlFor="consultationFee" required>
                <div className="relative">
                  <span className="absolute start-3 top-2.5 text-gray-400 font-semibold text-sm">₹</span>
                  <Input
                    id="consultationFee"
                    type="number"
                    min="0"
                    step="10"
                    value={consultationFee}
                    onChange={(e) => setConsultationFee(Number(e.target.value))}
                    className="ps-7 font-semibold"
                  />
                </div>
              </Field>

              {/* Add Procedure Row */}
              <div className="p-3 rounded-xl bg-gray-50/80 border border-gray-200 space-y-2">
                <span className="text-xs font-semibold text-gray-700 block">
                  Add Additional Service / Procedure
                </span>
                <div className="grid grid-cols-5 gap-2">
                  <Input
                    placeholder="e.g. ECG, Dressing"
                    value={procedureDescription}
                    onChange={(e) => setProcedureDescription(e.target.value)}
                    className="col-span-3 text-xs"
                  />
                  <Input
                    type="number"
                    placeholder="₹ Fee"
                    value={procedureFee || ""}
                    onChange={(e) => setProcedureFee(Number(e.target.value))}
                    className="col-span-2 text-xs"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddProcedure}
                  className="w-full text-xs font-semibold h-8 border-gray-300"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Charge
                </Button>
              </div>

              {/* Additional Items List */}
              {additionalItems.length > 0 && (
                <div className="space-y-1.5">
                  {additionalItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-lg border border-gray-200 bg-white text-xs"
                    >
                      <span className="font-medium text-gray-800">{item.description}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">₹{item.unit_price}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="text-gray-400 hover:text-rose-600 p-0.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Field label="Discount (₹)" htmlFor="checkoutDiscount">
                <div className="relative">
                  <span className="absolute start-3 top-2.5 text-gray-400 font-semibold text-sm">₹</span>
                  <Input
                    id="checkoutDiscount"
                    type="number"
                    min="0"
                    step="10"
                    value={discount}
                    onChange={(e) => setDiscount(Number(e.target.value))}
                    className="ps-7 font-semibold"
                  />
                </div>
              </Field>

              <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-600">Net Amount:</span>
                <span className="text-lg font-bold text-gray-900">₹{netPayable}</span>
              </div>
            </div>
          )}

          {/* Payment Section (if balance remains) */}
          {balanceDue > 0 && (
            <form onSubmit={handleCheckoutAndPay} className="space-y-4 pt-2 border-t border-gray-100">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Collect Payment
              </h3>

              <Field label="Amount to Collect (₹)" htmlFor="collectAmount" required>
                <div className="relative">
                  <span className="absolute start-3 top-2.5 text-gray-400 font-semibold text-sm">₹</span>
                  <Input
                    id="collectAmount"
                    type="number"
                    min="1"
                    max={balanceDue}
                    value={amountToPay}
                    onChange={(e) => setAmountToPay(Number(e.target.value))}
                    className="ps-7 font-bold text-gray-900"
                    required
                  />
                </div>
              </Field>

              {/* Payment Method Selector */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("cash")}
                  className={cn(
                    "p-2.5 rounded-xl border flex flex-col items-center gap-1 text-xs font-semibold transition-all cursor-pointer",
                    paymentMethod === "cash"
                      ? "bg-[#EAF2FF] border-[#1769E0] text-[#1769E0] ring-1 ring-[#1769E0]"
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
                      ? "bg-[#EAF2FF] border-[#1769E0] text-[#1769E0] ring-1 ring-[#1769E0]"
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
                      ? "bg-[#EAF2FF] border-[#1769E0] text-[#1769E0] ring-1 ring-[#1769E0]"
                      : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                  )}
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Card</span>
                </button>
              </div>

              {paymentMethod !== "cash" && (
                <Field label="Transaction Reference (UTR / Auth #)" htmlFor="drawerRefNum">
                  <Input
                    id="drawerRefNum"
                    type="text"
                    placeholder="e.g. UPI-987654 or Card Slip Auth #"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    className="text-xs"
                  />
                </Field>
              )}

              <div className="pt-2 flex justify-end gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={isPending}
                  className="h-11 px-4 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending || amountToPay <= 0}
                  className="h-11 px-5 rounded-xl bg-[#1769E0] text-white hover:bg-[#155cc0] font-semibold text-xs shadow-theme-xs cursor-pointer flex items-center gap-2"
                >
                  <IndianRupee className="w-4 h-4" />
                  <span>{isPending ? "Recording..." : `Record ₹${amountToPay}`}</span>
                </Button>
              </div>
            </form>
          )}

          {balanceDue === 0 && invoice?.status === "paid" && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <div className="font-bold text-sm text-emerald-900">Visit Fully Paid</div>
              <p className="text-xs text-emerald-700">All fees for this encounter have been collected.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
