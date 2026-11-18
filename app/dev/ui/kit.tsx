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
  bleed = false,
  children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  /**
   * Phones: the section box spans the screen (its content keeps the 16 px gutter), so a specimen that is full bleed on
   * a phone screen (a Today lane, 06-UI-SPEC §7) can span it too and stays inside the section's capture (06-09e).
   */
  bleed?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-gallery-section={id}
      className={cn("flex flex-col gap-6", bleed && "max-sm:-mx-4 max-sm:px-4")}
    >
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
