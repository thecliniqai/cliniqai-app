import React from "react";
import { isPlausibleToken, REPORT_LINK_KINDS, resolveShareToken } from "@/features/sharing/public-links";
import { signSharedObject } from "@/features/sharing/system";
import { ShieldCheck, Download, AlertCircle, FileText, Calendar, User, HardDrive } from "lucide-react";

interface ReportViewerPageProps {
  searchParams: Promise<{ token?: string }>;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default async function PublicReportViewerPage({ searchParams }: ReportViewerPageProps) {
  const { token } = await searchParams;

  if (!isPlausibleToken(token)) {
    return (
      <div className="min-h-screen bg-sunken flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-border p-8 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-danger-bg text-danger-fg flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-fg mb-2">Invalid Document Link</h1>
          <p className="text-sm text-fg-secondary mb-6">
            This link is missing or incomplete. Please verify the URL or contact your clinic for a new link.
          </p>
        </div>
      </div>
    );
  }

  // Token-scoped resolution (P0-04, ADR-0005 D3): patient_document tokens only, bound to the token's tenant.
  const resolved = await resolveShareToken(token, REPORT_LINK_KINDS);
  const signed = resolved.status === "ok" ? await signSharedObject(token, REPORT_LINK_KINDS) : null;
  const clinicPhone = resolved.status === "revoked" || resolved.status === "expired" ? resolved.clinic?.phone : null;

  if (resolved.status !== "ok" || !signed) {
    return (
      <div className="min-h-screen bg-sunken flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-border p-8 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-danger-bg text-danger-fg flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-fg mb-2">Link Expired or Invalid</h1>
          <p className="text-sm text-fg-secondary mb-6">
            This document link has expired or has been revoked for your security. Please contact your clinic to request a fresh link.
          </p>
          {clinicPhone && (
            <p className="text-xs text-fg-muted">
              Clinic Contact: <span className="font-semibold">{clinicPhone}</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  const doc = {
    ...resolved.document,
    file_size_bytes: Number(resolved.document.file_size_bytes ?? 0),
    is_abnormal: Boolean(resolved.document.is_abnormal),
    notes: resolved.document.notes ?? null,
  };
  const clinic = {
    name: doc.clinic?.name || "Clinic",
    phone: doc.clinic?.phone ?? null,
    address: doc.clinic?.address ?? null,
    logo_url: doc.clinic?.logo_url ?? null,
  };
  const patientName = doc.patient_name || "Patient";
  const signedUrl = signed.signedUrl;

  const isPdf = doc.mime_type === "application/pdf" || doc.original_filename.toLowerCase().endsWith(".pdf");
  const isImage = doc.mime_type.startsWith("image/");
  const formattedExpiry = new Date(doc.expires_at).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-sunken text-fg">
      {/* Top Clinic Branding Bar */}
      <header className="bg-white border-b border-border sticky top-0 z-20 shadow-xs">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base sm:text-lg font-bold text-fg">{clinic.name}</h1>
            {clinic.address && <p className="text-xs text-fg-muted">{clinic.address}</p>}
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success-bg border border-success-border text-success-fg text-xs font-medium">
            <ShieldCheck className="w-4 h-4 text-success-fg" />
            <span>Verified Record</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Document Metadata Card */}
        <div className="bg-white rounded-xl border border-border p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold text-fg">{doc.title}</h2>
                {doc.is_abnormal && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-bg text-danger-fg border border-danger-border">
                    Abnormal Findings
                  </span>
                )}
              </div>
              <p className="text-xs text-fg-muted">Original file: {doc.original_filename}</p>
            </div>
            <a
              href={signedUrl}
              download={doc.original_filename}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-accent hover:bg-accent-hover active:bg-accent-pressed text-white text-sm font-semibold transition-colors min-h-[44px] shadow-xs"
            >
              <Download className="w-4 h-4" />
              <span>Download Report</span>
            </a>
          </div>

          {/* Quick Details Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 text-xs">
            <div className="flex items-center gap-2 text-fg-secondary">
              <User className="w-4 h-4 text-fg-subtle" />
              <div>
                <p className="text-[10px] text-fg-muted uppercase tracking-wider">Patient</p>
                <p className="font-medium text-fg">{patientName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-fg-secondary">
              <Calendar className="w-4 h-4 text-fg-subtle" />
              <div>
                <p className="text-[10px] text-fg-muted uppercase tracking-wider">Report Date</p>
                <p className="font-medium text-fg">{doc.report_date}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-fg-secondary">
              <FileText className="w-4 h-4 text-fg-subtle" />
              <div>
                <p className="text-[10px] text-fg-muted uppercase tracking-wider">Type</p>
                <p className="font-medium text-fg capitalize">{doc.document_type.replace(/_/g, " ")}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-fg-secondary">
              <HardDrive className="w-4 h-4 text-fg-subtle" />
              <div>
                <p className="text-[10px] text-fg-muted uppercase tracking-wider">Size</p>
                <p className="font-medium text-fg">{formatBytes(doc.file_size_bytes)}</p>
              </div>
            </div>
          </div>

          {doc.notes && (
            <div className="mt-4 p-3 bg-sunken rounded-lg border border-border-subtle text-xs text-fg-secondary">
              <span className="font-semibold text-fg">Clinical Notes:</span> {doc.notes}
            </div>
          )}
        </div>

        {/* Embedded Viewer Pane */}
        <div className="bg-white rounded-xl border border-border overflow-hidden shadow-xs">
          <div className="p-3 bg-sunken border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-fg-secondary">Document Preview</span>
            <span className="text-[11px] text-fg-muted">Secure Stream</span>
          </div>

          <div className="p-2 sm:p-4 min-h-[500px] flex items-center justify-center bg-sunken">
            {isPdf ? (
              <iframe
                src={`${signedUrl}#toolbar=0`}
                title={doc.title}
                className="w-full h-[650px] border-0 rounded-md bg-white shadow-xs"
              />
            ) : isImage ? (
              <div className="max-w-full max-h-[700px] overflow-auto flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={signedUrl}
                  alt={doc.title}
                  className="max-w-full max-h-[650px] object-contain rounded-md shadow-xs"
                />
              </div>
            ) : (
              <div className="text-center p-8">
                <FileText className="w-12 h-12 text-fg-subtle mx-auto mb-3" />
                <p className="text-sm font-medium text-fg mb-2">Preview not available for this file format.</p>
                <a
                  href={signedUrl}
                  download={doc.original_filename}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
                >
                  <Download className="w-4 h-4" />
                  <span>Click here to download</span>
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center text-xs text-fg-muted space-y-1 pb-8">
          <p>
            This secure medical link is valid until <span className="font-semibold text-fg-secondary">{formattedExpiry}</span>.
          </p>
          <p className="text-[11px] text-fg-subtle">
            Confidential Health Information — Protected under Indian Digital Personal Data Protection (DPDP) Act.
          </p>
        </div>
      </main>
    </div>
  );
}
