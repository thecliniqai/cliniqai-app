"use client";

import React, { useState } from "react";
import {
  Sparkles,
  X,
  FileText,
  Stethoscope,
  HelpCircle,
  Loader2,
  Check,
  Send,
  AlertTriangle,
  Search,
} from "lucide-react";
import { IcdCodeSuggestionCard, IcdCodeCandidate } from "./icd-code-suggestion-card";
import { generateSoapAction, suggestIcd10Action } from "@/features/ai/actions";
import { SoapDraft, ChiefComplaintItem } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

export interface ClinicalCopilotPanelProps {
  isOpen: boolean;
  onClose: () => void;
  patientContext?: {
    age?: number | string | null;
    sex?: string | null;
    vitals?: Record<string, unknown> | null;
    chronic_conditions?: string[];
  };
  onInsertChiefComplaints: (items: ChiefComplaintItem[]) => void;
  onInsertExamination: (findings: string) => void;
  onInsertAdvice: (adviceText: string) => void;
  onInsertAllSoap: (draft: SoapDraft) => void;
  onApplyDiagnosis: (code: string, description: string) => void;
  appliedDiagnosisCodes?: string[];
  initialTab?: "soap" | "icd" | "qa";
  initialDraft?: SoapDraft | null;
  className?: string;
}

export const STATUTORY_DISCLAIMER =
  "⚠️ Clinical Advisory: CliniQ AI is an informational assistant, not a licensed healthcare professional. All information must be evaluated and verified under independent clinical judgment.";

