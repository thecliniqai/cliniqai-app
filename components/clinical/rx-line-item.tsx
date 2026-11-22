"use client";

import { useId, useState } from "react";
import { OctagonAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import { frequencyWords, lineDuration, type RxLine } from "@/lib/clinical/rx";
import { allergyReasonError } from "@/features/prescriptions/allergy";

/**
 * RxLineItem (V2-06 06-03b; 06-UI-SPEC RxLineItem, CD-34; DESIGN_SYSTEM §7.6): one prescription line in an `<ol>`.
 * Grid `20px · drug · how · remove`: the index; the drug (body-md 500) with form in label fg-muted and the generic and
 * instruction on line 2; how = option pills on white with a hairline — frequency (600, tracking 0.04em, proportional
 * figures, read as "1-0-1, morning 1, afternoon 0, night 1"), timing, duration ("5 days") — each pill edits the dose;
 * remove (IconButton `sm`, "Remove Paracetamol 650 mg"; the caller shows the 8 s Undo toast, CD-34). Rows have a
 * hairline and min-height 40. A "Repeated" marker stays until the doctor reviews the line. An allergy match turns the
 * row `danger-bg` with "Matches allergy: Penicillin" and "Prescribe anyway…", which asks for a reason before it
 * clears. Below 768 px the pills wrap under the drug (two-line item).
 */
export interface RxLineItemProps {
  index: number;
  line: RxLine;
  onEdit?: () => void;
  onRemove?: () => void;
  /** Inserted from a template or "Repeat last Rx" and not yet reviewed. */
  repeated?: boolean;
  /** The allergy this drug matches (salt mapping is V2-09); the line stays flagged until overridden with a reason. */
  allergyMatch?: string | null;
  onOverride?: (reason: string) => void;
  /** A line under the row: "Prescribed despite allergy: …" or "Checked by name only" (V2-09c 09C-02). */
  note?: { text: string; tone: "info" | "danger" } | null;
  /** A sealed or otherwise read-only record (V2-09c R-5): the dose is plain text, with no pills to edit and no remove button. */
  readOnly?: boolean;
  className?: string;
}

const PILL = cn(
  "inline-flex min-h-6.5 min-w-7.5 cursor-pointer items-center justify-center rounded-sm border border-border bg-surface px-1.5 text-label font-medium whitespace-nowrap text-fg-secondary hover:border-border-control hover:bg-hover hover:text-fg touch:min-h-control touch:min-w-control",
  TRANSITION,
  FOCUS_RING,
);

export function RxLineItem({ index, line, onEdit, onRemove, repeated = false, allergyMatch, onOverride, note, readOnly = false, className }: RxLineItemProps) {
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonId = useId();
  const name = line.medicine.name;
  const flagged = Boolean(allergyMatch);
  const duration = lineDuration(line);

  return (
    <li
      data-rx-line=""
      data-flagged={flagged || undefined}
      className={cn(
        "grid min-h-10 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1.5 border-b border-border py-2 last:border-b-0 md:grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] md:items-center",
        flagged && "rounded-md border-b-0 bg-danger-bg px-2",
        className,
      )}
    >
      <span aria-hidden="true" className="pt-0.5 text-right text-label text-fg-muted tabular-nums md:pt-0">
        {index}
      </span>
      <div className="min-w-0">
        <p className="text-body-md font-medium text-fg">
          {name} <span className="text-label font-normal text-fg-muted">{line.medicine.form}</span>
          {repeated && (
            <span className="ml-1.5 inline-flex h-4.5 items-center rounded-pill border border-border-strong px-1.5 align-middle text-caption font-semibold text-fg-secondary">
              Repeated
            </span>
          )}
        </p>
        {(line.medicine.generic !== name || line.instruction) && (
          <p className="text-label text-fg-muted">
            {[line.medicine.generic !== name ? line.medicine.generic : null, line.instruction].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      {readOnly ? (
        <p className="col-start-2 row-start-2 text-label text-fg-secondary md:col-start-3 md:row-start-1" data-rx-how="">
          <span className="sr-only">Dose: </span>
          {[line.frequency, line.timing, duration].filter(Boolean).join(" · ")}
        </p>
      ) : (
        <>
          <div className="col-start-2 row-start-2 flex flex-wrap gap-1 md:col-start-3 md:row-start-1" data-rx-how="">
            <button type="button" onClick={onEdit} aria-label={`${line.frequency}, ${frequencyWords(line.frequency)}. Edit dose of ${name}`} className={cn(PILL, "font-semibold tracking-[0.04em] text-fg normal-nums")}>
              {line.frequency}
            </button>
            {line.timing ? (
              <button type="button" onClick={onEdit} aria-label={`${line.timing}. Edit dose of ${name}`} className={PILL}>
                {line.timing}
              </button>
            ) : null}
            <button type="button" onClick={onEdit} aria-label={`${duration}. Edit dose of ${name}`} className={cn(PILL, "tabular-nums")}>
              {duration}
            </button>
          </div>
          <IconButton
            size="sm"
            label={`Remove ${name}`}
            icon={<X className="size-3.5" />}
            onClick={onRemove}
            className="col-start-3 row-start-1 md:col-start-4"
          />
        </>
      )}
      {note && (
        <p data-rx-note="" className={cn("col-span-full col-start-2 text-caption", note.tone === "danger" ? "text-danger-fg" : "text-fg-muted")}>
          {note.text}
        </p>
      )}
      {flagged && (
        <div className="col-span-full col-start-2 flex flex-col gap-1.5" data-allergy-match="">
          <p className="flex items-start gap-1.5 text-label text-danger-fg">
            <OctagonAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span>
              <span className="font-semibold">Matches allergy: {allergyMatch}</span> · Review it, remove it, or confirm with a reason
            </span>
          </p>
          {!overriding ? (
            <Button size="sm" variant="danger-quiet" className="self-start" onClick={() => setOverriding(true)}>
              Prescribe anyway…
            </Button>
          ) : (
            <form
              className="flex flex-wrap items-start gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const bad = allergyReasonError(reason);
                if (bad) {
                  setReasonError(bad);
                  return;
                }
                onOverride?.(reason.trim());
                setOverriding(false);
              }}
            >
              <div className="flex min-w-48 flex-1 flex-col gap-1">
                <Input
                  kind="name"
                  autoCapitalize="sentences"
                  aria-label="Reason to prescribe anyway"
                  aria-describedby={reasonError ? reasonId : undefined}
                  invalid={Boolean(reasonError)}
                  value={reason}
                  // The reason field opens on the doctor's press; focus moves into it.
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  onChange={(e) => {
                    setReason(e.target.value);
                    if (reasonError) setReasonError(null);
                  }}
                />
                {reasonError && (
                  <p id={reasonId} className="text-label text-danger-fg">
                    {reasonError}
                  </p>
                )}
              </div>
              <Button type="submit" size="md" variant="danger" requiresNetwork={false}>
                Prescribe anyway
              </Button>
              <Button size="md" variant="ghost" onClick={() => setOverriding(false)}>
                Cancel
              </Button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}
