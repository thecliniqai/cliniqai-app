"use client";

import React, { useState } from "react";
import {
  Webhook,
  Plus,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  FileText,
  Trash2,
} from "lucide-react";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { WebhookSubscriptionItem } from "@/features/webhooks/actions";
import { reportClientError } from "@/lib/log/client";

export interface WebhookSubscriptionListProps {
  subscriptions: WebhookSubscriptionItem[];
  onAddEndpoint: () => void;
  onDeleteSubscription: (sub: WebhookSubscriptionItem) => void;
  onViewLogs: (sub: WebhookSubscriptionItem) => void;
  /** V2-04 04-03b (R-26): the ping is queued, never sent from the request; the result appears in the delivery logs. */
  onTestPing: (subId: string) => Promise<{ success: boolean; queued?: boolean; error?: string }>;
}

export function WebhookSubscriptionList({
  subscriptions,
  onAddEndpoint,
  onDeleteSubscription,
  onViewLogs,
  onTestPing,
}: WebhookSubscriptionListProps) {
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [copiedSecretId, setCopiedSecretId] = useState<string | null>(null);
  const [pingingId, setPingingId] = useState<string | null>(null);
  const [pingResults, setPingResults] = useState<Record<string, { queued: boolean; error?: string }>>({});

  const toggleSecretReveal = (id: string) => {
    setRevealedSecrets((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copySecret = async (id: string, secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopiedSecretId(id);
      setTimeout(() => setCopiedSecretId(null), 2000);
    } catch (err) {
      reportClientError("webhooks.secret_copy.failed", err);
    }
  };

  const handlePing = async (id: string) => {
    setPingingId(id);
    try {
      const res = await onTestPing(id);
      setPingResults((prev) => ({
        ...prev,
        [id]: { queued: res.success && res.queued === true, error: res.success ? undefined : res.error },
      }));
    } finally {
      setPingingId(null);
    }
  };

  return (
    <div id="webhook-subscriptions" className="rounded-xl border border-[#E4E5E7] bg-white shadow-theme-xs overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-[#E4E5E7] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#EAF2FF] text-[#1769E0] flex items-center justify-center shrink-0">
              <Webhook className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 tracking-tight">
              Webhook Subscriptions
            </h2>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Receive real-time signed HTTP POST payloads when clinical lifecycle events occur.
          </p>
        </div>

        <Button
          onClick={onAddEndpoint}
          variant="secondary"
          size="md"
          className="shrink-0 font-medium"
          startIcon={<Plus className="w-4 h-4" />}
        >
          Add Webhook Endpoint
        </Button>
      </div>

      {/* Body */}
      {subscriptions.length === 0 ? (
        <EmptyState
          icon={<Webhook className="w-6 h-6 text-gray-400" />}
          title="No Webhook Subscriptions"
          description="Subscribe an HTTPS endpoint to receive real-time notifications for appointment bookings, completed visits, and lab reports."
          action={
            <Button
              onClick={onAddEndpoint}
              variant="secondary"
              size="md"
              startIcon={<Plus className="w-4 h-4" />}
            >
              Add Webhook Endpoint
            </Button>
          }
        />
      ) : (
        <TableContainer className="rounded-none border-0 shadow-none">
          <Table>
            <TableHeader className="bg-[#F1F2F4]/60">
              <TableRow>
                <TableHead className="text-xs font-semibold text-gray-600">Endpoint URL</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600">Subscribed Events</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600">Signing Secret</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600">Status</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((sub) => {
                const isRevealed = Boolean(revealedSecrets[sub.id]);
                const isCopied = copiedSecretId === sub.id;
                const isPinging = pingingId === sub.id;
                const pingResult = pingResults[sub.id];

                return (
                  <React.Fragment key={sub.id}>
                  {/* The separator between subscriptions is drawn by the status row below (empty and 0 px high until a ping). */}
                  <TableRow className="border-b-0">
                    {/* Endpoint URL with Lock Icon */}
                    <TableCell className="max-w-xs">
                      <div className="flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span
                          className="font-medium text-sm text-gray-900 truncate"
                          title={sub.endpointUrl}
                        >
                          {sub.endpointUrl}
                        </span>
                      </div>
                    </TableCell>

                    {/* Event Pills */}
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-sm">
                        {sub.eventTypes.map((evt) => (
                          <span
                            key={evt}
                            className="inline-block px-2 py-0.5 text-[11px] font-mono font-medium rounded bg-gray-100 text-gray-700 border border-gray-200"
                          >
                            {evt}
                          </span>
                        ))}
                      </div>
                    </TableCell>

                    {/* Signing Secret */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-gray-700 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                          {isRevealed ? sub.signingSecret : `${sub.signingSecret.slice(0, 10)}••••••••••••`}
                        </span>
                        <button
                          onClick={() => toggleSecretReveal(sub.id)}
                          className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors cursor-pointer"
                          aria-label={isRevealed ? "Hide signing secret" : "Reveal signing secret"}
                          title={isRevealed ? "Hide secret" : "Reveal secret"}
                        >
                          {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => copySecret(sub.id, sub.signingSecret)}
                          className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors cursor-pointer"
                          aria-label="Copy signing secret to clipboard"
                          title="Copy secret"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      {sub.isActive ? (
                        <Badge color="success" size="sm">
                          Active
                        </Badge>
                      ) : (
                        <Badge color="gray" size="sm">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Ping button (04-03b, R-26: the ping is queued; its status line is the row below) */}
                        <button
                          onClick={() => handlePing(sub.id)}
                          disabled={isPinging}
                          className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          aria-label={`Send test ping to ${sub.endpointUrl}`}
                          aria-describedby={`ping-status-${sub.id}`}
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? "animate-spin text-[#1769E0]" : ""}`} />
                          <span>{isPinging ? "Queuing..." : "Send Test Ping"}</span>
                        </button>

                        {/* View Logs button */}
                        <button
                          onClick={() => onViewLogs(sub)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#1769E0] hover:bg-[#EAF2FF] px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                          aria-label="View delivery logs"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>View Logs</span>
                        </button>

                        {/* Delete button */}
                        <button
                          onClick={() => onDeleteSubscription(sub)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          aria-label="Delete webhook subscription"
                          title="Delete Webhook"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {/* Test ping status line: a polite live region, rendered before any result so the change is announced;
                      it takes no space until there is something to say. */}
                  <tr className="border-b border-gray-100 last:border-b-0">
                    <td colSpan={5} className={pingResult ? "px-4 pb-3 pt-0 text-left" : "p-0"}>
                      <p
                        id={`ping-status-${sub.id}`}
                        role="status"
                        aria-live="polite"
                        className={`max-w-[17rem] text-xs leading-snug sm:max-w-none ${pingResult ? "" : "sr-only"} ${
                          pingResult?.queued ? "text-gray-600" : "text-rose-700"
                        }`}
                      >
                        {pingResult
                          ? pingResult.queued
                            ? "Test ping queued. The result appears in Delivery logs within about a minute."
                            : pingResult.error || "Test ping could not be queued."
                          : null}
                      </p>
                    </td>
                  </tr>
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}
