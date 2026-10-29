"use client";

import React, { useState, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import {
  Sparkles,
  RotateCcw,
  X,
  ArrowUp,
  Loader2,
  Calendar,
  Users,
  HelpCircle,
} from "lucide-react";
import { ChatBubble } from "./chat-bubble";
import { ActionPreviewCard } from "./action-preview-card";
import { PatientDisambiguationCard, DisambiguationCandidate } from "./patient-disambiguation-card";
import { ConflictRecoveryCard } from "./conflict-recovery-card";
import { QuickRegistrationCard } from "./quick-registration-card";
import { bookAppointment } from "@/features/visits/scheduling";
import { cn } from "@/lib/utils";

export interface OperationsCopilotDrawerProps {
  open: boolean;
  onClose: () => void;
}

const SESSION_STORAGE_KEY = "clinicos_copilot_history";

export function OperationsCopilotDrawer({
  open,
  onClose,
}: OperationsCopilotDrawerProps) {
  const [conflictState, setConflictState] = useState<{
    toolCallId: string;
    details: any;
    alternativeSlots: string[];
  } | null>(null);

  const [showQuickRegister, setShowQuickRegister] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    setMessages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    isLoading,
    addToolResult,
    stop,
  } = useChat({
    api: "/api/ai/operations-copilot",
    body: {
      screenContext: {
        screen: typeof window !== "undefined" ? window.location.pathname : "",
      },
    },
    maxSteps: 3,
  });

  // Load from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch {
      // Ignore sessionStorage read errors
    }
  }, [setMessages]);

  // Save to sessionStorage when messages update
  useEffect(() => {
    if (messages.length > 0) {
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(messages));
      } catch {
        // Ignore write errors
      }
    }
  }, [messages]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  // ESC key listener to close drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleStartNewChat = () => {
    stop();
    setMessages([]);
    setConflictState(null);
    setShowQuickRegister(false);
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore
    }
  };

  const handleStarterPrompt = (promptText: string) => {
    setInput(promptText);
  };

  const handleConfirmBooking = async (toolCallId: string, details: any) => {
    try {
      const scheduledAt = `${details.date}T${details.start_time}:00`;
      const res = await bookAppointment({
        patient_id: details.patient_id,
        doctor_id: details.doctor_id,
        scheduled_at: scheduledAt,
        estimated_duration_minutes: 15,
        reason_for_visit: "Booked via Operations Copilot",
      });

      if (!res.success) {
        if (res.conflict) {
          setConflictState({
            toolCallId,
            details,
            alternativeSlots: ["11:00 AM", "11:30 AM", "04:30 PM"],
          });
          return;
        }
        throw new Error(res.error || "Failed to book appointment");
      }

      setConflictState(null);
      addToolResult({
        toolCallId,
        result: {
          status: "confirmed",
          visit_id: res.visitId,
          channel: "operations_copilot",
        },
      });
    } catch (err: any) {
      console.error("[OperationsCopilotDrawer] Booking failed:", err);
      throw err;
    }
  };

  const handleSelectAlternativeSlot = async (slotTime: string) => {
    if (!conflictState) return;
    const { toolCallId, details } = conflictState;

    // Convert e.g. "11:00 AM" to "11:00"
    const timeMatch = slotTime.match(/(\d{1,2}):(\d{2})/);
    const militaryHour = slotTime.includes("PM") && timeMatch
      ? (parseInt(timeMatch[1], 10) % 12) + 12
      : timeMatch ? parseInt(timeMatch[1], 10) : 10;
    const cleanTime = `${militaryHour.toString().padStart(2, "0")}:${timeMatch ? timeMatch[2] : "00"}`;

    const updatedDetails = {
      ...details,
      start_time: cleanTime,
    };

    setConflictState(null);
    await handleConfirmBooking(toolCallId, updatedDetails);
  };

  const handleSelectPatientMatch = (candidate: DisambiguationCandidate) => {
    setInput(`Selected patient ${candidate.full_name} (${candidate.phone || candidate.id}). Please check availability or schedule an appointment.`);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#17181A]/20 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Operations Copilot"
        className="relative z-50 flex h-full w-full max-w-full sm:max-w-[420px] flex-col bg-white border-l border-[#E4E5E7] shadow-2xl transition-transform duration-200 ease-out"
      >
        {/* Sticky Header */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#E4E5E7] px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EAF2FF] text-[#1769E0]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#17181A]">
                Operations Copilot
              </h2>
              <span className="text-[11px] text-gray-500 block -mt-0.5">
                ✦ Powered by CliniQ AI
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleStartNewChat}
              title="Start New Chat"
              className="flex h-8 items-center gap-1 px-2 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">New Chat</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors cursor-pointer"
              aria-label="Close drawer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Message List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {messages.length === 0 ? (
            /* Zero-State */
            <div className="flex h-full flex-col items-center justify-center text-center px-4 py-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EAF2FF] text-[#1769E0] mb-3 shadow-2xs">
                <Sparkles className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-semibold text-[#17181A] mb-1">
                No Conversation History
              </h3>
              <p className="text-xs text-gray-500 max-w-xs mb-6 leading-relaxed">
                Ask questions about clinic workflows, search patients, inspect doctor availability, or stage appointment bookings.
              </p>

              {/* Starter Chips */}
              <div className="w-full space-y-2 text-left">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 block px-1">
                  Suggested Actions
                </span>

                <button
                  type="button"
                  onClick={() => handleStarterPrompt("Show me today's queue status")}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-[#E4E5E7] bg-white text-xs font-medium text-[#17181A] hover:border-[#1769E0] hover:bg-[#EAF2FF]/40 transition-colors cursor-pointer shadow-2xs text-left"
                >
                  <Users className="w-4 h-4 text-[#1769E0] shrink-0" />
                  <span>Today&apos;s Queue Status</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleStarterPrompt("Check doctor availability for today")}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-[#E4E5E7] bg-white text-xs font-medium text-[#17181A] hover:border-[#1769E0] hover:bg-[#EAF2FF]/40 transition-colors cursor-pointer shadow-2xs text-left"
                >
                  <Calendar className="w-4 h-4 text-[#1769E0] shrink-0" />
                  <span>Check Doctor Availability</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleStarterPrompt("How do I configure billing and payments in ClinicOS?")}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-[#E4E5E7] bg-white text-xs font-medium text-[#17181A] hover:border-[#1769E0] hover:bg-[#EAF2FF]/40 transition-colors cursor-pointer shadow-2xs text-left"
                >
                  <HelpCircle className="w-4 h-4 text-[#1769E0] shrink-0" />
                  <span>How do I configure billing?</span>
                </button>
              </div>
            </div>
          ) : (
            /* Render Messages & Tool Parts */
            messages.map((m) => (
              <div key={m.id} className="space-y-2">
                {m.content && (
                  <ChatBubble role={m.role as any} content={m.content} />
                )}

                {/* Render Tool Invocations */}
                {m.toolInvocations?.map((toolInvocation) => {
                  const { toolCallId, toolName, args, state } = toolInvocation;
                  const result = (toolInvocation as any).result;

                  if (toolName === "request_appointment_booking") {
                    return (
                      <div key={toolCallId}>
                        <ActionPreviewCard
                          actionType="book_appointment"
                          details={args}
                          initialStatus={result?.status === "confirmed" ? "confirmed" : "preview"}
                          onConfirm={() => handleConfirmBooking(toolCallId, args)}
                          onCancel={() => {
                            addToolResult({
                              toolCallId,
                              result: { status: "cancelled_by_user" },
                            });
                          }}
                        />

                        {conflictState && conflictState.toolCallId === toolCallId && (
                          <ConflictRecoveryCard
                            doctorName={args.doctor_name}
                            date={args.date}
                            alternativeSlots={conflictState.alternativeSlots}
                            onSelectSlot={handleSelectAlternativeSlot}
                          />
                        )}
                      </div>
                    );
                  }

                  if (toolName === "reschedule_appointment") {
                    return (
                      <ActionPreviewCard
                        key={toolCallId}
                        actionType="reschedule_appointment"
                        details={args}
                        initialStatus={result?.status === "confirmed" ? "confirmed" : "preview"}
                        onConfirm={() => {
                          addToolResult({
                            toolCallId,
                            result: { status: "confirmed" },
                          });
                        }}
                        onCancel={() => {
                          addToolResult({
                            toolCallId,
                            result: { status: "cancelled_by_user" },
                          });
                        }}
                      />
                    );
                  }

                  if (toolName === "cancel_appointment") {
                    return (
                      <ActionPreviewCard
                        key={toolCallId}
                        actionType="cancel_appointment"
                        details={args}
                        initialStatus={result?.status === "cancelled" ? "cancelled" : "preview"}
                        onConfirm={() => {
                          addToolResult({
                            toolCallId,
                            result: { status: "cancelled" },
                          });
                        }}
                        onCancel={() => {
                          addToolResult({
                            toolCallId,
                            result: { status: "retained" },
                          });
                        }}
                      />
                    );
                  }

                  if (
                    toolName === "search_patients" &&
                    state === "result" &&
                    result?.patients &&
                    result.patients.length > 1
                  ) {
                    return (
                      <PatientDisambiguationCard
                        key={toolCallId}
                        query={args.query}
                        candidates={result.patients}
                        onSelect={handleSelectPatientMatch}
                      />
                    );
                  }

                  return null;
                })}
              </div>
            ))
          )}

          {showQuickRegister && (
            <QuickRegistrationCard
              onRegistered={(patient) => {
                setShowQuickRegister(false);
                setInput(`Registered patient ${patient.full_name} (${patient.phone}). Please stage an appointment booking.`);
              }}
              onCancel={() => setShowQuickRegister(false)}
            />
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1769E0]" />
              <span>CliniQ Copilot is thinking...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Sticky Input Footer */}
        <div className="shrink-0 border-t border-[#E4E5E7] bg-white p-4">
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 rounded-xl border border-[#E4E5E7] bg-white p-1.5 focus-within:border-[#1769E0] focus-within:ring-1 focus-within:ring-[#1769E0] transition-all shadow-2xs"
          >
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              disabled={isLoading}
              placeholder="Ask Copilot or type an action..."
              className="flex-1 bg-transparent px-3 py-1.5 text-xs text-[#17181A] placeholder:text-gray-400 outline-none disabled:opacity-50"
            />

            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1769E0] text-white hover:bg-[#0F5AB8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
