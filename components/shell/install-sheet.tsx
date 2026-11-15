"use client";

import { useSyncExternalStore } from "react";
import { Share, SquarePlus, ToggleRight } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
} from "@/components/ui/responsive-sheet";
import { BrandMark } from "@/components/brand/brand-mark";
import { PRODUCT_NAME } from "@/lib/design/brand";

/**
 * The install instructions sheet (V2-06 06-06; PWA_STRATEGY §6.2, §6.3; 06-UI-SPEC install surface, BrandMark 44 px).
 *
 * - `ios`: iOS and iPadOS Safari cannot be prompted; three steps: "Tap Share", "Choose Add to Home Screen", "Keep 'Open
 *   as Web App' on and tap Add", plus "You'll need to sign in once inside the app" (the Home Screen app has its own
 *   cookie jar, E10).
 * - `safari`: an iOS in-app browser (WhatsApp, Gmail…) cannot install; how to open the page in Safari instead.
 *
 * Opened from the user menu's entry and the Today card (`openInstallSheet`); one host is mounted by `PwaRuntime`.
 */
export type InstallSheetKind = "ios" | "safari";

let openKind: InstallSheetKind | null = null;
const listeners = new Set<() => void>();

function setOpen(kind: InstallSheetKind | null): void {
  openKind = kind;
  for (const listener of [...listeners]) listener();
}

export function openInstallSheet(kind: InstallSheetKind): void {
  setOpen(kind);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const IOS_STEPS = [
  { icon: Share, text: "Tap Share" },
  { icon: SquarePlus, text: "Choose Add to Home Screen" },
  { icon: ToggleRight, text: "Keep 'Open as Web App' on and tap Add" },
] as const;

export function InstallSheetHost() {
  const kind = useSyncExternalStore(subscribe, () => openKind, () => null);
  return (
    <ResponsiveSheet open={kind !== null} onOpenChange={(open) => !open && setOpen(null)}>
      {kind !== null && (
        <ResponsiveSheetContent data-install-sheet={kind} aria-describedby={undefined}>
          <ResponsiveSheetHeader
            title={kind === "ios" ? `Install ${PRODUCT_NAME} on this device` : "Open in Safari to install"}
          />
          <ResponsiveSheetBody>
            <div className="flex items-center gap-3">
              <BrandMark size={44} decorative />
              <p className="text-body-sm text-fg-secondary">
                {kind === "ios"
                  ? `Add ${PRODUCT_NAME} to your Home Screen. It opens full screen, like an app.`
                  : `This page is open inside another app, which cannot install ${PRODUCT_NAME}.`}
              </p>
            </div>
            {kind === "ios" ? (
              <>
                <ol className="flex flex-col gap-3" aria-label="Steps">
                  {IOS_STEPS.map((step, index) => (
                    <li key={step.text} className="flex items-center gap-3 text-body-md text-fg">
                      <span
                        aria-hidden="true"
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-tint text-label font-semibold text-accent-fg"
                      >
                        {index + 1}
                      </span>
                      <step.icon className="size-5 shrink-0 text-fg-muted" aria-hidden="true" />
                      <span>{step.text}</span>
                    </li>
                  ))}
                </ol>
                <p className="rounded-md bg-sunken px-3 py-2 text-body-sm text-fg-secondary">
                  You&apos;ll need to sign in once inside the app.
                </p>
              </>
            ) : (
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-body-md text-fg" aria-label="Steps">
                <li>Open this app&apos;s menu (the ••• or share button).</li>
                <li>Choose Open in Safari (or Open in browser).</li>
                <li>In Safari, choose Install app from your account menu.</li>
              </ol>
            )}
          </ResponsiveSheetBody>
        </ResponsiveSheetContent>
      )}
    </ResponsiveSheet>
  );
}
