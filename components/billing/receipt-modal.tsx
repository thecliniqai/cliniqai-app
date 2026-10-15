"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Printer, Download, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getInvoiceReceiptPdfSignedUrl } from "@/features/billing/actions";

export interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string;
}

export function ReceiptModal({ isOpen, onClose, invoiceId }: ReceiptModalProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string>("");
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

  // Fetch or regenerate signed receipt PDF URL whenever invoiceId changes
  useEffect(() => {
    if (!isOpen || !invoiceId) return;

    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);

      try {
        const res = await getInvoiceReceiptPdfSignedUrl(invoiceId);
        if (cancelled) return;

        if (res.success) {
          setSignedUrl(res.signedUrl);
          setInvoiceNumber(res.invoiceNumber);
        } else {
          // Fallback to route handler URL
          setSignedUrl(`/api/invoices/${invoiceId}/receipt-pdf`);
          setInvoiceNumber(invoiceId.slice(0, 8));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unexpected error compiling receipt PDF.");
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
  }, [isOpen, invoiceId]);

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
    const url = signedUrl || `/api/invoices/${invoiceId}/receipt-pdf?download=true`;
    const downloadLink = document.createElement("a");
    downloadLink.href = url.includes("?") ? `${url}&download=true` : `${url}?download=true`;
    downloadLink.download = `Receipt-${invoiceNumber || invoiceId.slice(0, 8)}.pdf`;
    downloadLink.target = "_blank";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-hidden"
    >
      {/* Accessible Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div className="relative z-10 flex flex-col w-full max-w-4xl h-[90vh] max-h-[850px] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50/75">
          <div className="flex items-center gap-3">
            <div>
              <h2
                id="receipt-preview-title"
                className="text-base font-semibold text-slate-900 tracking-tight"
              >
                Payment Receipt Preview
              </h2>
              <p className="text-xs text-slate-500">
                {invoiceNumber ? `Invoice #${invoiceNumber}` : "Official Clinic Receipt"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrint}
              disabled={loading || !signedUrl}
              className="gap-1.5 h-9 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50"
            >
              <Printer className="w-3.5 h-3.5 text-slate-600" />
              <span>Print</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={loading || !signedUrl}
              className="gap-1.5 h-9 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5 text-slate-600" />
              <span>Download PDF</span>
            </Button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body / PDF Viewer Frame */}
        <div className="relative flex-1 w-full bg-slate-100 flex items-center justify-center overflow-hidden">
          {loading && (
            <div className="flex flex-col items-center gap-2 p-6 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              <p className="text-sm font-medium">Generating branded payment receipt...</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center max-w-md p-6 bg-white rounded-lg border border-red-200 text-center shadow-sm">
              <AlertCircle className="w-10 h-10 text-red-500 mb-2" />
              <h3 className="text-sm font-semibold text-slate-900">Failed to load receipt</h3>
              <p className="text-xs text-slate-500 mt-1 mb-4">{error}</p>
              <Button size="sm" variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          )}

          {!loading && !error && signedUrl && (
            <iframe
              ref={iframeRef}
              src={signedUrl}
              title={`Receipt - ${invoiceNumber}`}
              className="w-full h-full border-0 bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}
