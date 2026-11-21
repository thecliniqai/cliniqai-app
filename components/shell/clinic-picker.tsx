"use client";

import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hardSignOut } from "@/lib/auth/hard-sign-out";
import { useClinicSwitch, type ClinicOption } from "./clinic-switcher";

/**
 * The clinic picker (V2-08 08-05, P1-12, R-17): what the `(dashboard)` layout renders, instead of the shell, for a user with two or
 * more clinics and none chosen on this device (the case `MultipleClinicsSelectionRequiredError` named; before this plan it was an
 * error page). Choosing a clinic runs the switcher (cookie, then a hard navigation to Today). No clinic data beyond the names the
 * user's own memberships give.
 */
export function ClinicPicker({ clinics }: { clinics: readonly ClinicOption[] }) {
  const { switchTo, pendingId, error } = useClinicSwitch();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4" data-clinic-picker="">
      <div className="w-full max-w-md rounded-md border border-border bg-surface p-6 shadow-popover">
        <h1 className="text-title-2 font-semibold text-fg">Choose a clinic</h1>
        <p className="mt-1 text-body-sm text-fg-muted">Your account belongs to more than one clinic. Pick the one to work in now; you can switch later from the menu.</p>
        <ul className="mt-4 flex flex-col gap-2">
          {clinics.map((c) => (
            <li key={c.id}>
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-start gap-2"
                loading={pendingId === c.id}
                disabled={pendingId !== null && pendingId !== c.id}
                onClick={() => void switchTo(c.id)}
                data-clinic-id={c.id}
              >
                <Building2 aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 truncate">{c.name}</span>
              </Button>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="mt-3 text-body-sm text-danger-fg">
            {error}
          </p>
        )}
        <div className="mt-5 border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => void hardSignOut("user")}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
