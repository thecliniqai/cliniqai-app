"use client";

import React, { useState } from "react";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { LogOut, Building, Shield, User, MonitorSmartphone } from "lucide-react";
import Link from "next/link";

export interface UserDropdownProps {
  userEmail: string;
  role: string;
  tenantName: string;
}

/**
 * V2-03 03-12b (AUTH-04b, PWA D-5): sign-out is a plain form POST to `/auth/signout`, which revokes the session at
 * GoTrue, deletes the auth cookies and sends `Clear-Site-Data: "cache"`. It replaces the client `signOut()` (whose
 * default scope signed the user out of every device). "Sign out of all devices" posts `scope=global`.
 *
 * The forms stop the click from reaching the menu's close handler: closing unmounts the form before the browser
 * submits it, which would cancel the submission.
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
  onSubmit: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <form method="post" action="/auth/signout" role="none" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
      <input type="hidden" name="scope" value={scope} />
      <DropdownItem type="submit" icon={icon} danger aria-disabled={pending || undefined}>
        {children}
      </DropdownItem>
    </form>
  );
}

export function UserDropdown({ userEmail, role, tenantName }: UserDropdownProps) {
  const [signingOut, setSigningOut] = useState<"local" | "global" | null>(null);

  const initials = userEmail
    ? userEmail.slice(0, 2).toUpperCase()
    : "US";

  // A real button, so the menu (and sign-out) is reachable from the keyboard; the click bubbles to the Dropdown toggle.
  const trigger = (
    <button
      type="button"
      aria-haspopup="menu"
      aria-label={`Account menu (${userEmail})`}
      className="flex items-center gap-2 p-1 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1769E0]"
    >
      <span className="w-9 h-9 rounded-full bg-[#1769E0] text-white flex items-center justify-center font-semibold text-xs shadow-theme-xs">
        {initials}
      </span>
      <span className="hidden sm:block text-start text-xs">
        <span className="block font-medium text-gray-900 truncate max-w-[120px]">{userEmail}</span>
        <span className="block text-gray-500 capitalize">{role}</span>
      </span>
    </button>
  );

  return (
    <Dropdown trigger={trigger} align="right" menuClassName="w-56 p-1.5">
      <div className="px-3 py-2 border-b border-gray-100 mb-1">
        <p className="text-xs font-semibold text-gray-900 truncate">{userEmail}</p>
        <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5 capitalize">
          <Shield className="w-3 h-3 text-[#1769E0]" />
          <span>{role} · {tenantName}</span>
        </p>
      </div>

      <Link href="/profile" className="block">
        <DropdownItem icon={<User className="w-4 h-4 text-gray-500" />}>
          My Profile
        </DropdownItem>
      </Link>

      {(role === "owner" || role === "admin") && (
        <Link href="/settings/clinic" className="block">
          <DropdownItem icon={<Building className="w-4 h-4 text-gray-500" />}>
            Clinic Profile
          </DropdownItem>
        </Link>
      )}

      <div className="my-1 border-t border-gray-100" />

      <SignOutForm
        scope="local"
        pending={signingOut !== null}
        onSubmit={() => setSigningOut("local")}
        icon={<LogOut className="w-4 h-4 text-[#B42318]" aria-hidden="true" />}
      >
        {signingOut === "local" ? "Signing out…" : "Sign out"}
      </SignOutForm>
      <SignOutForm
        scope="global"
        pending={signingOut !== null}
        onSubmit={() => setSigningOut("global")}
        icon={<MonitorSmartphone className="w-4 h-4 text-[#B42318]" aria-hidden="true" />}
      >
        {signingOut === "global" ? "Signing out…" : "Sign out of all devices"}
      </SignOutForm>
    </Dropdown>
  );
}
