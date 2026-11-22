"use client";

import { AlertTriangle, Lock } from "lucide-react";
import { SummaryBody, type SummaryContent } from "./summary-pane";

/**
 * The finish review (V2-09c 09C-05, R-13; V2-DX step E): the first screen of "Finish visit", read before anything is signed.
 *
 *  - "What the patient receives": the summary pane's own content (one source, `SummaryBody`), built from the draft the doctor has just written, the follow-up
 *    date in the clinic's zone.
 *  - Allergy matches that are still open (a medicine that matches a recorded allergy and has no reason): Sign is disabled until each is confirmed with a
 *    reason or removed, and every one links back to its line. This is the screen's gate; the sign command itself is unchanged (Q-5).
 *  - How the patient gets it: the WhatsApp message is the doctor's choice and is never ticked for them (CTO ruling Q-8). Print and Share PDF follow the sign.
 *  - The sign-off's consequence, in words.
 */
export interface UnresolvedAllergy {
  id: string;
  medicine: string;
  /** The allergies the line matches ("Penicillin, Amoxicillin"). */
  matches: string;
}

export interface FinishReviewProps {
  summary: SummaryContent;
  unresolved: readonly UnresolvedAllergy[];
  /** Closes the sheet and takes the doctor to the line. */
  onGoToLine: (itemId: string) => void;
  whatsapp: {
    /** The patient has a phone number and has not opted out. */
    available: boolean;
    /** Why it is not offered, when it is not. */
    unavailableReason?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  };
}

export function FinishReview({ summary, unresolved, onGoToLine, whatsapp }: FinishReviewProps) {
  return (
    <div data-finish-review="" className="flex flex-col gap-4">
      {unresolved.length > 0 && (
        <div data-finish-allergy="" role="alert" className="flex flex-col gap-2 rounded-lg border border-danger-border bg-danger-bg p-3.5 text-danger-fg">
          <p className="flex items-center gap-2 text-body-sm font-semibold">
            <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
            {unresolved.length === 1 ? "A medicine matches a recorded allergy" : `${unresolved.length} medicines match a recorded allergy`}
          </p>
          <p className="text-label">Signing is blocked until each one has a reason (&quot;Prescribe anyway&quot;) or is removed.</p>
          <ul className="flex flex-col gap-1.5">
            {unresolved.map((item) => (
              <li key={item.id} data-finish-allergy-item={item.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-body-sm">
                  <span className="font-semibold">{item.medicine}</span> · matches {item.matches}
                </span>
                <button
                  type="button"
                  onClick={() => onGoToLine(item.id)}
                  className="inline-flex min-h-control items-center rounded-sm px-2 text-label font-semibold underline underline-offset-2 focus-visible:focus-ring lg:min-h-control-compact"
                >
                  Go to {item.medicine}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section aria-label="What the patient receives" data-finish-summary="" className="rounded-lg border border-border bg-surface-soft p-3.5">
        <p className="mb-3 text-label font-semibold text-fg-secondary">What the patient receives</p>
        <SummaryBody content={summary} />
      </section>

      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-3.5">
        <label className="flex items-start gap-3 text-body-sm text-fg">
          <input
            type="checkbox"
            data-finish-whatsapp=""
            checked={whatsapp.available && whatsapp.checked}
            disabled={!whatsapp.available}
            onChange={(e) => whatsapp.onChange(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-accent"
          />
          <span>
            <span className="block font-semibold">Send the prescription and receipt on WhatsApp</span>
            <span className="block text-label text-fg-muted">
              {whatsapp.available
                ? "One message to the number on file, sent when you sign. Left unticked, nothing is sent; you can still print, share the PDF or send it after signing."
                : (whatsapp.unavailableReason ?? "Not available for this patient.")}
            </span>
          </span>
        </label>
      </div>

      <p data-finish-lock-note="" className="flex items-start gap-2 text-label text-fg-secondary">
        <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        Signing locks this prescription. Changes after signing are amendments with a reason.
      </p>
    </div>
  );
}
