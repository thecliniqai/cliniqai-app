"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import * as webhooksService from "./service";

export type { WebhookSubscriptionItem, WebhookDeliveryLogItem, AllowedWebhookEvent } from "./service";

// Each action authenticates and checks clinic:manage before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.

type Result<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

function revalidate() {
  try {
    revalidatePath("/settings/developer");
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

export async function listWebhookSubscriptions(): Promise<Result<typeof webhooksService.listWebhookSubscriptions>> {
  const resolved = await resolveServiceContext("clinic:manage");
  if (!resolved.ok) return { success: false, subscriptions: [], error: resolved.error };
  return webhooksService.listWebhookSubscriptions(resolved.ctx);
}

export async function createWebhookSubscription(data: {
  endpointUrl: string;
  eventTypes: string[];
}): Promise<Result<typeof webhooksService.createWebhookSubscription>> {
  const resolved = await resolveServiceContext("clinic:manage");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await webhooksService.createWebhookSubscription(resolved.ctx, data);
  if (result.success) revalidate();
  return result;
}

export async function deleteWebhookSubscription(
  subscriptionId: string
): Promise<Result<typeof webhooksService.deleteWebhookSubscription>> {
  const resolved = await resolveServiceContext("clinic:manage");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await webhooksService.deleteWebhookSubscription(resolved.ctx, subscriptionId);
  if (result.success) revalidate();
  return result;
}

export async function testPingWebhook(subscriptionId: string): Promise<Result<typeof webhooksService.testPingWebhook>> {
  const resolved = await resolveServiceContext("clinic:manage");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return webhooksService.testPingWebhook(resolved.ctx, subscriptionId);
}

export async function listDeliveryLogs(subscriptionId: string): Promise<Result<typeof webhooksService.listDeliveryLogs>> {
  const resolved = await resolveServiceContext("clinic:manage");
  if (!resolved.ok) return { success: false, logs: [], error: resolved.error };
  return webhooksService.listDeliveryLogs(resolved.ctx, subscriptionId);
}
