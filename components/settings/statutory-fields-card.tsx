"use client";

import React, { useState, useTransition } from "react";
import { Tenant } from "@/lib/db/types";
import { updateStatutorySettings } from "@/features/settings/actions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Building2, Save, CheckCircle2, AlertCircle, Info, Loader2 } from "lucide-react";

interface StatutoryFieldsCardProps {
  initialTenant: Tenant;
  onSaved?: (updated: Tenant) => void;
}

export function StatutoryFieldsCard({ initialTenant, onSaved }: StatutoryFieldsCardProps) {
  const [isPending, startTransition] = useTransition();

  const [ceaRegNo, setCeaRegNo] = useState(initialTenant.clinical_establishment_reg_no || "");
  const [smcRegNo, setSmcRegNo] = useState(initialTenant.state_medical_council_reg_no || "");
  const [gstin, setGstin] = useState(initialTenant.gstin || "");
  const [drugLicenseNo, setDrugLicenseNo] = useState(initialTenant.drug_license_no || "");

  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    startTransition(async () => {
      const res = await updateStatutorySettings({
        clinical_establishment_reg_no: ceaRegNo.trim() || null,
        state_medical_council_reg_no: smcRegNo.trim() || null,
        gstin: gstin.trim() ? gstin.trim().toUpperCase() : null,
        drug_license_no: drugLicenseNo.trim() || null,
      });

      if (res.success) {
        setStatusMessage({
          type: "success",
          text: "Statutory registrations updated successfully. Details will render on official prescriptions and receipts.",
        });
        if (onSaved) {
          onSaved(res.tenant);
        }
      } else {
        setStatusMessage({
          type: "error",
          text: res.error || "Failed to update statutory details. Check required fields and retry.",
        });
      }
    });
  };

  return (
    <Card className="border border-gray-200 shadow-xs">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-[#1769E0]" />
          <CardTitle className="text-xl font-semibold text-gray-900">
            Statutory Clinic Registrations & Licenses
          </CardTitle>
        </div>
        <CardDescription className="text-sm text-gray-500">
          Official healthcare establishment and regulatory identification numbers (Optional). Printed
          on official clinic letterheads and e-prescription PDFs when populated.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {statusMessage && (
            <div
              className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs font-medium ${
                statusMessage.type === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border-rose-200 text-rose-800"
              }`}
            >
              {statusMessage.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 1. CEA Reg No */}
            <Field
              htmlFor="cea-reg-no"
              label="Clinical Establishment Act Reg. No."
              help="National / State CEA establishment registration number."
            >
              <Input
                id="cea-reg-no"
                type="text"
                value={ceaRegNo}
                onChange={(e) => setCeaRegNo(e.target.value)}
                placeholder="e.g. CEA-MH-2022-8491"
                className="uppercase font-mono text-xs"
              />
            </Field>

            {/* 2. SMC Reg No */}
            <Field
              htmlFor="smc-reg-no"
              label="State Medical Council Reg. No."
              help="Clinic registration number issued by SMC / Directorate of Health Services."
            >
              <Input
                id="smc-reg-no"
                type="text"
                value={smcRegNo}
                onChange={(e) => setSmcRegNo(e.target.value)}
                placeholder="e.g. KMC/CLINIC/2021/049"
                className="uppercase font-mono text-xs"
              />
            </Field>

            {/* 3. GSTIN */}
            <Field
              htmlFor="clinic-gstin"
              label="GSTIN (Optional)"
              help="15-digit GST identification number for taxable diagnostic/billing supplies."
            >
              <Input
                id="clinic-gstin"
                type="text"
                maxLength={15}
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="e.g. 27AAPCU5050M1ZV"
                className="uppercase font-mono text-xs"
              />
            </Field>

            {/* 4. Drug License Number */}
            <Field
              htmlFor="drug-license-no"
              label="Drug License Number (Optional)"
              help="Form 20/20B retail pharmacy or in-clinic drug dispensing license."
            >
              <Input
                id="drug-license-no"
                type="text"
                value={drugLicenseNo}
                onChange={(e) => setDrugLicenseNo(e.target.value)}
                placeholder="e.g. DL-20B-184920"
                className="uppercase font-mono text-xs"
              />
            </Field>
          </div>

          {/* Informational Callout */}
          <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 flex items-start gap-2.5 text-xs text-gray-600">
            <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
            <span>
              Optional fields. When provided, these details automatically render on official
              prescriptions, receipts, and clinical referral documents.
            </span>
          </div>

          {/* Save Action */}
          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              disabled={isPending}
              className="h-10 px-5 rounded-xl bg-[#1769E0] text-white hover:bg-[#155cc0] font-semibold text-xs shadow-theme-xs cursor-pointer flex items-center gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Statutory Details...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Statutory Details</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
