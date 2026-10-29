"use client";

import React, { useState, useEffect } from "react";
import { useSidebar } from "./sidebar-context";
import { UserDropdown } from "./user-dropdown";
import { GlobalSearchModal } from "./global-search-modal";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { OperationsCopilotDrawer } from "@/components/ai/operations-copilot-drawer";
import { Menu, PanelLeftClose, PanelLeft, Search, Sparkles } from "lucide-react";

export interface AppHeaderProps {
  tenantName: string;
  role: string;
  userEmail: string;
}

export function AppHeader({ tenantName, role, userEmail }: AppHeaderProps) {
  const { isExpanded, toggleSidebar, toggleMobileSidebar } = useSidebar();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);

  // Global Cmd+K / Ctrl+K keyboard shortcut for CliniQ Copilot
  // Cmd+/ for Global Search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if inside input / textarea
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCopilotOpen((prev) => !prev);
      } else if (
        ((e.metaKey || e.ctrlKey) && e.key === "/") ||
        (!isInput && e.key === "/" && !e.metaKey && !e.ctrlKey)
      ) {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
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
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="relative w-full h-9 px-3 flex items-center justify-between text-xs rounded-lg border border-gray-200 bg-gray-50/60 text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 transition-colors cursor-pointer text-left shadow-2xs group"
          >
            <span className="flex items-center gap-2 truncate">
              <Search className="w-4 h-4 text-gray-400 group-hover:text-gray-600" />
              <span>Search patients, records...</span>
            </span>
            <kbd className="h-5 px-1.5 flex items-center text-[10px] font-medium text-gray-400 bg-white border border-gray-200 rounded shadow-2xs">
              /
            </kbd>
          </button>
        </div>

        {/* Right section: Mobile search, Copilot trigger, Notifications, User profile */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Mobile search trigger */}
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="md:hidden p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Search patients"
          >
            <Search className="w-5 h-5" />
          </button>

          {/* CliniQ Operations Copilot Trigger Button */}
          <button
            type="button"
            onClick={() => setIsCopilotOpen((prev) => !prev)}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors cursor-pointer"
            title="CliniQ Copilot (⌘K)"
            aria-label="Toggle CliniQ Operations Copilot"
          >
            <Sparkles className="w-4.5 h-4.5 text-[#1769E0]" />
          </button>

          <NotificationBell />

          <UserDropdown
            userEmail={userEmail}
            role={role}
            tenantName={tenantName}
          />
        </div>
      </header>

      {/* Global Search Palette Modal */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />

      {/* CliniQ Global Operations Copilot Drawer */}
      <OperationsCopilotDrawer
        open={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
      />
    </>
  );
}
