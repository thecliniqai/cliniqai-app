"use client";

import React, { useState } from "react";
import { Bell } from "lucide-react";
import { useNotifications } from "./use-notifications";
import { NotificationDrawer } from "./notification-drawer";

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    loading,
    activeCategory,
    selectCategory,
    markAsRead,
    markAllAsRead,
  } = useNotifications();

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative p-2 rounded-lg text-[#52565B] hover:text-[#111827] hover:bg-gray-100 transition-colors cursor-pointer flex items-center justify-center"
        aria-label={`Notifications (${unreadCount} unread)`}
        title="View Notifications"
      >
        <Bell className="w-5 h-5" />

        {/* Dynamic unread counter badge pill */}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#1769E0] text-white text-[10px] font-bold flex items-center justify-center border-2 border-white shadow-xs">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <NotificationDrawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        notifications={notifications}
        unreadCount={unreadCount}
        loading={loading}
        activeCategory={activeCategory}
        onSelectCategory={selectCategory}
        onMarkAsRead={markAsRead}
        onMarkAllAsRead={markAllAsRead}
      />
    </>
  );
}
