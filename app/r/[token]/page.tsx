import React from "react";
import { DOCUMENT_LINK_KINDS, isPlausibleToken, resolveShareToken } from "@/features/sharing/public-links";
import { signSharedObject } from "@/features/sharing/system";
import {
  FileText,
  Download,
  Phone,
  AlertCircle,
  ShieldCheck,
  Calendar,
  User,
  Clock,
  Building2,
} from "lucide-react";

interface PublicDocumentPageProps {
  params: Promise<{ token: string }>;
}

export default async function PublicDocumentViewerPage({ params }: PublicDocumentPageProps) {
  const { token } = await params;

  if (!isPlausibleToken(token)) {
    return (
      <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center p-4">
        <div className="max-w-[480px] w-full bg-white rounded-xl border border-[#E5E7EB] p-6 text-center shadow-xs">
          <div className="w-12 h-12 rounded-full bg-[#FFEDEC] text-[#DC2626] flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-semibold text-[#111827] mb-2">Invalid Document Link</h1>
          <p className="text-sm text-[#4B5563] leading-relaxed mb-4">
            This document link is incomplete or missing. Please verify the URL or contact your clinic for a new link.
          </p>
        </div>
      </div>
    );
  }

  // Token-scoped resolution (P0-04, ADR-0005 D3): bound to the token's tenant and to document kinds only.
  const resolved = await resolveShareToken(token, DOCUMENT_LINK_KINDS);
  const isRevoked = resolved.status === "revoked";

  if (resolved.status !== "ok") {
    const clinicPhone = resolved.status === "revoked" || resolved.status === "expired" ? resolved.clinic?.phone : null;
    return (
      <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center p-4">
        <div className="max-w-[480px] w-full bg-white rounded-xl border border-amber-200 bg-amber-50/50 p-6 text-center shadow-xs">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-semibold text-amber-950 mb-2">
            {isRevoked ? "Link Revoked" : "Link Expired"}
          </h1>
          <p className="text-sm text-amber-900 leading-relaxed mb-4">
            This document link has expired or been revoked for patient privacy and security.
            {clinicPhone && (
              <> Please call the clinic at <strong className="font-semibold">{clinicPhone}</strong> to request a new link.</>
            )}
          </p>
          {clinicPhone && (
            <a
              href={`tel:${clinicPhone}`}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg bg-[#1769E0] text-white font-medium text-sm hover:bg-[#0F5AB8] transition-colors"
            >
              <Phone className="w-4 h-4" />
              Call Clinic
            </a>
          )}
        </div>
      </div>
    );
  }

  const doc = resolved.document;
  const BADGES: Record<string, string> = { prescription: "PRESCRIPTION", invoice: "RECEIPT", referral: "REFERRAL" };
  const docTitle = doc.title || "Clinical Document";
  const docBadge = BADGES[doc.resource_type] ?? (doc.document_type || "lab_report").replace(/_/g, " ").toUpperCase();
  const originalFilename = doc.original_filename || "document.pdf";
  const mimeType = doc.mime_type || "application/pdf";
  const patientName = doc.patient_name || "Patient";
  const reportDateStr = doc.report_date
    ? new Date(doc.report_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "";

  // Short-lived signed URL for the object behind this token (tenant-prefix checked); else the download route.
  const signed = await signSharedObject(token, DOCUMENT_LINK_KINDS);
  const signedUrl = signed?.signedUrl ?? `/api/r/${token}?download=true`;

  const clinic = {
    name: doc.clinic?.name || "Clinic",
    phone: doc.clinic?.phone ?? null,
    address: doc.clinic?.address ?? null,
  };

  const isPdf = mimeType === "application/pdf" || originalFilename.toLowerCase().endsWith(".pdf");
  const isImage = mimeType.startsWith("image/");

  return (
    <div className="min-h-screen bg-[#F7F6F3] py-8 px-4 flex flex-col justify-between">
      <main className="max-w-[480px] w-full mx-auto space-y-4">
        {/* Clinic Header */}
        <header className="bg-white rounded-xl border border-[#E5E7EB] p-5 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-5 h-5 text-[#1769E0]" />
                <h1 className="text-lg font-bold text-[#111827]">{clinic.name}</h1>
              </div>
              {clinic.address && (
                <p className="text-xs text-[#6B7280] leading-relaxed">{clinic.address}</p>
              )}
            </div>
            {clinic.phone && (
              <a
                href={`tel:${clinic.phone}`}
                className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-gray-50 border border-gray-200 text-xs font-medium text-[#111827] hover:bg-gray-100 transition-colors"
                title="Call Clinic"
              >
                <Phone className="w-3.5 h-3.5 text-[#1769E0]" />
                Call
              </a>
            )}
          </div>
        </header>

        {/* Document Card */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-[#F3F4F6] pb-3">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-[#1769E0]">
              {docBadge}
            </span>
            <div className="flex items-center gap-1.5 text-xs text-[#6B7280]">
              <Calendar className="w-3.5 h-3.5" />
              <span>{reportDateStr}</span>
            </div>
          </div>

          <div>
            <h2 className="text-base font-semibold text-[#111827] mb-1">{docTitle}</h2>
            <div className="flex items-center gap-2 text-xs text-[#4B5563]">
              <User className="w-3.5 h-3.5 text-[#9CA3AF]" />
              <span>Patient: <strong className="font-medium text-[#111827]">{patientName}</strong></span>
            </div>
          </div>

          {/* Embedded Viewer Preview */}
          <div className="rounded-lg border border-[#E5E7EB] bg-gray-50 overflow-hidden min-h-[220px] flex items-center justify-center">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={signedUrl}
                alt={docTitle}
                className="max-h-[400px] w-full object-contain"
              />
            ) : isPdf ? (
              <iframe
                src={`${signedUrl}#toolbar=0`}
                title={docTitle}
                className="w-full h-[320px] border-0"
              />
            ) : (
              <div className="text-center p-6 space-y-2">
                <FileText className="w-10 h-10 text-gray-400 mx-auto" />
                <p className="text-xs text-gray-500">{originalFilename}</p>
              </div>
            )}
          </div>

          {/* Primary CTA: Download PDF */}
          <a
            href={`/api/r/${token}?download=true`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-lg bg-[#1769E0] text-white font-semibold text-sm hover:bg-[#0F5AB8] transition-colors shadow-xs"
          >
            <Download className="w-4 h-4" />
            Download Official PDF
          </a>
        </div>
      </main>

      {/* Footer Security Badge */}
      <footer className="max-w-[480px] w-full mx-auto mt-6 text-center space-y-1">
        <div className="inline-flex items-center gap-1.5 text-xs text-[#6B7280]">
          <ShieldCheck className="w-4 h-4 text-[#16A34A]" />
          <span>Secure official document issued via CliniQ.</span>
        </div>
        <p className="text-[11px] text-[#9CA3AF] flex items-center justify-center gap-1">
          <Clock className="w-3 h-3" />
          <span>Link expires 7 days after issuance.</span>
        </p>
      </footer>
    </div>
  );
}
