import "server-only";

import { createPublicClient } from "@/lib/supabase/server";
import type { DocumentShareResourceType } from "@/lib/db/types";
import { isDeadlock, retryOnDeadlock } from "@/lib/db/retry";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

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
  /** The clinic's access level (`full` for every resolved document). */
  access?: string;
}

/**
 * V2-05 05-10a / 05-12 (SUB-D6, SUB §7.2; IND L-4): what an `expired` clinic's prescription link shows a pharmacy:
 * exactly the clinic name, the doctor's name and registration number, the issue date (the clinic's date) and whether
 * the prescription is valid. No patient name, no document title or file, no download.
 */
export interface PrescriptionVerification {
  clinicName: string | null;
  doctorName: string | null;
  doctorRegistrationNumber: string | null;
  issuedOn: string | null;
  valid: boolean;
}

export type ShareTokenResolution =
  | { status: "ok"; document: ResolvedShareDocument }
  /** SUB-D6: verification metadata only (an expired clinic's prescription); nothing is signed or served. */
  | { status: "restricted"; verification: PrescriptionVerification }
  | { status: "revoked" | "expired"; clinic: PublicClinic | null }
  /** V2-05 05-10a (SUB-02): the clinic's access level is not `full`; nothing about the document is returned. */
  | { status: "clinic_unavailable" }
  | { status: "not_found" };

/** V2-05 05-10a (SUB-02): the neutral text of every public page of a clinic that is not `full`. */
export const CLINIC_UNAVAILABLE_MESSAGE = "This clinic's online services are unavailable.";

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
    if (error) log.error({ event: "sharing.token_resolve.failed", code: errorTag(error), requestId: await getRequestId() });
    return { status: "not_found" };
  }

  const res = data as Record<string, unknown>;
  if (res.status === "ok" && res.restricted === true) {
    const v = (res.verification ?? {}) as Record<string, unknown>;
    const c = (res.clinic ?? {}) as Record<string, unknown>;
    const str = (x: unknown) => (typeof x === "string" && x.length > 0 ? x : null);
    return {
      status: "restricted",
      verification: {
        clinicName: str(c.name),
        doctorName: str(v.doctor_name),
        doctorRegistrationNumber: str(v.doctor_registration_number),
        issuedOn: str(v.issued_on),
        valid: v.valid === true,
      },
    };
  }
  if (res.status === "ok") {
    const { status: _status, ...doc } = res;
    void _status;
    return { status: "ok", document: doc as unknown as ResolvedShareDocument };
  }
  if (res.status === "revoked" || res.status === "expired") {
    return { status: res.status, clinic: (res.clinic as PublicClinic | null) ?? null };
  }
  if (res.status === "clinic_unavailable") return { status: "clinic_unavailable" };
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
  | { status: "revoked" | "expired" | "not_found" | "unavailable" | "clinic_unavailable" };

export async function getRescheduleContext(token: string, fromIso: string, toIso: string): Promise<RescheduleContextResult> {
  if (!isPlausibleToken(token)) return { status: "not_found" };

  const { data, error } = await publicRpc("get_reschedule_context", {
    p_token: token,
    p_from: fromIso,
    p_to: toIso,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    if (error) log.error({ event: "sharing.reschedule_context.failed", code: errorTag(error), requestId: await getRequestId() });
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
    case "unavailable":
    case "clinic_unavailable":
      return { status: res.status };
    default:
      return { status: "not_found" };
  }
}

export type ConsumeRescheduleResult =
  | { status: "ok"; newScheduledAt: string }
  | { status: "closed"; visitStatus: string }
  | {
      status: "revoked" | "expired" | "not_found" | "invalid_time" | "too_far" | "slot_taken" | "unavailable" | "clinic_unavailable";
    };

/**
 * Single use: the token is revoked in the same transaction as the visit update (000020). The new time must be within
 * 90 days and must not overlap another active visit of the doctor (000021).
 */
export async function consumeRescheduleToken(token: string, newScheduledAt: string): Promise<ConsumeRescheduleResult> {
  if (!isPlausibleToken(token)) return { status: "not_found" };

  // A concurrent write of an overlapping slot can make this call the deadlock victim (40P01) while the exclusion
  // constraint is checked; the whole call rolled back (the token stays usable), so it is retried once (V2-05 05-11c).
  const { data, error } = await retryOnDeadlock(() =>
    publicRpc("consume_reschedule_token", {
      p_token: token,
      p_new_at: newScheduledAt,
    })
  );
  // The function's own overlap check uses the doctor's default slot length; a visit longer than that can still overlap,
  // and the visits_no_double_booking constraint (V2-05 05-08) then refuses the update (23P01). The transaction rolls
  // back, so the token stays usable: report it as the taken slot it is. A deadlock that survived the retry is the same
  // race (an overlapping write won it).
  const code = (error as { code?: string } | null)?.code;
  if (code === "23P01" || isDeadlock(error)) return { status: "slot_taken" };
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    if (error) log.error({ event: "sharing.reschedule_consume.failed", code: errorTag(error), requestId: await getRequestId() });
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
    case "unavailable":
    case "clinic_unavailable":
      return { status: res.status };
    default:
      return { status: "not_found" };
  }
}
