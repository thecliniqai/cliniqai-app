"use client";

import { useState } from "react";
import { ExternalLink, FileText, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileDrop, type FileDropResult } from "@/components/ui/file-drop";
import { getDocumentSignedUrl, uploadLabDocument } from "@/features/labs/actions";
import { LAB_ACCEPTED_MIME_TYPES, labFileRefusal } from "@/features/labs/utils";
import { titleFromFilename, toConsultDocument, type ConsultDocument } from "@/features/labs/consult-documents";
import { reportClientError } from "@/lib/log/client";
import { formatClinicDateWithWeekday } from "@/lib/datetime/format";

/**
 * Attachments (V2-09b 09B-05, P1-24, R-16): the consult's upload. Reports go up through the existing `uploadLabDocument` (labs:edit; the patient and the
 * visit are checked against the clinic on the server; the object is stored under an id-only key and never replaced), one action per file, with this
 * visit's id. The list is this visit's documents; "Open" asks for the 5-minute signed link. On a read-only record there is no drop zone: the list stays,
 * and a line says why. A role without `labs:edit` sees the drop zone disabled with the reason.
 */
export interface AttachmentsProps {
  visitId: string;
  patientId: string;
  /** This visit's documents, newest first. */
  documents: readonly ConsultDocument[];
  /** The record is sealed, unsigned-completed or cancelled. */
  readOnly: boolean;
  /** The role holds `labs:edit`. */
  canUpload: boolean;
  onUploaded: (document: ConsultDocument) => void;
}

/** Opens a document through its 5-minute signed link (a new tab; the link is never stored or shown). Returns false when it could not be signed. */
export async function openConsultDocument(id: string): Promise<boolean> {
  try {
    const res = await getDocumentSignedUrl(id);
    if (res.success && res.signedUrl) {
      window.open(res.signedUrl, "_blank", "noopener,noreferrer");
      return true;
    }
  } catch (err) {
    reportClientError("labs.document_open.failed", err);
  }
  return false;
}

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function DocumentRow({ doc }: { doc: ConsultDocument }) {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <li data-document-row={doc.id} className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2">
      <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-icon" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-medium text-fg">{doc.title}</p>
        <p className="text-label text-fg-muted">
          {formatClinicDateWithWeekday(doc.report_date)} · {sizeText(doc.file_size_bytes)}
        </p>
        {failed && (
          <p role="alert" className="text-label text-danger-fg">
            The document could not be opened. Try again.
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={busy}
        startIcon={<ExternalLink />}
        aria-label={`Open ${doc.title}`}
        onClick={async () => {
          setBusy(true);
          setFailed(!(await openConsultDocument(doc.id)));
          setBusy(false);
        }}
      >
        Open
      </Button>
    </li>
  );
}

export function Attachments({ visitId, patientId, documents, readOnly, canUpload, onUploaded }: AttachmentsProps) {
  const upload = async (file: File): Promise<FileDropResult> => {
    const form = new FormData();
    form.set("file", file);
    form.set("patient_id", patientId);
    form.set("visit_id", visitId);
    form.set("title", titleFromFilename(file.name));
    form.set("document_type", "lab_report");
    form.set("is_abnormal", "false");
    const res = await uploadLabDocument(form);
    if (!res.success) return { ok: false, error: res.error };
    onUploaded(toConsultDocument(res.document));
    return { ok: true };
  };

  return (
    <div data-attachments="" className="flex flex-col gap-3">
      {readOnly ? (
        <p data-attachments-readonly="" className="flex items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-soft p-3 text-body-sm text-fg-secondary">
          <Lock aria-hidden="true" className="size-4 shrink-0 text-fg-icon" />
          This record is signed. Reports can no longer be added to it.
        </p>
      ) : (
        <FileDrop
          label="Upload lab report or radiograph"
          accept={LAB_ACCEPTED_MIME_TYPES}
          limitsText="PDF, JPEG, PNG or WEBP, up to 25 MB each."
          refuse={labFileRefusal}
          onUpload={upload}
          disabled={!canUpload}
          disabledReason="Your role cannot upload reports."
        />
      )}
      {documents.length > 0 ? (
        <ul aria-label="Attachments" className="flex flex-col gap-1.5">
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} />
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-fg-muted">No reports attached to this visit.</p>
      )}
    </div>
  );
}
