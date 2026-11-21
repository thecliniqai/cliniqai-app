import type { ReactNode } from "react";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

/**
 * One section of the consult note (06-UI-SPEC §7, V2-09b R-7): a label column (title-3, a one-line summary, the Alt shortcut hint on a fine
 * pointer) beside the body, hairline between sections, no card. Below 768 px the label sits above the body. The heading is the shortcut's focus
 * target (`tabIndex={-1}`: Alt+1 to Alt+5 move focus to it). The body is the existing v1 section; `flat` drops that section's own card chrome.
 */
export interface ConsultSectionProps {
  /** DOM id of the section (`complaints`, `examination`, `diagnosis`, `prescription`, `plan`); the heading is `${id}-title`. */
  id: string;
  title: string;
  /** 1 to 5: the Alt+n shortcut. */
  shortcut: number;
  /** One line under the title ("2 complaints", "Add a diagnosis"). */
  summary: ReactNode;
  /** Drop the hosted body's card border, padding and shadow (its content is unchanged). */
  flat?: boolean;
  children: ReactNode;
}

export function sectionTitleId(id: string): string {
  return `${id}-title`;
}

export function ConsultSection({ id, title, shortcut, summary, flat = false, children }: ConsultSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={sectionTitleId(id)}
      data-consult-section={id}
      className="scroll-mt-40 border-b border-border py-4 last:border-b-0 md:grid md:scroll-mt-2 md:grid-cols-[var(--label-col)_minmax(0,1fr)] md:max-[1179px]:[--label-col:6rem] md:gap-x-5 min-[1180px]:[--label-col:7.5rem]"
    >
      <div className="mb-3 flex min-w-0 flex-col gap-0.5 md:sticky md:top-0 md:mb-0 md:self-start md:pt-1">
        <h2
          id={sectionTitleId(id)}
          tabIndex={-1}
          aria-keyshortcuts={`Alt+${shortcut}`}
          className="flex items-center gap-2 rounded-xs text-title-3 font-semibold text-fg outline-none focus-visible:focus-ring"
        >
          {title}
          <Kbd className="hidden min-[1180px]:inline-flex">Alt {shortcut}</Kbd>
        </h2>
        <p data-section-summary="" className="text-label text-fg-muted md:line-clamp-3">
          {summary}
        </p>
      </div>
      <div
        className={cn(
          "min-w-0",
          flat &&
            "[&>div:first-child]:rounded-none [&>div:first-child]:border-0 [&>div:first-child]:bg-transparent [&>div:first-child]:p-0 [&>div:first-child]:shadow-none",
        )}
      >
        {children}
      </div>
    </section>
  );
}
