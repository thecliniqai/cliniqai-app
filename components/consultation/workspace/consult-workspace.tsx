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
import { pastItemToMedicine } from "@/features/prescriptions/lines";
import { sendConsolidatedConsultationWhatsApp } from "@/features/billing/actions";
import { getReferralSignedUrl } from "@/features/referrals/actions";
import { recordState, signedVersionOf, SIGNED_CONSULTATION_MESSAGE } from "@/features/consultation/record-state";
import { changedDraftKeys, type DraftFields } from "@/features/consultation/draft";
import type { FlushResult } from "@/features/consultation/draft-saver";
import { VitalsBlock } from "../vitals-block";
import { notify } from "@/components/ui/toast";
import { PrescriptionSection, type RxLastVisit, type RxLeftOut } from "./sections/prescription-section";
import type { RxEntryHandle } from "@/components/clinical/rx-entry-row";
import { useRxLines, type RepeatPart } from "./use-rx-lines";
import { RxPrintPortal } from "@/components/prescriptions/rx-print-view";
import type { PrescriptionPdfPayload } from "@/features/prescriptions/pdf/types";
import { DentalOdontogram } from "../specialty/dental-odontogram";
import { PediatricsTools } from "../specialty/pediatrics-tools";
import { SignAndBillModal } from "../sign-and-bill-modal";
import { SharePdfButton } from "@/components/clinical/share-pdf-button";
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
import { Check, CheckCircle2, FilePenLine, FileText, Loader2, Lock, MessageSquare, Printer, Receipt, Save, UserRound } from "lucide-react";
import { ConsultTopBar } from "./consult-top-bar";
import { AllergyStrip } from "./allergy-strip";
import { AllergyEditor } from "@/components/clinical/allergy-editor";
import { getRxAllergyContextAction } from "@/features/prescriptions/actions";
import type { RxAllergyContext } from "@/features/prescriptions/allergy";
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
import { Attachments } from "./attachments";
import type { ConsultDocument } from "@/features/labs/consult-documents";
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
    /** The patient asked not to be messaged on WhatsApp (`patients.whatsapp_opt_out`): the finish review offers no WhatsApp send. */
    whatsapp_opt_out?: boolean;
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
  /** The signed-in user may record allergies: patients:edit and consultations:view (the 000055 rule: the front desk cannot). Shapes the screen only. */
  canRecordAllergies?: boolean;
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
  /**
   * The same read, for the Prescription section's favourites and "your usual" (V2-09c R-9): only when the clinic is entitled to `assist.frequent_rx` and the
   * record is editable; null otherwise ("Same as last visit" stays).
   */
  rxAssistContext?: AssistContext | null;
  /**
   * The signed prescription's print payload (V2-09c 09C-04, R-12; CTO ruling Q-2), read on the server for a sealed record and a role that may read prescriptions;
   * null otherwise. "Print Rx" prints it with the browser's print dialog, on the clinic's paper and margins; the PDF link stays beside it.
   */
  printPayload?: PrescriptionPdfPayload | null;
  /** The allergy picture of the visit the page read (V2-09c 09C-02, R-7): the three states, the coded allergies, what each line matches. */
  allergyContext?: RxAllergyContext | null;
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
  /**
   * The patient's documents, newest first (09B-05, P1-24), read on the server for a role with `labs:view`; `null`: the role may not read them (no list, no
   * "Documents" block). This visit's own documents are the Plan list; the patient column shows the five newest.
   */
  documents?: ConsultDocument[] | null;
  /** The role holds `labs:edit`: the upload is offered (else the drop zone is disabled with the reason). */
  canUpload?: boolean;
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
  canRecordAllergies: mayRecordAllergies = false,
  assist,
  assistContext = null,
  rxAssistContext = null,
  printPayload = null,
  allergyContext: initialAllergyContext = null,
  snapshot = null,
  macros = [],
  upcomingVisits = [],
  canBook = false,
  documents: initialDocuments = null,
  canUpload = false,
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

  // Follow-up state. 09B-06a (A-3): nothing is preselected. With no stored follow-up the interval is null (none chosen) and nothing is stored until the
  // doctor taps a tile; the Plan section marks 5 days (or the doctor's usual) as a suggestion. Before, "5 days" was preselected and stored with the
  // first unrelated edit, so every visit got a follow-up the doctor never chose.
  const [followUpInterval, setFollowUpInterval] = useState<FollowUpIntervalChoice | null>(
    (visit.follow_up?.interval as FollowUpIntervalChoice | undefined) ?? (visit.follow_up?.follow_up_date ? "custom" : null),
  );
  const [followUpDate, setFollowUpDate] = useState<string>(visit.follow_up?.follow_up_date ?? "");
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
  // The patient's documents (09B-05): a report uploaded here is added at the top of the list at once; the server copy is read again on the next load.
  const [documents, setDocuments] = useState<ConsultDocument[] | null>(initialDocuments);
  const [shortcutsOn, setShortcutsOn] = useState(false);
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  const [diagnoses, setDiagnoses] = useState<ConsultationDiagnosisItem[]>(visit.diagnoses ?? []);
  // The Rx lines are the server's answer to one `change_prescription` command per change (V2-09c R-2); the hook holds them for the section, the strip,
  // the summary pane and Sign & Bill.
  const rx = useRxLines({ visitId: visit.id, initialItems: visit.prescription_items ?? [] });
  const rxItems = rx.items;
  // The medicines "Same as last visit" or a tile left to the doctor (an allergy match), and the entry row's handle that opens the dose builder for one.
  const rxEntryRef = useRef<RxEntryHandle | null>(null);
  const [rxLeftOut, setRxLeftOut] = useState<readonly RxLeftOut[]>([]);

  // The allergies and what each line matches (V2-09c 09C-02, R-7, R-8). The strip draws the stored list; the editor saves it through one command and the
  // context is read again (after a save and after every change of the lines) so the chips, the notices and the line states follow the database's rule.
  const [allergies, setAllergies] = useState<string[] | null>(patient.allergies ?? null);
  const [allergyContext, setAllergyContext] = useState<RxAllergyContext | null>(initialAllergyContext);
  const [isAllergyEditorOpen, setIsAllergyEditorOpen] = useState(false);
  const [allergyVersion, setAllergyVersion] = useState(0);
  // The entries the editor coded in this session: known at once, before the context is read again.
  const [localCoded, setLocalCoded] = useState<string[]>([]);
  const firstContext = useRef(true);
  useEffect(() => {
    // The page already read the context for the first render.
    if (firstContext.current) {
      firstContext.current = false;
      return;
    }
    let alive = true;
    void getRxAllergyContextAction(visit.id)
      .then((res) => {
        if (alive && res.success && res.context) setAllergyContext(res.context);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [visit.id, rxItems, allergyVersion]);

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
    document.querySelector<HTMLInputElement>("#prescription [data-rx-search]")?.focus();
  };
  const shorthandOn = assist?.["assist.shorthand"] === true && !readOnly;
  const followUpOn = assist?.["assist.followup"] === true && !readOnly;
  // The allergy editor is offered while the record is editable and the role may record allergies (consultations:edit stands for the clinical roles here; the
  // command itself needs patients:edit and consultations:view and the database refuses anyone else).
  const canRecordAllergies = !readOnly && mayRecordAllergies;
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
      followUpInterval !== null && followUpInterval !== "none" && followUpDate
        ? { interval: followUpInterval, follow_up_date: followUpDate, notes: followUpNotes || null }
        : null,
  };
  const [initialFields] = useState<DraftFields>(currentFields);
  // The server copy a saver starts from, read from the page's current props (09B-06a, A-6): after Amend or Finalize the page is refreshed and a new saver
  // is made from what the server holds now, not from the mount-time snapshot (which made its first save resend every field edited earlier).
  const serverFields: DraftFields = {
    vitals: visit.vitals ?? null,
    chief_complaints: visit.chief_complaints ?? [],
    clinical_notes: visit.clinical_notes ?? "",
    specialty_data: visit.specialty_data ?? null,
    investigations_advised: visit.investigations_advised ?? [],
    advice: visit.advice ?? [],
    specialty: visit.specialty ?? "general_physician",
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
      setFollowUpInterval(fu?.follow_up_date ? (fu.interval ?? "custom") : null);
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
  // Nothing is sent before the doctor changes something on screen.
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
      // 09B-06a (A-7): a field held back as invalid (a vital out of range, a follow-up date outside the allowed range); the rest is saved.
      invalid: "A value is out of range (marked in red). Correct or clear it, then try again.",
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

  // "Same as last visit" and "Repeat this Rx": ONE `repeat_visit_plan` command (V2-09c R-10). The database copies the signed source's diagnoses and lines, skips
  // what is already here and leaves out a line that matches a recorded allergy; the screen takes its answer and opens the left-out line in the dose builder.
  const runRepeat = async (sourceVisitId: string, parts: readonly RepeatPart[]): Promise<{ ok: boolean; error?: string }> => {
    setIsPatientOpen(false);
    goToSection("prescription");
    const sent = await rx.repeat(sourceVisitId, parts);
    if (!sent.ok) return { ok: false, error: sent.error };
    rx.markRepeated((sent.added ?? []).map((i) => i.id));
    if (sent.diagnoses) setDiagnoses(sent.diagnoses);
    const left: RxLeftOut[] = (sent.skipped ?? []).map((item) => ({ key: `item:${item.id}`, medicine: pastItemToMedicine(item), allergy: "a recorded allergy (see the allergy strip)" }));
    const [first, ...rest] = left;
    setRxLeftOut(rest);
    if (first) rxEntryRef.current?.prefill(first.medicine, { allergy: first.allergy });
    return { ok: true };
  };

  // The patient's last signed visit and what copying it would still add (a diagnosis or medicine already on this visit is not offered again).
  const lastSigned = pastEncounters.find((e) => e.status === "completed" && Boolean(e.signedAt));
  const norm = (value: string) => value.trim().toLowerCase();
  const lastVisit: RxLastVisit | null = (() => {
    if (!lastSigned || readOnly) return null;
    const have = new Set(diagnoses.map((d) => norm(d.diagnosis_name)));
    const onRx = new Set(rxItems.map((i) => norm(i.medicine_name)));
    const parts: RepeatPart[] = [];
    if (lastSigned.diagnoses.some((d) => !have.has(norm(d.diagnosis_name)))) parts.push("diagnoses");
    if ((lastSigned.prescriptions[0]?.items ?? []).some((i) => !onRx.has(norm(i.medicine_name)))) parts.push("prescription");
    return parts.length > 0 ? { visitId: lastSigned.visitId, dateLabel: clinicDateLabel(lastSigned.date, timeZone), parts } : null;
  })();

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
    onRepeatRx: readOnly
      ? undefined
      : (sourceVisitId: string) => {
          void runRepeat(sourceVisitId, ["prescription"]).then((sent) => {
            if (!sent.ok) notify.error(sent.error ?? "Failed to repeat the prescription.");
          });
        },
    onCopyNotes: readOnly ? undefined : handleCopyNotes,
    documents: documents ? documents.slice(0, 5) : undefined,
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

  // The finish review (V2-09c 09C-05, R-13): the medicines that match a recorded allergy and have no reason block the sign-off until each is confirmed or removed.
  const allergyChecking = Boolean(allergyContext?.entitled) && assist?.["assist.allergy_check"] !== false;
  const unresolvedAllergies = allergyChecking
    ? (allergyContext?.items ?? [])
        .filter((info) => info.matches.length > 0 && !info.overridden)
        .flatMap((info) => {
          const item = rxItems.find((i) => i.id === info.id);
          return item ? [{ id: info.id, medicine: item.medicine_name, matches: info.matches.join(", ") }] : [];
        })
    : [];
  const whatsappOffer = patient.whatsapp_opt_out
    ? { available: false, unavailableReason: "This patient has asked not to be messaged on WhatsApp." }
    : !patient.phone
      ? { available: false, unavailableReason: "This patient has no phone number on file." }
      : { available: true };
  // "Go to {medicine}": closes the sheet, opens the Prescription section and puts the focus on the line's own action once the sheet has let go of the focus.
  const goToRxLine = (itemId: string) => {
    setIsSignModalOpen(false);
    goToSection("prescription");
    window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-rx-line-id="${CSS.escape(itemId)}"]`);
      row?.scrollIntoView({ block: "center" });
      (row?.querySelector<HTMLElement>("[data-rx-override]") ?? row?.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
    }, 250);
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
      {printPayload && state === "sealed" && <RxPrintPortal payload={printPayload} />}
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
        <AllergyStrip
          allergies={allergies}
          conditions={patient.chronic_conditions}
          onRecord={canRecordAllergies ? () => setIsAllergyEditorOpen(true) : undefined}
          onEdit={canRecordAllergies ? () => setIsAllergyEditorOpen(true) : undefined}
        />
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
                {printPayload && (
                  <Button type="button" variant="soft" title="Print the prescription on the clinic's paper" startIcon={<Printer />} onClick={() => window.print()}>
                    Print Rx
                  </Button>
                )}
                <a
                  href={`/api/visits/${visit.id}/prescription-pdf`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the prescription as a PDF"
                  className={buttonClassName({ variant: printPayload ? "secondary" : "soft" })}
                >
                  <FileText aria-hidden="true" className="size-4" />
                  <span>{printPayload ? "Rx PDF" : "Print Rx"}</span>
                </a>
                {printPayload && (
                  <a
                    href={`/api/visits/${visit.id}/prescription-pdf?letterhead=${printPayload.letterhead_mode === "preprinted_letterhead" ? "blank_paper" : "preprinted_letterhead"}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Render the PDF on the other kind of paper (not stored)"
                    className={buttonClassName({ variant: "ghost" })}
                  >
                    <span>{printPayload.letterhead_mode === "preprinted_letterhead" ? "PDF on blank paper" : "PDF on pre-printed paper"}</span>
                  </a>
                )}
                {printPayload && <SharePdfButton visitId={visit.id} />}
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
              <PrescriptionSection
                key={editorKey}
                rx={rx}
                allergy={
                  allergyContext
                    ? {
                        state: allergyContext.state,
                        entitled: allergyContext.entitled && assist?.["assist.allergy_check"] !== false,
                        entries: allergyContext.allergies,
                        items: Object.fromEntries(allergyContext.items.map((i) => [i.id, i])),
                        onRecord: canRecordAllergies ? () => setIsAllergyEditorOpen(true) : undefined,
                      }
                    : null
                }
                readOnly={readOnly}
                assistContext={rxAssistContext}
                diagnosisNames={diagnoses.map((d) => d.diagnosis_name)}
                specialty={specialty}
                lastVisit={lastVisit}
                onRepeat={runRepeat}
                entryRef={rxEntryRef}
                leftOut={rxLeftOut}
                onLeftOut={setRxLeftOut}
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
                followUpMinDate={clinicToday}
                followUpMaxDate={addDaysYmd(clinicToday, 366)}
                followUpInvalid={consultDraft.state.invalidFields.includes("follow_up")}
                activeReferral={activeReferral}
                isOpeningReferralPdf={isOpeningReferralPdf}
                onOpenReferral={() => setIsReferralModalOpen(true)}
                onOpenReferralPdf={(id) => void handleOpenReferralPdf(id)}
                context={assistContext}
                diagnosisNames={diagnoses.map((d) => d.diagnosis_name)}
                followUpSuggestion={suggestion ? <FollowUpSuggestion phrase={suggestion} today={clinicToday} onAccept={acceptSuggestion} /> : null}
                bookFollowUp={followUpOn ? <BookFollowUp href={bookHref} booked={followUpBooked} date={followUpDate} /> : null}
                attachments={
                  documents ? (
                    <Attachments
                      visitId={visit.id}
                      patientId={patient.id}
                      documents={documents.filter((d) => d.visit_id === visit.id)}
                      readOnly={readOnly}
                      canUpload={canUpload}
                      onUploaded={(doc) => setDocuments((current) => [doc, ...(current ?? [])])}
                    />
                  ) : null
                }
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
      <AllergyEditor
        open={isAllergyEditorOpen}
        onOpenChange={setIsAllergyEditorOpen}
        patientId={patient.id}
        initial={allergies}
        codedTexts={[...(allergyContext?.allergies ?? []).filter((a) => a.substanceIds.length > 0).map((a) => a.text), ...localCoded]}
        onSaved={(list, coded) => {
          setAllergies(list);
          setLocalCoded(coded);
          setAllergyVersion((n) => n + 1);
        }}
      />
      <SignAndBillModal
        isOpen={isSignModalOpen}
        onClose={() => setIsSignModalOpen(false)}
        visitId={visit.id}
        patientId={patient.id}
        patientName={patient.full_name}
        summary={summaryContent}
        unresolvedAllergies={unresolvedAllergies}
        onGoToLine={goToRxLine}
        whatsapp={whatsappOffer}
        printState={printPayload && state === "sealed" ? "view" : state === "sealed" ? "pdf" : "preparing"}
        onPrint={() => window.print()}
        onSigned={() => router.refresh()}
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
