import "server-only";

import { createPublicClient } from "@/lib/supabase/server";
import type { DocumentShareResourceType } from "@/lib/db/types";

/**
 * Public share-link resolution (P0-04, ADR-0005 D3). Every lookup goes through a token-scoped SECURITY DEFINER RPC
 * (000020) called with an anon-key client that has no session: the database binds the resource to the token's
 * tenant and `resource_type`, so a token minted for one tenant or type can never resolve another's record.
 * No service-role client is used here; signing a storage object lives in `features/sharing/system.ts`.
 */

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

/** Calls a token-scoped RPC with the session-less anon client (the generated Database typing does not cover rpc). */
export function publicRpc(name: string, args: Record<string, unknown>): Promise<RpcResult> {
  const client = createPublicClient() as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<RpcResult> };
  return client.rpc(name, args);
}

/** Kinds each public route accepts. */
export const DOCUMENT_LINK_KINDS: DocumentShareResourceType[] = ["patient_document", "prescription", "invoice", "referral"];
export const REPORT_LINK_KINDS: DocumentShareResourceType[] = ["patient_document"];

export interface PublicClinic {
  name: string | null;
  phone: string | null;
  address?: string | null;
  logo_url?: string | null;
}

export interface ResolvedShareDocument {
  resource_type: DocumentShareResourceType;
  title: string;
  document_type: string;
  original_filename: string;
  mime_type: string;
  report_date: string | null;
  file_size_bytes?: number | null;
  is_abnormal?: boolean | null;
  notes?: string | null;
  patient_name: string;
  expires_at: string;
  clinic: PublicClinic;
}

export type ShareTokenResolution =
  | { status: "ok"; document: ResolvedShareDocument }
  | { status: "revoked" | "expired"; clinic: PublicClinic | null }
  | { status: "not_found" };

/** Token shape accepted before any database call (64-hex today; a little slack, never unbounded). */
export function isPlausibleToken(token: unknown): token is string {
  return typeof token === "string" && token.length >= 32 && token.length <= 128 && /^[A-Za-z0-9_-]+$/.test(token);
}

export async function resolveShareToken(
  token: string,
  kinds: DocumentShareResourceType[]
): Promise<ShareTokenResolution> {
  if (!isPlausibleToken(token)) return { status: "not_found" };

  const { data, error } = await publicRpc("resolve_share_token", { p_token: token, p_kinds: kinds });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    if (error) console.error("[features/sharing/public-links] resolve_share_token failed:", error.code ?? "unknown");
    return { status: "not_found" };
  }

  const res = data as Record<string, unknown>;
  if (res.status === "ok") {
    const { status: _status, ...doc } = res;
    void _status;
    return { status: "ok", document: doc as unknown as ResolvedShareDocument };
  }
  if (res.status === "revoked" || res.status === "expired") {
    return { status: res.status, clinic: (res.clinic as PublicClinic | null) ?? null };
  }
  return { status: "not_found" };
}

export interface RescheduleContext {
  clinic: { name: string | null; phone: string | null; address: string | null } | null;
  doctor: {
    full_name?: string | null;
    default_specialty?: string | null;
    default_slot_duration_minutes?: number | null;
    availability_schedule?: unknown;
  };
  current_scheduled_at: string | null;
  booked: string[];
}

export type RescheduleContextResult =
  | { status: "ok"; context: RescheduleContext }
  | { status: "closed"; visitStatus: string }
  | { status: "revoked" | "expired" | "not_found" };

export async function getRescheduleContext(token: string, fromIso: string, toIso: string): Promise<RescheduleContextResult> {
  if (!isPlausibleToken(token)) return { status: "not_found" };

  const { data, error } = await publicRpc("get_reschedule_context", {
    p_token: token,
    p_from: fromIso,
    p_to: toIso,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    if (error) console.error("[features/sharing/public-links] get_reschedule_context failed:", error.code ?? "unknown");
    return { status: "not_found" };
  }

  const res = data as Record<string, unknown>;
  switch (res.status) {
    case "ok":
      return {
        status: "ok",
        context: {
          clinic: (res.clinic as RescheduleContext["clinic"]) ?? null,
          doctor: (res.doctor as RescheduleContext["doctor"]) ?? {},
          current_scheduled_at: (res.current_scheduled_at as string | null) ?? null,
          booked: Array.isArray(res.booked) ? (res.booked as string[]) : [],
        },
      };
    case "closed":
      return { status: "closed", visitStatus: String(res.visit_status ?? "closed") };
    case "revoked":
    case "expired":
      return { status: res.status };
    default:
      return { status: "not_found" };
  }
}

export type ConsumeRescheduleResult =
  | { status: "ok"; newScheduledAt: string }
  | { status: "closed"; visitStatus: string }
  | { status: "revoked" | "expired" | "not_found" | "invalid_time" | "too_far" | "slot_taken" };

/**
 * Single use: the token is revoked in the same transaction as the visit update (000020). The new time must be within
 * 90 days and must not overlap another active visit of the doctor (000021).
 */
export async function consumeRescheduleToken(token: string, newScheduledAt: string): Promise<ConsumeRescheduleResult> {
  if (!isPlausibleToken(token)) return { status: "not_found" };

  const { data, error } = await publicRpc("consume_reschedule_token", {
    p_token: token,
    p_new_at: newScheduledAt,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    if (error) console.error("[features/sharing/public-links] consume_reschedule_token failed:", error.code ?? "unknown");
    return { status: "not_found" };
  }

  const res = data as Record<string, unknown>;
  switch (res.status) {
    case "ok":
      return { status: "ok", newScheduledAt: String(res.new_scheduled_at ?? newScheduledAt) };
    case "closed":
      return { status: "closed", visitStatus: String(res.visit_status ?? "closed") };
    case "revoked":
    case "expired":
    case "invalid_time":
    case "too_far":
    case "slot_taken":
      return { status: res.status };
    default:
      return { status: "not_found" };
  }
}