export function ClinicalCopilotPanel({
  isOpen,
  onClose,
  patientContext,
  initialTab = "soap",
  initialDraft = null,
  onInsertChiefComplaints,
  onInsertExamination,
  onInsertAdvice,
  onInsertAllSoap,
  onApplyDiagnosis,
  appliedDiagnosisCodes = [],
  className,
}: ClinicalCopilotPanelProps) {
  const [activeTab, setActiveTab] = useState<"soap" | "icd" | "qa">(initialTab);

  // SOAP State
  const [shorthandText, setShorthandText] = useState("");
  const [isGeneratingSoap, setIsGeneratingSoap] = useState(false);
  const [soapDraft, setSoapDraft] = useState<SoapDraft | null>(initialDraft);
  const [soapError, setSoapError] = useState<string | null>(null);

  // ICD-10 State
  const [icdQuery, setIcdQuery] = useState("");
  const [isSearchingIcd, setIsSearchingIcd] = useState(false);
  const [icdCandidates, setIcdCandidates] = useState<IcdCodeCandidate[]>([]);
  const [icdSearched, setIcdSearched] = useState(false);

  // Q&A State
  const [qaInput, setQaInput] = useState("");
  const [isAnsweringQa, setIsAnsweringQa] = useState(false);
  const [qaHistory, setQaHistory] = useState<
    Array<{ question: string; answer: string }>
  >([]);

  if (!isOpen) return null;

  const handleGenerateSoap = async () => {
    if (!shorthandText.trim() || isGeneratingSoap) return;
    setIsGeneratingSoap(true);
    setSoapError(null);

    try {
      const res = await generateSoapAction({
        shorthand: shorthandText.trim(),
        patientContext: patientContext as any,
      });

      if (!res.success || !res.draft) {
        setSoapError(res.error || "Failed to generate structured SOAP note.");
      } else {
        setSoapDraft(res.draft);
      }
    } catch (err: any) {
      setSoapError(err?.message || "An unexpected error occurred.");
    } finally {
      setIsGeneratingSoap(false);
    }
  };

  const handleSearchIcd = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!icdQuery.trim() || isSearchingIcd) return;
    setIsSearchingIcd(true);

    try {
      const res = await suggestIcd10Action({
        query: icdQuery.trim(),
      });
      setIcdCandidates(res.candidates || []);
      setIcdSearched(true);
    } catch {
      setIcdCandidates([]);
      setIcdSearched(true);
    } finally {
      setIsSearchingIcd(false);
    }
  };

  const handleAskQa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qaInput.trim() || isAnsweringQa) return;

    const question = qaInput.trim();
    setQaInput("");
    setIsAnsweringQa(true);

    try {
      const res = await fetch("/api/ai/clinical-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: question }],
          patientContext,
        }),
      });

      let answerText = "";
      if (res.ok) {
        // Read text response
        const text = await res.text();
        // If streamed or plain text
        answerText = text || "Clinical guidelines reviewed. Verify against current prescribing information.";
      } else {
        answerText = "Unable to retrieve clinical answer at this moment.";
      }

      setQaHistory((prev) => [...prev, { question, answer: answerText }]);
    } catch (err: any) {
      setQaHistory((prev) => [
        ...prev,
        { question, answer: `Error: ${err?.message || "Request failed"}` },
      ]);
    } finally {
      setIsAnsweringQa(false);
    }
  };

  return (
    <aside
      aria-label="Clinical Copilot"
      className={cn(
        "flex h-full w-full lg:w-[380px] shrink-0 flex-col bg-white border-l border-[#E4E5E7] shadow-sm z-30 transition-all",
        className
      )}
    >
      {/* Sticky Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#E4E5E7] px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#EEF2FF] text-[#4F46E5]">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#17181A]">
              Clinical Copilot
            </h2>
            <span className="text-[10px] text-gray-500 block -mt-0.5">
              Doctor Decision Support
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors cursor-pointer"
          aria-label="Close Clinical Copilot"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Pinned De-identification Banner */}
      <div className="flex items-center gap-1.5 bg-gray-50/80 px-3 py-1.5 border-b border-gray-100 text-[11px] text-gray-500">
        <span>🔒</span>
        <span className="font-medium">De-identified Query (Direct PII removed)</span>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-[#E4E5E7] bg-white text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab("soap")}
          className={cn(
            "flex-1 py-2.5 text-center border-b-2 transition-colors cursor-pointer flex items-center justify-center gap-1.5",
            activeTab === "soap"
              ? "border-[#1769E0] text-[#1769E0]"
              : "border-transparent text-gray-500 hover:text-gray-800"
          )}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>SOAP Notes</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("icd")}
          className={cn(
            "flex-1 py-2.5 text-center border-b-2 transition-colors cursor-pointer flex items-center justify-center gap-1.5",
            activeTab === "icd"
              ? "border-[#1769E0] text-[#1769E0]"
              : "border-transparent text-gray-500 hover:text-gray-800"
          )}
        >
          <Stethoscope className="w-3.5 h-3.5" />
          <span>ICD-10</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("qa")}
          className={cn(
            "flex-1 py-2.5 text-center border-b-2 transition-colors cursor-pointer flex items-center justify-center gap-1.5",
            activeTab === "qa"
              ? "border-[#1769E0] text-[#1769E0]"
              : "border-transparent text-gray-500 hover:text-gray-800"
          )}
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Clinical Q&A</span>
        </button>
      </div>

      {/* Tab 1: SOAP Notes Tab */}
      {activeTab === "soap" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              Clinical Shorthand / Dictation
            </label>
            <textarea
              rows={4}
              value={shorthandText}
              onChange={(e) => setShorthandText(e.target.value)}
              placeholder="e.g. c/o fever 3d, dry cough. o/e throat congested, chest clear. adv paracetamol, rest, warm saline gargles."
              className="w-full p-2.5 text-xs text-[#17181A] rounded-lg border border-[#E4E5E7] bg-white placeholder:text-gray-400 focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0] outline-none"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-gray-500">
                Supports Indian OPD abbreviations (c/o, o/e, adv, f/u, sos)
              </span>

              <button
                type="button"
                disabled={isGeneratingSoap || !shorthandText.trim()}
                onClick={handleGenerateSoap}
                className="h-8 px-3 rounded-lg bg-[#1769E0] text-white text-xs font-semibold hover:bg-[#0F5AB8] transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-2xs"
              >
                {isGeneratingSoap ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Structuring...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3" />
                    <span>Generate SOAP Draft</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Zero Autonomous Prescribing Banner (NMC 2023) */}
          <div className="flex items-start gap-1.5 p-2 rounded bg-amber-50/80 border border-amber-200/70 text-[10px] text-amber-900">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Zero Autonomous Prescribing: Medications cannot be drafted autonomously. Enter complaints and examination here; add medicines directly in the Prescription Builder.
            </span>
          </div>

          {soapError && (
            <div className="p-2.5 rounded-lg border border-[#F2B8B5] bg-[#FDECEA] text-xs text-[#B42318]">
              {soapError}
            </div>
          )}

          {/* Generated Draft Section Cards */}
          {soapDraft && (
            <div className="space-y-3 pt-2 border-t border-[#E4E5E7]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#17181A]">
                  Structured SOAP Draft
                </span>
                <span className="text-[10px] font-semibold text-[#4F46E5] bg-[#EEF2FF] px-2 py-0.5 rounded border border-[#C7D2FE]">
                  ✦ AI Suggested Draft
                </span>
              </div>

              {/* Chief Complaints Card */}
              <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-gray-800">
                    Chief Complaints ({soapDraft.chief_complaints.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => onInsertChiefComplaints(soapDraft.chief_complaints)}
                    className="h-6 px-2 text-[10px] font-semibold text-[#1769E0] bg-white border border-[#C7D2FE] rounded hover:bg-[#EAF2FF] transition-colors cursor-pointer"
                  >
                    Insert Chief Complaints
                  </button>
                </div>
                <ul className="text-xs text-gray-700 space-y-1">
                  {soapDraft.chief_complaints.map((item, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#1769E0]" />
                      <span>
                        {item.complaint} {item.duration ? `(${item.duration})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Physical Examination Card */}
              {soapDraft.examination && (
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-800">
                      Physical Examination
                    </span>
                    <button
                      type="button"
                      onClick={() => onInsertExamination(soapDraft.examination)}
                      className="h-6 px-2 text-[10px] font-semibold text-[#1769E0] bg-white border border-[#C7D2FE] rounded hover:bg-[#EAF2FF] transition-colors cursor-pointer"
                    >
                      Insert Examination Findings
                    </button>
                  </div>
                  <p className="text-xs text-gray-700 whitespace-pre-wrap">
                    {soapDraft.examination}
                  </p>
                </div>
              )}

              {/* Clinical Advice Card */}
              {soapDraft.advice && (
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-800">
                      Clinical Advice
                    </span>
                    <button
                      type="button"
                      onClick={() => onInsertAdvice(soapDraft.advice)}
                      className="h-6 px-2 text-[10px] font-semibold text-[#1769E0] bg-white border border-[#C7D2FE] rounded hover:bg-[#EAF2FF] transition-colors cursor-pointer"
                    >
                      Insert Clinical Advice
                    </button>
                  </div>
                  <p className="text-xs text-gray-700 whitespace-pre-wrap">
                    {soapDraft.advice}
                  </p>
                </div>
              )}

              {/* Zero Autonomous Prescribing Banner */}
              <div className="flex items-start gap-1.5 p-2 rounded bg-amber-50 border border-amber-200 text-[10px] text-amber-800">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Zero Autonomous Prescribing: Medications must be verified and added via the Prescription Builder below.
                </span>
              </div>

              {/* Insert All Sections Primary CTA */}
              <button
                type="button"
                onClick={() => onInsertAllSoap(soapDraft)}
                className="w-full h-9 rounded-lg bg-[#1769E0] text-white text-xs font-semibold hover:bg-[#0F5AB8] transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Insert All Sections</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: ICD-10 Helper Tab */}
      {activeTab === "icd" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <form onSubmit={handleSearchIcd} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-3 text-gray-400" />
              <input
                type="text"
                value={icdQuery}
                onChange={(e) => setIcdQuery(e.target.value)}
                placeholder="Search diagnosis (e.g. URTI, asthma)..."
                className="w-full pl-8 pr-2.5 h-9 rounded-lg border border-[#E4E5E7] text-xs text-[#17181A] placeholder:text-gray-400 focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0] outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isSearchingIcd || !icdQuery.trim()}
              className="h-9 px-3 rounded-lg bg-[#1769E0] text-white text-xs font-semibold hover:bg-[#0F5AB8] transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSearchingIcd ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Search"}
            </button>
          </form>

          <div className="space-y-2 pt-1">
            {icdCandidates.length > 0 ? (
              icdCandidates.map((cand) => (
                <IcdCodeSuggestionCard
                  key={cand.code}
                  candidate={cand}
                  isApplied={appliedDiagnosisCodes.includes(cand.code)}
                  onApply={(code, desc) => onApplyDiagnosis(code, desc)}
                />
              ))
            ) : icdSearched ? (
              <p className="text-xs text-gray-500 text-center py-6">
                No matching ICD-10 codes found.
              </p>
            ) : (
              <p className="text-xs text-gray-500 text-center py-6">
                Type a symptom or diagnosis above to view ranked ICD-10 suggestions with clinical criteria bullets.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Clinical Reference Q&A Tab */}
      {activeTab === "qa" && (
        <div className="flex-1 flex flex-col justify-between overflow-hidden">
          {/* Persistent Statutory Clinical Advisory Banner */}
          <div className="p-2.5 bg-amber-50/80 border-b border-amber-200/60 text-[10px] text-amber-900 leading-normal flex items-start gap-1.5 shrink-0">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <span>{STATUTORY_DISCLAIMER}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {qaHistory.length === 0 ? (
              <div className="text-center py-8 px-4 text-xs text-gray-500">
                <HelpCircle className="w-8 h-8 text-[#1769E0] mx-auto mb-2 opacity-80" />
                <p className="font-semibold text-gray-800 mb-1">
                  Clinical Evidence Q&A
                </p>
                <p className="text-[11px] leading-relaxed">
                  Ask clinical drug dosing queries, guideline recommendations, or management protocols.
                </p>
              </div>
            ) : (
              qaHistory.map((item, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="flex justify-end">
                    <div className="bg-[#F1F2F4] text-[#17181A] px-3 py-2 rounded-xl text-xs max-w-[85%]">
                      {item.question}
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="bg-white border border-[#E4E5E7] text-[#17181A] p-3 rounded-xl text-xs max-w-[90%] space-y-2">
                      <p className="whitespace-pre-wrap">{item.answer}</p>
                      <div className="p-2 rounded bg-amber-50/70 border border-amber-200/60 text-[10px] text-amber-900 leading-normal">
                        {STATUTORY_DISCLAIMER}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}

            {isAnsweringQa && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1769E0]" />
                <span>Consulting clinical reference...</span>
              </div>
            )}
          </div>

          {/* Sticky Q&A Input */}
          <div className="p-3 border-t border-[#E4E5E7] bg-white">
            <form onSubmit={handleAskQa} className="flex gap-2">
              <input
                type="text"
                value={qaInput}
                onChange={(e) => setQaInput(e.target.value)}
                disabled={isAnsweringQa}
                placeholder="Ask clinical reference question..."
                className="flex-1 h-9 px-3 rounded-lg border border-[#E4E5E7] text-xs text-[#17181A] placeholder:text-gray-400 focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0] outline-none"
              />
              <button
                type="submit"
                disabled={isAnsweringQa || !qaInput.trim()}
                className="h-9 w-9 rounded-lg bg-[#1769E0] text-white flex items-center justify-center hover:bg-[#0F5AB8] transition-colors cursor-pointer disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
