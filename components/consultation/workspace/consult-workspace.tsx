"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Vitals,
  ChiefComplaintItem,
  ClinicalSpecialty,
  SpecialtyData,
  DentalSpecialty,
  PediatricsSpecialty,
  FollowUpInput,
} from "@/features/consultation/schema";
import type { PastVisitEncounter } from "@/features/consultation/actions";
import type { ConsultationDiagnosisItem } from "@/features/terminology/schema";
import type { PrescriptionItem, Referral } from "@/lib/db/types";
import { addPrescriptionItem } from "@/features/prescriptions/actions";
import { sendConsolidatedConsultationWhatsApp } from "@/features/billing/actions";
import { getReferralSignedUrl } from "@/features/referrals/actions";
import { recordState, signedVersionOf, SIGNED_CONSULTATION_MESSAGE } from "@/features/consultation/record-state";
import { changedDraftKeys, type DraftFields } from "@/features/consultation/draft";
import type { FlushResult } from "@/features/consultation/draft-saver";
import { VitalsBlock } from "../vitals-block";
import { PrescriptionBuilder } from "../prescription-builder";
import { DentalOdontogram } from "../specialty/dental-odontogram";
import { PediatricsTools } from "../specialty/pediatrics-tools";
import { SignAndBillModal } from "../sign-and-bill-modal";
import { AmendmentModal } from "../amendment-modal";
import { FinalizeAmendmentDialog } from "../finalize-amendment-dialog";
import { useConsultDraft } from "../use-consult-draft";
import { DraftConflictDialog } from "../draft-conflict-dialog";
import { CreateReferralModal } from "@/components/referrals/create-referral-modal";
import { SaveStatus } from "@/components/clinical/save-status";
import { StatusChip } from "@/components/clinical/status-chip";
import { Button, buttonClassName } from "@/components/ui/button";
import { formatAge } from "@/lib/ui/age";
import { reportClientError } from "@/lib/log/client";
import { addDaysYmd, daysBetweenYmd, todayInTz, ymdOf } from "@/lib/datetime";
import { useClinicTimeZone } from "@/lib/datetime/client";
import { Check, CheckCircle2, FilePenLine, Loader2, Lock, MessageSquare, Printer, Receipt, Save, UserRound } from "lucide-react";
import { ConsultTopBar } from "./consult-top-bar";
import { AllergyStrip } from "./allergy-strip";
import { AmendingBanner } from "./amending-banner";
import { ConsultSection, sectionTitleId } from "./consult-section";
import { SectionStrip, type StripSection } from "./section-strip";
import { FinishBar } from "./finish-bar";
import { useConsultShortcuts, type ConsultKeyAction } from "./use-consult-shortcuts";
import { PatientColumn } from "./patient-column";
import { PatientSheet } from "./patient-sheet";
import { SummaryPane, SummarySheet, type SummaryContent } from "./summary-pane";
import { useMinWidth } from "./use-min-width";
import { clinicDateLabel, signedAtLabel } from "./format";
import { ShortcutSheet, readShortcutsEnabled } from "@/components/today/shortcut-sheet";
import { PlanSection, type FollowUpIntervalChoice } from "./sections/plan-section";
import { ComplaintsSection } from "./sections/complaints-section";
import { ExaminationSection } from "./sections/examination-section";
import { DiagnosisSection } from "./sections/diagnosis-section";
import { daysForInterval } from "@/features/consultation/catalogue";
import { CommandBar } from "./command-bar";
import { MacroList } from "./macro-list";
import { BookFollowUp, FollowUpSuggestion } from "./follow-up-suggestion";
import type { DoctorMacro } from "@/features/consultation/macros";
import { findFollowUpPhrase, type FollowUpPhrase, type ShorthandResult } from "@/features/consultation/shorthand";
import { applyShorthand, followUpFromDuration } from "@/features/consultation/shorthand-apply";
import type { AssistContext } from "@/features/consultation/assist-ranking";
import type { PatientSnapshot } from "@/features/consultation/snapshot";

