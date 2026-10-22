"use client";

import React, { useState } from "react";
import {
  X,
  Share2,
  AlertCircle,
  Loader2,
  FileText,
  Building2,
  User,
  Printer,
  CheckCircle2,
} from "lucide-react";
import { createReferral, getReferralSignedUrl } from "@/features/referrals/actions";
import { Referral, ReferralType, ReferralUrgency, LetterheadMode } from "@/lib/db/types";

export interface CreateReferralModalProps {
  patientId: string;
  patientName: string;
  patientPhone?: string | null;
  visitId?: string | null;
  currentDiagnoses?: string[];
  currentMedications?: {
    medicine_name: string;
    dosage: string;
    timing?: string | null;
    duration: string;
  }[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (referral: Referral, signedUrl?: string) => void;
}

const COMMON_SPECIALTIES = [
  "Cardiology",
  "Dermatology",
  "Endocrinology",
  "ENT (Otolaryngology)",
  "Gastroenterology",
  "General Surgery",
  "Gynecology & Obstetrics",
  "Neurology",
  "Oncology",
  "Ophthalmology",
  "Orthopedics",
  "Pediatrics",
  "Psychiatry",
  "Pulmonology",
  "Radiology",
  "Urology",
  "Other Specialist",
];

export function CreateReferralModal({
  patientId,
  patientName,
  patientPhone,
  visitId,
  currentDiagnoses = [],
  currentMedications = [],
  isOpen,
  onClose,
  onSuccess,
}: CreateReferralModalProps) {
  const [referralType, setReferralType] = useState<ReferralType>("out_of_network");
  const [referredToName, setReferredToName] = useState<string>("Dr. ");
  const [referredToFacility, setReferredToFacility] = useState<string>("");
  const [referredToSpecialty, setReferredToSpecialty] = useState<string>("Cardiology");
  const [referredToContact, setReferredToContact] = useState<string>("");
  const [targetTenantId, setTargetTenantId] = useState<string>("");
  const [urgency, setUrgency] = useState<ReferralUrgency>("routine");
  const [reasonForReferral, setReasonForReferral] = useState<string>("");
  const [provisionalDiagnosis, setProvisionalDiagnosis] = useState<string>(
    currentDiagnoses.join(", ")
  );
  const [clinicalSummary, setClinicalSummary] = useState<string>("");
  const [patientConsentsHistory, setPatientConsentsHistory] = useState<boolean>(false);
  const [letterheadMode, setLetterheadMode] = useState<LetterheadMode>("blank_paper");

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isOpeningPdf, setIsOpeningPdf] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<{
    referral: Referral;
    signedUrl?: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleClose = () => {
    setCreatedResult(null);
    setError(null);
    onClose();
  };

  const handlePrintLetter = async () => {
    if (!createdResult) return;
    let url = createdResult.signedUrl;
    if (!url) {
      setIsOpeningPdf(true);
      try {
        const res = await getReferralSignedUrl(createdResult.referral.id);
        if (res.success && res.signedUrl) {
          url = res.signedUrl;
          setCreatedResult((prev) => (prev ? { ...prev, signedUrl: res.signedUrl } : null));
        } else {
          setError(res.error || "Failed to retrieve referral letter PDF.");
          setIsOpeningPdf(false);
          return;
        }
      } catch {
        setError("Failed to generate referral letter download link.");
        setIsOpeningPdf(false);
        return;
      }
      setIsOpeningPdf(false);
    }

    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!referredToName.trim() || referredToName.trim() === "Dr.") {
      setError("Please provide the specialist or recipient doctor name.");
      return;
    }

    if (!reasonForReferral.trim() || reasonForReferral.trim().length < 3) {
      setError("Please specify the clinical reason for this referral (at least 3 characters).");
      return;
    }

    if (referralType === "in_network" && !targetTenantId.trim()) {
      setError("Please provide the Target Partner Clinic ID for in-network referrals.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await createReferral({
        patient_id: patientId,
        visit_id: visitId || null,
        referral_type: referralType,
        referred_to_name: referredToName.trim(),
        referred_to_facility: referredToFacility.trim() || null,
        referred_to_specialty: referredToSpecialty || null,
        referred_to_contact: referredToContact.trim() || null,
        target_tenant_id: referralType === "in_network" ? targetTenantId.trim() : null,
        reason_for_referral: reasonForReferral.trim(),
        provisional_diagnosis: provisionalDiagnosis.trim() || null,
        urgency,
        clinical_summary: clinicalSummary.trim() || null,
        active_medications_snapshot: currentMedications,
        patient_consents_history_sharing: referralType === "in_network" && patientConsentsHistory,
        letterhead_mode: letterheadMode,
      });

      if (!res.success || !res.referral) {
        setError(res.error || "Failed to create referral.");
        setIsSubmitting(false);
        return;
      }

      // Automatically open the referral note in a new tab immediately
      if (res.signedUrl) {
        try {
          window.open(res.signedUrl, "_blank", "noopener,noreferrer");
        } catch (e) {
          console.warn("Popup blocked by browser:", e);
        }
      }

      onSuccess(res.referral, res.signedUrl);
      setCreatedResult({
        referral: res.referral,
        signedUrl: res.signedUrl,
      });
      setIsSubmitting(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create referral.");
      setIsSubmitting(false);
    }
  };

