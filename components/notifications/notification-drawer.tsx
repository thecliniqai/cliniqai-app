"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import {
  X,
  CheckCheck,
  Stethoscope,
  Users,
  Receipt,
  AlertCircle,
  BellOff,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { InAppNotificationItem, NotificationCategory } from "@/lib/db/types";
import { FilterCategory } from "./use-notifications";

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: InAppNotificationItem[];
  unreadCount: number;
  loading: boolean;
  activeCategory: FilterCategory;
  onSelectCategory: (category: FilterCategory) => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
}

function formatRelativeTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "Just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays === 1) return "Yesterday";
    return `${diffDays}d ago`;
  } catch {
    return "";
  }
}

function getCategoryIcon(category: NotificationCategory) {
  switch (category) {
    case "clinical":
      return <Stethoscope className="w-4 h-4 text-[#1769E0]" />;
    case "queue":
      return <Users className="w-4 h-4 text-emerald-700" />;
    case "billing":
      return <Receipt className="w-4 h-4 text-purple-700" />;
    case "system":
    default:
      return <AlertCircle className="w-4 h-4 text-amber-700" />;
  }
}

function getCategoryBadgeBg(category: NotificationCategory) {
  switch (category) {
    case "clinical":
      return "bg-blue-50";
    case "queue":
      return "bg-emerald-50";
    case "billing":
      return "bg-purple-50";
    case "system":
    default:
      return "bg-amber-50";
  }
}

export function NotificationDrawer({
  isOpen,
  onClose,
  notifications,
  unreadCount,
  loading,
  activeCategory,
  onSelectCategory,
  onMarkAsRead,
  onMarkAllAsRead,
}: NotificationDrawerProps) {
  // ESC keyboard listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const categories: { key: FilterCategory; label: string }[] = [
    { key: "all", label: "All" },
    { key: "clinical", label: "Clinical" },
    { key: "queue", label: "Queue" },
    { key: "billing", label: "Billing" },
    { key: "system", label: "System" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      {/* Semi-transparent backdrop */}
      <div
        className="fixed inset-0 bg-black/25 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <div className="relative w-full max-w-[400px] bg-white h-full shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-[#111827]">Notifications</h2>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-[#1769E0] text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllAsRead}
                className="text-xs text-[#1769E0] hover:text-[#0F5AB8] hover:underline font-medium flex items-center gap-1 cursor-pointer"
                title="Mark all notifications as read"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              aria-label="Close notification drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Category Tabs */}
        <div className="px-4 py-2.5 border-b border-gray-100 bg-[#F9FAFB] flex items-center gap-1.5 overflow-x-auto shrink-0 no-scrollbar">
          {categories.map((cat) => {
            const isSelected = activeCategory === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => onSelectCategory(cat.key)}
                className={`text-xs px-3 py-1 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-[#EAF2FF] text-[#1769E0] font-semibold"
                    : "text-[#52565B] hover:text-[#111827] hover:bg-gray-200/60"
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Notification List Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {loading && notifications.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3 my-auto">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                <BellOff className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#111827]">All caught up</h3>
                <p className="text-xs text-[#52565B] mt-1 max-w-[240px]">
                  You have no unread notifications or pending patient replies.
                </p>
              </div>
            </div>
          ) : (
            notifications.map((item) => {
              const icon = getCategoryIcon(item.category);
              const badgeBg = getCategoryBadgeBg(item.category);
              const relativeTime = formatRelativeTime(item.created_at);

              const content = (
                <div
                  className={`p-3.5 rounded-xl border transition-all flex items-start gap-3 relative ${
                    item.is_read
                      ? "bg-white border-gray-200 hover:border-gray-300"
                      : "bg-[#F9FBFF] border-blue-100 hover:border-blue-200 shadow-2xs"
                  }`}
                  onClick={() => {
                    if (!item.is_read) {
                      onMarkAsRead(item.id);
                    }
                  }}
                >
                  {/* Category icon */}
                  <div
                    className={`w-9 h-9 rounded-full ${badgeBg} flex items-center justify-center shrink-0 mt-0.5`}
                  >
                    {icon}
                  </div>

                  {/* Body text */}
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="text-xs font-semibold text-[#111827] truncate">
                        {item.title}
                      </span>
                      <span className="text-[10px] text-gray-400 shrink-0 font-medium">
                        {relativeTime}
                      </span>
                    </div>

                    <p className="text-xs text-[#52565B] line-clamp-2 leading-relaxed">
                      {item.message}
                    </p>

                    {item.link_url && (
                      <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1769E0] hover:underline">
                        <span>Open Details</span>
                        <ChevronRight className="w-3 h-3" />
                      </div>
                    )}
                  </div>

                  {/* Unread indicator dot */}
                  {!item.is_read && (
                    <span
                      className="w-2 h-2 rounded-full bg-[#1769E0] shrink-0 mt-1.5"
                      title="Unread"
                    />
                  )}
                </div>
              );

              if (item.link_url) {
                return (
                  <Link
                    key={item.id}
                    href={item.link_url}
                    onClick={() => {
                      if (!item.is_read) onMarkAsRead(item.id);
                      onClose();
                    }}
                    className="block cursor-pointer"
                  >
                    {content}
                  </Link>
                );
              }

              return (
                <div key={item.id} className="cursor-pointer">
                  {content}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
