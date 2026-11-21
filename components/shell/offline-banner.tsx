"use client";

import { useEffect, useRef } from "react";
import { WifiOff } from "lucide-react";
import { useOnlineStatus, useStaleSince } from "@/lib/pwa/online";

/**
 * Offline banner (PWA_STRATEGY §3.6, DESIGN_SYSTEM offline banner; V2-06 06-05 step 9). The live region is always in
 * the DOM so assistive technology announces the change; it holds text only while offline. Data already on screen
 * stays visible (in memory, never persisted). Write buttons react to offline from 06-02a's Button primitive (R-32).
 *
 * 06-04b (CD-23): `--banner-offline-*` (Midnight); fixed at the viewport bottom, and above the BottomBar on phones while
 * the shell shows one (`data-bottom-bar="shown"` on the shell root). Copy unchanged.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const since = useStaleSince();
  const bar = useRef<HTMLParagraphElement>(null);

  // V2-08 08-03a (carried from 08-02): the banner is fixed at the bottom of the viewport and sits above a sheet, so on a
  // phone it covered the foot of a bottom sheet (its submit button). While it shows, its height (plus whatever it sits
  // above, the BottomBar) is published as `--offline-banner-h` on the root; the sheet and drawer placements stop that far
  // above the viewport bottom (components/ui/sheet.tsx), so the foot stays visible and clickable.
  useEffect(() => {
    const el = bar.current;
    const root = document.documentElement;
    if (online || !el) return;
    const publish = () => root.style.setProperty("--offline-banner-h", `${Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top))}px`);
    publish();
    const resize = new ResizeObserver(publish);
    resize.observe(el);
    // The banner moves (not resizes) when the BottomBar hides for the keyboard: the shell root's attributes change.
    const shell = el.closest("[data-app-shell]");
    const mutation = new MutationObserver(publish);
    if (shell) mutation.observe(shell, { attributes: true, attributeFilter: ["data-bottom-bar"] });
    window.addEventListener("resize", publish);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty("--offline-banner-h");
    };
  }, [online]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-offline-banner=""
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] max-md:group-data-[bottom-bar=shown]/shell:bottom-[calc(var(--spacing-bottom-bar)+env(safe-area-inset-bottom,0px))]"
    >
      {online ? null : (
        <p ref={bar} className="pointer-events-auto flex items-center justify-center gap-2 bg-(--banner-offline-bg) px-4 pt-2.5 pb-safe text-center text-body-sm text-(--banner-offline-fg) max-md:group-data-[bottom-bar=shown]/shell:pb-2.5">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            You&apos;re offline{since ? ` · showing data from ${since}` : ""}. Changes are disabled until you reconnect.
          </span>
        </p>
      )}
    </div>
  );
}
