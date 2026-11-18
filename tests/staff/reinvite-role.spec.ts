/**
 * V2-05 05-12 (M-REINVITE; IND M-2). Inviting an address that already has a pending invitation with ANOTHER role
 * replaces it: the earlier invitation is revoked, a new one with the new role is created and emailed, and the
 * `inviteStaff` action tells the owner which happened (`sent`, `replaced` with the previous role, `already_pending`).
 * Before 05-12 the second call answered `{ deduped: true }` with the first invitation, the action reported plain
 * success, no email went out, and the invitee joined with the EARLIER role.
 *
 * Real sessions on the local stack; acceptance goes through the system path the invite handler and the accept flow
 * use (`invitation_issue_token` then `consume_invitation_for`). Synthetic data only; the token is never printed.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createUnlinkedUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
// vi.mock below is hoisted above this import: the action resolves the session through the mocked user client.
import { inviteStaff } from "@/features/staff/actions";

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => state.client };
});

const admin = getAdminClient();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function uuid(v: string): string {
  if (!UUID.test(v)) throw new Error("not a uuid");
  return v;
}

describe("re-inviting an address with another role (M-REINVITE)", () => {
  let owner: SeededTenant;
  let invitee: Awaited<ReturnType<typeof createUnlinkedUser>>;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Synthetic Reinvite Clinic ${randomUUID().slice(0, 8)}`);
    invitee = await createUnlinkedUser();
    state.client = owner.client;
  });

  it("admin, then receptionist: the admin invitation is replaced, the owner is told, and the invitee joins as receptionist", async () => {
    const first = await inviteStaff({ email: invitee.userEmail, role: "admin" });
    expect(first).toMatchObject({ success: true, outcome: "sent" });
    const second = await inviteStaff({ email: invitee.userEmail, role: "receptionist" });
    expect(second).toMatchObject({ success: true, outcome: "replaced", previousRole: "admin" });
    if (!first.success || !second.success) return;
    expect(second.inviteId).not.toBe(first.inviteId);

    const { data: rows } = await admin
      .from("invitations")
      .select("id, role, revoked_at")
      .eq("tenant_id", owner.tenantId)
      .eq("invited_address", invitee.userEmail.toLowerCase());
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));
    expect(byId.get(first.inviteId)).toMatchObject({ role: "admin", revoked_at: expect.any(String) });
    expect(byId.get(second.inviteId)).toMatchObject({ role: "receptionist", revoked_at: null });
    // A new email job for the new invitation (the replaced one's job mints nothing: invitation_issue_token answers NULL).
    expect(psql(`select count(*) from ops.jobs where kind = 'email.invite' and payload ->> 'invitation_id' = '${uuid(second.inviteId)}'`)).toEqual(["1"]);
    expect(psql(`select coalesce(public.invitation_issue_token('${uuid(first.inviteId)}', 1), 'none')`)).toEqual(["none"]);

    // The invitee accepts the invitation they were emailed: the membership has the NEW role.
    const [raw] = psql(`select public.invitation_issue_token('${uuid(second.inviteId)}', 1)`);
    const hash = createHash("sha256").update(raw, "utf8").digest("hex");
    psql(`select public.consume_invitation_for('${uuid(invitee.userId)}', '${hash}')`);
    const { data: membership } = await admin
      .from("memberships")
      .select("role, status")
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", invitee.userId)
      .single();
    expect(membership).toEqual({ role: "receptionist", status: "active" });
  });

  it("the same address and role again is already pending: same invitation, no new email", async () => {
    const email = `reinvite-same-${randomUUID().slice(0, 8)}@example.test`;
    const first = await inviteStaff({ email, role: "nurse" });
    const again = await inviteStaff({ email, role: "nurse" });
    expect(first).toMatchObject({ success: true, outcome: "sent" });
    expect(again).toMatchObject({ success: true, outcome: "already_pending" });
    if (!first.success || !again.success) return;
    expect(again.inviteId).toBe(first.inviteId);
    expect(psql(`select count(*) from ops.jobs where kind = 'email.invite' and payload ->> 'invitation_id' = '${uuid(first.inviteId)}'`)).toEqual(["1"]);
  });
});
