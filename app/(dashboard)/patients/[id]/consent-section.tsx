"use client";

import { useState } from "react";
import { grantConsent, withdrawConsent, CurrentConsentState } from "@/features/patients/consent";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Shield, CheckCircle2, XCircle } from "lucide-react";

interface ConsentSectionProps {
  patientId: string;
  treatmentConsent: CurrentConsentState;
  dataSharingConsent: CurrentConsentState;
}

export function ConsentSection({
  patientId,
  treatmentConsent,
  dataSharingConsent,
}: ConsentSectionProps) {
  const [loading, setLoading] = useState(false);

  const handleToggleConsent = async (
    type: "treatment" | "data_sharing",
    currentStatus: "granted" | "withdrawn" | "none"
  ) => {
    setLoading(true);
    if (currentStatus === "granted") {
      await withdrawConsent(patientId, type, "Patient requested withdrawal");
    } else {
      await grantConsent(patientId, type, "Informed consent obtained");
    }
    setLoading(false);
  };

  const renderConsentRow = (
    label: string,
    description: string,
    type: "treatment" | "data_sharing",
    state: CurrentConsentState
  ) => {
    const isGranted = state.status === "granted";

    return (
      <div className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">{label}</span>
            <span
              className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full flex items-center gap-1 ${
                isGranted
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-amber-50 text-amber-700 border border-amber-200"
              }`}
            >
              {isGranted ? (
                <>
                  <CheckCircle2 className="w-3 h-3" /> Granted
                </>
              ) : (
                <>
                  <XCircle className="w-3 h-3" /> Withdrawn
                </>
              )}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">{description}</p>
        </div>

        <Button
          type="button"
          variant={isGranted ? "secondary" : "primary"}
          size="sm"
          disabled={loading}
          onClick={() => handleToggleConsent(type, state.status)}
          className="shrink-0"
        >
          {isGranted ? "Withdraw Consent" : "Grant Consent"}
        </Button>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#1769E0]" />
          <span>Patient Consent Status (Append-Only)</span>
        </CardTitle>
        <p className="text-xs text-gray-500">
          Consent history is cryptographically logged and immutable.
        </p>
      </CardHeader>
      <CardContent className="divide-y divide-gray-100">
        {renderConsentRow(
          "Clinical Treatment Consent",
          "Consent to undergo clinical examination, diagnostics, and medical treatment.",
          "treatment",
          treatmentConsent
        )}
        {renderConsentRow(
          "Health Data Sharing Consent",
          "Consent to share medical records with referring physicians or ABDM networks.",
          "data_sharing",
          dataSharingConsent
        )}
      </CardContent>
    </Card>
  );
}
