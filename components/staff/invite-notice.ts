import type { InviteStaffResult } from "@/features/staff/actions";

const ROLE_LABELS: Record<string, string> = {
  owner: "owner",
  admin: "admin",
  doctor: "doctor",
  receptionist: "receptionist",
  nurse: "nurse",
};

type InviteSuccess = Extract<InviteStaffResult, { success: true }>;

/**
 * What the owner is told after an invitation (V2-05 05-12, M-REINVITE): a new invitation, a replaced one, or one
 * already pending. The role named is the one the invitation in the database carries (`result.role`, 000094 / N-2),
 * never the role picked in the form: when two invitations to one address race, the pending one may carry another role.
 */
export function inviteNotice(email: string, result: Pick<InviteSuccess, "outcome" | "role" | "previousRole">): string {
  const asRole = result.role ? (ROLE_LABELS[result.role] ?? result.role) : undefined;
  if (result.outcome === "replaced") {
    const previous = ROLE_LABELS[result.previousRole ?? ""] ?? "earlier";
    return asRole
      ? `The pending ${previous} invitation for ${email} was cancelled. A new ${asRole} invitation was sent.`
      : `The pending ${previous} invitation for ${email} was cancelled. A new invitation was sent.`;
  }
  if (result.outcome === "already_pending") {
    return asRole
      ? `An invitation for ${email} as ${asRole} is already pending. No new email was sent; resend it from the list if needed.`
      : `An invitation for ${email} is already pending. No new email was sent; resend it from the list if needed.`;
  }
  return `Invitation created for ${email}.`;
}
