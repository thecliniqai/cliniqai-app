"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { AlertCircle, Plus, RefreshCw } from "lucide-react";

export interface AppendReplaceModalProps {
  isOpen: boolean;
  sectionName: string;
  existingContent: string;
  newContent: string;
  onAppend: () => void;
  onReplace: () => void;
  onCancel: () => void;
}

export function AppendReplaceModal({
  isOpen,
  sectionName,
  existingContent,
  newContent,
  onAppend,
  onReplace,
  onCancel,
}: AppendReplaceModalProps) {
  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={`Existing Notes Detected in ${sectionName}`}
      maxWidth="md"
    >
      <div className="space-y-4 pt-1">
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#FFF5E5] border border-[#F3D39A] text-xs text-[#9A5B00]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#9A5B00]" />
          <span>
            This section already contains notes. You can append the new AI draft to the end of your existing text or overwrite it completely.
          </span>
        </div>

        {/* Comparison Previews */}
        <div className="space-y-2 text-xs">
          <div>
            <span className="font-semibold text-gray-700 block mb-1">
              Existing Text:
            </span>
            <div className="p-2.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-800 max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-[11px]">
              {existingContent || "(Empty)"}
            </div>
          </div>

          <div>
            <span className="font-semibold text-[#1769E0] block mb-1">
              New AI Draft to Insert:
            </span>
            <div className="p-2.5 rounded-lg border border-[#C7D2FE] bg-[#EEF2FF]/40 text-[#17181A] max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-[11px]">
              {newContent || "(Empty)"}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto px-3.5 py-2 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onReplace}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-xs font-semibold text-white transition-colors cursor-pointer shadow-2xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Replace Existing Notes
          </button>

          <button
            type="button"
            onClick={onAppend}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1769E0] hover:bg-[#0F5AB8] text-xs font-semibold text-white transition-colors cursor-pointer shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Append to Existing Notes
          </button>
        </div>
      </div>
    </Modal>
  );
}
