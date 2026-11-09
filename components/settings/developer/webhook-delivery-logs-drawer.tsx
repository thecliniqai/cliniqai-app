"use client";

import React, { useState, useEffect } from "react";
import { X, ChevronDown, ChevronRight, FileText, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { WebhookSubscriptionItem, WebhookDeliveryLogItem } from "@/features/webhooks/actions";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export interface WebhookDeliveryLogsDrawerProps {
  open: boolean;
  onClose: () => void;
  subscription: WebhookSubscriptionItem | null;
  logs: WebhookDeliveryLogItem[];
  isLoading?: boolean;
}

type FilterType = "all" | "success" | "failed";

export function WebhookDeliveryLogsDrawer({
  open,
  onClose,
  subscription,
  logs,
  isLoading = false,
}: WebhookDeliveryLogsDrawerProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [open, onClose]);

  if (!open || !subscription) return null;

  const filteredLogs = logs.filter((log) => {
    if (filter === "success") return log.status === "delivered";
    if (filter === "failed") return log.status === "failed" || (log.responseStatus && log.responseStatus >= 400);
    return true;
  });

  const toggleExpand = (id: string) => {
    setExpandedLogId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Right Drawer (480px) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Webhook Delivery Logs Drawer"
        className="relative z-50 flex h-full w-full max-w-full sm:max-w-[480px] flex-col bg-white border-l border-[#E4E5E7] shadow-2xl overflow-hidden"
      >
        {/* Sticky Header (06-UI-SPEC.md §2.3) */}
        <div className="flex shrink-0 items-start justify-between border-b border-[#E4E5E7] p-6 bg-white">
          <div className="max-w-[380px]">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#EAF2FF] text-[#1769E0] flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 tracking-tight">
                Webhook Delivery Logs
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-gray-500 mt-1 truncate" title={subscription.endpointUrl}>
              Recent HTTP delivery attempts for {subscription.endpointUrl}
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Close delivery logs drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Bar */}
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/60 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              filter === "all"
                ? "bg-white text-gray-900 shadow-theme-xs border border-gray-200"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            All Deliveries ({logs.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("success")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              filter === "success"
                ? "bg-white text-emerald-700 shadow-theme-xs border border-emerald-200"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Success (2xx)
          </button>
          <button
            type="button"
            onClick={() => setFilter("failed")}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              filter === "failed"
                ? "bg-white text-rose-700 shadow-theme-xs border border-rose-200"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Failed (4xx/5xx)
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-gray-500">
              <span className="inline-block w-5 h-5 border-2 border-[#1769E0] border-t-transparent rounded-full animate-spin mr-2" />
              Loading delivery logs...
            </div>
          ) : filteredLogs.length === 0 ? (
            <EmptyState
              icon={<FileText className="w-6 h-6 text-gray-400" />}
              title="No Deliveries Recorded"
              description="Deliveries for this subscription will appear here with HTTP response codes, latency, and retry attempts."
              className="py-12"
            />
          ) : (
            filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const isDelivered = log.status === "delivered";
              const isFailed = log.status === "failed";
              const isPending = log.status === "pending";

              let formattedJson = log.payload;
              try {
                formattedJson = JSON.stringify(JSON.parse(log.payload), null, 2);
              } catch {
                // Keep raw string
              }

              return (
                <div
                  key={log.id}
                  className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-theme-xs hover:border-gray-300 transition-colors"
                >
                  {/* Summary Row */}
                  <div
                    onClick={() => toggleExpand(log.id)}
                    className="p-3.5 flex items-center justify-between gap-3 cursor-pointer select-none bg-white hover:bg-gray-50/50"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                      )}

                      <div className="min-w-0">
                        <span className="font-mono text-xs font-semibold text-gray-900 block truncate">
                          {log.eventType}
                        </span>
                        <span className="text-[11px] text-gray-400 tabular-nums">
                          {new Date(log.createdAt).toLocaleTimeString("en-IN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Latency */}
                      {typeof log.durationMs === "number" && (
                        <span className="font-mono text-xs text-gray-500 tabular-nums">
                          {log.durationMs}ms
                        </span>
                      )}

                      {/* Status Badge */}
                      {isDelivered && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{log.responseStatus || 200} OK</span>
                        </span>
                      )}

                      {isFailed && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                          <AlertCircle className="w-3 h-3" />
                          <span>{log.responseStatus || 500} Error</span>
                        </span>
                      )}

                      {isPending && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          <Clock className="w-3 h-3" />
                          <span>Retry {log.retryCount}/5</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Expanded Detail Accordion */}
                  {isExpanded && (
                    <div className="p-4 border-t border-gray-100 bg-gray-50/75 space-y-3 text-xs">
                      <div>
                        <div className="font-semibold text-gray-700 mb-1">Request Payload</div>
                        <pre className="font-mono text-[11px] bg-white border border-gray-200 rounded-lg p-3 text-gray-800 overflow-x-auto select-all max-h-48">
                          {formattedJson}
                        </pre>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-600 pt-1">
                        <div>
                          <span className="text-gray-400">Retry Attempt:</span>{" "}
                          <span className="font-semibold tabular-nums">{log.retryCount} of {log.maxRetries}</span>
                        </div>
                        <div>
                          <span className="text-gray-400">Response Code:</span>{" "}
                          <span className="font-semibold tabular-nums">{log.responseStatus || "None"}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-[#E4E5E7] bg-white shrink-0 flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
          >
            Close Delivery Logs
          </Button>
        </div>
      </div>
    </div>
  );
}
