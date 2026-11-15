/**
 * V2-05 05b gate close, re-verification N-2 (Low; `reviews/v205b-review-reverify.md` "M-REINVITE … residual N-2").
 *
 * Two owners invite the same address at the same moment with different roles. The first (an open transaction that has
 * inserted an `admin` invitation) wins the unique index; the second asks for `receptionist`, waits on that index and
 * gets the winner back as `deduped`. Before 000094 the answer carried no role, the action reported `already_pending`
 * and the staff form named the REQUESTED role ("… as receptionist is already pending") while an admin invitation was
 * emailed. Now `invite_staff` names the stored role in every answer, `inviteStaff` returns it as `role`, and the notice
 * (`inviteNotice`, what the form shows) can only print that role.
 *
 * Real sessions on the local stack: the first owner's call runs in a held psql transaction (as `authenticated` with the
 * owner's claims and the clinic header, exactly as PostgREST sets them), the second through the real server action.
 * Synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql, psqlAsync } from "../helpers/sql";
// vi.mock below is hoisted above this import: the action resolves the session through the mocked user client.
import { inviteStaff } from "@/features/staff/actions";
import { inviteNotice } from "@/components/staff/invite-notice";

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => state.client };
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function uuid(v: string): string {
  if (!UUID.test(v)) throw new Error("not a uuid");
  return v;
}
const EMAIL = /^[a-z0-9.-]+@example\.test$/;
function address(v: string): string {
  if (!EMAIL.test(v)) throw new Error("not a synthetic address");
  return v;
}

/** Waits until the named psql session is inside its pg_sleep (it then holds what it inserted, uncommitted). */
async function waitUntilSleeping(app: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const [n] = psql(`select count(*) from pg_stat_activity where application_name = '${app}' and wait_event = 'PgSleep'`);
    if (n === "1") return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`session ${app} never reached its sleep`);
}

describe("a deduped invitation names the stored role (re-verification N-2)", () => {
  let owner1: SeededTenant;
  let owner2: SeededTenant;

  beforeAll(async () => {
    owner1 = await seedTenantWithOwner(`Synthetic Invite Race Clinic ${randomUUID().slice(0, 8)}`);
    owner2 = await addMemberToTenant(owner1.tenantId, "owner");
    state.client = owner2.client;
  });

  it("owner 1 invites as admin (open transaction) while owner 2 invites as receptionist: owner 2 is told admin", async () => {
    const email = address(`n2-race-${randomUUID().slice(0, 8)}@example.test`);
    const app = `n2_race_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const claims = JSON.stringify({ sub: uuid(owner1.userId), role: "authenticated" });
    const headers = JSON.stringify({ "x-clinicos-tenant": uuid(owner1.tenantId) });
    const first = psqlAsync(
      `set application_name = '${app}';
       begin;
       select set_config('request.jwt.claims', '${claims}', true), set_config('request.headers', '${headers}', true);
       set local role authenticated;
       select public.invite_staff('${uuid(owner1.tenantId)}', '${email}', 'admin');
       reset role;
       select pg_sleep(2);
       commit;`,
    );
    await waitUntilSleeping(app);

    // Owner 2's call waits on the unique index until owner 1 commits, then gets owner 1's invitation back.
    const second = await inviteStaff({ email, role: "receptionist" });
    await first;
    const [firstId] = psql(
      `select id from public.invitations where tenant_id = '${uuid(owner1.tenantId)}' and invited_address = '${email}' and role = 'admin'`,
    );
    expect(firstId).toMatch(UUID);

    expect(second).toEqual({ success: true, inviteId: firstId, outcome: "already_pending", role: "admin" });
    if (!second.success) return;
    // What the staff form shows: the stored role, not the one owner 2 picked.
    const notice = inviteNotice(email, second);
    expect(notice).toBe(`An invitation for ${email} as admin is already pending. No new email was sent; resend it from the list if needed.`);
    expect(notice).not.toContain("receptionist");

    // The database holds exactly one pending invitation for the address, as admin, and one email job.
    const { data: rows } = await getAdminClient()
      .from("invitations")
      .select("id, role, revoked_at, consumed_at")
      .eq("tenant_id", owner1.tenantId)
      .eq("invited_address", email);
    expect(rows).toEqual([{ id: firstId, role: "admin", revoked_at: null, consumed_at: null }]);
    expect(psql(`select count(*) from ops.jobs where kind = 'email.invite' and payload ->> 'invitation_id' = '${uuid(firstId!)}'`)).toEqual(["1"]);
  });

  it("every answer carries the stored role: sent, already pending and replaced (sequential)", async () => {
    const email = address(`n2-seq-${randomUUID().slice(0, 8)}@example.test`);
    expect(await inviteStaff({ email, role: "nurse" })).toMatchObject({ success: true, outcome: "sent", role: "nurse" });
    const again = await inviteStaff({ email, role: "nurse" });
    expect(again).toMatchObject({ success: true, outcome: "already_pending", role: "nurse" });
    const replaced = await inviteStaff({ email, role: "doctor" });
    expect(replaced).toMatchObject({ success: true, outcome: "replaced", role: "doctor", previousRole: "nurse" });
    if (!replaced.success) return;
    expect(inviteNotice(email, replaced)).toBe(
      `The pending nurse invitation for ${email} was cancelled. A new doctor invitation was sent.`,
    );
  });
});
