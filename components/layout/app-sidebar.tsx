"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "./sidebar-context";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Clock,
  Calendar,
  Users,
  UserCheck,
  Building2,
  CreditCard,
  Stethoscope,
  ClipboardList,
  X,
} from "lucide-react";

export interface AppSidebarProps {
  tenantName: string;
  role: string;
}

export function AppSidebar({ tenantName, role }: AppSidebarProps) {
  const pathname = usePathname();
  const { isExpanded, isMobileOpen, closeMobileSidebar } = useSidebar();

  const isOwnerOrAdmin = role === "owner" || role === "admin";
  const isDoctor = role === "doctor";

  // Build role-scoped operations navigation
  const operationsNav = isDoctor
    ? [
        {
          label: "Doctor's Cabin",
          href: "/cabin",
          icon: Stethoscope,
          active: pathname.startsWith("/cabin"),
        },
        {
          label: "Visits",
          href: "/visits",
          icon: ClipboardList,
          active: pathname.startsWith("/visits"),
        },
        {
          label: "My Calendar",
          href: "/calendar",
          icon: Calendar,
          active: pathname.startsWith("/calendar"),
        },
        {
          label: "Patients",
          href: "/patients",
          icon: Users,
          active: pathname.startsWith("/patients"),
        },
      ]
    : [
        ...(isOwnerOrAdmin
          ? [
              {
                label: "Doctor's Cabin",
                href: "/cabin",
                icon: Stethoscope,
                active: pathname.startsWith("/cabin"),
              },
            ]
          : []),
        {
          label: "Dashboard",
          href: "/",
          icon: LayoutDashboard,
          active: pathname === "/",
        },
        {
          label: "Live Queue",
          href: "/queue",
          icon: Clock,
          active: pathname.startsWith("/queue"),
        },
        {
          label: "Visits",
          href: "/visits",
          icon: ClipboardList,
          active: pathname.startsWith("/visits"),
        },
        {
          label: "Calendar",
          href: "/calendar",
          icon: Calendar,
          active: pathname.startsWith("/calendar"),
        },
        {
          label: "Patients",
          href: "/patients",
          icon: Users,
          active: pathname.startsWith("/patients"),
        },
      ];

  const managementNav = [
    {
      label: "Staff & Team",
      href: "/staff",
      icon: UserCheck,
      active: pathname.startsWith("/staff"),
    },
    {
      label: "Clinic Profile",
      href: "/settings/clinic",
      icon: Building2,
      active: pathname.startsWith("/settings/clinic"),
    },
    {
      label: "Billing & Reports",
      href: "/billing/reports",
      icon: CreditCard,
      active: pathname.startsWith("/billing") || pathname.startsWith("/settings/billing"),
    },
  ];

  return (
    <aside
      className={cn(
        "fixed inset-y-0 start-0 z-50 flex flex-col bg-white border-e border-gray-200 transition-all duration-300 ease-in-out shadow-theme-xs",
        // Width behavior on desktop: expanded 288px (w-72), collapsed 80px (w-20)
        isExpanded ? "lg:w-72" : "lg:w-20",
        // Width and translation behavior on mobile: full 288px drawer
        "w-72",
        isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-gray-100">
        <Link
          href="/"
          className={cn(
            "flex items-center gap-3 transition-opacity",
            !isExpanded && "lg:justify-center lg:w-full"
          )}
        >
          <div className="w-9 h-9 rounded-xl bg-[#1769E0] text-white flex items-center justify-center font-bold text-sm shadow-theme-xs shrink-0">
            CQ
          </div>
          {(isExpanded || isMobileOpen) && (
            <div className="flex flex-col truncate">
              <span className="font-semibold text-gray-900 text-sm tracking-tight truncate">
                {tenantName}
              </span>
              <span className="text-[11px] text-gray-400 font-medium">
                ClinicOS Console
              </span>
            </div>
          )}
        </Link>

        {/* Mobile close button */}
        {isMobileOpen && (
          <button
            onClick={closeMobileSidebar}
            className="lg:hidden p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation Scroll Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-4 space-y-6">
        {/* Operations Section */}
        <div>
          {(isExpanded || isMobileOpen) ? (
            <h2 className="px-3 mb-2 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">
              Operations
            </h2>
          ) : (
            <div className="h-4 border-b border-gray-100 mb-2" />
          )}

          <nav className="space-y-1">
            {operationsNav.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 font-medium select-none",
                    item.active
                      ? "bg-[#EAF2FF] text-[#1769E0] font-semibold"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100",
                    !isExpanded && !isMobileOpen && "lg:justify-center lg:px-2"
                  )}
                  title={!isExpanded ? item.label : undefined}
                >
                  <Icon
                    className={cn(
                      "w-5 h-5 shrink-0 transition-colors",
                      item.active ? "text-[#1769E0]" : "text-gray-500"
                    )}
                  />
                  {(isExpanded || isMobileOpen) && (
                    <span className="truncate">{item.label}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Management Section (Owner / Admin only) */}
        {isOwnerOrAdmin && (
          <div>
            {(isExpanded || isMobileOpen) ? (
              <h2 className="px-3 mb-2 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">
                Management
              </h2>
            ) : (
              <div className="h-4 border-b border-gray-100 mb-2" />
            )}

            <nav className="space-y-1">
              {managementNav.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 font-medium select-none",
                      item.active
                        ? "bg-[#EAF2FF] text-[#1769E0] font-semibold"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100",
                      !isExpanded && !isMobileOpen && "lg:justify-center lg:px-2"
                    )}
                    title={!isExpanded ? item.label : undefined}
                  >
                    <Icon
                      className={cn(
                        "w-5 h-5 shrink-0 transition-colors",
                        item.active ? "text-[#1769E0]" : "text-gray-500"
                      )}
                    />
                    {(isExpanded || isMobileOpen) && (
                      <span className="truncate">{item.label}</span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </div>

      {/* Sidebar Footer with Role Status */}
      <div className="p-3 border-t border-gray-100 bg-gray-50/50">
        {(isExpanded || isMobileOpen) ? (
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs text-gray-500 font-medium">Logged in role</span>
            <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full bg-white border border-gray-200 text-[#1769E0]">
              {role}
            </span>
          </div>
        ) : (
          <div className="flex justify-center py-1">
            <span
              className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-100"
              title={`Role: ${role}`}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
