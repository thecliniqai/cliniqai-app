"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import {
  getInAppNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/features/notifications/actions";
import { InAppNotificationItem, NotificationCategory } from "@/lib/db/types";

export type FilterCategory = NotificationCategory | "all";

export function useNotifications(pollIntervalMs = 30000) {
  const [notifications, setNotifications] = useState<InAppNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeCategory, setActiveCategory] = useState<FilterCategory>("all");
  const [, startTransition] = useTransition();

  const fetchCount = useCallback(async () => {
    try {
      const res = await getUnreadNotificationCount();
      if (res.success) {
        setUnreadCount(res.count);
      }
    } catch {
      // Silently fail on network disconnect
    }
  }, []);

  const fetchList = useCallback(async (category: FilterCategory) => {
    try {
      setLoading(true);
      const res = await getInAppNotifications({
        category: category === "all" ? undefined : category,
        limit: 50,
      });
      if (res.success) {
        setNotifications(res.notifications);
      }
    } catch {
      // Silently fail on network disconnect
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([fetchCount(), fetchList(activeCategory)]);
  }, [fetchCount, fetchList, activeCategory]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Periodic polling for unread count
  useEffect(() => {
    if (pollIntervalMs <= 0) return;
    const interval = setInterval(() => {
      fetchCount();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [pollIntervalMs, fetchCount]);

  // When active category tab changes, fetch matching notifications
  const selectCategory = useCallback((cat: FilterCategory) => {
    setActiveCategory(cat);
    fetchList(cat);
  }, [fetchList]);

  // Optimistic mark as read
  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));

    startTransition(async () => {
      await markNotificationRead(id);
    });
  }, []);

  // Optimistic mark all as read
  const markAllAsRead = useCallback(async () => {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
    );
    setUnreadCount(0);

    startTransition(async () => {
      await markAllNotificationsRead(activeCategory === "all" ? undefined : activeCategory);
    });
  }, [activeCategory]);

  return {
    notifications,
    unreadCount,
    loading,
    activeCategory,
    selectCategory,
    markAsRead,
    markAllAsRead,
    refresh,
  };
}
