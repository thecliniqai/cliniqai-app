"use client";

import React, { useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/log/client";

interface DpdpExportActionsProps {
  patientId: string;
}

export function DpdpExportActions({ patientId }: DpdpExportActionsProps) {
  const [isExportingJson, setIsExportingJson] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleDownload = async (format: "json" | "pdf") => {
    if (format === "json") setIsExportingJson(true);
    if (format === "pdf") setIsExportingPdf(true);

    try {
      // Session-authenticated app route (not the public /api/v1 API, which is off by default).
      const response = await fetch(`/api/patients/${patientId}/export?format=${format}`);
      if (!response.ok) {
        throw new Error(`Export failed with HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const filename =
        format === "json"
          ? `patient-dpdp-export-${patientId.slice(0, 8)}.json`
          : `medical-summary-${patientId.slice(0, 8)}.pdf`;

      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      reportClientError("dpdp.export.failed", err);
      alert("Failed to export patient records. Please try again.");
    } finally {
      setIsExportingJson(false);
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={isExportingJson || isExportingPdf}
        onClick={() => handleDownload("json")}
        startIcon={
          isExportingJson ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />
          ) : (
            <FileText className="w-3.5 h-3.5 text-gray-600" />
          )
        }
        className="h-9 font-medium"
      >
        {isExportingJson ? "Exporting JSON..." : "Export JSON Archive"}
      </Button>

      <Button
        variant="primary"
        size="sm"
        disabled={isExportingJson || isExportingPdf}
        onClick={() => handleDownload("pdf")}
        startIcon={
          isExportingPdf ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )
        }
        className="h-9 font-medium bg-[#1769E0] text-white hover:bg-[#155cc0]"
      >
        {isExportingPdf ? "Generating PDF..." : "Download Medical Summary (PDF)"}
      </Button>
    </div>
  );
}
