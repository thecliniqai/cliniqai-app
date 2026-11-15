"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { Drawer, DrawerBody, DrawerContent, DrawerHeader } from "@/components/ui/drawer";
import { notify } from "@/components/ui/toast";
import type { NavDestination } from "@/lib/nav/nav-for-role";
import { useInstallMode } from "@/lib/pwa/install";
import { currentPageDeploymentId } from "@/lib/pwa/session-status";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import { installEntryLabel, runInstallAction } from "./install-entry";
import { NavIcon } from "./nav-icon";
import { checkForUpdatesNow } from "./pwa-runtime";

const ROW = cn(
  "flex min-h-control w-full cursor-pointer items-center gap-3 rounded-md px-3 text-start text-body-md text-fg hover:bg-surface-muted",
  "aria-[current=page]:bg-(--nav-active-bg) aria-[current=page]:text-(--nav-active-fg)",
  "[&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-fg-icon aria-[current=page]:[&_svg]:text-(--nav-active-fg)",
  TRANSITION,
  FOCUS_RING,
);

export const LATEST_TEXT = "You're on the latest version";
export const CHECK_FAILED_TEXT = "Couldn't check for updates. Try again when you're online.";

/**
 * More sheet (< 768 px; 06-UI-SPEC §6 "MoreSheet", IA §3.3 "More"): a bottom Drawer with every destination the
 * BottomBar has no cell for (the rest of the primary group, then the secondary group, v1 names), then "Install app"
 * when this device can install (hidden when installed or running standalone; 06-06's `installEntryLabel`), and "Check
 * for updates" with the running version. Rows are 44 px with an 18 px icon; the Drawer has its Close button, Escape
 * and the scrim (PWA §3.2: no dead ends).
 */
export function MoreSheet({
  open,
  onOpenChange,
  destinations,
  activeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: NavDestination[];
  activeId: string | null;
}) {
  const mode = useInstallMode();
  const installLabel = installEntryLabel(mode);
  const [checking, setChecking] = useState(false);
  const version = open ? currentPageDeploymentId() : null;

  async function checkUpdates() {
    setChecking(true);
    try {
      const outcome = await checkForUpdatesNow();
      onOpenChange(false);
      if (outcome === "update") return; // the update toast is showing
      if (outcome === "none") notify.info(LATEST_TEXT);
      // 06-09c (IND L-1): a check that got no answer (offline, timeout, 5xx) is not "latest".
      else if (outcome === "skipped" || outcome === "failed") notify.info(CHECK_FAILED_TEXT);
    } finally {
      setChecking(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined} data-more-sheet="">
        <DrawerHeader title="More" />
        <DrawerBody className="gap-1 px-3 py-2">
          <nav aria-label="More">
            <ul className="flex flex-col gap-0.5">
              {destinations.map((d) => (
                <li key={d.id}>
                  <Link
                    href={d.href}
                    aria-current={d.id === activeId ? "page" : undefined}
                    className={ROW}
                    onClick={() => onOpenChange(false)}
                    data-nav-id={d.id}
                  >
                    <NavIcon icon={d.icon} />
                    {d.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <hr className="mx-3 my-1 border-0 border-t border-border" />
          {installLabel && (
            <button
              type="button"
              className={ROW}
              data-install-entry={mode}
              onClick={() => {
                onOpenChange(false);
                runInstallAction(mode);
              }}
            >
              {mode === "open-in-chrome" || mode === "open-in-safari" ? <ExternalLink aria-hidden="true" /> : <Download aria-hidden="true" />}
              {installLabel}
            </button>
          )}
          <button
            type="button"
            className={ROW}
            aria-busy={checking || undefined}
            disabled={checking}
            onClick={() => void checkUpdates()}
            data-check-updates=""
          >
            <RefreshCw aria-hidden="true" className={cn(checking && "motion-safe:animate-spin")} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span>{checking ? "Checking for updates…" : "Check for updates"}</span>
              {version && <span className="truncate text-label text-fg-muted">Version {version}</span>}
            </span>
          </button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
