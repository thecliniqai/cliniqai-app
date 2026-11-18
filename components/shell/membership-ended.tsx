"use client";

import { useEffect } from "react";
import { hardSignOut } from "@/lib/auth/hard-sign-out";

export const MEMBERSHIP_ENDED_TEXT = "You no longer have access to this clinic. Signing you out…";

/**
 * V2-06 06-09c (M-REMOVED, adversarial B M-1): what the `(dashboard)` layout renders, instead of the shell, when the
 * clinic this device has open (the active-clinic cookie) is no longer one of the user's active memberships. Removal
 * means sign-out and purge (R-16, PWA §6.6), whatever the number of clinics left: never a silent switch to another
 * clinic. No clinic data is rendered; `hardSignOut("removed")` runs the cleanups, the purge and the navigation to
 * sign-in (the same reaction as a 403 from `/api/session-status` on an open page).
 */
export function MembershipEnded() {
  useEffect(() => {
    void hardSignOut("removed");
  }, []);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6" data-membership-ended="">
      <p role="status" className="text-body-md text-fg-secondary">
        {MEMBERSHIP_ENDED_TEXT}
      </p>
    </main>
  );
}
