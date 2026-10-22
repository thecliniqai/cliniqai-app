"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Vitals,
  ChiefComplaintItem,
  ClinicalSpecialty,
  SpecialtyData,
  GPSpecialty,
  DentalSpecialty,
  PediatricsSpecialty,
  FollowUpInput,
} from "@/features/consultation/schema";
import { saveConsultationDraft, type PastVisitEncounter } from "@/features/consultation/actions";
import { VitalsBlock } from "./vitals-block";
import { ChiefComplaintsSection } from "./chief-complaints-section";
import { PatientHistoryDrawer } from "./patient-history-drawer";
import { DiagnosisSection } from "./diagnosis-section";
import type { ConsultationDiagnosisItem } from "@/features/terminology/schema";
import { PrescriptionBuilder } from "./prescription-builder";
import { addPrescriptionItem } from "@/features/prescriptions/actions";
import type { PrescriptionItem } from "@/lib/db/types";
import { GPSystemicReview } from "./specialty/gp-systemic-review";
import { DentalOdontogram } from "./specialty/dental-odontogram";
import { PediatricsTools } from "./specialty/pediatrics-tools";
import { SignAndBillModal } from "./sign-and-bill-modal";
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  AlertCircle,
  History,
  Save,
  FileText,
  FlaskConical,
  HeartPulse,
  Calendar,
  UploadCloud,
  X,
  Plus,
  ShieldAlert,
  ChevronRight,
  ExternalLink,
  Printer,
  Receipt,
  Check,
  Share2,
} from "lucide-react";
import { CreateReferralModal } from "@/components/referrals/create-referral-modal";
import { getReferralSignedUrl } from "@/features/referrals/actions";
import type { Referral } from "@/lib/db/types";

export interface ConsultationWorkspaceProps {
  visit: {
    id: string;
    patient_id: string;
    doctor_id: string;
    status: string;
    scheduled_at: string | null;
    token_number?: number | null;
    vitals?: Vitals | null;
    chief_complaints?: ChiefComplaintItem[] | null;
    clinical_notes?: string | null;
    specialty?: ClinicalSpecialty;
    specialty_data?: SpecialtyData | null;
    investigations_advised?: string[];
    advice?: string[];
    follow_up?: FollowUpInput | null;
    diagnoses?: ConsultationDiagnosisItem[];
    prescription_items?: PrescriptionItem[];
  };
  patient: {
    id: string;
    full_name: string;
    phone: string;
    gender: "male" | "female" | "other" | null;
    date_of_birth: string | null;
    age?: number | null;
    allergies?: string[];
    chronic_conditions?: string[];
    uhid?: string | null;
  };
  pastEncounters?: PastVisitEncounter[];
}

const COMMON_INVESTIGATIONS = [
  "Complete Blood Count (CBC)",
  "Fasting Blood Sugar (FBS)",
  "Postprandial Blood Sugar (PPBS)",
  "HbA1c",
  "Thyroid Profile (TSH, T3, T4)",
  "Lipid Profile",
  "Urine Routine & Microscopic",
  "Chest X-Ray (PA View)",
  "Serum Creatinine / KFT",
  "Liver Function Test (LFT)",
  "Serum Electrolytes",
  "Serum Uric Acid",
  "ECG (12-Lead)",
  "Ultrasound Whole Abdomen",
];

const COMMON_ADVICE_CHIPS = [
  "Warm saline gargles 3-4 times daily",
  "Steam inhalation twice daily",
  "Plenty of oral fluids (3-4 litres/day)",
  "Avoid cold, fried and spicy food",
  "Diabetic diet: low glycemic index, small frequent meals",
  "Soft, easily digestible bland diet",
  "Adequate bed rest for 2-3 days",
  "Avoid heavy lifting and strenuous exertion",
  "Keep wound clean and dry",
  "Take medications strictly after meals",
];

