"use client";

import React, { useState } from "react";
import { Check, Copy, AlertTriangle, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/log/client";

export interface SingleRevealKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  keyDetails: {
    name: string;
    prefix: string;
    rawKey: string;
  } | null;
}

export function SingleRevealKeyModal({
  isOpen,
  onClose,
  keyDetails,
}: SingleRevealKeyModalProps) {
  const [copied, setCopied] = useState(false);

  if (!keyDetails) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(keyDetails.rawKey);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      reportClientError("apikeys.copy.failed", err);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="API Key Generated Successfully"
      description={`Authentication credential for "${keyDetails.name}".`}
      maxWidth="lg"
    >
      <div className="space-y-6">
        {/* Amber Security Warning Banner (06-UI-SPEC.md §1.3) */}
        <div className="bg-[#FFF5E5] border border-[#F3D39A] rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#9A5B00] shrink-0 mt-0.5" />
          <div className="text-sm text-[#9A5B00] leading-relaxed">
            <span className="font-semibold block mb-0.5">Save this secret key now:</span>
            For security reasons, this raw API key will never be displayed again. If you lose this key, you will need to generate a new one.
          </div>
        </div>

        {/* Secret Key Display Box */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
            Bearer Secret Key
          </label>
          <div className="relative font-mono text-xs font-semibold bg-gray-50 border border-gray-300 rounded-xl p-4 select-all overflow-x-auto break-all text-gray-900 tabular-nums">
            {keyDetails.rawKey}
          </div>
        </div>

        {/* Copy Button */}
        <div>
          <Button
            type="button"
            variant={copied ? "outline" : "secondary"}
            size="md"
            onClick={handleCopy}
            className={copied ? "border-emerald-300 bg-emerald-50 text-emerald-700 w-full" : "w-full"}
            startIcon={copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            aria-label="Copy raw API key to clipboard"
          >
            {copied ? "✓ Copied to Clipboard" : "Copy Secret Key"}
          </Button>
        </div>

        {/* Modal Footer */}
        <div className="pt-4 border-t border-gray-100 flex items-center justify-end">
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={onClose}
            className="w-full sm:w-auto"
          >
            Done, I Have Saved My Key
          </Button>
        </div>
      </div>
    </Modal>
  );
}