export interface ConsultWorkspaceProps {
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
    metadata?: Record<string, unknown> | null;
    /** Sign-off time; with `status` it decides the record state (`recordState`, V2-09a R-2). */
    signed_at?: string | null;
    /**
     * `visits.current_revision`: 1 for a visit never amended (the database default); each reopen sets it to the new revision number + 1, so it counts
     * the signatures of a sealed visit and is one ahead of the signed version while amending.
     */
    current_revision?: number | null;
    /** `clinical_notes.draft_version` the page read (V2-09b R-2): the version the draft saver's first save is made against. */
    draft_version?: number | null;
    /** Version of the visit's latest prescription header, null when there is none. */
    prescription_version?: number | null;
    /** The reason given when the open amendment was started (the latest `visit_revisions` row); only read while amending. */
    amendment_reason?: string | null;
    /** When the open amendment was started (that row's `amended_at`); only read while amending. */
    amendment_opened_at?: string | null;
  };
  patient: {
    id: string;
    full_name: string;
    phone: string;
    gender: "male" | "female" | "other" | null;
    date_of_birth: string | null;
    age?: number | null;
    /** Known allergies; `[]` = recorded none; `null` or absent = not recorded (the allergy strip draws the three states). */
    allergies?: string[] | null;
    chronic_conditions?: string[];
    uhid?: string | null;
  };
  pastEncounters?: PastVisitEncounter[];
  /** The signed-in user holds `billing:collect` (PO-3, V2-05 05-02b): Sign & Bill may collect at the desk. */
  canCollectPayment?: boolean;
  /**
   * The signed-in user may reopen and finalize an amendment: consultations:edit, prescriptions:edit and appointments:edit
   * (the two commands check all three, so owner and doctor). The database refuses anyone else; this only shapes the screen.
   */
  canAmend?: boolean;
  /**
   * The active clinic's `assist.*` entitlements by key, resolved on the server (V2-09b R-10); the Smart Assist features of 09B-03 to 09B-04b read it.
   * Not used by the frame yet.
   */
  assist?: Record<string, boolean>;
  /**
   * The calling doctor's learned order (`consult_assist_context`, V2-09b R-12), read on the server only when the clinic is entitled to
   * `assist.terminology` and the record is editable; null otherwise (the tiles use the catalogue order and carry no label).
   */
  assistContext?: AssistContext | null;
  /** The patient snapshot (`patient_snapshot`, V2-09b 09B-04a), read on the server only with `assist.snapshot`; null: the plain last-visit block. */
  snapshot?: PatientSnapshot | null;
  /** The signed-in doctor's own text macros (V2-09b 09B-04b, R-14), read on the server only with `assist.shorthand` and an editable record. */
  macros?: DoctorMacro[];
  /**
   * The instants of this patient's booked or confirmed visits with this doctor from three days ago onward (09B-04b, R-15, Q-14), read on the server. A display
   * rule only: the "Book follow-up" action gives way to a note when one falls on or after three days before the follow-up date.
   */
  upcomingVisits?: string[];
  /** The role may book an appointment (`appointments:edit`): "Book follow-up" opens the V2-08 booking sheet. */
  canBook?: boolean;
}

const SECTION_IDS = ["complaints", "examination", "diagnosis", "prescription", "plan"] as const;
type SectionId = (typeof SECTION_IDS)[number];

const CONSULT_SHORTCUTS = [
  { key: "Alt 1–5", label: "Jump to a section" },
  { key: "M", label: "Search medicines" },
  { key: "F", label: "Finish visit" },
  { key: "/", label: "Shorthand" },
  { key: "?", label: "Show these shortcuts" },
] as const;

const SEX_CODE = { male: "M", female: "F", other: "O" } as const;

