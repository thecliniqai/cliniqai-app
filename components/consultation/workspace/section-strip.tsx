"use client";

import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/variants";

/**
 * The section strip (phones, below 768 px; 06-UI-SPEC §7): sticky under the allergy strip, one 44 px pill per section with its count, the current
 * one filled. It follows the scroll (`active` comes from `useActiveSection`) and a tap scrolls to the section and moves focus to its heading.
 */
export interface StripSection {
  id: string;
  label: string;
  count?: number;
}

export function SectionStrip({
  sections,
  active,
  onSelect,
  onSummary,
}: {
  sections: readonly StripSection[];
  active: string;
  onSelect: (id: string) => void;
  /** Opens the Summary drawer (a phone has no summary pane). */
  onSummary?: () => void;
}) {
  return (
    <nav aria-label="Consultation sections" data-section-strip="" className="border-b border-border bg-surface md:hidden">
      <ul className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 py-1">
        {sections.map((section) => {
          const current = section.id === active;
          return (
            <li key={section.id} className="shrink-0">
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                onClick={() => onSelect(section.id)}
                className={cn(
                  "inline-flex min-h-control min-w-control cursor-pointer items-center gap-1.5 rounded-pill px-3 text-body-sm font-medium whitespace-nowrap",
                  FOCUS_RING,
                  current ? "bg-fg text-surface" : "bg-surface-muted text-fg-secondary",
                )}
              >
                {section.label}
                {section.count ? (
                  <span
                    className={cn(
                      "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-pill px-1 text-caption font-semibold tabular-nums",
                      current ? "bg-surface/20 text-surface" : "bg-surface text-fg-secondary",
                    )}
                  >
                    {section.count}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {onSummary && (
          <li className="shrink-0 border-l border-border pl-1.5">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={onSummary}
              className={cn(
                "inline-flex min-h-control min-w-control cursor-pointer items-center rounded-pill px-3 text-body-sm font-medium whitespace-nowrap text-accent-fg",
                FOCUS_RING,
              )}
            >
              Summary
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