  // 1. Success confirmation screen with direct PDF print action on same screen
  if (createdResult) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="referral-success-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto"
      >
        <div className="bg-white rounded-2xl shadow-theme-lg border border-gray-200 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-6">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-[#EAF2FF]/60">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#1769E0] text-white flex items-center justify-center flex-shrink-0 shadow-xs">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <h2
                  id="referral-success-title"
                  className="text-base font-bold text-gray-900"
                >
                  Referral Issued Successfully
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Patient: <span className="font-semibold text-gray-800">{patientName}</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close dialog"
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <div className="p-4 rounded-xl border border-gray-200 bg-[#F8FAFC] space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Referred To
                  </div>
                  <div className="text-sm font-bold text-gray-900">
                    {createdResult.referral.referred_to_name.startsWith("Dr.")
                      ? createdResult.referral.referred_to_name
                      : `Dr. ${createdResult.referral.referred_to_name}`}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    {createdResult.referral.referred_to_specialty
                      ? `${createdResult.referral.referred_to_specialty} • `
                      : ""}
                    {createdResult.referral.referred_to_facility ||
                      (createdResult.referral.referral_type === "in_network"
                        ? "Partner Clinic"
                        : "External Specialist")}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FFF5E5] text-[#9A5B00] border border-[#F3D39A]">
                    {createdResult.referral.status}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#FFEDEC] text-[#BA1A1A]">
                    {createdResult.referral.urgency.toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="text-xs text-gray-700 pt-2 border-t border-gray-200/60">
                <span className="font-semibold text-gray-900">Reason: </span>
                {createdResult.referral.reason_for_referral}
              </div>
            </div>

            <div className="rounded-xl border border-blue-200 bg-[#EAF2FF] p-3.5 text-xs text-blue-900 flex items-start gap-2.5">
              <Printer className="h-4 w-4 text-[#1769E0] flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-blue-950">
                  Referral Note & Letter Ready for Printing
                </p>
                <p className="text-blue-800 leading-relaxed text-[11px]">
                  A new window was opened automatically with the printable referral note. You can also print or re-open it at any time using the button below.
                </p>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 px-6 py-4 border-t border-gray-100 bg-[#F8FAFC]">
            <button
              type="button"
              onClick={handleClose}
              className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl border border-gray-300 bg-white hover:bg-gray-100 text-gray-700 text-xs font-semibold flex items-center justify-center transition-colors cursor-pointer"
            >
              Done / Close
            </button>

            <button
              type="button"
              onClick={handlePrintLetter}
              disabled={isOpeningPdf}
              className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-[#1769E0] hover:bg-[#155cc0] text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
            >
              {isOpeningPdf ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading PDF...</span>
                </>
              ) : (
                <>
                  <Printer className="h-4 w-4" />
                  <span>Print Referral Note (PDF)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-referral-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto"
    >
      <div className="bg-white rounded-2xl shadow-theme-lg border border-gray-200 max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-6">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-[#F8FAFC]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#EAF2FF] text-[#1769E0] flex items-center justify-center flex-shrink-0">
              <Share2 className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="create-referral-title"
                className="text-base font-bold text-gray-900"
              >
                Issue Clinical Referral
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Patient: <span className="font-semibold text-gray-800">{patientName}</span>
                {patientPhone ? ` • ${patientPhone}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close dialog"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 1. Referral Type Tabs */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Referral Destination
            </label>
            <div className="grid grid-cols-2 gap-2 bg-gray-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setReferralType("out_of_network")}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  referralType === "out_of_network"
                    ? "bg-white text-gray-900 shadow-xs"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <User className="h-3.5 w-3.5 text-[#1769E0]" />
                <span>Out-of-Network Specialist</span>
              </button>
              <button
                type="button"
                onClick={() => setReferralType("in_network")}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  referralType === "in_network"
                    ? "bg-white text-gray-900 shadow-xs"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <Building2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>In-Network Partner Clinic</span>
              </button>
            </div>
          </div>

          {/* 2. Recipient Specialist Details */}
          <div className="space-y-3 p-4 rounded-xl border border-gray-200 bg-[#F8FAFC]">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Recipient Specialist Information
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Doctor / Specialist Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Rajesh Verma"
                  value={referredToName}
                  onChange={(e) => setReferredToName(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Specialty
                </label>
                <select
                  value={referredToSpecialty}
                  onChange={(e) => setReferredToSpecialty(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
                >
                  {COMMON_SPECIALTIES.map((spec) => (
                    <option key={spec} value={spec}>
                      {spec}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Hospital / Facility Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Max Super Speciality Hospital"
                  value={referredToFacility}
                  onChange={(e) => setReferredToFacility(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Contact Phone / Email
                </label>
                <input
                  type="text"
                  placeholder="e.g. +91 98112 23344"
                  value={referredToContact}
                  onChange={(e) => setReferredToContact(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
                />
              </div>
            </div>

            {/* In-Network Target Clinic ID */}
            {referralType === "in_network" && (
              <div className="pt-2 border-t border-gray-200">
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Target Clinic ID (UUID) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Paste destination clinic UUID..."
                  value={targetTenantId}
                  onChange={(e) => setTargetTenantId(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-gray-300 text-xs text-gray-900 bg-white font-mono focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  The target partner clinic will securely receive this referral in their Inbound Referrals register.
                </p>
              </div>
            )}
          </div>

          {/* 3. Clinical Reason & Urgency */}
          <div className="space-y-3">
            {/* Urgency Picker */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Clinical Urgency Level
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "routine", label: "Routine (Regular OPD)" },
                  { id: "priority", label: "Priority (1–3 Days)" },
                  { id: "urgent", label: "Urgent (Same Day / Fast Track)" },
                ].map(({ id, label }) => {
                  const isSelected = urgency === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setUrgency(id as ReferralUrgency)}
                      className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center ${
                        isSelected
                          ? id === "urgent"
                            ? "bg-[#FFEDEC] border-[#FFDAD6] text-[#BA1A1A] shadow-xs"
                            : id === "priority"
                            ? "bg-[#FFF5E5] border-[#F3D39A] text-[#9A5B00] shadow-xs"
                            : "bg-[#EAF2FF] border-[#BFD8FF] text-[#1769E0] shadow-xs"
                          : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Reason for Referral */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Reason for Referral <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={2}
                required
                placeholder="e.g. Suspected CAD with atypical angina; advice coronary angiogram and secondary evaluation"
                value={reasonForReferral}
                onChange={(e) => setReasonForReferral(e.target.value)}
                className="w-full p-3 rounded-xl border border-gray-300 text-xs text-gray-900 bg-white placeholder:text-gray-400 focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
              />
            </div>

            {/* Provisional Diagnosis */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Provisional Diagnosis
              </label>
              <input
                type="text"
                placeholder="e.g. Unstable Angina / Atypical CAD"
                value={provisionalDiagnosis}
                onChange={(e) => setProvisionalDiagnosis(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
              />
            </div>

            {/* Clinical Summary & Notes */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Clinical Summary & Presenting History
              </label>
              <textarea
                rows={3}
                placeholder="Brief clinical context, physical findings, ECG/vitals highlights, or specific questions for the specialist..."
                value={clinicalSummary}
                onChange={(e) => setClinicalSummary(e.target.value)}
                className="w-full p-3 rounded-xl border border-gray-300 text-xs text-gray-900 bg-white placeholder:text-gray-400 focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
              />
            </div>
          </div>

          {/* 4. DPDP Consent Toggle (In-Network only) */}
          {referralType === "in_network" && (
            <div className="p-3.5 rounded-xl border border-blue-200 bg-[#EAF2FF] space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={patientConsentsHistory}
                  onChange={(e) => setPatientConsentsHistory(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#1769E0] focus:ring-[#1769E0]"
                />
                <div className="text-xs">
                  <span className="font-bold text-blue-900">
                    DPDP Consent: Share Clinical History Summary
                  </span>
                  <p className="text-blue-800 text-[11px] mt-0.5">
                    Patient has provided explicit consent to securely bundle their past encounter diagnoses, vitals, and current medication snapshots for the receiving clinician.
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* 5. Letterhead Stationery Mode */}
          <div className="pt-3 border-t border-gray-100">
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Letterhead Paper Mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 p-3 rounded-xl border border-gray-200 bg-[#F8FAFC] cursor-pointer hover:bg-gray-100 transition-colors">
                <input
                  type="radio"
                  name="letterhead_mode"
                  value="blank_paper"
                  checked={letterheadMode === "blank_paper"}
                  onChange={() => setLetterheadMode("blank_paper")}
                  className="text-[#1769E0] focus:ring-[#1769E0]"
                />
                <div className="text-xs">
                  <div className="font-semibold text-gray-900">Blank Paper</div>
                  <div className="text-[11px] text-gray-500">Prints clinic logo & header</div>
                </div>
              </label>

              <label className="flex items-center gap-2 p-3 rounded-xl border border-gray-200 bg-[#F8FAFC] cursor-pointer hover:bg-gray-100 transition-colors">
                <input
                  type="radio"
                  name="letterhead_mode"
                  value="preprinted_letterhead"
                  checked={letterheadMode === "preprinted_letterhead"}
                  onChange={() => setLetterheadMode("preprinted_letterhead")}
                  className="text-[#1769E0] focus:ring-[#1769E0]"
                />
                <div className="text-xs">
                  <div className="font-semibold text-gray-900">Pre-printed Pad</div>
                  <div className="text-[11px] text-gray-500">Leaves top letterhead margin</div>
                </div>
              </label>
            </div>
          </div>

          {/* Footer CTAs */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleClose}
              className="min-h-[44px] px-4 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !referredToName.trim() || !reasonForReferral.trim()}
              className="min-h-[44px] px-5 rounded-xl bg-[#1769E0] hover:bg-[#155cc0] text-white text-xs font-semibold flex items-center gap-2 shadow-theme-xs transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Generating letter PDF...</span>
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  <span>Issue Referral & Generate Letter</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