// Module level (V2-06 06-08, R-30): React Compiler's `purity` rule reports a random read inside a component, even in an event handler.
function newShorthandId(): string {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Follows the scroll (phones, where the page scrolls): the current section is the last one whose top has passed the bottom of the sticky header (about
 * 11 rem: top bar, allergy strip and section strip). Read from the section rectangles on a throttled scroll, so a tap on the strip, which scrolls a
 * section to just under the header, and a drag agree. `set` lets a tap mark its section at once.
 */
function useActiveSection(): [SectionId, (id: SectionId) => void] {
  const [active, setActive] = useState<SectionId>("complaints");
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      let current: SectionId = SECTION_IDS[0];
      for (const id of SECTION_IDS) {
        const node = document.getElementById(id);
        if (node && node.getBoundingClientRect().top <= 200) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);
  return [active, setActive];
}

export function ConsultWorkspace({
  visit,
  patient,
  pastEncounters = [],
  canCollectPayment = false,
  canAmend = false,
  assist,
  assistContext = null,
  snapshot = null,
  macros = [],
  upcomingVisits = [],
  canBook = false,
}: ConsultWorkspaceProps) {
  const router = useRouter();
  const timeZone = useClinicTimeZone();
  const clinicToday = todayInTz(timeZone);

  // The record state is one predicate in SQL and here (V2-09a R-2). A sealed consultation is read-only; so is a visit the front desk
  // completed unsigned or a cancelled one (terminal in the app, R-11). An amending visit is editable again until it is finalized.
  const state = recordState(visit);
  const readOnly = state === "sealed" || visit.status === "completed" || visit.status === "cancelled";
  const [isAmendOpen, setIsAmendOpen] = useState(false);
  const [isFinalizeOpen, setIsFinalizeOpen] = useState(false);
  // The signed version: the prescription header's, else (a consultation with no prescription) the number of signatures (09A-06a, review B-2):
  // current_revision while sealed, current_revision - 1 while amending (the reopen has already counted the amendment).
  const signedVersion = signedVersionOf(visit, state);
  // 09A-06a (review B-3): after a successful Amend or Finalize the refresh replaces the button that opened the dialog, so focus is moved to a
  // stable element of the new state (the amendment banner, or the signed chip) instead of falling to <body>.
  const focusAfterRefreshRef = useRef<"amending" | "sealed" | null>(null);
  const amendingBannerRef = useRef<HTMLDivElement>(null);
  const signedChipRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (focusAfterRefreshRef.current !== state) return;
    focusAfterRefreshRef.current = null;
    (state === "amending" ? amendingBannerRef.current : signedChipRef.current)?.focus();
  }, [state]);
  // Local editing state of the vitals editor and the Rx builder (an open editor, a staged drug, an open overlay) never survives a change of the record
  // state (review B-1): they are remounted with this key.
  const editorKey = `${state}:${readOnly ? "ro" : "rw"}`;

  // Core form state
  const [specialty, setSpecialty] = useState<ClinicalSpecialty>(visit.specialty ?? "general_physician");
  const [vitals, setVitals] = useState<Vitals | null>(visit.vitals ?? null);
  const [chiefComplaints, setChiefComplaints] = useState<ChiefComplaintItem[]>(visit.chief_complaints ?? []);
  const [clinicalNotes, setClinicalNotes] = useState<string>(visit.clinical_notes ?? "");
  const [specialtyData, setSpecialtyData] = useState<SpecialtyData | null>(visit.specialty_data ?? null);
  const [investigations, setInvestigations] = useState<string[]>(visit.investigations_advised ?? []);
  const [adviceList, setAdviceList] = useState<string[]>(visit.advice ?? []);

  // Follow-up state
  const [followUpInterval, setFollowUpInterval] = useState<FollowUpIntervalChoice>(
    (visit.follow_up?.interval as FollowUpIntervalChoice | undefined) ?? (visit.follow_up?.follow_up_date ? "custom" : "5_days"),
  );
  const [followUpDate, setFollowUpDate] = useState<string>(visit.follow_up?.follow_up_date ?? addDaysYmd(clinicToday, 5));
  const [followUpNotes, setFollowUpNotes] = useState<string>(visit.follow_up?.notes ?? "");

  const [isPatientOpen, setIsPatientOpen] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  // The summary pane: closed by default from 1280 to 1439 px, open from 1440 (06-UI-SPEC §7); the toggle overrides it.
  const [summaryChoice, setSummaryChoice] = useState<boolean | null>(null);
  const wide1440 = useMinWidth(1440);
  const summaryPaneOpen = summaryChoice ?? wide1440;
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  // The shorthand bar and the doctor's macros (09B-04b). The macro list is the doctor's own and lives here so the bar sees an edit at once.
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);
  const [isMacroListOpen, setIsMacroListOpen] = useState(false);
  const [macroList, setMacroList] = useState<DoctorMacro[]>(macros);
  const [shortcutsOn, setShortcutsOn] = useState(false);
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  const [diagnoses, setDiagnoses] = useState<ConsultationDiagnosisItem[]>(visit.diagnoses ?? []);
  const [rxItems, setRxItems] = useState<PrescriptionItem[]>(visit.prescription_items ?? []);

  // Referral state
  const [isReferralModalOpen, setIsReferralModalOpen] = useState(false);
  const [activeReferral, setActiveReferral] = useState<Referral | null>(null);
  const [isOpeningReferralPdf, setIsOpeningReferralPdf] = useState(false);

  // Consolidated WhatsApp share state
  const [isSendingWa, setIsSendingWa] = useState(false);
  const [isWaSent, setIsWaSent] = useState(false);

  const handleShareConsolidatedWhatsApp = async () => {
    if (isSendingWa || isWaSent) return;
    setIsSendingWa(true);
    try {
      const res = await sendConsolidatedConsultationWhatsApp({ visitId: visit.id });
      if (res.success) {
        setIsWaSent(true);
      } else {
        alert(res.error || "Failed to send consultation documents via WhatsApp");
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error sending WhatsApp");
    } finally {
      setIsSendingWa(false);
    }
  };

  const handleOpenReferralPdf = async (referralId: string) => {
    setIsOpeningReferralPdf(true);
    try {
      const res = await getReferralSignedUrl(referralId);
      if (res.success && res.signedUrl) {
        window.open(res.signedUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      reportClientError("referrals.letter_open.failed", err);
    } finally {
      setIsOpeningReferralPdf(false);
    }
  };

  // Section navigation: the strip, Alt+1 to Alt+5 and the history actions scroll to a section and move focus to its heading.
  const [activeSection, setActiveSection] = useActiveSection();
  const goToSection = useCallback(
    (id: SectionId) => {
      setActiveSection(id);
      document.getElementById(id)?.scrollIntoView({ block: "start" });
      document.getElementById(sectionTitleId(id))?.focus({ preventScroll: true });
    },
    [setActiveSection],
  );
  const focusMedicineSearch = () => {
    goToSection("prescription");
    document.getElementById("medicine-search-input")?.focus();
  };
  const shorthandOn = assist?.["assist.shorthand"] === true && !readOnly;
  const followUpOn = assist?.["assist.followup"] === true && !readOnly;
  const finishAvailable = state !== "sealed" && state !== "amending" && !readOnly && visit.status !== "cancelled";
  useConsultShortcuts({
    onSection: (n) => goToSection(SECTION_IDS[n - 1]),
    onAction: (action: ConsultKeyAction) => {
      if (action === "help") {
        setShortcutsOn(readShortcutsEnabled());
        setIsShortcutsOpen(true);
      } else if (action === "medicine" && !readOnly) {
        focusMedicineSearch();
      } else if (action === "finish" && finishAvailable) {
        handleFinish();
      } else if (action === "command" && shorthandOn) {
        setIsCommandBarOpen(true);
      }
    },
  });

  // Track patient age in months for pediatrics. Counted in clinic calendar days up to the clinic's today (read once
  // above), not from a render-time `Date.now()` (React Compiler `purity`, V2-06 06-08); a date of birth that is not a
  // calendar date falls through to the recorded age, as before for a missing one.
  const dobDays = patient.date_of_birth ? daysBetweenYmd(patient.date_of_birth, clinicToday) : null;
  const patientAgeMonths = dobDays !== null ? Math.max(0, Math.floor(dobDays / 30.4375)) : patient.age ? patient.age * 12 : 24;

  // The draft (V2-09b R-2 to R-5): what is on screen is handed to the draft saver, which holds it in memory only and saves it within 5 s, on blur,
  // when the app is hidden and before Sign, Amend or Finalize. A change is a field that differs from the server copy; no handler marks anything.
  const currentFields: DraftFields = {
    vitals,
    chief_complaints: chiefComplaints,
    clinical_notes: clinicalNotes,
    specialty_data: specialtyData,
    investigations_advised: investigations,
    advice: adviceList,
    specialty,
    follow_up:
      followUpInterval !== "none" && followUpDate ? { interval: followUpInterval, follow_up_date: followUpDate, notes: followUpNotes || null } : null,
  };
  const [initialFields] = useState<DraftFields>(currentFields);
  // The server copy the saver starts from: the same fields, with the visit's own follow-up (the screen preselects a default one that is not saved
  // until the doctor edits something or saves).
  const serverFields: DraftFields = {
    ...initialFields,
    follow_up: visit.follow_up?.follow_up_date
      ? { follow_up_date: visit.follow_up.follow_up_date, notes: visit.follow_up.notes ?? null }
      : null,
  };
  const applyArrived = (arrived: Partial<DraftFields>) => {
    if ("vitals" in arrived) setVitals(arrived.vitals ?? null);
    if (arrived.chief_complaints) setChiefComplaints(arrived.chief_complaints);
    if ("clinical_notes" in arrived) setClinicalNotes(arrived.clinical_notes ?? "");
    if ("specialty_data" in arrived) setSpecialtyData((arrived.specialty_data as SpecialtyData | null) ?? null);
    if (arrived.investigations_advised) setInvestigations(arrived.investigations_advised);
    if (arrived.advice) setAdviceList(arrived.advice);
    if (arrived.specialty) setSpecialty(arrived.specialty);
    if ("follow_up" in arrived) {
      const fu = arrived.follow_up;
      setFollowUpInterval(fu?.follow_up_date ? (fu.interval ?? "custom") : "none");
      setFollowUpDate(fu?.follow_up_date ?? "");
      setFollowUpNotes(fu?.notes ?? "");
    }
  };
  const consultDraft = useConsultDraft({
    visitId: visit.id,
    enabled: !readOnly,
    resetKey: editorKey,
    serverFields,
    serverVersion: visit.draft_version ?? 0,
    onRebased: applyArrived,
  });
  // Nothing is sent before the doctor changes something on screen (the preselected follow-up alone is not a change).
  const editedRef = useRef(false);
  const { update: updateDraft } = consultDraft;
  useEffect(() => {
    if (!editedRef.current) {
      if (changedDraftKeys(initialFields, currentFields).length === 0) return;
      editedRef.current = true;
    }
    updateDraft(currentFields);
    // currentFields is rebuilt from the state below every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vitals, chiefComplaints, clinicalNotes, specialtyData, investigations, adviceList, specialty, followUpInterval, followUpDate, followUpNotes, updateDraft]);

  /** "Save draft", Ctrl/Cmd+S, Finish, Amend, Finalize: what is on screen is saved, or the reason it was not comes back. */
  const handleSaveDraft = async (): Promise<{ success: boolean; error?: string }> => {
    updateDraft(currentFields);
    const result: FlushResult = await consultDraft.flush();
    if (result.ok) return { success: true };
    const text: Record<string, string> = {
      conflict: "This consultation was changed in another tab or device. Choose which version to keep, then try again.",
      locked: SIGNED_CONSULTATION_MESSAGE,
      offline: "You are offline. Reconnect to save.",
    };
    return { success: false, error: text[result.reason] ?? result.error?.message ?? "Failed to save draft. Please try again." };
  };
  const saveDraftRef = useRef(handleSaveDraft);
  useEffect(() => {
    saveDraftRef.current = handleSaveDraft;
  });
  useEffect(() => {
    if (readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveDraftRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly]);

  /**
   * "Finish visit" (R-8): the draft flush starts at once and the Sign & Bill sheet opens; the sheet flushes again, and waits for the first, before the
   * sign-off command, and shows a refusal (a conflict, a role that may not save) in the sheet as the v1 flow did.
   */
  const handleFinish = () => {
    setIsSignModalOpen(true);
    void handleSaveDraft();
  };

  const handleIntervalChange = (interval: FollowUpIntervalChoice) => {
    setFollowUpInterval(interval);
    if (interval === "none") {
      setFollowUpDate("");
      setFollowUpNotes("");
    } else if (interval !== "custom") {
      // Counted from the clinic's date in its zone (V2-03 03-05)
      setFollowUpDate(addDaysYmd(todayInTz(timeZone), daysForInterval(interval)));
    }
  };

  // Repeat Rx from the history list: the v1 loop, a registered exception owned by V2-09c (no-client-command-chains.spec.ts).
  const handleRepeatRx = async (medications: PastVisitEncounter["prescriptions"][0]["items"]) => {
    setIsPatientOpen(false);
    goToSection("prescription");
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
        reportClientError("prescriptions.repeat_medication.failed", err);
      }
    }
  };

  const handleCopyNotes = (notes: string) => {
    setClinicalNotes((prev) => (prev ? `${prev}\n\n[Prior Note]: ${notes}` : notes));
    setIsPatientOpen(false);
    goToSection("complaints");
  };

  /** Shorthand bar, Insert (R-14): the parsed parts land in Complaints, the notes, Advice and the follow-up in one change, so the draft saver makes one save. */
  const handleInsertShorthand = (result: ShorthandResult) => {
    const next = applyShorthand(
      result,
      { complaints: chiefComplaints, clinicalNotes, advice: adviceList, followUpNotes },
      clinicToday,
      newShorthandId,
    );
    setChiefComplaints(next.complaints);
    setClinicalNotes(next.clinicalNotes);
    setAdviceList(next.advice);
    if (next.followUp) {
      setFollowUpInterval(next.followUp.interval);
      setFollowUpDate(next.followUp.date);
      setFollowUpNotes(next.followUp.notes);
    }
  };

  // The follow-up proposal (R-15): a follow-up the advice or the notes already say, offered as a chip until the doctor taps it or the follow-up already is it.
  const suggestedPhrase = followUpOn ? findFollowUpPhrase([...adviceList, clinicalNotes]) : null;
  const suggestion =
    suggestedPhrase && !(followUpInterval !== "none" && followUpDate === addDaysYmd(clinicToday, suggestedPhrase.days)) ? suggestedPhrase : null;
  const acceptSuggestion = (phrase: FollowUpPhrase) => {
    const f = followUpFromDuration(phrase, clinicToday, phrase.phrase);
    setFollowUpInterval(f.interval);
    setFollowUpDate(f.date);
    setFollowUpNotes(f.notes);
  };
  // "Book follow-up" (R-15, Q-14): the V2-08 booking sheet over the consult, with the date filled in; no booked or confirmed visit of this patient with
  // this doctor from three days before the date onward. A display rule: nothing about the booking is stored on the follow-up.
  const followUpBooked =
    followUpDate !== "" && upcomingVisits.some((iso) => ymdOf(iso, timeZone) >= addDaysYmd(followUpDate, -3));
  const bookHref =
    canBook && followUpInterval !== "none" && followUpDate
      ? `?${new URLSearchParams({ book: "1", patient: patient.id, doctor: visit.doctor_id, date: followUpDate }).toString()}`
      : null;

  const identity = {
    name: patient.full_name,
    age: (patient.date_of_birth ? formatAge(patient.date_of_birth, clinicToday) : null) ?? (patient.age ? `${patient.age} y` : null),
    sex: patient.gender ? SEX_CODE[patient.gender] : null,
    patientCode: patient.uhid ?? null,
    phone: patient.phone || null,
  };

  const patientContext = {
    patient: {
      full_name: patient.full_name,
      gender: patient.gender,
      phone: patient.phone,
      uhid: patient.uhid,
      age: identity.age,
      allergies: patient.allergies,
      chronic_conditions: patient.chronic_conditions,
    },
    vitals,
    // AI-16 (vitals flags) is entitled by `assist.vitals`; the page resolves the key on the server.
    flags: assist?.["assist.vitals"] === true,
    snapshot,
    encounters: pastEncounters,
    timeZone,
    onRepeatRx: readOnly ? undefined : handleRepeatRx,
    onCopyNotes: readOnly ? undefined : handleCopyNotes,
  };
  const summaryContent: SummaryContent = {
    complaints: chiefComplaints,
    specialtyData,
    diagnoses,
    rxItems,
    investigations,
    advice: adviceList,
    followUpDate: followUpInterval !== "none" && followUpDate ? followUpDate : null,
  };

  const followUpCount = followUpInterval !== "none" && followUpDate ? 1 : 0;
  const planCount = investigations.length + adviceList.length + followUpCount;
  const stripSections: StripSection[] = [
    { id: "complaints", label: "Complaints", count: chiefComplaints.length },
    { id: "examination", label: "Exam" },
    { id: "diagnosis", label: "Diagnosis", count: diagnoses.length },
    { id: "prescription", label: "Rx", count: rxItems.length },
    { id: "plan", label: "Plan", count: planCount },
  ];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const canSave = state === "amending" || (!readOnly && visit.status !== "cancelled");
  const saveButton = canSave && (
    <Button
      type="button"
      variant="secondary"
      disabled={consultDraft.state.saveState === "saving"}
      aria-label="Save draft"
      size="lg"
      onClick={() => void handleSaveDraft()}
      startIcon={<Save />}
      className="shrink-0"
    >
      <span className="hidden sm:inline">Save Draft</span>
    </Button>
  );
  // "Patient" opens the Patient sheet between 768 and 1179 px (below 768 the Finish bar has it; from 1180 the column is always there).
  const patientButton = (
    <Button type="button" variant="secondary" size="lg" onClick={() => setIsPatientOpen(true)} aria-haspopup="dialog" startIcon={<UserRound />} className="shrink-0">
      Patient
    </Button>
  );
  // The summary toggle (from 1280 px): shows or hides the pane beside the note.
  const summaryToggle = (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      aria-pressed={summaryPaneOpen}
      onClick={() => setSummaryChoice(!summaryPaneOpen)}
      className="hidden shrink-0 xl:inline-flex"
    >
      Summary
    </Button>
  );
  const finishButton = (
    <Button type="button" size="lg" onClick={handleFinish} startIcon={<Check />} className="shrink-0">
      Finish visit
    </Button>
  );
  const finalizeButton = canAmend && (
    <Button type="button" size="lg" onClick={() => setIsFinalizeOpen(true)} startIcon={<Check />} className="shrink-0">
      Finalize amendment
    </Button>
  );
  const amendButton = state === "sealed" && canAmend && (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      onClick={() => setIsAmendOpen(true)}
      startIcon={<FilePenLine />}
      title="Reopen this signed consultation to correct it; the signed version is kept"
      className="shrink-0"
    >
      Amend
    </Button>
  );

  // The primary action of the record state, once in the top bar (768 px and up) and once in the Finish bar (below 768); the one not on screen is display:none.
  const primaryAction =
    state === "amending" ? finalizeButton : state === "sealed" ? amendButton : !readOnly && visit.status !== "cancelled" ? finishButton : null;

  const statusChips = (
    <>
      {state === "amending" ? (
        <span className="inline-flex h-pill shrink-0 items-center gap-1 rounded-pill bg-(--banner-past-due-bg) px-1.75 text-caption font-semibold whitespace-nowrap text-(--banner-past-due-fg)">
          <FilePenLine aria-hidden="true" className="size-3" />
          Amending
        </span>
      ) : state === "sealed" ? null : (
        <StatusChip status={visit.status} />
      )}
      {/* Signed chip (R-16): when it was signed, in the clinic's zone, and the prescription version. */}
      {state === "sealed" && visit.signed_at && (
        <span
          ref={signedChipRef}
          tabIndex={-1}
          data-testid="signed-chip"
          className="inline-flex h-pill shrink-0 items-center gap-1 rounded-pill border border-border-strong bg-surface px-1.75 text-caption font-semibold whitespace-nowrap text-fg-secondary outline-none focus-visible:focus-ring"
        >
          <Lock aria-hidden="true" className="size-3" />
          Signed {signedAtLabel(visit.signed_at, timeZone)}
          {visit.prescription_version ? ` · Rx v${visit.prescription_version}` : ""}
        </span>
      )}
    </>
  );

  return (
    <div
      data-consult-workspace=""
      data-record-state={state}
      className="flex w-full flex-1 flex-col bg-canvas md:h-[calc(100dvh-var(--spacing-bar)-env(safe-area-inset-top,0px))] md:flex-none md:overflow-clip"
    >
      {/* The sticky header: top bar, allergy strip (always on screen, sealed records included) and, on a phone, the section strip. */}
      <header className="sticky top-0 z-30 shrink-0 md:static">
        <ConsultTopBar
          patient={identity}
          token={visit.token_number}
          status={visit.status}
          chips={statusChips}
          saveStatus={
            !readOnly ? (
              // The save state (V2-09b R-4). A fixed width from md up: the quiet states never move the controls beside it, so a click that starts on a
              // button after a blur-triggered save still lands on it. A phone draws only the failures.
              <div className="flex md:min-w-40 md:justify-end">
                <SaveStatus {...consultDraft.saveStatusProps} />
              </div>
            ) : null
          }
          actions={
            <>
              <span className="hidden md:max-[1180px]:contents">{patientButton}</span>
              {summaryToggle}
              {saveButton}
              <span className="hidden md:contents">{primaryAction}</span>
            </>
          }
        />
        <AllergyStrip allergies={patient.allergies} conditions={patient.chronic_conditions} />
        <SectionStrip sections={stripSections} active={activeSection} onSelect={(id) => goToSection(id as SectionId)} onSummary={() => setIsSummaryOpen(true)} />
      </header>

      {/* The note. A div, not <main>: the shell's <main id="main"> is the page's one main landmark (CI 43712054628). From 768 px it scrolls on its
          own under the fixed header; below it the page scrolls. */}
      <div className="flex min-h-0 flex-1">
        <PatientColumn {...patientContext} />
        {/* `relative`: the sticky section labels inside would otherwise add their scroll range to the document's (Chromium), and the page would scroll under the header. */}
        <div data-note-scroll="" className="relative min-w-0 flex-1 md:overflow-y-auto md:overscroll-contain">
          <div className="mx-auto w-full max-w-note-max px-4 pb-28 md:px-6 md:pt-1 md:pb-16 min-[1180px]:px-8">
            {/* Amending (R-16): the signed version is kept; the edits become the next version when the amendment is finalized. */}
            {state === "amending" && (
              <div className="-mx-4 mb-2 md:-mx-6 min-[1180px]:-mx-8">
                <AmendingBanner
                  bannerRef={amendingBannerRef}
                  signedVersion={signedVersion}
                  reason={visit.amendment_reason}
                  openedLabel={visit.amendment_opened_at ? clinicDateLabel(visit.amendment_opened_at, timeZone) : null}
                />
              </div>
            )}

            {/* The record's documents once the visit is completed: Rx, bill, receipt (all stay on a sealed record). */}
            {visit.status === "completed" && (
              <div data-record-actions="" className="flex flex-wrap items-center gap-2 border-b border-border py-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isSendingWa || isWaSent}
                  onClick={handleShareConsolidatedWhatsApp}
                  title="Send Prescription & Bill via WhatsApp (1 message)"
                  startIcon={isSendingWa ? <Loader2 className="animate-spin" /> : isWaSent ? <CheckCircle2 /> : <MessageSquare />}
                >
                  {isWaSent ? "Rx & Bill Sent ✓" : "WhatsApp Rx & Bill"}
                </Button>
                <a
                  href={`/api/visits/${visit.id}/prescription-pdf`}
                  target="_blank"
                  rel="noreferrer"
                  title="Print / View PDF Prescription"
                  className={buttonClassName({ variant: "soft" })}
                >
                  <Printer aria-hidden="true" className="size-4" />
                  <span>Print Rx</span>
                </a>
                <a
                  href={`/api/invoices/${visit.id}/receipt-pdf`}
                  target="_blank"
                  rel="noreferrer"
                  title="Print / View Payment Receipt"
                  className={buttonClassName({ variant: "secondary" })}
                >
                  <Receipt aria-hidden="true" className="size-4" />
                  <span>Receipt</span>
                </a>
              </div>
            )}

            <ConsultSection
              id="complaints"
              title="Complaints"
              shortcut={1}
              summary={chiefComplaints.length > 0 ? plural(chiefComplaints.length, "complaint", "complaints") : "None added"}
            >
              <ComplaintsSection
                complaints={chiefComplaints}
                clinicalNotes={clinicalNotes}
                disabled={readOnly}
                context={assistContext}
                onComplaintsChange={setChiefComplaints}
                onClinicalNotesChange={setClinicalNotes}
                onOpenShorthand={shorthandOn ? () => setIsCommandBarOpen(true) : undefined}
              />
            </ConsultSection>

            <ConsultSection
              id="examination"
              title="Examination"
              shortcut={2}
              summary={vitals && Object.keys(vitals).length > 0 ? "Vitals recorded" : "No vitals yet"}
            >
              <div className="flex flex-col gap-4">
                <div id="vitals">
                  <VitalsBlock key={editorKey} vitals={vitals ?? {}} disabled={readOnly} onChange={setVitals} />
                </div>
                {/* Template tiles, findings and signs (09B-03). Dental and Child hand over to the existing odontogram and paediatrics tools. */}
                <ExaminationSection
                  specialty={specialty}
                  specialtyData={specialtyData}
                  readOnly={readOnly}
                  complaints={chiefComplaints}
                  context={assistContext}
                  onChange={(nextSpecialty, data) => {
                    setSpecialty(nextSpecialty);
                    setSpecialtyData(data);
                  }}
                >
                  {specialty === "dental" && (
                    <DentalOdontogram
                      disabled={readOnly}
                      data={specialtyData?.specialty === "dental" ? specialtyData : undefined}
                      onChange={(data: DentalSpecialty) => setSpecialtyData(data)}
                    />
                  )}
                  {specialty === "pediatrics" && (
                    <PediatricsTools
                      disabled={readOnly}
                      data={specialtyData?.specialty === "pediatrics" ? specialtyData : undefined}
                      onChange={(data: PediatricsSpecialty) => setSpecialtyData(data)}
                      patientGender={patient.gender === "female" ? "female" : "male"}
                      patientAgeMonths={patientAgeMonths}
                      currentWeightKg={vitals?.weight ?? null}
                      currentHeightCm={vitals?.height ?? null}
                    />
                  )}
                </ExaminationSection>
              </div>
            </ConsultSection>

            <ConsultSection
              id="diagnosis"
              title="Diagnosis"
              shortcut={3}
              summary={diagnoses.length > 0 ? (diagnoses[0]?.diagnosis_name ?? plural(diagnoses.length, "diagnosis", "diagnoses")) : "None added"}
              flat
            >
              <DiagnosisSection
                visitId={visit.id}
                patientId={patient.id}
                specialty={specialty}
                diagnoses={diagnoses}
                onDiagnosesChange={setDiagnoses}
                complaints={chiefComplaints.map((c) => c.symptom)}
                context={assistContext}
                disabled={readOnly}
              />
            </ConsultSection>

            <ConsultSection
              id="prescription"
              title="Prescription"
              shortcut={4}
              summary={rxItems.length > 0 ? plural(rxItems.length, "medicine", "medicines") : "No medicines yet"}
              flat
            >
              <PrescriptionBuilder
                key={editorKey}
                visitId={visit.id}
                patientAllergies={patient.allergies ?? []}
                initialItems={rxItems}
                onItemsChange={setRxItems}
                disabled={readOnly}
                hasPastRx={!readOnly && pastEncounters.some((e) => e.prescriptions && e.prescriptions.length > 0)}
                activeDiagnosis={diagnoses[0]?.diagnosis_name || null}
                doctorId={visit.doctor_id}
                onRepeatLastRx={() => {
                  const firstWithRx = pastEncounters.find((e) => e.prescriptions && e.prescriptions.length > 0);
                  if (firstWithRx && firstWithRx.prescriptions[0]?.items) {
                    void handleRepeatRx(firstWithRx.prescriptions[0].items);
                  }
                }}
              />
            </ConsultSection>

            <ConsultSection
              id="plan"
              title="Plan"
              shortcut={5}
              summary={
                [
                  investigations.length > 0 ? plural(investigations.length, "test", "tests") : null,
                  followUpCount > 0 ? `follow-up ${followUpDate}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Tests, advice, follow-up"
              }
            >
              <PlanSection
                readOnly={readOnly}
                investigations={investigations}
                onInvestigationsChange={setInvestigations}
                advice={adviceList}
                onAdviceChange={setAdviceList}
                followUpInterval={followUpInterval}
                followUpDate={followUpDate}
                followUpNotes={followUpNotes}
                onFollowUpInterval={handleIntervalChange}
                onFollowUpDate={(date) => {
                  setFollowUpDate(date);
                  setFollowUpInterval("custom");
                }}
                onFollowUpNotes={setFollowUpNotes}
                activeReferral={activeReferral}
                isOpeningReferralPdf={isOpeningReferralPdf}
                onOpenReferral={() => setIsReferralModalOpen(true)}
                onOpenReferralPdf={(id) => void handleOpenReferralPdf(id)}
                context={assistContext}
                diagnosisNames={diagnoses.map((d) => d.diagnosis_name)}
                followUpSuggestion={suggestion ? <FollowUpSuggestion phrase={suggestion} today={clinicToday} onAccept={acceptSuggestion} /> : null}
                bookFollowUp={followUpOn ? <BookFollowUp href={bookHref} booked={followUpBooked} date={followUpDate} /> : null}
              />
            </ConsultSection>
          </div>
        </div>
        {summaryPaneOpen && <SummaryPane content={summaryContent} />}
      </div>

      <FinishBar>
        {patientButton}
        {primaryAction}
      </FinishBar>

      {/* The patient's context in a sheet where the column is not shown (768 to 1179 px from the top bar; below 768 from the Finish bar). */}
      <PatientSheet open={isPatientOpen} onOpenChange={setIsPatientOpen} {...patientContext} />
      <SummarySheet open={isSummaryOpen} onOpenChange={setIsSummaryOpen} content={summaryContent} />
      <ShortcutSheet
        open={isShortcutsOpen}
        onOpenChange={setIsShortcutsOpen}
        enabled={shortcutsOn}
        onChange={setShortcutsOn}
        shortcuts={CONSULT_SHORTCUTS}
        note="Alt+1 to Alt+5 always work. M and F work when no field is focused and this switch is on. The ? key always opens this list."
      />

      {/* The shorthand bar and the doctor's macros (09B-04b): gated by assist.shorthand and hidden when the record is read-only. */}
      {shorthandOn && (
        <>
          <CommandBar
            open={isCommandBarOpen}
            onOpenChange={setIsCommandBarOpen}
            macros={macroList}
            today={clinicToday}
            onInsert={handleInsertShorthand}
            onManageMacros={() => {
              setIsCommandBarOpen(false);
              setIsMacroListOpen(true);
            }}
          />
          <MacroList open={isMacroListOpen} onOpenChange={setIsMacroListOpen} macros={macroList} onChange={setMacroList} />
        </>
      )}

      {/* R-5: the same field was changed here and in another tab or device; nothing is overwritten silently. */}
      <DraftConflictDialog
        fields={consultDraft.state.conflict?.fields ?? null}
        onUseTheirs={() => void consultDraft.resolveConflict("theirs")}
        onKeepMine={() => void consultDraft.resolveConflict("mine")}
      />

      {/* Finish: the draft is flushed before the sheet opens and again before the sign-off command (R-8). */}
      <SignAndBillModal
        isOpen={isSignModalOpen}
        onClose={() => setIsSignModalOpen(false)}
        visitId={visit.id}
        patientId={patient.id}
        patientName={patient.full_name}
        diagnosesCount={diagnoses.length || 1}
        medicinesCount={rxItems.length}
        followUpDate={followUpInterval === "none" ? null : followUpDate || null}
        canCollect={canCollectPayment}
        onSaveDraftBeforeSign={() => handleSaveDraft()}
      />

      {/* Amendment: reopen a signed consultation with a reason (the database snapshots the signed version), then finalize it. */}
      <AmendmentModal
        isOpen={isAmendOpen}
        onClose={() => setIsAmendOpen(false)}
        visitId={visit.id}
        completedDate={visit.signed_at ? signedAtLabel(visit.signed_at, timeZone) : undefined}
        currentVersion={signedVersion}
        onSuccess={() => {
          focusAfterRefreshRef.current = "amending";
          router.refresh();
        }}
      />
      <FinalizeAmendmentDialog
        open={isFinalizeOpen}
        onOpenChange={setIsFinalizeOpen}
        visitId={visit.id}
        fromVersion={signedVersion}
        onBeforeFinalize={() => handleSaveDraft()}
        onSuccess={() => {
          focusAfterRefreshRef.current = "sealed";
          router.refresh();
        }}
      />

      <CreateReferralModal
        isOpen={isReferralModalOpen}
        onClose={() => setIsReferralModalOpen(false)}
        patientId={patient.id}
        patientName={patient.full_name}
        patientPhone={patient.phone}
        visitId={visit.id}
        currentDiagnoses={diagnoses.map((d) => d.diagnosis_name)}
        currentMedications={rxItems.map((item) => ({
          medicine_name: item.medicine_name,
          dosage: item.dosage,
          timing: item.timing,
          duration: item.duration,
        }))}
        onSuccess={(ref) => setActiveReferral(ref)}
      />
    </div>
  );
}
