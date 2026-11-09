"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export interface CreateApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
  isLoading?: boolean;
}

export function CreateApiKeyModal({
  isOpen,
  onClose,
  onSubmit,
  isLoading = false,
}: CreateApiKeyModalProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) {
      setError("Please enter a descriptive label for the API key.");
      return;
    }
    setError(null);
    try {
      await onSubmit(clean);
      setName("");
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to generate API key. Verify network connection and try again."
      );
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    setName("");
    setError(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create API Key"
      description="Enter a descriptive label to identify which application or service will use this key."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <Field
          label="Key Name"
          htmlFor="api-key-name"
          required
          error={error || undefined}
          helpText="Example: External AI Voice Receptionist, Partner Diagnostic Sync, or Local EHR Bridge."
        >
          <Input
            id="api-key-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="e.g. AI Voice Agent Integration"
            disabled={isLoading}
            autoFocus
          />
        </Field>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleClose}
            disabled={isLoading}
          >
            Discard Key
          </Button>

          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={isLoading}
            disabled={isLoading}
          >
            Generate API Key
          </Button>
        </div>
      </form>
    </Modal>
  );
}
