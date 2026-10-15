"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Printer, Download, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPrescriptionPdfSignedUrl } from "@/features/prescriptions/actions";

export interface PdfPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  prescriptionId: string;
  visitId: string;
  initialLetterheadMode?: "blank_paper" | "preprinted_letterhead";
  version?: number;
}

export function PdfPreviewModal({
  isOpen,
  onClose,
  prescriptionId,
  visitId,
  initialLetterheadMode = "blank_paper",
  version = 1,
}: PdfPreviewModalProps) {
  const [letterheadMode, setLetterheadMode] = useState<"blank_paper" | "preprinted_letterhead">(
    initialLetterheadMode
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Keyboard navigation: Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  // Fetch or regenerate signed PDF URL whenever prescriptionId or letterheadMode changes
  useEffect(() => {
    if (!isOpen || !prescriptionId) return;

    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);

      try {
        const res = await getPrescriptionPdfSignedUrl(prescriptionId, letterheadMode);
        if (cancelled) return;

        if (res.success) {
          setSignedUrl(res.signedUrl);
        } else {
          setError(res.error || "Failed to compile prescription PDF.");
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unexpected error compiling PDF.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      cancelled = true;
    };
  }, [isOpen, prescriptionId, letterheadMode]);

  if (!isOpen) return null;

  const handlePrint = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.focus();
      iframeRef.current.contentWindow.print();
    } else if (signedUrl) {
      window.open(signedUrl, "_blank");
    }
  };

  const handleDownload = () => {
    if (signedUrl) {
      const downloadLink = document.createElement("a");
      downloadLink.href = signedUrl;
      downloadLink.download = `Prescription-v${version}-${visitId.slice(0, 8)}.pdf`;
      downloadLink.target = "_blank";
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden"
    >
      {/* Accessible Backdrop */}
      <div
        className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Main Modal Dialog */}
      <div className="relative w-full max-w-4xl h-[92vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-gray-200 z-10 overflow-hidden transform transition-all">
        {/* Header with Title, Mode Switcher, and Close Button */}
        <div className="px-6 py-4 border-b border-gray-200 bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
          <div>
            <h2 id="pdf-preview-title" className="text-base font-semibold text-gray-900">
              Prescription Preview (v{version})
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Review A4 print layout and stationery margins before issuing to patient
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Dual Letterhead Mode Segmented Switcher */}
            <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200">
              <button
                type="button"
                onClick={() => setLetterheadMode("blank_paper")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  letterheadMode === "blank_paper"
                    ? "bg-white text-gray-900 shadow-theme-xs font-semibold"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Print on Blank Paper
              </button>
              <button
                type="button"
                onClick={() => setLetterheadMode("preprinted_letterhead")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  letterheadMode === "preprinted_letterhead"
                    ? "bg-white text-gray-900 shadow-theme-xs font-semibold"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Print on Pre-Printed Letterhead
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
              aria-label="Close prescription preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body / PDF Viewer Frame */}
        <div className="flex-1 bg-gray-100 p-4 overflow-hidden flex items-center justify-center relative">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin text-[#1769E0]" />
              <p className="text-sm font-medium">Compiling prescription PDF...</p>
              <p className="text-xs text-gray-400">Rendering high-resolution A4 vectors</p>
            </div>
          )}

          {error && !loading && (
            <div className="max-w-md p-6 bg-white rounded-xl border border-red-200 shadow-sm text-center">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Failed to load preview</h3>
              <p className="text-xs text-gray-600 mb-4">{error}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLetterheadMode((prev) => prev)}
              >
                Retry PDF Generation
              </Button>
            </div>
          )}

          {!loading && !error && signedUrl && (
            <div className="w-full h-full flex flex-col items-center">
              <iframe
                ref={iframeRef}
                src={signedUrl}
                title="Prescription PDF Preview"
                className="w-full h-full rounded-xl bg-white shadow-theme-md border border-gray-200"
              />
            </div>
          )}
        </div>

        {/* Modal Action Footer */}
        <div className="px-6 py-3.5 border-t border-gray-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <p className="text-xs text-gray-500 text-center sm:text-left">
            Unable to display PDF directly in your browser?{" "}
            {signedUrl && (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#1769E0] font-medium hover:underline inline-flex items-center gap-1"
              >
                Open in new tab
              </a>
            )}
          </p>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="min-h-[44px]"
            >
              Close Preview
            </Button>

            <Button
              type="button"
              variant="secondary"
              startIcon={<Printer className="w-4 h-4" />}
              onClick={handlePrint}
              disabled={loading || !signedUrl}
              className="min-h-[44px]"
            >
              Print Prescription
            </Button>

            <Button
              type="button"
              variant="primary"
              startIcon={<Download className="w-4 h-4" />}
              onClick={handleDownload}
              disabled={loading || !signedUrl}
              className="min-h-[44px]"
            >
              Download PDF
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
