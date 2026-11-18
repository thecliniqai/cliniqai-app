import React from "react";
import { cn } from "@/lib/utils";

/**
 * Banner (V2-06 06-02c; 06-UI-SPEC Banner, DESIGN_SYSTEM §6.8, CD-23): page-level, full width, padding 8 16,
 * body-sm, a 16 px icon. Three tones from the component tokens: `trial` (`banner-trial-*`, info), `past-due`
 * (`banner-past-due-*`, warning) and `offline` (`banner-offline-*`, Midnight). Placement belongs to the shell (06-04b):
 * trial and past-due in flow under the top bar, offline fixed above the bottom bar (06-05's `OfflineBanner`).
 *
 * A banner present from the first paint needs no live role; one that appears because something changed (offline,
 * "Reconnecting…") passes `role="status"` so it is announced politely. `action` takes a link or a `link` Button.
 */
export type BannerTone = "trial" | "past-due" | "offline";

const TONE: Record<BannerTone, string> = {
  trial: "bg-(--banner-trial-bg) text-(--banner-trial-fg)",
  "past-due": "bg-(--banner-past-due-bg) text-(--banner-past-due-fg)",
  offline: "bg-(--banner-offline-bg) text-(--banner-offline-fg)",
};

export interface BannerProps {
  tone: BannerTone;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  role?: "status" | "alert";
  className?: string;
  children: React.ReactNode;
}

export function Banner({ tone, icon, action, role, className, children }: BannerProps) {
  return (
    <div
      role={role}
      data-banner={tone}
      className={cn("flex w-full items-center gap-2 px-4 py-2 text-body-sm", TONE[tone], className)}
    >
      {icon && (
        <span aria-hidden="true" className="flex shrink-0 [&_svg]:size-4">
          {icon}
        </span>
      )}
      <p className="min-w-0 grow">{children}</p>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
