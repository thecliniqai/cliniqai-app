"use client";

import React from "react";
import { useSidebar } from "./sidebar-context";
import { UserDropdown } from "./user-dropdown";
import { Menu, PanelLeftClose, PanelLeft, Search } from "lucide-react";

export interface AppHeaderProps {
  tenantName: string;
  role: string;
  userEmail: string;
}

export function AppHeader({ tenantName, role, userEmail }: AppHeaderProps) {
  const { isExpanded, toggleSidebar, toggleMobileSidebar } = useSidebar();

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6 shadow-theme-xs">
      {/* Left section: Hamburger / Toggle & Context */}
      <div className="flex items-center gap-3">
        {/* Mobile Hamburger Button */}
        <button
          onClick={toggleMobileSidebar}
          className="lg:hidden p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors cursor-pointer"
          aria-label="Open mobile navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Desktop Sidebar Toggle Button */}
        <button
          onClick={toggleSidebar}
          className="hidden lg:flex p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors cursor-pointer"
          aria-label="Toggle sidebar collapse"
        >
          {isExpanded ? (
            <PanelLeftClose className="w-5 h-5" />
          ) : (
            <PanelLeft className="w-5 h-5" />
          )}
        </button>

        {/* Clinic Title context */}
        <div className="hidden sm:flex items-center gap-2">
          <span className="font-semibold text-gray-900 text-sm tracking-tight">
            {tenantName}
          </span>
          <span className="text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
            {role}
          </span>
        </div>
      </div>

      {/* Center Search Shortcut (TailAdmin inspired) */}
      <div className="hidden md:flex items-center max-w-sm w-full mx-4">
        <div className="relative w-full">
          <span className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-gray-400">
            <Search className="w-4 h-4" />
          </span>
          <input
            type="text"
            placeholder="Search patients, appointments... (⌘K)"
            readOnly
            onClick={() => {
              // Can wire up a command palette in future or focus search
            }}
            className="w-full h-9 ps-9 pe-12 text-xs rounded-lg border border-gray-200 bg-gray-50/60 text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-[#1769E0] cursor-pointer"
          />
          <kbd className="absolute inset-y-0 end-0 my-auto me-2 h-5 px-1.5 flex items-center text-[10px] font-medium text-gray-400 bg-white border border-gray-200 rounded">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right section: User profile & controls */}
      <div className="flex items-center gap-2">
        <UserDropdown
          userEmail={userEmail}
          role={role}
          tenantName={tenantName}
        />
      </div>
    </header>
  );
}
