"use client";

import { Download, ExternalLink } from "lucide-react";
import { DropdownItem } from "@/components/ui/dropdown";
import { openInstallSheet } from "@/components/shell/install-sheet";
import { promptInstall, useInstallMode } from "@/lib/pwa/install";
import { chromeIntentUrl, type InstallMode } from "@/lib/pwa/platform";

/**
 * "Install app" (V2-06 06-06; PWA_STRATEGY §6.1-§6.3). One action per install path:
 * - `prompt` (Chromium with a captured `beforeinstallprompt`): the browser's own install prompt;
 * - `ios-sheet`: the three-step sheet;
 * - `open-in-chrome` (Android in-app browser): opens this page in Chrome (`intent://`, host and path only);
 * - `open-in-safari` (iOS in-app browser): the "Open in Safari" guidance sheet.
 * Hidden (`none`) when installed, standalone, or not installable from here. The More sheet gets the same entry with
 * the shell (06-04b).
 */
export function installEntryLabel(mode: InstallMode): string | null {
  if (mode === "open-in-chrome") return "Open in Chrome";
  if (mode === "open-in-safari") return "Open in Safari";
  if (mode === "prompt" || mode === "ios-sheet") return "Install app";
  return null;
}

export function runInstallAction(mode: InstallMode): void {
  if (mode === "prompt") void promptInstall();
  else if (mode === "ios-sheet") openInstallSheet("ios");
  else if (mode === "open-in-safari") openInstallSheet("safari");
  else if (mode === "open-in-chrome") window.location.href = chromeIntentUrl(window.location);
}

/** The user-menu item; renders nothing when there is no install path. */
export function InstallMenuItem() {
  const mode = useInstallMode();
  const label = installEntryLabel(mode);
  if (!label) return null;
  return (
    <DropdownItem
      type="button"
      data-install-entry={mode}
      icon={mode === "open-in-chrome" || mode === "open-in-safari" ? <ExternalLink aria-hidden="true" /> : <Download aria-hidden="true" />}
      onClick={() => runInstallAction(mode)}
    >
      {label}
    </DropdownItem>
  );
}
