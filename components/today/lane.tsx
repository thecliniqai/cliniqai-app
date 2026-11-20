"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { QueueList } from "@/components/clinical/queue-row";
import { cn } from "@/lib/utils";
import { type TodayLane } from "@/features/today/schema";

/**
 * One Today lane (V2-08 08-03a; 06-UI-SPEC §7): a titled section with a 36 px head (name, count, optional caption), its
 * rows as a named list, or the lane's empty-state copy. At 1280 px and up the lanes sit side by side with the rows scrolling
 * inside the lane (`overscroll-behavior: contain`); below that the board shows one lane at a time (`shown`), the others
 * hidden, unless a filter is active (then every lane with a match stacks). The Done lane can collapse to a 44 px
 * vertical column at 1280 px and up (`collapsed`, with its toggle).
 */
export interface LaneProps {
  lane: TodayLane;
  count: number;
  /** The lane is on screen below 1280 px (the selected lane, or a lane with a filter match). */
  shown: boolean;
  /** Done only: collapsed to a column at 1280 px and up. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  children: React.ReactNode;
}

export function Lane({ lane, count, shown, collapsed = false, onToggleCollapsed, children }: LaneProps) {
  const headId = `lane-${lane.id}`;
  return (
    <section
      data-lane={lane.id}
      data-collapsed={collapsed || undefined}
      aria-labelledby={headId}
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-surface md:max-xl:flex-1 md:max-xl:overflow-y-auto md:max-xl:overscroll-contain",
        !shown && "max-xl:hidden",
        "xl:overflow-hidden xl:rounded-lg xl:border xl:border-border",
      )}
    >
      <div
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface-soft px-3.5 md:max-xl:sticky md:max-xl:top-0 md:max-xl:z-10 xl:px-2.5",
          collapsed && "xl:h-full xl:flex-col xl:justify-start xl:gap-3 xl:border-b-0 xl:px-0 xl:py-2",
        )}
      >
        <h2
          id={headId}
          className={cn(
            "flex items-baseline gap-1.5 text-body-sm font-semibold text-fg",
            collapsed && "xl:[writing-mode:vertical-rl]",
          )}
        >
          {lane.label}
          <span className="text-label font-normal text-fg-muted tabular-nums">
            <span className="sr-only">, </span>
            {count}
          </span>
        </h2>
        {lane.note && !collapsed && <span className="ml-auto text-caption text-fg-muted">{lane.note}</span>}
        {onToggleCollapsed && (
          <IconButton
            label={collapsed ? `Expand ${lane.label} lane` : `Collapse ${lane.label} lane`}
            icon={collapsed ? <ChevronLeft /> : <ChevronRight />}
            size="sm"
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
            className={cn("max-xl:hidden", !collapsed && "ml-auto", collapsed && "xl:order-first")}
          />
        )}
      </div>
      <div className={cn("min-h-0 flex-1 xl:overflow-y-auto xl:overscroll-contain", collapsed && "xl:hidden")}>
        {count === 0 ? (
          <p className="px-4 py-6 text-center text-body-sm text-fg-muted">{lane.empty}</p>
        ) : (
          <QueueList label={lane.label}>{children}</QueueList>
        )}
      </div>
    </section>
  );
}
