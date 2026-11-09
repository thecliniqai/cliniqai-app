"use client";

import React from "react";
import { ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ApiKeyItem } from "@/features/api-keys/actions";

export interface RevokeKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (keyId: string) => Promise<void>;
  apiKey: ApiKeyItem | null;
  isLoading?: boolean;
}

export function RevokeKeyModal({
  isOpen,
  onClose,
  onConfirm,
  apiKey,
  isLoading = false,
}: RevokeKeyModalProps) {
  if (!apiKey) return null;

  const handleConfirm = async () => {
    await onConfirm(apiKey.id);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isLoading ? () => {} : onClose}
      maxWidth="md"
    >
      <div className="space-y-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-[#B42318] border border-rose-200 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900 tracking-tight">
              Revoke API Key
            </h3>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              Are you sure you want to revoke key <span className="font-semibold text-gray-900">&ldquo;{apiKey.name}&rdquo;</span> (<code className="font-mono text-xs px-1.5 py-0.5 rounded bg-gray-100">{apiKey.keyPrefix}••••</code>)? Any external services, AI voice agents, or partner EHR integrations using this key will immediately lose access. This action cannot be undone.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={isLoading}
          >
            Keep API Key
          </Button>

          <Button
            type="button"
            variant="danger"
            size="md"
            loading={isLoading}
            disabled={isLoading}
            onClick={handleConfirm}
          >
            Revoke API Key
          </Button>
        </div>
      </div>
    </Modal>
  );
}
