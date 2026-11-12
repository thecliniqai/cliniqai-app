import "server-only";

import type { ServiceContext } from "@/lib/auth/context";
import { clientErrorMessage, errorTag } from "@/lib/errors/client-message";
import { InAppNotificationItem, NotificationCategory } from "@/lib/db/types";

export interface GetNotificationsOptions {
  category?: NotificationCategory;
  limit?: number;
  unreadOnly?: boolean;
}

export type GetNotificationsResult =
  { success: true; notifications: InAppNotificationItem[] } | { success: false; notifications: []; error: string };

export type UnreadCountResult = { success: true; count: number } | { success: false; count: 0; error: string };

/**
 * Fetches in-app notifications scoped strictly to the current tenant and authorized user/role.
 */
export async function getInAppNotifications(
  ctx: ServiceContext,
  options: GetNotificationsOptions = {}
): Promise<GetNotificationsResult> {
  const supabase = ctx.db;

  try {
    const session = ctx;
    const limit = options.limit || 50;

    // Start building query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from("in_app_notifications") as any).select("*").eq("tenant_id", session.tenantId);

    // Role-based & User-specific scoping (T-05-08, T-05-09):
    // A notification is visible if:
    // 1. It is directly targeted to the user: recipient_user_id = session.userId
    // 2. OR it is role-targeted matching user's role: recipient_role = session.role
    // 3. OR both recipient_user_id and recipient_role are NULL (clinic-wide broadcast)
    // Clinic Owners and Admins can also see system & billing role notices
    if (session.role === "doctor") {
      query = query.or(
        `recipient_user_id.eq.${session.userId},and(recipient_user_id.is.null,recipient_role.eq.doctor),and(recipient_user_id.is.null,recipient_role.is.null)`
      );
    } else if (session.role === "receptionist" || session.role === "nurse") {
      query = query.or(
        `recipient_user_id.eq.${session.userId},and(recipient_user_id.is.null,recipient_role.eq.${session.role}),and(recipient_user_id.is.null,recipient_role.is.null)`
      );
    } else {
      // Owner / Admin can see admin, owner, and unassigned notices
      query = query.or(
        `recipient_user_id.eq.${session.userId},and(recipient_user_id.is.null,recipient_role.in.(admin,owner,receptionist)),and(recipient_user_id.is.null,recipient_role.is.null)`
      );
    }

    if (options.category) {
      query = query.eq("category", options.category);
    }

    if (options.unreadOnly) {
      query = query.eq("is_read", false);
    }

    query = query.order("created_at", { ascending: false }).limit(limit);

    const { data, error } = await query;

    if (error) {
      console.error("[features/notifications/service] getInAppNotifications error:", errorTag(error));
      return { success: false, notifications: [], error: "Failed to load notifications." };
    }

    return { success: true, notifications: (data || []) as InAppNotificationItem[] };
  } catch (err: unknown) {
    return {
      success: false,
      notifications: [],
      error: clientErrorMessage(err, "Failed to load notifications.", "features/notifications/service getInAppNotifications"),
    };
  }
}

/**
 * Returns integer count of unread notifications for current user/role.
 */
export async function getUnreadNotificationCount(ctx: ServiceContext): Promise<UnreadCountResult> {
  const supabase = ctx.db;

  try {
    const session = ctx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from("in_app_notifications") as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .eq("is_read", false);

    if (session.role === "doctor") {
      query = query.or(
        `recipient_user_id.eq.${session.userId},and(recipient_user_id.is.null,recipient_role.eq.doctor),and(recipient_user_id.is.null,recipient_role.is.null)`
      );
    } else if (session.role === "receptionist" || session.role === "nurse") {
      query = query.or(
        `recipient_user_id.eq.${session.userId},and(recipient_user_id.is.null,recipient_role.eq.${session.role}),and(recipient_user_id.is.null,recipient_role.is.null)`
      );
    } else {
      query = query.or(
        `recipient_user_id.eq.${session.userId},and(recipient_user_id.is.null,recipient_role.in.(admin,owner,receptionist)),and(recipient_user_id.is.null,recipient_role.is.null)`
      );
    }

    const { count, error } = await query;

    if (error) {
      console.error("[features/notifications/service] getUnreadNotificationCount error:", errorTag(error));
      return { success: false, count: 0, error: "Failed to get unread count." };
    }

    return { success: true, count: count || 0 };
  } catch (err: unknown) {
    return {
      success: false,
      count: 0,
      error: clientErrorMessage(err, "Failed to get unread count.", "features/notifications/service getUnreadNotificationCount"),
    };
  }
}

/**
 * Marks a specific notification as read and records read_at timestamp.
 */
export async function markNotificationRead(
  ctx: ServiceContext,
  notificationId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = ctx.db;

  try {
    const session = ctx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("in_app_notifications") as any)
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq("id", notificationId)
      .eq("tenant_id", session.tenantId);

    if (error) {
      console.error("[features/notifications/service] markNotificationRead error:", errorTag(error));
      return { success: false, error: "Failed to mark notification read." };
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to mark notification read.", "features/notifications/service markNotificationRead"),
    };
  }
}

/**
 * Bulk marks all notifications in current scope as read.
 */
export async function markAllNotificationsRead(
  ctx: ServiceContext,
  category?: NotificationCategory
): Promise<{ success: boolean; updatedCount?: number; error?: string }> {
  const supabase = ctx.db;

  try {
    const session = ctx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from("in_app_notifications") as any)
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq("tenant_id", session.tenantId)
      .eq("is_read", false);

    if (category) {
      query = query.eq("category", category);
    }

    if (session.role === "doctor") {
      query = query.or(
        `recipient_user_id.eq.${session.userId},and(recipient_user_id.is.null,recipient_role.eq.doctor),and(recipient_user_id.is.null,recipient_role.is.null)`
      );
    } else if (session.role === "receptionist" || session.role === "nurse") {
      query = query.or(
        `recipient_user_id.eq.${session.userId},and(recipient_user_id.is.null,recipient_role.eq.${session.role}),and(recipient_user_id.is.null,recipient_role.is.null)`
      );
    } else {
      query = query.or(
        `recipient_user_id.eq.${session.userId},and(recipient_user_id.is.null,recipient_role.in.(admin,owner,receptionist)),and(recipient_user_id.is.null,recipient_role.is.null)`
      );
    }

    const { error, count } = await query;

    if (error) {
      console.error("[features/notifications/service] markAllNotificationsRead error:", errorTag(error));
      return { success: false, error: "Failed to mark all read." };
    }

    return { success: true, updatedCount: count || 0 };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to mark all read.", "features/notifications/service markAllNotificationsRead"),
    };
  }
}
