"use client";

import Link from "next/link";
import { Phone } from "lucide-react";
import { StatusChip } from "@/components/clinical/status-chip";
import { TokenChip } from "@/components/clinical/token-chip";
import { VitalsSummary } from "@/components/clinical/vitals-summary";
import { formatClinicTime } from "@/lib/datetime/format";
import { displayVisitStatus } from "@/lib/visit-status";
import { formatRupees, type TodayRow } from "@/features/today/schema";
import { AllergyFlag, originText } from "./today-row";

/**
 * The selected visit (V2-08 08-03a; 06-UI-SPEC §7): identity head (token, name, status, age and sex, doctor), then
 * hairline-separated sections with uppercase captions: Visit (origin, appointment time, priority), Vitals (for a role that
 * reads them), Timeline (booked, arrived) and Bill (a role with `billing:view`). It is the right-hand pane from 768 to
 * 1279 px and the content of the bottom drawer (phones) or side sheet (1280 px and up). Row actions live on the row; the
 * profile link is the way to the patient's record.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-3.5 py-2.5">
      <h3 className="mb-1.5 text-caption font-semibold tracking-caps text-fg-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function VisitDetail({ row, headingLevel = 2 }: { row: TodayRow; headingLevel?: 2 | 3 }) {
  const Heading = `h${headingLevel}` as "h2" | "h3";
  const entry = displayVisitStatus(row.status, row.balanceDue);
  const origin = originText(row) ?? (row.time ? `Appointment ${formatClinicTime(row.time)}` : null);
  const timeline: { label: string; detail: string }[] = [];
  if (row.time) timeline.push({ label: "Booked", detail: `${formatClinicTime(row.time)} slot` });
  if (row.arrivedAt) {
    timeline.push({
      label: row.origin === "walk_in" ? "Walk-in" : "Arrived",
      detail: `${formatClinicTime(row.arrivedAt)}${row.token != null ? ` · token ${row.token}` : ""}`,
    });
  }
  if (row.status === "in_consultation") timeline.push({ label: "With doctor", detail: row.doctorName });
  if (row.status === "completed") timeline.push({ label: "Seen", detail: row.doctorName });

  return (
    <article data-visit-detail={row.visitId} aria-label={`Visit of ${row.name}`} className="flex flex-col">
      <div className="flex items-start gap-3 px-3.5 py-3">
        <TokenChip token={row.token} time={row.time} status={row.status} balanceDue={row.balanceDue} size="large" />
        <div className="min-w-0 flex-1">
          <Heading className="font-display text-title-2 text-fg">{row.name}</Heading>
          <p className="mt-0.5 text-body-sm text-fg-muted">{[row.age, row.sex, row.doctorName].filter(Boolean).join(" · ")}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusChip status={entry.key} />
            {row.hasAllergy && <AllergyFlag />}
          </div>
        </div>
      </div>
      <Section title="Visit">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body-sm">
          <dt className="text-fg-muted">Doctor</dt>
          <dd className="text-fg">{row.doctorName}</dd>
          {origin && (
            <>
              <dt className="text-fg-muted">Source</dt>
              <dd className="text-fg">{origin}</dd>
            </>
          )}
          {row.priority && row.priority !== "normal" && (
            <>
              <dt className="text-fg-muted">Priority</dt>
              <dd className="text-fg capitalize">{row.priority}</dd>
            </>
          )}
          {row.overbooked && (
            <>
              <dt className="text-fg-muted">Slot</dt>
              <dd className="text-fg">Overbooked</dd>
            </>
          )}
          {row.phone && (
            <>
              <dt className="text-fg-muted">Mobile</dt>
              <dd className="text-fg">
                <a href={`tel:${row.phone}`} className="inline-flex min-h-6 items-center gap-1 tabular-nums underline-offset-2 hover:underline">
                  <Phone aria-hidden="true" className="size-3.5" />
                  {row.phone}
                </a>
              </dd>
            </>
          )}
        </dl>
      </Section>
      {(row.vitals || row.vitalsPending) && (
        <Section title="Vitals">
          <VitalsSummary vitals={row.vitals} />
        </Section>
      )}
      <Section title="Timeline">
        {timeline.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Not checked in yet.</p>
        ) : (
          <ol className="flex flex-col gap-1 text-body-sm">
            {timeline.map((t) => (
              <li key={t.label} className="flex justify-between gap-3">
                <span className="text-fg">{t.label}</span>
                <span className="text-fg-muted tabular-nums">{t.detail}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
      {row.balanceDue != null && (
        <Section title="Bill">
          <p className="text-body-sm text-fg tabular-nums">
            {row.balanceDue > 0 ? `${formatRupees(row.balanceDue)} due` : "Nothing due"}
          </p>
        </Section>
      )}
      <div className="border-t border-border px-3.5 py-2.5">
        <Link href={`/patients/${row.patientId}`} className="text-body-sm font-medium text-accent underline-offset-2 hover:underline">
          Open patient record
        </Link>
      </div>
    </article>
  );
}
