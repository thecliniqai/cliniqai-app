"use client";

import { useEffect, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { reportClientError } from "@/lib/log/client";

/**
 * "Share PDF" (V2-09c 09C-05, R-14, PWA-12, PWA §4 D-6): the prescription's PDF through the device's own share sheet (WhatsApp, Mail, Drive, AirDrop, print).
 *
 * The file is fetched from the PDF route into MEMORY when the button mounts, because Safari only opens the share sheet inside the tap itself (an await before
 * `navigator.share` loses the gesture). It is shared as a `File` named by the server (`Prescription-{date}-v{n}.pdf`, no patient name: PWA D-7) when
 * `navigator.canShare({ files })` says the device can take it, and the button is "Download PDF" everywhere else. Nothing is written to any storage API (no
 * cache, no IndexedDB, no localStorage); the route answers `no-store`; the bytes are dropped when the button unmounts. The bytes never leave this component
 * except into the share sheet or the download the person asked for.
 */
type Phase =
  | { kind: "loading" }
  | { kind: "ready"; file: File; canShare: boolean }
  | { kind: "error" };

const FALLBACK_NAME = "Prescription.pdf";
/** A name the route would produce; anything else is replaced, so a header can never put a path or a patient's name in a file. */
const SAFE_NAME = /^Prescription-[0-9A-Za-z-]+\.pdf$/;

export function fileNameFromDisposition(header: string | null): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match && SAFE_NAME.test(match[1]) ? match[1] : FALLBACK_NAME;
}

export interface SharePdfButtonProps {
  visitId: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

export function SharePdfButton({ visitId, variant = "secondary", size, className }: SharePdfButtonProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/visits/${encodeURIComponent(visitId)}/prescription-pdf`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok || !res.headers.get("content-type")?.startsWith("application/pdf")) throw new Error("pdf_unavailable");
        const blob = await res.blob();
        const file = new File([blob], fileNameFromDisposition(res.headers.get("content-disposition")), { type: "application/pdf" });
        const canShare = typeof navigator.canShare === "function" && typeof navigator.share === "function" && navigator.canShare({ files: [file] });
        setPhase({ kind: "ready", file, canShare });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        reportClientError("prescriptions.share_pdf_fetch.failed", err);
        setPhase({ kind: "error" });
      });
    // The bytes are dropped with the component: nothing is kept after the screen closes.
    return () => controller.abort();
  }, [visitId, attempt]);

  if (phase.kind === "error") {
    return (
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        data-share-pdf="error"
        onClick={() => {
          setPhase({ kind: "loading" });
          setAttempt((n) => n + 1);
        }}
      >
        PDF unavailable. Try again
      </Button>
    );
  }
  if (phase.kind === "loading") {
    return (
      <Button type="button" variant={variant} size={size} className={className} data-share-pdf="loading" loading disabled>
        Preparing PDF
      </Button>
    );
  }

  const { file, canShare } = phase;
  const download = () => {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const share = async () => {
    setNotice(null);
    try {
      await navigator.share({ files: [file], title: "Prescription" });
    } catch (err) {
      // Closing the share sheet is not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      reportClientError("prescriptions.share_pdf.failed", err);
      setNotice("The share sheet could not open. Download the PDF instead.");
      setPhase({ kind: "ready", file, canShare: false });
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        data-share-pdf={canShare ? "share" : "download"}
        startIcon={canShare ? <Share2 /> : <Download />}
        onClick={canShare ? share : download}
      >
        {canShare ? "Share PDF" : "Download PDF"}
      </Button>
      {notice && (
        <span role="status" className="text-caption text-fg-muted">
          {notice}
        </span>
      )}
    </span>
  );
}
