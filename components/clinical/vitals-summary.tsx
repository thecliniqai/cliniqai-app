"use client";

import { Activity, TriangleAlert } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/variants";
import { flagWord, isCritical, summarizeVitals, type SummaryItem, type VitalsReading } from "@/lib/clinical/vitals";

/**
 * VitalsSummary (V2-06 06-03b; 06-UI-SPEC VitalsSummary; DESIGN_SYSTEM §7.3): the inline vitals line of a queue row or
 * the consult context. At most three items ("BP 150/95 · P 88 · 98.6°F", label 12 fg-muted, tabular), flagged values
 * first, a flagged value in danger-fg 600 with the word "high" or "low" (never colour alone). When more were recorded
 * the line is a button that opens the full list in a Popover. Nothing recorded: the "Vitals pending" outline chip
 * (white, warning-fg text and border).
 */
export interface VitalsSummaryProps {
  vitals: VitalsReading | null | undefined;
  className?: string;
}

function Item({ item }: { item: SummaryItem }) {
  const word = flagWord(item.flag);
  if (!word) return <span>{item.text}</span>;
  return (
    <span className="font-semibold text-danger-fg" data-vital-flag={item.flag}>
      {item.text} {word.toLowerCase()}
    </span>
  );
}

function joined(items: SummaryItem[]) {
  return items.map((item, i) => (
    <span key={item.text}>
      {i > 0 && <span aria-hidden="true"> · </span>}
      <Item item={item} />
    </span>
  ));
}

export function VitalsSummary({ vitals, className }: VitalsSummaryProps) {
  const { shown, all } = summarizeVitals(vitals ?? {});
  if (all.length === 0) {
    return (
      <span
        data-vitals="pending"
        className={cn(
          "inline-flex h-pill shrink-0 items-center gap-1 rounded-pill border border-warning-fg bg-surface px-1.75 text-caption font-semibold whitespace-nowrap text-warning-fg",
          className,
        )}
      >
        <TriangleAlert aria-hidden="true" strokeWidth={2} className="size-3" />
        Vitals pending
      </span>
    );
  }

  const line = (
    <>
      <Activity aria-hidden="true" className="size-3.25 shrink-0" />
      <span className="sr-only">Vitals: </span>
      <span>{joined(shown)}</span>
    </>
  );
  const base = "inline-flex min-w-0 items-center gap-1 text-label text-fg-muted tabular-nums";

  if (all.length <= shown.length) {
    return (
      <span data-vitals="summary" className={cn(base, className)}>
        {line}
      </span>
    );
  }
  return (
    <Popover>
      <PopoverTrigger
        data-vitals="summary"
        className={cn(base, "-mx-1 min-h-6 cursor-pointer rounded-sm px-1 text-left hover:text-fg touch:min-h-control", FOCUS_RING, className)}
      >
        {line}
        <span className="sr-only">, show all {all.length} vitals</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <p className="mb-2 text-caption font-semibold tracking-caps text-fg-muted uppercase">Vitals</p>
        <ul className="flex flex-col gap-1 text-body-sm text-fg tabular-nums">
          {all.map((item) => (
            <li key={item.text} className="flex items-center justify-between gap-3">
              <span className={cn(item.flag !== "normal" && "font-semibold text-danger-fg")}>{item.text}</span>
              {flagWord(item.flag) && (
                <span className={cn("text-label font-semibold", isCritical(item.flag) ? "text-danger-fg" : "text-warning-fg")}>
                  {isCritical(item.flag) ? `${flagWord(item.flag)} · critical` : flagWord(item.flag)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
