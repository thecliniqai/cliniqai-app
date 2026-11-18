import React from "react";
import { cn } from "@/lib/utils";

/**
 * Skeleton (V2-06 06-02c; 06-UI-SPEC Skeleton, CD-11, DESIGN_SYSTEM §6.9): static blocks in the `border` fill, as
 * shipped by 06-04a's route skeleton, with the radius of the element they stand in for. They pulse only when the
 * user allows motion (`motion-safe:animate-pulse`); there is no gradient shimmer (low-end GPUs). Blocks are
 * decorative (`aria-hidden`); the region that holds them is announced once as "Loading" (`SkeletonRegion`). Real
 * titles are shown at once, not skeletoned.
 */
export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** `text` lines use the 4 px radius (CD-05); `block` the element's own (pass a `rounded-*`), default radius-md. */
  shape?: "text" | "block" | "circle";
}

export function Skeleton({ shape = "block", className, ...props }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      data-skeleton=""
      className={cn(
        "block bg-border motion-safe:animate-pulse",
        shape === "text" ? "h-3 rounded" : shape === "circle" ? "rounded-pill" : "rounded-md",
        className,
      )}
      {...props}
    />
  );
}

/** The live region around skeleton blocks: `role="status"`, named and announced once ("Loading", "Loading patients"). */
export function SkeletonRegion({
  label = "Loading",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
