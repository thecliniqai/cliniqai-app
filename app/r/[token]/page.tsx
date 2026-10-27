import React from "react";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSignedUrl, SupabaseStorageProvider } from "@/lib/storage";
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

  if (!token || typeof token !== "string" || token.length < 32) {
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

  const admin = getAdminClient();

  // 1. Fetch token record
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: shareToken, error: tokenErr } = await (admin.from("document_share_tokens") as any)
    .select("*, tenants(id, name, phone, address, logo_url)")
    .eq("token", token)
    .single();

  const isExpired = shareToken && new Date(shareToken.expires_at).getTime() <= Date.now();
  const isRevoked = shareToken && Boolean(shareToken.revoked_at);

  if (tokenErr || !shareToken || isExpired || isRevoked) {
    const clinicPhone = shareToken?.tenants?.phone;
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

  const resourceType = shareToken.resource_type || "patient_document";
  const resourceId = shareToken.resource_id || shareToken.document_id;

  let docTitle = "Clinical Document";
  let docBadge = "Document";
  let originalFilename = "document.pdf";
  let mimeType = "application/pdf";
  let storagePath = "";
  let storageBucket = "clinic-records";
  let patientName = "Patient";
  let reportDateStr = new Date(shareToken.created_at).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  if (resourceType === "patient_document" || shareToken.document_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: doc } = await (admin.from("patient_documents") as any)
      .select("*, patients(full_name)")
      .eq("id", resourceId)
      .single();

    if (doc) {
      docTitle = doc.title || "Lab Report";
      docBadge = (doc.document_type || "lab_report").replace(/_/g, " ").toUpperCase();
      originalFilename = doc.original_filename || "report.pdf";
      mimeType = doc.mime_type || "application/pdf";
      storagePath = doc.storage_path;
      storageBucket = "clinic-records";
      patientName = doc.patients?.full_name || "Patient";
      if (doc.report_date) {
        reportDateStr = new Date(doc.report_date).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      }
    }
  } else if (resourceType === "prescription") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rx } = await (admin.from("prescriptions") as any)
      .select("*, patients(full_name)")
      .eq("id", resourceId)
      .single();

    if (rx) {
      docTitle = "Official Prescription";
      docBadge = "PRESCRIPTION";
      originalFilename = `Prescription_${rx.id.slice(0, 8)}.pdf`;
      storagePath = rx.pdf_storage_path || `${shareToken.tenant_id}/${rx.id}.pdf`;
      storageBucket = "prescriptions";
      patientName = rx.patients?.full_name || "Patient";
    }
  } else if (resourceType === "invoice") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inv } = await (admin.from("invoices") as any)
      .select("*, patients(full_name)")
      .eq("id", resourceId)
      .single();

    if (inv) {
      docTitle = `Payment Receipt #${inv.invoice_number || ""}`;
      docBadge = "RECEIPT";
      originalFilename = `Receipt_${inv.invoice_number || inv.id.slice(0, 8)}.pdf`;
      storagePath = `${shareToken.tenant_id}/receipts/inv_${inv.id}.pdf`;
      storageBucket = "prescriptions";
      patientName = inv.patients?.full_name || "Patient";
    }
  } else if (resourceType === "referral") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ref } = await (admin.from("referrals") as any)
      .select("*, patients(full_name)")
      .eq("id", resourceId)
      .single();

    if (ref) {
      docTitle = `Referral Letter — ${ref.referred_to_name || "Specialist"}`;
      docBadge = "REFERRAL";
      originalFilename = `Referral_${ref.id.slice(0, 8)}.pdf`;
      storagePath = ref.pdf_storage_path || `tenants/${shareToken.tenant_id}/referrals/${ref.id}/referral_letter.pdf`;
      storageBucket = "clinic-records";
      patientName = ref.patients?.full_name || "Patient";
    }
  }

  // Atomically increment access counter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("document_share_tokens") as any)
    .update({
      access_count: (shareToken.access_count || 0) + 1,
      last_accessed_at: new Date().toISOString(),
    })
    .eq("id", shareToken.id);

  // Generate signed URL
  const storageProvider = new SupabaseStorageProvider({
    defaultBucket: storageBucket,
    client: admin,
  });

  let signedUrl = `/api/r/${token}?download=true`;
  try {
    const signedRes = await getSignedUrl(
      {
        path: storagePath,
        bucket: storageBucket,
        expiresInSeconds: 600,
        downloadFilename: originalFilename,
      },
      storageProvider
    );
    if (signedRes?.signedUrl) {
      signedUrl = signedRes.signedUrl;
    }
  } catch {
    // Keep fallback direct download route
  }

  const clinic = shareToken.tenants || {
    name: "Clinic",
    phone: null,
    address: null,
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
