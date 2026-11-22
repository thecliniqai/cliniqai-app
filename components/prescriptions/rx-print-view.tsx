"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { buildRxContent, type RxContent } from "@/features/prescriptions/pdf/content";
import { effectiveMargins, PAPER } from "@/features/prescriptions/pdf/layout";
import type { PrescriptionPdfPayload } from "@/features/prescriptions/pdf/types";
import "./rx-print.css";

/**
 * The prescription's print view (V2-09c 09C-04, R-12; DESIGN_SYSTEM §7.10; CTO ruling Q-2): the signed Rx as the browser prints it. It reads the same words as
 * the PDF (`buildRxContent`) and the same paper and margins (`layout.ts`), so "Print Rx" on a screen and the PDF for WhatsApp agree. It is not on screen:
 * `RxPrintPortal` mounts it at the end of `<body>`, `rx-print.css` hides it until the browser prints and hides everything else then, and the `@page` rule it
 * writes sets the paper (A4 or A5) and the margins (the design margins on blank paper; the clinic's stationery margins on pre-printed paper, so nothing prints
 * over the letterhead).
 *
 * The page numbers ("Rx v1 · Page 1 of 2") are drawn by the browser in the bottom margin box on blank paper only: on pre-printed paper that box would sit over
 * the clinic's stationery, so the footer there is the version alone, inside the content area.
 */
