import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { PRODUCT_NAME } from "@/lib/design/brand";
import type { NavDestination, NavModel } from "@/lib/nav/nav-for-role";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import { NavIcon } from "./nav-icon";
import { initialsOf, ROLE_LABEL, type ShellUser } from "./shell-user";

/** A sidebar item (06-UI-SPEC §6): 32 px (44 on touch), radius-sm, icon 16, gap 10, body-sm 500; active = nav tokens + bar. */
export const SIDEBAR_ITEM = cn(
  "relative flex min-h-control-compact items-center gap-2.5 rounded-sm px-2 text-body-sm font-medium text-(--nav-fg) touch:min-h-control",
  "hover:bg-surface-muted hover:text-fg",
  "aria-[current=page]:bg-(--nav-active-bg) aria-[current=page]:text-(--nav-active-fg)",
  "aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-[7px] aria-[current=page]:before:-left-2.5 aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-r-[2px] aria-[current=page]:before:bg-(--nav-active-indicator)",
  TRANSITION,
  FOCUS_RING,
);

function Item({ d, active }: { d: NavDestination; active: boolean }) {
  return (
    <Link href={d.href} aria-current={active ? "page" : undefined} className={SIDEBAR_ITEM} data-nav-id={d.id}>
      <NavIcon icon={d.icon} className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{d.label}</span>
    </Link>
  );
}

/**
 * Sidebar (≥ 1280 px; 06-UI-SPEC §6, `shared/proto.js` `shell()` at 3a78a5d): white, right hairline, 216 px, sticky
 * and full height. Clinic block (BrandMark 36, decorative beside the product name; the clinic name), the primary
 * destinations, a hairline, the secondary destinations, then the user block. No "+ New" in V2-06 (CD-21).
 */
export function Sidebar({
  model,
  activeId,
  clinicName,
  user,
  className,
  navLabel = "Primary",
}: {
  model: NavModel;
  activeId: string | null;
  clinicName: string;
  user: ShellUser;
  className?: string;
  /** The landmark's name ("Primary"; the gallery names its specimens differently). */
  navLabel?: string;
}) {
  return (
    <nav
      aria-label={navLabel}
      data-shell-nav="sidebar"
      className={cn(
        "w-sidebar flex-col gap-px overflow-y-auto overscroll-contain border-r border-border bg-surface px-2.5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]",
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-1.5 pt-0.5 pb-4">
        <BrandMark size={36} decorative />
        <div className="min-w-0">
          <p className="truncate text-body-md font-semibold tracking-title text-fg" title={clinicName}>
            {clinicName}
          </p>
          <p className="truncate text-label text-fg-muted">{PRODUCT_NAME}</p>
        </div>
      </div>
      {model.primary.map((d) => (
        <Item key={d.id} d={d} active={d.id === activeId} />
      ))}
      {model.secondary.length > 0 && <hr className="mx-1.5 my-2 border-0 border-t border-border" />}
      {model.secondary.map((d) => (
        <Item key={d.id} d={d} active={d.id === activeId} />
      ))}
      <div className="min-h-4 flex-1" />
      <div className="flex items-center gap-2.5 border-t border-border px-1 pt-2.5 pb-0.5">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-surface-muted text-caption font-semibold text-fg"
        >
          {initialsOf(user.email)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-body-sm text-fg">{user.email}</p>
          <p className="text-label text-fg-muted">{ROLE_LABEL[user.role]}</p>
        </div>
      </div>
    </nav>
  );
}
