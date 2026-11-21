"use client";

import React, { useState } from "react";
import { Dropdown, DropdownItem, DropdownLink, DropdownSeparator } from "@/components/ui/dropdown";
import { LogOut, Building, Shield, User, MonitorSmartphone, Users } from "lucide-react";
import { hardSignOut } from "@/lib/auth/hard-sign-out";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import { InstallMenuItem } from "@/components/shell/install-entry";
import { initialsOf } from "@/components/shell/shell-user";
import { ClinicSwitchItems, type ClinicOption } from "@/components/shell/clinic-switcher";

export interface UserMenuProps {
  userEmail: string;
  role: string;
  tenantName: string;
  /** Every clinic the user belongs to and the open one: with two or more, the menu offers the others (V2-08 08-05, R-17). */
  clinics?: readonly ClinicOption[];
  activeClinicId?: string;
}

/**
 * V2-03 03-12b (AUTH-04b, PWA D-5): sign-out is a form POST to `/auth/signout`, which revokes the session at GoTrue,
 * deletes the auth cookies and sends `Clear-Site-Data: "cache"`. "Sign out of all devices" posts `scope=global`.
 *
 * V2-06 06-05 (PWA D-5, R-18): with JavaScript, each sign-out item calls `hardSignOut()` instead (the same server call,
 * then the device purge and a hard navigation to `/login`); the form POST stays as the no-JavaScript fallback.
 * "Switch user" is `hardSignOut("switch")`: the next person lands on a plain login page, nothing prefilled.
 *
 * The forms stop the click from reaching the menu's close handler: closing unmounts the form before its submit event,
 * which would cancel the submission.
 *
 * V2-06 06-02b (03-12b carry-over): the menu is the DropdownMenu adapter, so the account button announces
 * `aria-expanded`, the arrows move through the items (wrapping), Escape closes and focus returns to the button, and a
 * submit item keeps the menu (and its form) mounted while the form submits. The links are menu items themselves.
 *
 * V2-06 06-04b: re-homed as the top bar's account menu (06-UI-SPEC §6 TopBar): an avatar button (28 px initials in a
 * 36 px target, 44 on touch) named "Account menu", the v1 items and names, "Sign out" items last after a separator.
 * 06-09e (design review L4): "Switch user" sits with the v1 items, before the separator; signing out is not destructive,
 * so "Sign out" is neutral and only "Sign out of all devices" (it ends every other session) takes the danger colour.
 * No tooltip on the trigger: Escape returns focus to it, and a tooltip opening then would only repeat its name (the
 * 06-02b open item, decided here for every menu trigger in the shell).
 */
function SignOutForm({
  scope,
  pending,
  onSubmit,
  icon,
  children,
}: {
  scope: "local" | "global";
  pending: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <form method="post" action="/auth/signout" role="none" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
      <input type="hidden" name="scope" value={scope} />
      <DropdownItem type="submit" icon={icon} danger={scope === "global"} aria-disabled={pending || undefined}>
        {children}
      </DropdownItem>
    </form>
  );
}

export function UserMenu({ userEmail, role, tenantName, clinics = [], activeClinicId = "" }: UserMenuProps) {
  const [signingOut, setSigningOut] = useState<"local" | "global" | "switch" | null>(null);

  const signOut = (event: React.FormEvent<HTMLFormElement> | null, kind: "local" | "global" | "switch") => {
    event?.preventDefault();
    if (signingOut !== null) return;
    setSigningOut(kind);
    void hardSignOut(kind === "global" ? "everywhere" : kind === "switch" ? "switch" : "user");
  };

  // A real button, so the menu (and sign-out) is reachable from the keyboard; the click bubbles to the Dropdown toggle.
  const trigger = (
    <button
      type="button"
      aria-haspopup="menu"
      aria-label="Account menu"
      data-account-menu=""
      className={cn(
        "flex size-control-dense shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-surface-muted data-[state=open]:bg-surface-muted touch:size-control",
        TRANSITION,
        FOCUS_RING,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-pill bg-surface-muted text-caption font-semibold text-fg"
      >
        {initialsOf(userEmail)}
      </span>
    </button>
  );

  return (
    <Dropdown trigger={trigger} align="right" menuClassName="w-56">
      <div role="none" className="mb-1 border-b border-border px-2.5 py-2">
        <p className="truncate text-label font-semibold text-fg">{userEmail}</p>
        <p className="mt-0.5 flex items-center gap-1 text-caption text-fg-muted capitalize">
          <Shield className="size-3 text-fg-icon" aria-hidden="true" />
          <span>{role} · {tenantName}</span>
        </p>
      </div>

      <DropdownLink href="/profile" icon={<User aria-hidden="true" />}>
        My Profile
      </DropdownLink>

      {(role === "owner" || role === "admin") && (
        <DropdownLink href="/settings/clinic" icon={<Building aria-hidden="true" />}>
          Clinic Profile
        </DropdownLink>
      )}

      {/* V2-06 06-06 (PWA §6.1-§6.3): "Install app" / "Open in Chrome" / "Open in Safari" when an install path exists. */}
      <InstallMenuItem />

      {clinics.length > 1 && <ClinicSwitchItems clinics={clinics} activeId={activeClinicId} />}

      <DropdownItem
        type="button"
        icon={<Users aria-hidden="true" />}
        aria-disabled={signingOut !== null || undefined}
        onClick={(event) => {
          event.stopPropagation();
          signOut(null, "switch");
        }}
      >
        {signingOut === "switch" ? "Switching user…" : "Switch user"}
      </DropdownItem>

      <DropdownSeparator />

      <SignOutForm
        scope="local"
        pending={signingOut !== null}
        onSubmit={(event) => signOut(event, "local")}
        icon={<LogOut aria-hidden="true" />}
      >
        {signingOut === "local" ? "Signing out…" : "Sign out"}
      </SignOutForm>
      <SignOutForm
        scope="global"
        pending={signingOut !== null}
        onSubmit={(event) => signOut(event, "global")}
        icon={<MonitorSmartphone aria-hidden="true" />}
      >
        {signingOut === "global" ? "Signing out…" : "Sign out of all devices"}
      </SignOutForm>
    </Dropdown>
  );
}
