"use client";

import { useState } from "react";
import { grantConsent, withdrawConsent, CurrentConsentState } from "@/features/patients/consent";
import { Button } from "@/components/ui/button";
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
      <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[#1A1A1A]">{label}</span>
            <span
              className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded flex items-center gap-1 ${
                isGranted
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {isGranted ? (
                <>
                  <CheckCircle2 className="w-3 h-3" /> Granted
                </>
              ) : (
                <>
                  <XCircle className="w-3 h-3" /> Withdrawn / None
                </>
              )}
            </span>
          </div>
          <p className="text-xs text-[#666] mt-0.5">{description}</p>
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
    <section className="bg-white border border-[#E5E4E0] rounded-lg p-6 space-y-4">
      <h2 className="text-base font-semibold text-[#1A1A1A] flex items-center gap-2">
        <Shield className="w-4 h-4 text-[#1769E0]" />
        Patient Consent Status (Append-Only)
      </h2>
      <p className="text-xs text-[#666]">
        Consent grants and withdrawals are appended immutably. Historical grants
        are never overwritten.
      </p>

      <div className="divide-y divide-[#E5E4E0] pt-2">
        {renderConsentRow(
          "Clinical Treatment Consent",
          "Consent to undergo clinical consultation, diagnosis, and treatment.",
          "treatment",
          treatmentConsent
        )}
        {renderConsentRow(
          "Health Data Sharing Consent",
          "Consent to share diagnostic records with referring physicians or ABDM.",
          "data_sharing",
          dataSharingConsent
        )}
      </div>
    </section>
  );
}
