"use client";

import { Toaster } from "@/components/ui/toast";
import { useOnlineStatus } from "@/lib/pwa/online";

/** Room for the offline banner (one line at ≥ 768 px, up to two on a phone) under the toast stack. */
const OFFLINE_BANNER_ROOM = 56;

/**
 * The shell's toast region (V2-06 06-04b step 5; 06-UI-SPEC Toast, CD-23): 06-02b's `sonner` Toaster, mounted once.
 * Phones: bottom-centre above the BottomBar (when the screen has one) plus 12 px and the safe area; ≥ 768 px:
 * bottom-right, 20 px in. While offline the stack rises above the offline banner. `notify.*` raises toasts from
 * anywhere in the app; the update toast (`update-toast.tsx`) is one of them.
 */
export function ShellToaster({ aboveBottomBar }: { aboveBottomBar: boolean }) {
  const online = useOnlineStatus();
  return <Toaster aboveBottomBar={aboveBottomBar} raisedBy={online ? 0 : OFFLINE_BANNER_ROOM} />;
}
