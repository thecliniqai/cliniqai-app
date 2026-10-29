"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { SidebarProvider, useSidebar } from "./sidebar-context";
import { AppSidebar } from "./app-sidebar";
import { AppHeader } from "./app-header";
import { Backdrop } from "./backdrop";
import { cn } from "@/lib/utils";

export interface AppLayoutShellProps {
  tenantName: string;
  role: string;
  userEmail: string;
  children: React.ReactNode;
}

function LayoutContent({
  tenantName,
  role,
  userEmail,
  children,
}: AppLayoutShellProps) {
  const { isExpanded } = useSidebar();
  const pathname = usePathname();
  const isConsultation = pathname?.startsWith("/consultation");

  return (
    <div className="min-h-screen bg-[#F7F6F3] flex flex-col">
      {/* Sidebar & Mobile Backdrop */}
      <AppSidebar tenantName={tenantName} role={role} />
      <Backdrop />

      {/* Main Content Area with dynamic left margin for sidebar */}
      <div
        className={cn(
          "flex-1 flex flex-col transition-all duration-300 ease-in-out",
          isExpanded ? "lg:ms-72" : "lg:ms-20"
        )}
      >
        {/* Sticky Header */}
        <AppHeader
          tenantName={tenantName}
          role={role}
          userEmail={userEmail}
        />

        {/* Page Content Container - Full width without boxing on consultation workspace */}
        <main
          className={cn(
            "flex-1 w-full",
            isConsultation
              ? "p-0 flex flex-col"
              : "max-w-7xl mx-auto p-4 sm:p-6 lg:p-8"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export function AppLayoutShell(props: AppLayoutShellProps) {
  return (
    <SidebarProvider>
      <LayoutContent {...props} />
    </SidebarProvider>
  );
}
