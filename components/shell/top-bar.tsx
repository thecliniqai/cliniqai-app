"use client";

import { Search } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { NotificationBell } from "@/components/notifications/notification-bell";
import type { BackStack } from "@/lib/nav/back-stack";
import { cn } from "@/lib/utils";
import { useShortcutLabel } from "@/lib/ui/shortcut-label";
import { CONTROL_STATE, FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import { BackButton } from "./back-button";
import { UserMenu } from "./user-menu";
import type { ClinicOption } from "./clinic-switcher";
import type { ShellUser } from "./shell-user";

export const PALETTE_PLACEHOLDER = "Search patients, queue and actions";


/**
 * TopBar (06-UI-SPEC §6): sticky, white, bottom hairline, 52 px (`--spacing-bar`) plus the top safe area, `<header>`.
 * Left to right: Back (non-root screens below 1280 px, always in focus mode) · on the phone's home screen a 28 px
 * BrandMark · the screen title (Manrope 20/26 700, one line) · the palette field (≥ 768 px, "Search patients, queue and
 * actions", Kbd ≥ 1024 on fine pointers) or the Search icon button (< 768 px) · the v1 NotificationBell · the account
 * menu. The title is static text from the nav model (no patient data, D-7). It is not a heading in V2-06: every v1
 * page keeps its own `h1` (06-04b step 6), so a second one here would break "one h1 per page".
 */
export function TopBar({
  title,
  showBack,
  backAlways,
  getBackStack,
  backParent,
  showHomeMark,
  sticky,
  onOpenPalette,
  paletteOpen,
  clinicName,
  user,
  clinics,
  activeClinicId,
}: {
  title: string;
  showBack: boolean;
  /** Focus mode: Back at every width. */
  backAlways: boolean;
  /** The in-app history, read when Back is pressed. */
  getBackStack: () => BackStack;
  backParent: string;
  showHomeMark: boolean;
  /** False in focus mode: the consult's own workspace header sticks instead (as in v1). */
  sticky: boolean;
  onOpenPalette: () => void;
  paletteOpen: boolean;
  clinicName: string;
  user: ShellUser;
  clinics?: readonly ClinicOption[];
  activeClinicId?: string;
}) {
  const shortcut = useShortcutLabel();
  return (
    <header
      data-shell-top-bar=""
      className={cn(
        "z-30 flex min-h-[calc(var(--spacing-bar)+env(safe-area-inset-top,0px))] shrink-0 items-center gap-2 border-b border-border bg-surface pt-safe pr-2 pl-4",
        sticky ? "sticky top-0" : "relative",
      )}
    >
      {showBack && <BackButton getStack={getBackStack} parent={backParent} className={cn(!backAlways && "xl:hidden")} />}
      {showHomeMark && <BrandMark size={28} decorative className="shrink-0 md:hidden" />}
      <p
        data-shell-title=""
        className="min-w-0 flex-1 truncate font-display text-title-1 font-bold text-fg md:flex-none md:shrink"
        title={title}
      >
        {title}
      </p>
      <div className="hidden min-w-0 flex-1 md:block" aria-hidden="true" />
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={paletteOpen}
        aria-keyshortcuts="Control+K Meta+K"
        onClick={onOpenPalette}
        data-palette-field=""
        className={cn(
          "hidden h-control-dense min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-start text-body-sm text-fg-placeholder md:flex md:max-w-100 touch:h-control",
          CONTROL_STATE.default,
          TRANSITION,
          FOCUS_RING,
        )}
      >
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-icon" />
        <span className="min-w-0 flex-1 truncate">{PALETTE_PLACEHOLDER}</span>
        <Kbd className="hidden lg:inline-flex">{shortcut}</Kbd>
      </button>
      <IconButton
        label="Search"
        icon={<Search />}
        tooltip={false}
        aria-haspopup="dialog"
        aria-expanded={paletteOpen}
        onClick={onOpenPalette}
        data-palette-button=""
        className="md:hidden"
      />
      <NotificationBell />
      <UserMenu userEmail={user.email} role={user.role} tenantName={clinicName} clinics={clinics} activeClinicId={activeClinicId} />
    </header>
  );
}
