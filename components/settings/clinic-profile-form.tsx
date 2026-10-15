"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tenant } from "@/lib/db/types";
import { updateClinicSettings } from "@/features/settings/actions";
import { ALLOWED_SPECIALTIES } from "@/features/clinics/constants";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import {
  Building2,
  Stethoscope,
  IndianRupee,
  Save,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  QrCode,
  Banknote,
} from "lucide-react";

interface ClinicProfileFormProps {
  initialTenant: Tenant;
}

export function ClinicProfileForm({ initialTenant }: ClinicProfileFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(initialTenant.name || "");
  const [address, setAddress] = useState(initialTenant.address || "");
  const [timezone, setTimezone] = useState(initialTenant.timezone || "Asia/Kolkata");
  const [specialties, setSpecialties] = useState<string[]>(initialTenant.specialties || []);
  
  const [ownerIsPracticing, setOwnerIsPracticing] = useState<boolean>(
    initialTenant.owner_is_practicing_doctor ?? true
  );
  const [consultationFee, setConsultationFee] = useState<number>(
    initialTenant.default_consultation_fee ?? 500
  );
  const [followupFee, setFollowupFee] = useState<number>(
    initialTenant.default_followup_fee ?? 300
  );
  const [paymentMethods, setPaymentMethods] = useState<string[]>(
    initialTenant.accepted_payment_methods ?? ["cash", "upi", "card"]
  );

  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleSpecialtyToggle = (spec: string) => {
    setSpecialties((prev) =>
      prev.includes(spec) ? prev.filter((s) => s !== spec) : [...prev, spec]
    );
  };

  const handlePaymentMethodToggle = (method: string) => {
    setPaymentMethods((prev) => {
      const exists = prev.includes(method);
      if (exists) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter((m) => m !== method);
      }
      return [...prev, method];
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    startTransition(async () => {
      const res = await updateClinicSettings({
        name,
        address: address || null,
        specialties,
        timezone,
        owner_is_practicing_doctor: ownerIsPracticing,
        default_consultation_fee: Number(consultationFee),
        default_followup_fee: Number(followupFee),
        accepted_payment_methods: paymentMethods as ("cash" | "upi" | "card")[],
      });

      if (res.success) {
        setStatusMessage({
          type: "success",
          text: "Clinic profile and OPD fee settings saved successfully.",
        });
        router.refresh();
      } else {
        setStatusMessage({
          type: "error",
          text: res.error || "Failed to update settings.",
        });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {statusMessage && (
        <div
          className={`p-4 rounded-xl flex items-center gap-2.5 text-sm font-medium border ${
            statusMessage.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-rose-50 text-rose-800 border-rose-200"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Card 1: Clinic Identity & Organization */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-[#1769E0] border border-blue-100">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <CardTitle>Clinic Identity & Operations</CardTitle>
              <CardDescription>
                Public organization information visible on appointment slips and receipts
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field label="Clinic Name" htmlFor="name" required>
            <Input
              id="name"
              name="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. City Health Clinic"
            />
          </Field>

          <Field label="Physical Address" htmlFor="address">
            <Input
              id="address"
              name="address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Suite 101, Main Healthcare Complex"
            />
          </Field>

          <Field
            label="Practice Specialties"
            htmlFor="specialties"
            help="Select all medical disciplines offered at this clinic."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2 p-3 bg-gray-50/70 rounded-xl border border-gray-200">
              {ALLOWED_SPECIALTIES.map((spec) => {
                const checked = specialties.includes(spec);
                return (
                  <label
                    key={spec}
                    className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleSpecialtyToggle(spec)}
                      className="w-4 h-4 rounded border-gray-300 text-[#1769E0] focus:ring-[#1769E0]/20 cursor-pointer"
                    />
                    <span>{spec}</span>
                  </label>
                );
              })}
            </div>
          </Field>

          <Field label="Operational Timezone" htmlFor="timezone" required>
            <Input
              id="timezone"
              name="timezone"
              type="text"
              required
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Card 2: Practitioner Model & OPD Fee Defaults */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100">
              <Stethoscope className="w-4 h-4" />
            </div>
            <div>
              <CardTitle>Practicing Doctors & OPD Fees</CardTitle>
              <CardDescription>
                Configure practice model, practitioner permissions, and standard consultation charges
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Owner Practicing Doctor Switch */}
          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/60 flex items-start justify-between gap-4">
            <div>
              <div className="font-semibold text-sm text-gray-900">
                Is Clinic Owner a practicing doctor?
              </div>
              <p className="text-xs text-gray-500 mt-1 max-w-lg leading-relaxed">
                When enabled (standard for single-doctor outpatient clinics), the owner
                automatically has clinical access to Doctor&apos;s Cabin, e-prescriptions,
                and direct consultation workflows.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
              <input
                type="checkbox"
                checked={ownerIsPracticing}
                onChange={(e) => setOwnerIsPracticing(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1769E0]" />
            </label>
          </div>

          {/* OPD Consultation Fees */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Standard Consultation Fee (₹)"
              htmlFor="consultationFee"
              help="Default fee applied when starting a new OPD consultation."
              required
            >
              <div className="relative">
                <span className="absolute start-3 top-2.5 text-gray-400 font-medium text-sm">
                  ₹
                </span>
                <Input
                  id="consultationFee"
                  type="number"
                  min="0"
                  step="10"
                  required
                  value={consultationFee}
                  onChange={(e) => setConsultationFee(Number(e.target.value))}
                  className="ps-7"
                />
              </div>
            </Field>

            <Field
              label="Follow-up Consultation Fee (₹)"
              htmlFor="followupFee"
              help="Discounted fee applied for patient reviews within validity window."
              required
            >
              <div className="relative">
                <span className="absolute start-3 top-2.5 text-gray-400 font-medium text-sm">
                  ₹
                </span>
                <Input
                  id="followupFee"
                  type="number"
                  min="0"
                  step="10"
                  required
                  value={followupFee}
                  onChange={(e) => setFollowupFee(Number(e.target.value))}
                  className="ps-7"
                />
              </div>
            </Field>
          </div>

          {/* Accepted Payment Methods */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1.5">
              Accepted Payment Methods
            </label>
            <p className="text-xs text-gray-500 mb-3">
              Payment methods available during consultation checkout and front desk billing.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  paymentMethods.includes("cash")
                    ? "bg-[#EAF2FF] border-[#B2CCFF] text-[#1769E0]"
                    : "bg-white border-gray-200 text-gray-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={paymentMethods.includes("cash")}
                  onChange={() => handlePaymentMethodToggle("cash")}
                  className="w-4 h-4 rounded border-gray-300 text-[#1769E0] focus:ring-[#1769E0]/20 cursor-pointer"
                />
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Banknote className="w-4 h-4" />
                  <span>Cash</span>
                </div>
              </label>

              <label
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  paymentMethods.includes("upi")
                    ? "bg-[#EAF2FF] border-[#B2CCFF] text-[#1769E0]"
                    : "bg-white border-gray-200 text-gray-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={paymentMethods.includes("upi")}
                  onChange={() => handlePaymentMethodToggle("upi")}
                  className="w-4 h-4 rounded border-gray-300 text-[#1769E0] focus:ring-[#1769E0]/20 cursor-pointer"
                />
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <QrCode className="w-4 h-4" />
                  <span>UPI QR</span>
                </div>
              </label>

              <label
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  paymentMethods.includes("card")
                    ? "bg-[#EAF2FF] border-[#B2CCFF] text-[#1769E0]"
                    : "bg-white border-gray-200 text-gray-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={paymentMethods.includes("card")}
                  onChange={() => handlePaymentMethodToggle("card")}
                  className="w-4 h-4 rounded border-gray-300 text-[#1769E0] focus:ring-[#1769E0]/20 cursor-pointer"
                />
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <CreditCard className="w-4 h-4" />
                  <span>Debit / Card</span>
                </div>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          disabled={isPending}
          className="h-11 px-6 rounded-xl bg-[#1769E0] text-white hover:bg-[#155cc0] font-semibold text-sm shadow-theme-xs cursor-pointer flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          <span>{isPending ? "Saving Settings..." : "Save Clinic Settings"}</span>
        </Button>
      </div>
    </form>
  );
}
