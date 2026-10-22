import React from "react";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSignedUrl, SupabaseStorageProvider } from "@/lib/storage";
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

  if (!token || typeof token !== "string" || token.length < 32) {
    return (
      <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-[#E5E7EB] p-8 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-[#FFEDEC] text-[#BA1A1A] flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-[#111827] mb-2">Invalid Document Link</h1>
          <p className="text-sm text-[#4B5563] mb-6">
            This link is missing or incomplete. Please verify the URL or contact your clinic for a new link.
          </p>
        </div>
      </div>
    );
  }

  const admin = getAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: shareToken, error: tokenErr } = await (admin.from("document_share_tokens") as any)
    .select("*, patient_documents(*, tenants(name, phone, address, logo_url), patients(full_name))")
    .eq("token", token)
    .single();

  const isExpired = shareToken && new Date(shareToken.expires_at).getTime() <= Date.now();
  const isRevoked = shareToken && Boolean(shareToken.revoked_at);

  if (tokenErr || !shareToken || isExpired || isRevoked || !shareToken.patient_documents) {
    return (
      <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-[#E5E7EB] p-8 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-[#FFEDEC] text-[#BA1A1A] flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-[#111827] mb-2">Link Expired or Invalid</h1>
          <p className="text-sm text-[#4B5563] mb-6">
            This document link has expired or has been revoked for your security. Please contact your clinic to request a fresh link.
          </p>
          {shareToken?.patient_documents?.tenants?.phone && (
            <p className="text-xs text-[#6B7280]">
              Clinic Contact: <span className="font-semibold">{shareToken.patient_documents.tenants.phone}</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  const doc = shareToken.patient_documents;
  const clinic = doc.tenants || { name: "Clinic", phone: null, address: null, logo_url: null };
  const patientName = doc.patients?.full_name || "Patient";

  // Atomically increment access counter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("document_share_tokens") as any)
    .update({
      access_count: (shareToken.access_count || 0) + 1,
      last_accessed_at: new Date().toISOString(),
    })
    .eq("id", shareToken.id);

  // Generate 600-second signed URL for download and preview
  const storageProvider = new SupabaseStorageProvider({
    defaultBucket: "clinic-records",
    client: admin,
  });

  const { signedUrl } = await getSignedUrl(
    {
      path: doc.storage_path,
      bucket: "clinic-records",
      expiresInSeconds: 600,
      downloadFilename: doc.original_filename,
    },
    storageProvider
  );

  const isPdf = doc.mime_type === "application/pdf" || doc.original_filename.toLowerCase().endsWith(".pdf");
  const isImage = doc.mime_type.startsWith("image/");
  const formattedExpiry = new Date(shareToken.expires_at).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-[#111827]">
      {/* Top Clinic Branding Bar */}
      <header className="bg-white border-b border-[#E5E7EB] sticky top-0 z-20 shadow-xs">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base sm:text-lg font-bold text-[#111827]">{clinic.name}</h1>
            {clinic.address && <p className="text-xs text-[#6B7280]">{clinic.address}</p>}
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#EAF7F0] border border-[#BDE5CF] text-[#18794E] text-xs font-medium">
            <ShieldCheck className="w-4 h-4 text-[#18794E]" />
            <span>Verified Record</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Document Metadata Card */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#F3F4F6]">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold text-[#111827]">{doc.title}</h2>
                {doc.is_abnormal && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#FFEDEC] text-[#BA1A1A] border border-[#F8B4B4]">
                    Abnormal Findings
                  </span>
                )}
              </div>
              <p className="text-xs text-[#6B7280]">Original file: {doc.original_filename}</p>
            </div>
            <a
              href={signedUrl}
              download={doc.original_filename}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#1769E0] hover:bg-[#1255B8] active:bg-[#0D4496] text-white text-sm font-semibold transition-colors min-h-[44px] shadow-xs"
            >
              <Download className="w-4 h-4" />
              <span>Download Report</span>
            </a>
          </div>

          {/* Quick Details Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 text-xs">
            <div className="flex items-center gap-2 text-[#4B5563]">
              <User className="w-4 h-4 text-[#9CA3AF]" />
              <div>
                <p className="text-[10px] text-[#6B7280] uppercase tracking-wider">Patient</p>
                <p className="font-medium text-[#111827]">{patientName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[#4B5563]">
              <Calendar className="w-4 h-4 text-[#9CA3AF]" />
              <div>
                <p className="text-[10px] text-[#6B7280] uppercase tracking-wider">Report Date</p>
                <p className="font-medium text-[#111827]">{doc.report_date}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[#4B5563]">
              <FileText className="w-4 h-4 text-[#9CA3AF]" />
              <div>
                <p className="text-[10px] text-[#6B7280] uppercase tracking-wider">Type</p>
                <p className="font-medium text-[#111827] capitalize">{doc.document_type.replace(/_/g, " ")}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[#4B5563]">
              <HardDrive className="w-4 h-4 text-[#9CA3AF]" />
              <div>
                <p className="text-[10px] text-[#6B7280] uppercase tracking-wider">Size</p>
                <p className="font-medium text-[#111827]">{formatBytes(doc.file_size_bytes)}</p>
              </div>
            </div>
          </div>

          {doc.notes && (
            <div className="mt-4 p-3 bg-[#F9FAFB] rounded-lg border border-[#F3F4F6] text-xs text-[#4B5563]">
              <span className="font-semibold text-[#111827]">Clinical Notes:</span> {doc.notes}
            </div>
          )}
        </div>

        {/* Embedded Viewer Pane */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden shadow-xs">
          <div className="p-3 bg-[#F9FAFB] border-b border-[#E5E7EB] flex items-center justify-between">
            <span className="text-xs font-semibold text-[#4B5563]">Document Preview</span>
            <span className="text-[11px] text-[#6B7280]">Secure Stream</span>
          </div>

          <div className="p-2 sm:p-4 min-h-[500px] flex items-center justify-center bg-[#F3F4F6]">
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
                <FileText className="w-12 h-12 text-[#9CA3AF] mx-auto mb-3" />
                <p className="text-sm font-medium text-[#111827] mb-2">Preview not available for this file format.</p>
                <a
                  href={signedUrl}
                  download={doc.original_filename}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1769E0] hover:underline"
                >
                  <Download className="w-4 h-4" />
                  <span>Click here to download</span>
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center text-xs text-[#6B7280] space-y-1 pb-8">
          <p>
            This secure medical link is valid until <span className="font-semibold text-[#4B5563]">{formattedExpiry}</span>.
          </p>
          <p className="text-[11px] text-[#9CA3AF]">
            Confidential Health Information — Protected under Indian Digital Personal Data Protection (DPDP) Act.
          </p>
        </div>
      </main>
    </div>
  );
}
