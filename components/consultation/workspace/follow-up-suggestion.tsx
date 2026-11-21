"use client";

import Link from "next/link";
import { CalendarCheck, CalendarPlus } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { SmartAssistLabel } from "@/components/clinical/smart-assist-label";
import { durationLabel, type FollowUpPhrase } from "@/features/consultation/shorthand";
import { addDaysYmd } from "@/lib/datetime";
import { formatClinicDateWithWeekday } from "@/lib/datetime/format";

/** "Tue, 24 Nov": the weekday and day without the year. */
function shortDate(ymd: string): string {
  return formatClinicDateWithWeekday(ymd).replace(/ \d{4}$/, "");
}

/**
 * The follow-up proposal (V2-09b 09B-04b, R-15, AI-15): a follow-up the doctor already wrote down ("f/u 1 wk", "review after 3 days", "repeat HbA1c 3
 * months" in the advice or the notes) is offered as a labelled chip in Plan. Nothing is set until the doctor taps it (R-10); the words of the phrase
 * become the follow-up note. Deterministic, no model.
 */
export function FollowUpSuggestion({ phrase, today, onAccept }: { phrase: FollowUpPhrase; today: string; onAccept: (phrase: FollowUpPhrase) => void }) {
  const date = addDaysYmd(today, phrase.days);
  return (
    <div data-follow-up-suggestion="" className="mb-3 flex flex-col items-start gap-1.5 rounded-md border border-dashed border-border-strong bg-surface-soft p-2.5">
      <p className="flex flex-wrap items-center gap-x-2 text-label text-fg-muted">
        <SmartAssistLabel />
        <span>from &ldquo;{phrase.phrase}&rdquo; · set only when you tap</span>
      </p>
      <Button type="button" variant="secondary" size="sm" startIcon={<CalendarCheck />} onClick={() => onAccept(phrase)} data-follow-up-accept="">
        Set follow-up: {durationLabel(phrase)} ({shortDate(date)})
      </Button>
    </div>
  );
}

/**
 * "Book follow-up" (R-15): opens the booking sheet (the V2-08 search-parameter route `?book=1&patient=&doctor=&date=`, hosted by the dashboard layout, so it
 * opens over the consult) with the patient, the doctor and the follow-up date filled in. The doctor confirms the slot there; nothing is stored on the
 * sealed follow-up row. Once the patient has a booked or confirmed visit with this doctor from three days before the date onward, the link gives way
 * to a note.
 */
export function BookFollowUp({
  href,
  booked,
  date,
}: {
  /** null: the role may not book (appointments:edit). */
  href: string | null;
  booked: boolean;
  date: string;
}) {
  if (booked) {
    return (
      <p data-follow-up-booked="" className="mb-3 flex items-center gap-2 text-body-sm text-success-fg">
        <CalendarCheck aria-hidden="true" className="size-4" />A follow-up visit is booked for this patient around {shortDate(date)}.
      </p>
    );
  }
  if (!href) return null;
  return (
    <div className="mb-3">
      <Link href={href} scroll={false} data-book-follow-up="" className={buttonClassName({ variant: "secondary", size: "sm" })}>
        <CalendarPlus aria-hidden="true" className="size-4" />
        Book follow-up
      </Link>
    </div>
  );
}
