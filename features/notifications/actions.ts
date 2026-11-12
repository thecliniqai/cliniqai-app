"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import { NotificationCategory } from "@/lib/db/types";
import * as notificationsService from "./service";
import type { GetNotificationsOptions, GetNotificationsResult, UnreadCountResult } from "./service";

export type { GetNotificationsOptions, GetNotificationsResult, UnreadCountResult } from "./service";

// Each action resolves the caller's membership (tenant, user and role) from the session before it reads any
// input (ADR-0005 D1) and delegates to the server-only service. Failure shapes are unchanged.

function revalidateLayout() {
  try {
    revalidatePath("/", "layout");
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

/**
 * Fetches in-app notifications scoped strictly to the current tenant and authorized user/role.
 */
export async function getInAppNotifications(options: GetNotificationsOptions = {}): Promise<GetNotificationsResult> {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return { success: false, notifications: [], error: resolved.error };
  return notificationsService.getInAppNotifications(resolved.ctx, options);
}

/**
 * Returns integer count of unread notifications for current user/role.
 */
export async function getUnreadNotificationCount(): Promise<UnreadCountResult> {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return { success: false, count: 0, error: resolved.error };
  return notificationsService.getUnreadNotificationCount(resolved.ctx);
}

/**
 * Marks a specific notification as read and records read_at timestamp.
 */
export async function markNotificationRead(notificationId: string): Promise<{ success: boolean; error?: string }> {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await notificationsService.markNotificationRead(resolved.ctx, notificationId);
  if (result.success) revalidateLayout();
  return result;
}

/**
 * Bulk marks all notifications in current scope as read.
 */
export async function markAllNotificationsRead(
  category?: NotificationCategory
): Promise<{ success: boolean; updatedCount?: number; error?: string }> {
  const resolved = await resolveServiceContext();
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await notificationsService.markAllNotificationsRead(resolved.ctx, category);
  if (result.success) revalidateLayout();
  return result;
}