export function ConsultationWorkspace({
  visit,
  patient,
  pastEncounters = [],
}: ConsultationWorkspaceProps) {
  const router = useRouter();

  // Core Form State
  const [specialty, setSpecialty] = useState<ClinicalSpecialty>(
    visit.specialty ?? "general_physician"
  );
  const [vitals, setVitals] = useState<Vitals | null>(visit.vitals ?? null);
  const [chiefComplaints, setChiefComplaints] = useState<ChiefComplaintItem[]>(
    visit.chief_complaints ?? []
  );
  const [clinicalNotes, setClinicalNotes] = useState<string>(visit.clinical_notes ?? "");
  const [specialtyData, setSpecialtyData] = useState<SpecialtyData | null>(
    visit.specialty_data ?? null
  );
  const [investigations, setInvestigations] = useState<string[]>(
    visit.investigations_advised ?? []
  );
  const [customInvestigation, setCustomInvestigation] = useState("");
  const [adviceList, setAdviceList] = useState<string[]>(visit.advice ?? []);
  const [customAdvice, setCustomAdvice] = useState("");

  // Follow-up state
  const [followUpInterval, setFollowUpInterval] = useState<
    "none" | "3_days" | "5_days" | "1_week" | "2_weeks" | "custom"
  >(
    (visit.follow_up?.interval as "none" | "3_days" | "5_days" | "1_week" | "2_weeks" | "custom") ??
      (visit.follow_up?.follow_up_date ? "custom" : "5_days")
  );
  const [followUpDate, setFollowUpDate] = useState<string>(
    visit.follow_up?.follow_up_date ??
      (() => {
        const d = new Date();
        d.setDate(d.getDate() + 5);
        return d.toISOString().split("T")[0];
      })()
  );
  const [followUpNotes, setFollowUpNotes] = useState<string>(
    visit.follow_up?.notes ?? ""
  );

  // Auto-save and Drawer State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const inFlightSaveRef = useRef<Promise<unknown> | null>(null);

  // Referral State
  const [isReferralModalOpen, setIsReferralModalOpen] = useState(false);
  const [activeReferral, setActiveReferral] = useState<Referral | null>(null);
  const [isOpeningReferralPdf, setIsOpeningReferralPdf] = useState(false);

  const handleOpenReferralPdf = async (referralId: string) => {
    setIsOpeningReferralPdf(true);
    try {
      const res = await getReferralSignedUrl(referralId);
      if (res.success && res.signedUrl) {
        window.open(res.signedUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error("Failed to open referral letter PDF:", err);
    } finally {
      setIsOpeningReferralPdf(false);
    }
  };

  // Active section for jump navigation
  const [activeSection, setActiveSection] = useState<string>("vitals");

  // Track patient age in months for pediatrics
  const patientAgeMonths = patient.date_of_birth
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(patient.date_of_birth).getTime()) /
            (1000 * 60 * 60 * 24 * 30.4375)
        )
      )
    : patient.age
    ? patient.age * 12
    : 24;

  // Mark form as dirty when inputs change
  const markDirty = () => {
    setIsDirty(true);
  };

  // Perform draft save
  const handleSaveDraft = useCallback(
    async (silent = false) => {
      // If a save is already executing, wait for it to finish first
      if (inFlightSaveRef.current) {
        try {
          await inFlightSaveRef.current;
        } catch {
          // Ignore previous error and proceed with latest state
        }
      }

      if (!silent) setIsSaving(true);
      setSaveError(null);

      const payload = {
        visit_id: visit.id,
        vitals,
        chief_complaints: chiefComplaints,
        clinical_notes: clinicalNotes,
        specialty,
        specialty_data: specialtyData,
        investigations_advised: investigations,
        advice: adviceList,
        follow_up: (followUpInterval !== "none" && followUpDate) ? {
          interval: followUpInterval,
          follow_up_date: followUpDate,
          notes: followUpNotes || null,
        } : null,
      };

      const savePromise = saveConsultationDraft(payload);
      inFlightSaveRef.current = savePromise;

      try {
        const result = await savePromise;
        if (result.success) {
          setLastSavedAt(new Date());
          setIsDirty(false);
        } else {
          setSaveError(result.error);
        }
      } catch (err: unknown) {
        setSaveError(err instanceof Error ? err.message : "Auto-save failed.");
      } finally {
        inFlightSaveRef.current = null;
        if (!silent) setIsSaving(false);
      }
    },
    [
      visit.id,
      vitals,
      chiefComplaints,
      clinicalNotes,
      specialty,
      specialtyData,
      investigations,
      adviceList,
      followUpInterval,
      followUpDate,
      followUpNotes,
    ]
  );

  // 15-second debounced auto-save effect
  useEffect(() => {
    if (!isDirty) return;

    const timer = setTimeout(() => {
      handleSaveDraft(true);
    }, 15000);

    return () => clearTimeout(timer);
  }, [isDirty, handleSaveDraft]);

  // Handle follow up interval changes
  const handleIntervalChange = (
    interval: "none" | "3_days" | "5_days" | "1_week" | "2_weeks" | "custom"
  ) => {
    markDirty();
    setFollowUpInterval(interval);
    if (interval === "none") {
      setFollowUpDate("");
      setFollowUpNotes("");
    } else if (interval !== "custom") {
      const d = new Date();
      if (interval === "3_days") d.setDate(d.getDate() + 3);
      else if (interval === "5_days") d.setDate(d.getDate() + 5);
      else if (interval === "1_week") d.setDate(d.getDate() + 7);
      else if (interval === "2_weeks") d.setDate(d.getDate() + 14);
      setFollowUpDate(d.toISOString().split("T")[0]);
    }
  };

  // Add investigation
  const addInvestigation = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || investigations.includes(trimmed)) return;
    markDirty();
    setInvestigations([...investigations, trimmed]);
    setCustomInvestigation("");
  };

  const removeInvestigation = (index: number) => {
    markDirty();
    setInvestigations(investigations.filter((_, i) => i !== index));
  };

  // Add advice
  const addAdviceItem = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || adviceList.includes(trimmed)) return;
    markDirty();
    setAdviceList([...adviceList, trimmed]);
    setCustomAdvice("");
  };

  const removeAdviceItem = (index: number) => {
    markDirty();
    setAdviceList(adviceList.filter((_, i) => i !== index));
  };

  // Jump to section helper
  const scrollToSection = (id: string) => {
    setActiveSection(id);
    const element = document.getElementById(id);
    if (element) {
      const yOffset = -120; // Account for sticky headers
      const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  // Handle Repeat Rx callback from history drawer
  const handleRepeatRx = async (medications: PastVisitEncounter["prescriptions"][0]["items"]) => {
    setIsHistoryOpen(false);
    scrollToSection("prescription");
    for (const med of medications) {
      try {
        await addPrescriptionItem(visit.id, {
          medicine_name: med.medicine_name,
          generic_name: med.generic_name ?? null,
          dose_form: med.dose_form ?? null,
          dosage: med.dosage,
          timing: med.timing ?? null,
          duration: med.duration,
          special_instructions: med.special_instructions ?? null,
        });
      } catch (err) {
        console.error("Failed to repeat medication:", err);
      }
    }
  };

  // Handle Copy Notes callback from history drawer
  const handleCopyNotes = (notes: string) => {
    markDirty();
    setClinicalNotes((prev) => (prev ? `${prev}\n\n[Prior Note]: ${notes}` : notes));
    setIsHistoryOpen(false);
    scrollToSection("complaints");
  };

  return (
    <div className="min-h-screen bg-[#F7F6F3] pb-24 text-gray-900">
      {/* 1. STICKY TOP WORKSPACE HEADER (z-30) */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Left: Back & Patient Demographics */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/queue"
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              aria-label="Back to OPD Queue"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-gray-900 truncate">
                  {patient.full_name}
                </h1>
                <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
                  ({patient.age ? `${patient.age}y` : ""} {patient.gender ? patient.gender.charAt(0).toUpperCase() : ""})
                </span>
                {visit.token_number && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-brand-50 text-brand-700 border border-brand-200">
                    Token #{visit.token_number}
                  </span>
                )}
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  {visit.status === "in_consultation" ? "In Consultation" : visit.status}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 truncate">
                {patient.phone ? `Ph: ${patient.phone}` : ""} {patient.uhid ? `• UHID: ${patient.uhid}` : ""}
              </p>
            </div>
          </div>

          {/* Right: Specialty Selector, Save Status & Actions */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Specialty Switcher */}
            <div className="hidden md:flex items-center gap-1.5">
              <label htmlFor="workspace-specialty" className="text-xs font-semibold text-gray-500">
                Specialty:
              </label>
              <select
                id="workspace-specialty"
                value={specialty}
                onChange={(e) => {
                  markDirty();
                  setSpecialty(e.target.value as ClinicalSpecialty);
                }}
                className="h-9 px-2.5 rounded-lg border border-gray-300 text-xs font-semibold text-gray-900 bg-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                <option value="general_physician">General Physician</option>
                <option value="dental">Dental</option>
                <option value="pediatrics">Pediatrics</option>
              </select>
            </div>

            {/* Auto-save status */}
            <div className="hidden lg:flex items-center gap-1.5 text-xs text-gray-500">
              {isSaving ? (
                <>
                  <Clock className="h-3.5 w-3.5 text-brand-600 animate-spin" />
                  <span className="text-brand-600 font-medium">Saving draft...</span>
                </>
              ) : lastSavedAt ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  <span>
                    Saved {lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </>
              ) : isDirty ? (
                <span className="text-amber-600 font-medium">• Unsaved changes</span>
              ) : (
                <span>Draft ready</span>
              )}
            </div>

            {/* Patient History Trigger */}
            <button
              type="button"
              onClick={() => setIsHistoryOpen(true)}
              aria-label="Open patient history drawer"
              className="min-h-[44px] px-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <History className="h-4 w-4 text-gray-500" />
              <span className="hidden sm:inline">History</span>
              {pastEncounters.length > 0 && (
                <span className="h-5 min-w-[20px] px-1 rounded-full bg-gray-100 text-gray-700 text-[10px] font-bold flex items-center justify-center">
                  {pastEncounters.length}
                </span>
              )}
            </button>

            {visit.status === "completed" ? (
              <>
                <a
                  href={`/api/visits/${visit.id}/prescription-pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-h-[44px] px-3.5 rounded-xl bg-[#EAF2FF] hover:bg-[#d6e5ff] text-[#1769E0] text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                  title="Print / View PDF Prescription"
                >
                  <Printer className="h-4 w-4" />
                  <span>Print Rx</span>
                </a>

                <a
                  href={`/api/invoices/${visit.id}/receipt-pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-h-[44px] px-3.5 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                  title="Print / View Payment Receipt"
                >
                  <Receipt className="h-4 w-4 text-emerald-600" />
                  <span>Receipt</span>
                </a>

                <button
                  type="button"
                  onClick={() => setIsSignModalOpen(true)}
                  className="min-h-[44px] px-3.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Update consultation details or billing"
                >
                  <span>Re-sign / Bill</span>
                </button>
              </>
            ) : (
              <>
                {/* Manual Save Draft */}
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => handleSaveDraft(false)}
                  className="min-h-[44px] px-3.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors disabled:opacity-50"
                >
                  <Save className="h-4 w-4 text-gray-500" />
                  <span className="hidden sm:inline">Save Draft</span>
                </button>

                {/* Primary Action: Complete & Sign Rx */}
                <button
                  type="button"
                  onClick={() => setIsSignModalOpen(true)}
                  className="min-h-[44px] px-4 rounded-xl bg-[#1769E0] text-white hover:bg-[#155cc0] text-xs font-semibold flex items-center gap-1.5 shadow-theme-xs transition-colors cursor-pointer"
                >
                  <span>Complete & Sign ℞</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 2. STICKY SECTION JUMP BAR (z-20) */}
      <nav
        aria-label="Consultation section jump navigation"
        className="sticky top-16 z-20 bg-gray-50/95 backdrop-blur-xs border-b border-gray-200"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-11 flex items-center justify-between overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 sm:gap-2">
            {[
              { id: "vitals", label: "Vitals" },
              { id: "complaints", label: "Complaints & Notes" },
              { id: "examination", label: "Specialty Exam" },
              { id: "diagnosis", label: "Diagnosis" },
              { id: "prescription", label: "Prescription (℞)" },
              { id: "investigations", label: "Investigations & Advice" },
              { id: "follow-up", label: "Follow-Up" },
            ].map(({ id, label }) => {
              const isActive = activeSection === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => scrollToSection(id)}
                  className={`min-h-[32px] px-2.5 sm:px-3 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-white text-brand-700 shadow-xs border border-gray-200"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/60"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Quick link on mobile to switch specialty */}
          <div className="flex md:hidden items-center ml-2">
            <select
              value={specialty}
              onChange={(e) => {
                markDirty();
                setSpecialty(e.target.value as ClinicalSpecialty);
              }}
              className="h-7 text-[11px] font-semibold border-0 bg-transparent text-gray-700 focus:ring-0"
            >
              <option value="general_physician">GP</option>
              <option value="dental">Dental</option>
              <option value="pediatrics">Pediatrics</option>
            </select>
          </div>
        </div>
      </nav>

      {/* 3. MAIN WORKSPACE CONTAINER */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Error notification if save failed */}
        {saveError && (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-xs text-rose-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0" />
              <span>{saveError}</span>
            </div>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              className="text-rose-600 hover:text-rose-800 font-semibold ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Patient Known Allergies Banner (Prominent Warning) */}
        {patient.allergies && patient.allergies.length > 0 && (
          <div
            role="alert"
            className="rounded-xl border border-amber-300 bg-amber-50/90 p-3.5 shadow-xs flex items-center gap-3"
          >
            <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-xs font-bold text-amber-900">
                Patient Allergy Alert:{" "}
              </span>
              <span className="text-xs text-amber-800">
                Known allergies to{" "}
                <span className="font-semibold underline">
                  {patient.allergies.join(", ")}
                </span>
                . Manual clinical review advised before prescribing.
              </span>
            </div>
          </div>
        )}

        {/* SECTION 1: VITALS */}
        <section id="vitals" className="scroll-mt-32">
          <VitalsBlock
            vitals={vitals ?? {}}
            onChange={(newVitals) => {
              markDirty();
              setVitals(newVitals);
            }}
          />
        </section>

        {/* SECTION 2: CHIEF COMPLAINTS & CLINICAL NOTES */}
        <section id="complaints" className="scroll-mt-32">
          <ChiefComplaintsSection
            complaints={chiefComplaints}
            clinicalNotes={clinicalNotes}
            onComplaintsChange={(newComplaints) => {
              markDirty();
              setChiefComplaints(newComplaints);
            }}
            onClinicalNotesChange={(newNotes) => {
              markDirty();
              setClinicalNotes(newNotes);
            }}
          />
        </section>

        {/* SECTION 3: EXAMINATION & SPECIALTY TEMPLATES */}
        <section id="examination" className="scroll-mt-32">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <HeartPulse className="h-5 w-5 text-brand-600" />
                <h3 className="text-sm font-bold text-gray-900">
                  Clinical Examination & Specialty Workspace
                </h3>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-gray-100 text-gray-700 capitalize">
                {specialty.replace("_", " ")}
              </span>
            </div>

            {/* Conditional Specialty Renderer */}
            {specialty === "general_physician" && (
              <GPSystemicReview
                data={specialtyData?.specialty === "general_physician" ? specialtyData : undefined}
                onChange={(data: GPSpecialty) => {
                  markDirty();
                  setSpecialtyData(data);
                }}
              />
            )}

            {specialty === "dental" && (
              <DentalOdontogram
                data={specialtyData?.specialty === "dental" ? specialtyData : undefined}
                onChange={(data: DentalSpecialty) => {
                  markDirty();
                  setSpecialtyData(data);
                }}
              />
            )}

            {specialty === "pediatrics" && (
              <PediatricsTools
                data={specialtyData?.specialty === "pediatrics" ? specialtyData : undefined}
                onChange={(data: PediatricsSpecialty) => {
                  markDirty();
                  setSpecialtyData(data);
                }}
                patientGender={patient.gender === "female" ? "female" : "male"}
                patientAgeMonths={patientAgeMonths}
                currentWeightKg={vitals?.weight ?? null}
                currentHeightCm={vitals?.height ?? null}
              />
            )}
          </div>
        </section>

        {/* SECTION 4: DIAGNOSIS & CLINICAL CODING */}
        <section id="diagnosis" className="scroll-mt-32">
          <DiagnosisSection
            visitId={visit.id}
            patientId={patient.id}
            specialty={specialty}
            initialDiagnoses={visit.diagnoses ?? []}
          />
        </section>

        {/* SECTION 5: ELECTRONIC PRESCRIPTION */}
        <section id="prescription" className="scroll-mt-32">
          <PrescriptionBuilder
            visitId={visit.id}
            patientAllergies={patient.allergies ?? []}
            initialItems={visit.prescription_items ?? []}
            hasPastRx={pastEncounters.some((e) => e.prescriptions && e.prescriptions.length > 0)}
            onRepeatLastRx={() => {
              const firstWithRx = pastEncounters.find(
                (e) => e.prescriptions && e.prescriptions.length > 0
              );
              if (firstWithRx && firstWithRx.prescriptions[0]?.items) {
                handleRepeatRx(firstWithRx.prescriptions[0].items);
              }
            }}
          />
        </section>

        {/* SECTION 6: INVESTIGATIONS ADVISED & CLINICAL ADVICE */}
        <section id="investigations" className="scroll-mt-32 space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs space-y-6">
            {/* Investigations Advised */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <FlaskConical className="h-4 w-4 text-brand-600" />
                <h3 className="text-sm font-bold text-gray-900">
                  Investigations Advised
                </h3>
              </div>

              {/* Quick Investigation Chips */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {COMMON_INVESTIGATIONS.map((testName) => {
                  const isSelected = investigations.includes(testName);
                  return (
                    <button
                      key={testName}
                      type="button"
                      onClick={() =>
                        isSelected
                          ? removeInvestigation(investigations.indexOf(testName))
                          : addInvestigation(testName)
                      }
                      className={`min-h-[36px] px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                        isSelected
                          ? "bg-brand-50 text-brand-800 border border-brand-300"
                          : "bg-gray-100 text-gray-700 border border-transparent hover:bg-gray-200/70"
                      }`}
                    >
                      {isSelected ? "✓ " : "+ "}
                      {testName}
                    </button>
                  );
                })}
              </div>

              {/* Selected Investigations Pills */}
              {investigations.length > 0 && (
                <div className="flex flex-wrap gap-2 p-3 rounded-lg bg-gray-50 border border-gray-200 mb-3">
                  {investigations.map((item, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-white border border-gray-300 text-xs font-semibold text-gray-800 shadow-xs"
                    >
                      <span>{item}</span>
                      <button
                        type="button"
                        onClick={() => removeInvestigation(index)}
                        aria-label={`Remove investigation ${item}`}
                        className="text-gray-400 hover:text-rose-600 p-0.5 rounded"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Custom Investigation Input */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customInvestigation}
                  onChange={(e) => setCustomInvestigation(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addInvestigation(customInvestigation);
                    }
                  }}
                  placeholder="Type custom test name and press Enter (e.g. 2D Echocardiography)..."
                  className="flex-1 min-h-[44px] px-3 rounded-lg border border-gray-300 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
                />
                <button
                  type="button"
                  onClick={() => addInvestigation(customInvestigation)}
                  className="min-h-[44px] px-4 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 transition-colors"
                >
                  Add Test
                </button>
              </div>
            </div>

            {/* Diet & Lifestyle Advice */}
            <div className="pt-4 border-t border-gray-100">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                Diet & General Advice
              </h4>

              {/* Quick Advice Chips */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {COMMON_ADVICE_CHIPS.map((adviceText) => {
                  const isSelected = adviceList.includes(adviceText);
                  return (
                    <button
                      key={adviceText}
                      type="button"
                      onClick={() =>
                        isSelected
                          ? removeAdviceItem(adviceList.indexOf(adviceText))
                          : addAdviceItem(adviceText)
                      }
                      className={`min-h-[36px] px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                        isSelected
                          ? "bg-brand-50 text-brand-800 border border-brand-300"
                          : "bg-gray-100 text-gray-700 border border-transparent hover:bg-gray-200/70"
                      }`}
                    >
                      {isSelected ? "✓ " : "+ "}
                      {adviceText}
                    </button>
                  );
                })}
              </div>

              {/* Selected Advice List */}
              {adviceList.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {adviceList.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-800"
                    >
                      <span>• {item}</span>
                      <button
                        type="button"
                        onClick={() => removeAdviceItem(index)}
                        aria-label={`Remove advice item ${item}`}
                        className="text-gray-400 hover:text-rose-600 p-1 rounded"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Custom Advice Input */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customAdvice}
                  onChange={(e) => setCustomAdvice(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addAdviceItem(customAdvice);
                    }
                  }}
                  placeholder="Add custom advice instruction and press Enter..."
                  className="flex-1 min-h-[44px] px-3 rounded-lg border border-gray-300 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-white"
                />
                <button
                  type="button"
                  onClick={() => addAdviceItem(customAdvice)}
                  className="min-h-[44px] px-4 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 transition-colors"
                >
                  Add Advice
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 7: FOLLOW-UP RECOMMENDATION & CLINICAL DOCUMENTS */}
        <section id="follow-up" className="scroll-mt-32">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="h-4 w-4 text-brand-600" />
                <h3 className="text-sm font-bold text-gray-900">
                  Follow-Up Recommendation
                </h3>
              </div>

              {/* Preset Interval Chips */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {[
                  { id: "none", label: "No Follow-Up (N/A)" },
                  { id: "3_days", label: "3 Days" },
                  { id: "5_days", label: "5 Days" },
                  { id: "1_week", label: "1 Week" },
                  { id: "2_weeks", label: "2 Weeks" },
                  { id: "custom", label: "Custom Date" },
                ].map(({ id, label }) => {
                  const isSelected = followUpInterval === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleIntervalChange(id as typeof followUpInterval)}
                      className={`min-h-[44px] px-3.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? "bg-brand-50 border-brand-300 text-brand-800 shadow-xs"
                          : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Date Input and Follow-Up Notes (Hidden when N/A is selected) */}
              {followUpInterval === "none" ? (
                <div className="p-3.5 bg-gray-50 border border-dashed border-gray-300 rounded-xl text-xs text-gray-600 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>No follow-up required. Follow-up recommendation will be omitted from the printed prescription.</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor="follow-up-date-input"
                      className="block text-xs font-semibold text-gray-700 mb-1"
                    >
                      Recommended Date:
                    </label>
                    <input
                      id="follow-up-date-input"
                      type="date"
                      value={followUpDate}
                      onChange={(e) => {
                        markDirty();
                        setFollowUpDate(e.target.value);
                        setFollowUpInterval("custom");
                      }}
                      className="w-full min-h-[44px] px-3 rounded-lg border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label
                      htmlFor="follow-up-notes-input"
                      className="block text-xs font-semibold text-gray-700 mb-1"
                    >
                      Follow-Up Instructions:
                    </label>
                    <input
                      id="follow-up-notes-input"
                      type="text"
                      value={followUpNotes}
                      onChange={(e) => {
                        markDirty();
                        setFollowUpNotes(e.target.value);
                      }}
                      placeholder="e.g. Review with repeat fasting blood sugar and lipid profile reports"
                      className="w-full min-h-[44px] px-3 rounded-lg border border-gray-300 text-xs text-gray-900 bg-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Referral & Specialist Disposition Card */}
            <div className="pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Share2 className="h-4 w-4 text-[#1769E0]" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-700">
                    Referral & Specialist Disposition
                  </h4>
                </div>
                {!activeReferral && (
                  <button
                    type="button"
                    onClick={() => setIsReferralModalOpen(true)}
                    className="min-h-[36px] px-3 rounded-lg border border-blue-200 bg-[#EAF2FF] hover:bg-blue-100 text-[#1769E0] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Refer Patient</span>
                  </button>
                )}
              </div>

              {activeReferral ? (
                <div className="p-4 rounded-xl border border-blue-200 bg-[#EAF2FF]/50 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-gray-900">
                        Referred to: Dr. {activeReferral.referred_to_name}
                      </div>
                      <div className="text-[11px] text-gray-600 mt-0.5">
                        {activeReferral.referred_to_specialty ? `${activeReferral.referred_to_specialty} • ` : ""}
                        {activeReferral.referred_to_facility || "External Specialist"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FFF5E5] text-[#9A5B00] border border-[#F3D39A]">
                        {activeReferral.status}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#FFEDEC] text-[#BA1A1A]">
                        {activeReferral.urgency.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-gray-700">
                    <span className="font-semibold text-gray-900">Reason: </span>
                    {activeReferral.reason_for_referral}
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t border-blue-200/60">
                    <button
                      type="button"
                      onClick={() => handleOpenReferralPdf(activeReferral.id)}
                      disabled={isOpeningReferralPdf}
                      className="min-h-[36px] px-3 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <FileText className="h-3.5 w-3.5 text-[#1769E0]" />
                      <span>{isOpeningReferralPdf ? "Loading..." : "Print Referral Letter"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsReferralModalOpen(true)}
                      className="text-xs text-[#1769E0] hover:underline font-semibold cursor-pointer"
                    >
                      + New Referral
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 flex items-center justify-between">
                  <span>No specialist referral issued for this encounter.</span>
                  <button
                    type="button"
                    onClick={() => setIsReferralModalOpen(true)}
                    className="text-xs font-semibold text-[#1769E0] hover:underline cursor-pointer"
                  >
                    + Refer to Specialist
                  </button>
                </div>
              )}
            </div>

            {/* Clinical Documents / Attachments Dropzone */}
            <div className="pt-4 border-t border-gray-100">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                Clinical Attachments & Investigation Reports
              </h4>

              <div className="rounded-xl border border-dashed border-gray-300 p-6 bg-gray-50 text-center space-y-2">
                <UploadCloud className="h-8 w-8 text-gray-400 mx-auto" />
                <div>
                  <label
                    htmlFor="clinical-file-upload"
                    className="text-xs font-semibold text-brand-600 hover:text-brand-700 cursor-pointer"
                  >
                    Upload lab report or radiograph
                    <input
                      id="clinical-file-upload"
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,application/pdf"
                      className="sr-only"
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files && files.length > 0) {
                          // Client-side file selection acknowledge
                        }
                      }}
                    />
                  </label>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Drag and drop JPEG, PNG, or PDF files (up to 10MB each)
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Patient History Slide-Over Drawer */}
      <PatientHistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        patientName={patient.full_name}
        encounters={pastEncounters ?? []}
        onRepeatRx={handleRepeatRx}
        onCopyNotes={handleCopyNotes}
      />

      {/* Solo Doctor Complete & Sign + Billing Modal */}
      <SignAndBillModal
        isOpen={isSignModalOpen}
        onClose={() => setIsSignModalOpen(false)}
        visitId={visit.id}
        patientId={patient.id}
        patientName={patient.full_name}
        diagnosesCount={visit.diagnoses?.length || 1}
        medicinesCount={visit.prescription_items?.length || 0}
        followUpDate={followUpInterval === "none" ? null : (followUpDate || null)}
        onSaveDraftBeforeSign={() => handleSaveDraft(false)}
      />

      {/* Create Referral Modal */}
      <CreateReferralModal
        isOpen={isReferralModalOpen}
        onClose={() => setIsReferralModalOpen(false)}
        patientId={patient.id}
        patientName={patient.full_name}
        patientPhone={patient.phone}
        visitId={visit.id}
        currentDiagnoses={visit.diagnoses?.map((d: any) => d.diagnosis_name) || []}
        currentMedications={(visit.prescription_items as any[]) || []}
        onSuccess={(ref) => {
          setActiveReferral(ref);
        }}
      />
    </div>
  );
}
