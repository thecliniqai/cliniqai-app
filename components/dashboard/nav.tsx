"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  CreditCard,
  LayoutDashboard,
  Building2,
  Clock,
  Calendar,
} from "lucide-react";
import { UserRole } from "@/lib/db/types";

interface DashboardNavProps {
  tenantName: string;
  role: UserRole;
}

export function DashboardNav({ tenantName, role }: DashboardNavProps) {
  const pathname = usePathname();

  const isOwnerOrAdmin = role === "owner" || role === "admin";

  const navItems = [
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
    {
      label: "Staff & Team",
      href: "/staff",
      icon: Building2,
      active: pathname.startsWith("/staff"),
    },
    ...(isOwnerOrAdmin
      ? [
          {
            label: "Clinic Profile",
            href: "/settings/clinic",
            icon: Building2,
            active: pathname.startsWith("/settings/clinic"),
          },
          {
            label: "Subscription & Billing",
            href: "/settings/billing",
            icon: CreditCard,
            active: pathname.startsWith("/settings/billing"),
          },
        ]
      : []),
  ];

  return (
    <header className="border-b border-[#E5E4E0] bg-white sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-semibold text-lg text-[#1A1A1A] flex items-center gap-2">
            <span className="w-8 h-8 rounded bg-[#1769E0] text-white flex items-center justify-center font-bold text-sm">
              CQ
            </span>
            <span>{tenantName}</span>
          </Link>
          <span className="text-xs uppercase font-medium bg-[#F0EFEA] text-[#555] px-2 py-0.5 rounded">
            {role}
          </span>
        </div>

        <nav className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  item.active
                    ? "bg-[#1769E0]/10 text-[#1769E0] font-semibold"
                    : "text-[#555] hover:text-[#1A1A1A] hover:bg-[#F7F6F3]"
                }`}
                aria-current={item.active ? "page" : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