export function RxPrintView({ content }: { content: RxContent }) {
  const hasExam = content.exam !== null;
  return (
    <article data-rx-print="" aria-hidden="true" className="bg-surface text-fg" style={{ fontSize: "9pt", lineHeight: 1.3 }}>
      {content.regenerated && (
        <p className="mb-2 border border-warning-fg p-1.5 font-semibold text-warning-fg">{content.regenerated}</p>
      )}
      {content.amendment && (
        <div className="mb-2 border border-warning-fg bg-warning-bg p-1.5">
          <p className="font-semibold text-warning-fg">{content.amendment.title}</p>
          {content.amendment.reason && <p className="text-warning-fg">{content.amendment.reason}</p>}
        </div>
      )}
      {content.letterhead && (
        <header className="mb-2 border-b border-border pb-2">
          <h1 className="font-semibold text-fg" style={{ fontSize: "16pt" }}>
            {content.letterhead.clinicName}
          </h1>
          {content.letterhead.address && <p className="text-fg-muted">{content.letterhead.address}</p>}
          <p className="text-fg-muted">{content.letterhead.contact}</p>
          {content.letterhead.statutory && <p className="text-fg-muted">{content.letterhead.statutory}</p>}
          <p className="mt-1 font-semibold" style={{ fontSize: "11pt" }}>
            {content.letterhead.doctorName}
          </p>
          <p className="text-fg-muted">{content.letterhead.doctorMeta}</p>
        </header>
      )}
      <section data-rx-print-keep="" className="mb-2 border border-border p-2">
        <p className="flex justify-between gap-2 font-semibold">
          <span>{content.patient.line}</span>
          <span>{content.patient.date}</span>
        </p>
        <p className="flex justify-between gap-2 text-fg-muted">
          <span>{content.patient.contact}</span>
          <span>{content.patient.visitId}</span>
        </p>
        {content.vitals.length > 0 && (
          <p className="mt-1 border-t border-border pt-1">
            {content.vitals.map((v) => (
              <span key={v.label} className="mr-3">
                {v.label}: <strong>{v.value}</strong>
              </span>
            ))}
          </p>
        )}
      </section>
      {content.complaints.length > 0 && (
        <section data-rx-print-keep="" className="mb-2">
          <h2 className="mb-1 border-b border-border font-semibold tracking-wide uppercase">Chief Complaints</h2>
          <ul>
            {content.complaints.map((c) => (
              <li key={c}>• {c}</li>
            ))}
          </ul>
        </section>
      )}
      {hasExam && content.exam && (
        <section data-rx-print-keep="" className="mb-2">
          <h2 className="mb-1 border-b border-border font-semibold tracking-wide uppercase">Examination</h2>
          {content.exam.general && <p>General signs: {content.exam.general}</p>}
          <ul>
            {content.exam.abnormal.map((line) => (
              <li key={line}>• {line}</li>
            ))}
          </ul>
          {content.exam.normal && <p>Normal: {content.exam.normal}</p>}
        </section>
      )}
      {content.diagnoses.length > 0 && (
        <section data-rx-print-keep="" className="mb-2">
          <h2 className="mb-1 border-b border-border font-semibold tracking-wide uppercase">Diagnoses</h2>
          <ul>
            {content.diagnoses.map((d) => (
              <li key={d}>• {d}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="mb-2">
        <h2 className="mb-1 border-b border-border font-semibold tracking-wide uppercase">
          Rx · Prescribed Medications
        </h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-surface-muted text-left">
              <th className="border border-border p-1" style={{ width: "5%" }}>
                #
              </th>
              <th className="border border-border p-1" style={{ width: "45%" }}>
                Medicine &amp; Generic Salt
              </th>
              <th className="border border-border p-1" style={{ width: "15%" }}>
                Dosage
              </th>
              <th className="border border-border p-1" style={{ width: "20%" }}>
                Timing
              </th>
              <th className="border border-border p-1" style={{ width: "15%" }}>
                Duration
              </th>
            </tr>
          </thead>
          <tbody>
            {content.medications.map((m) => (
              <tr key={m.n} className="align-top" style={{ breakInside: "avoid" }}>
                <td className="border border-border p-1">{m.n}</td>
                <td className="border border-border p-1">
                  <strong>{m.name}</strong>
                  {m.generic && <span className="block text-fg-muted">{m.generic}</span>}
                  {m.note && <span className="block text-info-fg">{m.note}</span>}
                </td>
                <td className="border border-border p-1">{m.dosage}</td>
                <td className="border border-border p-1">{m.timing}</td>
                <td className="border border-border p-1">{m.duration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {content.investigations.length > 0 && (
        <section data-rx-print-keep="" className="mb-2">
          <h2 className="mb-1 border-b border-border font-semibold tracking-wide uppercase">Advised Investigations</h2>
          <ul>
            {content.investigations.map((t) => (
              <li key={t}>• {t}</li>
            ))}
          </ul>
        </section>
      )}
      {content.advice.length > 0 && (
        <section data-rx-print-keep="" className="mb-2">
          <h2 className="mb-1 border-b border-border font-semibold tracking-wide uppercase">Advice &amp; Lifestyle Instructions</h2>
          <ul>
            {content.advice.map((a) => (
              <li key={a}>• {a}</li>
            ))}
          </ul>
        </section>
      )}
      {content.followUp && (
        <section data-rx-print-keep="" className="mb-2">
          <h2 className="mb-1 border-b border-border font-semibold tracking-wide uppercase">Follow-Up</h2>
          <p>{content.followUp}</p>
        </section>
      )}
      <section data-rx-print-keep="" className="mt-4 flex justify-end">
        <div className="border-t border-border-strong pt-1.5" style={{ width: "190pt" }}>
          <p className="font-semibold" style={{ fontSize: "9.5pt" }}>
            {content.signature.doctor}
          </p>
          {content.signature.reg && <p className="text-fg-muted">{content.signature.reg}</p>}
          <p className="text-fg-muted">{content.signature.signedOn}</p>
        </div>
      </section>
      <footer className="mt-4 flex justify-between border-t border-border pt-1 text-fg-muted" style={{ fontSize: "7pt" }}>
        <span>{content.footerLeft}</span>
        <span>{content.preprinted ? `Rx v${content.version}` : ""}</span>
      </footer>
    </article>
  );
}

/** The `@page` rule of a prescription: its paper and its margins (CSS points). Exported for the tests. */
export function rxPageRule(payload: Pick<PrescriptionPdfPayload, "paper_size" | "letterhead_mode" | "letterhead_margins">, version: number): string {
  const paper = payload.paper_size === "A5" ? "A5" : "A4";
  const { scale } = PAPER[paper];
  const side = Math.round(36 * scale * 100) / 100;
  const preprinted = payload.letterhead_mode === "preprinted_letterhead";
  const { top, bottom } = preprinted ? effectiveMargins(payload) : { top: Math.round(36 * scale * 100) / 100, bottom: Math.round(40 * scale * 100) / 100 };
  // The page line is the browser's, in the bottom margin box, on blank paper only (that box would print over pre-printed stationery).
  const pageLine = preprinted ? "" : ` @bottom-right { content: "Rx v${version} · Page " counter(page) " of " counter(pages); font-size: 7pt; }`;
  return `@page { size: ${paper} portrait; margin: ${top}pt ${side}pt ${bottom}pt ${side}pt;${pageLine} }`;
}

const subscribe = () => () => undefined;

/**
 * Mounts the print view at the end of `<body>` (a sibling of the app, so `rx-print.css` can hide the app and show this) together with the `@page` rule of
 * this prescription. Renders nothing on the server and until the page has hydrated. The view is hidden from assistive technology: it is a print copy of what
 * the page already says.
 */
export function RxPrintPortal({ payload }: { payload: PrescriptionPdfPayload }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return null;
  const content = buildRxContent(payload);
  return createPortal(
    <div data-rx-print-root="" data-paper={content.paper} data-letterhead={payload.letterhead_mode}>
      <style>{rxPageRule(payload, content.version)}</style>
      <RxPrintView content={content} />
    </div>,
    document.body,
  );
}
