"use client";

import React, { useState } from "react";
import { Bell } from "lucide-react";
import { useNotifications } from "./use-notifications";
import { NotificationDrawer } from "./notification-drawer";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";

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
        // V2-06 06-04b: re-homed in the top bar; the shell's target size (36 px, 44 on touch) and the focus ring.
        className={cn(
          "relative flex size-control-dense shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-secondary hover:bg-surface-muted hover:text-fg touch:size-control",
          TRANSITION,
          FOCUS_RING,
        )}
        aria-label={`Notifications (${unreadCount} unread)`}
        title="View Notifications"
      >
        <Bell aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />

        {/* Dynamic unread counter badge pill */}
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-pill border-2 border-surface bg-accent px-1 text-caption font-semibold text-fg-on-accent tabular-nums"
          >
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
