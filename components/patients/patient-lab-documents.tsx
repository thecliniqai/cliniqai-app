"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  FlaskConical,
  UploadCloud,
  FileText,
  Calendar,
  AlertTriangle,
  Share2,
  Trash2,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getPatientDocuments,
  uploadLabDocument,
  getDocumentSignedUrl,
  generateDocumentShareToken,
  deleteLabDocument,
} from "@/features/labs/actions";
import { LabDocumentItem, ShareTokenResult } from "@/features/labs/types";

interface PatientLabDocumentsProps {
  patientId: string;
  userRole?: string;
}

const COMMON_SUGGESTIONS = [
  "Complete Blood Count (CBC)",
  "Lipid Profile",
  "Thyroid (T3, T4, TSH)",
  "HbA1c",
  "Liver Function Test (LFT)",
  "Kidney Function Test (KFT)",
  "Urine Routine & Microscopic",
  "Chest X-Ray",
  "ECG",
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function PatientLabDocuments({ patientId, userRole = "doctor" }: PatientLabDocumentsProps) {
  const [documents, setDocuments] = useState<LabDocumentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload modal state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState<"lab_report" | "imaging" | "prescription_scan" | "other">("lab_report");
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [isAbnormal, setIsAbnormal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Share modal state
  const [shareDoc, setShareDoc] = useState<LabDocumentItem | null>(null);
  const [shareResult, setShareResult] = useState<ShareTokenResult | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Delete modal state
  const [deleteDoc, setDeleteDoc] = useState<LabDocumentItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filter state
  const [filterAbnormalOnly, setFilterAbnormalOnly] = useState(false);

  const canEdit = ["owner", "admin", "doctor", "nurse"].includes(userRole);

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getPatientDocuments(patientId);
      if (res.success) {
        setDocuments(res.documents);
      } else {
        setError(res.error || "Failed to load lab documents.");
      }
    } catch {
      setError("An unexpected error occurred while fetching lab documents.");
    } finally {
      setIsLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      if (!title) {
        setTitle(file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " "));
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      if (!title) {
        setTitle(file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " "));
      }
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError("Please select a file to upload.");
      return;
    }
    if (!title.trim()) {
      setUploadError("Document title is required.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.set("file", selectedFile);
      formData.set("patient_id", patientId);
      formData.set("title", title.trim());
      formData.set("document_type", documentType);
      formData.set("report_date", reportDate);
      formData.set("notes", notes.trim());
      formData.set("is_abnormal", isAbnormal ? "true" : "false");

      const res = await uploadLabDocument(formData);
      if (res.success) {
        setIsUploadOpen(false);
        resetUploadForm();
        await loadDocuments();
      } else {
        setUploadError(res.error || "Failed to upload document.");
      }
    } catch {
      setUploadError("Network error while uploading document.");
    } finally {
      setIsUploading(false);
    }
  };

  const resetUploadForm = () => {
    setSelectedFile(null);
    setTitle("");
    setDocumentType("lab_report");
    setReportDate(new Date().toISOString().split("T")[0]);
    setNotes("");
    setIsAbnormal(false);
    setUploadError(null);
  };

  const handleViewDocument = async (docId: string) => {
    try {
      const res = await getDocumentSignedUrl(docId);
      if (res.success && res.signedUrl) {
        window.open(res.signedUrl, "_blank", "noopener,noreferrer");
      } else {
        alert(res.error || "Could not open document link.");
      }
    } catch {
      alert("Error opening document.");
    }
  };

  const handleOpenShare = async (doc: LabDocumentItem) => {
    setShareDoc(doc);
    setShareResult(null);
    setShareCopied(false);
    setIsGeneratingShare(true);

    try {
      const res = await generateDocumentShareToken(doc.id);
      setShareResult(res);
    } catch {
      setShareResult({ success: false, error: "Failed to generate share link." });
    } finally {
      setIsGeneratingShare(false);
    }
  };

  const handleCopyShareLink = () => {
    if (!shareResult?.token) return;
    const fullUrl = `${window.location.origin}/reports/view?token=${shareResult.token}`;
    navigator.clipboard.writeText(fullUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2500);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDoc) return;
    setIsDeleting(true);

    try {
      const res = await deleteLabDocument(deleteDoc.id);
      if (res.success) {
        setDeleteDoc(null);
        await loadDocuments();
      } else {
        alert(res.error || "Failed to delete document.");
      }
    } catch {
      alert("Error deleting document.");
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredDocs = documents.filter((doc) => {
    if (filterAbnormalOnly && !doc.is_abnormal) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Action & Filter Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-gray-200">
        <div>
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-[#1769E0]" />
            <span>Lab Reports & Diagnostic Records</span>
          </h3>
          <p className="text-xs text-gray-500">
            Upload and view patient blood tests, imaging scans, and partner diagnostic reports.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {documents.some((d) => d.is_abnormal) && (
            <button
              type="button"
              onClick={() => setFilterAbnormalOnly(!filterAbnormalOnly)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                filterAbnormalOnly
                  ? "bg-[#FFEDEC] text-[#BA1A1A] border-[#F8B4B4]"
                  : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
              }`}
            >
              Abnormal Only
            </button>
          )}

          {canEdit && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                resetUploadForm();
                setIsUploadOpen(true);
              }}
              startIcon={<UploadCloud className="w-4 h-4" />}
            >
              Upload Lab Report
            </Button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="p-12 text-center bg-white rounded-xl border border-gray-200">
          <Loader2 className="w-8 h-8 text-[#1769E0] animate-spin mx-auto mb-2" />
          <p className="text-xs text-gray-500 font-medium">Loading diagnostic records...</p>
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div className="p-6 text-center bg-white rounded-xl border border-red-200 text-red-600 text-xs">
          {error}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredDocs.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-10 text-center">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-[#1769E0] flex items-center justify-center mx-auto mb-3">
            <FlaskConical className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-semibold text-gray-900">
            {filterAbnormalOnly ? "No abnormal reports found" : "No lab reports uploaded yet"}
          </h4>
          <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1 mb-4 leading-relaxed">
            {filterAbnormalOnly
              ? "All recorded reports for this patient have normal findings."
              : "Upload diagnostic lab results, imaging scans, and partner reports for this patient."}
          </p>
          {canEdit && !filterAbnormalOnly && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                resetUploadForm();
                setIsUploadOpen(true);
              }}
              startIcon={<UploadCloud className="w-4 h-4" />}
            >
              Upload First Report
            </Button>
          )}
        </div>
      )}

      {/* Document List */}
      {!isLoading && !error && filteredDocs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
          {filteredDocs.map((doc) => (
            <div
              key={doc.id}
              className="p-4 hover:bg-gray-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold text-gray-900 truncate">{doc.title}</h4>
                  {doc.is_abnormal && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#FFEDEC] text-[#BA1A1A] border border-[#F8B4B4] flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Abnormal</span>
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-gray-100 text-gray-600 capitalize">
                    {doc.document_type.replace(/_/g, " ")}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    <span>Report Date: {doc.report_date}</span>
                  </span>
                  <span>•</span>
                  <span>{formatBytes(doc.file_size_bytes)}</span>
                  <span>•</span>
                  <span className="truncate max-w-[200px]" title={doc.original_filename}>
                    {doc.original_filename}
                  </span>
                </div>

                {doc.notes && (
                  <p className="text-xs text-gray-600 bg-gray-50 p-2 rounded-md border border-gray-100 mt-1">
                    <span className="font-semibold text-gray-700">Notes:</span> {doc.notes}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleViewDocument(doc.id)}
                  startIcon={<ExternalLink className="w-3.5 h-3.5" />}
                >
                  View
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenShare(doc)}
                  className="text-gray-600 hover:text-[#1769E0]"
                  startIcon={<Share2 className="w-3.5 h-3.5" />}
                >
                  Share
                </Button>

                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteDoc(doc)}
                    className="text-gray-400 hover:text-red-600"
                    aria-label="Delete document"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-gray-200 max-w-lg w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <UploadCloud className="w-5 h-5 text-[#1769E0]" />
                <span>Upload Lab Document</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsUploadOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {/* File Dropzone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  selectedFile
                    ? "border-[#1769E0] bg-blue-50/30"
                    : "border-gray-300 hover:border-[#1769E0] bg-gray-50/50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <div className="w-10 h-10 rounded-full bg-blue-100 text-[#1769E0] flex items-center justify-center mx-auto mb-2">
                  <FileText className="w-5 h-5" />
                </div>
                {selectedFile ? (
                  <div>
                    <p className="text-sm font-bold text-gray-900 truncate">{selectedFile.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{formatBytes(selectedFile.size)}</p>
                    <span className="inline-block mt-2 text-[11px] font-semibold text-[#1769E0] hover:underline">
                      Click to change file
                    </span>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      Drag & drop document or <span className="text-[#1769E0]">browse</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Supports PDF, JPEG, PNG, WEBP (Max 25MB)
                    </p>
                  </div>
                )}
              </div>

              {/* Title & Suggestions */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Document Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Complete Blood Count (CBC)"
                  required
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#1769E0]/20 focus:border-[#1769E0]"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {COMMON_SUGGESTIONS.map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => setTitle(sug)}
                      className="px-2 py-0.5 rounded-md text-[11px] bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors cursor-pointer"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>

              {/* Report Date & Document Type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Report Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#1769E0]/20 focus:border-[#1769E0]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Document Type</label>
                  <select
                    value={documentType}
                    onChange={(e) => setDocumentType(e.target.value as "lab_report" | "imaging" | "prescription_scan" | "other")}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#1769E0]/20 focus:border-[#1769E0]"
                  >
                    <option value="lab_report">Lab Report</option>
                    <option value="imaging">Imaging Scan (X-Ray, USG)</option>
                    <option value="prescription_scan">Prescription Scan</option>
                    <option value="other">Other Clinical Document</option>
                  </select>
                </div>
              </div>

              {/* Abnormal Flag Toggle */}
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-gray-900 block">Flag as Abnormal</span>
                  <span className="text-[11px] text-gray-500">Highlights report in red on the patient timeline</span>
                </div>
                <input
                  type="checkbox"
                  checked={isAbnormal}
                  onChange={(e) => setIsAbnormal(e.target.checked)}
                  className="w-4 h-4 text-[#BA1A1A] rounded-sm focus:ring-[#BA1A1A] cursor-pointer"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Clinical Notes (Optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Key findings, high/low parameters, or doctor remarks..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#1769E0]/20 focus:border-[#1769E0]"
                />
              </div>

              {uploadError && <p className="text-xs text-red-600 bg-red-50 p-2 rounded-lg">{uploadError}</p>}

              {/* Modal CTAs */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsUploadOpen(false)}
                  disabled={isUploading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isUploading || !selectedFile}
                  startIcon={isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                >
                  {isUploading ? "Uploading & Encrypting..." : "Upload & Attach"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-gray-200 max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Share2 className="w-5 h-5 text-[#1769E0]" />
                <span>Patient Document Share Link</span>
              </h3>
              <button
                type="button"
                onClick={() => setShareDoc(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-gray-600">
                Generate a secure, zero-login link for the patient to view and download{" "}
                <span className="font-semibold text-gray-900">{shareDoc.title}</span>.
              </p>

              {isGeneratingShare && (
                <div className="p-6 text-center">
                  <Loader2 className="w-6 h-6 text-[#1769E0] animate-spin mx-auto mb-2" />
                  <p className="text-xs text-gray-500">Creating secure 7-day token...</p>
                </div>
              )}

              {!isGeneratingShare && shareResult?.success && shareResult.token && (
                <div className="space-y-3">
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-700 truncate font-mono">
                      {window.location.origin}/reports/view?token={shareResult.token.slice(0, 16)}...
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleCopyShareLink}
                      startIcon={shareCopied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    >
                      {shareCopied ? "Copied" : "Copy"}
                    </Button>
                  </div>

                  <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-100 text-xs text-blue-900 space-y-1">
                    <p className="font-semibold">Security Note</p>
                    <p className="text-[11px] text-blue-800">
                      This link automatically expires in 7 days. Patients do not need a password or app installation to view their report.
                    </p>
                  </div>
                </div>
              )}

              {!isGeneratingShare && shareResult && !shareResult.success && (
                <p className="text-xs text-red-600 bg-red-50 p-2 rounded-lg">{shareResult.error}</p>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-gray-100">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShareDoc(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-gray-200 max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>

            <div>
              <h3 className="text-base font-bold text-gray-900">Delete Lab Document?</h3>
              <p className="text-xs text-gray-500 mt-1">
                Are you sure you want to delete <span className="font-semibold text-gray-800">{deleteDoc.title}</span>? This permanently removes the file from clinic storage.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteDoc(null)} disabled={isDeleting}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                startIcon={isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              >
                {isDeleting ? "Deleting..." : "Delete Permanently"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
