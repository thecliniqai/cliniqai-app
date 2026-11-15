"use client";

import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { Tooltip } from "@/components/ui/tooltip";
import type { NavDestination, NavModel } from "@/lib/nav/nav-for-role";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import { NavIcon } from "./nav-icon";

/** Rail items: 44×44 (CD-22), radius-md, icon 18; active = nav tokens + a 3 px bar at the rail edge. */
const RAIL_ITEM = cn(
  "relative flex size-control shrink-0 items-center justify-center rounded-md text-(--nav-fg)",
  "hover:bg-surface-muted hover:text-fg",
  "aria-[current=page]:bg-(--nav-active-bg) aria-[current=page]:text-(--nav-active-fg)",
  "aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-2.5 aria-[current=page]:before:-left-1.5 aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-r-[2px] aria-[current=page]:before:bg-(--nav-active-indicator)",
  TRANSITION,
  FOCUS_RING,
);

function Item({ d, active }: { d: NavDestination; active: boolean }) {
  return (
    <Tooltip content={d.label} side="right">
      <Link href={d.href} aria-label={d.label} aria-current={active ? "page" : undefined} className={RAIL_ITEM} data-nav-id={d.id}>
        <NavIcon icon={d.icon} className="size-[18px]" />
      </Link>
    </Tooltip>
  );
}

/**
 * Rail (768–1279 px, and the consult's focus mode at every width ≥ 768; 06-UI-SPEC §6): 56 px, white, right hairline,
 * sticky and full height. BrandMark 36 (decorative: the destinations carry the names), the primary destinations, a
 * flexible space, the secondary destinations; it scrolls vertically when they do not fit (CD-22). Each item is named
 * by its destination and shows that name in a Tooltip to the right (pointer and keyboard focus, never on touch).
 */
export function Rail({
  model,
  activeId,
  className,
  navLabel = "Primary",
}: {
  model: NavModel;
  activeId: string | null;
  className?: string;
  navLabel?: string;
}) {
  return (
    <nav
      aria-label={navLabel}
      data-shell-nav="rail"
      className={cn(
        "w-rail flex-col items-center gap-1 overflow-y-auto overscroll-contain border-r border-border bg-surface pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5",
        className,
      )}
    >
      <BrandMark size={36} decorative className="mb-3 shrink-0" />
      {model.primary.map((d) => (
        <Item key={d.id} d={d} active={d.id === activeId} />
      ))}
      <div className="min-h-3 flex-1" />
      {model.secondary.map((d) => (
        <Item key={d.id} d={d} active={d.id === activeId} />
      ))}
    </nav>
  );
}
