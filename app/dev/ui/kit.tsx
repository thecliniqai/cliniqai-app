/**
 * Layout pieces of the `/dev/ui` gallery (V2-06 06-02a): a section per plan, a group per component, a labelled
 * specimen per state. Each later plan's section file uses these, so the gallery reads as one document. Server or Client
 * Components (no state).
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function GallerySection({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-gallery-section={id} className="flex flex-col gap-6">
      <div className="flex max-w-3xl flex-col gap-1.5 border-b border-border pb-3">
        <h2 id={`${id}-title`} className="font-display text-title-2 text-fg">
          {title}
        </h2>
        {intro && <p className="text-body-sm text-fg-muted">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

export function GalleryGroup({
  id,
  title,
  note,
  children,
  className,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="group" aria-labelledby={`${id}-title`} data-gallery-group={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id={`${id}-title`} className="text-title-3 font-semibold text-fg">
          {title}
        </h3>
        {note && <p className="max-w-3xl text-label text-fg-muted">{note}</p>}
      </div>
      <div className={cn("flex flex-wrap items-start gap-x-6 gap-y-4", className)}>{children}</div>
    </div>
  );
}

/** One state of one component, captioned with the state name (11 px caps eyebrow). */
export function Specimen({
  label,
  state,
  children,
  className,
}: {
  label: string;
  state?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-specimen={label} data-state={state} className={cn("flex min-w-0 flex-col items-start gap-1.5", className)}>
      <span className="text-caption font-semibold tracking-caps text-fg-muted uppercase">{label}</span>
      {children}
    </div>
  );
}
