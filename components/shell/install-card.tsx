"use client";

import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { installEntryLabel, runInstallAction } from "@/components/shell/install-entry";
import { PRODUCT_NAME } from "@/lib/design/brand";
import { dismissInstallCard, useInstallCardVisible, useInstallMode } from "@/lib/pwa/install";

/**
 * The Today install card (V2-06 06-06; PWA_STRATEGY §6.1): the mark at the left of a Manrope 700 card title "Install
 * CliniQ AI on this device" and the privacy line, as `install_360` at 3a78a5d (06-09e, design review M5). Rendered only by
 * Today (`app/(dashboard)/(today)/page.tsx`), never on login, onboarding, a consult or checkout. It shows from the device's
 * second signed-in browser session on, while an install path exists (`useInstallMode`), and "Not now" hides it for
 * 30 days. Installed or standalone: never. Device preferences only (D-3), read after hydration
 * (`useSyncExternalStore`, so the server render and hydration show nothing).
 */
export function InstallCard() {
  const mode = useInstallMode();
  // The session count is kept by PwaRuntime (once per browser session); this re-renders when it or a dismissal changes.
  const visible = useInstallCardVisible(mode);

  const label = installEntryLabel(mode);
  if (!visible || !label) return null;
  return (
    <section
      aria-labelledby="install-card-title"
      data-install-card=""
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <BrandMark size={44} decorative className="shrink-0" />
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 id="install-card-title" className="font-display text-title-2 text-fg">
            Install {PRODUCT_NAME} on this device
          </h2>
          <p className="text-body-sm text-fg-secondary">
            Opens like an app, full screen, from your home screen. Patient data is not stored on the device.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="primary" size="sm" onClick={() => runInstallAction(mode)}>
          {label}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => dismissInstallCard()}
        >
          Not now
        </Button>
      </div>
    </section>
  );
}
