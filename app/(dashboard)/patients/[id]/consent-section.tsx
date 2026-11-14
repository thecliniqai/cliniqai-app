"use client";

import React, { useState } from "react";
import { toggleGlobalConsent, grantConsent, withdrawConsent, CurrentConsentState } from "@/features/patients/consent";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Shield, ShieldAlert, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";

interface ConsentSectionProps {
  patientId: string;
  treatmentConsent?: CurrentConsentState;
  dataSharingConsent?: CurrentConsentState;
  globalConsent?: CurrentConsentState;
}

export function ConsentSection({
  patientId,
  treatmentConsent,
  dataSharingConsent,
  globalConsent,
}: ConsentSectionProps) {
  const [loading, setLoading] = useState(false);
  const [showPurposes, setShowPurposes] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<"grant" | "withdraw" | null>(null);

  // Compute current effective global status:
  // If globalConsent exists and is not 'none', use it. Otherwise, default to treatmentConsent status.
  const isExplicitGlobal = globalConsent && globalConsent.status !== "none";
  const currentGlobalStatus: "granted" | "withdrawn" = isExplicitGlobal
    ? (globalConsent.status as "granted" | "withdrawn")
    : treatmentConsent?.status === "granted"
    ? "granted"
    : "withdrawn";

  const isGranted = currentGlobalStatus === "granted";

  const handleGlobalToggle = async () => {
    const nextStatus = isGranted ? "withdrawn" : "granted";
    setLoading(true);
    setPendingConfirm(null);

    await toggleGlobalConsent(
      patientId,
      nextStatus,
      nextStatus === "granted"
        ? "Global informed consent obtained under DPDP Act 2023"
        : "Patient formally requested global processing consent withdrawal"
    );

    setLoading(false);
  };

  const handlePurposeToggle = async (
    type: "treatment" | "data_sharing",
    currentStatus: "granted" | "withdrawn" | "none"
  ) => {
    setLoading(true);
    if (currentStatus === "granted") {
      await withdrawConsent(patientId, type, "Patient requested purpose-specific withdrawal");
    } else {
      await grantConsent(patientId, type, "Purpose-specific informed consent obtained");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {/* 1. Prominent Unified Global Consent Card (D-15, 06-UI-SPEC §4.1) */}
      <Card className="border border-gray-200 overflow-hidden shadow-xs">
        <div
          className={`p-5 sm:p-6 transition-colors ${
            isGranted ? "bg-success-bg/30" : "bg-warning-bg/30"
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                  isGranted
                    ? "bg-success-bg border-success-border text-success-fg"
                    : "bg-warning-bg border-warning-border text-warning-fg"
                }`}
              >
                {isGranted ? (
                  <Shield className="w-5 h-5 text-success-fg" />
                ) : (
                  <ShieldAlert className="w-5 h-5 text-warning-fg" />
                )}
              </div>

              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold text-gray-900">
                    Patient Processing Consent (DPDP Act 2023)
                  </h2>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      isGranted
                        ? "bg-success-bg text-success-fg border border-success-border"
                        : "bg-warning-bg text-warning-fg border border-warning-border"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isGranted ? "bg-success-solid" : "bg-warning-solid"
                      }`}
                    />
                    {isGranted ? "Active Consent" : "Withdrawn Consent"}
                  </span>
                </div>

                <p className="text-xs sm:text-sm text-gray-600 mt-1 max-w-xl leading-relaxed">
                  {isGranted
                    ? "Patient has provided explicit consent for medical care, communications, and clinical record processing under the DPDP Act 2023."
                    : "Patient has withdrawn processing consent. Outbound notifications and third-party data sharing are suppressed while statutory records remain secured."}
                </p>
              </div>
            </div>

            {/* Switch Toggle CTA */}
            <div className="flex flex-col sm:items-end gap-2 shrink-0">
              {pendingConfirm ? (
                <div className="flex items-center gap-2 animate-in fade-in">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => setPendingConfirm(null)}
                    className="h-8 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant={isGranted ? "danger" : "primary"}
                    size="sm"
                    disabled={loading}
                    onClick={handleGlobalToggle}
                    className="h-8 text-xs"
                  >
                    {loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                    ) : null}
                    Confirm {isGranted ? "Withdrawal" : "Grant"}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant={isGranted ? "outline" : "primary"}
                  size="sm"
                  disabled={loading}
                  onClick={() => setPendingConfirm(isGranted ? "withdraw" : "grant")}
                  className={`h-9 font-semibold text-xs px-4 ${
                    isGranted
                      ? "border-amber-300 text-amber-800 hover:bg-amber-50"
                      : "bg-success-solid text-white hover:bg-[#146340]"
                  }`}
                >
                  {isGranted ? "Withdraw Consent" : "Grant Consent"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* 2. Collapsible Purpose Breakdown Details */}
        <div className="border-t border-gray-100 bg-white">
          <button
            type="button"
            onClick={() => setShowPurposes(!showPurposes)}
            className="w-full px-5 py-3 flex items-center justify-between text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-50/50 transition-colors cursor-pointer"
          >
            <span>Specific Purpose Consent Breakdown (Treatment & Data Sharing)</span>
            {showPurposes ? (
              <ChevronUp className="w-4 h-4 text-fg-subtle" />
            ) : (
              <ChevronDown className="w-4 h-4 text-fg-subtle" />
            )}
          </button>

          {showPurposes && (
            <CardContent className="divide-y divide-gray-100 pt-0 pb-4">
              {/* Clinical Treatment Row */}
              <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">Clinical Treatment Consent</span>
                    <span
                      className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full flex items-center gap-1 ${
                        treatmentConsent?.status === "granted"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}
                    >
                      {treatmentConsent?.status === "granted" ? (
                        <>
                          <CheckCircle2 className="w-2.5 h-2.5" /> Granted
                        </>
                      ) : (
                        <>
                          <XCircle className="w-2.5 h-2.5" /> Withdrawn
                        </>
                      )}
                    </span>
                  </div>
                  <p className="text-gray-500 mt-0.5">
                    Consent to undergo medical examination, diagnostics, and clinical care.
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() =>
                    handlePurposeToggle("treatment", treatmentConsent?.status || "none")
                  }
                  className="h-7 text-[11px] shrink-0"
                >
                  {treatmentConsent?.status === "granted" ? "Withdraw" : "Grant"}
                </Button>
              </div>

              {/* Health Data Sharing Row */}
              <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">Health Data Sharing Consent</span>
                    <span
                      className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full flex items-center gap-1 ${
                        dataSharingConsent?.status === "granted"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}
                    >
                      {dataSharingConsent?.status === "granted" ? (
                        <>
                          <CheckCircle2 className="w-2.5 h-2.5" /> Granted
                        </>
                      ) : (
                        <>
                          <XCircle className="w-2.5 h-2.5" /> Withdrawn
                        </>
                      )}
                    </span>
                  </div>
                  <p className="text-gray-500 mt-0.5">
                    Consent to share medical records with referring physicians or diagnostic networks.
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() =>
                    handlePurposeToggle("data_sharing", dataSharingConsent?.status || "none")
                  }
                  className="h-7 text-[11px] shrink-0"
                >
                  {dataSharingConsent?.status === "granted" ? "Withdraw" : "Grant"}
                </Button>
              </div>
            </CardContent>
          )}
        </div>
      </Card>
    </div>
  );
}
