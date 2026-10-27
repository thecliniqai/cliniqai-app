"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership, ActiveMembership } from "@/lib/auth/tenant";
import { InAppNotificationItem, NotificationCategory } from "@/lib/db/types";

export interface GetNotificationsOptions {
  category?: NotificationCategory;
  limit?: number;
  unreadOnly?: boolean;
}

export type GetNotificationsResult =
  | { success: true; notifications: InAppNotificationItem[] }
  | { success: false; notifications: []; error: string };

export type UnreadCountResult =
  | { success: true; count: number }
  | { success: false; count: 0; error: string };

/**
 * Fetches in-app notifications scoped strictly to the current tenant and authorized user/role.
 */
export async function getInAppNotifications(
  options: GetNotificationsOptions = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: any,
  sessionOverride?: ActiveMembership
): Promise<GetNotificationsResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await getActiveMembership());
    const limit = options.limit || 50;

    // Start building query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from("in_app_notifications") as any)
      .select("*")
      .eq("tenant_id", session.tenantId);

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
      console.error("[features/notifications/actions] getInAppNotifications error:", error);
      return { success: false, notifications: [], error: error.message };
    }

    return { success: true, notifications: (data || []) as InAppNotificationItem[] };
  } catch (err: unknown) {
    console.error("[features/notifications/actions] Exception in getInAppNotifications:", err);
    return {
      success: false,
      notifications: [],
      error: err instanceof Error ? err.message : "Failed to load notifications.",
    };
  }
}

/**
 * Returns integer count of unread notifications for current user/role.
 */
export async function getUnreadNotificationCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: any,
  sessionOverride?: ActiveMembership
): Promise<UnreadCountResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await getActiveMembership());

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
      console.error("[features/notifications/actions] getUnreadNotificationCount error:", error);
      return { success: false, count: 0, error: error.message };
    }

    return { success: true, count: count || 0 };
  } catch (err: unknown) {
    console.error("[features/notifications/actions] Exception in getUnreadNotificationCount:", err);
    return {
      success: false,
      count: 0,
      error: err instanceof Error ? err.message : "Failed to get unread count.",
    };
  }
}

/**
 * Marks a specific notification as read and records read_at timestamp.
 */
export async function markNotificationRead(
  notificationId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: any,
  sessionOverride?: ActiveMembership
): Promise<{ success: boolean; error?: string }> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await getActiveMembership());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("in_app_notifications") as any)
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq("id", notificationId)
      .eq("tenant_id", session.tenantId);

    if (error) {
      console.error("[features/notifications/actions] markNotificationRead error:", error);
      return { success: false, error: error.message };
    }

    try {
      revalidatePath("/", "layout");
    } catch {
      // Non-web test execution
    }

    return { success: true };
  } catch (err: unknown) {
    console.error("[features/notifications/actions] Exception in markNotificationRead:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to mark notification read.",
    };
  }
}

/**
 * Bulk marks all notifications in current scope as read.
 */
export async function markAllNotificationsRead(
  category?: NotificationCategory,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: any,
  sessionOverride?: ActiveMembership
): Promise<{ success: boolean; updatedCount?: number; error?: string }> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await getActiveMembership());

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
      console.error("[features/notifications/actions] markAllNotificationsRead error:", error);
      return { success: false, error: error.message };
    }

    try {
      revalidatePath("/", "layout");
    } catch {
      // Non-web test execution
    }

    return { success: true, updatedCount: count || 0 };
  } catch (err: unknown) {
    console.error("[features/notifications/actions] Exception in markAllNotificationsRead:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to mark all read.",
    };
  }
}
