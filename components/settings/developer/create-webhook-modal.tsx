"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { ALLOWED_WEBHOOK_EVENTS } from "@/features/webhooks/constants";

export interface CreateWebhookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { endpointUrl: string; eventTypes: string[] }) => Promise<void>;
  isLoading?: boolean;
}

const EVENT_DESCRIPTIONS: Record<string, string> = {
  "appointment.booked": "Fired when a patient appointment is scheduled or confirmed.",
  "appointment.cancelled": "Fired when an appointment is cancelled and the slot is released.",
  "appointment.rescheduled": "Fired when appointment date or time is modified.",
  "visit.completed": "Fired when a doctor completes and signs off a consultation encounter.",
  "lab_result.ready": "Fired when a diagnostic lab result or document is uploaded.",
  "prescription.issued": "Fired when an official e-prescription is finalized.",
};

export function CreateWebhookModal({
  isOpen,
  onClose,
  onSubmit,
  isLoading = false,
}: CreateWebhookModalProps) {
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([...ALLOWED_WEBHOOK_EVENTS]);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);

  const handleUrlChange = (value: string) => {
    setUrl(value);
    if (!value.trim()) {
      setUrlError(null);
      return;
    }
    if (!value.startsWith("https://")) {
      setUrlError("Destinations must use the secure HTTPS protocol (e.g. https://api.partner.com/events).");
    } else {
      setUrlError(null);
    }
  };

  const handleToggleEvent = (eventName: string) => {
    setSelectedEvents((prev) => {
      const next = prev.includes(eventName)
        ? prev.filter((e) => e !== eventName)
        : [...prev, eventName];
      if (next.length > 0) setEventError(null);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedEvents.length === ALLOWED_WEBHOOK_EVENTS.length) {
      setSelectedEvents([]);
      setEventError("Please select at least one webhook event.");
    } else {
      setSelectedEvents([...ALLOWED_WEBHOOK_EVENTS]);
      setEventError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = url.trim();

    if (!cleanUrl) {
      setUrlError("Endpoint URL is required.");
      return;
    }

    if (!cleanUrl.startsWith("https://")) {
      setUrlError("Invalid endpoint URL. Destinations must use the secure HTTPS protocol.");
      return;
    }

    if (selectedEvents.length === 0) {
      setEventError("Please select at least one webhook event to subscribe.");
      return;
    }

    try {
      await onSubmit({ endpointUrl: cleanUrl, eventTypes: selectedEvents });
      setUrl("");
      setSelectedEvents([...ALLOWED_WEBHOOK_EVENTS]);
    } catch (err: unknown) {
      setUrlError(err instanceof Error ? err.message : "Failed to register webhook endpoint.");
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    setUrl("");
    setSelectedEvents([...ALLOWED_WEBHOOK_EVENTS]);
    setUrlError(null);
    setEventError(null);
    onClose();
  };

  const allSelected = selectedEvents.length === ALLOWED_WEBHOOK_EVENTS.length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Webhook Endpoint"
      description="Configure an HTTPS URL to receive automated clinical lifecycle webhook events."
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <Field
          label="Endpoint URL"
          htmlFor="webhook-endpoint-url"
          required
          error={urlError || undefined}
          helpText="Must begin with https://. Payloads are signed with your subscription secret."
        >
          <Input
            id="webhook-endpoint-url"
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="https://api.example.com/webhooks"
            disabled={isLoading}
            autoFocus
          />
        </Field>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Events to Send <span className="text-rose-500">*</span>
            </label>
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs font-medium text-accent hover:underline cursor-pointer"
            >
              {allSelected ? "Deselect All" : "Select All"}
            </button>
          </div>

          {eventError && (
            <p className="text-xs text-danger-fg">{eventError}</p>
          )}

          <div className="space-y-2 border border-gray-200 rounded-xl p-3 bg-gray-50/50 max-h-60 overflow-y-auto">
            {ALLOWED_WEBHOOK_EVENTS.map((event) => {
              const checked = selectedEvents.includes(event);
              return (
                <label
                  key={event}
                  className="flex items-start gap-3 p-2 rounded-lg hover:bg-white transition-colors cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleToggleEvent(event)}
                    className="mt-0.5 rounded border-gray-300 text-accent focus:ring-ring"
                  />
                  <div className="text-xs leading-relaxed">
                    <span className="font-mono font-semibold text-gray-900 block">
                      {event}
                    </span>
                    <span className="text-gray-500">
                      {EVENT_DESCRIPTIONS[event] || event}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleClose}
            disabled={isLoading}
          >
            Discard Endpoint
          </Button>

          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={isLoading}
            disabled={isLoading}
          >
            Save Endpoint Subscription
          </Button>
        </div>
      </form>
    </Modal>
  );
}
