"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { LogOut, Building, Shield, User } from "lucide-react";
import Link from "next/link";

export interface UserDropdownProps {
  userEmail: string;
  role: string;
  tenantName: string;
}

export function UserDropdown({ userEmail, role, tenantName }: UserDropdownProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    try {
      setSigningOut(true);
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } catch (err) {
      console.error("Sign out error:", err);
      setSigningOut(false);
    }
  };

  const initials = userEmail
    ? userEmail.slice(0, 2).toUpperCase()
    : "US";

  const trigger = (
    <div className="flex items-center gap-2 p-1 rounded-lg hover:bg-gray-100 transition-colors">
      <div className="w-9 h-9 rounded-full bg-[#1769E0] text-white flex items-center justify-center font-semibold text-xs shadow-theme-xs">
        {initials}
      </div>
      <div className="hidden sm:block text-start text-xs">
        <div className="font-medium text-gray-900 truncate max-w-[120px]">{userEmail}</div>
        <div className="text-gray-500 capitalize">{role}</div>
      </div>
    </div>
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

      <DropdownItem
        icon={<LogOut className="w-4 h-4 text-[#B42318]" />}
        danger
        onClick={handleSignOut}
        disabled={signingOut}
      >
        {signingOut ? "Signing out..." : "Sign Out"}
      </DropdownItem>
    </Dropdown>
  );
}
