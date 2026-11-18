"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { hardSignOut } from "@/lib/auth/hard-sign-out";

/**
 * Sign-out on the locked and onboarding pages (V2-06 06-06, the 05-10b handover: "route it through hardSignOut() like
 * every other exit"). With JavaScript the submit runs `hardSignOut("user")` (server revocation, cleanups, the device
 * purge, a hard navigation to `/login`; PWA §4 D-5); the form POST to `/auth/signout` stays as the no-JavaScript
 * fallback, as in the user menu.
 */
export function AccessSignOut({ label }: { label: string }) {
  const [pending, setPending] = useState(false);
  return (
    <form
      method="post"
      action="/auth/signout"
      className="mt-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        void hardSignOut("user");
      }}
    >
      <input type="hidden" name="scope" value="local" />
      <Button type="submit" variant="outline" className="w-full sm:w-auto" requiresNetwork={false} aria-disabled={pending || undefined}>
        {label}
      </Button>
    </form>
  );
}
