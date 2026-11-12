import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DocumentShareResourceType, ShareTokenResourceType, UserRole } from "@/lib/db/types";
import { hasPerm, type Permission } from "@/lib/permissions";

/**
 * App permissions that allow minting (or revoking) a public link of each type: any one of the listed permissions.
 * Each entry is the permission the share action for that type checks. The database enforces the same rule in
 * `share_type_roles` (000021), used by `create_share_token` and `revoke_share_token`; keep the two in sync
 * (tests/security/review-fixes-db.spec.ts compares them for every role and type).
 */
export const SHARE_LINK_PERMISSIONS: Record<ShareTokenResourceType, readonly Permission[]> = {
  // sharePrescriptionViaWhatsApp, sendConsolidatedConsultationWhatsApp
  prescription: ["consultations:view"],
  // shareReceiptViaWhatsApp (billing:view); sendConsolidatedConsultationWhatsApp links the visit's receipt
  invoice: ["billing:view", "consultations:view"],
  // generateDocumentShareToken, shareLabReportViaWhatsApp
  patient_document: ["patients:view"],
  // shareReferralLetterViaWhatsApp
  referral: ["patients:view"],
  // system-issued reschedule links; revocation only
  appointment: ["appointments:edit"],
};

export function canManageShareLink(role: UserRole, type: ShareTokenResourceType): boolean {
  return SHARE_LINK_PERMISSIONS[type].some((perm) => hasPerm(role, perm));
}

/**
 * Revokes a share link of the caller's tenant through `revoke_share_token` (000021): the tenant comes from the token
 * row, the role rule is the one for creation, and the revocation is audited in the database. Returns false on any
 * refusal (missing token, other tenant, role not allowed).
 */
export async function revokeShareToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<Database, any, any>,
  tokenId: string
): Promise<boolean> {
  const { error } = await db.rpc("revoke_share_token", { p_token_id: tokenId });
  if (error) {
    console.error("[features/sharing/tokens] revoke_share_token refused:", error.code ?? "unknown");
    return false;
  }
  return true;
}

/**
 * Creates a 7-day public share token through `create_share_token` (000020/000021, P0-04). The tenant is derived inside
 * the database from the resource row, the caller must be a member of that tenant with a role allowed for the type
 * (SHARE_LINK_PERMISSIONS), and the creation is audited there; members cannot insert tokens directly. Only the token's
 * SHA-256 hash is stored (000022, AR2-L1): the token returned here is the only copy, so callers hand it to the
 * recipient and never persist it. `db` is the acting user's JWT client (`ctx.db`). Returns null on any refusal (missing resource, other
 * tenant's resource, no session): callers map that to their own "could not create link" error.
 */
export async function createShareToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<Database, any, any>,
  resourceType: DocumentShareResourceType,
  resourceId: string
): Promise<{ token: string; expiresAt: string } | null> {
  const { data, error } = await db.rpc("create_share_token", {
    p_resource_type: resourceType,
    p_resource_id: resourceId,
  });

  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row?.token) {
    if (error) {
      console.error("[features/sharing/tokens] create_share_token refused:", error.code ?? "unknown");
    }
    return null;
  }

  return { token: row.token, expiresAt: row.expires_at };
}
