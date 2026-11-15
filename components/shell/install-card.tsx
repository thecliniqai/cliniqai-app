"use client";

import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { installEntryLabel, runInstallAction } from "@/components/shell/install-entry";
import { PRODUCT_NAME } from "@/lib/design/brand";
import { dismissInstallCard, useInstallCardVisible, useInstallMode } from "@/lib/pwa/install";

/**
 * The Today install card (V2-06 06-06; PWA_STRATEGY §6.1): "Add CliniQ AI to your Home Screen". Rendered only by
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
      <BrandMark size={44} decorative />
      <div className="min-w-0 flex-1">
        <h2 id="install-card-title" className="text-title-3 text-fg">
          Add {PRODUCT_NAME} to your Home Screen
        </h2>
        <p className="mt-0.5 text-body-sm text-fg-secondary">Open it in one tap, full screen, like an app.</p>
      </div>
      <div className="flex gap-2">
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
