import React from "react";
import { cn } from "@/lib/utils";

/**
 * EmptyState (V2-06 06-02c; 06-UI-SPEC EmptyState, DESIGN_SYSTEM §6.10): centred, padding 24 16, gap 6; a 24 px icon
 * in fg-icon (no illustration), a 14/600 title, one sentence in body-sm fg-muted, one primary action and an optional
 * secondary link. Copy is specific to the context ("No patients yet today", "Nothing matches these filters").
 *
 * v1 props kept (`icon`, `title`, `description`, `action`, `className`); the title stays an `h3` unless `headingLevel`
 * says otherwise. An `icon` is decorative and sized here, whatever classes the call site gave it.
 */
export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** An optional secondary link next to the action. */
  secondaryAction?: React.ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  headingLevel = 3,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <div
      data-empty-state=""
      className={cn("mx-auto flex max-w-md flex-col items-center gap-1.5 px-4 py-6 text-center", className)}
    >
      {icon && (
        <span aria-hidden="true" className="flex text-fg-icon [&_svg]:size-6">
          {icon}
        </span>
      )}
      <Heading className="text-title-3 font-semibold text-fg">{title}</Heading>
      {description && <p className="text-body-sm text-fg-muted">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
