"use client";

import React, { useId, useRef, useState } from "react";
import { CircleAlert, CircleCheck, FileText, Loader2, RotateCw, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * FileDrop (V2-09b 09B-05; DESIGN_SYSTEM §6.2, R-16): a drop zone and a file picker in one control, one status row per file.
 *
 * - The picker is a real file input behind a visible button, reachable and operable by keyboard; the drop zone takes dropped files (a desktop
 *   convenience, never the only way). `aria-describedby` names the limits.
 * - Every file is checked on the client against `refuse` (type and size; the server's rule and texts, features/labs/utils.ts) BEFORE anything is sent: a
 *   refused file is a failed row with the reason and no request.
 * - Files go up one at a time through `onUpload` (a server action takes one file; it exposes no byte progress, so a row is queued, uploading, stored or
 *   failed, not a percentage). A failed upload has Retry, which re-sends only that file. A stored row stays until dismissed.
 * - Not a no-op: with `disabled` the control says why (`disabledReason`) and takes nothing. No `capture` attribute (camera capture is V2-09c).
 */
export type FileDropResult = { ok: true } | { ok: false; error: string };

export interface FileDropProps {
  /** Accessible name of the picker button and the zone ("Upload report"). */
  label: string;
  /** The file types the picker offers (MIME types). */
  accept: readonly string[];
  /** The limits as the user reads them ("PDF, JPEG, PNG or WEBP, up to 25 MB each"). */
  limitsText: string;
  /** The client check: the refusal text for a file, or null when it may be sent. */
  refuse: (file: { type: string; size: number }) => string | null;
  /** Sends one file; resolves with the outcome (a thrown error is a failed row too). */
  onUpload: (file: File) => Promise<FileDropResult>;
  multiple?: boolean;
  disabled?: boolean;
  /** Why the control is disabled; drawn in place of the zone's prompt. */
  disabledReason?: string;
  className?: string;
}

type RowStatus = "queued" | "uploading" | "stored" | "failed";

interface Row {
  id: number;
  file: File;
  status: RowStatus;
  error?: string;
  /** A failure that sending again cannot fix (the client check): no Retry. */
  final?: boolean;
}

const STATUS_TEXT: Record<RowStatus, string> = {
  queued: "Waiting",
  uploading: "Uploading…",
  stored: "Stored",
  failed: "Failed",
};

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function FileDrop({ label, accept, limitsText, refuse, onUpload, multiple = true, disabled = false, disabledReason, className }: FileDropProps) {
  const inputId = useId();
  const limitsId = `${inputId}-limits`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(0);
  // The queue runs one file at a time: a second batch waits behind the first.
  const chain = useRef<Promise<void>>(Promise.resolve());

  const patch = (id: number, change: Partial<Row>) => setRows((current) => current.map((r) => (r.id === id ? { ...r, ...change } : r)));

  const send = (row: Row) => {
    chain.current = chain.current.then(async () => {
      patch(row.id, { status: "uploading", error: undefined });
      try {
        const result = await onUpload(row.file);
        if (result.ok) patch(row.id, { status: "stored" });
        else patch(row.id, { status: "failed", error: result.error });
      } catch {
        patch(row.id, { status: "failed", error: "The upload did not reach the server. Check your connection and retry." });
      }
    });
  };

  const take = (files: FileList | File[]) => {
    if (disabled) return;
    const picked = Array.from(files);
    const accepted: Row[] = [];
    const added: Row[] = [];
    for (const file of multiple ? picked : picked.slice(0, 1)) {
      const reason = refuse(file);
      const row: Row = { id: nextId.current++, file, status: reason ? "failed" : "queued", error: reason ?? undefined, final: reason ? true : undefined };
      added.push(row);
      if (!reason) accepted.push(row);
    }
    setRows((current) => [...current, ...added]);
    for (const row of accepted) send(row);
  };

  const retry = (row: Row) => {
    patch(row.id, { status: "queued", error: undefined });
    send(row);
  };

  const dismiss = (id: number) => setRows((current) => current.filter((r) => r.id !== id));

  return (
    <div data-file-drop="" data-disabled={disabled || undefined} className={cn("flex flex-col gap-3", className)}>
      <div
        data-file-drop-zone=""
        onDragEnter={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-soft p-4 text-center transition-colors",
          dragging && "border-accent-border bg-accent-subtle",
          disabled && "bg-surface-muted",
        )}
      >
        <UploadCloud aria-hidden="true" className="size-6 text-fg-icon" />
        {/* The input is the keyboard and screen-reader target; the button forwards a click to it (a file input cannot be styled as a button). */}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple={multiple}
          disabled={disabled}
          accept={accept.join(",")}
          aria-hidden="true"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files) take(e.target.files);
            // The same file may be chosen again after a failure.
            e.target.value = "";
          }}
        />
        <Button type="button" variant="secondary" disabled={disabled} onClick={() => inputRef.current?.click()} aria-describedby={limitsId} data-file-drop-pick="">
          {label}
        </Button>
        <p id={limitsId} className="text-label text-fg-muted">
          {disabled && disabledReason ? disabledReason : `Drop files here or choose them. ${limitsText}`}
        </p>
      </div>

      {rows.length > 0 && (
        <ul aria-label="Uploads" className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              data-file-row=""
              data-status={row.status}
              className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2"
            >
              <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-icon" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm font-medium text-fg">{row.file.name}</p>
                <p
                  role={row.status === "failed" ? "alert" : "status"}
                  className={cn("flex items-center gap-1.5 text-label", row.status === "failed" ? "text-danger-fg" : row.status === "stored" ? "text-success-fg" : "text-fg-muted")}
                >
                  {row.status === "uploading" && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
                  {row.status === "stored" && <CircleCheck aria-hidden="true" className="size-3" />}
                  {row.status === "failed" && <CircleAlert aria-hidden="true" className="size-3" />}
                  <span>
                    {STATUS_TEXT[row.status]}
                    {row.status === "failed" && row.error ? `: ${row.error}` : ""}
                    {row.status !== "failed" ? ` · ${sizeText(row.file.size)}` : ""}
                  </span>
                </p>
              </div>
              {row.status === "failed" && !row.final && (
                <Button type="button" variant="secondary" size="sm" startIcon={<RotateCw />} onClick={() => retry(row)} aria-label={`Retry ${row.file.name}`}>
                  Retry
                </Button>
              )}
              {(row.status === "stored" || row.status === "failed") && (
                <button
                  type="button"
                  onClick={() => dismiss(row.id)}
                  aria-label={`Dismiss ${row.file.name}`}
                  className="inline-flex size-control-compact shrink-0 items-center justify-center rounded-sm text-fg-muted hover:text-fg focus-visible:focus-ring max-lg:size-control"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
