"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Mic,
  Square,
  AlertCircle,
  Check,
  X,
  Loader2,
  Stethoscope,
  FileText,
  HelpCircle,
} from "lucide-react";
import { generateSoapAction } from "@/features/ai/actions";
import { SoapDraft, AnonymizedPatientContext } from "@/lib/ai/types";

// Type definitions for Web Speech API
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export interface AiScribeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept: (draft: SoapDraft) => void;
  patientContext?: AnonymizedPatientContext;
}

export function AiScribeModal({
  isOpen,
  onClose,
  onAccept,
  patientContext,
}: AiScribeModalProps) {
  const [shorthand, setShorthand] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedDraft, setGeneratedDraft] = useState<SoapDraft | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechConstructor =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechConstructor) {
        setSpeechSupported(false);
      }
    }
  }, []);

  // Cleanup speech recognition on unmount or close
  useEffect(() => {
    if (!isOpen && isRecording) {
      stopRecording();
    }
  }, [isOpen]);

  const startRecording = () => {
    if (typeof window === "undefined") return;
    const SpeechConstructor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechConstructor) {
      setSpeechSupported(false);
      return;
    }

    try {
      const recognition = new SpeechConstructor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-IN"; // English (India) default

      let interimTranscript = "";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTrans = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTrans += event.results[i][0].transcript + " ";
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTrans) {
          setShorthand((prev) => (prev ? `${prev.trim()} ${finalTrans.trim()}` : finalTrans.trim()));
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
          setErrorMessage("Microphone access was denied. Please allow microphone permissions in your browser.");
        }
        stopRecording();
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);
      setErrorMessage(null);
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore errors during stop
      }
      recognitionRef.current = null;
    }
    setIsRecording(false);
  };

  const handleToggleRecord = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleGenerate = async () => {
    if (!shorthand.trim()) {
      setErrorMessage("Please enter clinical notes or record dictation first.");
      return;
    }

    if (isRecording) {
      stopRecording();
    }

    setIsGenerating(true);
    setErrorMessage(null);

    try {
      const res = await generateSoapAction({
        shorthand,
        patientContext,
      });

      if (res.success && res.draft) {
        setGeneratedDraft(res.draft);
      } else {
        setErrorMessage(res.error || "Failed to generate structured SOAP notes. Your raw notes are preserved.");
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "AI service temporarily unavailable. Your raw notes are preserved."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAcceptAndInsert = () => {
    if (!generatedDraft) return;
    onAccept(generatedDraft);
    handleClose();
  };

  const handleClose = () => {
    stopRecording();
    setGeneratedDraft(null);
    setErrorMessage(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-scribe-modal-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6"
    >
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-[#F7F6F3]">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shadow-2xs">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 id="ai-scribe-modal-title" className="text-base font-semibold text-gray-900">
                AI Clinical Scribe — Shorthand & Dictation
              </h2>
              <p className="text-xs text-gray-500">
                Dictate or type shorthand. Scribe normalizes notes for your approval.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200/50 transition-colors"
            aria-label="Close AI Scribe Modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Error Banner */}
          {errorMessage && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              <div className="flex-1">
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          {/* Input & Dictation Area */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="scribe-shorthand"
                className="text-xs font-semibold uppercase tracking-wider text-gray-600 flex items-center gap-1.5"
              >
                <FileText className="h-3.5 w-3.5 text-gray-500" />
                Raw Notes / Dictation Transcript
              </label>

              {speechSupported ? (
                <button
                  type="button"
                  onClick={handleToggleRecord}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    isRecording
                      ? "bg-rose-50 text-rose-700 border border-rose-300 animate-pulse"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
                  }`}
                  aria-pressed={isRecording}
                >
                  {isRecording ? (
                    <>
                      <Square className="h-3.5 w-3.5 text-rose-600 fill-current" />
                      <span>⏹ Recording...</span>
                    </>
                  ) : (
                    <>
                      <Mic className="h-3.5 w-3.5 text-gray-600" />
                      <span>🎙 Start Dictation</span>
                    </>
                  )}
                </button>
              ) : (
                <span className="text-[11px] text-gray-400">
                  Mic dictation requires Chrome/Edge
                </span>
              )}
            </div>

            <textarea
              id="scribe-shorthand"
              rows={4}
              value={shorthand}
              onChange={(e) => setShorthand(e.target.value)}
              placeholder="e.g. c/o fever 3d, throat pain, dry cough. o/e throat congested, tonsils enlarged, chest clear. adv warm water gargle, steam inhalation twice daily."
              className="w-full p-3.5 rounded-xl border border-gray-300 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0] leading-relaxed font-sans"
            />

            <div className="flex items-center justify-between text-[11px] text-gray-500 pt-1">
              <span>Supports Indian OPD shorthand: c/o, o/e, adv, stat, sos, tab, syp.</span>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating || !shorthand.trim()}
                className="min-h-[40px] px-4 rounded-xl bg-[#1769E0] hover:bg-[#155cc0] text-white font-semibold text-xs flex items-center gap-2 shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Synthesizing SOAP...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5 text-blue-200" />
                    <span>Generate SOAP Draft</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* AI Suggested Draft Preview */}
          {generatedDraft && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-4 transition-all">
              <div className="flex items-center justify-between pb-3 border-b border-indigo-100">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                  ✦ AI Suggested Draft
                </span>
                <span className="text-[11px] text-indigo-700">
                  Ready for doctor verification
                </span>
              </div>

              {/* Chief Complaints */}
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 inline-block" />
                  Chief Complaints
                </h4>
                {generatedDraft.chief_complaints.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {generatedDraft.chief_complaints.map((item, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-indigo-200 text-xs text-gray-800 font-medium"
                      >
                        <span>{item.complaint}</span>
                        {item.duration && (
                          <span className="text-gray-500 text-[11px]">({item.duration})</span>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">None detected</p>
                )}
              </div>

              {/* Physical Examination */}
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 inline-block" />
                  Physical Examination
                </h4>
                <div className="p-2.5 rounded-lg bg-white border border-indigo-200 text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {generatedDraft.examination || "No specific examination findings specified."}
                </div>
              </div>

              {/* Advice */}
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 inline-block" />
                  Diet & Clinical Advice
                </h4>
                <div className="p-2.5 rounded-lg bg-white border border-indigo-200 text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {generatedDraft.advice || "No specific lifestyle advice specified."}
                </div>
              </div>

              {/* Disclaimer */}
              <p className="text-[11px] text-gray-500 italic pt-1">
                ✦ AI-suggested content. Sourced exclusively from clinical shorthand. Review and sign before finalizing.
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 border-t border-gray-100 bg-[#F7F6F3] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] px-4 rounded-xl border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancel / Discard
          </button>

          {generatedDraft && (
            <button
              type="button"
              onClick={handleAcceptAndInsert}
              className="min-h-[44px] px-5 rounded-xl bg-[#1769E0] hover:bg-[#155cc0] text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
            >
              <Check className="h-4 w-4" />
              <span>Accept & Insert into Note</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
